import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildIndex,
  describeNoMatch,
  formatResult,
  search,
  type SearchResult,
} from '../src/search/index.js'
import { createVersionFromModel, MODEL_FILE } from '../src/version/create.js'
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
  curator:
    id: aaa111
    "@id": ex:curator
    note: Who looks after the catalogue.
  shelfMark:
    id: bbb222
    "@id": ex:shelfMark
examples: []
`

const VENDORED = JSON.stringify(
  {
    '@context': {
      schema: 'https://schema.org/',
      name: 'https://schema.org/name',
      creator: { '@id': 'https://schema.org/creator', '@type': '@id' },
    },
  },
  null,
  2,
)

interface Fixture {
  root: string
  versions: VersionStore
  vendorDir: string
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'ldm-search-'))
  dirs.push(root)
  write(root, 'm.jsonld.yaml', MODEL)
  write(root, 'contexts/schema.org/index.jsonld', VENDORED)
  return {
    root,
    versions: new VersionStore(join(root, 'versions')),
    vendorDir: join(root, 'contexts'),
  }
}

function write(root: string, path: string, content: string): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function publishVersion(f: Fixture, model = MODEL): string {
  writeFileSync(join(f.root, 'm.jsonld.yaml'), model)
  return createVersionFromModel(f.versions, join(f.root, 'm.jsonld.yaml'), {
    created: CREATED,
    modelName: 'catalogue',
  }).id
}

function indexOf(f: Fixture) {
  return buildIndex({ versions: f.versions, vendorDir: f.vendorDir })
}

describe('search covers published versions and vendored contexts', () => {
  // @lat: [[processing#Processing#Context Resolution]]
  it('finds a term a vendored context already defines, before one is minted', () => {
    const f = fixture()
    const report = search(indexOf(f), 'creator')
    const result = report.results.find((r) => r.key === 'creator')!

    expect(result).toBeDefined()
    expect(result.iri).toBe('https://schema.org/creator')
    expect(result.source.kind).toBe('vendored')
    if (result.source.kind === 'vendored') {
      expect(result.source.path).toContain('schema.org')
    }
  })

  it('finds a term a published version defines, naming the version', () => {
    const f = fixture()
    const id = publishVersion(f)
    const result = search(indexOf(f), 'shelfMark').results[0]!

    expect(result.iri).toBe('https://example.org/ns#shelfMark')
    expect(result.source).toEqual({ kind: 'version', versionId: id, model: 'catalogue' })
  })

  it('returns both when a term exists in each, and each says which source', () => {
    const f = fixture()
    // `curator` is in the version; the vendored context gets one too.
    write(
      f.root,
      'contexts/other.example/index.jsonld',
      JSON.stringify({ '@context': { curator: 'https://other.example/curator' } }),
    )
    publishVersion(f)

    const results = search(indexOf(f), 'curator').results
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.source.kind).sort()).toEqual(['vendored', 'version'])
    for (const result of results) expect(result.matched.length).toBeGreaterThan(0)
  })
})

describe('what search matches', () => {
  it('matches a term key, and says the key matched', () => {
    const f = fixture()
    publishVersion(f)
    // A term's key usually appears in its IRI too, so this asserts the key was
    // reported rather than that it was the only field.
    expect(search(indexOf(f), 'shelf').results[0]!.matched).toContain('key')

    // A query matching only the key: the vendored `name` term's IRI is
    // `https://schema.org/name`, so searching the bare key alone is not
    // key-exclusive either — use a note-free term whose IRI differs.
    const keyOnly = search(indexOf(f), 'mark', { fields: ['key'] }).results[0]!
    expect(keyOnly.key).toBe('shelfMark')
    expect(keyOnly.matched).toEqual(['key'])
  })

  it('matches an IRI, and says the IRI matched', () => {
    const f = fixture()
    publishVersion(f)
    const results = search(indexOf(f), 'example.org/ns#shelfMark').results
    expect(results).toHaveLength(1)
    expect(results[0]!.matched).toEqual(['iri'])
  })

  it('matches a note, and says the note matched', () => {
    const f = fixture()
    publishVersion(f)
    const results = search(indexOf(f), 'looks after').results
    expect(results).toHaveLength(1)
    expect(results[0]!.key).toBe('curator')
    expect(results[0]!.matched).toEqual(['note'])
  })

  it('reports every field that matched', () => {
    const f = fixture()
    publishVersion(f)
    const result = search(indexOf(f), 'curator').results[0]!
    // The key and the IRI both contain it.
    expect(result.matched).toEqual(['key', 'iri'])
  })

  it('can be restricted to one field', () => {
    const f = fixture()
    publishVersion(f)
    const report = search(indexOf(f), 'curator', { fields: ['note'] })
    expect(report.results).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    const f = fixture()
    publishVersion(f)
    expect(search(indexOf(f), 'SHELFMARK').results).toHaveLength(1)
  })

  // @lat: [[processing#Processing#Context Resolution]]
  it('matching nothing is a success, and says what was searched', () => {
    const f = fixture()
    publishVersion(f)
    const report = search(indexOf(f), 'nothing-like-this')

    expect(report.results).toEqual([])
    const message = describeNoMatch(report)
    expect(message).toContain('Nothing matched')
    expect(message).toContain('1 published version')
    expect(message).toContain('1 vendored context')
  })
})

