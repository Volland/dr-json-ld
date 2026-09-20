/**
 * The project: the unit that holds several models together.
 *
 * A model still resolves perfectly well on its own — a command given a path and
 * no project behaves exactly as it did before projects existed. The project adds
 * a place to look, not a requirement to have one.
 *
 * @lat: [[architecture#Architecture#Source of Truth]]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

import { FindingCollector } from '../findings/collector.js'
import type { Finding } from '../findings/finding.js'
import { SourceIndex } from '../source/index-file.js'
import { pointerChild, pointerRoot, type JsonPointer } from '../source/pointer.js'

/** The one file that declares a project. */
export const PROJECT_FILE = 'ldm.project.yaml'

/**
 * The suffix a model file must carry. Deliberately not `.jsonld`: the file is
 * *about* JSON-LD and is not itself JSON-LD.
 */
export const MODEL_SUFFIX = '.jsonld.yaml'

/** The shape a project or model name must take, identical to the project schema's. */
export const SCAFFOLD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Why `value` cannot name a project or a model, or `undefined` when it can.
 *
 * Returning the reason rather than a boolean is what lets the CLI, the extension
 * and a finding show the same sentence without any of them restating the rule.
 */
export function nameProblem(kind: 'project' | 'model', value: string): string | undefined {
  if (value === '') return `a ${kind} name is required`
  if (!SCAFFOLD_NAME_PATTERN.test(value)) {
    return `"${value}" cannot name a ${kind}: use letters, digits, dot, dash or underscore, beginning with a letter or a digit`
  }
  return undefined
}

export const PROJECT_FORMAT_VERSION = '1'

/** Hosts this build knows how to validate a published tree against. */
export const KNOWN_HOSTS = ['plain', 'github-pages', 's3'] as const
export type HostName = (typeof KNOWN_HOSTS)[number]

export interface ProjectModel {
  /** How a command names this model. Not the file name, not the namespace prefix. */
  name: string
  /** As written in the project file, relative to it. */
  declaredPath: string
  /** Resolved against the project root. */
  path: string
  pointer: JsonPointer
}

export interface Project {
  format: string
  name: string
  /** The directory the project file sits in. Every other path is relative to it. */
  root: string
  /** The project file itself. */
  file: string
  models: ProjectModel[]
  /**
   * The absolute IRI the published tree is served from, when the project says.
   * A `uses` entry under it resolves from the tree rather than the network.
   */
  baseUrl?: string
  /** Where published versions are written. */
  publishedDir: string
  /** Where immutable versions are stored. */
  versionsDir: string
  hosts: HostName[]
  note?: string
}

export interface LoadProjectResult {
  /** `undefined` only when the file did not parse into a mapping. */
  project?: Project
  findings: Finding[]
  source: SourceIndex
}

/**
 * Find the project enclosing `from`, by searching upward. Returns `undefined`
 * when there is none — which is not an error: a model without a project is a
 * supported way to work.
 */
