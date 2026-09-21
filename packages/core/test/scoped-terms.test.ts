import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jsonld from 'jsonld'
import { parse as parseYaml } from 'yaml'

import { buildContextDocument } from '../src/emit/context-document.js'
import { emit } from '../src/emit/emit.js'
import { backfillElementIds } from '../src/model/backfill-ids.js'
import { derivedIdElements, scopedTermsOf, termPath, type Ir } from '../src/model/ir.js'
import { resolveModelText } from '../src/model/resolve.js'
import { serializeIr } from '../src/model/serialize.js'
import { SourceIndex } from '../src/source/index-file.js'

const BOOKSHELF = fileURLToPath(new URL('../../../examples/bookshelf/', import.meta.url))

const MODEL = `jsonld: "1"
namespace:
  prefix: cred
  base: https://example.org/credentials#
mode: "1.1"
prefixes:
  xsd: http://www.w3.org/2001/XMLSchema#
terms:
  # The class, with its own protected type-scoped context.
  VerifiableCredential:
    id: vc0001
    "@id": cred:VerifiableCredential
    "@context":
      "@protected": true
      "@version": 1.1
      # A shorthand entry, as a context writes it.
      id: "@id"
      issuer:
        id: is0001
        "@id": cred:issuer
        "@type": "@id"
      validFrom: { "@id": cred:validFrom, "@type": xsd:dateTime }
      evidence:
        "@id": cred:evidence
        "@context":
          kind: cred:evidenceKind
  name:
    id: nm0001
    "@id": cred:name
  holder:
    id: ho0001
    "@id": cred:holder
    "@context":
      name: https://example.org/credentials#holderName
      nickname: null
`

function resolve(text: string): { ir: Ir; findings: ReturnType<typeof resolveModelText>['findings'] } {
  const { ir, findings } = resolveModelText(text, 'model.jsonld.yaml')
  return { ir: ir!, findings }
}

const term = (ir: Ir, path: string) => ir.terms.find((t) => termPath(ir, t) === path)!

