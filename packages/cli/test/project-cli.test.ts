import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE, run, type Io } from '../src/index.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const MODEL = `jsonld: "1"
project: suite
namespace:
  prefix: ex
  base: https://example.org/ns#
terms:
  curator:
    id: aaa111
    "@id": ex:curator
    note: Who looks after it.
examples: []
`

const PROJECT = `project: "1"
name: suite
baseUrl: https://vocab.example.org/
models:
  catalogue: catalogue.jsonld.yaml
hosts: [plain, github-pages]
`

interface Workspace {
  root: string
  io: Io
  out: string[]
  err: string[]
  reset(): void
}

function workspace(files: Record<string, string> = {}): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'ldm-pcli-'))
  dirs.push(root)
  for (const [path, content] of Object.entries({
    'ldm.project.yaml': PROJECT,
    'catalogue.jsonld.yaml': MODEL,
    ...files,
  })) {
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

/** Create a version and return its identity, read from the command's output. */
async function makeVersion(w: Workspace, args: string[] = []): Promise<string> {
  w.reset()
  const code = await run(['version', 'new', ...args], w.io)
  expect(code, w.err.join('\n')).toBe(EXIT_OK)
  const id = /^([a-z0-9]{16})/.exec(w.out.join('\n'))?.[1]
  expect(id, w.out.join('\n')).toBeDefined()
  return id!
}

describe('ldm version new', () => {
  // @lat: [[emitters#Emitters#Change Management]]
  it('creates a version from the project’s only model', async () => {
    const w = workspace()
    const id = await makeVersion(w)
    expect(w.out.join('\n')).toContain('created from catalogue')
    expect(existsSync(join(w.root, 'versions', id, 'manifest.json'))).toBe(true)
  })

  it('reports an unchanged model rather than creating a second copy', async () => {
    const w = workspace()
    const id = await makeVersion(w)
    w.reset()
    expect(await run(['version', 'new'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('unchanged')
    expect(w.out.join('\n')).toContain(id)
  })

  it('records a predecessor and sets an alias in one go', async () => {
    const w = workspace()
    const first = await makeVersion(w, ['--alias', 'stable'])
    writeFileSync(join(w.root, 'catalogue.jsonld.yaml'), MODEL.replace('ex:curator', 'ex:keeper'))

    w.reset()
    expect(await run(['version', 'new', '--after', 'stable', '--alias', 'stable'], w.io)).toBe(
      EXIT_OK,
    )
    expect(w.out.join('\n')).toContain(`Supersedes ${first}`)
    expect(w.out.join('\n')).toContain('now points at')
  })

  it('exits 2 when the project declares several models and none is named', async () => {
    const w = workspace({
      'other.jsonld.yaml': MODEL.replace('prefix: ex', 'prefix: ot').replace(
        'base: https://example.org/ns#',
        'base: https://example.org/other#',
      ),
      'ldm.project.yaml': PROJECT.replace(
        '  catalogue: catalogue.jsonld.yaml\n',
        '  catalogue: catalogue.jsonld.yaml\n  other: other.jsonld.yaml\n',
      ),
    })
    expect(await run(['version', 'new'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('must be named')
  })

  it('exits 2 for a model the project does not declare', async () => {
    const w = workspace()
    expect(await run(['version', 'new', 'ghost'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('declares no model named "ghost"')
    expect(w.err.join('\n')).toContain('catalogue')
  })

  it('exits 2 on a verb that is not `new`', async () => {
    const w = workspace()
    expect(await run(['version', 'rename', 'v1'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('name is its content hash')
  })
})

describe('ldm alias', () => {
  // @lat: [[emitters#Emitters#Change Management]]
  it('sets, lists, renames and removes without touching a version', async () => {
    const w = workspace()
    const id = await makeVersion(w)
    const manifestBefore = readFileSync(join(w.root, 'versions', id, 'manifest.json'), 'utf8')

    w.reset()
    expect(await run(['alias', 'set', 'stable', id], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain(`"stable" now points at ${id}`)

    w.reset()
    expect(await run(['alias', 'list'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('stable')

    w.reset()
    expect(await run(['alias', 'rename', 'stable', 'current'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('No version changed')

    w.reset()
    expect(await run(['alias', 'rm', 'current'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('No version changed')

    expect(readFileSync(join(w.root, 'versions', id, 'manifest.json'), 'utf8')).toBe(
      manifestBefore,
    )
  })

  it('says so when there are no aliases', async () => {
    const w = workspace()
    await makeVersion(w)
    w.reset()
    expect(await run(['alias', 'list'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('no aliases')
  })

  it('exits 2 on an unknown verb, and explains there is no version rename', async () => {
    const w = workspace()
    await makeVersion(w)
    expect(await run(['alias', 'frobnicate'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain("version's name is its content hash")
  })

  it('exits 1 when an alias points at a version that is gone', async () => {
    const w = workspace()
    const id = await makeVersion(w)
    await run(['alias', 'set', 'stable', id], w.io)
    rmSync(join(w.root, 'versions', id), { recursive: true })

    w.reset()
    expect(await run(['alias', 'list'], w.io)).toBe(EXIT_FINDINGS)
    expect(w.err.join('\n')).toContain('not present')
  })
})

describe('ldm clone', () => {
  it('clones a version by alias and records the origin', async () => {
    const w = workspace()
    const origin = await makeVersion(w, ['--alias', 'stable'])

    w.reset()
    expect(await run(['clone', 'stable'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain(`cloned from ${origin}`)

    const cloneId = /^([a-z0-9]{16})/.exec(w.out.join('\n'))![1]!
    expect(cloneId).not.toBe(origin)
    const manifest = JSON.parse(
      readFileSync(join(w.root, 'versions', cloneId, 'manifest.json'), 'utf8'),
    )
    expect(manifest.lineage.clonedFrom).toBe(origin)
  })

  it('exits 2 without a target', async () => {
    const w = workspace()
    expect(await run(['clone'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('required')
  })
})

describe('ldm publish', () => {
  // @lat: [[emitters#Emitters#Context Target]]
  it('writes the tree, names the hosts, and lists the side files each needed', async () => {
    const w = workspace()
    const id = await makeVersion(w, ['--alias', 'stable'])

    w.reset()
    expect(await run(['publish'], w.io), w.err.join('\n')).toBe(EXIT_OK)
    const output = w.out.join('\n')
    expect(output).toContain('plain, github-pages')
    expect(output).toContain('.nojekyll — required by github-pages')

    expect(existsSync(join(w.root, 'published', 'catalogue', 'v', id, 'context.jsonld'))).toBe(
      true,
    )
    expect(existsSync(join(w.root, 'published', 'catalogue', 'a', 'stable', 'context.jsonld'))).toBe(
      true,
    )
    expect(existsSync(join(w.root, 'published', '.nojekyll'))).toBe(true)
  })

  it('reports an unchanged tree on a second run', async () => {
    const w = workspace()
    await makeVersion(w)
    await run(['publish'], w.io)
    w.reset()
    expect(await run(['publish'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('unchanged')
  })

  it('exits 2 when there is nothing to publish', async () => {
    const w = workspace()
    expect(await run(['publish'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('ldm version new')
  })
})

describe('ldm diff', () => {
  async function twoVersions(w: Workspace): Promise<[string, string]> {
    const first = await makeVersion(w)
    writeFileSync(join(w.root, 'catalogue.jsonld.yaml'), MODEL.replace('ex:curator', 'ex:keeper'))
    const second = await makeVersion(w)
    return [first, second]
  }

  // @lat: [[emitters#Emitters#Change Management#Change Classification]]
  it('names the class of each difference', async () => {
    const w = workspace()
    const [first, second] = await twoVersions(w)

    w.reset()
    expect(await run(['diff', first, second], w.io)).toBe(EXIT_OK)
    const output = w.out.join('\n')
    expect(output).toContain('semantic')
    expect(output).toContain('means something else')
    expect(output).toContain('the most severe is semantic')
  })

  it('gates on a class, failing when a difference is at or above it', async () => {
    const w = workspace()
    const [first, second] = await twoVersions(w)

    w.reset()
    expect(await run(['diff', first, second, '--fail-on', 'breaking'], w.io)).toBe(EXIT_FINDINGS)
    expect(w.err.join('\n')).toContain('at or above "breaking"')

    w.reset()
    expect(await run(['diff', first, second, '--fail-on', 'illegal'], w.io)).toBe(EXIT_OK)
  })

  it('produces stable --json output across runs', async () => {
    const w = workspace()
    const [first, second] = await twoVersions(w)

    w.reset()
    await run(['diff', first, second, '--json'], w.io)
    const a = w.out.join('\n')
    w.reset()
    await run(['diff', first, second, '--json'], w.io)
    expect(w.out.join('\n')).toBe(a)
    expect(() => JSON.parse(a)).not.toThrow()
    expect(JSON.parse(a).worst).toBe('semantic')
  })

  it('reports no differences between a version and itself', async () => {
    const w = workspace()
    const id = await makeVersion(w)
    w.reset()
    expect(await run(['diff', id, id], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('No differences')
  })

  it('exits 2 on a bad gate and on a missing operand', async () => {
    const w = workspace()
    const id = await makeVersion(w)
    expect(await run(['diff', id], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('usage: ldm diff')

    w.reset()
    expect(await run(['diff', id, id, '--fail-on', 'catastrophic'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('--fail-on must be one of')
  })
})

describe('ldm search', () => {
  // @lat: [[processing#Processing#Context Resolution]]
  it('finds a term in a published version', async () => {
    const w = workspace()
    await makeVersion(w)
    w.reset()
    expect(await run(['search', 'curator'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('curator')
    expect(w.out.join('\n')).toContain('catalogue@')
  })

  it('matching nothing is a success, and says what was searched', async () => {
    const w = workspace()
    await makeVersion(w)
    w.reset()
    expect(await run(['search', 'nothing-like-this'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('Nothing matched')
    expect(w.out.join('\n')).toContain('1 published version')
  })

  it('produces stable --json output across runs', async () => {
    const w = workspace()
    await makeVersion(w)
    w.reset()
    await run(['search', 'curator', '--json'], w.io)
    const a = w.out.join('\n')
    w.reset()
    await run(['search', 'curator', '--json'], w.io)
    expect(w.out.join('\n')).toBe(a)
    expect(JSON.parse(a).results.length).toBeGreaterThan(0)
  })

  it('exits 2 without a query', async () => {
    const w = workspace()
    expect(await run(['search'], w.io)).toBe(EXIT_USAGE)
    expect(w.err.join('\n')).toContain('query is required')
  })
})

describe('ldm check over a project', () => {
  it('checks every model and names which produced each finding', async () => {
    const w = workspace()
    expect(await run(['check'], w.io), w.err.join('\n')).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('Checked the project "suite"')
    expect(w.out.join('\n')).toContain('catalogue: 0 finding')
  })

  it('exits 1 when a model in the project fails', async () => {
    const w = workspace({
      'catalogue.jsonld.yaml': MODEL.replace('"@id": ex:curator', '"@id": nope:curator'),
    })
    expect(await run(['check'], w.io)).toBe(EXIT_FINDINGS)
    expect(w.out.join('\n')).toContain('L1.unknown-prefix')
  })

  it('produces stable --json output', async () => {
    const w = workspace()
    await run(['check', '--json'], w.io)
    const a = w.out.join('\n')
    w.reset()
    await run(['check', '--json'], w.io)
    expect(w.out.join('\n')).toBe(a)
    expect(JSON.parse(a).project).toBe('suite')
  })

  it('still checks a single model by path, as it always did', async () => {
    const w = workspace()
    expect(await run(['check', 'catalogue.jsonld.yaml'], w.io)).toBe(EXIT_OK)
    expect(w.out.join('\n')).toContain('Checked catalogue.jsonld.yaml at L2.')
    expect(w.out.join('\n')).not.toContain('Checked the project')
  })
})

describe('no project', () => {
  it('a project verb outside a project exits 2 and says what to do', async () => {
    const w = workspace()
    rmSync(join(w.root, 'ldm.project.yaml'))
    for (const argv of [['publish'], ['version', 'new'], ['alias', 'list'], ['search', 'x']]) {
      w.reset()
      expect(await run(argv, w.io), argv.join(' ')).toBe(EXIT_USAGE)
      expect(w.err.join('\n')).toContain('ldm.project.yaml')
    }
  })

  it('single-model commands still work with no project at all', async () => {
    const w = workspace()
    rmSync(join(w.root, 'ldm.project.yaml'))
    w.reset()
    expect(await run(['check', 'catalogue.jsonld.yaml'], w.io)).toBe(EXIT_OK)
  })
})

describe('the usage text', () => {
  it('says there is no command that renames a version', async () => {
    const w = workspace()
    expect(await run(['--help'], w.io)).toBe(EXIT_OK)
    const usage = w.out.join('\n')
    expect(usage).toContain('no command that renames a version')
    expect(usage).toContain('ldm alias rename')
    expect(usage).toContain('Every command except `ldm vendor` runs with the network off.')
  })
})
