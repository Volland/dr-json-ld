/**
 * The provenance envelope.
 *
 * Every node, value and dropped key produced by expansion is wrapped with the
 * JSON Pointer of the input that produced it. Correlating input and output
 * afterwards degrades exactly at `@nest`, type-scoped contexts, value objects
 * and `@included` — which is precisely where a user needs the pointer.
 *
 * @lat: [[processing#Processing#Source Mapping]]
 */
import type { JsonPointer } from '../source/pointer.js'

/** A value carrying where it came from. */
export interface Enveloped<T = unknown> {
  value: T
  /** The JSON Pointer of the input node that produced this. */
  pointer: JsonPointer
}

const ENVELOPE = Symbol.for('jsonld-modeler.provenance')

/**
 * The envelope is a side table rather than a wrapper object, so the expanded
 * value is an ordinary JSON structure and stripping the envelope is free.
 * Storing it on the object under a symbol keeps it invisible to `JSON.stringify`
 * and to any deep-equality check a caller runs.
 */
export type ProvenanceCarrier = object & { [ENVELOPE]?: JsonPointer }

export function tag<T extends object>(value: T, pointer: JsonPointer): T {
  Object.defineProperty(value, ENVELOPE, {
    value: pointer,
    enumerable: false,
    configurable: true,
    writable: true,
  })
  return value
}

export function pointerOf(value: unknown): JsonPointer | undefined {
  if (value === null || typeof value !== 'object') return undefined
  return (value as ProvenanceCarrier)[ENVELOPE]
}

/**
 * The public result: bare expanded JSON, equal to what a conformant processor
 * returns. The envelope lives on non-enumerable symbol properties, so this is a
 * structural clone rather than a filter — proving no tool-specific key can leak.
 */
export function strip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Walk every enveloped node in an expanded result, so a caller can check that
 * every pointer resolves.
 */
export function collectPointers(value: unknown, out: JsonPointer[] = []): JsonPointer[] {
  if (value === null || typeof value !== 'object') return out
  const pointer = pointerOf(value)
  if (pointer !== undefined) out.push(pointer)
  if (Array.isArray(value)) {
    for (const item of value) collectPointers(item, out)
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectPointers(item, out)
    }
  }
  return out
}
