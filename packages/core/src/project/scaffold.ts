/**
 * The files a new project and a new model start from, and the edit that adds a
 * model to a project already on disk.
 *
 * It lives in core because `ldm init` and the extension's two new-file commands
 * must produce the same bytes. A scaffold that drifted between the two surfaces
 * would make "it works in the editor but not in CI" a thing that can happen to
 * the very first file a user creates.
 *
 * Nothing here invents identity. The namespace a new model carries is the
 * placeholder the template ships with unless the caller passes one, because a
 * base IRI guessed from a directory name is a guess about what the data means —
 * and [[metamodel#Identity]] is explicit that identity is the IRI, never the
 * file path.
 *
 * @lat: [[architecture#Architecture#Projects#Starting one]]
 */
import { applySplices, blockExtent, type Splice } from '../edit/splice.js'
import { isAbsoluteIri } from '../iri/iri.js'
import { SourceIndex } from '../source/index-file.js'
import { pointerChild, pointerRoot } from '../source/pointer.js'
import { KNOWN_HOSTS, PROJECT_FORMAT_VERSION, type HostName } from './project.js'

/** A scaffold that cannot be written, and why. Callers turn this into their own error. */
export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScaffoldError'
  }
}

// ---- names ------------------------------------------------------------------

/** Project and model names, from the two JSON Schemas that govern them. */
export const SCAFFOLD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** A JSON-LD prefix. Not a name: it may not contain a colon, and it seeds terms. */
const PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]*$/

/**
 * Why `value` cannot name a project or a model, or `undefined` when it can.
 *
 * Returning the reason rather than a boolean is what lets the CLI and the
 * extension show the same sentence without either one restating the rule.
 */
export function nameProblem(kind: 'project' | 'model', value: string): string | undefined {
  if (value === '') return `a ${kind} name is required`
  if (!SCAFFOLD_NAME_PATTERN.test(value)) {
    return `"${value}" cannot name a ${kind}: use letters, digits, dot, dash or underscore, beginning with a letter or a digit`
  }
  return undefined
}

/** Why `value` cannot be a namespace prefix, or `undefined` when it can. */
export function prefixProblem(value: string): string | undefined {
  if (value === '') return 'a namespace prefix is required'
  if (value.includes(':')) return `a prefix may not contain a colon; "${value}" does`
  if (!PREFIX_PATTERN.test(value)) {
    return `"${value}" is not a usable prefix: use letters, digits, dot, dash or underscore, beginning with a letter or an underscore`
  }
  return undefined
}

/** Why `value` cannot be a namespace base IRI, or `undefined` when it can. */
export function baseProblem(value: string): string | undefined {
  if (value === '') return 'a namespace base IRI is required'
  if (!isAbsoluteIri(value)) return `a namespace base must be an absolute IRI; "${value}" is not`
  if (!value.endsWith('#') && !value.endsWith('/')) {
    // `ex:name` against a base of `…/ns` expands to `…/nsname`. The terminator
    // is not a style preference; without it every term IRI is wrong.
    return `a namespace base must end in "#" or "/": a term appended to "${value}" would run into its last segment`
  }
  return undefined
}

/** Why `value` cannot be a project's `baseUrl`, or `undefined` when it can. */
export function baseUrlProblem(value: string): string | undefined {
  if (value === '') return 'a baseUrl is required'
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    return `\`baseUrl\` must be an absolute IRI; "${value}" is not`
  }
  return undefined
}

function refuse(problem: string | undefined): void {
  if (problem !== undefined) throw new ScaffoldError(problem)
}

// ---- the model scaffold ------------------------------------------------------

/** The namespace a model gets when the caller names none. Deliberately not real. */
export const PLACEHOLDER_PREFIX = 'ex'
export const PLACEHOLDER_BASE = 'https://example.org/ns#'

export interface ModelScaffoldOptions {
  prefix?: string
  base?: string
}

/**
 * A new model file. Ids are written, not derived, so the first rename is a
 * rename rather than a removal and an addition.
 *
 * @lat: [[metamodel#Metamodel#Stable Element IDs]]
 */
