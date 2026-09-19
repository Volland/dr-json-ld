import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jsonld from 'jsonld'

import { stripComments } from '../src/emit/emit.js'
import { checkProject } from '../src/project/check.js'
import { loadProject, PROJECT_FILE } from '../src/project/project.js'
import { selfPublishedResolver } from '../src/publish/self-resolver.js'
import { publish, verifyTree, versionPathFor } from '../src/publish/tree.js'
import { buildIndex, search } from '../src/search/index.js'
import { compareVersions } from '../src/diff/classify.js'
import { lockfileOf } from '../src/diff/lockfile.js'
import { AliasStore } from '../src/version/alias.js'
import { artifactFileFor } from '../src/version/create.js'
import { VersionStore } from '../src/version/store.js'

const ROOT = fileURLToPath(new URL('./fixtures/projects/versioned/', import.meta.url))

function load() {
  const { project, findings } = loadProject(join(ROOT, PROJECT_FILE))
  expect(findings.filter((f) => f.severity === 'error')).toEqual([])
  const versions = new VersionStore(project!.versionsDir)
  const aliases = new AliasStore(project!.versionsDir)
  return { project: project!, versions, aliases }
}

/**
 * The continuous-integration task: every fixture project checks, publishes for
 * every host adapter, verifies, and every example meets its declared outcome —
 * with the network off.
 *
 * @lat: [[emitters#Emitters#Verification]]
 */
describe('the versioned fixture project', () => {
  it('checks clean', () => {
    const { project } = load()
    const report = checkProject(project, {
      projectFindings: loadProject(project.file).findings,
    })
    const errors = report.findings.filter((f) => f.severity === 'error')
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([])
    expect(report.models.map((m) => m.model.name).sort()).toEqual(['catalogue', 'core'])
  })

  it('every version verifies', () => {
    const { versions } = load()
    const ids = versions.list()
    expect(ids.length).toBeGreaterThanOrEqual(2)
    for (const id of ids) {
      const result = versions.verify(id)
      expect(result.ok, `${id}: ${result.problems.map((p) => p.message).join('; ')}`).toBe(true)
      expect(result.lineageProblems, id).toEqual([])
    }
  })

  it('the published tree verifies against its own index', () => {
    const { project } = load()
    expect(verifyTree(project.publishedDir)).toEqual([])
  })

  it('republishing is a no-op, so the committed tree is what publishing produces', () => {
    const { project, versions, aliases } = load()
    const result = publish({
      project: project.name,
      hosts: project.hosts,
      directory: project.publishedDir,
      versions,
      aliases,
    })
    expect(result.unchanged).toBe(true)
  })

  it('is valid for every host the project names', () => {
    const { project } = load()
    expect(project.hosts).toEqual(['plain', 'github-pages', 's3'])
    // GitHub Pages required a side file, and it is committed.
    expect(existsSync(join(project.publishedDir, '.nojekyll'))).toBe(true)
  })
})

describe('one model building on a version its sibling published', () => {
  // @lat: [[processing#Processing#Context Resolution#Offline by default]]
  it('resolves the reference from the tree, with no network and no vendored copy', () => {
    const { project } = load()
    const catalogue = readFileSync(join(ROOT, 'models/catalogue.jsonld.yaml'), 'utf8')
    const iri = /iri: (\S+)/.exec(catalogue)![1]!

    expect(iri.startsWith(project.baseUrl!)).toBe(true)

    const original = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('resolving a self-published context reached the network')
    }) as typeof fetch
    try {
      const resolved = selfPublishedResolver({ project })(iri) as Record<string, unknown>
      expect(JSON.stringify(resolved)).toContain('core:title')
    } finally {
      globalThis.fetch = original
    }

    // Nothing was vendored: the bytes are already in the repository.
    expect(existsSync(join(ROOT, 'contexts'))).toBe(false)
  })

  it('the referenced version is the one the tree publishes', () => {
    const { project, versions } = load()
    const catalogue = readFileSync(join(ROOT, 'models/catalogue.jsonld.yaml'), 'utf8')
    const id = /core\/v\/([a-z0-9]{16})\//.exec(catalogue)![1]!

    expect(versions.exists(id)).toBe(true)
    expect(versions.readManifest(id).model).toBe('core')
    expect(existsSync(join(project.publishedDir, versionPathFor('core', id, 'context.jsonld')))).toBe(
      true,
    )
  })
})

