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

export interface IrTerm extends ElementIdentity, TermFacets {
  /** The JSON key consumers write. */
  key: string
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
  examples: IrExample[]
  views: IrView[]
  /** The model file this IR was resolved from. Not part of the canonical form. */
  source: string
}

/** Terms whose id was derived rather than written. */
export function derivedIdElements(ir: Ir): Array<{ kind: string; id: string; key: string }> {
  const out: Array<{ kind: string; id: string; key: string }> = []
  for (const t of ir.terms) if (!t.idWritten) out.push({ kind: 'term', id: t.id, key: t.key })
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

export function findTerm(ir: Ir, key: string): IrTerm | undefined {
  return ir.terms.find((t) => t.key === key)
}
