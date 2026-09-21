import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  atOrAbove,
  CHANGE_CLASSES,
  CLASS_ORDER,
  compareVersions,
  CompareRefused,
  isChangeClass,
  type Difference,
} from '../src/diff/classify.js'
import { isCanonical, lockfileOf, parseLockfile } from '../src/diff/lockfile.js'
import { resolveModelText } from '../src/model/resolve.js'
import { serializeIr } from '../src/model/serialize.js'
import { createVersionFromModel, LOCKFILE } from '../src/version/create.js'
import { VersionStore } from '../src/version/store.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const CREATED = '2026-01-01T00:00:00Z'

const BASE = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#
mode: "1.1"
prefixes:
  schema: https://schema.org/
terms:
  name:
    id: aaa111
    "@id": ex:name
  author:
    id: bbb222
    "@id": ex:author
    "@type": "@id"
  locked:
    id: ccc333
    "@id": ex:locked
    "@protected": true
examples: []
`

function irOf(text: string) {
  const { ir, findings } = resolveModelText(text, 'm.jsonld.yaml')
  expect(findings.filter((f) => f.severity === 'error'), text.slice(0, 40)).toEqual([])
  return ir!
}

/** Compare the base model against an edited copy of it. */
function diff(edit: (text: string) => string): Difference[] {
  return compareVersions(irOf(BASE), irOf(edit(BASE))).differences
}

function only(differences: Difference[], subject: string): Difference {
  const matched = differences.filter((d) => d.subject === subject)
  expect(matched, `expected one difference for ${subject}, got ${JSON.stringify(differences)}`)
    .toHaveLength(1)
  return matched[0]!
}

describe('the lockfile', () => {
  // @lat: [[emitters#Emitters#Change Management#Lockfile]]
  it('is canonical, and round-trips back into an IR', () => {
    const text = serializeIr(irOf(BASE))
    expect(isCanonical(text)).toBe(true)
    const back = parseLockfile(text)
    expect(back.terms.map((t) => t.id)).toEqual(['aaa111', 'bbb222', 'ccc333'])
    expect(serializeIr(back)).toBe(text)
  })

  it('is byte-identical when only the declaration order changed', () => {
    const reordered = `jsonld: "1"
namespace:
  base: https://example.org/ns#
  prefix: ex
mode: "1.1"
prefixes:
  schema: https://schema.org/
terms:
  locked:
    id: ccc333
    "@protected": true
    "@id": ex:locked
  author:
    "@type": "@id"
    id: bbb222
    "@id": ex:author
  name:
    id: aaa111
    "@id": ex:name
