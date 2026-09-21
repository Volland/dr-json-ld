/**
 * Scoped terms and shapes, authored from the canvas: every gesture is an intent,
 * every intent a targeted edit, and a gesture needing two edits is one intent.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Intents]]
 */
import { describe, expect, it } from 'vitest'

import { findShape, resolveModelText, scopedTermsOf, termPath, validateModelText, type Ir } from '@json-ld-modeler/core'

import { NodeHost } from '../src/host/node-host.js'
import { applyIntents, IntentError, splicesFor, type Intent } from '../src/intents/intent.js'

const BASE = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#
mode: "1.1"
prefixes:
  xsd: http://www.w3.org/2001/XMLSchema#
terms:
  # A publisher, whose own context will redefine a key.
  publisher:
    id: pub001
    "@id": ex:publisher
    "@type": "@id"
  holder:
    id: hol001
    "@id": ex:holder
    "@context":
      nickname: { id: nic001, "@id": ex:nickname }
  inline:
    id: inl001
    "@id": ex:inline
    "@context": { first: ex:first }
  remote:
    id: rem001
    "@id": ex:remote
    "@context": https://example.org/remote.jsonld
  name:
    id: nam001
    "@id": ex:name
examples: []
`

function ir(text: string): Ir {
  const { ir, findings } = resolveModelText(text, 'm.jsonld.yaml')
  expect(findings.filter((f) => f.severity === 'error'), text).toEqual([])
  return ir!
}

const at = (model: Ir, path: string) => model.terms.find((t) => termPath(model, t) === path)

describe('scoped terms on the canvas', () => {
  it('adds a scoped term to a term with no scoped context, creating the map', () => {
    const next = applyIntents(BASE, [{ kind: 'add-scoped-term', parentId: 'pub001', key: 'name', iri: 'ex:legalName' }])
    const model = ir(next)
    const scoped = at(model, 'publisher › name')!
    expect(scoped.iri).toBe('https://example.org/ns#legalName')
    expect(scoped.idWritten).toBe(true)
    expect(next).toContain('# A publisher, whose own context will redefine a key.')
  })

  it('adds a scoped term after the last one in a block context', () => {
    const next = applyIntents(BASE, [{ kind: 'add-scoped-term', parentId: 'hol001', key: 'alias', iri: 'ex:alias' }])
    const holder = ir(next).terms.find((t) => t.id === 'hol001')!
    expect(scopedTermsOf(ir(next), holder.id).map((t) => t.key)).toEqual(['nickname', 'alias'])
  })

  it('adds a scoped term to a one-line context', () => {
    const next = applyIntents(BASE, [{ kind: 'add-scoped-term', parentId: 'inl001', key: 'second', iri: 'ex:second' }])
    expect(scopedTermsOf(ir(next), 'inl001').map((t) => t.key)).toEqual(['first', 'second'])
  })

  it('refuses a scoped term inside a context given by reference', () => {
    expect(() => splicesFor(BASE, { kind: 'add-scoped-term', parentId: 'rem001', key: 'x' })).toThrow(IntentError)
  })

  it('edits a scoped term written as a flow mapping or a bare IRI, on its own line', () => {
    const model = ir(BASE)
    const first = at(model, 'inline › first')!
    let next = applyIntents(BASE, [{ kind: 'retype-term', id: 'nic001', facet: '@type', value: '@id' }])
    expect(next).toContain('nickname: { id: nic001, "@id": ex:nickname, "@type": "@id" }')
    next = applyIntents(next, [{ kind: 'retype-term', id: first.id, facet: '@type', value: 'xsd:string' }])
    expect(at(ir(next), 'inline › first')!['@type']).toBe('xsd:string')
  })

  it('renames and deletes a scoped term without touching its namesakes', () => {
    const renamed = applyIntents(BASE, [{ kind: 'rename-term', id: 'nic001', key: 'name' }])
    expect(at(ir(renamed), 'holder › name')!.id).toBe('nic001')
    expect(at(ir(renamed), 'name')!.id).toBe('nam001')
    const deleted = applyIntents(renamed, [{ kind: 'delete-term', id: 'nic001' }])
    expect(at(ir(deleted), 'holder › name')).toBeUndefined()
    expect(at(ir(deleted), 'name')).toBeDefined()
  })
})

const SHAPED = BASE.replace(
  'examples: []\n',
  `shapes:
  Holder:
    id: shh001
    targetClass: ex:Holder
    fields:
      name: { min: 1 }
  Publisher:
    id: shp001
    targetClass: ex:Publisher
    fields:
      name: { max: 1 }
examples: []
views:
  - id: vw0001
    name: All
    terms: [publisher, holder, inline, remote, name]
    shapes: [Holder, Publisher]
