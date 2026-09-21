/**
 * Targeted edits to the shapes layer: adding a shape, and adding, changing and
 * removing its fields.
 *
 * They live in `core` rather than beside the canvas so every one is testable in
 * plain Node and reachable from a command as well as a gesture. Each returns
 * splices against the original text, never a re-serialisation, for the reason
 * every edit in this project does: re-serialising turns a one-field change into
 * a whole-file diff.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Targeted edits]]
 */
import { SourceIndex } from '../source/index-file.js'
import { pointerChild, pointerRoot, type JsonPointer } from '../source/pointer.js'
import { mintElementId } from '../model/element-id.js'
import { blockExtent, indentAt, type Splice } from './splice.js'

/** A field as the canvas states it. Absent keys are absent from the file. */
export interface FieldSpec {
  min?: number
  max?: number
  range?: RangeSpec
  note?: string
}

/** `iri`, `node`, `literal`, `langString`, a datatype IRI, `{ class }` or `{ shape }`. */
export type RangeSpec = string | { class: string } | { shape: string }

export class ShapeEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShapeEditError'
  }
}

const SHAPES = pointerChild(pointerRoot(), 'shapes')

function parse(text: string): { source: SourceIndex; model: Record<string, unknown> } {
  const source = SourceIndex.parse(text, { path: 'model.jsonld.yaml' })
  const model = source.data
  if (model === null || typeof model !== 'object' || Array.isArray(model)) {
    throw new ShapeEditError('the model file does not contain a mapping at its root')
  }
  return { source, model: model as Record<string, unknown> }
}