examples: []
`
    expect(serializeIr(irOf(reordered))).toBe(serializeIr(irOf(BASE)))
    expect(compareVersions(irOf(BASE), irOf(reordered)).differences).toEqual([])
  })

  it('reports an unreadable lockfile rather than guessing', () => {
    expect(() => parseLockfile('not json')).toThrow(/not valid JSON/)
    expect(() => parseLockfile('[]')).toThrow(/does not contain a mapping/)
    expect(() => parseLockfile('{"namespace":{}}')).toThrow(/records no `terms`/)
  })

  // @lat: [[emitters#Emitters#Change Management#Lockfile]]
  it('lets two versions be compared with neither model file present', () => {
    const root = mkdtempSync(join(tmpdir(), 'ldm-diff-'))
    dirs.push(root)
    const write = (text: string): void => {
      mkdirSync(dirname(join(root, 'm.jsonld.yaml')), { recursive: true })
      writeFileSync(join(root, 'm.jsonld.yaml'), text)
    }
    const store = new VersionStore(join(root, 'versions'))

    write(BASE)
    const first = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })
    write(BASE.replace('"@id": ex:name', '"@id": ex:displayName'))
    const second = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })

    // The working tree no longer holds either version's model.
    rmSync(join(root, 'm.jsonld.yaml'))

    const differences = compareVersions(
      lockfileOf(store, first.id),
      lockfileOf(store, second.id),
    ).differences
    expect(differences).toHaveLength(1)
    expect(differences[0]!.kind).toBe('term-iri-changed')
    expect(differences[0]!.class).toBe('semantic')
  })

  it('reads the lockfile through the manifest, so a tampered one is refused', () => {
    const root = mkdtempSync(join(tmpdir(), 'ldm-diff-'))
    dirs.push(root)
    writeFileSync(join(root, 'm.jsonld.yaml'), BASE)
    const store = new VersionStore(join(root, 'versions'))
    const { id } = createVersionFromModel(store, join(root, 'm.jsonld.yaml'), { created: CREATED })

    writeFileSync(join(store.pathFor(id), LOCKFILE), '{"namespace":{},"terms":[]}')
    expect(() => lockfileOf(store, id)).toThrow(/does not match the manifest/)
  })
})

describe('differences are matched by element id', () => {
  // @lat: [[metamodel#Metamodel#Identity]]
  it('a renamed term is one change, not a removal and an addition', () => {
    const differences = diff((t) => t.replace('  name:\n', '  displayName:\n'))
    expect(differences).toHaveLength(1)
    expect(differences[0]).toMatchObject({
      elementId: 'aaa111',
      kind: 'term-key-changed',
      before: 'name',
      after: 'displayName',
    })
    expect(differences.some((d) => d.kind === 'term-removed')).toBe(false)
    expect(differences.some((d) => d.kind === 'term-added')).toBe(false)
  })

  it('a retyped term is one change, matched through the rename', () => {
    const differences = diff((t) =>
      t.replace('  name:\n    id: aaa111\n    "@id": ex:name', '  label:\n    id: aaa111\n    "@id": ex:label'),
    )
    expect(differences.map((d) => d.kind).sort()).toEqual([
      'term-iri-changed',
      'term-key-changed',
    ])
    expect(differences.every((d) => d.elementId === 'aaa111')).toBe(true)
  })

  it('a term whose id changed is a removal and an addition, which is correct', () => {
    const differences = diff((t) => t.replace('id: aaa111', 'id: zzz999'))
    expect(differences.map((d) => d.kind).sort()).toEqual(['term-added', 'term-removed'])
  })
})

describe('the five change classes', () => {
  // @lat: [[emitters#Emitters#Change Management#Change Classification]]
  it('a JSON key change is breaking', () => {
    const d = only(diff((t) => t.replace('  name:\n', '  displayName:\n')), 'displayName')
    expect(d.class).toBe('breaking')
    expect(d.message).toContain('stop compacting the same way')
  })

  it('an IRI change is semantic', () => {
    const d = only(diff((t) => t.replace('"@id": ex:name', '"@id": ex:other')), 'name')
    expect(d.class).toBe('semantic')
    expect(d.message).toContain('still parses')
    expect(d.message).toContain('means something else')
  })

  it('removing a protected term is illegal', () => {
    const d = only(
      diff((t) => t.replace('  locked:\n    id: ccc333\n    "@id": ex:locked\n    "@protected": true\n', '')),
      'locked',
    )
    expect(d.class).toBe('illegal')
    expect(d.message).toContain('promise to downstream contexts')
  })

  it('un-protecting a term is illegal too', () => {
    const d = only(diff((t) => t.replace('    "@protected": true\n', '')), 'locked.@protected')
    expect(d.class).toBe('illegal')
  })

  it('a new term is additive', () => {
    const d = only(
      diff((t) => t.replace('examples: []', '  fresh:\n    id: ddd444\n    "@id": ex:fresh\nexamples: []')),
      'fresh',
    )
    expect(d.class).toBe('additive')
  })

  it('adding @container: @set is compatible', () => {
    const d = only(
      diff((t) => t.replace('    "@id": ex:name\n', '    "@id": ex:name\n    "@container": "@set"\n')),
      'name.@container',
    )
    expect(d.class).toBe('compatible')
    expect(d.message).toContain('without changing any document')
  })

  it('removing a term that is not protected is breaking', () => {
    const d = only(diff((t) => t.replace('  name:\n    id: aaa111\n    "@id": ex:name\n', '')), 'name')
    expect(d.class).toBe('breaking')
  })

  it('gaining @type: @id is semantic, because literals become references', () => {
    const d = only(
      diff((t) => t.replace('    "@id": ex:name\n', '    "@id": ex:name\n    "@type": "@id"\n')),
      'name.@type',
    )
    expect(d.class).toBe('semantic')
    expect(d.message).toContain('literals become references')
  })

  it('a container change other than gaining @set is breaking', () => {
    const d = only(
      diff((t) =>
        t.replace('    "@id": ex:name\n', '    "@id": ex:name\n    "@container": "@language"\n'),
      ),
      'name.@container',
    )
    expect(d.class).toBe('breaking')
  })

  // @lat: [[emitters#Emitters#Change Management#Change Classification]]
  it('an ambiguous difference is breaking, and says it was ambiguous', () => {
    const d = only(
      diff((t) =>
        t.replace(
          '    "@id": ex:name\n',
          '    "@id": ex:name\n    "@context":\n      inner: { id: ddd444, "@id": https://example.org/ns#inner }\n',
        ),
      ),
      'name.@context',
    )
    expect(d.class).toBe('breaking')
    expect(d.ambiguous).toBe(true)
    expect(d.message).toContain('a false alarm costs a review')
  })

  it('a change through the raw escape hatch is ambiguous, and breaking', () => {
    const d = only(
      diff((t) => t.replace('    "@id": ex:name\n', '    "@id": ex:name\n    raw:\n      "@propagate": false\n')),
      'name.raw',
    )
    expect(d.class).toBe('breaking')
    expect(d.ambiguous).toBe(true)
  })
})

describe('scoped terms', () => {
  const SCOPED = BASE.replace(
    '    "@id": ex:author\n    "@type": "@id"\n',
    '    "@id": ex:author\n    "@type": "@id"\n    "@context":\n      "@protected": true\n      label: { id: eee555, "@id": ex:authorLabel }\n',
  )
  const compareScoped = (edit: (text: string) => string) =>
    compareVersions(irOf(SCOPED), irOf(edit(SCOPED))).differences

  it('are matched by element id and classified as terms are', () => {
    const d = only(
      compareScoped((t) => t.replace('ex:authorLabel', 'ex:byline')),
      'author › label',
    )
    expect(d.kind).toBe('term-iri-changed')
    expect(d.class).toBe('semantic')
  })

  it('reports a new scoped term as additive, named by its path', () => {
    const d = only(
      compareScoped((t) =>
        t.replace(
          '      label: { id: eee555, "@id": ex:authorLabel }\n',
          '      label: { id: eee555, "@id": ex:authorLabel }\n      sortAs: { id: fff666, "@id": ex:sortAs }\n',
        ),
      ),
      'author › sortAs',
    )
    expect(d.class).toBe('additive')
  })

  it('treats removing a term from a protected scoped context as illegal', () => {
    const d = only(
      compareScoped((t) => t.replace('      label: { id: eee555, "@id": ex:authorLabel }\n', '')),
      'author › label',
    )
    expect(d.kind).toBe('term-removed')
    expect(d.class).toBe('illegal')
  })

  it('classifies promoting a key into a scoped context as breaking, naming both scopes', () => {
    // `name` keeps its element id and moves under `author`.
    const moved = SCOPED.replace('  name:\n    id: aaa111\n    "@id": ex:name\n', '').replace(
      '      label: { id: eee555, "@id": ex:authorLabel }\n',
      '      label: { id: eee555, "@id": ex:authorLabel }\n      name: { id: aaa111, "@id": ex:name }\n',
    )
    const d = only(compareVersions(irOf(SCOPED), irOf(moved)).differences, 'author › name')
    expect(d.kind).toBe('term-scope-changed')
    expect(d.class).toBe('breaking')
    expect(d.before).toBe('the top level')
    expect(d.after).toBe('the scoped context of "author"')
  })

  it('reports a change to a scoped context setting as ambiguous and breaking', () => {
    const d = only(
      compareScoped((t) => t.replace('      "@protected": true\n', '      "@propagate": false\n')),
      'author.@context',
    )
    expect(d.class).toBe('breaking')
    expect(d.ambiguous).toBe(true)
  })

  it('compares against a lockfile from before scoped terms as a whole value, and says so', () => {
    // What an older lockfile recorded: the scoped map as one opaque value.
    const legacy = JSON.parse(serializeIr(irOf(SCOPED))) as {
      terms: Array<Record<string, unknown>>
    }
    legacy.terms = legacy.terms
      .filter((t) => t['scope'] === undefined)
      .map((t) => {
        if (t['scopedContext'] === undefined) return t
        const { scopedContext: _s, ...rest } = t
        return { ...rest, '@context': { '@protected': true, label: 'ex:authorLabel' } }
      })
    const older = parseLockfile(JSON.stringify(legacy))

    const same = compareVersions(older, irOf(SCOPED))
    expect(same.differences).toEqual([])
    expect(same.notes.join(' ')).toContain('could not be matched individually')

    const changed = compareVersions(older, irOf(SCOPED.replace('ex:authorLabel', 'ex:byline')))
    const d = only(changed.differences, 'author.@context')
    expect(d.class).toBe('breaking')
    expect(d.ambiguous).toBe(true)
  })
})

describe('shapes', () => {
  const SHAPED = BASE.replace(
    'examples: []\n',
    `shapes:
  Named:
    id: sha001
    targetClass: ex:Thing
    fields:
      name: { min: 1, max: 2, range: node }
      author: { range: iri }
