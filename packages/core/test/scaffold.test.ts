/**
 * The scaffolds, and the edit that registers a model in a project.
 *
 * These live in core because two surfaces write them, and a scaffold that
 * differed between the editor and the CLI would make the very first file a user
 * creates behave differently in CI than it did on their machine.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  MODEL_SCAFFOLD,
  modelScaffold,
  nameProblem,
  baseProblem,
  prefixProblem,
  parseProject,
  projectScaffold,
  registerModel,
  resolveModelText,
  ScaffoldError,
} from '../src/index.js'

const PROJECT_PATH = '/tmp/scaffold/ldm.project.yaml'

describe('the model scaffold', () => {
  it('is byte-identical to the template core publishes', () => {
    const template = readFileSync(
      fileURLToPath(new URL('../templates/scaffold.jsonld.yaml', import.meta.url)),
      'utf8',
    )
    expect(MODEL_SCAFFOLD).toBe(template)
  })

  it('resolves with every id written, so the first rename is a rename', () => {
    const { ir, findings } = resolveModelText(MODEL_SCAFFOLD, 'new.jsonld.yaml')
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(ir!.terms.every((t) => t.idWritten)).toBe(true)
  })

  it('carries a namespace it is given, into the seeded term as well', () => {
    const text = modelScaffold({ prefix: 'cat', base: 'https://example.org/catalogue#' })
    expect(text).toContain('prefix: cat')
    expect(text).toContain('base: https://example.org/catalogue#')
    expect(text).toContain('"@id": cat:name')

    const { ir, findings } = resolveModelText(text, 'cat.jsonld.yaml')
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(ir!.terms[0]!.iri).toBe('https://example.org/catalogue#name')
  })

  // Without a `#` or `/` terminator every term IRI silently runs into the last
  // path segment, which no later command can tell from an intended IRI.
  it('refuses a base that would run into its last segment', () => {
    expect(baseProblem('https://example.org/ns')).toMatch(/must end in/)
    expect(baseProblem('https://example.org/ns#')).toBeUndefined()
    expect(baseProblem('https://example.org/ns/')).toBeUndefined()
    expect(baseProblem('not-an-iri')).toMatch(/absolute IRI/)
    expect(() => modelScaffold({ base: 'https://example.org/ns' })).toThrow(ScaffoldError)
  })

  it('refuses a prefix that is not one', () => {
    expect(prefixProblem('cat:sub')).toMatch(/colon/)
    expect(prefixProblem('')).toBeDefined()
    expect(prefixProblem('cat')).toBeUndefined()
  })
})

describe('the project scaffold', () => {
  it('parses as the project it describes', () => {
    const text = projectScaffold({
      name: 'suite',
      models: [{ name: 'catalogue', path: 'models/catalogue.jsonld.yaml' }],
      baseUrl: 'https://vocab.example.org/',
      hosts: ['plain', 'github-pages'],
    })
    const { project, findings } = parseProject(text, PROJECT_PATH)
    // The model file does not exist on disk here, which is the one finding.
    expect(findings.filter((f) => f.ruleId !== 'L0.project-model-missing')).toEqual([])
    expect(project!.name).toBe('suite')
    expect(project!.baseUrl).toBe('https://vocab.example.org/')
    expect(project!.hosts).toEqual(['plain', 'github-pages'])
    expect(project!.models.map((m) => m.name)).toEqual(['catalogue'])
  })

  it('comments out a baseUrl it was not given, rather than inventing one', () => {
    const text = projectScaffold({
      name: 'suite',
      models: [{ name: 'a', path: 'a.jsonld.yaml' }],
    })
    expect(text).toContain('# baseUrl: https://vocab.example.org/')
    expect(parseProject(text, PROJECT_PATH).project!.baseUrl).toBeUndefined()
  })

  // The schema requires at least one, and a project declaring none would fail
  // every command run against it.
  it('refuses a project with no models', () => {
    expect(() => projectScaffold({ name: 'suite', models: [] })).toThrow(ScaffoldError)
  })

  it('refuses a name the project format cannot hold', () => {
    expect(nameProblem('project', 'has space')).toBeDefined()
    expect(nameProblem('model', '-leading')).toBeDefined()
    expect(nameProblem('model', 'core.v2')).toBeUndefined()
    expect(() => projectScaffold({ name: 'has space', models: [] })).toThrow(ScaffoldError)
  })

  it('refuses a model path that is not a model file', () => {
    expect(() =>
      projectScaffold({ name: 'suite', models: [{ name: 'a', path: 'a.yaml' }] }),
    ).toThrow(ScaffoldError)
  })
})

describe('registering a model in a project', () => {
  const base = projectScaffold({
    name: 'suite',
    models: [{ name: 'catalogue', path: 'models/catalogue.jsonld.yaml' }],
  })

  it('adds one line and changes nothing else', () => {
    const { text, changed } = registerModel(base, PROJECT_PATH, 'core', 'models/core.jsonld.yaml')
    expect(changed).toBe(true)
    expect(text).toContain('  core: models/core.jsonld.yaml')

    const added = text.split('\n').length - base.split('\n').length
    expect(added).toBe(1)
    // Every comment the scaffold wrote survives, which is what a splice buys
    // over re-serialising the document.
    for (const line of base.split('\n')) expect(text).toContain(line)
  })

  it('keeps declaration order', () => {
    let text = registerModel(base, PROJECT_PATH, 'core', 'models/core.jsonld.yaml').text
    text = registerModel(text, PROJECT_PATH, 'shapes', 'models/shapes.jsonld.yaml').text
    const names = parseProject(text, PROJECT_PATH).project!.models.map((m) => m.name)
    expect(names).toEqual(['catalogue', 'core', 'shapes'])
  })

  // Re-running the command that created it is not an error; claiming a name
  // that already means something else is.
  it('is a no-op when the same model is already declared at the same path', () => {
    const result = registerModel(
      base,
      PROJECT_PATH,
      'catalogue',
      'models/catalogue.jsonld.yaml',
    )
    expect(result.changed).toBe(false)
    expect(result.text).toBe(base)
  })

  it('refuses to point an existing name at a different file', () => {
    expect(() =>
      registerModel(base, PROJECT_PATH, 'catalogue', 'models/other.jsonld.yaml'),
    ).toThrow(/already declares a model/)
  })

  it('refuses a second name for a file already declared', () => {
    expect(() =>
      registerModel(base, PROJECT_PATH, 'alias', 'models/catalogue.jsonld.yaml'),
    ).toThrow(/already declares/)
  })

  it('turns an empty flow mapping into a block mapping', () => {
    const empty = 'project: "1"\nname: suite\nmodels: {}\n'
    const { text } = registerModel(empty, PROJECT_PATH, 'core', 'core.jsonld.yaml')
    expect(text).toBe('project: "1"\nname: suite\nmodels:\n  core: core.jsonld.yaml\n')
  })

  it('refuses a file it cannot read as a project', () => {
    expect(() => registerModel('- a\n- b\n', PROJECT_PATH, 'core', 'core.jsonld.yaml')).toThrow(
      /mapping at its root/,
    )
    expect(() => registerModel('project: "1"\n', PROJECT_PATH, 'core', 'core.jsonld.yaml')).toThrow(
      /no `models` mapping/,
    )
  })
})
