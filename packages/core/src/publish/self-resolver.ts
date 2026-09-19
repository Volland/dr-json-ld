/**
 * Resolving a context this same project published.
 *
 * A model may build on a version of its sibling — or of itself — and when it
 * does, the copy is already in the repository. Vendoring it again would put two
 * copies of the same bytes under two hashes, and the second would drift.
 *
 * Nothing here touches the network. `ldm vendor` remains the only command that
 * can, and this path is one of the reasons it does not have to.
 *
 * @lat: [[processing#Processing#Context Resolution#Offline by default]]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { stripComments } from '../emit/render.js'
import type { Project } from '../project/project.js'
import { integrityOf } from '../version/manifest.js'
import { PUBLISHED_INDEX, type PublishedIndex } from './tree.js'

export class SelfPublishedError extends Error {
  readonly iri: string
  constructor(iri: string, message: string) {
    super(message)
    this.name = 'SelfPublishedError'
    this.iri = iri
  }
}

/** What a `uses` IRI under the project's own base URL points at. */
export interface SelfReference {
  /** The model the tree publishes it under. */
  model: string
  /** `v` for a version identity, `a` for an alias. */
  kind: 'version' | 'alias'
  /** The identity or the alias name. */
  ref: string
  /** The artifact file, relative to that directory. */
  file: string
  /** Where it sits in the published tree. */
  treePath: string
}

/**
 * Recognise an IRI the project publishes.
 *
 * Returns `undefined` for anything else, which is the signal to fall through to
 * the ordinary vendored path.
 */
export function asSelfReference(project: Project, iri: string): SelfReference | undefined {
  if (project.baseUrl === undefined) return undefined
  if (!iri.startsWith(project.baseUrl)) return undefined

  const rest = iri.slice(project.baseUrl.length)
  const match = /^([^/]+)\/(v|a)\/([^/]+)\/(.+)$/.exec(rest)
  if (!match) {
    throw new SelfPublishedError(
      iri,
      `${iri} is under this project's base URL but does not name a published artifact. A published path looks like <model>/v/<version>/context.jsonld or <model>/a/<alias>/context.jsonld.`,
    )
  }
  const [, model, kind, ref, file] = match
  return {
    model: model!,
    kind: kind === 'v' ? 'version' : 'alias',
    ref: ref!,
    file: file!,
    treePath: rest,
  }
}

export interface SelfResolverOptions {
  project: Project
  /** Overrides the project's published directory. Tests use it. */
  publishedDir?: string
}

/**
 * A resolver for contexts this project published, to sit in front of the
 * vendored one.
 *
 * It reads from the published tree and checks what it read against the manifest
 * hash the tree records — the same guarantee vendoring gives, from the copy that
 * is already here.
 */
export function selfPublishedResolver(
  options: SelfResolverOptions,
): (iri: string) => unknown {
  const directory = resolve(options.publishedDir ?? options.project.publishedDir)

  return (iri: string) => {
    const reference = asSelfReference(options.project, iri)
    if (reference === undefined) return undefined

    const indexPath = join(directory, PUBLISHED_INDEX)
    if (!existsSync(indexPath)) {
      throw new SelfPublishedError(
        iri,
        `${iri} is published by this project, and there is no published tree at ${directory}. Run \`ldm publish\` — no command other than the vendor refresh touches the network.`,
      )
    }

    let index: PublishedIndex
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf8')) as PublishedIndex
    } catch (error) {
      throw new SelfPublishedError(
        iri,
        `the published index at ${indexPath} is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const versionId =
      reference.kind === 'version'
        ? reference.ref
        : index.aliases.find((a) => a.name === reference.ref && a.model === reference.model)
            ?.versionId

    if (versionId === undefined) {
      throw new SelfPublishedError(
        iri,
        `${iri} names the alias "${reference.ref}" of the model "${reference.model}", and the published tree records no such alias. Publish it, or point the reference at a version identity.`,
      )
    }

    const entry = index.versions.find((v) => v.id === versionId && v.model === reference.model)
    if (entry === undefined) {
      throw new SelfPublishedError(
        iri,
        `${iri} names version ${versionId} of the model "${reference.model}", and the published tree does not contain it. Run \`ldm publish\`; nothing was fetched.`,
      )
    }

    const artifactPath = join(directory, reference.treePath)
    if (!existsSync(artifactPath)) {
      throw new SelfPublishedError(
        iri,
        `the published index names version ${versionId}, and ${reference.treePath} is not in the tree`,
      )
    }

    // The manifest travels with the version, so what was fetched can be checked
    // against what was published — the same guarantee vendoring gives.
    const manifestPath = join(directory, reference.model, 'v', versionId, 'manifest.json')
    if (existsSync(manifestPath)) {
      const manifestText = readFileSync(manifestPath, 'utf8')
      const recorded = integrityOf(manifestText)
      const expected = manifestHashFromIndex(entry.manifest, manifestText)
      if (!expected) {
        throw new SelfPublishedError(
          iri,
          `the manifest of version ${versionId} does not match the hash the index records. Index says ${entry.manifest}; the file hashes to ${recorded}.`,
        )
      }
      const manifest = JSON.parse(manifestText) as {
        files: Array<{ path: string; integrity: string }>
      }
      const fileEntry = manifest.files.find(
        (f) => f.path === `context/${reference.file}` || f.path === reference.file,
      )
      const content = readFileSync(artifactPath, 'utf8')
      if (fileEntry && integrityOf(content) !== fileEntry.integrity) {
        throw new SelfPublishedError(
          iri,
          `${reference.treePath} does not match the hash version ${versionId} records for it. Recorded ${fileEntry.integrity}, found ${integrityOf(content)}.`,
        )
      }
      return JSON.parse(stripComments(content))
    }

    return JSON.parse(stripComments(readFileSync(artifactPath, 'utf8')))
  }
}

/** The index records the manifest's own `integrity` field, not its file hash. */
function manifestHashFromIndex(recorded: string, manifestText: string): boolean {
  try {
    const manifest = JSON.parse(manifestText) as { integrity?: string }
    return manifest.integrity === recorded
  } catch {
    return false
  }
}

/**
 * Chain the self-published resolver in front of another. The first that answers
 * wins; neither reaches the network.
 */
export function chainResolvers(
  ...resolvers: Array<(iri: string) => unknown>
): (iri: string) => unknown {
  return (iri: string) => {
    for (const resolver of resolvers) {
      const result = resolver(iri)
      if (result !== undefined) return result
    }
    return undefined
  }
}
