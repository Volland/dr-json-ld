/**
 * `ldm` — the command line, and what a pull request runs.
 *
 * Exit codes, from design D11: 1 for findings at or above error severity, 2 for
 * a usage error. Everything but `ldm vendor` runs with the network off.
 *
 * @lat: [[architecture#Architecture#Distribution]]
 */

import { dirname, isAbsolute, join, resolve } from 'node:path'

import {
  EXIT_FINDINGS,
  EXIT_OK,
  EXIT_USAGE,
  nodeIo,
  UsageError,
  type Io,
} from './io.js'
import { initCommand } from './init.js'
import { skillCommand } from './skill-commands.js'
import {
  alias,
  checkProjectCommand,
  clone,
  diff,
  publishCommand,
  searchCommand,
  versionNew,
} from './project-commands.js'

import {
  backfillElementIds,
  capabilitiesFor,
  emit,
  expandTraced,
  formatTrace,
  importContext,
  isImplementedLevel,
  LevelNotAvailable,
  resolveModelText,
  resolverFor,
  SourceIndex,
  stripComments,
  validateModel,
  vendorCheck,
  vendorRefresh,
  activeContextForModel,
  findProjectFile,
  type Finding,
  type Level,
  type TargetName,
} from '@json-ld-modeler/core'

export { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE, nodeIo, UsageError, type Io } from './io.js'

export const USAGE = `ldm — author JSON-LD contexts as a reviewable YAML model.

Starting out:
  ldm init [--name <project>] [--model <name>] [--prefix <p>] [--base <iri>]
           [--base-url <iri>] [--host plain,github-pages,s3]
  ldm init model <name> [--prefix <p>] [--base <iri>] [--out <path>]

One model:
  ldm check <model> [--level L0|L1|L2] [--json]
  ldm emit <model> [--target context|context-inline] [--out <dir>]
  ldm import <context> [--out <model>]
  ldm vendor <model> [--check]
  ldm ids <model>
  ldm explain <model> <document> [--trace]

A project (found by searching upward, or named with --project):
  ldm check --project [--json]
  ldm version new [<model>] [--after <version>] [--alias <name>]
  ldm clone <version-or-alias> [--alias <name>]
  ldm alias set <name> <version-or-alias>
  ldm alias rename <from> <to>
  ldm alias rm <name>
  ldm alias list
  ldm publish
  ldm diff <a> <b> [--fail-on additive|compatible|breaking|semantic|illegal] [--json]
  ldm search <query> [--json]

Authoring skills (guidance for a coding agent; they produce nothing):
  ldm skill list
  ldm skill install --project|--user [<name>...]
             [--format agent-skill,agents,chatmode] [--force]

There is no command that renames a version: a version's name is its content
hash. \`ldm alias rename\` moves the label instead.

Every command except \`ldm vendor\` runs with the network off.
Exit codes: 0 clean, 1 findings at error severity, 2 usage.`

interface Parsed {
  command: string
  positional: string[]
  flags: Map<string, string | true>
}

export function parseArgv(argv: readonly string[]): Parsed {
  const [command, ...rest] = argv
  const positional: string[] = []
  const flags = new Map<string, string | true>()

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1))
      continue
    }
    const name = arg.slice(2)
    const next = rest[i + 1]
    if (next !== undefined && !next.startsWith('--') && TAKES_VALUE.has(name)) {
      flags.set(name, next)
      i++
    } else {
      flags.set(name, true)
    }
  }
  return { command: command ?? '', positional, flags }
}

const TAKES_VALUE = new Set([
  'level',
  'target',
  'out',
  'project',
  'alias',
  'after',
  'fail-on',
  'name',
  'model',
  'format',
  'prefix',
  'base',
  'base-url',
  'host',
])

const COMMANDS = new Set([
  'init',
  'check',
  'emit',
  'import',
  'vendor',
  'ids',
  'explain',
  'version',
  'clone',
  'alias',
  'publish',
  'diff',
  'search',
  'skill',
])

