/**
 * The intermediate representation. The durable asset: the surface syntax stays
 * swappable, the IR and the emitters do not.
 *
 * Arrays are ordered by element id and object keys are sorted when serialized,
 * so a canonical snapshot can be taken later without changing the IR — the
 * lockfile prerequisite paid for now.
 *
 * @lat: [[metamodel#Metamodel]]
 */
import type { JsonPointer } from '../source/pointer.js'

export type ProcessingMode = '1.1' | '1.0'

export type ContainerValue =
  | '@list'
  | '@set'
  | '@index'
  | '@id'
  | '@type'
  | '@language'
  | '@graph'

export const CONTAINER_VALUES: readonly ContainerValue[] = [
  '@list',
  '@set',
  '@index',
  '@id',
  '@type',
  '@language',
  '@graph',
]

/** A context as it may appear on a term: null, an IRI, an object, or an array. */
export type InlineContext =
  | null
  | string
  | Record<string, unknown>
  | Array<null | string | Record<string, unknown>>

export interface ElementIdentity {
  /** The element's identity. Both the key and the IRI are mutable attributes of it. */
  id: string
  /**
   * Whether the id was written into the file or derived from the key. A derived
   * id survives a reload but not a rename, which is why the lockfile refuses it.
   */
  idWritten: boolean
}

/** Every facet the metamodel can express, so the projection can carry them all. */
export interface TermFacets {
  '@id'?: string | null
  '@type'?: string | null
  '@container'?: ContainerValue[] | null
  '@language'?: string | null
  '@direction'?: 'ltr' | 'rtl' | null
  '@protected'?: boolean
  '@context'?: InlineContext
  '@nest'?: string
  '@reverse'?: string
  '@prefix'?: boolean
  '@index'?: string
}

/**
 * Where a scoped term lives: inside the map-valued `@context` of another term.
 * A top-level term has no scope.
 */
export interface IrTermScope {
  /** Element id of the term whose `@context` map holds this one. */
  parent: string
}

/**
 * A map-valued scoped context, as held by the term that carries it. Its term
 * definitions are terms in their own right, in {@link Ir.terms} with a
 * {@link IrTermScope} naming this term; what remains here are the context's
 * keyword entries (`@vocab`, `@propagate`, `@protected`, …), which are settings
 * of the context rather than terms.
 */
export interface IrScopedContext {
  settings: Record<string, unknown>
}

export interface IrTerm extends ElementIdentity, TermFacets {
  /** The JSON key consumers write. */
  key: string
  /** Present on a scoped term: the term whose `@context` map holds it. */
  scope?: IrTermScope
  /**
   * Present when this term's `@context` is a map. `@context` itself is then
   * absent from the facets, because the map is carried by the scoped terms and
   * these settings rather than as an opaque value.
   */
  scopedContext?: IrScopedContext
  /** The IRI the key maps to, after prefix and @vocab resolution. */
  iri: string | null
  /** Any construct the metamodel has not yet named. Reaches the context unchanged. */
  raw?: Record<string, unknown>
  note?: string
  /** Where in the model file this term is declared. */
  pointer: JsonPointer
}

export type ExampleExpectation =
  | { kind: 'positive'; maxSeverity: 'info' | 'warning' | 'error' }
  | { kind: 'negative'; rules: string[] }

export interface IrExample extends ElementIdentity {
  path: string
  note?: string
  expect: ExampleExpectation
  pointer: JsonPointer
}

export interface IrUses {
  iri: string
  integrity?: string
  note?: string
  pointer: JsonPointer
}

export interface IrView extends ElementIdentity {
  name: string
  note?: string
  /** Term keys this view shows. */
  terms: string[]
  /** Shape names this view shows. Absent when the view names none. */
  shapes?: string[]
  pointer: JsonPointer
}

/**
 * What a field's values must be. The forms that name something carry both what
 * the author wrote and what it resolved to.
 */
export type IrRange =
  | { kind: 'iri' }
  | { kind: 'node' }
  | { kind: 'literal' }
  | { kind: 'langString' }
  | { kind: 'datatype'; datatype: string; iri: string }
  | { kind: 'class'; class: string; iri: string | null }
  /** `shapeId` is the element id of the named shape; `null` when it names none. */
  | { kind: 'shape'; shape: string; shapeId: string | null }

/**
 * One field of a shape. It has no element id of its own: its identity is its
 * shape plus the term its key resolves to, which is what makes a term rename
 * carry the field with it.
 */
