/**
 * Deserialize JSON-LD to RDF — JSON-LD 1.1 API section 8.1 — over this
 * processor's own expanded output.
 *
 * It is implemented here rather than delegated because the pointer is the
 * feature: every triple carries the JSON Pointer of the node object that gave
 * it a subject, and of the key and value that gave it a predicate and object.
 * Re-deriving those afterwards from a delegated conversion would mean matching
 * triples back to the input by value, which is ambiguous exactly when a value
 * repeats. L3 locates a SHACL violation through these pointers.
 *
 * Blank node labels are issued in document order, so the same document always
 * converts to the same labels.
 *
 * @lat: [[processing#Processing#RDF Conversion#From JSON-LD to RDF]]
 */
import { isWellFormedIri } from '../iri/iri.js'
import { pointerParent, pointerRoot, pointerTokens, type JsonPointer } from '../source/pointer.js'
import { pointerOf } from './envelope.js'
import { NO_INSTRUMENTATION, type Instrumentation } from './types.js'

export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF_TYPE = `${RDF}type`
const RDF_FIRST = `${RDF}first`
const RDF_REST = `${RDF}rest`
const RDF_NIL = `${RDF}nil`
const RDF_JSON = `${RDF}JSON`
const RDF_LANG_STRING = `${RDF}langString`
const I18N = 'https://www.w3.org/ns/i18n#'

/** RDF terms, shaped after RDF/JS so a store or engine can take them as they are. */
export type RdfTerm =
  | { termType: 'NamedNode'; value: string }
  | { termType: 'BlankNode'; value: string }
  | { termType: 'Literal'; value: string; language: string; datatype: { termType: 'NamedNode'; value: string } }
  | { termType: 'DefaultGraph'; value: '' }

export type RdfSubject = Extract<RdfTerm, { termType: 'NamedNode' | 'BlankNode' }>

export interface RdfQuad {
  subject: RdfSubject
  predicate: { termType: 'NamedNode'; value: string }
  object: RdfTerm
  graph: RdfSubject | { termType: 'DefaultGraph'; value: '' }
}

/** Where in the input document a triple came from. */
export interface QuadPointers {
  /** The node object that supplied the subject. */
  subject: JsonPointer
  /** The key that supplied the predicate — the node object for `@type`. */
  predicate: JsonPointer
  /** The value that supplied the object. */
  object: JsonPointer
}

export interface TracedQuad extends RdfQuad {
  pointers: QuadPointers
}

export interface ToRdfOptions {
  /** How a value's base direction is represented. Unset drops it, as the API does by default. */
  rdfDirection?: 'i18n-datatype' | 'compound-literal'
  /** Keep triples whose predicate is a blank node. */
  produceGeneralizedRdf?: boolean
  instrumentation?: Instrumentation
}

const DEFAULT_GRAPH = { termType: 'DefaultGraph', value: '' } as const

interface State {
  quads: TracedQuad[]
  seen: Set<string>
  labels: Map<string, string>
  counter: number
  options: ToRdfOptions
  instrumentation: Instrumentation
}

/** Convert an expanded document to quads, each carrying its pointers. */
export function toRdf(expanded: readonly unknown[], options: ToRdfOptions = {}): TracedQuad[] {
  const state: State = {
    quads: [],
    seen: new Set(),
    labels: new Map(),
    counter: 0,
    options,
    instrumentation: options.instrumentation ?? NO_INSTRUMENTATION,
  }
  for (const element of expanded) {
    if (isNodeObject(element)) walkNode(state, element, DEFAULT_GRAPH, pointerRoot())
  }
  return state.quads
}

type Graph = RdfQuad['graph']

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNodeObject(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !('@value' in value) && !('@list' in value) && !('@set' in value)
}

/** A blank node identifier from the input, relabelled; or a fresh one. */
function blankNode(state: State, label?: string): { termType: 'BlankNode'; value: string } {
  if (label !== undefined) {
    const existing = state.labels.get(label)
    if (existing !== undefined) return { termType: 'BlankNode', value: existing }
  }
  const issued = `b${state.counter++}`
  if (label !== undefined) state.labels.set(label, issued)
  return { termType: 'BlankNode', value: issued }
}

/** An `@id` or `@type` value as a term, or `null` when it is not well formed. */
function reference(state: State, value: unknown): RdfSubject | null {
  if (typeof value !== 'string') return null
  if (value.startsWith('_:')) return blankNode(state, value)
  return isWellFormedIri(value) ? { termType: 'NamedNode', value } : null
}

