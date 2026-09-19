/**
 * Turning a model into a version.
 *
 * A version holds the model as written, the lockfile that lets it be compared
 * later, and the emitted artifacts for every target — so a consumer with the
 * version and nothing else has both what was meant and what was published.
 *
 * @lat: [[emitters#Emitters#Verification]]
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import { emit, retargetVersionHeader } from '../emit/emit.js'
import type { TargetName } from '../emit/capability.js'
import type { Finding } from '../findings/finding.js'
import { hasErrors } from '../findings/finding.js'
import type { Ir } from '../model/ir.js'
import { resolveModelText } from '../model/resolve.js'
import { serializeIr } from '../model/serialize.js'
import { SourceIndex } from '../source/index-file.js'
import { validateModel } from '../validate/validate.js'
import { resolverFor } from '../vendor/vendor.js'
import { identityOf, type VersionInput, type VersionLineage } from './manifest.js'
import {
  derivedIdBlockers,
  VersionError,
  VersionStore,
  type CreateVersionResult,
  type VersionFile,
} from './store.js'

/** The file names inside a version. Fixed, so a reader knows where to look. */
export const MODEL_FILE = 'model.jsonld.yaml'
export const LOCKFILE = 'lock.json'
export const ARTIFACT_DIR = 'context'

/** Every target a version carries. */
export const VERSIONED_TARGETS: readonly TargetName[] = ['context', 'context-inline']

export function artifactFileFor(target: TargetName): string {
  return target === 'context'
    ? `${ARTIFACT_DIR}/context.jsonld`
    : `${ARTIFACT_DIR}/context.inline.jsonld`
}

export interface CreateFromModelOptions {
  /** The model name the manifest records. Defaults to the file's base name. */
  modelName?: string
  project?: string
  lineage?: VersionLineage
  created?: string
  /** The directory vendored contexts sit in. Defaults to the model's directory. */
  root?: string
  /**
   * Resolves a referenced context. Chained in front of the vendored resolver, so
   * a model building on a version its own project published resolves from the
   * published tree rather than reporting itself unvendored.
   */
  resolveContext?: (iri: string) => unknown
}

export interface CreateFromModelResult extends CreateVersionResult {
  ir: Ir
  findings: Finding[]
}

/**
 * Freeze a model as a version.
 *
 * Refuses a model with an error finding, and refuses a model whose element ids
 * are derived — the first because a version is a release and the second because
 * a version that cannot be compared to its successor is not worth freezing.
 */