describe('search is offline', () => {
  // @lat: [[processing#Processing#Context Resolution#Offline by default]]
  it('completes with no network available', () => {
    const f = fixture()
    publishVersion(f)
    const original = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('search reached the network')
    }) as typeof fetch
    try {
      const report = search(indexOf(f), 'curator')
      expect(report.results.length).toBeGreaterThan(0)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('the index reflects what is present', () => {
  it('a newly published version is searchable immediately', () => {
    const f = fixture()
    expect(search(indexOf(f), 'shelfMark').results).toHaveLength(0)

    publishVersion(f)
    expect(search(indexOf(f), 'shelfMark').results).toHaveLength(1)
  })

  // @lat: [[emitters#Emitters#Verification]]
  it('a version that fails verification contributes nothing, and is reported', () => {
    const f = fixture()
    const id = publishVersion(f)
    writeFileSync(join(f.versions.pathFor(id), MODEL_FILE), 'tampered')

    const index = indexOf(f)
    expect(index.skipped).toHaveLength(1)
    expect(index.skipped[0]!.versionId).toBe(id)
    expect(index.skipped[0]!.reason).toContain('does not match the manifest')

    const report = search(index, 'shelfMark')
    expect(report.results).toHaveLength(0)
    expect(report.skipped).toEqual(index.skipped)
    expect(report.searched.versions).toBe(0)
  })

  it('a second version adds its terms without removing the first', () => {
    const f = fixture()
    const first = publishVersion(f)
    const second = publishVersion(f, MODEL.replace('shelfMark', 'callNumber'))

    // The lockfile records resolved IRIs, so the search is for the namespace
    // base rather than the compact form the model was written with.
    const results = search(indexOf(f), 'example.org/ns#').results
    const versions = new Set(
      results.map((r) => (r.source.kind === 'version' ? r.source.versionId : '')),
    )
    expect(versions).toEqual(new Set([first, second]))
  })
})

describe('search results are deterministic', () => {
  it('the same query twice returns the same results in the same order', () => {
    const f = fixture()
    publishVersion(f)
    publishVersion(f, MODEL.replace('shelfMark', 'callNumber'))

    const first = search(indexOf(f), 'e')
    const second = search(indexOf(f), 'e')
    expect(second.results).toEqual(first.results)
    expect(first.results.length).toBeGreaterThan(1)
  })

  it('formats one readable line per result', () => {
    const f = fixture()
    publishVersion(f)
    const result = search(indexOf(f), 'curator').results[0] as SearchResult
    const line = formatResult(result)
    expect(line).toContain('curator')
    expect(line).toContain('https://example.org/ns#curator')
    expect(line).toContain('catalogue@')
    expect(line).toContain('[key, iri]')
  })

  it('honours a limit without changing the order', () => {
    const f = fixture()
    publishVersion(f)
    const all = search(indexOf(f), 'e')
    const limited = search(indexOf(f), 'e', { limit: 1 })
    expect(limited.results).toEqual(all.results.slice(0, 1))
  })
})

describe('an empty index', () => {
  it('searches nothing and says so, rather than failing', () => {
    const report = search(buildIndex(), 'anything')
    expect(report.results).toEqual([])
    expect(describeNoMatch(report)).toContain('0 published versions')
    expect(describeNoMatch(report)).toContain('0 vendored contexts')
  })
})
