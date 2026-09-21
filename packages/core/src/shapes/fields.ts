/**
 * What a shape's field key means.
 *
 * A field key resolves in the active context a processor would apply to a node
 * of the shape's target class: the model's context, then the class term's
 * type-scoped context. It is answered by the processor's own context machinery
 * rather than by a lookup over the model, because a second resolver would
 * diverge from expansion exactly where expansion is hardest — and then L3 would
 * contradict L1 with nobody able to say which was right.
 *
 * @lat: [[metamodel#Metamodel#Shapes]]
 */
import { buildContextDocument } from '../emit/context-document.js'
import { scopedTermsOf, type Ir, type IrField, type IrShape, type IrTerm } from '../model/ir.js'
import { expandIri, processContext } from '../processor/active-context.js'
import { emptyContext, type ActiveContext, type TermDefinition } from '../processor/types.js'

export interface ShapeResolveOptions {
  /** Reads a vendored context. Without it, referenced contexts are skipped. */
  resolveContext?: (iri: string) => unknown
}

/** How one field key resolved. */
export interface FieldResolution {
  /** The processor's definition of the key, when a term defines it. */
  definition?: TermDefinition
  /** The model term that supplied the definition, when this model declares it. */
  term?: IrTerm
  iri: string | null
  inverse: boolean
  /** How the key got its IRI: a term, `@vocab` alone, or nothing. */
  via: 'term' | 'vocab' | 'none'
}

/**
 * The model's active context: referenced contexts (when they can be read) and
 * then its own terms. `undefined` when the model's own context is itself
 * illegal, which is an L1 finding reported elsewhere.
 */
export function modelActiveContext(
  ir: Ir,
  options: ShapeResolveOptions = {},
): ActiveContext | undefined {
  try {
    return processContext(emptyContext(ir.base), buildContextDocument(ir)['@context'], {
      ...(options.resolveContext !== undefined
        ? { resolveContext: options.resolveContext }
        : { skipRemote: true }),
    })
  } catch {
    return undefined
  }
}

/**
 * The active context under a node typed with the shape's target class: the
 * type-scoped context of the class term applied, as expansion applies it.
 */
export function shapeContext(ir: Ir, shape: IrShape, base: ActiveContext): ActiveContext {
  const classTerm =
    shape.targetTermId !== undefined ? ir.terms.find((t) => t.id === shape.targetTermId) : undefined
  if (classTerm === undefined) return base
  const definition = base.terms.get(classTerm.key)
  if (definition?.localContext === undefined) return base
  try {
    return processContext(base, definition.localContext, {
      overrideProtected: true,
      propagate: definition.propagate ?? false,
      skipRemote: true,
    })
  } catch {
    return base
  }
}

/** Resolve one field key in a context, and name the model term behind it. */
export function resolveFieldKey(
  ir: Ir,
  shape: IrShape,
  context: ActiveContext,
  key: string,
): FieldResolution {
  const definition = context.terms.get(key)
  if (definition !== undefined) {
    return {
      definition,
      ...optionalTerm(modelTermFor(ir, shape, key, definition)),
      iri: definition.iri,
      inverse: definition.reverse,
      via: definition.iri === null ? 'none' : 'term',
    }
  }
  // No term: a compact or absolute IRI stands for itself, and anything else
  // expands against `@vocab` when there is one.
  const expanded = safeExpand(context, key)
  if (expanded !== null && expanded !== key && !expanded.startsWith('@')) {
    return { iri: expanded, inverse: false, via: 'vocab' }
  }
  if (expanded !== null && key.includes(':') && /^[a-z][a-z0-9+.-]*:/i.test(expanded)) {
    return { iri: expanded, inverse: false, via: 'vocab' }
  }
  return { iri: null, inverse: false, via: 'none' }
}

/**
 * The model term a processor definition came from. A key defined in the
 * target class's scoped context is that scoped term; otherwise it is the
 * model's top-level term of that key, if the model declares one — a key defined
 * only by a referenced context has no model term.
 */
function modelTermFor(
  ir: Ir,
  shape: IrShape,
  key: string,
  definition: TermDefinition,
): IrTerm | undefined {
  if (shape.targetTermId !== undefined) {
    const scoped = scopedTermsOf(ir, shape.targetTermId).find((t) => t.key === key)
    if (scoped !== undefined && sameMeaning(scoped, definition)) return scoped
  }
  const top = ir.terms.find((t) => t.key === key && t.scope === undefined)
  if (top !== undefined && sameMeaning(top, definition)) return top
  return undefined
}

function sameMeaning(term: IrTerm, definition: TermDefinition): boolean {
  if (term['@id'] === null) return definition.iri === null
  return term.iri === null || definition.iri === null || term.iri === definition.iri
}

function optionalTerm(term: IrTerm | undefined): { term?: IrTerm } {
  return term === undefined ? {} : { term }
}

function safeExpand(context: ActiveContext, value: string): string | null {
  try {
    return expandIri(context, value, { vocab: true })
  } catch {
    return null
  }
}

/**
 * Every shape with its field keys resolved. Pure: the shapes are copied, and
 * their order and the order of their fields are the IR's canonical ones.
 */
export function resolveShapeFields(ir: Ir, options: ShapeResolveOptions = {}): IrShape[] {
  if (ir.shapes.length === 0) return ir.shapes
  return resolveShapeFieldsIn(ir, modelActiveContext(ir, options))
}

/** As {@link resolveShapeFields}, against an active context the caller already built. */
export function resolveShapeFieldsIn(ir: Ir, base: ActiveContext | undefined): IrShape[] {
  return ir.shapes.map((shape) => {
    const context = base === undefined ? undefined : shapeContext(ir, shape, base)
    const fields: IrField[] = shape.fields.map((field) => {
      if (context === undefined) return { ...field }
      const resolved = resolveFieldKey(ir, shape, context, field.key)
      return {
        ...field,
        termId: resolved.term?.id ?? null,
        iri: resolved.iri === '@nest' ? null : resolved.iri,
        inverse: resolved.inverse,
      }
    })
    return { ...shape, fields }
  })
}
