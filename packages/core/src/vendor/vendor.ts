/**
 * `ldm vendor` and `ldm vendor --check`.
 *
 * The refresh is the one place the network is touched. `--check` verifies hashes
 * without fetching and is the continuous-integration form.
 *
 * @lat: [[processing#Processing#Context Resolution#Vendoring]]
 */
import { applySplices, type Splice } from '../edit/splice.js'
import type { Ir } from '../model/ir.js'
import { resolveModelText } from '../model/resolve.js'
import { SourceIndex } from '../source/index-file.js'
import { pointerChild, type JsonPointer } from '../source/pointer.js'
import { fetchContext, type FetchOptions } from './fetch.js'
import { integrityOf, VendorStore, VendoredContextError } from './store.js'

export interface VendorEntryResult {
  iri: string
  status: 'fetched' | 'unchanged' | 'verified' | 'mismatch' | 'missing' | 'failed'
  /** The hash now recorded. Absent when nothing was written. */
  integrity?: string
  /** Why, for any status other than fetched, unchanged or verified. */
  reason?: string
}

export interface VendorResult {
  entries: VendorEntryResult[]
  /** The model text with hashes written in, when any changed. */
  text?: string
  changed: boolean
  ok: boolean
}

export interface VendorOptions extends FetchOptions {
  /** Verify recorded hashes against the vendored files, fetching nothing. */
  check?: boolean
  /** The directory the model sits in. */
  root: string
  vendorDirectory?: string
}

/**
 * Verify every recorded hash against the vendored copy. No network request is
 * made, which is what makes this the form a pipeline runs.
 */
export function vendorCheck(
  text: string,
  path: string,
  options: Omit<VendorOptions, 'check'>,
): VendorResult {
  const { ir } = resolveModelText(text, path)
  const store = new VendorStore({
    root: options.root,
    ...(options.vendorDirectory !== undefined ? { directory: options.vendorDirectory } : {}),
  })
  const entries: VendorEntryResult[] = []

  for (const entry of ir?.uses ?? []) {
    if (entry.integrity === undefined) {
      entries.push({
        iri: entry.iri,
        status: 'missing',
        reason: 'no integrity hash is recorded; run `ldm vendor` to fetch it',
      })
      continue
    }
    const raw = store.readRaw(entry.iri)
    if (raw === undefined) {
      entries.push({
        iri: entry.iri,
        status: 'missing',
        reason: `no vendored copy at ${store.absolutePathFor(entry.iri)}`,
      })
      continue
    }
    const actual = integrityOf(raw)
    if (actual !== entry.integrity) {
      entries.push({
        iri: entry.iri,
        status: 'mismatch',
        integrity: actual,
        reason: `recorded ${entry.integrity}, found ${actual}`,
      })
      continue
    }
    entries.push({ iri: entry.iri, status: 'verified', integrity: actual })
  }

  return {
    entries,
    changed: false,
    ok: entries.every((e) => e.status === 'verified'),
  }
}

/**
 * Fetch every referenced context, write it into the vendored directory, and
 * record its hash in the model as a targeted edit.
 */
export async function vendorRefresh(
  text: string,
  path: string,
  options: VendorOptions,
): Promise<VendorResult> {
  const source = SourceIndex.parse(text, { path })
  const { ir } = resolveModelText(text, path)
  const store = new VendorStore({
    root: options.root,
    ...(options.vendorDirectory !== undefined ? { directory: options.vendorDirectory } : {}),
  })

  const entries: VendorEntryResult[] = []
  const splices: Splice[] = []

  for (const [index, entry] of (ir?.uses ?? []).entries()) {
    try {
      const fetched = await fetchContext(entry.iri, options)
      const written = store.write(entry.iri, fetched.body)
      const unchanged = entry.integrity === written.integrity
      entries.push({
        iri: entry.iri,
        status: unchanged ? 'unchanged' : 'fetched',
        integrity: written.integrity,
      })
      if (!unchanged) {
        const splice = spliceForIntegrity(text, source, index, entry.integrity, written.integrity)
        if (splice) splices.push(splice)
      }
    } catch (error) {
      entries.push({
        iri: entry.iri,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const changed = splices.length > 0
  return {
    entries,
    ...(changed ? { text: applySplices(text, splices) } : {}),
    changed,
    ok: entries.every((e) => e.status === 'fetched' || e.status === 'unchanged'),
  }
}

/**
 * Write the hash onto a `uses` entry as a targeted splice: replacing the value
 * when one is there, and adding the key beside `iri` when it is not.
 */
function spliceForIntegrity(
  text: string,
  source: SourceIndex,
  index: number,
  existing: string | undefined,
  integrity: string,
): Splice | undefined {
  const entryPointer: JsonPointer = pointerChild(pointerChild('', 'uses'), index)

  if (existing !== undefined) {
    const valueRange = source.rangeOf(pointerChild(entryPointer, 'integrity'))
    if (valueRange) {
      return { start: valueRange.start, end: valueRange.end, text: integrity }
    }
  }

  const iriRange = source.rangeOf(pointerChild(entryPointer, 'iri'))
  if (!iriRange) return undefined

  const lineStart = text.lastIndexOf('\n', iriRange.start - 1) + 1
  const lineEnd = text.indexOf('\n', iriRange.start)
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)

  // A flow mapping keeps its braces; a block mapping gets a new line aligned
  // with the `iri` key it sits beside.
  if (line.includes('{')) {
    const closing = line.lastIndexOf('}')
    if (closing === -1) return undefined
    const at = lineStart + closing
    return { start: at, end: at, text: `, integrity: ${integrity} ` }
  }

  const keyStart = text.lastIndexOf('\n', iriRange.start - 1) + 1
  const keyIndentMatch = /^[ \t-]*/.exec(text.slice(keyStart))
  // Align with the key, replacing any leading dash with a space so the new key
  // is a sibling rather than a new sequence item.
  const indent = (keyIndentMatch?.[0] ?? '').replace(/-/g, ' ')
  const at = lineEnd === -1 ? text.length : lineEnd
  return { start: at, end: at, text: `\n${indent}integrity: ${integrity}` }
}

/** A resolver over a model's own vendored directory, with its recorded hashes. */
export function resolverFor(ir: Ir, root: string, directory?: string): (iri: string) => unknown {
  const store = new VendorStore({
    root,
    ...(directory !== undefined ? { directory } : {}),
  })
  const hashes = new Map<string, string>()
  for (const entry of ir.uses) {
    if (entry.integrity !== undefined) hashes.set(entry.iri, entry.integrity)
  }
  return store.resolver(hashes)
}

export { VendoredContextError, VendorStore }
