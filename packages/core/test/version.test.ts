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

import { stripComments } from '../src/emit/emit.js'
import {
  artifactFileFor,
  cloneVersion,
  createVersionFromModel,
  LOCKFILE,
  MODEL_FILE,
} from '../src/version/create.js'
import {
  identityOf,
  integrityOf,
  isVersionId,
  MANIFEST_FILE,
  manifestSelfHashMatches,
  parseManifest,
  VERSION_ID_LENGTH,
} from '../src/version/manifest.js'
import { VersionError, VersionStore } from '../src/version/store.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** A fixed moment, so an identity never depends on the clock. */
const CREATED = '2026-01-01T00:00:00Z'

const MODEL = `jsonld: "1"

namespace:
  prefix: ex
  base: https://example.org/ns#

terms:
  name:
    id: aaa111
    "@id": ex:name
    note: The display name.

  author:
    id: bbb222
    "@id": ex:author
    "@type": "@id"

examples: []
`

function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ldm-version-'))
  dirs.push(root)
  for (const [path, content] of Object.entries({ 'm.jsonld.yaml': MODEL, ...files })) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function storeIn(root: string): VersionStore {
  return new VersionStore(join(root, 'versions'))
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

describe('the manifest', () => {
  // @lat: [[emitters#Emitters#Change Management]]
  it('carries a hash for every file and one over itself', () => {
    const root = workspace()
    const store = storeIn(root)
    const { id, manifest } = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), {
      created: CREATED,
    })

    expect(isVersionId(id)).toBe(true)
    expect(id).toHaveLength(VERSION_ID_LENGTH)
    expect(manifest.files.map((f) => f.path)).toContain(MODEL_FILE)
    expect(manifest.files.map((f) => f.path)).toContain(LOCKFILE)
    expect(manifest.files.map((f) => f.path)).toContain(artifactFileFor('context'))

    for (const entry of manifest.files) {
      const content = readFileSync(join(store.pathFor(id), entry.path), 'utf8')
      expect(integrityOf(content), entry.path).toBe(entry.integrity)
    }
    expect(manifestSelfHashMatches(manifest)).toBe(true)
    expect(manifest.model).toBe('m')
    expect(manifest.created).toBe(CREATED)
    expect(manifest.manifest).toBe('1')
  })

  it('calls the hash `integrity`, because it is not a signature', () => {
    const root = workspace()
    const { id } = createVersionFromModel(storeIn(root), join(root, 'm.jsonld.yaml'), {
      created: CREATED,
    })
    const text = readFileSync(join(root, 'versions', id, MANIFEST_FILE), 'utf8')
    expect(text).toContain('"integrity"')
    expect(text).not.toContain('signature')
  })
})

describe('a version is addressed by its content', () => {
  // @lat: [[emitters#Emitters#Change Management]]
  it('derives its identity from its inputs, not from the generated artifacts', () => {
    const a = identityOf(
      [
        { path: MODEL_FILE, content: MODEL },
        { path: LOCKFILE, content: '{}' },
      ],
      'salt',
    )
    const b = identityOf(
      [
        { path: LOCKFILE, content: '{}' },
        { path: MODEL_FILE, content: MODEL },
      ],
      'salt',
    )
    // Input order does not matter; content does.
    expect(b).toBe(a)
    expect(
      identityOf([{ path: MODEL_FILE, content: `${MODEL}\n` }], 'salt'),
    ).not.toBe(a)
  })

  it('re-creating an unchanged model writes no second copy', () => {
    const root = workspace()
    const store = storeIn(root)
    const first = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    const before = snapshot(store.pathFor(first.id))

    const second = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), {
      created: '2027-06-06T12:00:00Z',
    })

    expect(second.id).toBe(first.id)
    expect(second.alreadyExisted).toBe(true)
    expect(store.list()).toEqual([first.id])
    expect(snapshot(store.pathFor(first.id))).toEqual(before)
  })

  it('a changed model produces a different identity', () => {
    const root = workspace()
    const store = storeIn(root)
    const first = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    writeFileSync(join(root, 'm.jsonld.yaml'), MODEL.replace('ex:name', 'ex:displayName'))
    const second = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })

    expect(second.id).not.toBe(first.id)
    expect(store.list().sort()).toEqual([first.id, second.id].sort())
  })

  // @lat: [[emitters#Emitters#Change Management]]
  it('an artifact names its own version, and the naming does not change the identity', () => {
    const root = workspace()
    const store = storeIn(root)
    const { id } = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), {
      created: CREATED,
      project: 'suite',
    })

    const artifact = store.readFile(id, artifactFileFor('context'))
    expect(artifact).toContain(`// Version: ${id}`)
    expect(artifact).toContain('published by the project suite')
    // Naming it did not move it: the version verifies and its id is unchanged.
    expect(store.verify(id).ok).toBe(true)
    expect(store.readManifest(id).id).toBe(id)
    // And the artifact is still loadable JSON once the commentary is stripped.
    expect(() => JSON.parse(stripComments(artifact))).not.toThrow()
  })

  it('an artifact emitted outside a version names no version', () => {
    const root = workspace()
    const { id } = createVersionFromModel(storeIn(root), join(root, 'm.jsonld.yaml'), {
      created: CREATED,
    })
    const inVersion = storeIn(root).readFile(id, artifactFileFor('context'))
    expect(inVersion).toContain('// Version:')
    // The unversioned path is covered by the emit tests; assert here only that
    // the version line is what distinguishes them.
    expect(inVersion.replace(/^\/\/ Version:.*$/m, '')).not.toContain('Version:')
  })
})

