/**
 * Intents: what the canvas posts, and the splices the host turns them into.
 *
 * The webview holds no model state. It posts a named intent, the host turns
 * that into edits, and a fresh projection comes back.
 *
 * The host handles one intent at a time. A single gesture can post two, and
 * both would otherwise be spliced against the same original text, so the second
 * would land at offsets the first had already moved. A gesture that needs two
 * edits — a field for a key that has no term yet, a promotion — is one intent
 * that makes both, so it is also one undo step.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Intents]]
 */
import {
  addFieldSplice,
  addShapeSplice,
  applySplices,
  blockExtent,
  deriveElementId,
  findShape,
  indentAt,
  mintElementId,
  removeFieldSplice,
  renameReferenceSplices,
  resolveModelText,
  SourceIndex,
  pointerChild,
  pointerRoot,
  setFieldSplice,
  setShapeSplice,
  ShapeEditError,
  writtenIds,
  type FieldSpec,
  type Splice,
} from '@json-ld-modeler/core'

export type Intent =
  | { kind: 'create-term'; key: string; iri?: string }
  | { kind: 'rename-term'; id: string; key: string }
  | { kind: 'retype-term'; id: string; facet: string; value: unknown }
  | { kind: 'delete-term'; id: string }
  | { kind: 'set-raw'; id: string; raw: Record<string, unknown> }
  /** A term inside another term's `@context` map, created if the map does not exist. */
  | { kind: 'add-scoped-term'; parentId: string; key: string; iri?: string; facets?: Record<string, unknown> }
  | { kind: 'add-shape'; name: string; targetClass?: string }
  | { kind: 'set-shape'; shape: string; property: 'targetClass' | 'closed' | 'note'; value?: string | boolean }
  /**
   * Add a field. When `createTerm` is given the key has no term yet, and one is
   * declared at the top level with that IRI in the same edit.
   */
  | { kind: 'add-field'; shape: string; key: string; field: FieldSpec; createTerm?: { iri: string } }
  | { kind: 'set-field'; shape: string; key: string; field: FieldSpec }
  | { kind: 'remove-field'; shape: string; key: string }
  /**
   * Give the shape's target class its own term for `key`, in its type-scoped
   * context, carrying `facets`. The class term is created first when the target
   * is an IRI with no term.
   */
  | { kind: 'promote-term'; shape: string; key: string; facets: Record<string, unknown> }

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
  /** The map the term is declared in: `terms:`, or a term's `@context`. */
  siblings: Record<string, unknown>
  /** Set on a scoped term. */
  parentKey?: string
}

/**
 * Turn one intent into splices against `text`.
 *
 * Every edit is a targeted splice computed from the YAML syntax tree, never a
 * re-serialisation: `Document.toString()` normalises flow-collection padding
 * across the whole file, so re-serialising turns a one-facet change into a
 * whole-file diff. An intent that makes several dependent edits applies them
 * in turn and returns the one splice spanning what changed.
 */
export function splicesFor(text: string, intent: Intent): Splice[] {
  try {
    return splicesForUnchecked(text, intent)
  } catch (error) {
    if (error instanceof ShapeEditError) throw new IntentError(error.message)
    throw error
  }
}

function splicesForUnchecked(text: string, intent: Intent): Splice[] {
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
      return renameTerm(text, source, model, intent)
    case 'retype-term':
      return [setFacet(text, source, model, intent.id, intent.facet, intent.value)]
    case 'set-raw':
      return [setFacet(text, source, model, intent.id, 'raw', intent.raw)]
    case 'delete-term':
      return [deleteTerm(text, source, model, intent.id)]
    case 'add-scoped-term':
      return [addScopedTerm(text, source, model, intent)]
    case 'add-shape':
      return [
        addShapeSplice(text, {
          name: intent.name,
          ...(intent.targetClass !== undefined ? { targetClass: intent.targetClass } : {}),
        }),
      ]
    case 'set-shape':
      return [setShapeSplice(text, intent.shape, intent.property, intent.value)]
    case 'add-field': {
      if (intent.createTerm === undefined) return [addFieldSplice(text, intent.shape, intent.key, intent.field)]
      const withTerm = applySplices(text, [
        createTerm(text, source, model, { kind: 'create-term', key: intent.key, iri: intent.createTerm.iri }),
      ])
      return [spanning(text, applySplices(withTerm, [addFieldSplice(withTerm, intent.shape, intent.key, intent.field)]))]
    }
    case 'set-field':
      return [setFieldSplice(text, intent.shape, intent.key, intent.field)]
    case 'remove-field':
      return [removeFieldSplice(text, intent.shape, intent.key)]
    case 'promote-term':
      return [spanning(text, promote(text, intent))]
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

/** The one splice that turns `before` into `after`: everything between their common ends. */
function spanning(before: string, after: string): Splice {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++
  }
  return { start, end: before.length - end, text: after.slice(start, after.length - end) }
}

