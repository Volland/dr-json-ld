/**
 * THE ONLY NETWORK CODE IN THIS REPOSITORY.
 *
 * A model file names the URLs to fetch, so a command that fetches what a model
 * tells it to, running in continuous integration against a pull request from
 * outside, is a request-forgery primitive. This function exists once, and a
 * person invokes it.
 *
 * @lat: [[processing#Processing#Context Resolution#Offline by default]]
 */

/** Content types a JSON-LD context may legitimately be served as. */
export const ACCEPTED_CONTENT_TYPES = [
  'application/ld+json',
  'application/json',
] as const

const ACCEPT_HEADER = 'application/ld+json, application/json;q=0.9'

/** How many redirects to follow before giving up. */
export const MAX_REDIRECTS = 10

export class FetchRefused extends Error {
  readonly iri: string
  constructor(iri: string, message: string) {
    super(message)
    this.name = 'FetchRefused'
    this.iri = iri
  }
}

export interface FetchOptions {
  /**
   * Accept a content type the list does not cover. The caller must pass this
   * deliberately; it is never inferred from the response.
   */
  allowAnyContentType?: boolean
  /** Injected in tests. Defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface FetchedContext {
  /** The IRI finally served, after redirects. */
  url: string
  contentType: string
  /** Raw body, which is what the integrity hash is taken over. */
  body: string
}

/**
 * Fetch one context.
 *
 * Redirects are followed. A JSON-LD content type is required unless explicitly
 * overridden. A `Link` header offering an alternate location is **not** honoured
 * — that indirection lets a server point the fetch somewhere the model never
 * named, which is the one thing vendoring exists to prevent.
 */
export async function fetchContext(
  iri: string,
  options: FetchOptions = {},
): Promise<FetchedContext> {
  const impl = options.fetchImpl ?? globalThis.fetch
  if (typeof impl !== 'function') {
    throw new FetchRefused(iri, 'no fetch implementation is available in this runtime')
  }

  let url = iri
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await impl(url, {
      redirect: 'manual',
      headers: { accept: ACCEPT_HEADER },
      ...(options.timeoutMs !== undefined
        ? { signal: AbortSignal.timeout(options.timeoutMs) }
        : {}),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new FetchRefused(iri, `${url} redirected with no Location header`)
      }
      url = new URL(location, url).href
      continue
    }

    if (!response.ok) {
      throw new FetchRefused(iri, `${url} returned HTTP ${response.status}`)
    }

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase()

    if (
      !options.allowAnyContentType &&
      !(ACCEPTED_CONTENT_TYPES as readonly string[]).includes(contentType)
    ) {
      throw new FetchRefused(
        iri,
        `${url} returned content type "${contentType || 'none'}"; a context must be served as ${ACCEPTED_CONTENT_TYPES.join(
          ' or ',
        )}. Nothing was written into the vendored directory.`,
      )
    }

    const body = await response.text()
    try {
      JSON.parse(body)
    } catch (error) {
      throw new FetchRefused(
        iri,
        `${url} did not return valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }. Nothing was written into the vendored directory.`,
      )
    }

    return { url, contentType, body }
  }

  throw new FetchRefused(iri, `${iri} exceeded ${MAX_REDIRECTS} redirects`)
}
