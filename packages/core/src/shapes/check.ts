/**
 * The shapes layer's own findings: the ones that need to know what a field key
 * means, which only the active context can say.
 *
 * Shapes own cardinality and terms own coercion. A field may narrow what a
 * key's values must be, but never how they are read; when the two disagree the
 * shape is describing values the context cannot produce, and that is a finding
 * at the field rather than a surprise at L3.
 *
 * @lat: [[metamodel#Metamodel#Shapes]]
 */
import type { FindingCollector } from '../findings/collector.js'
import type { Ir, IrField, IrRange, IrShape } from '../model/ir.js'
import { processContext } from '../processor/active-context.js'
import type { ActiveContext, TermDefinition } from '../processor/types.js'
import type { SourceIndex } from '../source/index-file.js'
import { pointerChild } from '../source/pointer.js'
import { resolveFieldKey, shapeContext, type FieldResolution } from './fields.js'

const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'

export function checkShapes(
  ir: Ir,
  active: ActiveContext,
  source: SourceIndex,
  findings: FindingCollector,
): void {
  for (const shape of ir.shapes) {
    // A target that resolved to nothing is its own finding; the fields under it
    // would only repeat it.
    if (shape.target !== undefined && shape.targetIri === null) continue
    const context = shapeContext(ir, shape, active)
    for (const field of shape.fields) {
      const resolved = resolveFieldKey(ir, shape, context, field.key)
      checkResolution(shape, field, resolved, source, findings)
      if (field.range !== undefined && resolved.definition !== undefined) {
        checkCoercion(shape, field, field.range, resolved.definition, source, findings)
      }
      checkAmbiguity(ir, shape, field, resolved, context, source, findings)
    }
  }
}

function checkResolution(
  shape: IrShape,
  field: IrField,
  resolved: FieldResolution,
  source: SourceIndex,
  findings: FindingCollector,
): void {
  if (resolved.iri === '@nest') {
    findings.raise(
      'L1.shape-field-is-nest',
      source,
      field.pointer,
      `"${field.key}" is a @nest term: it groups other keys in the JSON and becomes no property, so shape "${shape.name}" cannot constrain it. Constrain the keys nested under it instead.`,
      { subject: field.key },
    )
    return
  }
  if (resolved.via === 'none') {
    findings.raise(
      'L1.shape-field-unresolved',
      source,
      field.pointer,
      `"${field.key}" resolves to no property${shape.target !== undefined ? ` under ${shape.target}` : ''}: no term defines it there and no @vocab applies, so a document's "${field.key}" is dropped on expansion and shape "${shape.name}" would constrain nothing.`,
      { subject: field.key },
    )
  }
}

/** What a coercion makes of a JSON string value. */
function coercionName(definition: TermDefinition): string {
  if (definition.container.includes('@language')) return '@container: @language'
  return definition.typeMapping !== undefined ? `@type: ${definition.typeMapping}` : 'no @type'
}

function checkCoercion(
  shape: IrShape,
  field: IrField,
  range: IrRange,
  definition: TermDefinition,
  source: SourceIndex,
  findings: FindingCollector,
): void {
  const type = definition.typeMapping
  const isReference = type === '@id' || type === '@vocab'
  const isLanguageMap = definition.container.includes('@language')
  const isDatatype = type !== undefined && !type.startsWith('@')
  const rangePointer = pointerChild(field.pointer, 'range')

  const conflict = (why: string): void => {
    findings.raise(
      'L1.shape-range-coercion-conflict',
      source,
      rangePointer,
      `The range ${describeRange(range)} of "${field.key}" in shape "${shape.name}" contradicts the term's ${coercionName(definition)}: ${why} Shapes own cardinality and terms own coercion; if this class needs "${field.key}" read differently, give the class its own "${field.key}" in a type-scoped context.`,
      { subject: field.key },
    )
  }

  switch (range.kind) {
    case 'datatype':
      if (isReference) conflict('string values become references, never literals of that datatype.')
      else if (isLanguageMap) conflict('the values will be langString, not that datatype.')
      else if (type === '@json') conflict('the values are JSON literals.')
      else if (isDatatype && type !== range.iri) {
        conflict(`string values become literals of ${type}.`)
      }
      return
    case 'langString':
      if (isReference) conflict('string values become references, never language-tagged strings.')
      else if (isDatatype && type !== RDF_LANG_STRING) {
        conflict(`string values become literals of ${type}.`)
      }
      return
    case 'literal':
      if (isReference) conflict('string values become references, not literals.')
      return
    case 'iri':
    case 'node':
    case 'class':
    case 'shape':
      if (isLanguageMap) conflict('the values will be language-tagged strings, not nodes.')
      else if (isDatatype || type === '@json') conflict('string values become literals, not nodes.')
      else if (!isReference) {
        findings.raise(
          'L1.shape-range-needs-id-coercion',
          source,
          rangePointer,
          `The range ${describeRange(range)} of "${field.key}" in shape "${shape.name}" expects a node, but the term has no @type: @id. A string value under "${field.key}" becomes a literal, not a reference; only an embedded object or {"@id": …} will conform.`,
          { subject: field.key, severity: 'warning' },
        )
      }
      return
  }
}

/**
 * A shape reached through a field whose term carries a property-scoped context
 * is expanded under that context too. When it redefines one of the shape's own
 * keys, the shape means one thing standing alone and another reached from here.
 */
function checkAmbiguity(
  ir: Ir,
  shape: IrShape,
  field: IrField,
  resolved: FieldResolution,
  context: ActiveContext,
  source: SourceIndex,
  findings: FindingCollector,
): void {
  if (field.range?.kind !== 'shape' || resolved.definition?.localContext === undefined) return
  const nested = ir.shapes.find((s) => s.id === (field.range as { shapeId: string | null }).shapeId)
  if (nested === undefined) return

  let reached: ActiveContext
  try {
    reached = processContext(context, resolved.definition.localContext, {
      overrideProtected: true,
      skipRemote: true,
    })
  } catch {
    return
  }
  const alone = shapeContext(ir, nested, context)
  const via = shapeContext(ir, nested, reached)
  for (const inner of nested.fields) {
    const a = resolveFieldKey(ir, nested, alone, inner.key)
    const b = resolveFieldKey(ir, nested, via, inner.key)
    if (a.iri === b.iri) continue
    findings.raise(
      'L1.shape-field-ambiguous',
      source,
      inner.pointer,
      `"${inner.key}" in shape "${nested.name}" means ${a.iri ?? 'nothing'} on its own, but ${b.iri ?? 'nothing'} when reached through "${field.key}" of shape "${shape.name}", whose term carries a scoped context that redefines it. One field cannot constrain both.`,
      { subject: inner.key },
    )
  }
}

function describeRange(range: IrRange): string {
  switch (range.kind) {
    case 'datatype':
      return range.datatype
    case 'class':
      return `{ class: ${range.class} }`
    case 'shape':
      return `{ shape: ${range.shape} }`
    default:
      return range.kind
  }
}

/** A shape no view includes cannot be seen on any diagram. */
export function reportShapeViewCoverage(
  ir: Ir,
  source: SourceIndex,
  findings: FindingCollector,
): void {
  if (ir.views.length === 0) return
  const shown = new Set(ir.views.flatMap((v) => v.shapes ?? []))
  for (const shape of ir.shapes) {
    if (shown.has(shape.name)) continue
    findings.raise(
      'L2.shape-unused-in-view',
      source,
      shape.pointer,
      `No view includes the shape "${shape.name}", so it appears on no diagram.`,
      { severity: 'info', subject: shape.name },
    )
  }
}