describe('a version is immutable once created', () => {
  // @lat: [[emitters#Emitters#Change Management]]
  it('refuses a write into an existing version, and changes nothing', () => {
    const root = workspace()
    const store = storeIn(root)
    const { id } = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    const before = snapshot(store.pathFor(id))

    expect(() => store.assertWritable(id)).toThrow(VersionError)
    try {
      store.assertWritable(id)
    } catch (error) {
      expect((error as Error).message).toContain(id)
      expect((error as Error).message).toContain('Create a new version instead')
    }
    expect(snapshot(store.pathFor(id))).toEqual(before)
  })

  it('correcting a mistake leaves the old version byte-identical', () => {
    const root = workspace()
    const store = storeIn(root)
    const first = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    const before = snapshot(store.pathFor(first.id))

    writeFileSync(join(root, 'm.jsonld.yaml'), MODEL.replace('ex:name', 'ex:properName'))
    const second = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), {
      created: CREATED,
      lineage: { predecessor: first.id },
    })

    expect(second.id).not.toBe(first.id)
    expect(snapshot(store.pathFor(first.id))).toEqual(before)
    expect(store.verify(first.id).ok).toBe(true)
    expect(store.readManifest(second.id).lineage.predecessor).toBe(first.id)
  })
})

describe('verification', () => {
  function versioned(): { root: string; store: VersionStore; id: string } {
    const root = workspace()
    const store = storeIn(root)
    const { id } = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    return { root, store, id }
  }

  it('passes on an untouched version', () => {
    const { store, id } = versioned()
    const result = store.verify(id)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  // @lat: [[emitters#Emitters#Verification]]
  it('fails on a file edited by hand, naming the file and both hashes', () => {
    const { store, id } = versioned()
    const target = join(store.pathFor(id), MODEL_FILE)
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n# tampered\n`)

    const result = store.verify(id)
    expect(result.ok).toBe(false)
    const problem = result.problems.find((p) => p.kind === 'file-hash')!
    expect(problem).toBeDefined()
    expect(problem.message).toContain(MODEL_FILE)
    expect(problem.message).toContain('Recorded sha256-')
    expect(problem.message).toContain('found sha256-')

    // And every command that reads it fails rather than using it.
    expect(() => store.readFile(id, MODEL_FILE)).toThrow(/does not match the manifest/)
  })

  /**
   * The self-hash is the difference between a checksum and a table of contents:
   * without it, editing a file *and* its entry would verify cleanly.
   */
  it('fails when the manifest is edited to match a hand-edited file', () => {
    const { store, id } = versioned()
    const target = join(store.pathFor(id), MODEL_FILE)
    const tampered = `${readFileSync(target, 'utf8')}\n# tampered\n`
    writeFileSync(target, tampered)

    // Update the entry so every per-file check would now pass.
    const manifestPath = join(store.pathFor(id), MANIFEST_FILE)
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'))
    const entry = manifest.files.find((f) => f.path === MODEL_FILE)!
    entry.integrity = integrityOf(tampered)
    entry.bytes = Buffer.byteLength(tampered, 'utf8')
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = store.verify(id)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.kind === 'file-hash')).toBe(false)
    const selfHash = result.problems.find((p) => p.kind === 'manifest-self-hash')!
    expect(selfHash).toBeDefined()
    expect(selfHash.message).toContain('does not match its own recorded hash')
  })

  it('fails on a recorded file that is gone', () => {
    const { store, id } = versioned()
    rmSync(join(store.pathFor(id), MODEL_FILE))
    const result = store.verify(id)
    expect(result.ok).toBe(false)
    expect(result.problems.find((p) => p.kind === 'file-missing')?.message).toContain(MODEL_FILE)
  })

  it('fails on a file the manifest does not record', () => {
    const { store, id } = versioned()
    writeFileSync(join(store.pathFor(id), 'smuggled.json'), '{}')
    const result = store.verify(id)
    expect(result.ok).toBe(false)
    expect(result.problems.find((p) => p.kind === 'file-unexpected')?.path).toBe('smuggled.json')
  })

  it('fails on a missing manifest', () => {
    const { store, id } = versioned()
    rmSync(join(store.pathFor(id), MANIFEST_FILE))
    const result = store.verify(id)
    expect(result.ok).toBe(false)
    expect(result.problems[0]!.kind).toBe('manifest-missing')
  })
})