function asMap(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function termsOf(model: Record<string, unknown>): Record<string, unknown> {
  const terms = asMap(model['terms'])
  if (terms === undefined) throw new IntentError('the model declares no `terms` mapping')
  return terms
}

/**
 * Find a term by element id, at the top level or inside any scoped context. A
 * term without a written id is found by the id derived from its path, which is
 * the id the canvas was given.
 */
function locate(model: Record<string, unknown>, id: string): TermLocation {
  const found = search(termsOf(model), pointerChild(pointerRoot(), 'terms'), [], id)
  if (found === undefined) throw new IntentError(`no term carries the element id "${id}"`)
  return found
}

function search(
  map: Record<string, unknown>,
  mapPointer: string,
  enclosing: string[],
  id: string,
): TermLocation | undefined {
  for (const [key, definition] of Object.entries(map)) {
    if (enclosing.length > 0 && key.startsWith('@')) continue
    const pointer = pointerChild(mapPointer, key)
    const written = asMap(definition)?.['id']
    const matches =
      written !== undefined && written !== null
        ? String(written) === id
        : deriveElementId('term', [...enclosing, key].join(String.fromCharCode(0))) === id
    if (matches) {
      return {
        key,
        id,
        pointer,
        siblings: map,
        ...(enclosing.length > 0 ? { parentKey: enclosing[enclosing.length - 1]! } : {}),
      }
    }
    const context = asMap(asMap(definition)?.['@context'])
    if (context !== undefined) {
      const inner = search(context, pointerChild(pointer, '@context'), [...enclosing, key], id)
      if (inner !== undefined) return inner
    }
  }
  return undefined
}

function takenIds(text: string): Set<string> {
  return writtenIds(text)
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
  const id = mintElementId(takenIds(text))
  const iri = intent.iri ?? `${namespacePrefix(model)}:${intent.key}`

  const termsPointer = pointerChild(pointerRoot(), 'terms')
  const existing = Object.keys(terms)
  const block = [
    `  ${quoteKey(intent.key)}:`,
    `    id: ${id}`,
    `    "@id": ${quoteScalar(iri)}`,
  ].join('\n')

  if (existing.length === 0) {
    // `terms: {}` becomes a block mapping, from just after the colon so no
    // trailing space is left behind.
    const range = source.rangeOf(termsPointer)
    const key = source.keyRangeOf(termsPointer)
    if (!range || !key) throw new IntentError('the model declares no `terms` mapping')
    return { start: text.indexOf(':', key.end) + 1, end: range.end, text: `\n${block}` }
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
  const namespace = asMap(model['namespace'])
  const prefix = namespace?.['prefix']
  return typeof prefix === 'string' && prefix !== '' ? prefix : 'ex'
}

/**
 * A rename replaces the key token and nothing else. The element id is
 * untouched, which is what makes this a rename rather than a removal and an
 * addition. Every field that resolves to the term, and every view naming it,
 * is renamed in the same edit, so shapes do not lose their fields to it.
 */
function renameTerm(
  text: string,
  source: SourceIndex,
  model: Record<string, unknown>,
  intent: Extract<Intent, { kind: 'rename-term' }>,
): Splice[] {
  const term = locate(model, intent.id)
  if (term.key === intent.key) {
    throw new IntentError(`the term is already named "${intent.key}"`)
  }
  if (Object.prototype.hasOwnProperty.call(term.siblings, intent.key)) {
    throw new IntentError(
      term.parentKey !== undefined
        ? `the scoped context of "${term.parentKey}" already declares "${intent.key}"`
        : `the model already declares a term "${intent.key}"`,
    )
  }
  const range = source.keyRangeOf(term.pointer)
  if (!range) throw new IntentError(`cannot locate the term "${term.key}"`)

  const { ir } = resolveModelText(text, 'model.jsonld.yaml')
  const fields = (ir?.shapes ?? [])
    .filter((shape) => shape.fields.some((f) => f.termId === intent.id && f.key === term.key))
    .map((shape) => ({ shape: shape.name }))
  return [
    { start: range.start, end: range.end, text: quoteKey(intent.key) },
    ...renameReferenceSplices(text, term.key, intent.key, fields, term.parentKey === undefined),
  ]
}

/**
 * Set, replace or remove one facet on a term. A term written as a block mapping
 * gets a one-line change; one written as a flow mapping or as a bare IRI — the
 * way a scoped context usually writes it — is rewritten as a flow mapping on
 * its own line, which is still one line.
 */
function setFacet(
  text: string,
  source: SourceIndex,
  model: Record<string, unknown>,
  id: string,
  facet: string,
  value: unknown,
): Splice {
  const term = locate(model, id)
  if (form(text, source, term.pointer) !== 'block') {
    const definition = definitionOf(term)
    if (value === undefined) {
      if (!(facet in definition)) throw new IntentError(`the term does not carry ${facet}`)
      delete definition[facet]
    } else {
      definition[facet] = value
    }
    return replaceTermValue(text, source, term.pointer, renderFlowMapping(definition))
  }

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

/** How a term's value is written: a block mapping, a flow mapping, or a bare scalar. */
function form(text: string, source: SourceIndex, pointer: string): 'block' | 'flow' | 'scalar' {
  const key = source.keyRangeOf(pointer)
  const value = source.rangeOf(pointer)
  if (key === undefined || value === undefined || value.start === key.start) return 'scalar'
  if (text[value.start] === '{') return 'flow'
  const line = text.slice(value.start, text.indexOf('\n', value.start) === -1 ? text.length : text.indexOf('\n', value.start))
  // A block mapping's value starts on a later line; a scalar sits on the key's.
  return text.lastIndexOf('\n', value.start - 1) > key.start || /^\s*$/.test(line) ? 'block' : 'scalar'
}

/** A term's definition as a plain map, whatever form it was written in. */
function definitionOf(term: TermLocation): Record<string, unknown> {
  const value = term.siblings[term.key]
  if (value === null || typeof value === 'string') return { '@id': value }
  return { ...(asMap(value) ?? {}) }
}

/** Replace the value after a term's key, keeping the key and the colon. */
function replaceTermValue(text: string, source: SourceIndex, pointer: string, replacement: string): Splice {
  const key = source.keyRangeOf(pointer)!
  const value = source.rangeOf(pointer)
  const colon = text.indexOf(':', key.end)
  if (value !== undefined && value.start !== key.start && value.end > value.start) {
    return { start: value.start, end: value.end, text: replacement }
  }
  return { start: colon + 1, end: colon + 1, text: ` ${replacement}` }
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
  if (term.parentKey !== undefined && onOneLineWithSiblings(text, source, term)) {
    throw new IntentError(
      `the scoped context of "${term.parentKey}" is written on one line; edit it in the file`,
    )
  }
  const extent = blockExtent(text, keyRange.start)

  // Take the blank line that separated this term from the next, if there is
  // one, so deleting does not leave a double gap.
  let end = extent.end
  while (text[end] === '\n' && text[end + 1] === '\n') end++
  if (text[end] === '\n') end++
  return { start: extent.start, end, text: '' }
}

/** Whether a scoped term shares its line with a sibling, inside a one-line `{ … }` context. */
function onOneLineWithSiblings(text: string, source: SourceIndex, term: TermLocation): boolean {
  const key = source.keyRangeOf(term.pointer)!
  const lineStart = text.lastIndexOf('\n', key.start - 1) + 1
  return /\{\s*$|[{,]\s*[^\s]/.test(text.slice(lineStart, key.start))
}

/**
 * A new term inside another term's `@context` map. The map is created when the
 * term has no scoped context; a scoped context given by reference holds no terms
 * of this model, so adding one there is refused.
 */
function addScopedTerm(
  text: string,
  source: SourceIndex,
  model: Record<string, unknown>,
  intent: Extract<Intent, { kind: 'add-scoped-term' }>,
): Splice {
  const parent = locate(model, intent.parentId)
  const definition = definitionOf(parent)
  const context = definition['@context']
  const id = mintElementId(takenIds(text))
  const iri = intent.iri ?? `${namespacePrefix(model)}:${intent.key}`
  const child = renderFlowMapping({ id, '@id': iri, ...(intent.facets ?? {}) })

  if (context !== undefined && asMap(context) === undefined) {
    throw new IntentError(
      `the scoped context of "${parent.key}" is a reference to another context and holds no terms of this model`,
    )
  }
  if (asMap(context) !== undefined && Object.prototype.hasOwnProperty.call(context, intent.key)) {
    throw new IntentError(`the scoped context of "${parent.key}" already declares "${intent.key}"`)
  }

  if (form(text, source, parent.pointer) !== 'block') {
    const next = { ...definition, '@context': { ...(asMap(context) ?? {}), [intent.key]: '\u0000' } }
    const rendered = renderFlowMapping(next).replace(JSON.stringify('\u0000'), child)
    return replaceTermValue(text, source, parent.pointer, rendered)
  }

  const contextPointer = pointerChild(parent.pointer, '@context')
  if (context === undefined) {
    const keyRange = source.keyRangeOf(parent.pointer)!
    const extent = blockExtent(text, keyRange.start)
    const indent = childIndent(text, keyRange.start)
    return {
      start: extent.end,
      end: extent.end,
      text: `\n${indent}"@context":\n${indent}  ${quoteKey(intent.key)}: ${child}`,
    }
  }

  const contextValue = source.rangeOf(contextPointer)!
  if (text[contextValue.start] === '{') {
    // A one-line `{ … }` context: the entry goes before its closing brace.
    const close = contextValue.end - 1
    const empty = /^\{\s*$/.test(text.slice(contextValue.start, close))
    const trimmed = text.slice(contextValue.start, close).replace(/\s*$/, '')
    return {
      start: contextValue.start + trimmed.length,
      end: close,
      text: `${empty ? ' ' : ', '}${quoteKey(intent.key)}: ${child} `,
    }
  }
  const entries = Object.keys(asMap(context) ?? {})
  const last = entries[entries.length - 1]
  if (last === undefined) {
    return replaceTermValue(text, source, contextPointer, `\n${childIndent(text, source.keyRangeOf(contextPointer)!.start)}${quoteKey(intent.key)}: ${child}`)
  }
  const lastKey = source.keyRangeOf(pointerChild(contextPointer, last))!
  const extent = blockExtent(text, lastKey.start)
  return {
    start: extent.end,
    end: extent.end,
    text: `\n${indentAt(text, lastKey.start)}${quoteKey(intent.key)}: ${child}`,
  }
}

/**
 * Promotion: the shape's class gets its own term for `key`, in its type-scoped
 * context, with the same IRI and the coercion the shape needs. The shared term
 * is untouched, so every other class keeps reading the key as it did.
 */
function promote(text: string, intent: Extract<Intent, { kind: 'promote-term' }>): string {
  let current = text
  let { ir } = resolveModelText(current, 'model.jsonld.yaml')
  let shape = ir === undefined ? undefined : findShape(ir, intent.shape)
  if (ir === undefined || shape === undefined) throw new IntentError(`the model declares no shape "${intent.shape}"`)
  const field = shape.fields.find((f) => f.key === intent.key)
  if (field === undefined) throw new IntentError(`the shape "${intent.shape}" has no field "${intent.key}"`)
  if (field.iri === null) throw new IntentError(`"${intent.key}" resolves to no property, so there is nothing to promote`)

  // A type-scoped context lives on a class term. A target given as an IRI gets
  // one, named after the IRI, and the shape is pointed at it.
  if (shape.targetTermId === undefined) {
    if (shape.targetIri === null) {
      throw new IntentError(`the shape "${intent.shape}" has no target class to give a scoped context to`)
    }
    const key = uniqueKey(localName(shape.targetIri), (candidate) => ir!.terms.some((t) => t.key === candidate && !t.scope))
    current = applyIntents(current, [{ kind: 'create-term', key, iri: shape.targetIri }])
    current = applySplices(current, [setShapeSplice(current, intent.shape, 'targetClass', key)])
    ;({ ir } = resolveModelText(current, 'model.jsonld.yaml'))
    shape = findShape(ir!, intent.shape)!
  }

  const classTerm = ir!.terms.find((t) => t.id === shape!.targetTermId)!
  // The IRI as the author wrote it on the shared term, so a compact IRI stays one.
  const shared = ir!.terms.find((t) => t.id === field.termId)
  const written = typeof shared?.['@id'] === 'string' ? shared['@id'] : field.iri
  return applyIntents(current, [
    {
      kind: 'add-scoped-term',
      parentId: classTerm.id,
      key: intent.key,
      iri: written,
      facets: intent.facets,
    },
  ])
}

function localName(iri: string): string {
  const tail = iri.split(/[#/:]/).filter((s) => s !== '').pop() ?? 'Class'
  return /^[A-Za-z_]/.test(tail) ? tail : `Class${tail}`
}

function uniqueKey(base: string, taken: (key: string) => boolean): string {
  if (!taken(base)) return base
  for (let i = 2; ; i++) if (!taken(`${base}${i}`)) return `${base}${i}`
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

/** `{ id: …, "@id": …, … }`, keeping the definition's own key order. */
function renderFlowMapping(definition: Record<string, unknown>): string {
  const entries = Object.entries(definition).map(([key, value]) => {
    // An element id is written bare, as everywhere else in the file.
    if (key === 'id' && typeof value === 'string' && /^[a-z0-9]{6,12}$/.test(value)) return `id: ${value}`
    return `${quoteFacetKey(key)}: ${value !== null && typeof value === 'object' ? renderNested(value) : renderFacet(value)}`
  })
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
}

function renderNested(value: object): string {
  if (Array.isArray(value)) return JSON.stringify(value)
  return renderFlowMapping(value as Record<string, unknown>)
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
  return facet.startsWith('@') ? `"${facet}"` : quoteKey(facet)
}