function emit(
  state: State,
  subject: RdfSubject,
  predicate: string,
  object: RdfTerm,
  graph: Graph,
  pointers: QuadPointers,
): void {
  const key = `${termKey(subject)} <${predicate}> ${termKey(object)} ${termKey(graph)}`
  if (state.seen.has(key)) return
  state.seen.add(key)
  state.quads.push({
    subject,
    predicate: { termType: 'NamedNode', value: predicate },
    object,
    graph,
    pointers,
  })
  state.instrumentation.onEvent({
    kind: 'emit-triple',
    subject: termKey(subject),
    predicate: `<${predicate}>`,
    object: termKey(object),
    pointer: pointers.object,
  })
}

/**
 * Emit a node's triples and return its subject — `null` when its `@id` is not
 * well formed, in which case its own triples are dropped but nodes nested in it
 * are still converted, as they are separate nodes in the node map.
 */
function walkNode(
  state: State,
  node: Record<string, unknown>,
  graph: Graph,
  fallback: JsonPointer,
): RdfSubject | null {
  const here = pointerOf(node) ?? fallback
  const subject =
    '@id' in node ? reference(state, node['@id']) : blankNode(state)

  if ('@type' in node && subject !== null) {
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
    for (const type of types) {
      const object = reference(state, type)
      if (object === null) continue
      emit(state, subject, RDF_TYPE, object, graph, { subject: here, predicate: here, object: here })
    }
  }

  for (const [property, values] of Object.entries(node)) {
    if (property.startsWith('@')) continue
    const predicate = predicateFor(state, property)
    for (const item of Array.isArray(values) ? values : [values]) {
      const object = objectFor(state, item, graph, here)
      if (object === null || subject === null || predicate === null) continue
      const objectPointer = pointerOf(item) ?? here
      emit(state, subject, predicate, object, graph, {
        subject: here,
        predicate: keyPointer(here, objectPointer),
        object: objectPointer,
      })
    }
  }

  if (isObject(node['@reverse'])) {
    for (const [property, values] of Object.entries(node['@reverse'])) {
      const predicate = predicateFor(state, property)
      for (const item of Array.isArray(values) ? values : [values]) {
        if (!isNodeObject(item)) continue
        const other = walkNode(state, item, graph, here)
        if (other === null || subject === null || predicate === null) continue
        const otherPointer = pointerOf(item) ?? here
        emit(state, other, predicate, subject, graph, {
          subject: otherPointer,
          predicate: keyPointer(here, otherPointer),
          object: here,
        })
      }
    }
  }

  if ('@graph' in node) {
    // A node's `@graph` names a graph after the node. One whose name is not
    // well formed holds nothing a dataset can carry.
    if (subject !== null) {
      const values = Array.isArray(node['@graph']) ? node['@graph'] : [node['@graph']]
      for (const item of values) {
        if (isNodeObject(item)) walkNode(state, item, subject, here)
      }
    }
  }

  if ('@included' in node) {
    const values = Array.isArray(node['@included']) ? node['@included'] : [node['@included']]
    for (const item of values) {
      if (isNodeObject(item)) walkNode(state, item, graph, here)
    }
  }

  return subject
}

function predicateFor(state: State, property: string): string | null {
  if (property.startsWith('_:')) {
    // A blank node predicate is generalized RDF, and the API drops it unless asked.
    return state.options.produceGeneralizedRdf === true ? blankNode(state, property).value : null
  }
  return isWellFormedIri(property) ? property : null
}

/**
 * The key a value was written under: the value's own pointer with any trailing
 * array index removed. A value that did not come from under the node — a
 * reverse edge, say — is located at itself.
 */
function keyPointer(node: JsonPointer, value: JsonPointer): JsonPointer {
  if (value === node || !value.startsWith(`${node}/`)) return value
  let pointer = value
  while (pointer !== node && /^[0-9]+$/.test(pointerTokens(pointer).at(-1) ?? '')) {
    pointer = pointerParent(pointer)
  }
  return pointer === node ? value : pointer
}

/** Object to RDF Conversion — section 8.2. */
function objectFor(state: State, item: unknown, graph: Graph, parent: JsonPointer): RdfTerm | null {
  if (!isObject(item)) return null
  if ('@list' in item) {
    const values = Array.isArray(item['@list']) ? item['@list'] : [item['@list']]
    return listFor(state, values, graph, pointerOf(item) ?? parent)
  }
  if ('@value' in item) return literalFor(state, item, graph, pointerOf(item) ?? parent)
  return walkNode(state, item, graph, parent)
}