export function createVersionFromModel(
  store: VersionStore,
  modelPath: string,
  options: CreateFromModelOptions = {},
): CreateFromModelResult {
  const absolute = resolve(modelPath)
  if (!existsSync(absolute)) {
    throw new VersionError(`${modelPath} does not exist`)
  }
  const text = readFileSync(absolute, 'utf8')
  const displayPath = basename(absolute)
  const root = options.root ?? dirname(absolute)

  const source = SourceIndex.parse(text, { path: displayPath })
  const { ir } = resolveModelText(text, displayPath)
  if (!ir) {
    throw new VersionError(`${modelPath} did not resolve, so there is nothing to freeze`)
  }

  const vendored = resolverFor(ir, root)
  const resolveContext =
    options.resolveContext === undefined
      ? vendored
      : (iri: string) => options.resolveContext!(iri) ?? vendored(iri)
  const report = validateModel(source, {
    resolveContext,
    readExample: (relativePath) => {
      const full = resolve(root, relativePath)
      return existsSync(full) ? readFileSync(full, 'utf8') : undefined
    },
  })

  if (hasErrors(report.findings)) {
    throw new VersionError(
      `${modelPath} produces ${
        report.findings.filter((f) => f.severity === 'error').length
      } error finding(s), so no version was created. Fix them and try again.`,
    )
  }

  const derived = derivedIdBlockers(ir)
  if (derived.length > 0) {
    throw new VersionError(
      `${modelPath} carries derived element ids on ${derived
        .map((d) => `${d.kind} "${d.key}"`)
        .join(', ')}. A derived id follows the key, so a later rename could not be told from a removal plus an addition. Run \`ldm ids\` first.`,
    )
  }

  const modelName = options.modelName ?? displayPath.replace(/\.jsonld\.yaml$/, '')

  // ---- the inputs: what a human authored ----------------------------------
  const inputs: VersionInput[] = [
    // The model as written, comments and all: a version records what was meant,
    // not only what was generated.
    { path: MODEL_FILE, content: text },
    // The lockfile, so two versions can be compared with neither model present.
    { path: LOCKFILE, content: serializeIr(ir) },
  ]

  // Every example the model declares travels with the version, so the round-trip
  // check can be re-run by someone holding only the published tree.
  for (const example of ir.examples) {
    const full = resolve(root, example.path)
    if (!existsSync(full)) continue
    inputs.push({
      path: `examples/${basename(example.path)}`,
      content: readFileSync(full, 'utf8'),
    })
  }

  // The identity comes from the inputs alone. The artifacts below name it, so
  // deriving it from them would not converge — see design D1.
  const lineage = options.lineage ?? {}
  const id = identityOf(inputs, identitySalt(modelName, options.project, lineage))

  // ---- the artifacts: a pure function of the inputs, and of this identity ---
  const files: VersionFile[] = [...inputs]
  for (const target of VERSIONED_TARGETS) {
    const artifact = emit(ir, {
      target,
      source,
      resolveContext,
      modelName: displayPath,
      versionId: id,
      ...(options.project !== undefined ? { projectName: options.project } : {}),
    })
    if (hasErrors(artifact.findings)) {
      throw new VersionError(
        `emitting the ${target} target produced an error finding, so no version was created`,
      )
    }
    files.push({ path: artifactFileFor(target), content: artifact.text })
  }

  const created = store.create({
    model: modelName,
    ...(options.project !== undefined ? { project: options.project } : {}),
    id,
    files,
    lineage,
    ...(options.created !== undefined ? { created: options.created } : {}),
  })

  return { ...created, ir, findings: report.findings }
}

/**
 * What distinguishes two versions with identical inputs.
 *
 * The model name and project are part of identity because the same terms
 * published under two names are two releases. The lineage is part of it because
 * a clone has the same content as its origin and must not *be* its origin.
 */
function identitySalt(
  model: string,
  project: string | undefined,
  lineage: VersionLineage,
): string {
  return JSON.stringify([
    model,
    project ?? null,
    lineage.clonedFrom ?? null,
    lineage.predecessor ?? null,
  ])
}

/**
 * Clone a version: the same content under a new identity, recording where it
 * came from. The origin is not touched.
 */
export function cloneVersion(
  store: VersionStore,
  originId: string,
  options: { created?: string } = {},
): CreateVersionResult {
  const verified = store.verify(originId)
  if (!verified.ok) {
    throw new VersionError(
      `version ${originId} does not verify, so it cannot be cloned: ${verified.problems
        .map((p) => p.message)
        .join('; ')}`,
      originId,
    )
  }
  const manifest = verified.manifest!

  const copied: VersionFile[] = manifest.files.map((entry) => ({
    path: entry.path,
    content: store.readFile(originId, entry.path),
  }))

  // A clone's inputs are its origin's inputs, byte for byte; it is the lineage
  // that makes it a different version rather than the same one.
  const inputs = copied.filter((f) => !f.path.startsWith(`${ARTIFACT_DIR}/`))
  const lineage: VersionLineage = { clonedFrom: originId }
  const id = identityOf(inputs, identitySalt(manifest.model, manifest.project, lineage))

  // The artifacts are the origin's with one line changed: an artifact served at
  // the clone's path must not claim to be the origin.
  const files: VersionFile[] = copied.map((file) =>
    file.path.startsWith(`${ARTIFACT_DIR}/`)
      ? { path: file.path, content: retargetVersionHeader(file.content, id, manifest.project) }
      : file,
  )

  return store.create({
    model: manifest.model,
    ...(manifest.project !== undefined ? { project: manifest.project } : {}),
    id,
    files,
    lineage,
    ...(options.created !== undefined ? { created: options.created } : {}),
  })
}
