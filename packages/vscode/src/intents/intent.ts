/**
 * Intents: what the canvas posts, and the splices the host turns them into.
 *
 * The webview holds no model state. It posts a named intent, the host turns
 * that into edits, and a fresh projection comes back.
 *
 * The host handles one intent at a time. A single gesture can post two, and
 * both would otherwise be spliced against the same original text, so the second
 * would land at offsets the first had already moved.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Intents]]
 */
import {
  applySplices,
  blockExtent,
  indentAt,
  mintElementId,
  SourceIndex,
  pointerChild,
  pointerRoot,
  type Splice,
} from '@jsonld-modeler/core'

export type Intent =
  | { kind: 'create-term'; key: string; iri?: string }
  | { kind: 'rename-term'; id: string; key: string }
  | { kind: 'retype-term'; id: string; facet: string; value: unknown }
  | { kind: 'delete-term'; id: string }
  | { kind: 'set-raw'; id: string; raw: Record<string, unknown> }

export class IntentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntentError'
  }
}

interface TermLocation {
  key: string
  id: string
  pointer: string
}

/**
 * Turn one intent into splices against `text`.
 *
 * Every edit is a targeted splice computed from the YAML syntax tree, never a
 * re-serialisation: `Document.toString()` normalises flow-collection padding
 * across the whole file, so re-serialising turns a one-facet change into a
 * whole-file diff.
 */
export function splicesFor(text: string, intent: Intent): Splice[] {
  const source = SourceIndex.parse(text, { path: 'model.jsonld.yaml' })
  const root = source.data
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new IntentError('the model file does not contain a mapping at its root')
  }
  const model = root as Record<string, unknown>

  switch (intent.kind) {
    case 'create-term':
      return [createTerm(text, source, model, intent)]
    case 'rename-term':
      return [renameTerm(text, source, model, intent)]
    case 'retype-term':
      return [setFacet(text, source, model, intent.id, intent.facet, intent.value)]
    case 'set-raw':
      return [setFacet(text, source, model, intent.id, 'raw', intent.raw)]
    case 'delete-term':
      return [deleteTerm(text, source, model, intent.id)]
  }
}

/** Apply a sequence of intents one at a time, re-parsing between each. */
export function applyIntents(text: string, intents: readonly Intent[]): string {
  let current = text
  for (const intent of intents) {
    current = applySplices(current, splicesFor(current, intent))
  }
  return current
}

function termsOf(model: Record<string, unknown>): Record<string, unknown> {
  const terms = model['terms']
  if (terms === null || typeof terms !== 'object' || Array.isArray(terms)) {
    throw new IntentError('the model declares no `terms` mapping')
  }
  return terms as Record<string, unknown>
}

function locate(model: Record<string, unknown>, id: string): TermLocation {
  for (const [key, definition] of Object.entries(termsOf(model))) {
    if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) continue
    if (String((definition as Record<string, unknown>)['id']) !== id) continue
    return { key, id, pointer: pointerChild(pointerChild(pointerRoot(), 'terms'), key) }
  }
  throw new IntentError(`no term carries the element id "${id}"`)
}

function takenIds(model: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  for (const definition of Object.values(termsOf(model))) {
    if (definition === null || typeof definition !== 'object') continue
    const id = (definition as Record<string, unknown>)['id']
    if (typeof id === 'string') out.add(id)
  }
  return out
}

function createTerm(
  text: string,
  source: SourceIndex,
  model: Record<string, unknown>,
  intent: Extract<Intent, { kind: 'create-term' }>,
): Splice {
  const terms = termsOf(model)
  if (Object.prototype.hasOwnProperty.call(terms, intent.key)) {
    throw new IntentError(`the model already declares a term "${intent.key}"`)
  }
  const id = mintElementId(takenIds(model))
  const iri = intent.iri ?? `${namespacePrefix(model)}:${intent.key}`

  const termsPointer = pointerChild(pointerRoot(), 'terms')
  const existing = Object.keys(terms)
  const block = [
    `  ${quoteKey(intent.key)}:`,
    `    id: ${id}`,
    `    "@id": ${quoteScalar(iri)}`,
  ].join('\n')

  if (existing.length === 0) {
    // `terms: {}` becomes a block mapping.
    const range = source.rangeOf(termsPointer)
    if (!range) throw new IntentError('the model declares no `terms` mapping')
    return { start: range.start, end: range.end, text: `\n${block}` }
  }

  // Append after the last term's block, so declaration order is preserved and
  // the diff is one addition.
  const lastKey = existing[existing.length - 1]!
  const lastRange = source.keyRangeOf(pointerChild(termsPointer, lastKey))
  if (!lastRange) throw new IntentError(`cannot locate the term "${lastKey}"`)
  const extent = blockExtent(text, lastRange.start)
  return { start: extent.end, end: extent.end, text: `\n\n${block}` }
}

