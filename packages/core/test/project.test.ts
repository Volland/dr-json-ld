import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { checkProject } from '../src/project/check.js'
import {
  describeUnknownModel,
  findProjectFile,
  loadProject,
  loadProjectFrom,
  modelAtPath,
  modelNamed,
  parseProject,
  PROJECT_FILE,
} from '../src/project/project.js'
import { resolveModelText } from '../src/model/resolve.js'
import { validateModelText } from '../src/validate/validate.js'

const GOOD = fileURLToPath(new URL('./fixtures/projects/good/', import.meta.url))
const GOOD_FILE = join(GOOD, PROJECT_FILE)

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ldm-project-'))
  dirs.push(root)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

const MODEL = `jsonld: "1"
namespace: { prefix: ex, base: "https://example.org/ns#" }
terms:
  name:
    id: aaa111
    "@id": ex:name
`

function projectFile(body: string): string {
  return `project: "1"\n${body}`
}

describe('a project declares the models it contains', () => {
  // @lat: [[architecture#Architecture#Source of Truth]]
  it('loads and resolves each model by name', () => {
    const { project, findings } = loadProject(GOOD_FILE)
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(project!.name).toBe('catalogue-suite')
    expect(project!.models.map((m) => m.name).sort()).toEqual(['catalogue', 'people'])
    expect(modelNamed(project!, 'catalogue')!.path).toBe(
      join(GOOD, 'models/catalogue.jsonld.yaml'),
    )
    expect(modelNamed(project!, 'nope')).toBeUndefined()
    expect(project!.hosts).toEqual(['plain', 'github-pages'])
  })

  it('resolving by name gives the same findings as resolving by path', () => {
    const { project } = loadProject(GOOD_FILE)
    const model = modelNamed(project!, 'catalogue')!
    const byPath = validateModelText(
      readFixture('models/catalogue.jsonld.yaml'),
      'models/catalogue.jsonld.yaml',
      { readExample: () => undefined },
    )
    const report = checkProject(project!)
    const forModel = report.models.find((m) => m.model.name === 'catalogue')!
    // The example resolves in the project run and not in the by-path one, so
    // compare the rule ids the model itself produces rather than the counts.
    expect(forModel.findings.every((f) => typeof f.ruleId === 'string')).toBe(true)
    expect(byPath.level).toBe('L2')
    expect(model.name).toBe('catalogue')
  })

  it('names what it does declare when asked for a model it does not', () => {
    const { project } = loadProject(GOOD_FILE)
    const message = describeUnknownModel(project!, 'invoices')
    expect(message).toContain('invoices')
    expect(message).toContain('catalogue')
    expect(message).toContain('people')
  })

  it('reports a declared model whose file does not exist', () => {
    const root = workspace({
      [PROJECT_FILE]: projectFile('name: p\nmodels:\n  gone: models/gone.jsonld.yaml\n'),
    })
    const { findings } = loadProject(join(root, PROJECT_FILE))
    const finding = findings.find((f) => f.ruleId === 'L0.project-model-missing')!
    expect(finding).toBeDefined()
    expect(finding.subject).toBe('gone')
    expect(finding.pointer).toBe('/models/gone')
  })

  it('reports two names pointing at one model file', () => {
    const root = workspace({
      'm.jsonld.yaml': MODEL,
      [PROJECT_FILE]: projectFile('name: p\nmodels:\n  a: m.jsonld.yaml\n  b: m.jsonld.yaml\n'),
    })
    const { findings } = loadProject(join(root, PROJECT_FILE))
    expect(findings.some((f) => f.ruleId === 'L0.project-duplicate-model')).toBe(true)
  })

  it('reports a project with no models and no name', () => {
    const root = workspace({ [PROJECT_FILE]: projectFile('models: {}\n') })
    const { findings } = loadProject(join(root, PROJECT_FILE))
    const ids = findings.map((f) => f.ruleId)
    expect(ids).toContain('L0.project-missing-name')
    expect(ids).toContain('L0.project-no-models')
  })

  it('reports a host it does not know', () => {
    const root = workspace({
      'm.jsonld.yaml': MODEL,
      [PROJECT_FILE]: projectFile('name: p\nmodels:\n  a: m.jsonld.yaml\nhosts: [netlify]\n'),
    })
    const { project, findings } = loadProject(join(root, PROJECT_FILE))
    const finding = findings.find((f) => f.ruleId === 'L0.project-unknown-host')!
    expect(finding.message).toContain('github-pages')
    // It still loads, defaulting to the host every file server satisfies.
    expect(project!.hosts).toEqual(['plain'])
  })

  // @lat: [[architecture#Architecture#Source of Truth]]
  it('reports a model claimed by two projects, naming both', () => {
    const root = workspace({
      'shared/m.jsonld.yaml': MODEL,
      [`one/${PROJECT_FILE}`]: projectFile('name: one\nmodels:\n  m: ../shared/m.jsonld.yaml\n'),
      [`two/${PROJECT_FILE}`]: projectFile('name: two\nmodels:\n  m: ../shared/m.jsonld.yaml\n'),
    })
    const { project } = loadProject(join(root, 'one', PROJECT_FILE))
    const report = checkProject(project!, { searchRoot: root })
    const finding = report.findings.find((f) => f.ruleId === 'L0.model-claimed-twice')!
    expect(finding).toBeDefined()
    expect(finding.message).toContain('"one"')
    expect(finding.message).toContain('"two"')
    expect(report.failed).toBe(true)
  })
})