describe('the published artifacts are executed, not only committed', () => {
  // @lat: [[emitters#Emitters#Verification]]
  it('an independent implementation round-trips the core example through the tree', async () => {
    const { project } = load()
    const example = JSON.parse(readFileSync(join(ROOT, 'documents/core-ok.json'), 'utf8'))
    const coreId = readFileSync(join(ROOT, 'models/catalogue.jsonld.yaml'), 'utf8').match(
      /core\/v\/([a-z0-9]{16})\//,
    )![1]!

    for (const file of ['context.jsonld', 'context.inline.jsonld']) {
      const path = join(project.publishedDir, versionPathFor('core', coreId, file))
      const artifact = JSON.parse(stripComments(readFileSync(path, 'utf8'))) as {
        '@context': unknown
      }

      const expanded = (await jsonld.expand({ ...artifact, ...example } as never)) as unknown[]
      const compacted = (await jsonld.compact(
        expanded as never,
        artifact['@context'] as never,
      )) as Record<string, unknown>
      const again = (await jsonld.expand(compacted as never)) as unknown[]

      expect(normalize(again), file).toEqual(normalize(expanded))
      expect(JSON.stringify(expanded), file).toContain('https://example.org/core#title')
    }
  })

  it('the published artifact names its own version and project', () => {
    const { project, versions } = load()
    for (const id of versions.list()) {
      const manifest = versions.readManifest(id)
      const text = readFileSync(
        join(project.publishedDir, versionPathFor(manifest.model, id, 'context.jsonld')),
        'utf8',
      )
      expect(text, id).toContain(`// Version: ${id}`)
      expect(text, id).toContain('published by the project versioned-suite')
    }
  })
})

describe('the fixture exercises comparison and search', () => {
  it('comparing the two models reports them as unrelated, not as edits', () => {
    const { versions } = load()
    const [a, b] = versions.list()
    const differences = compareVersions(lockfileOf(versions, a!), lockfileOf(versions, b!))
      .differences
    // Different models share no element ids, so every term is added or removed.
    expect(differences.length).toBeGreaterThan(0)
    expect(differences.every((d) => d.kind === 'term-added' || d.kind === 'term-removed' || d.kind.startsWith('namespace') || d.kind === 'prefix-changed')).toBe(true)
  })

  it('search finds a term from each published model', () => {
    const { versions } = load()
    const index = buildIndex({ versions })
    expect(index.skipped).toEqual([])

    expect(search(index, 'createdBy').results.length).toBeGreaterThan(0)
    expect(search(index, 'shelfMark').results.length).toBeGreaterThan(0)
    expect(search(index, 'looks after').results).toEqual([])
  })

  it('an alias points at the core version', () => {
    const { versions, aliases } = load()
    const stable = aliases.target('stable')
    expect(stable).toBeDefined()
    expect(versions.readManifest(stable!).model).toBe('core')
  })
})

describe('every version carries what a comparison needs', () => {
  it('a lockfile and every artifact', () => {
    const { versions } = load()
    for (const id of versions.list()) {
      const manifest = versions.readManifest(id)
      const paths = manifest.files.map((f) => f.path)
      expect(paths, id).toContain('lock.json')
      expect(paths, id).toContain('model.jsonld.yaml')
      expect(paths, id).toContain(artifactFileFor('context'))
      expect(paths, id).toContain(artifactFileFor('context-inline'))
      // Every id is written, which is what makes the comparison trustworthy.
      const ir = lockfileOf(versions, id)
      expect(ir.terms.every((t) => t.idWritten), id).toBe(true)
    }
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
