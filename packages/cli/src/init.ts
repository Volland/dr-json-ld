/**
 * `ldm init` — the two files there was previously no command to create.
 *
 * Every other verb assumes a model, and most assume a project, so the first
 * thing a new user had to do was the one thing the tool would not do for them.
 * This command writes both, and registers the model in the project so that
 * `ldm check` passes on the very next line.
 *
 * It refuses to overwrite anything. A scaffold that clobbered an existing model
 * would destroy the element ids in it, and an element id is the only thing in
 * the file that cannot be reconstructed by reading it.
 *
 * @lat: [[architecture#Architecture#Projects#Starting one]]
 */
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  baseProblem,
  baseUrlProblem,
  KNOWN_HOSTS,
  loadProjectFrom,
  modelScaffold,
  nameProblem,
  PLACEHOLDER_BASE,
  PLACEHOLDER_PREFIX,
  prefixProblem,
  PROJECT_FILE,
  projectScaffold,
  registerModel,
  ScaffoldError,
  type HostName,
  type Project,
} from '@jsonld-modeler/core'

import { EXIT_OK, UsageError, type Io } from './io.js'
import type { CommandContext } from './project-commands.js'

/** Where a project puts its models when it has no opinion yet. */
const MODELS_DIR = 'models'
const MODEL_SUFFIX = '.jsonld.yaml'

export function initCommand(context: CommandContext): number {
  const subject = context.positional[0]
  if (subject === undefined) return initProject(context)
  if (subject === 'model') return initModel(context)
  throw new UsageError(
    `"${subject}" is not something \`ldm init\` creates. Use \`ldm init\` for a project, or \`ldm init model <name>\` for one more model in the project you already have.`,
  )
}

// ---- ldm init ----------------------------------------------------------------

function initProject(context: CommandContext): number {
  const { io, flags } = context

  const projectFile = resolve(io.cwd(), PROJECT_FILE)
  if (io.exists(projectFile)) {
    throw new UsageError(
      `${PROJECT_FILE} already exists here. Use \`ldm init model <name>\` to add a model to it.`,
    )
  }

  const projectName = required(flags, 'name') ?? defaultProjectName(io.cwd())
  refuse(nameProblem('project', projectName), 'name')

  const modelName = required(flags, 'model') ?? projectName
  refuse(nameProblem('model', modelName), 'model')

  const namespace = namespaceFrom(flags)
  const baseUrl = required(flags, 'base-url')
  if (baseUrl !== undefined) refuse(baseUrlProblem(baseUrl), 'base-url')
  const hosts = hostsFrom(flags)

  const declaredPath = `${MODELS_DIR}/${modelName}${MODEL_SUFFIX}`
  const modelFile = resolve(io.cwd(), declaredPath)
  if (io.exists(modelFile)) {
    throw new UsageError(`${declaredPath} already exists. Pass --model to name a different one.`)
  }

  const project = scaffold(() =>
    projectScaffold({
      name: projectName,
      models: [{ name: modelName, path: declaredPath }],
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(hosts !== undefined ? { hosts } : {}),
    }),
  )
  const model = scaffold(() => modelScaffold(namespace))

  io.writeFile(modelFile, model)
  io.writeFile(projectFile, project)

  io.out(`Created ${PROJECT_FILE} — project "${projectName}".`)
  io.out(`Created ${declaredPath} — model "${modelName}".`)
  reportNamespace(io, declaredPath, namespace)
  io.out('')
  io.out('Next: `ldm check`, then `ldm emit` to see the @context it generates.')
  return EXIT_OK
}

// ---- ldm init model ----------------------------------------------------------