export function findProjectFile(from: string): string | undefined {
  let current = resolve(from)
  const { root } = parse(current)
  for (;;) {
    const candidate = join(current, PROJECT_FILE)
    if (existsSync(candidate)) return candidate
    if (current === root) return undefined
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function loadProjectFrom(from: string): LoadProjectResult | undefined {
  const file = findProjectFile(from)
  if (file === undefined) return undefined
  return loadProject(file)
}

export function loadProject(file: string): LoadProjectResult {
  const absolute = resolve(file)
  const text = readFileSync(absolute, 'utf8')
  return parseProject(text, absolute)
}

export function parseProject(text: string, file: string): LoadProjectResult {
  const path = file
  const source = SourceIndex.parse(text, { path })
  const findings = new FindingCollector()
  const root = dirname(resolve(file))

  for (const error of source.errors) {
    findings.add({
      ruleId: 'L0.unparseable',
      level: 'L0',
      severity: 'error',
      message: error.message,
      pointer: pointerRoot(),
      file: path,
      loc: error.range.from,
    })
  }

  const data = source.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    if (source.errors.length === 0) {
      findings.raise(
        'L0.not-an-object',
        source,
        pointerRoot(),
        'A project file must contain a mapping at its root.',
      )
    }
    return { findings: findings.all(), source }
  }
  const raw = data as Record<string, unknown>

  const format = typeof raw['project'] === 'string' ? (raw['project'] as string) : undefined
  if (format === undefined) {
    findings.raise(
      'L0.unknown-format-version',
      source,
      pointerRoot(),
      'A project must declare `project` — the version of the project format it is written against.',
    )
  } else if (format !== PROJECT_FORMAT_VERSION) {
    findings.raise(
      'L0.unknown-format-version',
      source,
      pointerChild(pointerRoot(), 'project'),
      `This tool knows project format "${PROJECT_FORMAT_VERSION}"; the file declares "${format}".`,
      { subject: format },
    )
  }

  const name = typeof raw['name'] === 'string' ? (raw['name'] as string) : ''
  if (name === '') {
    findings.raise(
      'L0.project-missing-name',
      source,
      pointerChild(pointerRoot(), 'name'),
      'A project must declare a name. It appears in the header of every artifact the project publishes.',
    )
  } else {
    // The same sentence `ldm init` refuses with. A name this tool would not
    // create is a name it must not silently accept when hand-written, because
    // it reaches a published path.
    const problem = nameProblem('project', name)
    if (problem) {
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointerRoot(), 'name'),
        `${problem[0]!.toUpperCase()}${problem.slice(1)}.`,
        { subject: name },
      )
    }
  }

  // ---- models --------------------------------------------------------------
  const models: ProjectModel[] = []
  const modelsPointer = pointerChild(pointerRoot(), 'models')
  const modelsRaw = raw['models']
  if (modelsRaw === undefined || modelsRaw === null) {
    findings.raise(
      'L0.project-no-models',
      source,
      modelsPointer,
      'A project must declare at least one model under `models`.',
    )
  } else if (typeof modelsRaw !== 'object' || Array.isArray(modelsRaw)) {
    findings.raise(
      'L0.schema-violation',
      source,
      modelsPointer,
      '`models` must be a mapping from model name to model path.',
    )
  } else {
    const entries = Object.entries(modelsRaw as Record<string, unknown>)
    if (entries.length === 0) {
      findings.raise(
        'L0.project-no-models',
        source,
        modelsPointer,
        'A project must declare at least one model under `models`.',
      )
    }
    const seenPaths = new Map<string, string>()
    for (const [modelName, value] of entries) {
      const pointer = pointerChild(modelsPointer, modelName)
      const nameIssue = nameProblem('model', modelName)
      if (nameIssue) {
        findings.raise(
          'L0.schema-violation',
          source,
          pointer,
          `${nameIssue[0]!.toUpperCase()}${nameIssue.slice(1)}. A command names a model by this key.`,
          { subject: modelName },
        )
        continue
      }
      if (typeof value !== 'string' || value === '') {
        findings.raise(
          'L0.schema-violation',
          source,
          pointer,
          `Model "${modelName}" must map to a path.`,
          { subject: modelName },
        )
        continue
      }
      // The suffix is not decoration: a `.jsonld` file claims to *be* JSON-LD,
      // and the model file is about JSON-LD without being it.
      if (!value.endsWith(MODEL_SUFFIX)) {
        findings.raise(
          'L0.schema-violation',
          source,
          pointer,
          `Model "${modelName}" maps to "${value}", which does not end in "${MODEL_SUFFIX}". A model file is about JSON-LD and is not itself JSON-LD.`,
          { subject: modelName },
        )
        continue
      }
      const resolved = isAbsolute(value) ? value : resolve(root, value)

      // Two names for one file is the same ambiguity as two projects claiming
      // one model, and it is caught here because it is cheaper to see.
      const previous = seenPaths.get(resolved)
      if (previous !== undefined) {
        findings.raise(
          'L0.project-duplicate-model',
          source,
          pointer,
          `"${modelName}" and "${previous}" both name ${value}. One model has one name in a project.`,
          { subject: modelName },
        )
        continue
      }
      seenPaths.set(resolved, modelName)

      if (!existsSync(resolved)) {
        findings.raise(
          'L0.project-model-missing',
          source,
          pointer,
          `Model "${modelName}" is declared at ${value}, and no file exists there.`,
          { subject: modelName },
        )
      }

      models.push({ name: modelName, declaredPath: value, path: resolved, pointer })
    }
  }

  // ---- hosts ---------------------------------------------------------------
  const hosts: HostName[] = []
  const hostsPointer = pointerChild(pointerRoot(), 'hosts')
  const hostsRaw = raw['hosts']
  if (hostsRaw === undefined || hostsRaw === null) {
    hosts.push('plain')
  } else if (!Array.isArray(hostsRaw)) {
    findings.raise('L0.schema-violation', source, hostsPointer, '`hosts` must be a sequence.')
    hosts.push('plain')
  } else {
    hostsRaw.forEach((value, i) => {
      if (typeof value === 'string' && (KNOWN_HOSTS as readonly string[]).includes(value)) {
        if (!hosts.includes(value as HostName)) hosts.push(value as HostName)
        return
      }
      findings.raise(
        'L0.project-unknown-host',
        source,
        pointerChild(hostsPointer, i),
        `"${String(value)}" is not a host this build knows. Known hosts: ${KNOWN_HOSTS.join(', ')}.`,
        { subject: String(value) },
      )
    })
    if (hosts.length === 0) hosts.push('plain')
  }

  let baseUrl: string | undefined
  if (raw['baseUrl'] !== undefined) {
    const value = raw['baseUrl']
    if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
      // Normalised with a trailing slash so prefix matching is unambiguous.
      baseUrl = value.endsWith('/') ? value : `${value}/`
    } else {
      findings.raise(
        'L1.malformed-iri',
        source,
        pointerChild(pointerRoot(), 'baseUrl'),
        `\`baseUrl\` must be an absolute IRI; ${JSON.stringify(value)} is not.`,
      )
    }
  }

  const publishedDir = resolve(
    root,
    typeof raw['published'] === 'string' ? (raw['published'] as string) : 'published',
  )
  const versionsDir = resolve(
    root,
    typeof raw['versions'] === 'string' ? (raw['versions'] as string) : 'versions',
  )

  for (const key of Object.keys(raw)) {
    if (KNOWN_PROJECT_KEYS.has(key)) continue
    findings.raise(
      'L0.schema-violation',
      source,
      pointerChild(pointerRoot(), key),
      `\`${key}\` is not an entry the project format defines.`,
    )
  }

  const project: Project = {
    format: format ?? PROJECT_FORMAT_VERSION,
    name,
    root,
    file: absoluteOf(file),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    models,
    publishedDir,
    versionsDir,
    hosts,
    ...(typeof raw['note'] === 'string' ? { note: raw['note'] as string } : {}),
  }

  return { project, findings: findings.all(), source }
}