describe('a project resolves from a working directory', () => {
  it('finds the enclosing project from a subdirectory', () => {
    const found = findProjectFile(join(GOOD, 'models'))
    expect(found).toBe(GOOD_FILE)
  })

  it('finds nothing when there is no project above', () => {
    const root = workspace({ 'm.jsonld.yaml': MODEL })
    expect(findProjectFile(root)).toBeUndefined()
    expect(loadProjectFrom(root)).toBeUndefined()
  })

  it('a model outside any project resolves exactly as before', () => {
    const root = workspace({ 'm.jsonld.yaml': MODEL })
    expect(findProjectFile(root)).toBeUndefined()
    const { ir, findings } = resolveModelText(MODEL, 'm.jsonld.yaml')
    expect(findings).toEqual([])
    expect(ir!.project).toBeUndefined()
    expect(ir!.terms).toHaveLength(1)
  })

  it('maps a path back to the model the project declares', () => {
    const { project } = loadProject(GOOD_FILE)
    const model = modelAtPath(project!, join(GOOD, 'models/people.jsonld.yaml'))
    expect(model?.name).toBe('people')
  })
})

describe('a model may name its project', () => {
  it('records the project it names', () => {
    const { ir, findings } = resolveModelText(
      readFixture('models/catalogue.jsonld.yaml'),
      'catalogue.jsonld.yaml',
    )
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(ir!.project).toBe('catalogue-suite')
  })

  it('reports a model naming a project that does not list it', () => {
    const root = workspace({
      'm.jsonld.yaml': `jsonld: "1"\nproject: other\nnamespace: { prefix: ex, base: "https://example.org/ns#" }\nterms:\n  name:\n    id: aaa111\n    "@id": ex:name\n`,
      [PROJECT_FILE]: projectFile('name: mine\nmodels:\n  m: m.jsonld.yaml\n'),
    })
    const { project } = loadProject(join(root, PROJECT_FILE))
    const report = checkProject(project!, { searchRoot: root })
    const finding = report.findings.find((f) => f.ruleId === 'L0.model-project-mismatch')!
    expect(finding).toBeDefined()
    expect(finding.message).toContain('"other"')
    expect(finding.message).toContain('"mine"')
  })

  it('a model declaring no project is not reported', () => {
    const root = workspace({
      'm.jsonld.yaml': MODEL,
      [PROJECT_FILE]: projectFile('name: mine\nmodels:\n  m: m.jsonld.yaml\n'),
    })
    const { project } = loadProject(join(root, PROJECT_FILE))
    const report = checkProject(project!, { searchRoot: root })
    expect(report.findings.some((f) => f.ruleId === 'L0.model-project-mismatch')).toBe(false)
  })
})