function initModel(context: CommandContext): number {
  const { io, flags } = context

  const modelName = context.positional[1]
  if (modelName === undefined) throw new UsageError('`ldm init model` needs a name for the model')
  refuse(nameProblem('model', modelName), 'model')

  const namespace = namespaceFrom(flags)
  const loaded = loadProjectFrom(io.cwd())
  const project = loaded?.project

  const out = required(flags, 'out')
  if (out !== undefined && !out.endsWith(MODEL_SUFFIX)) {
    throw new UsageError(`--out must name a file ending in ${MODEL_SUFFIX}; got "${out}"`)
  }

  // Next to the models the project already has, so the layout a project chose
  // is the layout it keeps. Only a project with no models falls back.
  const root = project?.root ?? io.cwd()
  const modelFile =
    out !== undefined
      ? isAbsolute(out)
        ? out
        : resolve(io.cwd(), out)
      : join(root, siblingDir(project), `${modelName}${MODEL_SUFFIX}`)

  if (io.exists(modelFile)) {
    throw new UsageError(`${display(io, modelFile)} already exists.`)
  }

  io.writeFile(modelFile, scaffold(() => modelScaffold(namespace)))
  io.out(`Created ${display(io, modelFile)} — model "${modelName}".`)

  if (project === undefined) {
    io.out('')
    io.out(
      `No project encloses this directory, so the model stands alone. That works: every one-model command takes a path. Run \`ldm init\` to start a project around it.`,
    )
  } else {
    const declaredPath = posix(relative(project.root, modelFile))
    const updated = scaffold(() =>
      registerModel(io.readFile(project.file), project.file, modelName, declaredPath),
    )
    if (updated.changed) io.writeFile(project.file, updated.text)
    io.out(
      `Registered it in ${display(io, project.file)} as "${modelName}" → ${declaredPath}.`,
    )
  }

  reportNamespace(io, display(io, modelFile), namespace)
  return EXIT_OK
}

// ---- shared ------------------------------------------------------------------

interface Namespace {
  prefix?: string
  base?: string
}

function namespaceFrom(flags: Map<string, string | true>): Namespace {
  const prefix = required(flags, 'prefix')
  if (prefix !== undefined) refuse(prefixProblem(prefix), 'prefix')
  const base = required(flags, 'base')
  if (base !== undefined) refuse(baseProblem(base), 'base')
  return {
    ...(prefix !== undefined ? { prefix } : {}),
    ...(base !== undefined ? { base } : {}),
  }
}

/**
 * A namespace left at the placeholder is said out loud, because it is the one
 * thing in a scaffolded model that is certainly wrong and the one thing no
 * later command can tell is wrong: `ex:name` resolves, validates and emits.
 */
function reportNamespace(io: Io, path: string, namespace: Namespace): void {
  if (namespace.prefix !== undefined || namespace.base !== undefined) return
  io.out('')
  io.out(
    `The namespace in ${path} is a placeholder — \`${PLACEHOLDER_PREFIX}\` at ${PLACEHOLDER_BASE}.`,
  )
  io.out(
    'Identity is the IRI, never the file path, so set it before you publish. Nothing will warn you: a placeholder IRI resolves and emits exactly like a real one.',
  )
}

function hostsFrom(flags: Map<string, string | true>): HostName[] | undefined {
  const raw = required(flags, 'host')
  if (raw === undefined) return undefined
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  if (names.length === 0) throw new UsageError('--host needs at least one host name')
  for (const name of names) {
    if (!(KNOWN_HOSTS as readonly string[]).includes(name)) {
      throw new UsageError(
        `--host "${name}" is not a host this build knows. Known hosts: ${KNOWN_HOSTS.join(', ')}.`,
      )
    }
  }
  return names as HostName[]
}

/**
 * The directory a project keeps its models in, read from the ones it has, so
 * the layout a project chose is the layout it keeps. A model with no project
 * lands where the user is standing: there is no layout to be consistent with.
 */
function siblingDir(project: Project | undefined): string {
  if (project === undefined) return ''
  const last = project.models[project.models.length - 1]
  if (!last) return MODELS_DIR
  const dir = dirname(last.declaredPath)
  return dir === '.' ? '' : dir
}

function defaultProjectName(cwd: string): string {
  const name = basename(resolve(cwd))
  if (nameProblem('project', name) === undefined) return name
  throw new UsageError(
    `this directory is named "${name}", which cannot name a project. Pass --name.`,
  )
}

/** A flag that must carry a value, rather than standing alone. */
function required(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name)
  if (value === undefined) return undefined
  if (value === true) throw new UsageError(`--${name} needs a value`)
  return value
}

function refuse(problem: string | undefined, flag: string): void {
  if (problem !== undefined) throw new UsageError(`--${flag}: ${problem}`)
}

/** Core refuses a scaffold by throwing; to a CLI caller that is a usage error. */
function scaffold<T>(build: () => T): T {
  try {
    return build()
  } catch (error) {
    if (error instanceof ScaffoldError) throw new UsageError(error.message)
    throw error
  }
}

function display(io: Io, path: string): string {
  const rel = relative(io.cwd(), path)
  return rel === '' || rel.startsWith('..') ? path : posix(rel)
}

/** Project files are read on every platform, so their paths are written one way. */
function posix(path: string): string {
  return path.split('\\').join('/')
}