export async function run(argv: readonly string[], io: Io = nodeIo): Promise<number> {
  const parsed = parseArgv(argv)

  // `ldm --help` puts the flag in the command slot, which is how anyone would
  // type it. Treat it as the request for usage that it is.
  const askedForHelp =
    parsed.flags.has('help') ||
    parsed.command === 'help' ||
    parsed.command === '--help' ||
    parsed.command === '-h'

  if (parsed.command === '' || askedForHelp) {
    io.out(USAGE)
    return askedForHelp ? EXIT_OK : EXIT_USAGE
  }
  if (!COMMANDS.has(parsed.command)) {
    io.err(`ldm: unknown command "${parsed.command}"`)
    io.err(USAGE)
    return EXIT_USAGE
  }

  try {
    const context = { positional: parsed.positional, flags: parsed.flags, io }

    switch (parsed.command) {
      case 'init':
        return initCommand(context)
      case 'check':
        // `--project` always means the project. With no model path, the project
        // is used only if there actually is one — otherwise the old error, which
        // names what is missing, is the more useful answer.
        return parsed.flags.has('project') ||
          (parsed.positional.length === 0 && findProjectFile(io.cwd()) !== undefined)
          ? checkProjectCommand(context)
          : check(parsed, io)
      case 'version': {
        const verb = parsed.positional[0]
        if (verb !== 'new') {
          throw new UsageError(
            `"${verb ?? ''}" is not a version verb. Use \`ldm version new\`. There is no verb that renames a version — its name is its content hash.`,
          )
        }
        return versionNew(context)
      }
      case 'clone':
        return clone(context)
      case 'alias':
        return alias(context)
      case 'publish':
        return publishCommand(context)
      case 'diff':
        return diff(context)
      case 'search':
        return searchCommand(context)
      case 'skill':
        return skillCommand(context)
      case 'emit':
        return emitCommand(parsed, io)
      case 'ids':
        return ids(parsed, io)
      case 'import':
        return importCommand(parsed, io)
      case 'vendor':
        return await vendor(parsed, io)
      case 'explain':
        return explain(parsed, io)
      default:
        return EXIT_USAGE
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`ldm: ${error.message}`)
      return EXIT_USAGE
    }
    if (error instanceof LevelNotAvailable) {
      io.err(`ldm: ${error.message}`)
      return EXIT_USAGE
    }
    io.err(`ldm: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_FINDINGS
  }
}

function requireModel(parsed: Parsed, io: Io): { path: string; text: string; root: string } {
  const [path] = parsed.positional
  if (path === undefined) throw new UsageError('a model file is required')
  const absolute = isAbsolute(path) ? path : resolve(io.cwd(), path)
  if (!io.exists(absolute)) throw new UsageError(`${path} does not exist`)
  return { path, text: io.readFile(absolute), root: dirname(absolute) }
}

function check(parsed: Parsed, io: Io): number {
  const { path, text, root } = requireModel(parsed, io)

  const levelFlag = parsed.flags.get('level')
  if (levelFlag === true) throw new UsageError('--level needs a value: L0, L1 or L2')
  const level = (levelFlag ?? 'L2') as string
  if (!isImplementedLevel(level)) {
    if (/^L[0-4]$/.test(level)) throw new LevelNotAvailable(level)
    throw new UsageError(`--level must be L0, L1 or L2; got "${level}"`)
  }

  const { ir } = resolveModelText(text, path)
  const report = validateModel(SourceIndex.parse(text, { path }), {
    level: level as Level,
    ...(ir ? { resolveContext: resolverFor(ir, root) } : {}),
    readExample: (p) => {
      const full = resolve(root, p)
      return io.exists(full) ? io.readFile(full) : undefined
    },
  })

  if (parsed.flags.has('json')) {
    io.out(
      JSON.stringify(
        {
          level: report.level,
          failed: report.failed,
          findings: report.findings,
          examples: report.examples.map((e) => ({
            path: e.path,
            met: e.met,
            missing: e.missing,
            unexpected: e.unexpected,
          })),
        },
        null,
        2,
      ),
    )
  } else {
    io.out(`Checked ${path} at ${report.level}.`)
    for (const finding of report.findings) io.out(formatFinding(finding))
    io.out(
      report.findings.length === 0
        ? 'No findings.'
        : `${report.findings.length} finding${report.findings.length === 1 ? '' : 's'}.`,
    )
  }

  return report.failed ? EXIT_FINDINGS : EXIT_OK
}

function formatFinding(finding: Finding): string {
  return `${finding.file}:${finding.loc.line}:${finding.loc.column}  ${finding.severity.padEnd(
    7,
  )} ${finding.ruleId}  ${finding.message}`
}

function emitCommand(parsed: Parsed, io: Io): number {
  const { path, text, root } = requireModel(parsed, io)

  const targetFlag = parsed.flags.get('target') ?? 'context'
  if (targetFlag === true) throw new UsageError('--target needs a value')
  if (targetFlag !== 'context' && targetFlag !== 'context-inline') {
    throw new UsageError(`--target must be context or context-inline; got "${targetFlag}"`)
  }
  const target = targetFlag as TargetName

  const outFlag = parsed.flags.get('out')
  if (outFlag === true) throw new UsageError('--out needs a directory')

  const { ir, findings } = resolveModelText(text, path)
  if (!ir) {
    for (const finding of findings) io.err(formatFinding(finding))
    io.err('ldm: the model did not resolve, so no artifact was generated.')
    return EXIT_FINDINGS
  }

  const result = emit(ir, {
    target,
    source: SourceIndex.parse(text, { path }),
    resolveContext: resolverFor(ir, root),
    modelName: path,
  })

  for (const finding of result.findings) io.err(formatFinding(finding))
  if (result.findings.some((f) => f.severity === 'error')) {
    io.err('ldm: no artifact was generated.')
    return EXIT_FINDINGS
  }

  if (outFlag === undefined) {
    io.out(result.text)
  } else {
    const base = path.replace(/\.jsonld\.yaml$/, '').replace(/^.*\//, '')
    const suffix = target === 'context' ? '' : '.inline'
    const file = join(resolve(io.cwd(), outFlag), `${base}${suffix}${capabilitiesFor(target).extension}`)
    io.writeFile(file, result.text)
    io.out(`Wrote ${file}`)
  }
  return EXIT_OK
}

function ids(parsed: Parsed, io: Io): number {
  const { path, text } = requireModel(parsed, io)
  const absolute = isAbsolute(path) ? path : resolve(io.cwd(), path)
  const result = backfillElementIds(text, path)
  if (!result.changed) {
    io.out(`${path}: every element already carries a written id.`)
    return EXIT_OK
  }
  io.writeFile(absolute, result.text)
  for (const added of result.added) io.out(`${added.kind} ${added.key}: ${added.id}`)
  io.out(`Wrote ${result.added.length} id${result.added.length === 1 ? '' : 's'} into ${path}.`)
  return EXIT_OK
}

function importCommand(parsed: Parsed, io: Io): number {
  const [path] = parsed.positional
  if (path === undefined) throw new UsageError('a context file is required')
  const absolute = isAbsolute(path) ? path : resolve(io.cwd(), path)
  if (!io.exists(absolute)) throw new UsageError(`${path} does not exist`)

  let document: unknown
  try {
    document = JSON.parse(io.readFile(absolute))
  } catch (error) {
    throw new UsageError(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const result = importContext(document, { sourceName: path })
  const outFlag = parsed.flags.get('out')
  if (outFlag === true) throw new UsageError('--out needs a file path')

  if (outFlag === undefined) {
    io.out(result.text)
  } else {
    io.writeFile(resolve(io.cwd(), outFlag), result.text)
    io.out(`Wrote ${outFlag}`)
  }

  io.out('')
  io.out(`Recovered ${result.termCount} term${result.termCount === 1 ? '' : 's'}.`)
  if (result.referenced.length > 0) {
    io.out(`Referenced contexts recorded in \`uses\`: ${result.referenced.join(', ')}`)
    io.out('Run `ldm vendor` to fetch them and record their hashes.')
  }
  io.out('')
  io.out('Not recoverable from a @context, and therefore not invented:')
  for (const gap of result.notRecovered) io.out(`  - ${gap.message}`)
  return EXIT_OK
}