describe('lineage', () => {
  // @lat: [[emitters#Emitters#Change Management]]
  it('a clone records its origin, and the origin is unchanged', () => {
    const root = workspace()
    const store = storeIn(root)
    const origin = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    const before = snapshot(store.pathFor(origin.id))

    const clone = cloneVersion(store, origin.id, { created: CREATED })

    expect(clone.id).not.toBe(origin.id)
    expect(store.readManifest(clone.id).lineage.clonedFrom).toBe(origin.id)
    expect(store.verify(clone.id).ok).toBe(true)
    expect(store.verify(origin.id).ok).toBe(true)
    expect(snapshot(store.pathFor(origin.id))).toEqual(before)
  })

  it('a clone has its origin’s inputs and its own identity in its artifacts', () => {
    const root = workspace()
    const store = storeIn(root)
    const origin = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    const clone = cloneVersion(store, origin.id, { created: CREATED })

    // The inputs are byte-identical.
    expect(store.readFile(clone.id, MODEL_FILE)).toBe(store.readFile(origin.id, MODEL_FILE))
    expect(store.readFile(clone.id, LOCKFILE)).toBe(store.readFile(origin.id, LOCKFILE))

    // The artifact names the clone, not the origin — an artifact served at the
    // clone's path must not claim to be its origin.
    const artifact = store.readFile(clone.id, artifactFileFor('context'))
    expect(artifact).toContain(`// Version: ${clone.id}`)
    expect(artifact).not.toContain(origin.id)
  })

  it('a version whose predecessor is gone still verifies, and the gap is reported', () => {
    const root = workspace()
    const store = storeIn(root)
    const first = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    writeFileSync(join(root, 'm.jsonld.yaml'), MODEL.replace('ex:name', 'ex:other'))
    const second = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), {
      created: CREATED,
      lineage: { predecessor: first.id },
    })

    rmSync(store.pathFor(first.id), { recursive: true })

    const result = store.verify(second.id)
    // Its own content is intact, so it verifies.
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
    // The broken link is reported separately.
    expect(result.lineageProblems.find((p) => p.kind === 'lineage-missing')?.message).toContain(
      first.id,
    )
  })

  it('refuses to clone a version that does not verify', () => {
    const root = workspace()
    const store = storeIn(root)
    const { id } = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    writeFileSync(join(store.pathFor(id), MODEL_FILE), 'tampered')
    expect(() => cloneVersion(store, id)).toThrow(/does not verify/)
  })
})

describe('what a version refuses', () => {
  // @lat: [[metamodel#Metamodel#Stable Element IDs]]
  it('refuses a model carrying derived element ids, naming them', () => {
    const root = workspace({
      'derived.jsonld.yaml': MODEL.replace(/^ {4}id: \w+\n/gm, ''),
    })
    expect(() =>
      createVersionFromModel(storeIn(root), join(root, 'derived.jsonld.yaml'), {
        created: CREATED,
      }),
    ).toThrow(/derived element ids/)

    try {
      createVersionFromModel(storeIn(root), join(root, 'derived.jsonld.yaml'), {
        created: CREATED,
      })
    } catch (error) {
      expect((error as Error).message).toContain('term "name"')
      expect((error as Error).message).toContain('ldm ids')
    }
  })

  it('refuses a model with an error finding, and creates nothing', () => {
    const root = workspace({
      'bad.jsonld.yaml': `jsonld: "1"\nnamespace: { prefix: ex, base: "https://example.org/ns#" }\nterms:\n  broken:\n    id: aaa111\n    "@id": nope:broken\n`,
    })
    const store = storeIn(root)
    expect(() =>
      createVersionFromModel(store, join(root, 'bad.jsonld.yaml'), { created: CREATED }),
    ).toThrow(/error finding/)
    expect(store.list()).toEqual([])
  })

  it('refuses a file path that would escape the version directory', () => {
    const root = workspace()
    const store = storeIn(root)
    expect(() =>
      store.create({
        model: 'm',
        id: 'a'.repeat(16),
        files: [{ path: '../escape.json', content: '{}' }],
      }),
    ).toThrow(/escape/)
  })

  it('refuses a caller-supplied manifest file', () => {
    const root = workspace()
    const store = storeIn(root)
    expect(() =>
      store.create({
        model: 'm',
        id: 'a'.repeat(16),
        files: [{ path: MANIFEST_FILE, content: '{}' }],
      }),
    ).toThrow(/may not include/)
  })

  it('refuses an identity that is not well formed', () => {
    const root = workspace()
    expect(() =>
      storeIn(root).create({ model: 'm', id: 'NOT-AN-ID', files: [] }),
    ).toThrow(/not a well-formed version identity/)
  })
})
