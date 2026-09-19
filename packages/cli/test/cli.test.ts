import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE, parseArgv, run, type Io } from '../src/index.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/**
 * A workspace on disk, driven through an `Io` whose `cwd` is that directory, so
 * a test exercises the same path a shell would without spawning one.
 */
function workspace(files: Record<string, string>): { root: string; io: Io; out: string[]; err: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'ldm-cli-'))
  dirs.push(root)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, content) => {
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content)
    },
    exists: (p) => existsSync(p),
    cwd: () => root,
  }
  return { root, io, out, err }
}

const CLEAN_MODEL = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#
terms:
  name:
    id: aaa111
    "@id": ex:name
  author:
    id: bbb222
    "@id": ex:author
    "@type": "@id"
examples:
  - id: e11111
    path: docs/ok.json
    expect: { ok: true }
`

const OK_DOCUMENT = JSON.stringify(
  { '@id': 'https://example.org/1', name: 'Ada', author: { '@id': 'https://example.org/2' } },
  null,
  2,
)

const LOSSY_DOCUMENT = JSON.stringify({ '@id': 'https://example.org/1', mystery: 'gone' }, null, 2)

describe('argument parsing', () => {
  it('reads flags with and without an equals sign', () => {
    const parsed = parseArgv(['check', 'm.yaml', '--level', 'L1', '--json'])
    expect(parsed.command).toBe('check')
    expect(parsed.positional).toEqual(['m.yaml'])
    expect(parsed.flags.get('level')).toBe('L1')
    expect(parsed.flags.get('json')).toBe(true)
    expect(parseArgv(['emit', 'm.yaml', '--target=context-inline']).flags.get('target')).toBe(
      'context-inline',
    )
  })
})

describe('usage errors', () => {
  // @lat: [[architecture#Architecture#Distribution]]
  it('exits 2 with no command', async () => {
    const { io, out } = workspace({})
    expect(await run([], io)).toBe(EXIT_USAGE)
    expect(out.join('\n')).toContain('ldm — author JSON-LD contexts')
  })

  it('exits 2 on an unknown command', async () => {
    const { io, err } = workspace({})
    expect(await run(['frobnicate'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('unknown command "frobnicate"')
  })

  it('exits 2 when the model is missing', async () => {
    const { io, err } = workspace({})
    expect(await run(['check'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('a model file is required')
    expect(await run(['check', 'nope.yaml'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('does not exist')
  })

  it('exits 2 on a bad flag value', async () => {
    const { io, err } = workspace({ 'm.jsonld.yaml': CLEAN_MODEL })
    expect(await run(['check', 'm.jsonld.yaml', '--level', 'L9'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--level must be L0, L1 or L2')
    expect(await run(['emit', 'm.jsonld.yaml', '--target', 'shacl'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--target must be context or context-inline')
  })

  it('reports that L3 is not available rather than checking it', async () => {
    const { io, err } = workspace({ 'm.jsonld.yaml': CLEAN_MODEL })
    expect(await run(['check', 'm.jsonld.yaml', '--level', 'L3'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('not available')
  })
})

describe('ldm check', () => {
  it('exits 0 on a clean model and names the level', async () => {
    const { io, out } = workspace({
      'm.jsonld.yaml': CLEAN_MODEL,
      'docs/ok.json': OK_DOCUMENT,
    })
    expect(await run(['check', 'm.jsonld.yaml'], io)).toBe(EXIT_OK)
    expect(out.join('\n')).toContain('Checked m.jsonld.yaml at L2.')
  })

  it('gates on the level it was asked for', async () => {
    const files = { 'm.jsonld.yaml': CLEAN_MODEL, 'docs/ok.json': LOSSY_DOCUMENT }

    const atL2 = workspace(files)
    expect(await run(['check', 'm.jsonld.yaml', '--json'], atL2.io)).toBe(EXIT_FINDINGS)
    const l2 = JSON.parse(atL2.out.join('\n'))
    expect(l2.level).toBe('L2')
    expect(l2.findings.some((f: { ruleId: string }) => f.ruleId === 'L2.key-dropped')).toBe(true)

    const atL1 = workspace(files)
    expect(await run(['check', 'm.jsonld.yaml', '--level', 'L1', '--json'], atL1.io)).toBe(EXIT_OK)
    const l1 = JSON.parse(atL1.out.join('\n'))
    expect(l1.level).toBe('L1')
    expect(l1.findings.every((f: { level: string }) => f.level !== 'L2')).toBe(true)
  })

  it('produces stable --json output across runs', async () => {
    const files = { 'm.jsonld.yaml': CLEAN_MODEL, 'docs/ok.json': LOSSY_DOCUMENT }
    const first = workspace(files)
    const second = workspace(files)
    await run(['check', 'm.jsonld.yaml', '--json'], first.io)
    await run(['check', 'm.jsonld.yaml', '--json'], second.io)
    expect(second.out.join('\n')).toBe(first.out.join('\n'))
    expect(() => JSON.parse(first.out.join('\n'))).not.toThrow()
  })

  it('exits 1 when an example does not meet its declared outcome', async () => {
    const { io } = workspace({ 'm.jsonld.yaml': CLEAN_MODEL, 'docs/ok.json': LOSSY_DOCUMENT })
    expect(await run(['check', 'm.jsonld.yaml'], io)).toBe(EXIT_FINDINGS)
  })
})

describe('ldm emit', () => {
  it('writes the artifact and names where it went', async () => {
    const { root, io, out } = workspace({ 'm.jsonld.yaml': CLEAN_MODEL })
    expect(await run(['emit', 'm.jsonld.yaml', '--out', 'build'], io)).toBe(EXIT_OK)
    const written = readFileSync(join(root, 'build', 'm.jsonld'), 'utf8')
    expect(written).toContain('Generated by jsonld-modeler from m.jsonld.yaml')
    expect(out.join('\n')).toContain('Wrote')
  })

  it('writes the inline target to its own file', async () => {
    const { root, io } = workspace({ 'm.jsonld.yaml': CLEAN_MODEL })
    await run(['emit', 'm.jsonld.yaml', '--target', 'context-inline', '--out', 'build'], io)
    expect(readFileSync(join(root, 'build', 'm.inline.jsonld'), 'utf8')).toContain(
      'Target: context-inline',
    )
  })

  it('prints to stdout with no --out', async () => {
    const { io, out } = workspace({ 'm.jsonld.yaml': CLEAN_MODEL })
    expect(await run(['emit', 'm.jsonld.yaml'], io)).toBe(EXIT_OK)
    expect(out.join('\n')).toContain('"@context"')
  })
})

describe('ldm ids', () => {
  it('backfills ids in place and reports each one', async () => {
    const withoutIds = CLEAN_MODEL.replace(/^ {4}id: \w+\n/gm, '').replace(
      '  - id: e11111\n',
      '  - ',
    )
    const { root, io, out } = workspace({ 'm.jsonld.yaml': withoutIds })
    expect(await run(['ids', 'm.jsonld.yaml'], io)).toBe(EXIT_OK)
    const after = readFileSync(join(root, 'm.jsonld.yaml'), 'utf8')
    expect(after).toMatch(/id: [a-z0-9]{6}/)
    expect(out.join('\n')).toContain('term name:')
  })

  it('says so when every id is already written', async () => {
    const { io, out } = workspace({ 'm.jsonld.yaml': CLEAN_MODEL })
    expect(await run(['ids', 'm.jsonld.yaml'], io)).toBe(EXIT_OK)
    expect(out.join('\n')).toContain('already carries a written id')
  })
})

describe('ldm import', () => {
  it('writes a model and reports what a context cannot carry', async () => {
    const { root, io, out } = workspace({
      'core.jsonld': JSON.stringify({
        '@context': { schema: 'https://schema.org/', name: 'schema:name' },
      }),
    })
    expect(await run(['import', 'core.jsonld', '--out', 'model.jsonld.yaml'], io)).toBe(EXIT_OK)
    const model = readFileSync(join(root, 'model.jsonld.yaml'), 'utf8')
    expect(model).toContain('jsonld: "1"')
    expect(model).toContain('name:')
    expect(out.join('\n')).toContain('Not recoverable from a @context')
    expect(out.join('\n')).toContain('class')
  })

  it('exits 2 when the context is not JSON', async () => {
    const { io, err } = workspace({ 'core.jsonld': 'not json' })
    expect(await run(['import', 'core.jsonld'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('not valid JSON')
  })
})

describe('ldm vendor', () => {
  const MODEL_WITH_USES = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#
uses:
  - iri: https://example.org/upstream.jsonld
    integrity: sha256-WRONG
terms:
  name:
    id: aaa111
    "@id": ex:name
`

  // @lat: [[processing#Processing#Context Resolution#Offline by default]]
  it('--check reports a missing vendored directory and exits 1, without fetching', async () => {
    const { io, out } = workspace({ 'm.jsonld.yaml': MODEL_WITH_USES })
    expect(await run(['vendor', 'm.jsonld.yaml', '--check'], io)).toBe(EXIT_FINDINGS)
    expect(out.join('\n')).toContain('missing')
  })

  it('--check reports a hash mismatch naming the entry', async () => {
    const body = JSON.stringify({ '@context': { name: 'https://schema.org/name' } })
    const { io, out } = workspace({
      'm.jsonld.yaml': MODEL_WITH_USES,
      'contexts/example.org/upstream.jsonld': body,
    })
    expect(await run(['vendor', 'm.jsonld.yaml', '--check'], io)).toBe(EXIT_FINDINGS)
    expect(out.join('\n')).toContain('mismatch')
    expect(out.join('\n')).toContain('https://example.org/upstream.jsonld')
  })

  it('every other command fails closed when the vendored directory is missing', async () => {
    const { io, out } = workspace({ 'm.jsonld.yaml': MODEL_WITH_USES })
    expect(await run(['check', 'm.jsonld.yaml', '--json'], io)).toBe(EXIT_FINDINGS)
    const report = JSON.parse(out.join('\n'))
    expect(
      report.findings.some((f: { ruleId: string }) => f.ruleId === 'L1.context-not-vendored'),
    ).toBe(true)
  })

  it('emit refuses to inline a context that is not vendored', async () => {
    const { io, err } = workspace({ 'm.jsonld.yaml': MODEL_WITH_USES })
    expect(await run(['emit', 'm.jsonld.yaml', '--target', 'context-inline'], io)).toBe(
      EXIT_FINDINGS,
    )
    expect(err.join('\n')).toContain('no artifact was generated')
  })
})

describe('ldm explain', () => {
  it('prints the expanded document and, with --trace, the steps', async () => {
    const files = {
      'm.jsonld.yaml': CLEAN_MODEL,
      'docs/ok.json': LOSSY_DOCUMENT,
    }
    const plain = workspace(files)
    expect(await run(['explain', 'm.jsonld.yaml', 'docs/ok.json'], plain.io)).toBe(EXIT_OK)
    expect(plain.out.join('\n')).toContain('Expanded docs/ok.json')
    expect(plain.out.join('\n')).not.toContain('Trace —')
    expect(plain.out.join('\n')).toContain('What this document lost')

    const traced = workspace(files)
    await run(['explain', 'm.jsonld.yaml', 'docs/ok.json', '--trace'], traced.io)
    expect(traced.out.join('\n')).toContain('Trace —')
    expect(traced.out.join('\n')).toContain('key "mystery" is dropped')
  })

  it('exits 2 without a document', async () => {
    const { io, err } = workspace({ 'm.jsonld.yaml': CLEAN_MODEL })
    expect(await run(['explain', 'm.jsonld.yaml'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('a document to explain is required')
  })
})
