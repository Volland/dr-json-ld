import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadProject, PROJECT_FILE, type Project } from '../src/project/project.js'
import {
  asSelfReference,
  chainResolvers,
  selfPublishedResolver,
  SelfPublishedError,
} from '../src/publish/self-resolver.js'
import { publish, versionPathFor } from '../src/publish/tree.js'
import { AliasStore } from '../src/version/alias.js'
import { createVersionFromModel } from '../src/version/create.js'
import { VersionStore } from '../src/version/store.js'
import { resolveModelText } from '../src/model/resolve.js'
import { validateModelText } from '../src/validate/validate.js'
import { resolverFor } from '../src/vendor/vendor.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const CREATED = '2026-01-01T00:00:00Z'
const BASE_URL = 'https://vocab.example.org/'

const CORE_MODEL = `jsonld: "1"
project: suite
namespace:
  prefix: core
  base: https://example.org/core#
terms:
  title:
    id: aaa111
    "@id": core:title
examples: []
`

function fixture(): {
  root: string
  project: Project
  versions: VersionStore
  aliases: AliasStore
} {
  const root = mkdtempSync(join(tmpdir(), 'ldm-self-'))
  dirs.push(root)
  write(root, PROJECT_FILE, `project: "1"
name: suite
baseUrl: ${BASE_URL}
models:
  core: core.jsonld.yaml
`)
  write(root, 'core.jsonld.yaml', CORE_MODEL)
  const { project, findings } = loadProject(join(root, PROJECT_FILE))
  expect(findings.filter((f) => f.severity === 'error')).toEqual([])
  return {
    root,
    project: project!,
    versions: new VersionStore(join(root, 'versions')),
    aliases: new AliasStore(join(root, 'versions')),
  }
}

function write(root: string, path: string, content: string): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function publishCore(f: ReturnType<typeof fixture>): string {
  const { id } = createVersionFromModel(f.versions, join(f.root, 'core.jsonld.yaml'), {
    created: CREATED,
    project: 'suite',
    modelName: 'core',
  })
  publish({
    project: 'suite',
    hosts: f.project.hosts,
    directory: f.project.publishedDir,
    versions: f.versions,
    aliases: f.aliases,
  })
  return id
}

describe('recognising a self-published IRI', () => {
  // @lat: [[processing#Processing#Context Resolution]]
  it('matches a version path under the project base URL', () => {
    const f = fixture()
    const reference = asSelfReference(f.project, `${BASE_URL}core/v/abcdef0123456789/context.jsonld`)!
    expect(reference).toMatchObject({
      model: 'core',
      kind: 'version',
      ref: 'abcdef0123456789',
      file: 'context.jsonld',
    })
  })

  it('matches an alias path', () => {
    const f = fixture()
    expect(asSelfReference(f.project, `${BASE_URL}core/a/stable/context.jsonld`)).toMatchObject({
      kind: 'alias',
      ref: 'stable',
    })
  })

  it('does not match an IRI belonging to someone else', () => {
    const f = fixture()
    expect(asSelfReference(f.project, 'https://schema.org/')).toBeUndefined()
  })

  it('does not match when the project declares no base URL', () => {
    const f = fixture()
    const withoutBase: Project = { ...f.project }
    delete withoutBase.baseUrl
    expect(asSelfReference(withoutBase, `${BASE_URL}core/v/x/context.jsonld`)).toBeUndefined()
  })

  it('refuses an IRI under the base URL that names nothing publishable', () => {
    const f = fixture()
    expect(() => asSelfReference(f.project, `${BASE_URL}nonsense`)).toThrow(SelfPublishedError)
  })
})

