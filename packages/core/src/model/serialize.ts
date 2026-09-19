/**
 * The canonical IR serializer: arrays ordered by element id, object keys sorted.
 *
 * The lockfile is deferred to milestone 3, but its two prerequisites are paid
 * for here. This is the first: a snapshot taken later is canonical without
 * changing the IR.
 *
 * @lat: [[emitters#Emitters#Change Management#Lockfile]]
 */
import type { Ir } from './ir.js'

/**
 * Canonical JSON of the resolved IR. Byte-identical on repeat, and unchanged by
 * reordering declarations in the model file.
 *
 * `source` is deliberately excluded: identity is the IRI, never the file path,
 * so where the file sits must not reach a canonical snapshot.
 */
export function serializeIr(ir: Ir): string {
  const canonical = {
    format: ir.format,
    namespace: { base: ir.namespace.base, prefix: ir.namespace.prefix },
    mode: ir.mode,
    ...(ir.vocab !== undefined ? { vocab: ir.vocab } : {}),
    ...(ir.base !== undefined ? { base: ir.base } : {}),
    prefixes: ir.prefixes,
    // `uses` has no element id; an entry's identity is the IRI it names.
    uses: [...ir.uses]
      .sort((a, b) => a.iri.localeCompare(b.iri))
      .map((u) => stripPointer(u)),
    terms: byElementId(ir.terms).map((t) => stripPointer(t)),
    examples: byElementId(ir.examples).map((e) => stripPointer(e)),
    views: byElementId(ir.views).map((v) => stripPointer(v)),
  }
  return `${canonicalJson(canonical)}\n`
}

function byElementId<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

function stripPointer<T extends { pointer?: unknown }>(item: T): Omit<T, 'pointer'> {
  const { pointer: _pointer, ...rest } = item
  return rest
}

/**
 * JSON with object keys sorted at every depth. Array order is the caller's
 * responsibility, because for `terms` it is meaningful (element id) and for a
 * `@container` list it is already normalised at resolution.
 */
export function canonicalJson(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeysDeep(value), null, indent)
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key]
    if (v === undefined) continue
    out[key] = sortKeysDeep(v)
  }
  return out
}