describe('scoped terms in the IR', () => {
  it('resolves every term definition in a scoped map as a term with its own identity', () => {
    const { ir, findings } = resolve(MODEL)
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    const vc = term(ir, 'VerifiableCredential')
    const scoped = scopedTermsOf(ir, vc.id).map((t) => t.key)
    expect(scoped).toEqual(['id', 'issuer', 'validFrom', 'evidence'])
    const issuer = term(ir, 'VerifiableCredential › issuer')
    expect(issuer.id).toBe('is0001')
    expect(issuer.idWritten).toBe(true)
    expect(issuer.scope).toEqual({ parent: 'vc0001' })
    expect(issuer['@type']).toBe('@id')
    expect(issuer.iri).toBe('https://example.org/credentials#issuer')
  })

  it('records keyword entries as settings of the scoped context, not as terms', () => {
    const { ir } = resolve(MODEL)
    const vc = term(ir, 'VerifiableCredential')
    expect(vc.scopedContext).toEqual({ settings: { '@protected': true, '@version': 1.1 } })
    expect(vc['@context']).toBeUndefined()
  })

  it('reads a shorthand entry as a term whose @id is that IRI, and null as a decoupling', () => {
    const { ir } = resolve(MODEL)
    const holderName = term(ir, 'holder › name')
    expect(holderName['@id']).toBe('https://example.org/credentials#holderName')
    expect(holderName.iri).toBe('https://example.org/credentials#holderName')
    const nickname = term(ir, 'holder › nickname')
    expect(nickname['@id']).toBeNull()
  })

  it('resolves scoped contexts to any depth', () => {
    const { ir } = resolve(MODEL)
    const kind = term(ir, 'VerifiableCredential › evidence › kind')
    expect(kind.iri).toBe('https://example.org/credentials#evidenceKind')
    expect(kind.scope?.parent).toBe(term(ir, 'VerifiableCredential › evidence').id)
  })

  it('treats the same key in two maps as two terms with distinct ids', () => {
    const { ir, findings } = resolve(MODEL)
    const top = term(ir, 'name')
    const scoped = term(ir, 'holder › name')
    expect(top.id).not.toBe(scoped.id)
    expect(findings.some((f) => f.ruleId === 'L0.duplicate-term-key')).toBe(false)
  })

  it('keeps a scoped context given by reference as written', () => {
    const text = MODEL.replace(
      '  name:\n    id: nm0001\n',
      '  name:\n    id: nm0001\n    "@context": https://example.org/other.jsonld\n',
    )
    const { ir } = resolve(text)
    const name = term(ir, 'name')
    expect(name['@context']).toBe('https://example.org/other.jsonld')
    expect(name.scopedContext).toBeUndefined()
  })

  it('reports a key declared twice in one scoped map, at the second occurrence', () => {
    const text = MODEL.replace(
      '      nickname: null\n',
      '      nickname: null\n      name: https://example.org/credentials#other\n',
    )
    const { findings } = resolve(text)
    const duplicate = findings.filter((f) => f.ruleId === 'L0.duplicate-term-key')
    expect(duplicate).toHaveLength(1)
    expect(duplicate[0]!.pointer).toBe('/terms/holder/@context/name')
    expect(duplicate[0]!.loc.line).toBe(text.split('\n').findIndex((l) => l.includes('#other')) + 1)
  })

  it('reports a scoped term reusing a top-level element id', () => {
    const text = MODEL.replace('        id: is0001\n', '        id: nm0001\n')
    const { findings } = resolve(text)
    expect(findings.some((f) => f.ruleId === 'L0.duplicate-element-id')).toBe(true)
  })

  it('derives distinct ids for scoped terms, and records them as derived', () => {
    const { ir } = resolve(MODEL)
    const derived = derivedIdElements(ir).map((d) => d.key)
    expect(derived).toContain('holder › name')
    expect(derived).toContain('VerifiableCredential › validFrom')
    expect(new Set(ir.terms.map((t) => t.id)).size).toBe(ir.terms.length)
  })

  it('serializes identically when scoped terms are reordered', () => {
    const reordered = MODEL.replace(
      '      name: https://example.org/credentials#holderName\n      nickname: null\n',
      '      nickname: null\n      name: https://example.org/credentials#holderName\n',
    )
    expect(serializeIr(resolve(reordered).ir)).toBe(serializeIr(resolve(MODEL).ir))
  })
})

