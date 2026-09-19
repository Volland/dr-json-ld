/**
 * The published tree: a static directory a dumb file host can serve.
 *
 * Nothing here uploads. The tree is written locally, committed, and copied by
 * whatever tool the host already has. Publishing is therefore offline, like
 * every command but `ldm vendor`.
 *
 * @lat: [[processing#Processing#Context Resolution#Offline by default]]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { canonicalJson } from '../model/serialize.js'
import type { HostName } from '../project/project.js'
import { AliasStore } from '../version/alias.js'
import { artifactFileFor, VERSIONED_TARGETS } from '../version/create.js'
import type { Manifest } from '../version/manifest.js'
import { VersionError, VersionStore } from '../version/store.js'
import { checkPaths, sideFilesFor, type PathViolation } from './host.js'

export const PUBLISHED_INDEX = 'index.json'
export const INDEX_FORMAT_VERSION = '1'

/** Where a version's artifacts live in the tree. */
export function versionPathFor(model: string, versionId: string, file: string): string {
  return `${model}/v/${versionId}/${file}`
}

/** Where an alias's artifacts live. Parallel to the version path by design. */
export function aliasPathFor(model: string, alias: string, file: string): string {
  return `${model}/a/${alias}/${file}`
}

export interface PublishedVersionEntry {
  id: string
  model: string
  /** The manifest's own hash, so a consumer can check what it fetched. */
  manifest: string
  created: string
  files: string[]
}

export interface PublishedAliasEntry {
  name: string
  model: string
  versionId: string
}

export interface PublishedIndex {
  index: string
  project: string
  versions: PublishedVersionEntry[]
  aliases: PublishedAliasEntry[]
}

export class PublishError extends Error {
  readonly violations: PathViolation[]
  constructor(message: string, violations: PathViolation[] = []) {
    super(message)
    this.name = 'PublishError'
    this.violations = violations
  }
}

export interface PublishOptions {
  project: string
  hosts: readonly HostName[]
  /** Where the tree is written. */
  directory: string
  versions: VersionStore
  aliases: AliasStore
  /** Limits the tree to these versions. Defaults to every version present. */
  only?: readonly string[]
}

export interface PublishResult {
  directory: string
  /** Path to content, exactly as written. */
  files: Map<string, string>
  index: PublishedIndex
  /** Side files, and which host required each. */
  sideFiles: Array<{ path: string; hosts: HostName[] }>
  /** True when the tree on disk already matched. */
  unchanged: boolean
}

/**
 * Build the tree in memory, validate it against every named host, and only then
 * write. A host that cannot serve a path means nothing is written at all —
 * a half-published tree is worse than an unpublished one.
 */