/** List Conversion — section 8.3. An empty list is `rdf:nil`. */
function listFor(state: State, items: unknown[], graph: Graph, pointer: JsonPointer): RdfTerm {
  if (items.length === 0) return { termType: 'NamedNode', value: RDF_NIL }
  const heads = items.map(() => blankNode(state))
  items.forEach((item, i) => {
    const head = heads[i]!
    const itemPointer = pointerOf(item) ?? pointer
    const object = objectFor(state, item, graph, pointer)
    if (object !== null) {
      emit(state, head, RDF_FIRST, object, graph, {
        subject: pointer,
        predicate: pointer,
        object: itemPointer,
      })
    }
    const rest: RdfTerm = i + 1 < heads.length ? heads[i + 1]! : { termType: 'NamedNode', value: RDF_NIL }
    emit(state, head, RDF_REST, rest, graph, { subject: pointer, predicate: pointer, object: pointer })
  })
  return heads[0]!
}

function literal(value: string, datatype: string, language = ''): RdfTerm {
  return { termType: 'Literal', value, language, datatype: { termType: 'NamedNode', value: datatype } }
}

function literalFor(
  state: State,
  item: Record<string, unknown>,
  graph: Graph,
  pointer: JsonPointer,
): RdfTerm | null {
  let value = item['@value']
  let datatype = typeof item['@type'] === 'string' ? (item['@type'] as string) : null
  const language = typeof item['@language'] === 'string' ? (item['@language'] as string) : null
  const direction = typeof item['@direction'] === 'string' ? (item['@direction'] as string) : null

  if (datatype !== null && datatype !== '@json' && !isWellFormedIri(datatype)) return null
  if (language !== null && !/^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/.test(language)) return null

  if (datatype === '@json') {
    return literal(canonicalJson(value), RDF_JSON)
  }
  if (typeof value === 'boolean') {
    value = value ? 'true' : 'false'
    datatype ??= `${XSD}boolean`
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value) || Math.abs(value) >= 1e21 || datatype === `${XSD}double`) {
      value = canonicalDouble(value)
      datatype ??= `${XSD}double`
    } else {
      value = value.toFixed(0)
      datatype ??= `${XSD}integer`
    }
  }
  if (typeof value !== 'string') return null

  if (direction !== null && state.options.rdfDirection === 'i18n-datatype') {
    return literal(value, `${I18N}${(language ?? '').toLowerCase()}_${direction}`)
  }
  if (direction !== null && state.options.rdfDirection === 'compound-literal') {
    const node = blankNode(state)
    const pointers = { subject: pointer, predicate: pointer, object: pointer }
    emit(state, node, `${RDF}value`, literal(value, `${XSD}string`), graph, pointers)
    if (language !== null) {
      emit(state, node, `${RDF}language`, literal(language.toLowerCase(), `${XSD}string`), graph, pointers)
    }
    emit(state, node, `${RDF}direction`, literal(direction, `${XSD}string`), graph, pointers)
    return node
  }
  if (datatype === null) {
    return language !== null ? literal(value, RDF_LANG_STRING, language.toLowerCase()) : literal(value, `${XSD}string`)
  }
  return literal(value, datatype, datatype === RDF_LANG_STRING && language !== null ? language.toLowerCase() : '')
}

/** The canonical lexical form of an `xsd:double`: `1.1E0`, `-2.5E-3`. */
function canonicalDouble(value: number): string {
  return value.toExponential(15).replace(/(\d)0*e\+?/, '$1E')
}

/** RFC 8785 JSON canonicalization, which is what `rdf:JSON` literals carry. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

/** N-Triples/N-Quads syntax for one term. */
export function termKey(term: RdfTerm | Graph): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value}>`
    case 'BlankNode':
      return `_:${term.value}`
    case 'DefaultGraph':
      return ''
    case 'Literal': {
      const escaped = escapeLiteral(term.value)
      if (term.language) return `"${escaped}"@${term.language}`
      if (term.datatype.value === `${XSD}string`) return `"${escaped}"`
      return `"${escaped}"^^<${term.datatype.value}>`
    }
  }
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

/** Serialize quads as N-Quads, one per line, in the order produced. */
export function toNQuads(quads: readonly RdfQuad[]): string {
  return quads
    .map((q) => {
      const graph = termKey(q.graph)
      return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)}${graph ? ` ${graph}` : ''} .\n`
    })
    .join('')
}