export function modelScaffold(options: ModelScaffoldOptions = {}): string {
  const prefix = options.prefix ?? PLACEHOLDER_PREFIX
  const base = options.base ?? PLACEHOLDER_BASE
  refuse(prefixProblem(prefix))
  refuse(baseProblem(base))

  return `# A JSON-LD Modeler model. This file is *about* JSON-LD; it is not itself JSON-LD.
# The @context is generated from it — see \`ldm emit\`.

jsonld: "1"

# The prefix and base IRI that give this model's own terms their global identity.
# Identity is the IRI, never the file path.
namespace:
  prefix: ${prefix}
  base: ${base}

# Which JSON-LD processing mode this model targets. A 1.0 processor does not
# reject a 1.1 context; it reads it differently. Declaring the target is what
# lets a 1.1-only facet become a downgrade at its own site.
mode: "1.1"

# Contexts this model builds on but does not own. Run \`ldm vendor\` to fetch each
# one into the committed vendor directory and record its hash here.
uses: []

# Terms are a flat map from JSON key to definition. One entry for \`name\` governs
# every occurrence of \`name\` anywhere in the document.
terms:
  name:
    id: a1b2c3
    "@id": ${prefix}:name
    note: The display name of the thing.

examples: []
`
}

/** The model scaffold with its placeholder namespace — the template as shipped. */
export const MODEL_SCAFFOLD = modelScaffold()

/** Whether a model still carries the namespace the scaffold shipped with. */
export function hasPlaceholderNamespace(prefix: string, base: string): boolean {
  return prefix === PLACEHOLDER_PREFIX && base === PLACEHOLDER_BASE
}

// ---- the project scaffold ----------------------------------------------------

export interface ScaffoldedModel {
  /** How commands will name it. */
  name: string
  /** Where the file is, relative to the project file. */
  path: string
}

export interface ProjectScaffoldOptions {
  name: string
  /**
   * At least one. The project schema requires it, because a project with no
   * models declares nothing and every command against it would fail later.
   */
  models: readonly ScaffoldedModel[]
  baseUrl?: string
  published?: string
  versions?: string
  hosts?: readonly HostName[]
}

/** A new `ldm.project.yaml`. */
export function projectScaffold(options: ProjectScaffoldOptions): string {
  refuse(nameProblem('project', options.name))
  if (options.models.length === 0) {
    throw new ScaffoldError(
      'a project must declare at least one model; scaffold the first model with it',
    )
  }
  const seenNames = new Set<string>()
  for (const model of options.models) {
    refuse(nameProblem('model', model.name))
    if (seenNames.has(model.name)) {
      throw new ScaffoldError(`"${model.name}" is declared twice; one model has one name`)
    }
    seenNames.add(model.name)
    if (!model.path.endsWith('.jsonld.yaml')) {
      throw new ScaffoldError(`a model file must end in .jsonld.yaml; "${model.path}" does not`)
    }
  }
  if (options.baseUrl !== undefined) refuse(baseUrlProblem(options.baseUrl))

  const hosts = options.hosts ?? (['plain'] as const)
  for (const host of hosts) {
    if (!(KNOWN_HOSTS as readonly string[]).includes(host)) {
      throw new ScaffoldError(
        `"${host}" is not a host this build knows. Known hosts: ${KNOWN_HOSTS.join(', ')}.`,
      )
    }
  }

  const baseUrlBlock =
    options.baseUrl === undefined
      ? `# The absolute IRI the published tree is served from. A \`uses\` entry under it
# resolves from the tree rather than the network, so a context this project
# publishes itself is never fetched. Uncomment it when you know the address.
# baseUrl: https://vocab.example.org/`
      : `# The absolute IRI the published tree is served from. A \`uses\` entry under it
# resolves from the tree rather than the network, so a context this project
# publishes itself is never fetched.
baseUrl: ${yamlScalar(options.baseUrl)}`

  const modelLines = options.models
    .map((model) => `  ${yamlKey(model.name)}: ${yamlScalar(model.path)}`)
    .join('\n')

  return `# A JSON-LD Modeler project. It names the models that belong together, where
# their published output goes, and which hosts that output must serve from.

project: "${PROJECT_FORMAT_VERSION}"

# What this project is called. It appears in the generated-file header of every
# artifact the project publishes.
name: ${yamlScalar(options.name)}

${baseUrlBlock}

# The models that belong together, by the name commands use for them. A model
# belongs to at most one project.
models:
${modelLines}

# Where \`ldm version new\` writes immutable versions, and where \`ldm publish\`
# writes the static tree. Both are committed.
versions: ${yamlScalar(options.versions ?? 'versions')}
published: ${yamlScalar(options.published ?? 'published')}

# The hosts the published tree must be valid for. Publishing fails when a name
# would produce a path any of them cannot serve.
hosts: [${hosts.join(', ')}]
`
}

