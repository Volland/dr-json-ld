/**
 * Element ids. A term's identity is neither its JSON key nor its IRI: changing
 * the key breaks consumers while changing no triple, and changing the IRI
 * changes what the data asserts while every document still parses.
 *
 * @lat: [[metamodel#Metamodel#Stable Element IDs]]
 */
import { createHash, randomBytes } from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const ID_LENGTH = 6
export const ID_PATTERN = /^[a-z0-9]{6,12}$/

export function isElementId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

/** A fresh id. Collisions are checked against the ids already in the model. */
export function mintElementId(taken: ReadonlySet<string> = new Set()): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const bytes = randomBytes(ID_LENGTH)
    let id = ''
    for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[bytes[i]! % ALPHABET.length]
    // An id that is all digits reads as a number in unquoted YAML.
    if (/^[0-9]+$/.test(id)) continue
    if (!taken.has(id)) return id
  }
  throw new Error('could not mint an unused element id')
}

/** The separator between kind and key when deriving. Not a legal key character. */
const SEP = String.fromCharCode(0)

/**
 * The degraded mode: an id derived from the key. It survives a reload but not a
 * rename, and the IR records that it was derived so the lockfile can refuse it.
 */
export function deriveElementId(kind: string, key: string): string {
  const digest = createHash('sha256').update(`${kind}${SEP}${key}`).digest()
  let id = ''
  for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[digest[i]! % ALPHABET.length]
  return /^[0-9]+$/.test(id) ? `a${id.slice(1)}` : id
}
