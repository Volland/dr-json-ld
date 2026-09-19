/**
 * The project and version verbs: `publish`, `version new`, `clone`, `alias`,
 * `diff` and `search`.
 *
 * None of them touches the network. `ldm vendor` remains the only command that
 * can, which is what makes every one of these safe to run in continuous
 * integration against a pull request from outside.
 *
 * @lat: [[architecture#Architecture#Distribution]]
 */
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import {
  AliasStore,
  atOrAbove,
  buildIndex,
  checkProject,
  CHANGE_CLASSES,
  cloneVersion,
  compareVersions,
  createVersionFromModel,
  describeNoMatch,
  describeUnknownModel,
  formatResult,
  isChangeClass,
  loadProject,
  loadProjectFrom,
  lockfileOf,
  modelNamed,
  publish,
  search,
  selfPublishedResolver,
  verifyTree,
  VersionStore,
  type ChangeClass,
  type Difference,
  type Finding,
  type Project,
  type ProjectModel,
} from '@jsonld-modeler/core'

import { EXIT_FINDINGS, EXIT_OK, UsageError, type Io } from './io.js'

export interface CommandContext {
  positional: string[]
  flags: Map<string, string | true>
  io: Io
}

/** The project a command operates in, or a usage error naming why there is none. */
export function requireProject(io: Io, flags: Map<string, string | true>): Project {
  const named = flags.get('project')
  if (typeof named === 'string') {
    const path = isAbsolute(named) ? named : resolve(io.cwd(), named)
    if (!io.exists(path)) throw new UsageError(`${named} does not exist`)
    const { project, findings } = loadProject(path)
    reportProjectFindings(io, findings)
    if (!project) throw new UsageError(`${named} is not a readable project file`)
    return project
  }

  const loaded = loadProjectFrom(io.cwd())
  if (loaded === undefined) {
    throw new UsageError(
      'no project was found above the working directory. Create an ldm.project.yaml, or pass --project.',
    )
  }
  reportProjectFindings(io, loaded.findings)
  if (!loaded.project) throw new UsageError('the project file is not readable')
  return loaded.project
}

function reportProjectFindings(io: Io, findings: readonly Finding[]): void {
  for (const finding of findings) {
    if (finding.severity !== 'error') continue
    io.err(`${finding.file}:${finding.loc.line}:${finding.loc.column}  ${finding.ruleId}  ${finding.message}`)
  }
}

/** The model a command acts on: named, or the only one the project declares. */
export function requireModel(project: Project, name: string | undefined): ProjectModel {
  if (name === undefined) {
    if (project.models.length === 1) return project.models[0]!
    throw new UsageError(
      `this project declares ${project.models.length} models, so one must be named: ${project.models
        .map((m) => m.name)
        .sort()
        .join(', ')}`,
    )
  }
  const model = modelNamed(project, name)
  if (!model) throw new UsageError(describeUnknownModel(project, name))
  return model
}

function storesFor(project: Project): { versions: VersionStore; aliases: AliasStore } {
  return {
    versions: new VersionStore(project.versionsDir),
    aliases: new AliasStore(project.versionsDir),
  }
}

/** `ldm version new [<model>]` — freeze a model as an immutable version. */
export function versionNew(context: CommandContext): number {
  const { io, flags } = context
  const project = requireProject(io, flags)
  const model = requireModel(project, context.positional[1])
  const { versions, aliases } = storesFor(project)

  // The version this one supersedes, when the caller says.
  const afterFlag = flags.get('after')
  const predecessor =
    typeof afterFlag === 'string' ? aliases.resolve(afterFlag, versions) : undefined

  const result = createVersionFromModel(versions, model.path, {
    modelName: model.name,
    project: project.name,
    // A model may build on a version this project already published; that
    // resolves from the tree rather than from the vendor directory.
    resolveContext: selfPublishedResolver({ project }),
    ...(predecessor !== undefined ? { lineage: { predecessor } } : {}),
  })

  if (result.alreadyExisted) {
    io.out(`${result.id} — unchanged; this model already has a version with that content.`)
    return EXIT_OK
  }

  io.out(`${result.id} — created from ${model.name}.`)
  if (predecessor !== undefined) io.out(`Supersedes ${predecessor}.`)

  const aliasFlag = flags.get('alias')
  if (typeof aliasFlag === 'string') {
    aliases.set(aliasFlag, result.id, versions)
    io.out(`Alias "${aliasFlag}" now points at ${result.id}.`)
  }
  return EXIT_OK
}