describe('backfilling ids into scoped terms', () => {
  it('writes an id on every scoped term and leaves nothing derived', () => {
    const { text, changed } = backfillElementIds(MODEL, 'model.jsonld.yaml')
    expect(changed).toBe(true)
    const { ir, findings } = resolve(text)
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(derivedIdElements(ir)).toEqual([])
  })

  it('turns a shorthand entry into a mapping with the same IRI, keeping every comment', () => {
    const { text } = backfillElementIds(MODEL, 'model.jsonld.yaml')
    expect(text).toMatch(/ {6}name: \{ id: [a-z0-9]{6}, "@id": https:\/\/example\.org\/credentials#holderName \}/)
    expect(text).toMatch(/ {6}nickname: \{ id: [a-z0-9]{6}, "@id": null \}/)
    expect(text).toMatch(/ {6}id: \{ id: [a-z0-9]{6}, "@id": "@id" \}/)
    for (const comment of MODEL.split('\n').filter((l) => l.trim().startsWith('#'))) {
      expect(text).toContain(comment)
    }
  })

  it('puts an id inside a flow mapping nested in a block scoped context', () => {
    const { text } = backfillElementIds(MODEL, 'model.jsonld.yaml')
    expect(text).toMatch(/validFrom: \{ id: [a-z0-9]{6}, "@id": cred:validFrom/)
  })

  it('leaves the emitted context unchanged', () => {
    const { text } = backfillElementIds(MODEL, 'model.jsonld.yaml')
    expect(buildContextDocument(resolve(text).ir)).toEqual(buildContextDocument(resolve(MODEL).ir))
  })

  it('writes nothing the second time', () => {
    const once = backfillElementIds(MODEL, 'model.jsonld.yaml').text
    expect(backfillElementIds(once, 'model.jsonld.yaml').changed).toBe(false)
  })
})

describe('emitting scoped terms', () => {
  it('rebuilds a scoped map from settings and scoped terms, without ids or notes', () => {
    const { ir } = resolve(MODEL)
    const layer = buildContextDocument(ir)['@context'] as Record<string, Record<string, unknown>>
    expect(layer['VerifiableCredential']).toEqual({
      '@id': 'cred:VerifiableCredential',
      '@context': {
        '@protected': true,
        '@version': 1.1,
        id: '@id',
        issuer: { '@id': 'cred:issuer', '@type': '@id' },
        validFrom: { '@id': 'cred:validFrom', '@type': 'xsd:dateTime' },
        evidence: { '@id': 'cred:evidence', '@context': { kind: 'cred:evidenceKind' } },
      },
    })
    expect(layer['holder']!['@context']).toEqual({
      name: 'https://example.org/credentials#holderName',
      nickname: null,
    })
  })

  it('emits a scoped term without @id as written, rather than minting a namespace IRI', () => {
    const text = MODEL.replace('      nickname: null\n', '      nickname: { "@type": "@id" }\n')
    const layer = buildContextDocument(resolve(text).ir)['@context'] as Record<
      string,
      Record<string, unknown>
    >
    expect(layer['holder']!['@context']).toEqual({
      name: 'https://example.org/credentials#holderName',
      nickname: { '@type': '@id' },
    })
  })
})

/**
 * The context the emitter produced before scoped terms existed: the scoped map
 * passed through exactly as the YAML held it. A model written then carried no
 * ids or notes inside a scoped map — a processor would have refused them — so
 * those are the only keys removed here.
 */
function passThroughContext(ir: Ir, text: string): Record<string, unknown> {
  const data = parseYaml(text) as { terms: Record<string, Record<string, unknown>> }
  const own = { ...(buildContextDocument(ir)['@context'] as Record<string, unknown>) }
  for (const [key, def] of Object.entries(data.terms)) {
    const raw = def['@context']
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    own[key] = { ...(own[key] as Record<string, unknown>), '@context': withoutIdentity(raw) }
  }
  return own
}

function withoutIdentity(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'note') continue
    if (k === 'id' && typeof v === 'string' && /^[a-z0-9]{6}$/.test(v)) continue
    out[k] = withoutIdentity(v)
  }
  return out
}

describe('scoped terms are executed, not only snapshotted', () => {
  const documents: Array<{ name: string; model: string; document: Record<string, unknown> }> = [
    {
      name: 'a credential with a type-scoped context',
      model: MODEL,
      document: {
        '@type': 'VerifiableCredential',
        id: 'https://example.org/c/1',
        issuer: 'https://example.org/issuers/1',
        validFrom: '2026-01-01T00:00:00Z',
        evidence: { kind: 'document' },
        holder: { name: 'Ada', nickname: 'dropped' },
        name: 'outer',
      },
    },
  ]
  for (const file of ['book-ok.json', 'person-ok.json', 'book-lossy.json']) {
    documents.push({
      name: `bookshelf ${file}`,
      model: readFileSync(`${BOOKSHELF}bookshelf.jsonld.yaml`, 'utf8'),
      document: JSON.parse(readFileSync(`${BOOKSHELF}documents/${file}`, 'utf8')),
    })
  }

  for (const { name, model, document } of documents) {
    it(`expands ${name} exactly as the pass-through context did`, async () => {
      const { ir } = resolve(model)
      const source = SourceIndex.parse(model, { path: 'model.jsonld.yaml' })
      const emitted = emit(ir, { target: 'context', source }).document['@context']
      const before = passThroughContext(ir, model)
      const { '@context': _ignored, ...body } = document
      const after = await jsonld.expand({ '@context': emitted, ...body } as never)
      const expected = await jsonld.expand({ '@context': before, ...body } as never)
      expect(after).toEqual(expected)
      expect(after.length).toBeGreaterThan(0)
    })
  }
})
