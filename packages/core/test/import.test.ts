import { describe, expect, it } from 'vitest'

import { emit, stripComments } from '../src/emit/emit.js'
import { importContext } from '../src/import/import.js'
import { derivedIdElements } from '../src/model/ir.js'
import { resolveModelText } from '../src/model/resolve.js'
import { SourceIndex } from '../src/source/index-file.js'

const UPSTREAM = 'https://example.org/vocab/core.jsonld'

function build(text: string) {
  const source = SourceIndex.parse(text, { path: 'model.jsonld.yaml' })
  const { ir, findings } = resolveModelText(text, 'model.jsonld.yaml')
  return { ir, source, findings }
}

const ADVANCED = {
  '@context': {
    '@version': 1.1,
    '@vocab': 'https://example.org/ns#',
    schema: 'https://schema.org/',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    name: 'schema:name',
    author: { '@id': 'schema:author', '@type': '@id' },
    age: { '@id': 'https://example.org/ns#age', '@type': 'xsd:integer' },
    tags: { '@id': 'https://example.org/ns#tag', '@container': '@set' },
    label: { '@id': 'https://example.org/ns#label', '@container': '@language' },
    locked: { '@id': 'https://example.org/ns#locked', '@protected': true },
    detail: {
      '@id': 'https://example.org/ns#detail',
      '@context': { name: 'https://example.org/ns#innerName' },
    },
    nest: '@nest',
    isKnownBy: { '@reverse': 'https://example.org/ns#knows' },
    odd: { '@id': 'https://example.org/ns#odd', '@propagate': false },
  },
}

describe('importing a context', () => {
  // @lat: [[metamodel#Metamodel#Composition]]
  it('recovers prefixes, @vocab and every facet', () => {
    const { text, termCount } = importContext(ADVANCED, { sourceName: 'core.jsonld' })
    const { ir, findings } = build(text)
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(ir).toBeDefined()
    expect(termCount).toBe(ir!.terms.length)

    expect(ir!.vocab).toBe('https://example.org/ns#')
    expect(ir!.prefixes['schema']).toBe('https://schema.org/')

    const term = (key: string) => ir!.terms.find((t) => t.key === key)!
    expect(term('author')['@type']).toBe('@id')
    expect(term('age')['@type']).toBe('xsd:integer')
    expect(term('tags')['@container']).toEqual(['@set'])
    expect(term('label')['@container']).toEqual(['@language'])
    expect(term('locked')['@protected']).toBe(true)
    expect(term('detail')['@context']).toEqual({ name: 'https://example.org/ns#innerName' })
    expect(term('isKnownBy')['@reverse']).toBe('https://example.org/ns#knows')
  })

  it('carries a facet the metamodel has not named through the escape hatch', () => {
    const { text } = importContext(ADVANCED)
    const { ir } = build(text)
    const odd = ir!.terms.find((t) => t.key === 'odd')!
    expect(odd.raw).toEqual({ '@propagate': false })
  })

  it('mints a written id on every term', () => {
    const { text } = importContext(ADVANCED)
    const { ir } = build(text)
    expect(derivedIdElements(ir!)).toEqual([])
    expect(new Set(ir!.terms.map((t) => t.id)).size).toBe(ir!.terms.length)
  })

  it('records a referenced context in uses, with no hash until vendored', () => {
    const layered = { '@context': [UPSTREAM, { local: 'https://example.org/ns#local' }] }
    const { text, referenced } = importContext(layered)
    expect(referenced).toEqual([UPSTREAM])
    const { ir } = build(text)
    expect(ir!.uses).toHaveLength(1)
    expect(ir!.uses[0]!.iri).toBe(UPSTREAM)
    expect(ir!.uses[0]!.integrity).toBeUndefined()
    expect(text).toContain('integrity is written by `ldm vendor`')
  })
})

