/**
 * The projection from the IR to a `@context` document.
 *
 * The terms layer is context-shaped by construction, so this is a projection
 * rather than a translation and almost nothing can be lost — which is what makes
 * the capability matrix's only interesting entry the mode-1.0 downgrade.
 *
 * @lat: [[emitters#Emitters#Context Target]]
 */
import type { Ir, IrTerm } from '../model/ir.js'

export interface ContextDocument {
  '@context': unknown
}

/**
 * The context an IR denotes, in the referenced array form: every referenced
 * context as an IRI, with the model's own terms as the final layer.
 *
 * Term order is derived from the model rather than hashed, so a one-term change
 * is a one-line diff.
 */
export function buildContextDocument(ir: Ir): ContextDocument {
  const own = buildOwnLayer(ir)
  const referenced = ir.uses.map((u) => u.iri)
  if (referenced.length === 0) return { '@context': own }
  return { '@context': [...referenced, own] }
}

/** Just the model's own terms, prefixes and vocabulary settings. */
export function buildOwnLayer(ir: Ir): Record<string, unknown> {
  const layer: Record<string, unknown> = {}

  if (ir.mode === '1.1') layer['@version'] = 1.1
  if (ir.base !== undefined) layer['@base'] = ir.base
  if (ir.vocab !== undefined) layer['@vocab'] = ir.vocab

  // The model's own namespace prefix comes first when it is emitted at all, so
  // a reader sees whose vocabulary this is before anyone else's. It is emitted
  // only when some term actually writes a compact IRI against it — otherwise it
  // would be a term in the artifact that the author never declared, which an
  // import round trip would then read back as one.
  const ownPrefix = ir.namespace.prefix
  if (ownPrefix && ir.prefixes[ownPrefix] === undefined && usesPrefix(ir, ownPrefix)) {
    layer[ownPrefix] = ir.namespace.base
  }
  for (const [name, iri] of Object.entries(ir.prefixes)) {
    layer[name] = iri
  }

  for (const term of ir.terms) {
    layer[term.key] = buildTermDefinition(term)
  }

  return layer
}

/** Whether any term writes a compact IRI against this prefix. */
function usesPrefix(ir: Ir, prefix: string): boolean {
  const head = `${prefix}:`
  return ir.terms.some((term) =>
    [term['@id'], term['@type'], term['@reverse'], term['@index']].some(
      (value) => typeof value === 'string' && value.startsWith(head),
    ),
  )
}

/**
 * One term definition. Collapses to a bare IRI string when the term carries no
 * facet beyond `@id`, because that is the idiom and a diff of it reads better.
 */
export function buildTermDefinition(term: IrTerm): unknown {
  const definition: Record<string, unknown> = {}

  if (term['@reverse'] !== undefined) {
    definition['@reverse'] = term['@reverse']
  } else if (term['@id'] !== undefined) {
    definition['@id'] = term['@id']
  } else if (term.iri !== null) {
    definition['@id'] = term.iri
  }

  if (term['@type'] !== undefined) definition['@type'] = term['@type']
  if (term['@container'] !== undefined && term['@container'] !== null) {
    const container = term['@container']
    definition['@container'] = container.length === 1 ? container[0] : container
  }
  if (term['@language'] !== undefined) definition['@language'] = term['@language']
  if (term['@direction'] !== undefined) definition['@direction'] = term['@direction']
  if (term['@protected'] !== undefined) definition['@protected'] = term['@protected']
  if (term['@context'] !== undefined) definition['@context'] = term['@context']
  if (term['@nest'] !== undefined) definition['@nest'] = term['@nest']
  if (term['@prefix'] !== undefined) definition['@prefix'] = term['@prefix']
  if (term['@index'] !== undefined) definition['@index'] = term['@index']

  // The raw escape hatch reaches the context unchanged, so a facet the metamodel
  // has not yet named is never a reason to leave the tool.
  if (term.raw) Object.assign(definition, term.raw)

  const keys = Object.keys(definition)
  if (keys.length === 1 && keys[0] === '@id' && typeof definition['@id'] === 'string') {
    return definition['@id']
  }
  return definition
}
