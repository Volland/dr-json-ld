/**
 * The public processor interface: expansion and compaction over a resolved
 * model, plus the pointer-to-position resolver that turns provenance into
 * something an editor can show.
 *
 * @lat: [[processing#Processing#Source Mapping]]
 */
import type { Ir } from '../model/ir.js'
import type { Position, SourceIndex } from '../source/index-file.js'
import { pointerResolves, type JsonPointer } from '../source/pointer.js'
import { processContext } from './active-context.js'
import { collectPointers, strip } from './envelope.js'
import { expand, type ExpandOptions, type Observation } from './expand.js'
import { emptyContext, type ActiveContext, type Instrumentation } from './types.js'
import { buildContextDocument } from '../emit/context-document.js'

export interface ProcessorOptions {
  /** Reads a vendored context. Offline; there is no fetch on this path. */
  resolveContext?: (iri: string) => unknown
  instrumentation?: Instrumentation
  base?: string
}

/** The active context a model's own terms and referenced contexts produce. */
export function activeContextForModel(ir: Ir, options: ProcessorOptions = {}): ActiveContext {
  const document = buildContextDocument(ir)
  return processContext(emptyContext(options.base ?? ir.base), document['@context'], {
    resolveContext: options.resolveContext,
    ...(options.instrumentation !== undefined
      ? { instrumentation: options.instrumentation }
      : {}),
  })
}

export interface ExpandDocumentResult {
  /** With provenance attached. */
  expanded: unknown[]
  observations: Observation[]
}

export function expandDocument(
  input: unknown,
  active: ActiveContext,
  options: ExpandOptions = {},
): ExpandDocumentResult {
  return expand(input, active, options)
}

/**
 * The public expansion result: plain JSON-LD, equal to what a conformant
 * processor returns, with no pointer, envelope or tool-specific key in it.
 */
export function bareExpanded(result: { expanded: unknown[] }): unknown[] {
  return strip(result.expanded)
}

/** Every pointer an expansion produced, for the property test and the canvas. */
export function pointersIn(result: { expanded: unknown[] }): JsonPointer[] {
  return collectPointers(result.expanded)
}

/** Whether every pointer an expansion produced names a node in the input. */
export function everyPointerResolves(input: unknown, result: { expanded: unknown[] }): boolean {
  return pointersIn(result).every((p) => pointerResolves(input, p))
}

/** The pointers that do not resolve, for a failure message worth reading. */
export function unresolvedPointers(
  input: unknown,
  result: { expanded: unknown[] },
): JsonPointer[] {
  return pointersIn(result).filter((p) => !pointerResolves(input, p))
}

/**
 * Resolve a pointer to a line and column in the file the user edited. This is
 * the whole reason the pointer is carried.
 */
export function resolvePointer(source: SourceIndex, pointer: JsonPointer): Position {
  return source.positionOf(pointer)
}
