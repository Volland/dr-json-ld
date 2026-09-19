/**
 * The manifest: what makes a version evidence rather than a directory.
 *
 * It lists every file with its hash, and carries a hash over its own canonical
 * bytes. Without that self-hash, editing a file *and* its entry would verify
 * cleanly — the self-hash is the difference between a checksum and a table of
 * contents.
 *
 * A hash detects accident and casual tampering. It is not a signature, and the
 * field is called `integrity` rather than `signature` so nobody reads it as one.
 *
 * @lat: [[emitters#Emitters#Change Management]]
 */
import { createHash } from 'node:crypto'

import { canonicalJson } from '../model/serialize.js'

export const MANIFEST_FILE = 'manifest.json'
export const MANIFEST_FORMAT_VERSION = '1'

/** `sha256-` plus the base64 digest, the shape the vendored contexts already use. */
export function integrityOf(content: string | Buffer): string {
  return `sha256-${createHash('sha256').update(content).digest('base64')}`
}

export interface ManifestEntry {
  /** Relative to the version directory, with `/` separators on every platform. */
  path: string
  integrity: string
  bytes: number
}

/** What a version records about where it came from. */
export interface VersionLineage {
  /** The version this one was cloned from, if any. */
  clonedFrom?: string
  /** The version this one supersedes, if any. */
  predecessor?: string
}

/** The manifest body — everything the self-hash is taken over. */
export interface ManifestBody {
  manifest: string
  /** The project that created this version, when there was one. */
  project?: string
  /** The model name, or its file name when there is no project. */
  model: string
  /**
   * The version's identity: the hash over its inputs. Recorded in the manifest
   * rather than derived from it, because the artifacts the manifest hashes name
   * this identity — deriving it from the manifest would not converge.
   */
  id: string
  /** ISO 8601, to the second. The moment the version was created. */
  created: string
  lineage: VersionLineage
  files: ManifestEntry[]
}

/** The manifest as written: the body plus the hash over its canonical bytes. */
export interface Manifest extends ManifestBody {
  /**
   * The hash of the canonical body. It is what verification checks the manifest
   * against; it is deliberately *not* the version's identity, because the body
   * hashes artifacts that name that identity.
   */
  integrity: string
}

/** One input to a version's identity: something a human authored. */
export interface VersionInput {
  path: string
  content: string
}

/**
 * The version's identity: a hash over its inputs — the model as written, the
 * lockfile, and the examples. The generated artifacts are excluded because they
 * are a pure function of these, and because they name the identity being
 * computed.
 *
 * @lat: [[emitters#Emitters#Change Management]]
 */
export function identityOf(inputs: readonly VersionInput[], salt: string): string {
  const canonical = [...inputs]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((input) => `${input.path}\u0000${integrityOf(input.content)}`)
    .join('\n')
  return idFromIntegrity(integrityOf(`${salt}\n${canonical}\n`))
}

/**
 * The canonical bytes the self-hash is taken over: the body with keys sorted at
 * every depth and files ordered by path, and no `integrity` field — a hash
 * cannot cover itself.
 */
export function canonicalBody(body: ManifestBody): string {
  const ordered: ManifestBody = {
    manifest: body.manifest,
    ...(body.project !== undefined ? { project: body.project } : {}),
    model: body.model,
    id: body.id,
    created: body.created,
    lineage: body.lineage,
    files: [...body.files].sort((a, b) => a.path.localeCompare(b.path)),
  }
  return `${canonicalJson(ordered)}\n`
}

export function sealManifest(body: ManifestBody): Manifest {
  return { ...body, integrity: integrityOf(canonicalBody(body)) }
}

/** The bytes written to `manifest.json`. */
export function renderManifest(manifest: Manifest): string {
  return `${canonicalJson(manifest)}\n`
}

/** The identity a manifest records. */
export function versionIdOf(manifest: Manifest): string {
  return manifest.id
}

/**
 * An identity is 16 characters of a base64 digest, path-safe and lowercased.
 *
 * That is 80 bits over content already committed to a repository — enough that
 * an accidental collision will not happen, and short enough that a human can
 * read a directory listing.
 */
export const VERSION_ID_LENGTH = 16

export function idFromIntegrity(integrity: string): string {
  const digest = integrity.replace(/^sha256-/, '').replace(/=+$/, '')
  // Base64 contains `+` and `/`, neither of which belongs in a path segment.
  const safe = digest.replace(/\+/g, 'a').replace(/\//g, 'b')
  return safe.slice(0, VERSION_ID_LENGTH).toLowerCase()
}

/** Whether a string has the shape of a version identity. */
export const VERSION_ID_PATTERN = new RegExp(`^[a-z0-9]{${VERSION_ID_LENGTH}}$`)

export function isVersionId(value: string): boolean {
  return VERSION_ID_PATTERN.test(value)
}

export function parseManifest(text: string): Manifest {
  const parsed = JSON.parse(text) as Manifest
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('the manifest is not a mapping')
  }
  if (typeof parsed.integrity !== 'string') {
    throw new Error('the manifest records no integrity hash')
  }
  if (!Array.isArray(parsed.files)) {
    throw new Error('the manifest records no file list')
  }
  return parsed
}

/** Recompute the self-hash and compare it with the one recorded. */
export function manifestSelfHashMatches(manifest: Manifest): boolean {
  const { integrity, ...body } = manifest
  return integrityOf(canonicalBody(body as ManifestBody)) === integrity
}