/** `ldm clone <version>` — the same inputs under a new identity. */
export function clone(context: CommandContext): number {
  const { io, flags } = context
  const project = requireProject(io, flags)
  const { versions, aliases } = storesFor(project)

  const target = context.positional[0]
  if (target === undefined) throw new UsageError('a version identity or alias is required')
  const originId = aliases.resolve(target, versions)

  const result = cloneVersion(versions, originId)
  io.out(`${result.id} — cloned from ${originId}.`)

  const aliasFlag = flags.get('alias')
  if (typeof aliasFlag === 'string') {
    aliases.set(aliasFlag, result.id, versions)
    io.out(`Alias "${aliasFlag}" now points at ${result.id}.`)
  }
  return EXIT_OK
}

/** `ldm alias [set|rm|list] …` — the only thing a rename may touch. */
export function alias(context: CommandContext): number {
  const { io, flags } = context
  const project = requireProject(io, flags)
  const { versions, aliases } = storesFor(project)

  const [verb, first, second] = context.positional
  switch (verb ?? 'list') {
    case 'list': {
      const entries = aliases.list()
      if (entries.length === 0) {
        io.out('This project has no aliases.')
        return EXIT_OK
      }
      for (const entry of entries) {
        const present = versions.exists(entry.versionId)
        io.out(`${entry.name.padEnd(16)} ${entry.versionId}${present ? '' : '  (missing)'}`)
      }
      const dangling = aliases.dangling(versions)
      if (dangling.length > 0) {
        io.err(
          `ldm: ${dangling.length} alias(es) point at a version that is not present: ${dangling
            .map((d) => d.name)
            .join(', ')}`,
        )
        return EXIT_FINDINGS
      }
      return EXIT_OK
    }
    case 'set': {
      if (first === undefined || second === undefined) {
        throw new UsageError('usage: ldm alias set <name> <version-or-alias>')
      }
      const versionId = aliases.resolve(second, versions)
      aliases.set(first, versionId, versions)
      io.out(`Alias "${first}" now points at ${versionId}.`)
      return EXIT_OK
    }
    case 'rename': {
      if (first === undefined || second === undefined) {
        throw new UsageError('usage: ldm alias rename <from> <to>')
      }
      aliases.rename(first, second)
      io.out(`Alias "${first}" is now "${second}". No version changed.`)
      return EXIT_OK
    }
    case 'rm': {
      if (first === undefined) throw new UsageError('usage: ldm alias rm <name>')
      aliases.delete(first)
      io.out(`Alias "${first}" removed. No version changed.`)
      return EXIT_OK
    }
    default:
      throw new UsageError(
        `"${verb}" is not an alias verb. Use set, rename, rm or list. There is no verb that renames a version: a version's name is its content hash.`,
      )
  }
}

/** `ldm publish` — write the static tree. Writes locally; uploads nothing. */
export function publishCommand(context: CommandContext): number {
  const { io, flags } = context
  const project = requireProject(io, flags)
  const { versions, aliases } = storesFor(project)

  if (versions.list().length === 0) {
    throw new UsageError(
      'this project has no versions to publish. Run `ldm version new` first.',
    )
  }

  const result = publish({
    project: project.name,
    hosts: project.hosts,
    directory: project.publishedDir,
    versions,
    aliases,
  })

  if (result.unchanged) {
    io.out(`${result.directory} — unchanged.`)
  } else {
    io.out(`${result.directory} — wrote ${result.files.size} files.`)
  }
  io.out(
    `${result.index.versions.length} version(s), ${result.index.aliases.length} alias(es), for ${project.hosts.join(
      ', ',
    )}.`,
  )
  for (const side of result.sideFiles) {
    io.out(`  ${side.path} — required by ${side.hosts.join(', ')}`)
  }

  const problems = verifyTree(result.directory)
  for (const problem of problems) io.err(`ldm: ${problem.message}`)
  return problems.length === 0 ? EXIT_OK : EXIT_FINDINGS
}