async function vendor(parsed: Parsed, io: Io): Promise<number> {
  const { path, text, root } = requireModel(parsed, io)
  const absolute = isAbsolute(path) ? path : resolve(io.cwd(), path)

  if (parsed.flags.has('check')) {
    const report = vendorCheck(text, path, { root })
    for (const entry of report.entries) {
      io.out(`${entry.status.padEnd(9)} ${entry.iri}${entry.reason ? ` — ${entry.reason}` : ''}`)
    }
    if (!report.ok) io.err('ldm: the vendored contexts do not match the model.')
    return report.ok ? EXIT_OK : EXIT_FINDINGS
  }

  const report = await vendorRefresh(text, path, { root })
  for (const entry of report.entries) {
    io.out(`${entry.status.padEnd(9)} ${entry.iri}${entry.reason ? ` — ${entry.reason}` : ''}`)
  }
  if (report.changed && report.text !== undefined) {
    io.writeFile(absolute, report.text)
    io.out(`Updated the recorded hashes in ${path}.`)
  }
  if (!report.ok) io.err('ldm: at least one context could not be vendored.')
  return report.ok ? EXIT_OK : EXIT_FINDINGS
}

function explain(parsed: Parsed, io: Io): number {
  const { path, text, root } = requireModel(parsed, io)
  const [, documentPath] = parsed.positional
  if (documentPath === undefined) throw new UsageError('a document to explain is required')
  const documentAbsolute = isAbsolute(documentPath)
    ? documentPath
    : resolve(io.cwd(), documentPath)
  if (!io.exists(documentAbsolute)) throw new UsageError(`${documentPath} does not exist`)

  const { ir, findings } = resolveModelText(text, path)
  if (!ir) {
    for (const finding of findings) io.err(formatFinding(finding))
    return EXIT_FINDINGS
  }

  const documentText = io.readFile(documentAbsolute)
  const source = SourceIndex.parse(documentText, { path: documentPath })
  const resolveContext = resolverFor(ir, root)
  const active = activeContextForModel(ir, { resolveContext })

  const traced = expandTraced(source.data, active, { resolveContext, source })

  io.out(`Expanded ${documentPath} against ${path}.`)
  io.out('')
  io.out(JSON.stringify(JSON.parse(JSON.stringify(traced.expanded)), null, 2))

  if (parsed.flags.has('trace')) {
    io.out('')
    io.out(`Trace — ${traced.trace.length} steps:`)
    for (const line of formatTrace(traced.trace)) io.out(line)
  }

  if (traced.observations.length > 0) {
    io.out('')
    io.out('What this document lost:')
    for (const observation of traced.observations) {
      if (observation.kind === 'term-used') continue
      io.out(`  ${observation.pointer || '/'}  ${observation.kind}`)
    }
  }
  return EXIT_OK
}

export { stripComments }