describe('what import cannot recover, it reports', () => {
  // @lat: [[emitters#Emitters#Capability Matrix]]
  it('names class membership, documentation and the intent behind @vocab', () => {
    const { notRecovered } = importContext(ADVANCED)
    const kinds = notRecovered.map((n) => n.kind)
    expect(kinds).toContain('class-membership')
    expect(kinds).toContain('documentation')
    expect(kinds).toContain('vocab-intent')
    for (const gap of notRecovered) expect(gap.message.length).toBeGreaterThan(40)
  })

  it('invents no class and no description', () => {
    const { text } = importContext(ADVANCED)
    expect(text).not.toContain('note:')
    expect(text).not.toContain('shapes:')
    const { ir } = build(text)
    expect(ir!.terms.every((t) => t.note === undefined)).toBe(true)
  })

  it('does not report @vocab intent when the context declares none', () => {
    const { notRecovered } = importContext({ '@context': { name: 'https://schema.org/name' } })
    expect(notRecovered.map((n) => n.kind)).not.toContain('vocab-intent')
  })
})

describe('round trip', () => {
  /**
   * Byte equality is not claimed: key order and shorthand forms are not
   * preserved, and pretending otherwise would be a false guarantee.
   *
   * @lat: [[emitters#Emitters#Verification]]
   */
  function semanticEquality(a: unknown, b: unknown): void {
    expect(normalizeContext(a)).toEqual(normalizeContext(b))
  }

  it('import then emit is semantically equal to the input', () => {
    const { text } = importContext(ADVANCED)
    const { ir, source } = build(text)
    const emitted = emit(ir!, { target: 'context', source })
    semanticEquality(emitted.document['@context'], ADVANCED['@context'])
  })

  it('import, emit, import, emit reaches a fixed point', () => {
    const first = importContext(ADVANCED)
    const firstBuild = build(first.text)
    const firstEmit = emit(firstBuild.ir!, {
      target: 'context',
      source: firstBuild.source,
    })

    const second = importContext(JSON.parse(stripComments(firstEmit.text)))
    const secondBuild = build(second.text)
    const secondEmit = emit(secondBuild.ir!, {
      target: 'context',
      source: secondBuild.source,
    })

    // Element ids are freshly minted each time, so the models differ; the
    // artifacts must not.
    expect(stripComments(secondEmit.text)).toBe(stripComments(firstEmit.text))
  })

  it('a context with only a bare term round-trips', () => {
    const simple = { '@context': { name: 'https://schema.org/name' } }
    const { text } = importContext(simple)
    const { ir, source } = build(text)
    const emitted = emit(ir!, { target: 'context', source })
    semanticEquality(emitted.document['@context'], simple['@context'])
  })

  it('a layered context keeps its reference in the emitted artifact', () => {
    const layered = { '@context': [UPSTREAM, { local: 'https://example.org/ns#local' }] }
    const { text } = importContext(layered)
    const { ir, source } = build(text)
    const emitted = emit(ir!, { target: 'context', source })
    const context = emitted.document['@context'] as unknown[]
    expect(context[0]).toBe(UPSTREAM)
  })
})

/**
 * Normalising comparison: a term written as a bare IRI and the same term
 * written as `{"@id": ...}` mean the same thing, and `@version` is a model
 * declaration rather than a term.
 */
function normalizeContext(value: unknown): Record<string, unknown> {
  const layers = Array.isArray(value) ? value : [value]
  const merged: Record<string, unknown> = {}
  for (const layer of layers) {
    if (layer === null || typeof layer !== 'object') continue
    Object.assign(merged, layer as Record<string, unknown>)
  }
  delete merged['@version']

  const out: Record<string, unknown> = {}
  for (const key of Object.keys(merged).sort()) {
    const definition = merged[key]
    if (key.startsWith('@')) {
      out[key] = definition
      continue
    }
    const expanded =
      typeof definition === 'string' ? { '@id': definition } : (definition as unknown)
    if (expanded === null || typeof expanded !== 'object') {
      out[key] = expanded
      continue
    }
    const entry: Record<string, unknown> = {}
    const source = { ...(expanded as Record<string, unknown>) }
    // The escape hatch is flattened back: it is where the facet came from.
    const raw = source['raw']
    delete source['raw']
    Object.assign(source, raw ?? {})
    for (const facet of Object.keys(source).sort()) {
      const facetValue = source[facet]
      // A one-element container list and a bare container mean the same thing.
      entry[facet] =
        facet === '@container' && Array.isArray(facetValue) && facetValue.length === 1
          ? facetValue[0]
          : facetValue
    }
    out[key] = entry
  }
  return out
}