/** `ldm diff <a> <b>` — what changed, and what kind of change it is. */
export function diff(context: CommandContext): number {
  const { io, flags } = context
  const project = requireProject(io, flags)
  const { versions, aliases } = storesFor(project)

  const [left, right] = context.positional
  if (left === undefined || right === undefined) {
    throw new UsageError('usage: ldm diff <version-or-alias> <version-or-alias>')
  }
  const before = aliases.resolve(left, versions)
  const after = aliases.resolve(right, versions)

  const gateFlag = flags.get('fail-on')
  if (gateFlag === true) {
    throw new UsageError(`--fail-on needs a class: ${CHANGE_CLASSES.join(', ')}`)
  }
  if (gateFlag !== undefined && !isChangeClass(gateFlag)) {
    throw new UsageError(
      `--fail-on must be one of ${CHANGE_CLASSES.join(', ')}; got "${gateFlag}"`,
    )
  }
  const gate = gateFlag as ChangeClass | undefined

  const result = compareVersions(lockfileOf(versions, before), lockfileOf(versions, after))

  if (flags.has('json')) {
    io.out(
      JSON.stringify(
        { before, after, worst: result.worst ?? null, differences: result.differences },
        null,
        2,
      ),
    )
  } else {
    io.out(`${before} -> ${after}`)
    if (result.differences.length === 0) {
      io.out('No differences.')
    } else {
      for (const difference of result.differences) io.out(formatDifference(difference))
      io.out(
        `${result.differences.length} difference(s); the most severe is ${result.worst}.`,
      )
    }
  }

  if (gate === undefined) return EXIT_OK
  const gated = atOrAbove(result.differences, gate)
  if (gated.length === 0) return EXIT_OK
  io.err(
    `ldm: ${gated.length} difference(s) at or above "${gate}": ${gated
      .map((d) => `${d.class} ${d.subject}`)
      .join('; ')}`,
  )
  return EXIT_FINDINGS
}

function formatDifference(difference: Difference): string {
  const ambiguity = difference.ambiguous ? ' (ambiguous)' : ''
  return `  ${difference.class.padEnd(11)}${difference.subject.padEnd(28)} ${difference.message}${ambiguity}`
}

/** `ldm search <query>` — what already exists, offline. */
export function searchCommand(context: CommandContext): number {
  const { io, flags } = context
  const project = requireProject(io, flags)
  const { versions } = storesFor(project)

  const query = context.positional[0]
  if (query === undefined) throw new UsageError('a search query is required')

  const vendorDir = resolve(project.root, 'contexts')
  const index = buildIndex({
    versions,
    ...(existsSync(vendorDir) ? { vendorDir } : {}),
  })
  const report = search(index, query)

  if (flags.has('json')) {
    io.out(JSON.stringify(report, null, 2))
  } else {
    for (const result of report.results) io.out(formatResult(result))
    io.out(
      report.results.length === 0
        ? describeNoMatch(report)
        : `${report.results.length} result(s).`,
    )
    for (const skipped of report.skipped) {
      io.err(`ldm: skipped version ${skipped.versionId} — ${skipped.reason}`)
    }
  }
  // Matching nothing is a success: "is this term taken?" must be askable in a
  // script without the answer "no" looking like a failure.
  return EXIT_OK
}

/** `ldm check` over a whole project. */
export function checkProjectCommand(context: CommandContext): number {
  const { io, flags } = context
  const project = requireProject(io, flags)

  const report = checkProject(project, {
    projectFindings: loadProject(project.file).findings,
  })

  if (flags.has('json')) {
    io.out(
      JSON.stringify(
        {
          project: project.name,
          level: report.level,
          failed: report.failed,
          findings: report.findings,
          models: report.models.map((m) => ({
            name: m.model.name,
            findings: m.findings.length,
          })),
        },
        null,
        2,
      ),
    )
    return report.failed ? EXIT_FINDINGS : EXIT_OK
  }

  io.out(`Checked the project "${project.name}" at ${report.level}.`)
  for (const model of report.models) {
    io.out(`  ${model.model.name}: ${model.findings.length} finding(s)`)
  }
  for (const finding of report.findings) {
    io.out(
      `${finding.file}:${finding.loc.line}:${finding.loc.column}  ${finding.severity.padEnd(
        7,
      )} ${finding.ruleId}  ${finding.message}`,
    )
  }
  io.out(report.findings.length === 0 ? 'No findings.' : `${report.findings.length} finding(s).`)
  return report.failed ? EXIT_FINDINGS : EXIT_OK
}

export { selfPublishedResolver }