export function publish(options: PublishOptions): PublishResult {
  const { versions, aliases } = options
  const ids = options.only ? [...options.only].sort() : versions.list()

  const files = new Map<string, string>()
  const versionEntries: PublishedVersionEntry[] = []

  for (const id of ids) {
    const verified = versions.verify(id)
    if (!verified.ok) {
      throw new PublishError(
        `version ${id} does not verify, so it was not published: ${verified.problems
          .map((p) => p.message)
          .join('; ')}`,
      )
    }
    const manifest = verified.manifest as Manifest
    const published: string[] = []

    for (const target of VERSIONED_TARGETS) {
      const source = artifactFileFor(target)
      const content = versions.readFile(id, source)
      const file = source.replace(/^context\//, '')
      const path = versionPathFor(manifest.model, id, file)
      files.set(path, content)
      published.push(path)
    }

    // The manifest travels with the version: a consumer holding only the tree
    // can verify what they fetched.
    const manifestPath = versionPathFor(manifest.model, id, 'manifest.json')
    files.set(manifestPath, versions.readManifestText(id))
    published.push(manifestPath)

    versionEntries.push({
      id,
      model: manifest.model,
      manifest: manifest.integrity,
      created: manifest.created,
      files: published.sort(),
    })
  }

  const aliasEntries: PublishedAliasEntry[] = []
  for (const { name, versionId } of aliases.list()) {
    if (!ids.includes(versionId)) continue
    const manifest = versions.readManifest(versionId)
    for (const target of VERSIONED_TARGETS) {
      const source = artifactFileFor(target)
      const file = source.replace(/^context\//, '')
      // Every adapter this build knows copies rather than redirecting: a
      // redirect the host may not honour fails silently, which is worse than a
      // duplicated file that is small.
      files.set(
        aliasPathFor(manifest.model, name, file),
        versions.readFile(versionId, source),
      )
    }
    aliasEntries.push({ name, model: manifest.model, versionId })
  }

  const index: PublishedIndex = {
    index: INDEX_FORMAT_VERSION,
    project: options.project,
    versions: versionEntries.sort((a, b) => a.id.localeCompare(b.id)),
    aliases: aliasEntries.sort((a, b) => a.name.localeCompare(b.name)),
  }
  files.set(PUBLISHED_INDEX, `${canonicalJson(index)}\n`)

  const sideFiles = sideFilesFor(options.hosts)
  for (const side of sideFiles) files.set(side.path, side.content)

  // Validate before writing. A tree that works nowhere is not worth half-writing.
  const violations = checkPaths(options.hosts, [...files.keys()])
  if (violations.length > 0) {
    throw new PublishError(
      `the published tree is not valid for every host this project names, so nothing was written:\n${violations
        .map((v) => `  ${v.host}: ${v.message}`)
        .join('\n')}`,
      violations,
    )
  }

  const directory = resolve(options.directory)
  const unchanged = treeMatches(directory, files)
  if (!unchanged) {
    // Replace wholesale: a stale artifact left behind from a previous publish
    // would be served as though it were current.
    if (existsSync(directory)) rmSync(directory, { recursive: true })
    for (const [path, content] of files) {
      const full = join(directory, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
  }

  return {
    directory,
    files,
    index,
    sideFiles: sideFiles.map((s) => ({ path: s.path, hosts: s.hosts })),
    unchanged,
  }
}

function treeMatches(directory: string, files: ReadonlyMap<string, string>): boolean {
  if (!existsSync(directory)) return false
  const onDisk = filesUnder(directory)
  if (onDisk.length !== files.size) return false
  for (const [path, content] of files) {
    const full = join(directory, path)
    if (!existsSync(full)) return false
    if (readFileSync(full, 'utf8') !== content) return false
  }
  return true
}

function filesUnder(directory: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    const rel = prefix === '' ? entry : `${prefix}/${entry}`
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel))
    else out.push(rel)
  }
  return out.sort()
}

export interface TreeProblem {
  kind: 'index-missing' | 'index-unreadable' | 'version-unlisted' | 'file-missing'
  message: string
  subject?: string
}

/**
 * Check a published tree against its own index: every version the tree holds is
 * listed, and every file the index names is present.
 */
export function verifyTree(directory: string): TreeProblem[] {
  const problems: TreeProblem[] = []
  const indexPath = join(directory, PUBLISHED_INDEX)
  if (!existsSync(indexPath)) {
    return [{ kind: 'index-missing', message: `${directory} contains no ${PUBLISHED_INDEX}` }]
  }

  let index: PublishedIndex
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8')) as PublishedIndex
  } catch (error) {
    return [
      {
        kind: 'index-unreadable',
        message: `${PUBLISHED_INDEX} is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    ]
  }

  const listed = new Set(index.versions.map((v) => `${v.model}/v/${v.id}`))
  for (const path of filesUnder(directory)) {
    const match = /^(.+)\/v\/([a-z0-9]{16})\//.exec(path)
    if (!match) continue
    const key = `${match[1]}/v/${match[2]}`
    if (listed.has(key)) continue
    problems.push({
      kind: 'version-unlisted',
      subject: match[2]!,
      message: `the tree contains version ${match[2]} under ${match[1]}, and the index does not name it`,
    })
    listed.add(key)
  }

  for (const version of index.versions) {
    for (const file of version.files) {
      if (existsSync(join(directory, file))) continue
      problems.push({
        kind: 'file-missing',
        subject: file,
        message: `the index names ${file}, and the tree does not contain it`,
      })
    }
  }

  return problems
}

export { VersionError }
