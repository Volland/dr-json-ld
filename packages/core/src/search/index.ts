/**
 * Searching what already exists: every version the project published, and every
 * context it vendored.
 *
 * The point is to find a term before minting one. A vocabulary that re-mints an
 * IRI somebody already serves is a vocabulary nobody can join up with, and the
 * moment to catch that is while the author is still typing the name.
 *
 * The index is derived from what is on disk each time it is out of date, never
 * cached. A stale entry answering for content that has changed is worse, in a
 * tool whose credibility rests on exactness, than being slow.
 *
 * Nothing here touches the network.
 *
 * @lat: [[processing#Processing#Context Resolution]]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { parseLockfile } from '../diff/lockfile.js'
import type { Ir, IrTerm } from '../model/ir.js'
import { LOCKFILE } from '../version/create.js'
import { VersionStore } from '../version/store.js'

/** Where an entry came from. A result always says which. */
export type SearchSource =
  | { kind: 'version'; versionId: string; model: string }
  | { kind: 'vendored'; iri: string; path: string }

/** What in the entry the query matched. */
export type MatchField = 'key' | 'iri' | 'note'

export interface IndexEntry {
  key: string
  iri: string | null
  note?: string
  source: SearchSource
}

export interface SearchResult extends IndexEntry {
  /** Which fields matched, in a fixed order so results read the same way. */
  matched: MatchField[]
}

/** A version that contributed nothing, and why. */
export interface SkippedSource {
  versionId: string
  reason: string
}

export interface SearchIndex {
  entries: IndexEntry[]
  skipped: SkippedSource[]
  /** What was searched, for the "nothing matched" report. */
  searched: { versions: number; vendoredContexts: number }
}

export interface BuildIndexOptions {
  versions?: VersionStore
  /** The vendored context directory, usually `contexts/` beside the models. */
  vendorDir?: string
}

/**
 * Build the index from what is on disk.
 *
 * A version that fails verification contributes nothing: returning a term from a
 * file that fails its own checksum would be asserting something the tool cannot
 * stand behind.
 */
