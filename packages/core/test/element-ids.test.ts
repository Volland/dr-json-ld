import { describe, expect, it } from 'vitest'

import { backfillElementIds } from '../src/model/backfill-ids.js'
import { deriveElementId } from '../src/model/element-id.js'
import { derivedIdElements } from '../src/model/ir.js'
import { resolveModelText } from '../src/model/resolve.js'
import { serializeIr } from '../src/model/serialize.js'

const HAND_WRITTEN = `jsonld: "1"

namespace:
  prefix: ex
  base: https://example.org/ns#

terms:
  # The display name of the thing.
  name:
    "@id": ex:name

  # Who wrote it. Coerced, so the value is a reference and not a label.
  author:
    "@id": ex:author
    "@type": "@id"

examples:
  - path: docs/ok.json
    expect: { ok: true }
`

const BACKFILLED = `jsonld: "1"

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
  - id: ccc333
    path: docs/ok.json
    expect: { ok: true }
`

describe('derived ids', () => {
  // @lat: [[metamodel#Metamodel#Stable Element IDs]]
  it('a hand-written model resolves with every id derived', () => {
    const { ir, findings } = resolveModelText(HAND_WRITTEN, 'model.jsonld.yaml')
    expect(findings).toEqual([])
    expect(ir!.terms.every((t) => !t.idWritten)).toBe(true)
    expect(ir!.examples.every((e) => !e.idWritten)).toBe(true)
    expect(derivedIdElements(ir!)).toEqual([
      { kind: 'term', id: deriveElementId('term', 'name'), key: 'name' },
      { kind: 'term', id: deriveElementId('term', 'author'), key: 'author' },
      { kind: 'example', id: deriveElementId('example', 'docs/ok.json'), key: 'docs/ok.json' },
    ])
  })

  it('a derived id is stable across reloads but follows the key', () => {
    const first = resolveModelText(HAND_WRITTEN, 'model.jsonld.yaml').ir!
    const second = resolveModelText(HAND_WRITTEN, 'model.jsonld.yaml').ir!
    expect(second.terms[0]!.id).toBe(first.terms[0]!.id)

    const renamed = resolveModelText(
      HAND_WRITTEN.replace('  name:', '  label:').replace('ex:name', 'ex:name'),
      'model.jsonld.yaml',
    ).ir!
    // This is exactly the loss written ids exist to prevent.
    expect(renamed.terms.find((t) => t.key === 'label')!.id).not.toBe(first.terms[0]!.id)
  })

  it('a fully backfilled model resolves with every id written', () => {
    const { ir, findings } = resolveModelText(BACKFILLED, 'model.jsonld.yaml')
    expect(findings).toEqual([])
    expect(derivedIdElements(ir!)).toEqual([])
    expect(ir!.terms.map((t) => t.id)).toEqual(['aaa111', 'bbb222'])
    expect(ir!.examples[0]!.id).toBe('ccc333')
  })

  it('a model with one missing id resolves the rest as written', () => {
    const oneMissing = BACKFILLED.replace('    id: bbb222\n', '')
    const { ir } = resolveModelText(oneMissing, 'model.jsonld.yaml')
    const derived = derivedIdElements(ir!)
    expect(derived).toEqual([
      { kind: 'term', id: deriveElementId('term', 'author'), key: 'author' },
    ])
    expect(ir!.terms.find((t) => t.key === 'name')!.idWritten).toBe(true)
  })
})

describe('backfilling ids', () => {
  // @lat: [[architecture#Architecture#Editing Surface#Targeted edits]]
  it('preserves every comment and the rest of the file', () => {
    const { text, added, changed } = backfillElementIds(HAND_WRITTEN, 'model.jsonld.yaml')
    expect(changed).toBe(true)
    expect(added.map((a) => a.kind)).toEqual(['term', 'term', 'example'])

    expect(text).toContain('# The display name of the thing.')
    expect(text).toContain(
      '# Who wrote it. Coerced, so the value is a reference and not a label.',
    )

    // The only textual change is the added ids: removing them restores the file
    // byte for byte. A `- id: x` line hands its dash back to the key below it.
    const withoutIds = text
      .replace(/^(\s*)- id: [a-z0-9]{6}\n\1 {2}/gm, '$1- ')
      .replace(/^\s*id: [a-z0-9]{6}\n/gm, '')
    expect(withoutIds).toBe(HAND_WRITTEN)
  })

  it('produces a model whose ids are all written', () => {
    const { text } = backfillElementIds(HAND_WRITTEN, 'model.jsonld.yaml')
    const { ir, findings } = resolveModelText(text, 'model.jsonld.yaml')
    expect(findings).toEqual([])
    expect(derivedIdElements(ir!)).toEqual([])
  })

  it('leaves an already-backfilled model untouched', () => {
    const { text, changed, added } = backfillElementIds(BACKFILLED, 'model.jsonld.yaml')
    expect(changed).toBe(false)
    expect(added).toEqual([])
    expect(text).toBe(BACKFILLED)
  })

  it('fills only the element that is missing one', () => {
    const oneMissing = BACKFILLED.replace('    id: bbb222\n', '')
    const { text, added } = backfillElementIds(oneMissing, 'model.jsonld.yaml')
    expect(added).toHaveLength(1)
    expect(added[0]!.key).toBe('author')
    const { ir } = resolveModelText(text, 'model.jsonld.yaml')
    expect(ir!.terms.find((t) => t.key === 'name')!.id).toBe('aaa111')
    expect(derivedIdElements(ir!)).toEqual([])
  })
})

describe('rename', () => {
  // @lat: [[metamodel#Metamodel#Identity]]
  it('preserves identity when the key changes and the id does not', () => {
    const before = resolveModelText(BACKFILLED, 'model.jsonld.yaml').ir!
    const after = resolveModelText(
      BACKFILLED.replace('  author:', '  writtenBy:'),
      'model.jsonld.yaml',
    ).ir!

    const beforeTerm = before.terms.find((t) => t.key === 'author')!
    const afterTerm = after.terms.find((t) => t.key === 'writtenBy')!
    expect(afterTerm.id).toBe(beforeTerm.id)

    // One term whose key changed, not a removal and an addition.
    expect(after.terms.map((t) => t.id).sort()).toEqual(before.terms.map((t) => t.id).sort())
    expect(afterTerm.iri).toBe(beforeTerm.iri)
  })

  it('an IRI change keeps the id, so it is not read as a rename', () => {
    const before = resolveModelText(BACKFILLED, 'model.jsonld.yaml').ir!
    const after = resolveModelText(
      BACKFILLED.replace('"@id": ex:author', '"@id": ex:creator'),
      'model.jsonld.yaml',
    ).ir!
    const b = before.terms.find((t) => t.id === 'bbb222')!
    const a = after.terms.find((t) => t.id === 'bbb222')!
    expect(a.key).toBe(b.key)
    expect(a.iri).not.toBe(b.iri)
    expect(serializeIr(after)).not.toBe(serializeIr(before))
  })
})
