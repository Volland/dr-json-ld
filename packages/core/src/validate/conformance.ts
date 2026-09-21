/**
 * L3: shape conformance, decided by a SHACL engine.
 *
 * The engine runs the shapes graph the `shacl` target emits — parsed from the
 * emitted text itself — over the RDF this processor converted the document to.
 * There is no second definition of conformance: a consumer running the shipped
 * file gets the verdict given here. A violation arrives in RDF terms and is
 * mapped back to a JSON Pointer through the pointers every triple carries.
 *
 * @lat: [[validation#Validation#The Ladder#L3 Shape Conformance]]
 */
import { DataFactory, Parser, Store, type Quad, type Term } from 'n3'
import SHACLValidator from 'rdf-validate-shacl'

import { emitShacl, shapeIri } from '../emit/shacl.js'
import type { FindingCollector } from '../findings/collector.js'
import type { RuleId } from '../findings/rules.js'
import type { Ir, IrField, IrShape } from '../model/ir.js'
import type { RdfTerm, TracedQuad } from '../processor/to-rdf.js'
import type { SourceIndex } from '../source/index-file.js'
import { pointerRoot, type JsonPointer } from '../source/pointer.js'

const SH = 'http://www.w3.org/ns/shacl#'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'

/** Which rule a SHACL constraint component becomes. */
const RULE_FOR_COMPONENT: Record<string, RuleId> = {
  [`${SH}MinCountConstraintComponent`]: 'L3.min-count',
  [`${SH}MaxCountConstraintComponent`]: 'L3.max-count',
  [`${SH}DatatypeConstraintComponent`]: 'L3.datatype',
  [`${SH}NodeKindConstraintComponent`]: 'L3.node-kind',
  [`${SH}ClassConstraintComponent`]: 'L3.class',
  [`${SH}NodeConstraintComponent`]: 'L3.node',
  [`${SH}ClosedConstraintComponent`]: 'L3.closed',
}

interface PropertyShape {
  shape: IrShape
  field?: IrField
  predicate?: string
  inverse: boolean
}

/** The emitted shapes graph, parsed, and what each of its nodes stands for. */
export interface PreparedShapes {
  text: string
  store: Store
  /** Keyed by the property shape's blank node label. */
  properties: Map<string, PropertyShape>
  /** Keyed by node shape IRI. */
  nodeShapes: Map<string, IrShape>
  targetClasses: Set<string>
}

/**
 * Emit and parse the shapes graph once per check. `undefined` when the model
 * declares no shapes: L3 then has nothing to decide.
 */
export function prepareShapes(
  ir: Ir,
  options: { source: SourceIndex; resolveContext?: (iri: string) => unknown },
): PreparedShapes | undefined {
  if (ir.shapes.length === 0) return undefined
  const { text } = emitShacl(ir, {
    source: options.source,
    ...(options.resolveContext !== undefined ? { resolveContext: options.resolveContext } : {}),
  })
  const store = new Store(new Parser().parse(text))

  const nodeShapes = new Map(ir.shapes.map((shape) => [shapeIri(ir, shape), shape]))
  const properties = new Map<string, PropertyShape>()
  for (const link of store.getQuads(null, `${SH}property`, null, null)) {
    const shape = nodeShapes.get(link.subject.value)
    if (shape === undefined) continue
    const path = store.getObjects(link.object, `${SH}path`, null)[0]
    const { predicate, inverse } = describePath(store, path)
    const field = shape.fields.find((f) => f.iri === predicate && f.inverse === inverse)
    properties.set(link.object.value, {
      shape,
      inverse,
      ...(field !== undefined ? { field } : {}),
      ...(predicate !== undefined ? { predicate } : {}),
    })
  }
  const targetClasses = new Set(
    store.getObjects(null, `${SH}targetClass`, null).map((term) => term.value),
  )
  return { text, store, properties, nodeShapes, targetClasses }
}