export interface IrField {
  /** The JSON key a document uses under the target class. */
  key: string
  /**
   * The element id of the model term the key resolves to under the target
   * class, or `null` when it resolves through `@vocab`, a referenced context, or
   * not at all.
   */
  termId: string | null
  /** The property the field constrains. `null` when the key resolves to nothing. */
  iri: string | null
  /** Whether the key names a `@reverse` term, so the field constrains the inverse. */
  inverse: boolean
  /** Minimum number of values. Absent means zero. */
  min?: number
  /** Maximum number of values. Absent means unbounded. */
  max?: number
  range?: IrRange
  note?: string
  pointer: JsonPointer
}

/**
 * Class-level structure a `@context` cannot express: which fields a class has,
 * how many values each takes, what they must be, and whether the class is
 * closed.
 */
export interface IrShape extends ElementIdentity {
  /** The key under `shapes:`. */
  name: string
  /**
   * The target class as written: a term key or an IRI. Absent on a shape that
   * applies only where a field's range names it, such as an untyped nested node.
   */
  target?: string
  /** The class IRI the target resolves to; `null` without a target or when it names none. */
  targetIri: string | null
  /** The element id of the class term, when the target names one. */
  targetTermId?: string
  closed: boolean
  note?: string
  fields: IrField[]
  pointer: JsonPointer
}

export interface IrNamespace {
  prefix: string
  base: string
}

export interface Ir {
  /** The model format version this file declares. */
  format: string
  /**
   * The project this model names, when it names one. A model that declares no
   * project resolves, emits and validates exactly as it did before projects
   * existed — this is additive, never required.
   */
  project?: string
  namespace: IrNamespace
  mode: ProcessingMode
  vocab?: string
  base?: string
  /**
   * Prefixes the model declared under `prefixes:`. The namespace prefix is
   * *not* in here: it is the model's identity rather than something it declared,
   * and emitting it unasked would add a term the author never wrote.
   * Use {@link resolutionPrefixes} where both are needed.
   */
  prefixes: Record<string, string>
  uses: IrUses[]
  terms: IrTerm[]
  /** The shapes layer. Empty when the model declares no shapes. */
  shapes: IrShape[]
  examples: IrExample[]
  views: IrView[]
  /** The model file this IR was resolved from. Not part of the canonical form. */
  source: string
}

/** Elements whose id was derived rather than written. */
export function derivedIdElements(ir: Ir): Array<{ kind: string; id: string; key: string }> {
  const out: Array<{ kind: string; id: string; key: string }> = []
  for (const t of ir.terms) {
    if (!t.idWritten) out.push({ kind: 'term', id: t.id, key: termPath(ir, t) })
  }
  for (const s of ir.shapes ?? []) if (!s.idWritten) out.push({ kind: 'shape', id: s.id, key: s.name })
  for (const e of ir.examples) if (!e.idWritten) out.push({ kind: 'example', id: e.id, key: e.path })
  for (const v of ir.views) if (!v.idWritten) out.push({ kind: 'view', id: v.id, key: v.name })
  return out
}

/** Declared prefixes plus the namespace prefix, which is what resolution uses. */
export function resolutionPrefixes(ir: Ir): Record<string, string> {
  const out = { ...ir.prefixes }
  if (ir.namespace.prefix && ir.namespace.base) out[ir.namespace.prefix] = ir.namespace.base
  return out
}

/**
 * The top-level term with this key. A scoped term with the same key is a
 * different term, reached through {@link scopedTermsOf}.
 */
export function findTerm(ir: Ir, key: string): IrTerm | undefined {
  return ir.terms.find((t) => t.key === key && t.scope === undefined)
}

/** Terms declared directly in the model's `terms:` map, in declaration order. */
export function topLevelTerms(ir: Ir): IrTerm[] {
  return ir.terms.filter((t) => t.scope === undefined)
}

/** The scoped terms held by one term's `@context` map, in declaration order. */
export function scopedTermsOf(ir: Ir, parentId: string): IrTerm[] {
  return ir.terms.filter((t) => t.scope?.parent === parentId)
}

/**
 * The chain of keys from the top level down to this term, for messages: a
 * scoped `name` under `publisher` reads as `publisher › name`.
 */
export function termPath(ir: Ir, term: IrTerm): string {
  const keys = [term.key]
  let current = term
  const seen = new Set<string>([term.id])
  while (current.scope !== undefined) {
    const parent = ir.terms.find((t) => t.id === current.scope!.parent)
    if (parent === undefined || seen.has(parent.id)) break
    seen.add(parent.id)
    keys.unshift(parent.key)
    current = parent
  }
  return keys.join(' › ')
}

export function findShape(ir: Ir, name: string): IrShape | undefined {
  return (ir.shapes ?? []).find((shape) => shape.name === name)
}