const KNOWN_PROJECT_KEYS = new Set([
  'project',
  'name',
  'models',
  'baseUrl',
  'published',
  'versions',
  'hosts',
  'note',
])

function absoluteOf(file: string): string {
  return isAbsolute(file) ? file : resolve(file)
}

/** The model a name refers to, or `undefined` when the project does not declare it. */
export function modelNamed(project: Project, name: string): ProjectModel | undefined {
  return project.models.find((m) => m.name === name)
}

/** The model whose file is `path`, when the project declares it. */
export function modelAtPath(project: Project, path: string): ProjectModel | undefined {
  const resolved = resolve(path)
  return project.models.find((m) => m.path === resolved)
}

/**
 * The error a command gives when it is handed a name the project does not know.
 * It lists what the project does declare, because the usual cause is a typo and
 * the usual fix is visible in that list.
 */
export function describeUnknownModel(project: Project, name: string): string {
  const known = project.models.map((m) => m.name).sort()
  return `The project "${project.name}" declares no model named "${name}". It declares: ${
    known.length === 0 ? 'none' : known.join(', ')
  }.`
}

/**
 * Every project file at or below `root`, so a repository-wide check can find a
 * model claimed by two of them.
 */
export function findAllProjectFiles(root: string, limit = 200): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    if (out.length >= limit) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    if (entries.includes(PROJECT_FILE)) out.push(join(dir, PROJECT_FILE))
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (isDirectory(full)) walk(full)
    }
  }
  walk(resolve(root))
  return out.sort()
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export { relative }