export function buildIndex(options: BuildIndexOptions = {}): SearchIndex {
  const entries: IndexEntry[] = []
  const skipped: SkippedSource[] = []
  let versionCount = 0
  let vendoredCount = 0

  if (options.versions) {
    for (const versionId of options.versions.list()) {
      const verified = options.versions.verify(versionId)
      if (!verified.ok) {
        skipped.push({
          versionId,
          reason: verified.problems.map((p) => p.message).join('; '),
        })
        continue
      }
      versionCount++
      const manifest = verified.manifest!
      let ir: Ir
      try {
        ir = parseLockfile(options.versions.readFile(versionId, LOCKFILE))
      } catch (error) {
        skipped.push({
          versionId,
          reason: `its lockfile is unreadable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
        versionCount--
        continue
      }
      for (const term of ir.terms) {
        entries.push(entryFromTerm(term, { kind: 'version', versionId, model: manifest.model }))
      }
    }
  }

  if (options.vendorDir !== undefined && existsSync(options.vendorDir)) {
    const root = resolve(options.vendorDir)
    for (const path of filesUnder(root)) {
      if (!path.endsWith('.jsonld')) continue
      const full = join(root, path)
      let document: unknown
      try {
        document = JSON.parse(readFileSync(full, 'utf8'))
      } catch {
        // A vendored file that is not JSON is the vendor command's problem to
        // report; search simply has nothing to offer from it.
        continue
      }
      vendoredCount++
      // The path mirrors the IRI, so it is the best name available without
      // re-reading every model's `uses`.
      const iri = `https://${path.replace(/\.jsonld$/, '')}`
      for (const [key, definition] of Object.entries(flattenContext(document))) {
        if (key.startsWith('@')) continue
        entries.push({
          key,
          iri: definitionIri(definition),
          source: { kind: 'vendored', iri, path: relative(root, full) },
        })
      }
    }
  }

  // Deterministic: the order depends only on what was searched.
  entries.sort(
    (a, b) =>
      a.key.localeCompare(b.key) ||
      (a.iri ?? '').localeCompare(b.iri ?? '') ||
      sourceKey(a.source).localeCompare(sourceKey(b.source)),
  )
  skipped.sort((a, b) => a.versionId.localeCompare(b.versionId))

  return {
    entries,
    skipped,
    searched: { versions: versionCount, vendoredContexts: vendoredCount },
  }
}

function entryFromTerm(term: IrTerm, source: SearchSource): IndexEntry {
  return {
    key: term.key,
    iri: term.iri,
    ...(term.note !== undefined ? { note: term.note } : {}),
    source,
  }
}

function sourceKey(source: SearchSource): string {
  return source.kind === 'version'
    ? `version:${source.model}:${source.versionId}`
    : `vendored:${source.path}`
}

export interface SearchOptions {
  /** Restrict matching to these fields. Defaults to all three. */
  fields?: readonly MatchField[]
  limit?: number
}

export interface SearchReport {
  query: string
  results: SearchResult[]
  skipped: SkippedSource[]
  searched: SearchIndex['searched']
}

/**
 * Search the index. Matching is case-insensitive substring, which is what an
 * author half-remembering a term needs; anything cleverer would need a ranking
 * story this does not have.
 *
 * Matching nothing is a success. A search that failed because it found nothing
 * would make "is this term taken?" impossible to ask in a script.
 */
export function search(
  index: SearchIndex,
  query: string,
  options: SearchOptions = {},
): SearchReport {
  const fields = options.fields ?? (['key', 'iri', 'note'] as const)
  const needle = query.toLowerCase()

  const results: SearchResult[] = []
  for (const entry of index.entries) {
    const matched: MatchField[] = []
    if (fields.includes('key') && entry.key.toLowerCase().includes(needle)) matched.push('key')
    if (fields.includes('iri') && (entry.iri ?? '').toLowerCase().includes(needle)) {
      matched.push('iri')
    }
    if (fields.includes('note') && (entry.note ?? '').toLowerCase().includes(needle)) {
      matched.push('note')
    }
    if (matched.length === 0) continue
    results.push({ ...entry, matched })
  }

  return {
    query,
    results: options.limit === undefined ? results : results.slice(0, options.limit),
    skipped: index.skipped,
    searched: index.searched,
  }
}

/** One line per result, for the command's output. */
export function formatResult(result: SearchResult): string {
  const where =
    result.source.kind === 'version'
      ? `${result.source.model}@${result.source.versionId}`
      : `vendored ${result.source.path}`
  return `${result.key.padEnd(24)} ${(result.iri ?? '—').padEnd(48)} ${where}  [${result.matched.join(
    ', ',
  )}]`
}

/** What a search that matched nothing should say. */
export function describeNoMatch(report: SearchReport): string {
  return `Nothing matched "${report.query}". Searched ${report.searched.versions} published version${
    report.searched.versions === 1 ? '' : 's'
  } and ${report.searched.vendoredContexts} vendored context${
    report.searched.vendoredContexts === 1 ? '' : 's'
  }.`
}

function flattenContext(document: unknown): Record<string, unknown> {
  const inner =
    document !== null && typeof document === 'object' && '@context' in (document as object)
      ? (document as Record<string, unknown>)['@context']
      : document
  const layers = Array.isArray(inner) ? inner : [inner]
  const out: Record<string, unknown> = {}
  for (const layer of layers) {
    if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) continue
    Object.assign(out, layer as Record<string, unknown>)
  }
  return out
}

function definitionIri(definition: unknown): string | null {
  if (typeof definition === 'string') return definition
  if (definition !== null && typeof definition === 'object' && !Array.isArray(definition)) {
    const id = (definition as Record<string, unknown>)['@id']
    if (typeof id === 'string') return id
  }
  return null
}

function filesUnder(directory: string, prefix = ''): string[] {
  const out: string[] = []
  if (!existsSync(directory)) return out
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    const rel = prefix === '' ? entry : `${prefix}/${entry}`
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel))
    else out.push(rel)
  }
  return out.sort()
}

export { VersionStore }
