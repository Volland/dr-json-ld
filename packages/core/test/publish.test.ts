import { afterEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import jsonld from 'jsonld'

import { stripComments } from '../src/emit/emit.js'
import { adapterFor, checkPaths, sideFilesFor } from '../src/publish/host.js'
import {
  aliasPathFor,
  publish,
  PublishError,
  PUBLISHED_INDEX,
  verifyTree,
  versionPathFor,
  type PublishedIndex,
} from '../src/publish/tree.js'
import { AliasStore } from '../src/version/alias.js'
import { createVersionFromModel } from '../src/version/create.js'
import { VersionStore } from '../src/version/store.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const CREATED = '2026-01-01T00:00:00Z'

const MODEL = `jsonld: "1"
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
  - id: exa001
    path: documents/ok.json
    expect: { ok: true }
`

const EXAMPLE = JSON.stringify(
  {
    '@id': 'https://example.org/things/1',
    name: 'Ada Lovelace',
    author: { '@id': 'https://example.org/people/ada' },
  },
  null,
  2,
)

interface Fixture {
  root: string
  versions: VersionStore
  aliases: AliasStore
  tree: string
}

function fixture(model = MODEL): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'ldm-publish-'))
  dirs.push(root)
  write(root, 'm.jsonld.yaml', model)
  write(root, 'documents/ok.json', EXAMPLE)
  return {
    root,
    versions: new VersionStore(join(root, 'versions')),
    aliases: new AliasStore(join(root, 'versions')),
    tree: join(root, 'published'),
  }
}

function write(root: string, path: string, content: string): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function versionIn(f: Fixture, model = MODEL): string {
  writeFileSync(join(f.root, 'm.jsonld.yaml'), model)
  return createVersionFromModel(f.versions, join(f.root, 'm.jsonld.yaml'), {
    created: CREATED,
    project: 'suite',
  }).id
}

function publishFixture(f: Fixture, hosts: Parameters<typeof publish>[0]['hosts'] = ['plain']) {
  return publish({
    project: 'suite',
    hosts,
    directory: f.tree,
    versions: f.versions,
    aliases: f.aliases,
  })
}

function treeFiles(directory: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    const rel = prefix === '' ? entry : `${prefix}/${entry}`
    if (statSync(full).isDirectory()) out.push(...treeFiles(full, rel))
    else out.push(rel)
  }
  return out.sort()
}

describe('publishing writes a static tree', () => {
  // @lat: [[emitters#Emitters#Context Target]]
  it('puts every artifact under a path containing the version identity', () => {
    const f = fixture()
    const id = versionIn(f)
    const result = publishFixture(f)

    const expected = versionPathFor('m', id, 'context.jsonld')
    expect(result.files.has(expected)).toBe(true)
    expect(existsSync(join(f.tree, expected))).toBe(true)
    expect(treeFiles(f.tree)).toContain(expected)
    // Every artifact is reachable at a real path, with no server needed.
    expect(readFileSync(join(f.tree, expected), 'utf8')).toContain('"@context"')
  })

  it('publishes the manifest, so a consumer holding only the tree can verify', () => {
    const f = fixture()
    const id = versionIn(f)
    publishFixture(f)
    const manifest = JSON.parse(
      readFileSync(join(f.tree, versionPathFor('m', id, 'manifest.json')), 'utf8'),
    )
    expect(manifest.id).toBe(id)
    expect(manifest.files.length).toBeGreaterThan(0)
  })

  it('an alias path and a version path return the same bytes', () => {
    const f = fixture()
    const id = versionIn(f)
    f.aliases.set('stable', id, f.versions)
    publishFixture(f)

    const byVersion = readFileSync(join(f.tree, versionPathFor('m', id, 'context.jsonld')), 'utf8')
    const byAlias = readFileSync(
      join(f.tree, aliasPathFor('m', 'stable', 'context.jsonld')),
      'utf8',
    )
    expect(byAlias).toBe(byVersion)
  })

  it('needs no rewrite rule: every path in the index exists on disk', () => {
    const f = fixture()
    versionIn(f)
    publishFixture(f)
    const index = JSON.parse(readFileSync(join(f.tree, PUBLISHED_INDEX), 'utf8')) as PublishedIndex
    for (const version of index.versions) {
      for (const file of version.files) {
        expect(existsSync(join(f.tree, file)), file).toBe(true)
      }
    }
  })
})

