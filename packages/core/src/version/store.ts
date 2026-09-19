/**
 * The version store: immutable, content-addressed snapshots of a model.
 *
 * Every write goes through {@link VersionStore.create}, which is the only method
 * that writes inside the versions directory and which refuses to touch a version
 * that already exists. Immutability is enforced here rather than relied upon.
 *
 * @lat: [[emitters#Emitters#Change Management#Lockfile]]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { derivedIdElements, type Ir } from '../model/ir.js'
import {
  canonicalBody,
  integrityOf,
  isVersionId,
  MANIFEST_FILE,
  MANIFEST_FORMAT_VERSION,
  manifestSelfHashMatches,
  parseManifest,
  renderManifest,
  sealManifest,
  versionIdOf,
  type Manifest,
  type ManifestBody,
  type ManifestEntry,
  type VersionLineage,
} from './manifest.js'

export class VersionError extends Error {
  readonly versionId: string | undefined
  constructor(message: string, versionId?: string) {
    super(message)
    this.name = 'VersionError'
    this.versionId = versionId
  }
}

/** One file going into a version. */
export interface VersionFile {
  /** Relative to the version root, `/`-separated. */
  path: string
  content: string
}

export interface CreateVersionInput {
  /** The model name, or its file name when there is no project. */
  model: string
  project?: string
  /**
   * The identity, computed by the caller from the version's *inputs* — see
   * `identityOf`. It is passed in rather than derived here because the artifacts
   * in `files` name it, so deriving it from them would not converge.
   */
  id: string
  files: VersionFile[]
  lineage?: VersionLineage
  /** Overridden in tests so a version's identity does not depend on the clock. */
  created?: string
}

export interface CreateVersionResult {
  id: string
  manifest: Manifest
  /** True when a version with this identity already existed and nothing was written. */
  alreadyExisted: boolean
  directory: string
}

export type VerifyProblem =
  | { kind: 'manifest-missing'; message: string }
  | { kind: 'manifest-unreadable'; message: string }
  | { kind: 'manifest-self-hash'; message: string }
  | { kind: 'file-missing'; path: string; message: string }
  | { kind: 'file-hash'; path: string; expected: string; actual: string; message: string }
  | { kind: 'file-unexpected'; path: string; message: string }
  | { kind: 'lineage-missing'; versionId: string; message: string }

export interface VerifyResult {
  id: string
  ok: boolean
  /** Problems with this version's own content. Any of these means `ok` is false. */
  problems: VerifyProblem[]
  /**
   * Problems with what the version *refers to*. A missing predecessor is
   * reported, but the version's own content is intact, so it still verifies.
   */
  lineageProblems: VerifyProblem[]
  manifest?: Manifest
}

export class VersionStore {
  readonly directory: string

  constructor(directory: string) {
    this.directory = resolve(directory)
  }

  pathFor(id: string): string {
    if (!isVersionId(id)) {
      throw new VersionError(`"${id}" is not a version identity`, id)
    }
    return join(this.directory, id)
  }

  exists(id: string): boolean {
    return isVersionId(id) && existsSync(join(this.directory, id, MANIFEST_FILE))
  }

  /** Every version present, sorted, so a listing is deterministic. */
  list(): string[] {
    if (!existsSync(this.directory)) return []
    return readdirSync(this.directory)
      .filter((entry) => isVersionId(entry))
      .filter((entry) => existsSync(join(this.directory, entry, MANIFEST_FILE)))
      .sort()
  }

  /**
   * Create a version from a set of files.
   *
   * The identity is derived from the manifest, so creating a version from
   * unchanged content yields the identity that already exists — and nothing is
   * written, because writing into an existing version is exactly what the store
   * refuses to do.
   */
  create(input: CreateVersionInput): CreateVersionResult {
    const files: ManifestEntry[] = input.files
      .map((file) => ({
        path: normalizePath(file.path),
        integrity: integrityOf(file.content),
        bytes: Buffer.byteLength(file.content, 'utf8'),
      }))
      .sort((a, b) => a.path.localeCompare(b.path))

    for (const entry of files) {
      if (entry.path === MANIFEST_FILE) {
        throw new VersionError(`a version's files may not include ${MANIFEST_FILE}`)
      }
      if (entry.path.startsWith('..') || entry.path.includes(`..${sep}`)) {
        throw new VersionError(`"${entry.path}" would escape the version directory`)
      }
    }

    if (!isVersionId(input.id)) {
      throw new VersionError(`"${input.id}" is not a well-formed version identity`, input.id)
    }

    const body: ManifestBody = {
      manifest: MANIFEST_FORMAT_VERSION,
      ...(input.project !== undefined ? { project: input.project } : {}),
      model: input.model,
      id: input.id,
      // Truncated to the second: a version's identity must not depend on how
      // fast the machine was.
      created: input.created ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      lineage: input.lineage ?? {},
      files,
    }
    const manifest = sealManifest(body)
    const id = versionIdOf(manifest)
    const directory = join(this.directory, id)

    if (existsSync(join(directory, MANIFEST_FILE))) {
      return { id, manifest, alreadyExisted: true, directory }
    }

    mkdirSync(directory, { recursive: true })
    for (const file of input.files) {
      const target = join(directory, normalizePath(file.path))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content)
    }
    writeFileSync(join(directory, MANIFEST_FILE), renderManifest(manifest))

