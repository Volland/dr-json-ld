/**
 * The vendored context directory: the offline half of context resolution.
 *
 * A machine-local cache is an invisible input to the build. A committed
 * directory makes upstream drift a reviewable diff produced by a deliberate act.
 *
 * Nothing in this file touches the network. The fetcher lives in `fetch.ts` and
 * is the only network code in the repository.
 *
 * @lat: [[processing#Processing#Context Resolution#Vendoring]]
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** The directory name, relative to the model, that holds vendored contexts. */
export const VENDOR_DIR = 'contexts'

export interface VendorEntry {
  iri: string
  /** Where the copy lives, relative to the vendor directory. */
  path: string
  integrity: string
}

export class VendoredContextError extends Error {
  readonly iri: string
  constructor(iri: string, message: string) {
    super(message)
    this.name = 'VendoredContextError'
    this.iri = iri
  }
}

/** `sha256-` plus the base64 digest, the shape a subresource integrity uses. */
export function integrityOf(content: string | Buffer): string {
  return `sha256-${createHash('sha256').update(content).digest('base64')}`
}

/**
 * Where a context IRI is written: `contexts/<host>/<path>.jsonld`.
 *
 * The layout mirrors the IRI so a reader can tell what a file is without
 * opening it, and so two contexts from one host sit together.
 */
export function vendorPathFor(iri: string): string {
  let url: URL
  try {
    url = new URL(iri)
  } catch {
    throw new VendoredContextError(iri, `${iri} is not an absolute IRI`)
  }
  const segments = url.pathname.split('/').filter((s) => s !== '')
  // A path that ends in a slash, or is empty, gets an explicit index name so it
  // does not collide with a directory.
  const last = segments.pop() ?? 'index'
  const name = last === '' ? 'index' : last
  const withExtension = name.endsWith('.jsonld') ? name : `${name}.jsonld`
  const safe = [url.host, ...segments, withExtension].map(sanitize)
  return safe.join('/')
}

function sanitize(segment: string): string {
  // Anything that could escape the vendor directory, or that a filesystem
  // refuses, becomes an underscore. The IRI in the model remains authoritative.
  return segment.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '_')
}

export interface VendorStoreOptions {
  /** The directory the model sits in. The vendor directory is beside it. */
  root: string
  /** Overrides the directory name. Tests use it; nothing else should. */
  directory?: string
}

/**
 * Reads vendored contexts and verifies them against the hashes the model
 * records. Every command other than `ldm vendor` uses this and only this.
 */
export class VendorStore {
  readonly directory: string

  constructor(options: VendorStoreOptions) {
    this.directory = resolve(options.root, options.directory ?? VENDOR_DIR)
  }

  exists(): boolean {
    return existsSync(this.directory)
  }

  absolutePathFor(iri: string): string {
    const relativePath = vendorPathFor(iri)
    const absolute = resolve(this.directory, relativePath)
    // A sanitized path cannot escape, but the check is cheap and the failure it
    // prevents is writing outside the repository.
    const inside = relative(this.directory, absolute)
    if (inside.startsWith('..') || inside.startsWith(`${sep}..`)) {
      throw new VendoredContextError(iri, `${iri} resolves outside the vendored directory`)
    }
    return absolute
  }

  has(iri: string): boolean {
    return existsSync(this.absolutePathFor(iri))
  }

  /** Raw bytes as stored, which is what the hash is taken over. */
  readRaw(iri: string): string | undefined {
    const path = this.absolutePathFor(iri)
    if (!existsSync(path)) return undefined
    return readFileSync(path, 'utf8')
  }

  /**
   * Read a vendored context, verifying it against `expected`. A mismatch is a
   * hard error naming the entry — the vendored file and the model disagree, and
   * guessing which is right is not the tool's decision to make.
   */
  read(iri: string, expected?: string): unknown {
    const raw = this.readRaw(iri)
    if (raw === undefined) {
      throw new VendoredContextError(
        iri,
        `${iri} has not been vendored. Run \`ldm vendor\` — no command other than the vendor refresh touches the network.`,
      )
    }
    if (expected !== undefined) {
      const actual = integrityOf(raw)
      if (actual !== expected) {
        throw new VendoredContextError(
          iri,
          `${iri} does not match the hash recorded in the model. Recorded ${expected}, found ${actual}. Either the vendored file was edited by hand, or upstream changed and \`ldm vendor\` has not been run.`,
        )
      }
    }
    try {
      return JSON.parse(raw)
    } catch (error) {
      throw new VendoredContextError(
        iri,
        `the vendored copy of ${iri} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** Write a fetched context. Only `ldm vendor` calls this. */
  write(iri: string, content: string): VendorEntry {
    const path = this.absolutePathFor(iri)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return { iri, path: vendorPathFor(iri), integrity: integrityOf(content) }
  }

  /**
   * A resolver for the processor: offline, hash-checked, and failing closed.
   * `undefined` means "not vendored", which callers report rather than fetch.
   */
  resolver(hashes: ReadonlyMap<string, string>): (iri: string) => unknown {
    return (iri: string) => {
      const expected = hashes.get(iri)
      try {
        return this.read(iri, expected)
      } catch (error) {
        if (error instanceof VendoredContextError && this.readRaw(iri) === undefined) {
          return undefined
        }
        throw error
      }
    }
  }
}

export { join }
