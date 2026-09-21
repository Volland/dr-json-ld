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
import {
  scopedTermsOf,
  termContextValue,
  termPath,
  topLevelTerms,
  type Finding,
  type Ir,
  type IrRange,
  type IrShape,
  type IrTerm,
  type JsonPointer,
  type Position,
} from '@json-ld-modeler/core'

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
  /** Present on a scoped term: the element id of the term whose context holds it. */
  parentId?: string
  /** The keys from the top level down, joined with ` › `. */
  path: string
  /** Element ids of the scoped terms this term's `@context` map holds, in order. */
  scopedTermIds: string[]
}

export interface ProjectedView {
  id: string
  name: string
  /** Element ids, resolved from the term keys the view names. */
  termIds: string[]
  /** Element ids of the shapes the view names. */
  shapeIds: string[]
}

/** One field, with what the inspector's table shows beside it. */
export interface ProjectedField {
  key: string
  termId: string | null
  iri: string | null
  inverse: boolean
  min?: number
  max?: number
  range?: IrRange
  note?: string
  pointer: JsonPointer
  /** How the term reads the key's values, in words: the coercion the range must agree with. */
  coercion: string
  /**
   * Cardinality and range are shapes-layer facts: carried by the `shacl` target,
   * absent from every `@context`. The inspector says so beside them.
   */
  carriedBy: 'shacl'
  /** A finding saying the range and the term's coercion disagree, when there is one. */
  conflict?: { ruleId: string; message: string }
  /**
   * The facets a class-scoped term for this key would need so the range and the
   * coercion agree — offered as a promotion when there is a conflict.
   */
  promotion?: Record<string, unknown>
}

export interface ProjectedShape {
  id: string
  idWritten: boolean
  name: string
  target?: string
  targetIri: string | null
  targetTermId?: string
  closed: boolean
  note?: string
  fields: ProjectedField[]
  pointer: JsonPointer
  loc: Position
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
  /** Top-level terms: the boxes both panes draw. */
  terms: ProjectedTerm[]
  /**
   * Every scoped term, to any depth. Each names its parent, and the parent's
   * `@context` facet still carries the rebuilt map for the region the tree pane
   * draws.
   */
  scopedTerms: ProjectedTerm[]
  /** The shapes layer. */
  shapes: ProjectedShape[]
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
  const terms = topLevelTerms(ir).map((term) => projectTerm(ir, term, locate))
  const scopedTerms = ir.terms
    .filter((term) => term.scope !== undefined)
    .map((term) => projectTerm(ir, term, locate))
  const byKey = new Map(terms.map((t) => [t.key, t.id]))
  const findings = [...(options.findings ?? [])]
  const shapes = (ir.shapes ?? []).map((shape) => projectShape(ir, shape, findings, locate))
  const shapeByName = new Map(shapes.map((s) => [s.name, s.id]))

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
    scopedTerms,
    shapes,
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
            shapeIds: (v.shapes ?? [])
              .map((name) => shapeByName.get(name))
              .filter((id): id is string => !!id),
          }))
        : // A model with no views projects one containing everything, so the
          // canvas always has something to draw.
          [
            {
              id: 'all',
              name: 'All terms',
              termIds: terms.map((t) => t.id),
              shapeIds: shapes.map((s) => s.id),
            },
          ],
    findings,
    ...(options.release !== undefined ? { release: options.release } : {}),
    revision: options.revision ?? 0,
  }
}

function projectTerm(
  ir: Ir,
  term: IrTerm,
  locate: (pointer: JsonPointer) => Position,
): ProjectedTerm {
  const facets: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(term)) {
    if (!key.startsWith('@')) continue
    if (value === undefined) continue
    facets[key] = value
  }
  // A map-valued scoped context is carried by scoped terms in the IR; the facet
  // is rebuilt so the inspector and the tree pane see the context as emitted.
  const context = termContextValue(term, ir)
  if (context !== undefined) facets['@context'] = context

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
    scoped: context !== undefined,
    ...(term.scope !== undefined ? { parentId: term.scope.parent } : {}),
    path: termPath(ir, term),
    scopedTermIds: scopedTermsOf(ir, term.id).map((t) => t.id),
  }
}

const CONFLICT_RULES = new Set(['L1.shape-range-coercion-conflict', 'L1.shape-range-needs-id-coercion'])

function projectShape(
  ir: Ir,
  shape: IrShape,
  findings: readonly Finding[],
  locate: (pointer: JsonPointer) => Position,
): ProjectedShape {
  return {
    id: shape.id,
    idWritten: shape.idWritten,
    name: shape.name,
    ...(shape.target !== undefined ? { target: shape.target } : {}),
    targetIri: shape.targetIri,
    ...(shape.targetTermId !== undefined ? { targetTermId: shape.targetTermId } : {}),
    closed: shape.closed,
    ...(shape.note !== undefined ? { note: shape.note } : {}),
    pointer: shape.pointer,
    loc: locate(shape.pointer),
    fields: shape.fields.map((field) => {
      const term = ir.terms.find((t) => t.id === field.termId)
      const conflict = findings.find(
        (f) => CONFLICT_RULES.has(f.ruleId) && f.pointer.startsWith(field.pointer),
      )
      const promotion = conflict !== undefined && field.range !== undefined ? coercionFor(field.range) : undefined
      return {
        key: field.key,
        termId: field.termId,
        iri: field.iri,
        inverse: field.inverse,
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
        ...(field.range !== undefined ? { range: field.range } : {}),
        ...(field.note !== undefined ? { note: field.note } : {}),
        pointer: field.pointer,
        coercion: describeCoercion(term),
        carriedBy: 'shacl' as const,
        ...(conflict !== undefined ? { conflict: { ruleId: conflict.ruleId, message: conflict.message } } : {}),
        ...(promotion !== undefined ? { promotion } : {}),
      }
    }),
  }
}

/** The coercion a term needs for its values to be what a range asks for. */
export function coercionFor(range: IrRange): Record<string, unknown> {
  switch (range.kind) {
    case 'iri':
    case 'node':
    case 'class':
    case 'shape':
      return { '@type': '@id' }
    case 'datatype':
      return { '@type': range.datatype }
    case 'langString':
    case 'literal':
      return {}
  }
}

function describeCoercion(term: IrTerm | undefined): string {
  if (term === undefined) return 'no term of this model'
  const container = term['@container'] ?? []
  if (container.includes('@language')) return '@container: @language'
  if (term['@type'] !== undefined && term['@type'] !== null) return `@type: ${term['@type']}`
  return 'no @type'
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
    scopedTerms: [],
    shapes: [],
    examples: [],
    views: [],
    findings: [],
    revision: 0,
  }
}