/** The property a path starts from: itself, an inverse, or the head of a list path. */
function describePath(store: Store, path: Term | undefined): { predicate?: string; inverse: boolean } {
  if (path === undefined) return { inverse: false }
  if (path.termType === 'NamedNode') return { predicate: path.value, inverse: false }
  const inverse = store.getObjects(path, `${SH}inversePath`, null)[0]
  if (inverse !== undefined) return { predicate: inverse.value, inverse: true }
  const first = store.getObjects(path, `${RDF}first`, null)[0]
  if (first !== undefined) return describePath(store, first)
  return { inverse: false }
}

/**
 * The engine's synchronous path. `validate()` is async only to load
 * `owl:imports`, which an emitted shapes graph never declares, so the steps it
 * runs after loading are run directly and validation stays synchronous.
 */
interface SynchronousValidator {
  importsLoaded: boolean
  $data: unknown
  setDataGraph(dataGraph: unknown): void
  validationEngine: {
    validateAll(data: unknown): boolean
    getReport(): { conforms: boolean; results: ValidationResult[] }
  }
}

interface ValidationResult {
  readonly focusNode?: Term
  readonly path?: Term
  readonly value?: Term
  readonly sourceShape?: Term
  readonly sourceConstraintComponent?: Term
  readonly detail?: ValidationResult[]
}

export function runShapes(prepared: PreparedShapes, quads: readonly TracedQuad[]) {
  const data = new Store(quads.map(toN3))
  const validator = new SHACLValidator(prepared.store) as unknown as SynchronousValidator
  validator.importsLoaded = true
  validator.setDataGraph(data)
  validator.validationEngine.validateAll(validator.$data)
  return validator.validationEngine.getReport()
}

