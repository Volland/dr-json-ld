/**
 * Gathering the read-only project and release state the canvas shows.
 *
 * Shared by both hosts so the plain-Node one and the VS Code one cannot show
 * different things — the reason the host adapter exists at all.
 *
 * @lat: [[architecture#Architecture#Host Adapter]]
 */
import {
  AliasStore,
  loadProjectFrom,
  modelAtPath,
  VersionStore,
  type Project,
} from '@jsonld-modeler/core'

import type { ProjectionRelease } from './projection.js'

export interface ReleaseStateOptions {
  /** The model file the canvas is open on. */
  modelPath: string
  /** Overrides the project lookup. Tests pass one directly. */
  project?: Project
}

/**
 * The release state for one model, or `undefined` when there is no project.
 *
 * Everything here is read-only: versions are immutable and retargeting an alias
 * is a deliberate act, so the canvas displays them and the command line changes
 * them.
 */
export function releaseStateFor(options: ReleaseStateOptions): ProjectionRelease | undefined {
  const project = options.project ?? loadProjectFrom(options.modelPath)?.project
  if (!project) return undefined

  const active = modelAtPath(project, options.modelPath)
  const versions = new VersionStore(project.versionsDir)
  const aliases = new AliasStore(project.versionsDir)

  const ofThisModel = versions
    .list()
    .map((id) => ({ id, verified: versions.verify(id) }))
    .filter(({ verified }) => verified.manifest?.model === active?.name)

  return {
    projectName: project.name,
    siblingModels: project.models.map((model) => ({
      name: model.name,
      path: model.path,
      active: model.path === active?.path,
    })),
    // Newest first: the one an author is likely to be looking for.
    versions: ofThisModel
      .map(({ id, verified }) => ({
        id,
        created: verified.manifest?.created ?? '',
        verified: verified.ok,
      }))
      .sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id)),
    aliases: aliases
      .list()
      .filter((entry) => ofThisModel.some((v) => v.id === entry.versionId)),
  }
}
