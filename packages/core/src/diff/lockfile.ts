/**
 * Reading a lockfile back into an IR.
 *
 * This is what makes comparing two *past* versions possible. A lockfile beside
 * the model only ever describes the working tree, so it can compare the present
 * against one past, never two pasts — which is why the lockfile lives inside the
 * version instead.
 *
 * @lat: [[emitters#Emitters#Change Management#Lockfile]]
 */
import type { Ir } from '../model/ir.js'
import { serializeIr } from '../model/serialize.js'
import { LOCKFILE } from '../version/create.js'
import type { VersionStore } from '../version/store.js'

export class LockfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LockfileError'
  }
}

/**
 * Parse a lockfile.
 *
 * The serializer drops `pointer` and `source`, so what comes back is an IR
 * without positions — enough to compare, and deliberately not enough to pretend
 * a finding could be located in a file nobody has.
 */
export function parseLockfile(text: string): Ir {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new LockfileError(
      `the lockfile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LockfileError('the lockfile does not contain a mapping')
  }
  const raw = parsed as Record<string, unknown>
  for (const key of ['namespace', 'terms']) {
    if (raw[key] === undefined) {
      throw new LockfileError(`the lockfile records no \`${key}\``)
    }
  }
  return {
    ...(raw as unknown as Ir),
    // Neither survives serialization, and neither should: a version must not
    // record where the model happened to sit.
    source: raw['source'] === undefined ? '' : String(raw['source']),
  }
}

/** The lockfile of a version, checked against its manifest on the way out. */
export function lockfileOf(store: VersionStore, versionId: string): Ir {
  return parseLockfile(store.readFile(versionId, LOCKFILE))
}

/** Round-trip check: a lockfile re-serializes to itself. */
export function isCanonical(text: string): boolean {
  try {
    return serializeIr(parseLockfile(text)) === text
  } catch {
    return false
  }
}

export { LOCKFILE }
