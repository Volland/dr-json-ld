/**
 * Shared types for the processor: the active context, term definitions, the
 * instrumentation hook that serves both provenance and the trace, and the
 * errors the specification defines.
 *
 * @lat: [[processing#Processing]]
 */
import type { JsonPointer } from '../source/pointer.js'

export type ContainerValue =
  | '@list'
  | '@set'
  | '@index'
  | '@id'
  | '@type'
  | '@language'
  | '@graph'
  | '@none'

/** One entry of the active context. */
export interface TermDefinition {
  /** The term this definition is for. */
  term: string
  /** The IRI the term maps to. `null` means the term is explicitly dropped. */
  iri: string | null
  /** `@type` coercion: an IRI, `@id`, `@vocab`, `@json`, or `@none`. */
  typeMapping?: string
  /** `@language`, including an explicit `null` which cancels a default. */
  languageMapping?: string | null
  hasLanguageMapping: boolean
  directionMapping?: 'ltr' | 'rtl' | null
  hasDirectionMapping: boolean
  container: ContainerValue[]
  /** Whether the term was defined with `@reverse`. */
  reverse: boolean
  protected: boolean
  /** Whether the term may be used as a compact-IRI prefix. */
  prefix: boolean
  /** The raw scoped context, applied lazily where it takes effect. */
  localContext?: unknown
  /** The context that was active when the scoped context was recorded. */
  baseContext?: ActiveContext
  /** `@propagate` on the scoped context. Defaults differ for type and property scopes. */
  propagate?: boolean
  nestValue?: string
  indexMapping?: string
  /** Where in the source the definition came from, when it came from a model. */
  pointer?: JsonPointer
}

export interface ActiveContext {
  terms: Map<string, TermDefinition>
  baseIri?: string
  /** The original base, restored by `@base: null`. */
  originalBaseIri?: string
  vocab?: string
  defaultLanguage?: string | null
  defaultDirection?: 'ltr' | 'rtl' | null
  /**
   * The context a non-propagating scoped context reverts to on entering a new
   * node object. Set only when `@propagate` is false, which is what keeps it
   * distinct from "the context this one was built from".
   */
  previousContext?: ActiveContext
  /** Whether this context propagates into nested node objects. */
  propagate: boolean
}

export function emptyContext(baseIri?: string): ActiveContext {
  return {
    terms: new Map(),
    ...(baseIri !== undefined ? { baseIri, originalBaseIri: baseIri } : {}),
    propagate: true,
  }
}

export function cloneContext(context: ActiveContext): ActiveContext {
  return {
    ...context,
    terms: new Map(context.terms),
  }
}

/** A JSON-LD error, carrying the code the specification names. */
export class JsonLdError extends Error {
  readonly code: string
  readonly pointer: JsonPointer | undefined

  constructor(code: string, message: string, pointer?: JsonPointer) {
    super(`${code}: ${message}`)
    this.name = 'JsonLdError'
    this.code = code
    this.pointer = pointer
  }
}

/**
 * The instrumentation points. Provenance and the trace are emitted from exactly
 * these, so the two cannot disagree about what happened.
 *
 * @lat: [[processing#Processing#Trace]]
 */
export type TraceEvent =
  | { kind: 'term-lookup'; term: string; found: boolean; iri: string | null; pointer: JsonPointer }
  | { kind: 'iri-resolution'; input: string; output: string; relative: boolean; vocab: boolean; pointer: JsonPointer }
  | {
      kind: 'active-context-change'
      reason: 'document' | 'type-scoped' | 'property-scoped' | 'revert'
      detail: string
      pointer: JsonPointer
    }
  | { kind: 'value-coercion'; term: string; coercion: string; pointer: JsonPointer }
  | { kind: 'key-dropped'; key: string; reason: 'no-term' | 'keyword-like' | 'null-mapping'; pointer: JsonPointer }
  | { kind: 'blank-node-minted'; id: string; pointer: JsonPointer }

/** What a caller installs to observe the algorithm. */
export interface Instrumentation {
  onEvent(event: TraceEvent): void
}

export const NO_INSTRUMENTATION: Instrumentation = { onEvent() {} }