describe('resolving from the published tree', () => {
  // @lat: [[processing#Processing#Context Resolution#Offline by default]]
  it('reads the artifact from the tree, and writes nothing into the vendor directory', () => {
    const f = fixture()
    const id = publishCore(f)

    const resolve = selfPublishedResolver({ project: f.project })
    const context = resolve(`${BASE_URL}core/v/${id}/context.jsonld`) as {
      '@context': Record<string, unknown>
    }

    expect(context['@context']).toBeDefined()
    expect(JSON.stringify(context)).toContain('core:title')
    // No vendored copy was created.
    expect(existsSync(join(f.root, 'contexts'))).toBe(false)
  })

  it('resolves through an alias to the version it points at', () => {
    const f = fixture()
    const id = publishCore(f)
    f.aliases.set('stable', id, f.versions)
    publish({
      project: 'suite',
      hosts: f.project.hosts,
      directory: f.project.publishedDir,
      versions: f.versions,
      aliases: f.aliases,
    })

    const resolve = selfPublishedResolver({ project: f.project })
    const byAlias = resolve(`${BASE_URL}core/a/stable/context.jsonld`)
    const byVersion = resolve(`${BASE_URL}core/v/${id}/context.jsonld`)
    expect(byAlias).toEqual(byVersion)
  })

  it('makes no network request', () => {
    const f = fixture()
    const id = publishCore(f)
    const original = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('a self-published resolution reached the network')
    }) as typeof fetch
    try {
      const resolve = selfPublishedResolver({ project: f.project })
      expect(resolve(`${BASE_URL}core/v/${id}/context.jsonld`)).toBeDefined()
    } finally {
      globalThis.fetch = original
    }
  })

  it('checks what it read against the hash the version records', () => {
    const f = fixture()
    const id = publishCore(f)
    // Tamper with the published artifact, leaving the manifest alone.
    writeFileSync(
      join(f.project.publishedDir, versionPathFor('core', id, 'context.jsonld')),
      '{"@context":{"title":"https://evil.example/title"}}',
    )

    const resolve = selfPublishedResolver({ project: f.project })
    expect(() => resolve(`${BASE_URL}core/v/${id}/context.jsonld`)).toThrow(
      /does not match the hash/,
    )
  })
})

describe('what self-published resolution refuses', () => {
  // @lat: [[processing#Processing#Context Resolution#Offline by default]]
  it('reports a version that is not published, and fetches nothing', () => {
    const f = fixture()
    publishCore(f)

    const resolve = selfPublishedResolver({ project: f.project })
    expect(() => resolve(`${BASE_URL}core/v/${'f'.repeat(16)}/context.jsonld`)).toThrow(
      SelfPublishedError,
    )
    try {
      resolve(`${BASE_URL}core/v/${'f'.repeat(16)}/context.jsonld`)
    } catch (error) {
      expect((error as Error).message).toContain('does not contain it')
      expect((error as Error).message).toContain('nothing was fetched')
    }
  })

  it('reports an alias the tree does not record', () => {
    const f = fixture()
    publishCore(f)
    const resolve = selfPublishedResolver({ project: f.project })
    expect(() => resolve(`${BASE_URL}core/a/ghost/context.jsonld`)).toThrow(/no such alias/)
  })

  it('reports a missing published tree, directing the author to publish', () => {
    const f = fixture()
    const resolve = selfPublishedResolver({ project: f.project })
    expect(() => resolve(`${BASE_URL}core/v/${'a'.repeat(16)}/context.jsonld`)).toThrow(
      /ldm publish/,
    )
  })
})

describe('the resolver chain', () => {
  it('prefers the self-published tree and falls through to the vendored one', () => {
    const f = fixture()
    const id = publishCore(f)

    const { ir } = resolveModelText(CORE_MODEL, 'core.jsonld.yaml')
    const chained = chainResolvers(
      selfPublishedResolver({ project: f.project }),
      resolverFor(ir!, f.root),
    )

    expect(chained(`${BASE_URL}core/v/${id}/context.jsonld`)).toBeDefined()
    // Anything else falls through, and is simply not vendored here.
    expect(chained('https://schema.org/')).toBeUndefined()
  })

  it('a model referencing a self-published version validates with no vendor finding', () => {
    const f = fixture()
    const id = publishCore(f)

    const consumer = `jsonld: "1"
project: suite
namespace:
  prefix: app
  base: https://example.org/app#
uses:
  - iri: ${BASE_URL}core/v/${id}/context.jsonld
    integrity: self-published
terms:
  label:
    id: bbb222
    "@id": app:label
examples: []
`
    const report = validateModelText(consumer, 'consumer.jsonld.yaml', {
      resolveContext: selfPublishedResolver({ project: f.project }),
    })
    // The context resolved, so nothing reports it as unvendored.
    expect(report.findings.some((finding) => finding.ruleId === 'L1.context-not-vendored')).toBe(
      false,
    )
  })
})
