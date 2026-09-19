/**
 * Aliases: movable human names over immutable versions.
 *
 * The alias file is the one mutable thing in the version store, and no version
 * references it. That asymmetry is the whole point — if a version recorded the
 * aliases pointing at it, retargeting one would mutate the version, and
 * immutability and human names would be in permanent conflict.
 *
 * It also means the answer to "what does `stable` mean" lives in exactly one
 * place, and that place is diffable.
 *
 * @lat: [[emitters#Emitters#Change Management]]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { canonicalJson } from '../model/serialize.js'
import { isVersionId } from './manifest.js'
import { VersionError, type VersionStore } from './store.js'

export const ALIAS_FILE = 'aliases.json'
export const ALIAS_FORMAT_VERSION = '1'

/** A name a human chose. Must not look like a version identity. */
export const ALIAS_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface AliasDocument {
  aliases: string
  /** Alias name to version identity. */
  targets: Record<string, string>
}

export function emptyAliases(): AliasDocument {
  return { aliases: ALIAS_FORMAT_VERSION, targets: {} }
}

export class AliasError extends Error {
  readonly alias: string | undefined
  constructor(message: string, alias?: string) {
    super(message)
    this.name = 'AliasError'
    this.alias = alias
  }
}

/**
 * Reads and writes the alias file. Every mutation rewrites the whole file, which
 * is cheap and keeps the file canonically ordered so a retarget is a one-line
 * diff.
 */
export class AliasStore {
  readonly file: string

  constructor(directory: string) {
    this.file = join(resolve(directory), ALIAS_FILE)
  }

  read(): AliasDocument {
    if (!existsSync(this.file)) return emptyAliases()
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as AliasDocument
      if (parsed === null || typeof parsed !== 'object' || typeof parsed.targets !== 'object') {
        throw new Error('the alias file does not record a target map')
      }
      return { aliases: parsed.aliases ?? ALIAS_FORMAT_VERSION, targets: parsed.targets ?? {} }
    } catch (error) {
      throw new AliasError(
        `the alias file at ${this.file} is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private write(document: AliasDocument): void {
    mkdirSync(dirname(this.file), { recursive: true })
    // Sorted, so the file reads the same however the aliases were created.
    const targets: Record<string, string> = {}
    for (const name of Object.keys(document.targets).sort()) {
      targets[name] = document.targets[name]!
    }
    writeFileSync(this.file, `${canonicalJson({ ...document, targets })}\n`)
  }

  /** The version an alias points at, or `undefined` when there is no such alias. */
  target(name: string): string | undefined {
    return this.read().targets[name]
  }

  list(): Array<{ name: string; versionId: string }> {
    const { targets } = this.read()
    return Object.keys(targets)
      .sort()
      .map((name) => ({ name, versionId: targets[name]! }))
  }

  /**
   * Point an alias at a version, creating it or retargeting it.
   *
   * Nothing inside any version is touched: this writes one file, and that file
   * is not part of any version.
   */
  set(name: string, versionId: string, store: VersionStore): void {
    assertAliasName(name)
    if (!isVersionId(versionId)) {
      throw new AliasError(`"${versionId}" is not a version identity`, name)
    }
    if (!store.exists(versionId)) {
      throw new AliasError(
        `the alias "${name}" would point at ${versionId}, and no such version exists`,
        name,
      )
    }
    const document = this.read()
    document.targets[name] = versionId
    this.write(document)
  }

  /** Rename an alias: the same target under a new name. */
  rename(from: string, to: string): void {
    assertAliasName(to)
    const document = this.read()
    const target = document.targets[from]
    if (target === undefined) {
      throw new AliasError(`there is no alias named "${from}"`, from)
    }
    if (document.targets[to] !== undefined) {
      throw new AliasError(`an alias named "${to}" already exists`, to)
    }
    delete document.targets[from]
    document.targets[to] = target
    this.write(document)
  }

  delete(name: string): void {
    const document = this.read()
    if (document.targets[name] === undefined) {
      throw new AliasError(`there is no alias named "${name}"`, name)
    }
    delete document.targets[name]
    this.write(document)
  }

  /**
   * Resolve a name that may be an alias or a version identity.
   *
   * An identity wins, because an identity is unambiguous; an alias that looked
   * like one would be refused at creation, so there is no case where both match.
   */
  resolve(nameOrId: string, store: VersionStore): string {
    if (isVersionId(nameOrId) && store.exists(nameOrId)) return nameOrId
    const target = this.target(nameOrId)
    if (target === undefined) {
      throw new AliasError(
        `"${nameOrId}" is neither a version in this store nor an alias of one`,
        nameOrId,
      )
    }
    if (!store.exists(target)) {
      throw new AliasError(
        `the alias "${nameOrId}" points at ${target}, and that version is not present`,
        nameOrId,
      )
    }
    return target
  }

  /** Aliases pointing at a version that is not present. */
  dangling(store: VersionStore): Array<{ name: string; versionId: string }> {
    return this.list().filter((entry) => !store.exists(entry.versionId))
  }
}

/**
 * An alias may not be shaped like a version identity: a name that could be
 * either would make `stable` and a hash indistinguishable at a path, and the
 * tool would have to guess.
 */
export function assertAliasName(name: string): void {
  if (!ALIAS_NAME_PATTERN.test(name)) {
    throw new AliasError(
      `"${name}" is not a usable alias name. Use letters, digits, dot, dash or underscore, starting with a letter or digit.`,
      name,
    )
  }
  if (isVersionId(name)) {
    throw new AliasError(
      `"${name}" has the shape of a version identity, so it cannot be an alias — a path using it would be ambiguous.`,
      name,
    )
  }
}

export { VersionError }