describe('publishing is reproducible', () => {
  it('a second run reports no change and leaves every file byte-identical', () => {
    const f = fixture()
    versionIn(f)
    const first = publishFixture(f)
    const before = new Map(treeFiles(f.tree).map((p) => [p, readFileSync(join(f.tree, p), 'utf8')]))

    const second = publishFixture(f)

    expect(first.unchanged).toBe(false)
    expect(second.unchanged).toBe(true)
    const after = new Map(treeFiles(f.tree).map((p) => [p, readFileSync(join(f.tree, p), 'utf8')]))
    expect(after).toEqual(before)
  })

  it('removes an artifact that is no longer published, rather than serving it stale', () => {
    const f = fixture()
    versionIn(f)
    publishFixture(f)
    writeFileSync(join(f.tree, 'stale.jsonld'), '{}')

    publishFixture(f)
    expect(existsSync(join(f.tree, 'stale.jsonld'))).toBe(false)
  })
})

describe('host adapters', () => {
  // @lat: [[emitters#Emitters#Capability Matrix]]
  it('GitHub Pages requires .nojekyll, and publishing writes it', () => {
    const f = fixture()
    versionIn(f)
    const result = publishFixture(f, ['github-pages'])

    expect(existsSync(join(f.tree, '.nojekyll'))).toBe(true)
    expect(result.sideFiles.find((s) => s.path === '.nojekyll')?.hosts).toEqual(['github-pages'])
  })

  it('the plain host needs no side file', () => {
    expect(sideFilesFor(['plain'])).toEqual([])
  })

  it('publishing for several hosts satisfies both and says which asked for what', () => {
    const f = fixture()
    versionIn(f)
    const result = publishFixture(f, ['plain', 'github-pages', 's3'])
    expect(existsSync(join(f.tree, '.nojekyll'))).toBe(true)
    expect(result.sideFiles.map((s) => s.path)).toEqual(['.nojekyll'])
    // Every path satisfies every named host.
    expect(checkPaths(['plain', 'github-pages', 's3'], [...result.files.keys()])).toEqual([])
  })

  it('S3 refuses a key with no extension', () => {
    const violation = adapterFor('s3').checkPath('m/v/abc/context')!
    expect(violation).toBeDefined()
    expect(violation.constraint).toBe('missing extension')
    expect(violation.message).toContain('404')
  })

  it('GitHub Pages refuses a segment beginning with an underscore', () => {
    const violation = adapterFor('github-pages').checkPath('m/_v/abc/context.jsonld')!
    expect(violation.constraint).toBe('leading underscore')
    expect(violation.message).toContain('Jekyll')
  })

  it('every adapter refuses an unsafe character and a traversal segment', () => {
    for (const host of ['plain', 'github-pages', 's3'] as const) {
      expect(adapterFor(host).checkPath('m/v/a b/context.jsonld'), host).toBeDefined()
      expect(adapterFor(host).checkPath('m/../escape.jsonld'), host).toBeDefined()
    }
  })

  /**
   * The alias and project-model name patterns already refuse a leading
   * underscore, so this is a backstop rather than the first line of defence. It
   * is reached here through the model name a version records, which the store
   * takes as given.
   *
   * @lat: [[emitters#Emitters#Capability Matrix]]
   */
  it('a path a host cannot serve fails the publish and writes nothing', () => {
    const f = fixture()
    createVersionFromModel(f.versions, join(f.root, 'm.jsonld.yaml'), {
      created: CREATED,
      project: 'suite',
      modelName: '_internal',
    })

    expect(() => publishFixture(f, ['github-pages'])).toThrow(PublishError)
    try {
      publishFixture(f, ['github-pages'])
    } catch (error) {
      const publishError = error as PublishError
      expect(publishError.message).toContain('github-pages')
      expect(publishError.message).toContain('_internal')
      expect(publishError.violations.length).toBeGreaterThan(0)
      expect(publishError.violations[0]!.constraint).toBe('leading underscore')
    }
    // Nothing was written.
    expect(existsSync(f.tree)).toBe(false)
  })

  it('the same tree publishes fine for a host that allows it', () => {
    const f = fixture()
    const { id } = createVersionFromModel(f.versions, join(f.root, 'm.jsonld.yaml'), {
      created: CREATED,
      project: 'suite',
      modelName: '_internal',
    })
    expect(() => publishFixture(f, ['plain'])).not.toThrow()
    expect(existsSync(join(f.tree, versionPathFor('_internal', id, 'context.jsonld')))).toBe(true)
  })

  it('the alias layer refuses the name before a host ever sees it', () => {
    const f = fixture()
    const id = versionIn(f)
    expect(() => f.aliases.set('_internal', id, f.versions)).toThrow(/not a usable alias name/)
  })
})