// ---- registering a model into a project already on disk ----------------------

export interface RegisterModelResult {
  text: string
  /** `false` when the project already declared exactly this model at this path. */
  changed: boolean
}

/**
 * Add one entry to a project file's `models` map.
 *
 * A splice against the original text rather than a re-serialisation, for the
 * reason [[architecture#Editing Surface#Targeted edits]] gives: `toString()`
 * normalises the whole file, turning a one-line addition into a whole-file diff
 * and discarding the comments the scaffold went to the trouble of writing.
 */
export function registerModel(
  text: string,
  file: string,
  name: string,
  declaredPath: string,
): RegisterModelResult {
  refuse(nameProblem('model', name))
  if (!declaredPath.endsWith('.jsonld.yaml')) {
    throw new ScaffoldError(`a model file must end in .jsonld.yaml; "${declaredPath}" does not`)
  }

  const source = SourceIndex.parse(text, { path: file })
  if (source.errors.length > 0) {
    throw new ScaffoldError(`${file} does not parse: ${source.errors[0]!.message}`)
  }
  const data = source.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ScaffoldError(`${file} does not contain a mapping at its root`)
  }
  const raw = data as Record<string, unknown>
  const modelsRaw = raw['models']
  if (modelsRaw === undefined || modelsRaw === null) {
    throw new ScaffoldError(`${file} declares no \`models\` mapping to add to`)
  }
  if (typeof modelsRaw !== 'object' || Array.isArray(modelsRaw)) {
    throw new ScaffoldError(`\`models\` in ${file} is not a mapping`)
  }
  const models = modelsRaw as Record<string, unknown>

  const existing = models[name]
  if (existing !== undefined) {
    // Re-running the command that created it is not an error; claiming a name
    // that already means something else is.
    if (existing === declaredPath) return { text, changed: false }
    throw new ScaffoldError(
      `${file} already declares a model "${name}", at ${String(existing)}. A model has one name in a project.`,
    )
  }
  for (const [otherName, otherPath] of Object.entries(models)) {
    if (otherPath === declaredPath) {
      throw new ScaffoldError(
        `${file} already declares ${declaredPath}, as "${otherName}". One model has one name in a project.`,
      )
    }
  }

  const modelsPointer = pointerChild(pointerRoot(), 'models')
  const entry = `  ${yamlKey(name)}: ${yamlScalar(declaredPath)}`
  const keys = Object.keys(models)

  let splice: Splice
  if (keys.length === 0) {
    // `models: {}` or `models:` with nothing under it becomes a block mapping.
    const range = source.rangeOf(modelsPointer) ?? source.keyRangeOf(modelsPointer)
    if (!range) throw new ScaffoldError(`cannot locate \`models\` in ${file}`)
    if (/^\{\s*\}$/.test(text.slice(range.start, range.end))) {
      // The space `models: {}` leaves behind would be trailing whitespace on
      // the key line once the braces are gone, so it goes with them.
      let start = range.start
      while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--
      splice = { start, end: range.end, text: `\n${entry}` }
    } else {
      splice = { start: range.end, end: range.end, text: `\n${entry}` }
    }
  } else {
    const lastKey = keys[keys.length - 1]!
    const lastRange = source.keyRangeOf(pointerChild(modelsPointer, lastKey))
    if (!lastRange) throw new ScaffoldError(`cannot locate the model "${lastKey}" in ${file}`)
    const extent = blockExtent(text, lastRange.start)
    splice = { start: extent.end, end: extent.end, text: `\n${entry}` }
  }

  return { text: applySplices(text, [splice]), changed: true }
}

// ---- YAML scalars ------------------------------------------------------------

const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9._\-/#:+]*$/

/** Quoted only when it has to be, so the scaffold reads as a human wrote it. */
function yamlScalar(value: string): string {
  return PLAIN_SCALAR.test(value) && !value.includes(': ') ? value : JSON.stringify(value)
}

function yamlKey(key: string): string {
  return SCAFFOLD_NAME_PATTERN.test(key) ? key : JSON.stringify(key)
}