`,
)

describe('renaming a term that fields use', () => {
  it('renames the field keys and view entries in the same edit', () => {
    const splices = splicesFor(SHAPED, { kind: 'rename-term', id: 'nam001', key: 'label' })
    const next = applyIntents(SHAPED, [{ kind: 'rename-term', id: 'nam001', key: 'label' }])
    const model = ir(next)
    expect(findShape(model, 'Holder')!.fields.map((f) => [f.key, f.termId])).toEqual([['label', 'nam001']])
    expect(findShape(model, 'Publisher')!.fields.map((f) => f.key)).toEqual(['label'])
    expect(model.views[0]!.terms).toContain('label')
    // One intent, one edit: undoing it once restores the key and both fields.
    expect(splices.length).toBe(4)
  })
})

describe('shapes on the canvas', () => {
  it('adds a field whose key has no term, declaring the term in the same edit', () => {
    const splices = splicesFor(SHAPED, {
      kind: 'add-field',
      shape: 'Holder',
      key: 'evidence',
      field: { range: 'iri' },
      createTerm: { iri: 'ex:evidence' },
    })
    expect(splices).toHaveLength(1)
    const next = applyIntents(SHAPED, [
      { kind: 'add-field', shape: 'Holder', key: 'evidence', field: { range: 'iri' }, createTerm: { iri: 'ex:evidence' } },
    ])
    const model = ir(next)
    const term = model.terms.find((t) => t.key === 'evidence' && !t.scope)!
    expect(term.iri).toBe('https://example.org/ns#evidence')
    expect(findShape(model, 'Holder')!.fields.find((f) => f.key === 'evidence')!.termId).toBe(term.id)
  })

  it('promotes a key into the class term’s scoped context, leaving the other class untouched', () => {
    // The Publisher shape wants `name` as a reference; the Holder shape reads it as a string.
    const conflicted = applyIntents(SHAPED, [
      { kind: 'set-field', shape: 'Publisher', key: 'name', field: { max: 1, range: 'iri' } },
    ])
    const before = validateModelText(conflicted, 'm.jsonld.yaml')
    expect(before.findings.map((f) => f.ruleId)).toContain('L1.shape-range-needs-id-coercion')

    const promoted = applyIntents(conflicted, [
      { kind: 'promote-term', shape: 'Publisher', key: 'name', facets: { '@type': '@id' } },
    ])
    const model = ir(promoted)
    // The target was an IRI, so a class term was created to hold the context.
    const publisherShape = findShape(model, 'Publisher')!
    const classTerm = model.terms.find((t) => t.id === publisherShape.targetTermId)!
    expect(classTerm.iri).toBe('https://example.org/ns#Publisher')
    const scoped = scopedTermsOf(model, classTerm.id).find((t) => t.key === 'name')!
    expect(scoped['@type']).toBe('@id')
    expect(scoped.iri).toBe('https://example.org/ns#name')

    const after = validateModelText(promoted, 'm.jsonld.yaml')
    expect(after.findings.filter((f) => f.ruleId.startsWith('L1.shape-range'))).toEqual([])
    // The Holder shape still reads `name` through the shared term.
    expect(findShape(model, 'Holder')!.fields[0]!.termId).toBe('nam001')
    expect(model.terms.find((t) => t.id === 'nam001')!['@type']).toBeUndefined()
  })

  it('is one splice, so undoing a promotion once restores the file', () => {
    const splices = splicesFor(SHAPED, { kind: 'promote-term', shape: 'Publisher', key: 'name', facets: { '@type': '@id' } })
    expect(splices).toHaveLength(1)
  })
})

describe('the credential, described entirely from the canvas', () => {
  it('produces the model a person would have written, through the host adapter alone', async () => {
    const host = new NodeHost({
      text: `jsonld: "1"
namespace:
  prefix: cred
  base: https://example.org/credentials#
mode: "1.1"
prefixes:
  xsd: http://www.w3.org/2001/XMLSchema#
terms: {}
examples: []
`,
    })
    const gestures: Intent[] = [
      { kind: 'create-term', key: 'VerifiableCredential', iri: 'cred:VerifiableCredential' },
      { kind: 'add-shape', name: 'Credential', targetClass: 'VerifiableCredential' },
      { kind: 'add-field', shape: 'Credential', key: 'issuer', field: { min: 1, max: 1, range: 'iri' }, createTerm: { iri: 'cred:issuer' } },
      { kind: 'add-field', shape: 'Credential', key: 'validFrom', field: { min: 1, range: 'xsd:dateTime' }, createTerm: { iri: 'cred:validFrom' } },
      { kind: 'add-shape', name: 'Subject' },
      { kind: 'add-field', shape: 'Subject', key: 'name', field: { max: 1 }, createTerm: { iri: 'cred:name' } },
      { kind: 'add-field', shape: 'Credential', key: 'credentialSubject', field: { min: 1, range: { shape: 'Subject' } }, createTerm: { iri: 'cred:credentialSubject' } },
    ]
    for (const gesture of gestures) await host.applyIntent(gesture)

    // The coercions the ranges need, given in the inspector.
    let model = ir(host.text)
    const idOf = (key: string) => model.terms.find((t) => t.key === key)!.id
    await host.applyIntent({ kind: 'retype-term', id: idOf('issuer'), facet: '@type', value: '@id' })
    await host.applyIntent({ kind: 'retype-term', id: idOf('validFrom'), facet: '@type', value: 'xsd:dateTime' })
    await host.applyIntent({ kind: 'retype-term', id: idOf('credentialSubject'), facet: '@type', value: '@id' })

    model = ir(host.text)
    const credential = findShape(model, 'Credential')!
    expect(credential.targetIri).toBe('https://example.org/credentials#VerifiableCredential')
    expect(
      credential.fields.map((f) => [f.key, f.iri, f.min, f.max, f.range?.kind]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['credentialSubject', 'https://example.org/credentials#credentialSubject', 1, undefined, 'shape'],
      ['issuer', 'https://example.org/credentials#issuer', 1, 1, 'iri'],
      ['validFrom', 'https://example.org/credentials#validFrom', 1, undefined, 'datatype'],
    ])
    expect(findShape(model, 'Subject')!.fields.map((f) => f.key)).toEqual(['name'])

    const report = validateModelText(host.text, 'm.jsonld.yaml')
    expect(report.findings.filter((f) => f.severity !== 'info')).toEqual([])
    // Every element carries a written id: nothing typed by hand, nothing derived.
    expect(model.terms.every((t) => t.idWritten) && model.shapes.every((s) => s.idWritten)).toBe(true)
  })
})