function namespacePrefix(model: Record<string, unknown>): string {
  const namespace = model['namespace']
  if (namespace !== null && typeof namespace === 'object' && !Array.isArray(namespace)) {
    const prefix = (namespace as Record<string, unknown>)['prefix']
    if (typeof prefix === 'string' && prefix !== '') return prefix
  }
  return 'ex'
}

/**
 * A rename replaces the key token and nothing else. The element id is
 * untouched, which is what makes this a rename rather than a removal and an
 * addition.
 */
function renameTerm(
  text: string,
  source: SourceIndex,
  model: Record<string, unknown>,
  intent: Extract<Intent, { kind: 'rename-term' }>,
): Splice {
  const term = locate(model, intent.id)
  if (term.key === intent.key) {
    throw new IntentError(`the term is already named "${intent.key}"`)
  }
  if (Object.prototype.hasOwnProperty.call(termsOf(model), intent.key)) {
    throw new IntentError(`the model already declares a term "${intent.key}"`)
  }
  const range = source.keyRangeOf(term.pointer)
  if (!range) throw new IntentError(`cannot locate the term "${term.key}"`)
  return { start: range.start, end: range.end, text: quoteKey(intent.key) }
}

/** Set, replace or remove one facet on a term. */
function setFacet(
  text: string,
  source: SourceIndex,
  model: Record<string, unknown>,
  id: string,
  facet: string,
  value: unknown,
): Splice {
  const term = locate(model, id)
  const facetPointer = pointerChild(term.pointer, facet)
  const existing = source.rangeOf(facetPointer)

  if (value === undefined) {
    if (!existing) throw new IntentError(`the term does not carry ${facet}`)
    const keyRange = source.keyRangeOf(facetPointer)!
    const extent = blockExtent(text, keyRange.start)
    // Take the trailing newline with it, so no blank line is left behind.
    const end = text[extent.end] === '\n' ? extent.end + 1 : extent.end
    return { start: extent.start, end, text: '' }
  }

  const rendered = renderFacet(value)

  if (existing) {
    const keyRange = source.keyRangeOf(facetPointer)!
    const extent = blockExtent(text, keyRange.start)
    const indent = indentAt(text, keyRange.start)
    return {
      start: extent.start,
      end: extent.end,
      text: `${indent}${quoteFacetKey(facet)}: ${rendered}`,
    }
  }

  // New facet: append to the end of the term's block, at its children's indent.
  const keyRange = source.keyRangeOf(term.pointer)
  if (!keyRange) throw new IntentError(`cannot locate the term "${term.key}"`)
  const extent = blockExtent(text, keyRange.start)
  const indent = childIndent(text, keyRange.start)
  return {
    start: extent.end,
    end: extent.end,
    text: `\n${indent}${quoteFacetKey(facet)}: ${rendered}`,
  }
}

function deleteTerm(
  text: string,
  source: SourceIndex,
  model: Record<string, unknown>,
  id: string,
): Splice {
  const term = locate(model, id)
  const keyRange = source.keyRangeOf(term.pointer)
  if (!keyRange) throw new IntentError(`cannot locate the term "${term.key}"`)
  const extent = blockExtent(text, keyRange.start)

  // Take the blank line that separated this term from the next, if there is
  // one, so deleting does not leave a double gap.
  let end = extent.end
  while (text[end] === '\n' && text[end + 1] === '\n') end++
  if (text[end] === '\n') end++
  return { start: extent.start, end, text: '' }
}

function childIndent(text: string, keyOffset: number): string {
  const keyIndent = indentAt(text, keyOffset)
  const rest = text.slice(text.indexOf('\n', keyOffset) + 1)
  for (const line of rest.split('\n')) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const indent = line.length - line.trimStart().length
    if (indent <= keyIndent.length) break
    return line.slice(0, indent)
  }
  return `${keyIndent}  `
}

function renderFacet(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value === 'string') return quoteScalar(value)
  // A structure is rendered as JSON, which YAML reads as a flow collection.
  // Flow is deliberate: it keeps the edit to one line.
  return JSON.stringify(value)
}

function quoteScalar(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.\-/#:]*$/.test(value) &&
    !/^(true|false|null|y|n|on|off)$/i.test(value)
    ? value
    : JSON.stringify(value)
}

function quoteKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key)
}

function quoteFacetKey(facet: string): string {
  return facet.startsWith('@') ? `"${facet}"` : facet
}