/** Validate one document's quads and raise a finding per violation, located in the document. */
export function checkConformance(
  prepared: PreparedShapes,
  quads: readonly TracedQuad[],
  document: SourceIndex,
  findings: FindingCollector,
): void {
  const targeted = quads.some(
    (q) => q.predicate.value === `${RDF}type` && prepared.targetClasses.has(q.object.value),
  )
  if (!targeted) {
    findings.raise(
      'L3.no-target',
      document,
      pointerRoot(),
      `No node in this document is typed with a class any shape targets (${[...prepared.targetClasses].join(', ') || 'none'}), so nothing was checked. "No violations" here does not mean "conforms".`,
      { severity: 'info' },
    )
    return
  }

  const report = runShapes(prepared, quads)
  const seen = new Set<string>()
  const raise = (raw: ValidationResult): void => {
    const result = plain(raw)
    const rule = RULE_FOR_COMPONENT[result.sourceConstraintComponent?.value ?? '']
    if (rule === undefined) return
    const pointer = locate(prepared, result, rule, quads)
    const key = `${rule} ${pointer}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.raise(rule, document, pointer, describe(prepared, result, rule), {
        ...(subjectOf(prepared, result) !== undefined ? { subject: subjectOf(prepared, result)! } : {}),
      })
    }
    // A nested shape's own violations are located where they occur.
    for (const detail of result.detail ?? []) raise(detail)
  }
  for (const result of report.results) raise(result)
}

/**
 * A result with its getters read once, and `null` — which the engine returns
 * for an absent value or path — turned into `undefined`.
 */
function plain(result: ValidationResult): ValidationResult {
  const read = (term: Term | null | undefined) => term ?? undefined
  return {
    focusNode: read(result.focusNode),
    path: read(result.path),
    value: read(result.value),
    sourceShape: read(result.sourceShape),
    sourceConstraintComponent: read(result.sourceConstraintComponent),
    detail: result.detail ?? [],
  }
}

function toN3(quad: TracedQuad): Quad {
  const term = (t: RdfTerm) => {
    switch (t.termType) {
      case 'NamedNode':
        return DataFactory.namedNode(t.value)
      case 'BlankNode':
        return DataFactory.blankNode(t.value)
      case 'DefaultGraph':
        return DataFactory.defaultGraph()
      case 'Literal':
        return DataFactory.literal(t.value, t.language || DataFactory.namedNode(t.datatype.value))
    }
  }
  return DataFactory.quad(
    term(quad.subject) as never,
    DataFactory.namedNode(quad.predicate.value),
    term(quad.object) as never,
    term(quad.graph) as never,
  )
}

function same(a: RdfTerm | TracedQuad['subject'], b: Term | undefined): boolean {
  if (b === undefined || a.termType !== b.termType || a.value !== b.value) return false
  if (a.termType === 'Literal' && b.termType === 'Literal') {
    return a.language === b.language && a.datatype.value === b.datatype.value
  }
  return true
}

/**
 * Where a violation is in the document. A value that is there is located at
 * itself — or at its key, for a closed shape or a nested shape, where the key is
 * what the author must change. A value that is missing is located at the node
 * that lacks it.
 */
function locate(
  prepared: PreparedShapes,
  result: ValidationResult,
  rule: RuleId,
  quads: readonly TracedQuad[],
): JsonPointer {
  const focus = result.focusNode
  const property = prepared.properties.get(result.sourceShape?.value ?? '')
  const predicate =
    rule === 'L3.closed' ? result.path?.value : (property?.predicate ?? result.path?.value)

  if (result.value !== undefined && predicate !== undefined) {
    const triple = property?.inverse
      ? quads.find((q) => same(q.subject, result.value) && q.predicate.value === predicate && same(q.object, focus))
      : quads.find((q) => same(q.subject, focus) && q.predicate.value === predicate && same(q.object, result.value))
    if (triple !== undefined) {
      if (rule === 'L3.closed' || rule === 'L3.node' || property?.inverse) return triple.pointers.predicate
      return triple.pointers.object
    }
  }
  const asSubject = quads.find((q) => same(q.subject, focus))
  if (asSubject !== undefined) return asSubject.pointers.subject
  const asObject = quads.find((q) => same(q.object, focus))
  return asObject?.pointers.object ?? pointerRoot()
}

function subjectOf(prepared: PreparedShapes, result: ValidationResult): string | undefined {
  return prepared.properties.get(result.sourceShape?.value ?? '')?.field?.key
}

function describe(prepared: PreparedShapes, result: ValidationResult, rule: RuleId): string {
  const property = prepared.properties.get(result.sourceShape?.value ?? '')
  const shape = property?.shape ?? prepared.nodeShapes.get(result.sourceShape?.value ?? '')
  const field = property?.field
  const key = field !== undefined ? `"${field.key}"` : `<${property?.predicate ?? result.path?.value ?? '?'}>`
  const where = shape !== undefined ? ` in shape "${shape.name}"` : ''
  const value = result.value !== undefined ? show(result.value) : undefined
  switch (rule) {
    case 'L3.min-count':
      return `This node has fewer values for ${key} than the ${field?.min ?? 1} required${where}.`
    case 'L3.max-count':
      return `This node has more values for ${key} than the ${field?.max ?? ''} allowed${where}.`
    case 'L3.datatype': {
      const expected = field?.range?.kind === 'datatype' ? field.range.datatype : 'the declared datatype'
      return `The value of ${key}, ${value ?? 'here'}, is not a valid ${expected}${where}.`
    }
    case 'L3.node-kind': {
      const expected =
        field?.range?.kind === 'iri'
          ? 'an IRI'
          : field?.range?.kind === 'literal'
            ? 'a literal'
            : 'a node'
      const hint = result.value?.termType === 'BlankNode' ? ' A node with no "id" is a blank node, not an IRI.' : ''
      return `The value of ${key}, ${value ?? 'here'}, is not ${expected} as the range requires${where}.${hint}`
    }
    case 'L3.class': {
      const expected = field?.range?.kind === 'class' ? field.range.class : 'the declared class'
      return `The value of ${key}, ${value ?? 'here'}, is not typed ${expected}${where}.`
    }
    case 'L3.node': {
      const nested = field?.range?.kind === 'shape' ? field.range.shape : 'its nested shape'
      return `The value of ${key} does not conform to shape "${nested}"${where}; the findings inside it say why.`
    }
    case 'L3.closed':
      return `<${result.path?.value ?? '?'}> is not a field of the closed shape${shape !== undefined ? ` "${shape.name}"` : ''}, so a node of that class may not carry it.`
    default:
      return `The document does not conform${where}.`
  }
}

function show(term: Term): string {
  if (term.termType === 'Literal') return JSON.stringify(term.value)
  if (term.termType === 'BlankNode') return 'a node with no "id"'
  return `<${term.value}>`
}
