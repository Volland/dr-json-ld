/**
 * IRI handling: the small set of questions the processor and the model layer
 * both ask. Kept in one place because "is this an IRI" is answered differently
 * in three parts of the JSON-LD specification and guessing is how a term
 * silently becomes a literal.
 */

const KEYWORD = /^@[a-zA-Z]+$/

/** The JSON-LD keywords. A key matching this is never a term. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  '@base',
  '@container',
  '@context',
  '@direction',
  '@graph',
  '@id',
  '@import',
  '@included',
  '@index',
  '@json',
  '@language',
  '@list',
  '@nest',
  '@none',
  '@prefix',
  '@propagate',
  '@protected',
  '@reverse',
  '@set',
  '@type',
  '@value',
  '@version',
  '@vocab',
])

export function isKeyword(value: string): boolean {
  return KEYWORDS.has(value)
}

/** A string shaped like a keyword but not one. The spec says to ignore these. */
export function isKeywordLike(value: string): boolean {
  return KEYWORD.test(value) && !KEYWORDS.has(value)
}

const ABSOLUTE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/

export function isAbsoluteIri(value: string): boolean {
  return ABSOLUTE.test(value)
}

export function isBlankNodeId(value: string): boolean {
  return value.startsWith('_:')
}

/**
 * The shape a declared prefix name must take, kept identical to the model
 * schema's `prefixName` so the editor and the command refuse the same set.
 *
 * A prefix that cannot stand on the left of a compact IRI is not a prefix: it
 * emits into the context as a mapping nothing can ever name, which is silent at
 * every later step.
 */
const PREFIX_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/

export function isLegalPrefixName(value: string): boolean {
  return PREFIX_NAME.test(value)
}

/** `prefix:suffix`, where the suffix does not begin with `//`. */
export function splitCompactIri(value: string): { prefix: string; suffix: string } | undefined {
  const i = value.indexOf(':')
  if (i <= 0) return undefined
  const prefix = value.slice(0, i)
  const suffix = value.slice(i + 1)
  if (suffix.startsWith('//')) return undefined
  if (prefix === '_') return undefined
  return { prefix, suffix }
}

/**
 * Resolve a relative reference against a base, per RFC 3986. Returns the input
 * unchanged when there is no base, so the caller can see that it stayed
 * relative and report `L2.relative-iri`.
 */
export function resolveIri(base: string | undefined, reference: string): string {
  if (reference === '') return base ?? ''
  if (isAbsoluteIri(reference)) return reference
  if (!base) return reference
  return resolveReference(base, reference)
}

/**
 * RFC 3986 section 5.2: reference resolution, done on the strings themselves.
 *
 * `new URL` is a WHATWG URL parser, not an RFC 3986 resolver: it percent-encodes
 * characters an IRI may carry, lower-cases hosts and appends a slash to an
 * authority with no path — `//g` against `http://a/b` becomes `http://g/` where
 * RFC 3986 says `http://g`. Each of those changes an IRI, which changes a triple.
 */
function resolveReference(base: string, reference: string): string {
  const r = parseReference(reference)
  const b = parseReference(base)
  let scheme: string | undefined
  let authority: string | undefined
  let path: string
  let query: string | undefined

  if (r.scheme !== undefined) {
    scheme = r.scheme
    authority = r.authority
    path = removeDotSegments(r.path)
    query = r.query
  } else {
    if (r.authority !== undefined) {
      authority = r.authority
      path = removeDotSegments(r.path)
      query = r.query
    } else {
      if (r.path === '') {
        path = b.path
        query = r.query !== undefined ? r.query : b.query
      } else {
        if (r.path.startsWith('/')) {
          path = removeDotSegments(r.path)
        } else {
          path = removeDotSegments(mergePaths(b, r.path))
        }
        query = r.query
      }
      authority = b.authority
    }
    scheme = b.scheme
  }

  let out = ''
  if (scheme !== undefined) out += `${scheme}:`
  if (authority !== undefined) out += `//${authority}`
  out += path
  if (query !== undefined) out += `?${query}`
  if (r.fragment !== undefined) out += `#${r.fragment}`
  return out
}

interface ReferenceParts {
  scheme?: string
  authority?: string
  path: string
  query?: string
  fragment?: string
}

/** RFC 3986 appendix B. */
function parseReference(value: string): ReferenceParts {
  const m = /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value)!
  return {
    ...(m[1] !== undefined ? { scheme: m[1] } : {}),
    ...(m[2] !== undefined ? { authority: m[2] } : {}),
    path: m[3] ?? '',
    ...(m[4] !== undefined ? { query: m[4] } : {}),
    ...(m[5] !== undefined ? { fragment: m[5] } : {}),
  }
}

/** RFC 3986 section 5.2.3. */
function mergePaths(base: ReferenceParts, path: string): string {
  if (base.authority !== undefined && base.path === '') return `/${path}`
  const lastSlash = base.path.lastIndexOf('/')
  return lastSlash === -1 ? path : base.path.slice(0, lastSlash + 1) + path
}

/** RFC 3986 section 5.2.4. */
function removeDotSegments(path: string): string {
  let input = path
  let output = ''
  while (input.length > 0) {
    if (input.startsWith('../')) input = input.slice(3)
    else if (input.startsWith('./')) input = input.slice(2)
    else if (input.startsWith('/./')) input = input.slice(2)
    else if (input === '/.') input = '/'
    else if (input.startsWith('/../')) {
      input = input.slice(3)
      output = output.slice(0, Math.max(0, output.lastIndexOf('/')))
    } else if (input === '/..') {
      input = '/'
      output = output.slice(0, Math.max(0, output.lastIndexOf('/')))
    } else if (input === '.' || input === '..') input = ''
    else {
      const start = input.startsWith('/') ? 1 : 0
      const next = input.indexOf('/', start)
      const segment = next === -1 ? input : input.slice(0, next)
      output += segment
      input = next === -1 ? '' : input.slice(next)
    }
  }
  return output
}

/**
 * Whether an absolute IRI can stand in an RDF dataset: no whitespace and none
 * of the characters RFC 3987 excludes. A string can pass {@link isAbsoluteIri}
 * and still fail this, which is how a document with a bad `@base` loses a
 * triple rather than asserting a broken one.
 */
export function isWellFormedIri(value: string): boolean {
  // A fragment cannot itself contain `#`, so a second one is never an IRI.
  return (
    isAbsoluteIri(value) &&
    ![...value].some((c) => c.charCodeAt(0) <= 0x20 || '<>"{}|\\^`'.includes(c)) &&
    value.indexOf('#') === value.lastIndexOf('#')
  )
}

/**
 * Whether a string is plausibly an IRI a reader meant as a reference. Used only
 * by the `L2.coercion-did-not-fire` heuristic, never to decide semantics.
 */
export function looksLikeIri(value: string): boolean {
  return isAbsoluteIri(value) && /^(https?|urn|did|ftp|mailto):/i.test(value)
}

const LANGUAGE_TAG = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/

export function isWellFormedLanguageTag(value: string): boolean {
  return LANGUAGE_TAG.test(value)
}
