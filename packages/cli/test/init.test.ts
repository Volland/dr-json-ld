/**
 * `ldm init` and `ldm init model`.
 *
 * The thing worth asserting most is that the pair of files a bare `ldm init`
 * writes passes `ldm check` unaided, because that is the whole claim the
 * command makes.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { MODEL_SCAFFOLD } from '@jsonld-modeler/core'

import { EXIT_OK, EXIT_USAGE, run, type Io } from '../src/index.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

interface Workspace {
  root: string
  io: Io
  out: string[]
  err: string[]
  reset(): void
  read(path: string): string
}

/** A directory whose basename is a usable project name, so `init` needs no flags. */
function workspace(files: Record<string, string> = {}, name = 'catalogue-suite'): Workspace {
  const parent = mkdtempSync(join(tmpdir(), 'ldm-init-'))
  dirs.push(parent)
  const root = join(parent, name)
  mkdirSync(root, { recursive: true })
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  const out: string[] = []
  const err: string[] = []
  return {
    root,
    out,
    err,
    reset: () => {
      out.length = 0
      err.length = 0
    },
    read: (path) => readFileSync(join(root, path), 'utf8'),
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      readFile: (p) => readFileSync(p, 'utf8'),
      writeFile: (p, content) => {
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, content)
      },
      exists: (p) => existsSync(p),
      cwd: () => root,
    },
  }
}

describe('ldm init', () => {
  it('writes a project and its first model, and the pair checks clean', async () => {
    const w = workspace()
    expect(await run(['init'], w.io)).toBe(EXIT_OK)

    expect(existsSync(join(w.root, 'ldm.project.yaml'))).toBe(true)
    expect(w.read('models/catalogue-suite.jsonld.yaml')).toBe(MODEL_SCAFFOLD)

    w.reset()
    expect(await run(['check'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('No findings.')
  })

  it('names the project after the directory, and the model after the project', async () => {
    const w = workspace({}, 'vocab-suite')
    await run(['init'], w.io)
    expect(w.read('ldm.project.yaml')).toContain('name: vocab-suite')
    expect(w.read('ldm.project.yaml')).toContain(
      'vocab-suite: models/vocab-suite.jsonld.yaml',
    )
  })

  it('takes a namespace, so the first model need not carry the placeholder', async () => {
    const w = workspace()
    await run(
      ['init', '--prefix', 'cat', '--base', 'https://example.org/catalogue#'],
      w.io,
    )
    const model = w.read('models/catalogue-suite.jsonld.yaml')
    expect(model).toContain('prefix: cat')
    expect(model).toContain('base: https://example.org/catalogue#')
    expect(model).toContain('"@id": cat:name')
  })

  // A placeholder IRI resolves, validates and emits, so nothing downstream can
  // catch it. Saying so at creation is the only chance the tool gets.
  it('says out loud when the namespace is still the placeholder', async () => {
    const w = workspace()
    await run(['init'], w.io)
    expect(w.out.join('\n')).toContain('placeholder')

    w.reset()
    const other = workspace()
    await run(['init', '--prefix', 'cat', '--base', 'https://example.org/c#'], other.io)
    expect(other.out.join('\n')).not.toContain('placeholder')
  })

  it('writes the baseUrl and hosts a project was given', async () => {
    const w = workspace()
    await run(
      ['init', '--base-url', 'https://vocab.example.org/', '--host', 'plain,github-pages'],
      w.io,
    )
    const project = w.read('ldm.project.yaml')
    expect(project).toContain('baseUrl: https://vocab.example.org/')
    expect(project).toContain('hosts: [plain, github-pages]')
  })

  it('leaves baseUrl commented out when none was given', async () => {
    const w = workspace()
    await run(['init'], w.io)
    expect(w.read('ldm.project.yaml')).toContain('# baseUrl: https://vocab.example.org/')
  })

  it('refuses a second project in the same directory', async () => {
    const w = workspace()
    await run(['init'], w.io)
    w.reset()
    expect(await run(['init'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('already exists')
  })

  // Overwriting a model would destroy its element ids, and an element id is the
  // one thing in the file that cannot be reconstructed by reading it.
  it('refuses to overwrite a model that is already there', async () => {
    const w = workspace({ 'models/catalogue-suite.jsonld.yaml': 'jsonld: "1"\n' })
    expect(await run(['init'], w.io)).toBe(EXIT_USAGE)
    expect(w.read('models/catalogue-suite.jsonld.yaml')).toBe('jsonld: "1"\n')
  })

  it('refuses a namespace base that would run into its last segment', async () => {
    const w = workspace()
    expect(await run(['init', '--base', 'https://example.org/ns'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('must end in')
  })

  it('refuses a host it cannot validate a tree against', async () => {
    const w = workspace()
    expect(await run(['init', '--host', 'netlify'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('netlify')
  })

  it('refuses a subject it does not create', async () => {
    const w = workspace()
    expect(await run(['init', 'context'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('ldm init model')
  })
})

describe('ldm init model', () => {
  it('adds a model to the project and registers it, keeping the comments', async () => {
    const w = workspace()
    await run(['init'], w.io)
    const before = w.read('ldm.project.yaml')
    w.reset()

    expect(await run(['init', 'model', 'core'], w.io)).toBe(EXIT_OK)
    const after = w.read('ldm.project.yaml')

    expect(after).toContain('  core: models/core.jsonld.yaml')
    // A splice, not a re-serialisation: everything that was there is still there.
    for (const line of before.split('\n')) expect(after).toContain(line)

    w.reset()
    expect(await run(['check'], w.io)).toBe(EXIT_OK)
  })

  it('puts the model beside the ones the project already has', async () => {
    const w = workspace({
      'ldm.project.yaml': 'project: "1"\nname: suite\nmodels:\n  one: vocab/one.jsonld.yaml\n',
      'vocab/one.jsonld.yaml': MODEL_SCAFFOLD,
    })
    await run(['init', 'model', 'two'], w.io)
    expect(existsSync(join(w.root, 'vocab/two.jsonld.yaml'))).toBe(true)
    expect(w.read('ldm.project.yaml')).toContain('two: vocab/two.jsonld.yaml')
  })

  // A model without a project is a supported way to work, so this is not an
  // error — but the user is told what they have.
  it('writes a standalone model where there is no project, and says so', async () => {
    const w = workspace()
    expect(await run(['init', 'model', 'sketch'], w.io)).toBe(EXIT_OK)
    expect(w.read('sketch.jsonld.yaml')).toBe(MODEL_SCAFFOLD)
    expect(w.out.join('\n')).toContain('No project encloses')
  })

  it('refuses a name the project already uses', async () => {
    const w = workspace()
    await run(['init'], w.io)
    w.reset()
    expect(await run(['init', 'model', 'catalogue-suite', '--out', 'other.jsonld.yaml'], w.io)).toBe(
      EXIT_USAGE,
    )
    expect(w.err.join('\n')).toContain('already declares a model')
  })

  it('refuses a second name for a file the project already declares', async () => {
    const w = workspace()
    await run(['init'], w.io)
    w.reset()
    expect(
      await run(
        ['init', 'model', 'alias', '--out', 'models/catalogue-suite.jsonld.yaml'],
        w.io,
      ),
    ).toBe(EXIT_USAGE)
  })

  it('needs a name', async () => {
    const w = workspace()
    expect(await run(['init', 'model'], w.io)).toBe(EXIT_USAGE)
  })

  it('refuses an --out that is not a model file', async () => {
    const w = workspace()
    expect(await run(['init', 'model', 'core', '--out', 'core.yaml'], w.io)).toBe(EXIT_USAGE)
  })
})