    return { id, manifest, alreadyExisted: false, directory }
  }

  /**
   * The guard that makes immutability real: every path that would write inside a
   * version goes through here first.
   */
  assertWritable(id: string): void {
    if (existsSync(join(this.directory, id, MANIFEST_FILE))) {
      throw new VersionError(
        `version ${id} already exists and a version is never altered. Create a new version instead.`,
        id,
      )
    }
  }

  readManifest(id: string): Manifest {
    const path = join(this.pathFor(id), MANIFEST_FILE)
    if (!existsSync(path)) {
      throw new VersionError(`version ${id} has no manifest`, id)
    }
    try {
      return parseManifest(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new VersionError(
        `the manifest of version ${id} is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
        id,
      )
    }
  }

  /**
   * The manifest's bytes as written. Published alongside the artifacts so a
   * consumer holding only the tree can verify what they fetched.
   */
  readManifestText(id: string): string {
    const path = join(this.pathFor(id), MANIFEST_FILE)
    if (!existsSync(path)) {
      throw new VersionError(`version ${id} has no manifest`, id)
    }
    return readFileSync(path, 'utf8')
  }

  /** Read one file from a version, after checking it against the manifest. */
  readFile(id: string, path: string): string {
    const manifest = this.readManifest(id)
    const normalized = normalizePath(path)
    const entry = manifest.files.find((f) => f.path === normalized)
    if (!entry) {
      throw new VersionError(`version ${id} contains no file at ${normalized}`, id)
    }
    const full = join(this.pathFor(id), normalized)
    if (!existsSync(full)) {
      throw new VersionError(`version ${id} is missing the file ${normalized}`, id)
    }
    const content = readFileSync(full, 'utf8')
    const actual = integrityOf(content)
    if (actual !== entry.integrity) {
      throw new VersionError(
        `${normalized} in version ${id} does not match the manifest. Recorded ${entry.integrity}, found ${actual}.`,
        id,
      )
    }
    return content
  }

  /**
   * Verify a version: every file against its recorded hash, every recorded file
   * present, no unexpected file, and the manifest against its own hash.
   */
  verify(id: string): VerifyResult {
    const problems: VerifyProblem[] = []
    const lineageProblems: VerifyProblem[] = []
    const directory = join(this.directory, id)
    const manifestPath = join(directory, MANIFEST_FILE)

    if (!existsSync(manifestPath)) {
      return {
        id,
        ok: false,
        problems: [{ kind: 'manifest-missing', message: `version ${id} has no manifest` }],
        lineageProblems,
      }
    }

    let manifest: Manifest
    try {
      manifest = parseManifest(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      return {
        id,
        ok: false,
        problems: [
          {
            kind: 'manifest-unreadable',
            message: `the manifest of version ${id} is unreadable: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        lineageProblems,
      }
    }

    // The self-hash first: if the manifest was edited to match a hand-edited
    // file, every per-file check below would pass and this is the only thing
    // that catches it.
    if (!manifestSelfHashMatches(manifest)) {
      problems.push({
        kind: 'manifest-self-hash',
        message: `the manifest of version ${id} does not match its own recorded hash. Recorded ${
          manifest.integrity
        }, found ${integrityOf(canonicalBody(stripIntegrity(manifest)))}.`,
      })
    }

    for (const entry of manifest.files) {
      const full = join(directory, entry.path)
      if (!existsSync(full)) {
        problems.push({
          kind: 'file-missing',
          path: entry.path,
          message: `version ${id} is missing ${entry.path}, which its manifest records`,
        })
        continue
      }
      const actual = integrityOf(readFileSync(full, 'utf8'))
      if (actual !== entry.integrity) {
        problems.push({
          kind: 'file-hash',
          path: entry.path,
          expected: entry.integrity,
          actual,
          message: `${entry.path} in version ${id} does not match the manifest. Recorded ${entry.integrity}, found ${actual}.`,
        })
      }
    }

    const recorded = new Set(manifest.files.map((f) => f.path))
    for (const path of filesUnder(directory)) {
      if (path === MANIFEST_FILE || recorded.has(path)) continue
      problems.push({
        kind: 'file-unexpected',
        path,
        message: `version ${id} contains ${path}, which its manifest does not record`,
      })
    }

    // A missing predecessor is a broken link, not a broken version. The content
    // is intact, so the version verifies and the gap is reported separately.
    for (const linked of [manifest.lineage.clonedFrom, manifest.lineage.predecessor]) {
      if (linked === undefined) continue
      if (existsSync(join(this.directory, linked, MANIFEST_FILE))) continue
      lineageProblems.push({
        kind: 'lineage-missing',
        versionId: linked,
        message: `version ${id} names ${linked} in its lineage, and that version is not present`,
      })
    }

    return { id, ok: problems.length === 0, problems, lineageProblems, manifest }
  }

  /** Verify every version, for a whole-store check. */
  verifyAll(): VerifyResult[] {
    return this.list().map((id) => this.verify(id))
  }
}

function stripIntegrity(manifest: Manifest): ManifestBody {
  const { integrity: _integrity, ...body } = manifest
  return body
}

/** `/`-separated, so a manifest written on Windows verifies on Linux. */
export function normalizePath(path: string): string {
  return path.split(sep).join('/').replace(/^\.\//, '')
}

function filesUnder(directory: string, prefix = ''): string[] {
  const out: string[] = []
  if (!existsSync(directory)) return out
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    const rel = prefix === '' ? entry : `${prefix}/${entry}`
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel))
    else out.push(rel)
  }
  return out.sort()
}

/**
 * The elements standing between a model and a version.
 *
 * A derived id follows the key, so a rename would read as a removal plus an
 * addition — and a version whose successor cannot be compared to it is not worth
 * freezing.
 *
 * @lat: [[metamodel#Metamodel#Stable Element IDs]]
 */
export function derivedIdBlockers(ir: Ir): Array<{ kind: string; id: string; key: string }> {
  return derivedIdElements(ir)
}

export { relative }
