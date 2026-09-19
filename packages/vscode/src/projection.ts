/**
 * The projection: one description of the model, from which the webview derives
 * both panes.
 *
 * It carries whatever the metamodel carries. A facet the canvas cannot show
 * silently invites someone to author a model that contradicts what they see,
 * which in JSON-LD is unusually easy: a `@container` the canvas omitted changes
 * what the document must look like without changing any IRI.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Intents]]
 */
import type { Finding, Ir, IrTerm, JsonPointer, Position } from '@jsonld-modeler/core'

export interface ProjectedTerm {
  /** The element id. Identity, and the key the layout sidecar uses. */
  id: string
  idWritten: boolean
  key: string
  iri: string | null
  /**
   * Every facet, verbatim. A facet the inspector has no field for still arrives
   * here and is editable through the raw escape hatch.
   */
  facets: Record<string, unknown>
  /** Anything the metamodel has not named. */
  raw?: Record<string, unknown>
  note?: string
  pointer: JsonPointer
  loc: Position
  /**
   * What the tree pane must draw and the graph pane must show as absent:
   * a container changes the JSON shape and, except for `@list`, no triple.
   */
  shapeOnly: string[]
  /** Whether this term carries a scoped context, drawn as a nested region. */
  scoped: boolean
}

export interface ProjectedView {
  id: string
  name: string
  /** Element ids, resolved from the term keys the view names. */
  termIds: string[]
}

/**
 * The project and release state the canvas shows but never edits.
 *
 * Versions are immutable and aliases are a deliberate act, so the canvas
 * displays them and leaves changing them to the command line. Read-only here is
 * a decision, not a gap.
 */
export interface ProjectionRelease {
  projectName?: string
  /** Every model the project declares, for the picker. */
  siblingModels: Array<{ name: string; path: string; active: boolean }>
  /** Versions of this model, newest first. */
  versions: Array<{ id: string; created: string; verified: boolean }>
  aliases: Array<{ name: string; versionId: string }>
}

export interface Projection {
  /** Absent when the model file does not parse; the canvas keeps its last one. */
  valid: boolean
  /** Why it is invalid, for the banner the canvas shows instead of going blank. */
  invalidReason?: string
  modelFile: string
  namespace: { prefix: string; base: string }
  mode: '1.1' | '1.0'
  vocab?: string
  prefixes: Record<string, string>
  uses: Array<{ iri: string; integrity?: string; vendored: boolean; pointer: JsonPointer }>
  terms: ProjectedTerm[]
  examples: Array<{ id: string; path: string; expect: unknown; pointer: JsonPointer }>
  views: ProjectedView[]
  findings: Finding[]
  /** Read-only project and release state. Absent outside a project. */
  release?: ProjectionRelease
  /** A monotonic counter, so the webview can discard a stale projection. */
  revision: number
}

/** Facets that change the JSON shape without changing a triple. */
const SHAPE_ONLY_FACETS = ['@container', '@nest', '@index'] as const

export interface ProjectOptions {
  findings?: readonly Finding[]
  revision?: number
  isVendored?: (iri: string) => boolean
  /** Resolves a term's position in the model file. */
  locate?: (pointer: JsonPointer) => Position
  release?: ProjectionRelease
}

export function project(ir: Ir, options: ProjectOptions = {}): Projection {
  const locate = options.locate ?? (() => ({ line: 1, column: 1 }))
  const terms = ir.terms.map((term) => projectTerm(term, locate))
  const byKey = new Map(terms.map((t) => [t.key, t.id]))

  return {
    valid: true,
    modelFile: ir.source,
    namespace: ir.namespace,
    mode: ir.mode,
    ...(ir.vocab !== undefined ? { vocab: ir.vocab } : {}),
    prefixes: ir.prefixes,
    uses: ir.uses.map((u) => ({
      iri: u.iri,
      ...(u.integrity !== undefined ? { integrity: u.integrity } : {}),
      vendored: options.isVendored?.(u.iri) ?? false,
      pointer: u.pointer,
    })),
    terms,
    examples: ir.examples.map((e) => ({
      id: e.id,
      path: e.path,
      expect: e.expect,
      pointer: e.pointer,
    })),
    views:
      ir.views.length > 0
        ? ir.views.map((v) => ({
            id: v.id,
            name: v.name,
            termIds: v.terms.map((key) => byKey.get(key)).filter((id): id is string => !!id),
          }))
        : // A model with no views projects one containing everything, so the
          // canvas always has something to draw.
          [{ id: 'all', name: 'All terms', termIds: terms.map((t) => t.id) }],
    findings: [...(options.findings ?? [])],
    ...(options.release !== undefined ? { release: options.release } : {}),
    revision: options.revision ?? 0,
  }
}

function projectTerm(
  term: IrTerm,
  locate: (pointer: JsonPointer) => Position,
): ProjectedTerm {
  const facets: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(term)) {
    if (!key.startsWith('@')) continue
    if (value === undefined) continue
    facets[key] = value
  }

  const shapeOnly = SHAPE_ONLY_FACETS.filter((facet) => {
    const value = term[facet]
    if (value === undefined || value === null) return false
    // `@list` is the one container that does change the triples.
    if (facet === '@container' && Array.isArray(value)) return !value.includes('@list')
    return true
  })

  return {
    id: term.id,
    idWritten: term.idWritten,
    key: term.key,
    iri: term.iri,
    facets,
    ...(term.raw !== undefined ? { raw: term.raw } : {}),
    ...(term.note !== undefined ? { note: term.note } : {}),
    pointer: term.pointer,
    loc: locate(term.pointer),
    shapeOnly,
    scoped: term['@context'] !== undefined,
  }
}

/**
 * The projection to send when the file does not parse: the last valid one,
 * marked invalid. The canvas keeps the diagram and shows a banner rather than
 * going blank.
 */
export function invalidate(previous: Projection | undefined, reason: string): Projection {
  if (previous) return { ...previous, valid: false, invalidReason: reason }
  return {
    valid: false,
    invalidReason: reason,
    modelFile: '',
    namespace: { prefix: '', base: '' },
    mode: '1.1',
    prefixes: {},
    uses: [],
    terms: [],
    examples: [],
    views: [],
    findings: [],
    revision: 0,
  }
}