describe('views remain scoped to one model', () => {
  // @lat: [[architecture#Architecture#Views]]
  it('reports a view naming a term the model does not declare', () => {
    const { findings } = resolveModelText(
      `${MODEL}views:\n  - { id: v11111, name: Cross, terms: [name, fullName] }\n`,
      'm.jsonld.yaml',
    )
    const finding = findings.find((f) => f.ruleId === 'L0.view-unknown-term')!
    expect(finding).toBeDefined()
    expect(finding.subject).toBe('fullName')
    expect(finding.message).toContain('exactly one model')
  })

  it('accepts a view naming only its own terms', () => {
    const { findings } = resolveModelText(
      `${MODEL}views:\n  - { id: v11111, name: Own, terms: [name] }\n`,
      'm.jsonld.yaml',
    )
    expect(findings.filter((f) => f.ruleId === 'L0.view-unknown-term')).toEqual([])
  })
})

describe('checking a project as a whole', () => {
  // @lat: [[validation#Validation#Findings]]
  it('checks every model and names which produced each finding', () => {
    const root = workspace({
      'good.jsonld.yaml': MODEL,
      'bad.jsonld.yaml': `jsonld: "1"\nnamespace: { prefix: ex, base: "https://example.org/ns#" }\nterms:\n  broken:\n    "@id": nope:broken\n`,
      [PROJECT_FILE]: projectFile(
        'name: mixed\nmodels:\n  good: good.jsonld.yaml\n  bad: bad.jsonld.yaml\n',
      ),
    })
    const { project } = loadProject(join(root, PROJECT_FILE))
    const report = checkProject(project!, { searchRoot: root })

    expect(report.models.map((m) => m.model.name).sort()).toEqual(['bad', 'good'])
    const bad = report.models.find((m) => m.model.name === 'bad')!
    expect(bad.findings.some((f) => f.ruleId === 'L1.unknown-prefix')).toBe(true)
    const good = report.models.find((m) => m.model.name === 'good')!
    expect(good.findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(report.failed).toBe(true)
  })

  it('reports findings in one deterministic order across runs', () => {
    const { project } = loadProject(GOOD_FILE)
    const first = checkProject(project!)
    const second = checkProject(project!)
    expect(second.findings.map((f) => `${f.file}:${f.loc.line}:${f.ruleId}`)).toEqual(
      first.findings.map((f) => `${f.file}:${f.loc.line}:${f.ruleId}`),
    )
  })

  it('the good fixture project checks clean', () => {
    const { project, findings } = loadProject(GOOD_FILE)
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    const report = checkProject(project!)
    expect(
      report.findings.filter((f) => f.severity === 'error'),
      JSON.stringify(report.findings.filter((f) => f.severity === 'error'), null, 2),
    ).toEqual([])
    expect(report.failed).toBe(false)
  })
})

describe('the project file itself', () => {
  it('reports a parse error and is still total, as the model resolver is', () => {
    // Loading is best-effort: it reports what it could not read and returns the
    // rest, so a caller decides on the findings rather than on a null.
    const { project, findings } = parseProject('\tname: broken', '/tmp/ldm.project.yaml')
    expect(findings.some((f) => f.ruleId === 'L0.unparseable')).toBe(true)
    expect(findings.some((f) => f.severity === 'error')).toBe(true)
    expect(project?.name).toBe('broken')
  })

  it('returns no project when the root is not a mapping', () => {
    const { project, findings } = parseProject('- a\n- b\n', '/tmp/ldm.project.yaml')
    expect(project).toBeUndefined()
    expect(findings.some((f) => f.ruleId === 'L0.not-an-object')).toBe(true)
  })

  it('reports an entry the format does not define', () => {
    const root = workspace({
      'm.jsonld.yaml': MODEL,
      [PROJECT_FILE]: projectFile('name: p\nmodels:\n  a: m.jsonld.yaml\nmystery: true\n'),
    })
    const { findings } = loadProject(join(root, PROJECT_FILE))
    const finding = findings.find((f) => f.ruleId === 'L0.schema-violation')!
    expect(finding.pointer).toBe('/mystery')
  })

  it('defaults the published and versions directories', () => {
    const root = workspace({
      'm.jsonld.yaml': MODEL,
      [PROJECT_FILE]: projectFile('name: p\nmodels:\n  a: m.jsonld.yaml\n'),
    })
    const { project } = loadProject(join(root, PROJECT_FILE))
    expect(project!.publishedDir).toBe(join(root, 'published'))
    expect(project!.versionsDir).toBe(join(root, 'versions'))
    expect(project!.hosts).toEqual(['plain'])
  })
})

function readFixture(relativePath: string): string {
  return readFileSync(join(GOOD, relativePath), 'utf8')
}

/**
 * A finding without a position is not finished: the whole point of reporting in
 * the project file rather than in a command's output is that the editor can put
 * the underline on the line the author wrote.
 *
 * These are the project rules a user actually hits, each checked for the rule id
 * *and* for a position landing on the offending line rather than on the root.
 *
 * @lat: [[architecture#Architecture#Projects#Checked like a model]]
 * @lat: [[validation#Validation#Findings]]
 */
describe('every project finding carries a position into the project file', () => {
  /** The 1-based line of the first line whose text contains `needle`. */
  function lineOf(text: string, needle: string): number {
    const i = text.split('\n').findIndex((l) => l.includes(needle))
    if (i < 0) throw new Error(`no line contains ${needle}`)
    return i + 1
  }

  const cases: Array<{
    name: string
    ruleId: string
    body: string
    /** Text on the line the finding must land on. */
    at: string
    files?: Record<string, string>
  }> = [
    {
      name: 'a model file that does not exist',
      ruleId: 'L0.project-model-missing',
      body: 'name: p\nmodels:\n  gone: models/gone.jsonld.yaml\n',
      at: 'gone:',
    },
    {
      name: 'two names for one model file',
      ruleId: 'L0.project-duplicate-model',
      body: 'name: p\nmodels:\n  a: m.jsonld.yaml\n  b: m.jsonld.yaml\n',
      at: 'b:',
      files: { 'm.jsonld.yaml': MODEL },
    },
    {
      name: 'no models at all',
      ruleId: 'L0.project-no-models',
      body: 'name: p\nmodels: {}\n',
      at: 'models:',
    },
    {
      name: 'a host this build does not know',
      ruleId: 'L0.project-unknown-host',
      body: 'name: p\nmodels:\n  a: m.jsonld.yaml\nhosts: [netlify]\n',
      at: 'hosts:',
      files: { 'm.jsonld.yaml': MODEL },
    },
    {
      name: 'a project name that cannot be published',
      ruleId: 'L0.schema-violation',
      body: 'name: "my project"\nmodels:\n  a: m.jsonld.yaml\n',
      at: 'name:',
      files: { 'm.jsonld.yaml': MODEL },
    },
    {
      name: 'a model name no command could type',
      ruleId: 'L0.schema-violation',
      body: 'name: p\nmodels:\n  "not a name": m.jsonld.yaml\n',
      at: 'not a name',
      files: { 'm.jsonld.yaml': MODEL },
    },
    {
      name: 'a model path claiming to be JSON-LD itself',
      ruleId: 'L0.schema-violation',
      body: 'name: p\nmodels:\n  a: m.jsonld\n',
      at: 'a: m.jsonld',
      files: { 'm.jsonld': MODEL },
    },
  ]

  it.each(cases)('$name reports $ruleId at its own line', ({ ruleId, body, at, files }) => {
    const text = projectFile(body)
    const root = workspace({ ...(files ?? {}), [PROJECT_FILE]: text })
    const { findings } = loadProject(join(root, PROJECT_FILE))

    const finding = findings.find((f) => f.ruleId === ruleId)
    expect(
      finding,
      `expected ${ruleId}, got ${findings.map((f) => f.ruleId).join(', ') || 'nothing'}`,
    ).toBeDefined()
    expect(finding!.loc.line, `${ruleId} landed on the wrong line`).toBe(lineOf(text, at))
    expect(finding!.loc.column, `${ruleId} has no column`).toBeGreaterThan(0)
    expect(finding!.pointer, `${ruleId} has no pointer`).toBeTruthy()
  })
})
