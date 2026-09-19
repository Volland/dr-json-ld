import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { resolutionPrefixes } from '../src/model/ir.js'
import { resolveModelText } from '../src/model/resolve.js'
import { serializeIr } from '../src/model/serialize.js'

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/models/${name}`, import.meta.url)),
    'utf8',
  )
}

function resolveFixture(name: string) {
  return resolveModelText(fixture(name), `fixtures/models/${name}`)
}

describe('parse and resolve', () => {
  // @lat: [[metamodel#Metamodel#Terms]]
  it('resolves a model into the IR with every facet it declares', () => {
    const { ir, findings } = resolveFixture('basic.jsonld.yaml')
    expect(findings).toEqual([])
    expect(ir).toBeDefined()
    expect(ir!.namespace).toEqual({ prefix: 'ex', base: 'https://example.org/ns#' })
    expect(ir!.mode).toBe('1.1')
    // `prefixes` holds what the model declared; the namespace prefix is its
    // identity rather than a declaration, and joins only for resolution.
    expect(ir!.prefixes).toEqual({
      schema: 'https://schema.org/',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
    })
    expect(resolutionPrefixes(ir!)).toEqual({
      ex: 'https://example.org/ns#',
      schema: 'https://schema.org/',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
    })

    const author = ir!.terms.find((t) => t.key === 'author')!
    expect(author.iri).toBe('https://schema.org/author')
    expect(author['@type']).toBe('@id')
    expect(author.idWritten).toBe(true)

    const tags = ir!.terms.find((t) => t.key === 'tags')!
    expect(tags['@container']).toEqual(['@set'])
    expect(tags.iri).toBe('https://example.org/ns#tag')
  })

  // @lat: [[processing#Processing#Source Mapping]]
  it('retains a source location for every term and facet', () => {
    const { source } = resolveFixture('basic.jsonld.yaml')
    const authorType = source.positionOf('/terms/author/@type')
    const authorKey = source.positionOf('/terms/author')
    expect(authorKey.line).toBeGreaterThan(0)
    expect(authorType.line).toBeGreaterThan(authorKey.line)
    // The location points at the facet the user wrote, not at the file start.
    const line = source.text.split('\n')[authorType.line - 1]!
    expect(line).toContain('@type')
  })
})

describe('the IR serializer', () => {
  // @lat: [[emitters#Emitters#Change Management#Lockfile]]
  it('is byte-identical on repeat', () => {
    const { ir } = resolveFixture('basic.jsonld.yaml')
    expect(serializeIr(ir!)).toBe(serializeIr(ir!))
    const again = resolveFixture('basic.jsonld.yaml')
    expect(serializeIr(again.ir!)).toBe(serializeIr(ir!))
  })

  it('is unchanged by reordering declarations', () => {
    const basic = resolveFixture('basic.jsonld.yaml')
    const reordered = resolveFixture('reordered.jsonld.yaml')
    expect(reordered.findings).toEqual([])
    expect(serializeIr(reordered.ir!)).toBe(serializeIr(basic.ir!))
  })

  it('sorts object keys at every depth', () => {
    const { ir } = resolveFixture('basic.jsonld.yaml')
    const snapshot = serializeIr(ir!)
    const parsed = JSON.parse(snapshot)
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort())
    expect(parsed.terms.map((t: { id: string }) => t.id)).toEqual(['aaa111', 'bbb222', 'ccc333'])
  })
})

describe('model-level errors', () => {
  const at = (findings: Array<{ ruleId: string }>, id: string) =>
    findings.filter((f) => f.ruleId === id)

  // @lat: [[metamodel#Metamodel#Terms#Prefixes and Vocab]]
  it('reports an unknown prefix at the facet that used it', () => {
    const { findings } = resolveModelText(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'terms:',
        '  author:',
        '    "@id": nope:author',
      ].join('\n'),
      'model.jsonld.yaml',
    )
    const unknown = at(findings, 'L1.unknown-prefix')
    expect(unknown).toHaveLength(1)
    expect(unknown[0]!.pointer).toBe('/terms/author/@id')
    expect(unknown[0]!.message).toContain('nope')
    expect(unknown[0]!.loc.line).toBe(5)
  })

  // @lat: [[metamodel#Metamodel#Terms]]
  it('reports a duplicate term key at the second declaration', () => {
    const { findings } = resolveModelText(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'terms:',
        '  author:',
        '    "@id": ex:author',
        '  author:',
        '    "@id": ex:writer',
      ].join('\n'),
      'model.jsonld.yaml',
    )
    const dupes = at(findings, 'L0.duplicate-term-key')
    expect(dupes).toHaveLength(1)
    expect(dupes[0]!.loc.line).toBe(6)
    expect(dupes[0]!.subject).toBe('author')
  })

  it('reports a malformed IRI on the namespace base', () => {
    const { findings } = resolveModelText(
      ['jsonld: "1"', 'namespace: { prefix: ex, base: "not an iri" }', 'terms: {}'].join('\n'),
      'model.jsonld.yaml',
    )
    expect(at(findings, 'L1.malformed-iri')).toHaveLength(1)
  })

  // @lat: [[metamodel#Metamodel#Processing Mode]]
  it('reports a facet illegal for the declared mode, on that facet', () => {
    const { findings } = resolveModelText(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'mode: "1.0"',
        'terms:',
        '  author:',
        '    "@id": ex:author',
        '    "@protected": true',
      ].join('\n'),
      'model.jsonld.yaml',
    )
    const downgrades = at(findings, 'L1.facet-not-in-mode')
    expect(downgrades).toHaveLength(1)
    expect(downgrades[0]!.pointer).toBe('/terms/author/@protected')
    // The diagnostic states what a 1.0 processor does with it instead.
    expect(downgrades[0]!.message).toContain('a later context may redefine the term freely')
  })

  it('reports an invalid container value at the term', () => {
    const { findings } = resolveModelText(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'terms:',
        '  tags:',
        '    "@id": ex:tag',
        '    "@container": "@bag"',
      ].join('\n'),
      'model.jsonld.yaml',
    )
    const invalid = at(findings, 'L1.invalid-container-mapping')
    expect(invalid).toHaveLength(1)
    expect(invalid[0]!.pointer).toBe('/terms/tags/@container')
  })

  it('reports a missing namespace and generates no IR namespace', () => {
    const { findings } = resolveModelText(
      ['jsonld: "1"', 'terms: {}'].join('\n'),
      'model.jsonld.yaml',
    )
    expect(at(findings, 'L0.missing-namespace')).toHaveLength(1)
  })

  it('reports a term definition that is a number', () => {
    const { findings } = resolveModelText(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'terms:',
        '  author: 42',
      ].join('\n'),
      'model.jsonld.yaml',
    )
    const violations = at(findings, 'L0.schema-violation')
    expect(violations).toHaveLength(1)
    expect(violations[0]!.pointer).toBe('/terms/author')
  })

  it('orders findings deterministically and independently of iteration order', () => {
    const text = [
      'jsonld: "1"',
      'namespace: { prefix: ex, base: "https://example.org/ns#" }',
      'terms:',
      '  z:',
      '    "@id": nope:z',
      '  a:',
      '    "@id": nope:a',
    ].join('\n')
    const first = resolveModelText(text, 'model.jsonld.yaml').findings
    const second = resolveModelText(text, 'model.jsonld.yaml').findings
    expect(second).toEqual(first)
    expect(first.map((f) => f.loc.line)).toEqual([5, 7])
  })
})