function asMap(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Every element id already written anywhere in the model, so a new one is unique. */
export function writtenIds(text: string): Set<string> {
  const out = new Set<string>()
  for (const match of text.matchAll(/(?:^|[\s{,])id:\s*"?([a-z0-9]{6,12})"?/gm)) out.add(match[1]!)
  return out
}

/** Add a shape. The `shapes:` section is created when the model has none. */
export function addShapeSplice(
  text: string,
  shape: { name: string; targetClass?: string; closed?: boolean; note?: string },
  id: string = mintElementId(writtenIds(text)),
): Splice {
  const { source, model } = parse(text)
  const shapes = asMap(model['shapes'])
  if (shapes !== undefined && Object.prototype.hasOwnProperty.call(shapes, shape.name)) {
    throw new ShapeEditError(`the model already declares a shape "${shape.name}"`)
  }
  const lines = [`  ${quoteKey(shape.name)}:`, `    id: ${id}`]
  if (shape.targetClass !== undefined) lines.push(`    targetClass: ${quoteScalar(shape.targetClass)}`)
  if (shape.closed === true) lines.push('    closed: true')
  if (shape.note !== undefined) lines.push(`    note: ${JSON.stringify(shape.note)}`)
  const block = lines.join('\n')

  if (shapes !== undefined && Object.keys(shapes).length > 0) {
    const last = Object.keys(shapes).at(-1)!
    const range = source.keyRangeOf(pointerChild(SHAPES, last))!
    const extent = blockExtent(text, range.start)
    return { start: extent.end, end: extent.end, text: `\n\n${block}` }
  }
  if ('shapes' in model) {
    // `shapes:` or `shapes: {}` — the value becomes a block mapping.
    return replaceValue(text, source, SHAPES, `\n${block}`)
  }
  // No section yet: it goes before `examples` or `views`, where a reader of the
  // file expects it after the terms, or at the end.
  for (const next of ['examples', 'views']) {
    const range = source.keyRangeOf(pointerChild(pointerRoot(), next))
    if (range === undefined) continue
    const start = text.lastIndexOf('\n', range.start - 1) + 1
    return { start, end: start, text: `shapes:\n${block}\n\n` }
  }
  const tail = text.endsWith('\n') ? '' : '\n'
  return { start: text.length, end: text.length, text: `${tail}\nshapes:\n${block}\n` }
}

/** Add a field to a shape, creating the shape's `fields:` map when it has none. */
export function addFieldSplice(text: string, shapeName: string, key: string, spec: FieldSpec): Splice {
  const { source, model } = parse(text)
  const shape = shapeOf(model, shapeName)
  const shapePointer = pointerChild(SHAPES, shapeName)
  const fields = asMap(shape['fields'])
  if (fields !== undefined && Object.prototype.hasOwnProperty.call(fields, key)) {
    throw new ShapeEditError(`the shape "${shapeName}" already has a field "${key}"`)
  }
  const fieldsPointer = pointerChild(shapePointer, 'fields')
  const line = (indent: string) => `${indent}${quoteKey(key)}: ${renderFieldSpec(spec)}`

  if (fields !== undefined && Object.keys(fields).length > 0) {
    const last = Object.keys(fields).at(-1)!
    const range = source.keyRangeOf(pointerChild(fieldsPointer, last))!
    const extent = blockExtent(text, range.start)
    return { start: extent.end, end: extent.end, text: `\n${line(indentAt(text, range.start))}` }
  }
  const shapeKey = source.keyRangeOf(shapePointer)!
  const childIndent = `${indentAt(text, shapeKey.start)}  `
  if ('fields' in shape) {
    return replaceValue(text, source, fieldsPointer, `\n${line(`${childIndent}  `)}`)
  }
  const extent = blockExtent(text, shapeKey.start)
  return {
    start: extent.end,
    end: extent.end,
    text: `\n${childIndent}fields:\n${line(`${childIndent}  `)}`,
  }
}

/** Replace a field's constraints. The field keeps its place and its key. */
export function setFieldSplice(text: string, shapeName: string, key: string, spec: FieldSpec): Splice {
  const { source, model } = parse(text)
  fieldOf(model, shapeName, key)
  const pointer = pointerChild(pointerChild(pointerChild(SHAPES, shapeName), 'fields'), key)
  const range = source.keyRangeOf(pointer)!
  const extent = blockExtent(text, range.start)
  return {
    start: extent.start,
    end: extent.end,
    text: `${indentAt(text, range.start)}${quoteKey(key)}: ${renderFieldSpec(spec)}`,
  }
}

/** Remove a field, and the line it stood on. */
export function removeFieldSplice(text: string, shapeName: string, key: string): Splice {
  const { source, model } = parse(text)
  fieldOf(model, shapeName, key)
  const fieldsPointer = pointerChild(pointerChild(SHAPES, shapeName), 'fields')
  // The last field takes `fields:` with it, rather than leaving an empty key.
  const only = Object.keys(asMap(shapeOf(model, shapeName)['fields']) ?? {}).length === 1
  const pointer = only ? fieldsPointer : pointerChild(fieldsPointer, key)
  const range = source.keyRangeOf(pointer)!
  const extent = blockExtent(text, range.start)
  const end = text[extent.end] === '\n' ? extent.end + 1 : extent.end
  return { start: extent.start, end, text: '' }
}

/** Set or clear one of a shape's own properties: `targetClass`, `closed` or `note`. */
export function setShapeSplice(
  text: string,
  shapeName: string,
  property: 'targetClass' | 'closed' | 'note',
  value: string | boolean | undefined,
): Splice {
  const { source, model } = parse(text)
  shapeOf(model, shapeName)
  const shapePointer = pointerChild(SHAPES, shapeName)
  const pointer = pointerChild(shapePointer, property)
  const rendered =
    value === undefined
      ? undefined
      : typeof value === 'boolean'
        ? String(value)
        : property === 'note'
          ? JSON.stringify(value)
          : quoteScalar(value)
  const existing = source.keyRangeOf(pointer)
  if (existing !== undefined) {
    const extent = blockExtent(text, existing.start)
    if (rendered === undefined) {
      const end = text[extent.end] === '\n' ? extent.end + 1 : extent.end
      return { start: extent.start, end, text: '' }
    }
    return { start: extent.start, end: extent.end, text: `${indentAt(text, existing.start)}${property}: ${rendered}` }
  }
  if (rendered === undefined) throw new ShapeEditError(`the shape "${shapeName}" declares no ${property}`)
  // Right after the id, where a reader looks for what the shape is about.
  const shapeKey = source.keyRangeOf(shapePointer)!
  const idKey = source.keyRangeOf(pointerChild(shapePointer, 'id'))
  const indent = `${indentAt(text, shapeKey.start)}  `
  const after = idKey !== undefined ? blockExtent(text, idKey.start).end : text.indexOf('\n', shapeKey.start)
  const at = after === -1 ? text.length : after
  return { start: at, end: at, text: `\n${indent}${property}: ${rendered}` }
}

/**
 * The splices that keep shapes and views pointing at a term whose key changed:
 * every field that names the old key in the shapes that resolve it to this term,
 * and every view entry naming it.
 */
export function renameReferenceSplices(
  text: string,
  oldKey: string,
  newKey: string,
  fieldsOfTerm: ReadonlyArray<{ shape: string }>,
  renameViewEntries: boolean,
): Splice[] {
  const { source, model } = parse(text)
  const out: Splice[] = []
  for (const { shape } of fieldsOfTerm) {
    const pointer = pointerChild(pointerChild(pointerChild(SHAPES, shape), 'fields'), oldKey)
    const range = source.keyRangeOf(pointer)
    if (range !== undefined) out.push({ start: range.start, end: range.end, text: quoteKey(newKey) })
  }
  if (renameViewEntries && Array.isArray(model['views'])) {
    ;(model['views'] as unknown[]).forEach((view, i) => {
      const terms = asMap(view)?.['terms']
      if (!Array.isArray(terms)) return
      terms.forEach((entry, j) => {
        if (entry !== oldKey) return
        const pointer = pointerChild(pointerChild(pointerChild(pointerChild(pointerRoot(), 'views'), i), 'terms'), j)
        const range = source.rangeOf(pointer)
        if (range !== undefined) out.push({ start: range.start, end: range.end, text: quoteKey(newKey) })
      })
    })
  }
  return out
}

/** A field's constraints as the one-line flow mapping the file carries. */
export function renderFieldSpec(spec: FieldSpec): string {
  const parts: string[] = []
  if (spec.min !== undefined) parts.push(`min: ${spec.min}`)
  if (spec.max !== undefined) parts.push(`max: ${spec.max}`)
  if (spec.range !== undefined) {
    parts.push(
      typeof spec.range === 'string'
        ? `range: ${quoteScalar(spec.range)}`
        : 'class' in spec.range
          ? `range: { class: ${quoteScalar(spec.range.class)} }`
          : `range: { shape: ${quoteScalar(spec.range.shape)} }`,
    )
  }
  if (spec.note !== undefined) parts.push(`note: ${JSON.stringify(spec.note)}`)
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`
}

function shapeOf(model: Record<string, unknown>, name: string): Record<string, unknown> {
  const shape = asMap(asMap(model['shapes'])?.[name])
  if (shape === undefined) throw new ShapeEditError(`the model declares no shape "${name}"`)
  return shape
}

function fieldOf(model: Record<string, unknown>, shapeName: string, key: string): unknown {
  const fields = asMap(shapeOf(model, shapeName)['fields'])
  if (fields === undefined || !Object.prototype.hasOwnProperty.call(fields, key)) {
    throw new ShapeEditError(`the shape "${shapeName}" has no field "${key}"`)
  }
  return fields[key]
}

/**
 * Replace the value after a key — `{}`, `null`, or nothing at all — keeping the
 * key and its colon.
 */
function replaceValue(text: string, source: SourceIndex, pointer: JsonPointer, replacement: string): Splice {
  const key = source.keyRangeOf(pointer)!
  const colon = text.indexOf(':', key.end)
  const value = source.rangeOf(pointer)
  const hasValue = value !== undefined && value.start !== key.start && value.end > value.start
  return hasValue
    ? { start: colon + 1, end: value.end, text: replacement }
    : { start: colon + 1, end: colon + 1, text: replacement }
}

function quoteScalar(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.\-/#:]*$/.test(value) && !/^(true|false|null|y|n|on|off)$/i.test(value)
    ? value
    : JSON.stringify(value)
}

function quoteKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key)
}