examples: []
`,
  )
  const compareShaped = (edit: (text: string) => string) =>
    compareVersions(irOf(SHAPED), irOf(edit(SHAPED))).differences

  it('are matched by element id, and a rename is compatible', () => {
    const d = only(compareShaped((t) => t.replace('  Named:\n', '  Labelled:\n')), 'Labelled')
    expect(d.kind).toBe('shape-changed')
    expect(d.class).toBe('compatible')
  })

  it('classify a new shape for a new class as additive', () => {
    const added = SHAPED.replace(
      'examples: []\n',
      '  Other:\n    id: sha002\n    targetClass: ex:Brand\n    fields:\n      name: { min: 1 }\nexamples: []\n',
    )
    const d = only(compareVersions(irOf(SHAPED), irOf(added)).differences, 'Other')
    expect(d.class).toBe('additive')
  })

  it('classify a new shape for a class the older version declared as breaking', () => {
    const added = SHAPED.replace(
      'examples: []\n',
      '  Authored:\n    id: sha002\n    targetClass: author\n    fields:\n      name: { min: 1 }\nexamples: []\n',
    )
    const d = only(compareVersions(irOf(SHAPED), irOf(added)).differences, 'Authored')
    expect(d.class).toBe('breaking')
  })

  it('classify tightening as breaking and loosening as compatible', () => {
    expect(only(compareShaped((t) => t.replace('min: 1, max: 2', 'min: 2, max: 2')), 'Named.name.min').class).toBe('breaking')
    expect(only(compareShaped((t) => t.replace('min: 1, max: 2', 'min: 0, max: 2')), 'Named.name.min').class).toBe('compatible')
    expect(only(compareShaped((t) => t.replace('min: 1, max: 2', 'min: 1, max: 1')), 'Named.name.max').class).toBe('breaking')
    expect(only(compareShaped((t) => t.replace('min: 1, max: 2, ', 'min: 1, ')), 'Named.name.max').class).toBe('compatible')
    expect(only(compareShaped((t) => t.replace('range: node', 'range: iri')), 'Named.name.range').class).toBe('breaking')
    expect(only(compareShaped((t) => t.replace('author: { range: iri }', 'author: { range: node }')), 'Named.author.range').class).toBe('compatible')
    expect(only(compareShaped((t) => t.replace('targetClass: ex:Thing\n', 'targetClass: ex:Thing\n    closed: true\n')), 'Named.closed').class).toBe('breaking')
    expect(only(compareShaped((t) => t.replace('      author: { range: iri }\n', '')), 'Named.author').class).toBe('compatible')
  })

  it('classify a range that is neither narrower nor wider as ambiguous and breaking', () => {
    const d = only(compareShaped((t) => t.replace('author: { range: iri }', 'author: { range: xsd:string }').replace('prefixes:\n', 'prefixes:\n  xsd: http://www.w3.org/2001/XMLSchema#\n')), 'Named.author.range')
    expect(d.class).toBe('breaking')
    expect(d.ambiguous).toBe(true)
  })

  it('refuse a shape with a derived id', () => {
    expect(() => compareVersions(irOf(SHAPED), irOf(SHAPED.replace('    id: sha001\n', '')))).toThrow(
      CompareRefused,
    )
  })
})

describe('model-level differences', () => {
  it('a namespace base change is semantic, because every IRI moved', () => {
    const d = only(
      diff((t) => t.replace('base: https://example.org/ns#', 'base: https://example.org/v2#')),
      'namespace.base',
    )
    expect(d.class).toBe('semantic')
  })

  it('a prefix remapping is semantic and a prefix removal is breaking', () => {
    expect(
      only(diff((t) => t.replace('schema: https://schema.org/', 'schema: https://other.example/')), 'schema')
        .class,
    ).toBe('semantic')
    expect(
      only(diff((t) => t.replace('prefixes:\n  schema: https://schema.org/\n', '')), 'schema').class,
    ).toBe('breaking')
  })

  it('narrowing the processing mode is breaking, widening it is compatible', () => {
    expect(only(diff((t) => t.replace('mode: "1.1"', 'mode: "1.0"')), 'mode').class).toBe(
      'breaking',
    )
    const widened = compareVersions(
      irOf(BASE.replace('mode: "1.1"', 'mode: "1.0"')),
      irOf(BASE),
    ).differences
    expect(only(widened, 'mode').class).toBe('compatible')
  })

  it('a @vocab change is semantic', () => {
    const d = only(
      diff((t) => t.replace('mode: "1.1"', 'mode: "1.1"\nvocab: https://example.org/v#')),
      'vocab',
    )
    expect(d.class).toBe('semantic')
    expect(d.message).toContain('unmapped key')
  })
})

describe('comparison output', () => {
  it('is deterministic across runs', () => {
    const edit = (t: string): string =>
      t.replace('  name:\n', '  displayName:\n').replace('"@id": ex:author', '"@id": ex:creator')
    const first = diff(edit)
    const second = diff(edit)
    expect(second).toEqual(first)
  })

  it('orders the most dangerous difference first', () => {
    const differences = diff((t) =>
      t
        .replace('examples: []', '  fresh:\n    id: ddd444\n    "@id": ex:fresh\nexamples: []')
        .replace('  name:\n', '  displayName:\n')
        .replace('    "@protected": true\n', ''),
    )
    const classes = differences.map((d) => d.class)
    expect(classes[0]).toBe('illegal')
    expect(classes[classes.length - 1]).toBe('additive')
    for (let i = 1; i < classes.length; i++) {
      expect(CLASS_ORDER[classes[i - 1]!]).toBeGreaterThanOrEqual(CLASS_ORDER[classes[i]!])
    }
  })

  it('reports nothing for an unchanged model', () => {
    const result = compareVersions(irOf(BASE), irOf(BASE))
    expect(result.differences).toEqual([])
    expect(result.worst).toBeUndefined()
  })

  it('names the worst class present', () => {
    expect(compareVersions(irOf(BASE), irOf(BASE.replace('"@id": ex:name', '"@id": ex:x'))).worst)
      .toBe('semantic')
  })
})

describe('gating', () => {
  // @lat: [[emitters#Emitters#Change Management#Change Classification]]
  it('fails when a difference is at or above the gate', () => {
    const differences = diff((t) => t.replace('"@id": ex:name', '"@id": ex:other'))
    // A `semantic` difference is above a `breaking` gate.
    expect(atOrAbove(differences, 'breaking')).toHaveLength(1)
    expect(atOrAbove(differences, 'illegal')).toHaveLength(0)
  })

  it('passes when every difference is below the gate', () => {
    const differences = diff((t) =>
      t.replace('examples: []', '  fresh:\n    id: ddd444\n    "@id": ex:fresh\nexamples: []'),
    )
    expect(differences.map((d) => d.class)).toEqual(['additive'])
    expect(atOrAbove(differences, 'breaking')).toHaveLength(0)
  })

  it('orders the classes so semantic outranks breaking and illegal outranks all', () => {
    expect(CHANGE_CLASSES.map((c) => CLASS_ORDER[c])).toEqual([0, 1, 2, 3, 4])
    expect(isChangeClass('breaking')).toBe(true)
    expect(isChangeClass('catastrophic')).toBe(false)
  })
})

describe('comparison refuses derived ids', () => {
  // @lat: [[metamodel#Metamodel#Stable Element IDs]]
  it('refuses either side, naming the elements and which version', () => {
    const derived = BASE.replace(/^ {4}id: \w+\n/gm, '')
    expect(() => compareVersions(irOf(derived), irOf(BASE))).toThrow(CompareRefused)

    try {
      compareVersions(irOf(BASE), irOf(derived))
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('the newer version')
      expect(message).toContain('term "name"')
      expect(message).toContain('removal plus an addition')
    }
  })

  it('accepts two sides whose ids are all written', () => {
    expect(() => compareVersions(irOf(BASE), irOf(BASE))).not.toThrow()
  })
})
