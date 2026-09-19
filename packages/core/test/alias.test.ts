import { afterEach, describe, expect, it } from 'vitest'
import {
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

import { AliasError, AliasStore } from '../src/version/alias.js'
import { artifactFileFor, createVersionFromModel } from '../src/version/create.js'
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
examples: []
`

function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ldm-alias-'))
  dirs.push(root)
  for (const [path, content] of Object.entries({ 'm.jsonld.yaml': MODEL, ...files })) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function snapshot(directory: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry)
      const rel = prefix === '' ? entry : `${prefix}/${entry}`
      if (statSync(full).isDirectory()) walk(full, rel)
      else out.set(rel, readFileSync(full, 'utf8'))
    }
  }
  walk(directory, '')
  return out
}

/** A store with one version in it. */
function seeded(): { root: string; versions: VersionStore; aliases: AliasStore; id: string } {
  const root = workspace()
  const versions = new VersionStore(join(root, 'versions'))
  const aliases = new AliasStore(join(root, 'versions'))
  const { id } = createVersionFromModel(versions, join(root, 'm.jsonld.yaml'), {
    created: CREATED,
  })
  return { root, versions, aliases, id }
}

describe('an alias is a movable name for a version', () => {
  // @lat: [[emitters#Emitters#Change Management]]
  it('points at a version, and lists what it points at', () => {
    const { versions, aliases, id } = seeded()
    aliases.set('stable', id, versions)
    expect(aliases.target('stable')).toBe(id)
    expect(aliases.list()).toEqual([{ name: 'stable', versionId: id }])
    expect(aliases.resolve('stable', versions)).toBe(id)
  })

  it('a version needs no alias to exist', () => {
    const { versions, aliases, id } = seeded()
    expect(versions.exists(id)).toBe(true)
    expect(aliases.list()).toEqual([])
    expect(versions.verify(id).ok).toBe(true)
  })

  /**
   * The asymmetry that resolves the tension between immutability and human
   * names: the alias file is not part of any version.
   */
  it('creating, retargeting, renaming and deleting leave every version byte-identical', () => {
    const { root, versions, aliases, id } = seeded()
    writeFileSync(join(root, 'm.jsonld.yaml'), MODEL.replace('ex:name', 'ex:other'))
    const second = createVersionFromModel(versions, join(root, 'm.jsonld.yaml'), {
      created: CREATED,
    })

    const before = new Map([
      [id, snapshot(versions.pathFor(id))],
      [second.id, snapshot(versions.pathFor(second.id))],
    ])

    aliases.set('stable', id, versions)
    aliases.set('stable', second.id, versions)
    aliases.rename('stable', 'current')
    aliases.set('latest', second.id, versions)
    aliases.delete('current')

    for (const [versionId, files] of before) {
      expect(snapshot(versions.pathFor(versionId)), versionId).toEqual(files)
      expect(versions.verify(versionId).ok, versionId).toBe(true)
    }
  })

  it('renaming resolves under the new name and not the old one', () => {
    const { versions, aliases, id } = seeded()
    aliases.set('v1', id, versions)
    aliases.rename('v1', 'v2')

    expect(aliases.target('v2')).toBe(id)
    expect(aliases.target('v1')).toBeUndefined()
    expect(() => aliases.resolve('v1', versions)).toThrow(AliasError)
    // And the version it points at is untouched.
    expect(versions.verify(id).ok).toBe(true)
  })

  it('refuses renaming onto a name already in use', () => {
    const { versions, aliases, id } = seeded()
    aliases.set('a', id, versions)
    aliases.set('b', id, versions)
    expect(() => aliases.rename('a', 'b')).toThrow(/already exists/)
  })

  it('refuses renaming an alias that does not exist', () => {
    const { aliases } = seeded()
    expect(() => aliases.rename('ghost', 'other')).toThrow(/no alias named "ghost"/)
  })
})

describe('what an alias refuses', () => {
  it('refuses to point at a version that does not exist', () => {
    const { versions, aliases } = seeded()
    expect(() => aliases.set('stable', 'a'.repeat(16), versions)).toThrow(
      /no such version exists/,
    )
    expect(aliases.list()).toEqual([])
  })

  // @lat: [[emitters#Emitters#Change Management]]
  it('refuses a name shaped like a version identity', () => {
    const { versions, aliases, id } = seeded()
    expect(() => aliases.set(id, id, versions)).toThrow(/shape of a version identity/)
    expect(() => aliases.set('a'.repeat(16), id, versions)).toThrow(/ambiguous/)
    expect(aliases.list()).toEqual([])
  })

  it('refuses a name a path could not carry', () => {
    const { versions, aliases, id } = seeded()
    for (const bad of ['../escape', 'has space', '-leading', '']) {
      expect(() => aliases.set(bad, id, versions), bad).toThrow(AliasError)
    }
  })

  it('reports an alias whose version has gone', () => {
    const { versions, aliases, id } = seeded()
    aliases.set('stable', id, versions)
    rmSync(versions.pathFor(id), { recursive: true })

    expect(aliases.dangling(versions)).toEqual([{ name: 'stable', versionId: id }])
    expect(() => aliases.resolve('stable', versions)).toThrow(/is not present/)
  })

  it('resolves an identity directly, without needing an alias', () => {
    const { versions, aliases, id } = seeded()
    expect(aliases.resolve(id, versions)).toBe(id)
  })

  it('reports a name that is neither', () => {
    const { versions, aliases } = seeded()
    expect(() => aliases.resolve('mystery', versions)).toThrow(
      /neither a version in this store nor an alias/,
    )
  })
})

describe('the correction workflow', () => {
  /**
   * The reason aliases exist: a published URL survives a correction, and what it
   * corrected is still there for anyone who pinned it.
   *
   * @lat: [[emitters#Emitters#Change Management]]
   */
  it('publish, find a mistake, publish again, retarget — the old version is still readable', () => {
    const { root, versions, aliases, id: first } = seeded()

    // `stable` is what consumers were told to use.
    aliases.set('stable', first, versions)
    const firstArtifact = versions.readFile(first, artifactFileFor('context'))
    expect(firstArtifact).toContain('ex:name')

    // The mistake: the IRI was wrong.
    writeFileSync(join(root, 'm.jsonld.yaml'), MODEL.replace('ex:name', 'ex:properName'))
    const second = createVersionFromModel(versions, join(root, 'm.jsonld.yaml'), {
      created: CREATED,
      lineage: { predecessor: first },
    })

    // Retarget the label. Nothing is edited; nothing is deleted.
    aliases.set('stable', second.id, versions)

    expect(aliases.resolve('stable', versions)).toBe(second.id)
    expect(versions.readFile(second.id, artifactFileFor('context'))).toContain('ex:properName')

    // The old version remains readable at its own identity, and still verifies.
    expect(versions.exists(first)).toBe(true)
    expect(versions.verify(first).ok).toBe(true)
    expect(versions.readFile(first, artifactFileFor('context'))).toBe(firstArtifact)

    // And the new version records what it superseded.
    expect(versions.readManifest(second.id).lineage.predecessor).toBe(first)
  })
})

describe('the alias file', () => {
  it('is written in a canonical order, so a retarget is a one-line diff', () => {
    const { versions, aliases, id } = seeded()
    aliases.set('zebra', id, versions)
    aliases.set('alpha', id, versions)
    const text = readFileSync(aliases.file, 'utf8')
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zebra'))
  })

  it('reads as empty when it does not exist yet', () => {
    const { aliases } = seeded()
    expect(aliases.read().targets).toEqual({})
    expect(aliases.list()).toEqual([])
  })

  it('reports an unreadable alias file rather than treating it as empty', () => {
    const { aliases } = seeded()
    mkdirSync(dirname(aliases.file), { recursive: true })
    writeFileSync(aliases.file, 'not json')
    expect(() => aliases.read()).toThrow(/unreadable/)
  })
})