describe('the published index', () => {
  it('names every version and alias, and which version each alias points at', () => {
    const f = fixture()
    const first = versionIn(f)
    const second = versionIn(f, MODEL.replace('ex:name', 'ex:displayName'))
    f.aliases.set('stable', first, f.versions)
    f.aliases.set('next', second, f.versions)

    const { index } = publishFixture(f)
    expect(index.versions.map((v) => v.id).sort()).toEqual([first, second].sort())
    expect(index.aliases).toEqual([
      { name: 'next', model: 'm', versionId: second },
      { name: 'stable', model: 'm', versionId: first },
    ])
    for (const version of index.versions) {
      expect(version.manifest).toMatch(/^sha256-/)
      expect(version.created).toBe(CREATED)
    }
  })

  it('verifies a well-formed tree', () => {
    const f = fixture()
    versionIn(f)
    publishFixture(f)
    expect(verifyTree(f.tree)).toEqual([])
  })

  it('reports a version the index does not name', () => {
    const f = fixture()
    versionIn(f)
    publishFixture(f)
    write(f.tree, `m/v/${'c'.repeat(16)}/context.jsonld`, '{}')

    const problems = verifyTree(f.tree)
    expect(problems.find((p) => p.kind === 'version-unlisted')?.subject).toBe('c'.repeat(16))
  })

  it('reports a file the index names and the tree lacks', () => {
    const f = fixture()
    const id = versionIn(f)
    publishFixture(f)
    rmSync(join(f.tree, versionPathFor('m', id, 'context.jsonld')))

    expect(verifyTree(f.tree).find((p) => p.kind === 'file-missing')?.subject).toBe(
      versionPathFor('m', id, 'context.jsonld'),
    )
  })

  it('reports a missing index', () => {
    const f = fixture()
    mkdirSync(f.tree, { recursive: true })
    expect(verifyTree(f.tree)[0]!.kind).toBe('index-missing')
  })
})

describe('publishing refuses what it cannot stand behind', () => {
  it('refuses to publish a version that does not verify', () => {
    const f = fixture()
    const id = versionIn(f)
    writeFileSync(join(f.versions.pathFor(id), 'model.jsonld.yaml'), 'tampered')

    expect(() => publishFixture(f)).toThrow(/does not verify/)
    expect(existsSync(f.tree)).toBe(false)
  })
})

describe('published artifacts are executed, not only written', () => {
  /**
   * The rule from `lat.md/emitters#Emitters#Verification`, applied to the tree:
   * what a consumer would fetch is what gets loaded.
   *
   * @lat: [[emitters#Emitters#Verification]]
   */
  it.each(['context.jsonld', 'context.inline.jsonld'])(
    'an independent implementation round-trips an example through the published %s',
    async (file) => {
      const f = fixture()
      const id = versionIn(f)
      f.aliases.set('stable', id, f.versions)
      publishFixture(f)

      for (const path of [
        versionPathFor('m', id, file),
        aliasPathFor('m', 'stable', file),
      ]) {
        const fetched = readFileSync(join(f.tree, path), 'utf8')
        const artifact = JSON.parse(stripComments(fetched)) as { '@context': unknown }
        const document = JSON.parse(EXAMPLE) as Record<string, unknown>

        const expanded = (await jsonld.expand({ ...artifact, ...document } as never)) as unknown[]
        const compacted = (await jsonld.compact(
          expanded as never,
          artifact['@context'] as never,
        )) as Record<string, unknown>
        const again = (await jsonld.expand(compacted as never)) as unknown[]

        expect(normalize(again), path).toEqual(normalize(expanded))
        expect(expanded.length, path).toBeGreaterThan(0)
        expect(JSON.stringify(expanded), path).toContain('https://example.org/ns#name')
      }
    },
  )

  it('the published artifact names its own version', () => {
    const f = fixture()
    const id = versionIn(f)
    publishFixture(f)
    const text = readFileSync(join(f.tree, versionPathFor('m', id, 'context.jsonld')), 'utf8')
    expect(text).toContain(`// Version: ${id}`)
    expect(text).toContain('published by the project suite')
  })
})

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = normalize((value as Record<string, unknown>)[key])
  }
  return out
}
