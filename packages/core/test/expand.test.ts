import { describe, expect, it } from 'vitest'

import {
  bareExpanded,
  expandDocument,
  pointersIn,
  unresolvedPointers,
} from '../src/processor/api.js'
import { processContext } from '../src/processor/active-context.js'
import { emptyContext } from '../src/processor/types.js'
import { pointerGet, pointerResolves } from '../src/source/pointer.js'

function ctx(local: unknown, base?: string) {
  return processContext(emptyContext(base), local)
}

function run(document: unknown, local: unknown, base?: string) {
  const result = expandDocument(document, ctx(local, base))
  return { ...result, bare: bareExpanded(result) }
}

describe('active context construction', () => {
  // @lat: [[processing#Processing#Expansion]]
  it('builds term definitions, prefixes, @vocab and @base', () => {
    const active = ctx({
      '@version': 1.1,
      '@base': 'https://example.org/docs/',
      '@vocab': 'https://example.org/ns#',
      schema: 'https://schema.org/',
      name: 'schema:name',
      author: { '@id': 'schema:author', '@type': '@id' },
    })
    expect(active.baseIri).toBe('https://example.org/docs/')
    expect(active.vocab).toBe('https://example.org/ns#')
    expect(active.terms.get('name')!.iri).toBe('https://schema.org/name')
    expect(active.terms.get('author')!.typeMapping).toBe('@id')
    expect(active.terms.get('schema')!.prefix).toBe(true)
  })

  it('a term with no @id derives its IRI from @vocab', () => {
    const active = ctx({ '@vocab': 'https://example.org/ns#', title: {} })
    expect(active.terms.get('title')!.iri).toBe('https://example.org/ns#title')
  })

  it('refuses a container value the specification does not allow', () => {
    expect(() => ctx({ tags: { '@id': 'https://e.org/t', '@container': '@bag' } })).toThrow(
      /invalid container mapping/,
    )
  })

  it('refuses a protected term redefinition', () => {
    const base = ctx({ name: { '@id': 'https://schema.org/name', '@protected': true } })
    expect(() => processContext(base, { name: 'https://example.org/other' })).toThrow(
      /protected term redefinition/,
    )
  })

  it('allows redefining a protected term to the same definition', () => {
    const base = ctx({ name: { '@id': 'https://schema.org/name', '@protected': true } })
    const next = processContext(base, { name: { '@id': 'https://schema.org/name' } })
    expect(next.terms.get('name')!.iri).toBe('https://schema.org/name')
  })
})

describe('expansion', () => {
  // @lat: [[processing#Processing#Expansion]]
  it('expands a plain node object', () => {
    const { bare } = run(
      { '@id': 'https://example.org/1', name: 'Ada' },
      { name: 'https://schema.org/name' },
    )
    expect(bare).toEqual([
      {
        '@id': 'https://example.org/1',
        'https://schema.org/name': [{ '@value': 'Ada' }],
      },
    ])
  })

  it('coerces a reference with @type: @id', () => {
    const { bare } = run(
      { author: 'https://example.org/ada' },
      { author: { '@id': 'https://schema.org/author', '@type': '@id' } },
    )
    expect(bare).toEqual([
      { 'https://schema.org/author': [{ '@id': 'https://example.org/ada' }] },
    ])
  })

  it('applies a type-scoped context below the scope and not above it', () => {
    const local = {
      '@version': 1.1,
      Person: {
        '@id': 'https://schema.org/Person',
        '@context': { name: 'https://schema.org/givenName' },
      },
      name: 'https://schema.org/name',
      knows: { '@id': 'https://schema.org/knows', '@type': '@id' },
    }
    const { bare } = run(
      { '@type': 'Person', name: 'Ada' },
      local,
    )
    // Inside the Person scope, `name` is givenName.
    expect(bare).toEqual([
      {
        '@type': ['https://schema.org/Person'],
        'https://schema.org/givenName': [{ '@value': 'Ada' }],
      },
    ])

    // Outside it, `name` is still name.
    const outside = run({ name: 'Ada' }, local)
    expect(outside.bare).toEqual([{ 'https://schema.org/name': [{ '@value': 'Ada' }] }])
  })

  it('applies a property-scoped context and propagates by default', () => {
    const { bare } = run(
      { detail: { label: 'x', inner: { label: 'y' } } },
      {
        '@version': 1.1,
        label: 'https://example.org/outer',
        inner: 'https://example.org/inner',
        detail: {
          '@id': 'https://example.org/detail',
          '@context': { label: 'https://example.org/scoped' },
        },
      },
    )
    const detail = (bare[0] as Record<string, unknown>)['https://example.org/detail'] as unknown[]
    const node = detail[0] as Record<string, unknown>
    expect(node['https://example.org/scoped']).toEqual([{ '@value': 'x' }])
    const inner = (node['https://example.org/inner'] as unknown[])[0] as Record<string, unknown>
    // A property-scoped context propagates into the nested node object.
    expect(inner['https://example.org/scoped']).toEqual([{ '@value': 'y' }])
  })
})

describe('container forms', () => {
  // @lat: [[metamodel#Metamodel#Terms#Containers]]
  it('@list produces an ordered list object', () => {
    const { bare } = run(
      { items: ['a', 'b'] },
      { items: { '@id': 'https://e.org/items', '@container': '@list' } },
    )
    expect(bare).toEqual([
      { 'https://e.org/items': [{ '@list': [{ '@value': 'a' }, { '@value': 'b' }] }] },
    ])
  })

  it('@set is transparent', () => {
    const { bare } = run(
      { items: 'a' },
      { items: { '@id': 'https://e.org/items', '@container': '@set' } },
    )
    expect(bare).toEqual([{ 'https://e.org/items': [{ '@value': 'a' }] }])
  })

  it('@language builds a language map', () => {
    const { bare } = run(
      { label: { en: 'Name', fr: 'Nom' } },
      { label: { '@id': 'https://e.org/label', '@container': '@language' } },
    )
    expect(bare).toEqual([
      {
        'https://e.org/label': [
          { '@value': 'Name', '@language': 'en' },
          { '@value': 'Nom', '@language': 'fr' },
        ],
      },
    ])
  })

  it('@index preserves the index', () => {
    const { bare } = run(
      { items: { first: { '@id': 'https://e.org/1' } } },
      { items: { '@id': 'https://e.org/items', '@container': '@index' } },
    )
    expect(bare).toEqual([
      { 'https://e.org/items': [{ '@id': 'https://e.org/1', '@index': 'first' }] },
    ])
  })

  it('@id builds an id map', () => {
    const { bare } = run(
      { items: { 'https://e.org/1': { label: 'x' } } },
      {
        '@version': 1.1,
        label: 'https://e.org/label',
        items: { '@id': 'https://e.org/items', '@container': '@id' },
      },
    )
    expect(bare).toEqual([
      {
        'https://e.org/items': [
          { '@id': 'https://e.org/1', 'https://e.org/label': [{ '@value': 'x' }] },
        ],
      },
    ])
  })

  it('@type builds a type map', () => {
    const { bare } = run(
      { items: { 'https://e.org/T': { label: 'x' } } },
      {
        '@version': 1.1,
        label: 'https://e.org/label',
        items: { '@id': 'https://e.org/items', '@container': '@type' },
      },
    )
    expect(bare).toEqual([
      {
        'https://e.org/items': [
          { '@type': ['https://e.org/T'], 'https://e.org/label': [{ '@value': 'x' }] },
        ],
      },
    ])
  })

  it('@graph wraps values in a graph object', () => {
    const { bare } = run(
      { items: { label: 'x' } },
      {
        '@version': 1.1,
        label: 'https://e.org/label',
        items: { '@id': 'https://e.org/items', '@container': '@graph' },
      },
    )
    const items = (bare[0] as Record<string, unknown>)['https://e.org/items'] as unknown[]
    expect(items[0]).toHaveProperty('@graph')
  })

  it('@nest flattens the nesting key away', () => {
    const { bare } = run(
      { detail: { name: 'Ada' } },
      {
        '@version': 1.1,
        name: 'https://schema.org/name',
        detail: '@nest',
      },
    )
    expect(bare).toEqual([{ 'https://schema.org/name': [{ '@value': 'Ada' }] }])
  })

  it('@reverse builds a reverse map', () => {
    const { bare } = run(
      { child: { '@id': 'https://e.org/kid' } },
      { child: { '@reverse': 'https://e.org/parent', '@type': '@id' } },
    )
    expect(bare).toEqual([
      { '@reverse': { 'https://e.org/parent': [{ '@id': 'https://e.org/kid' }] } },
    ])
  })

  it('@included keeps node objects alongside', () => {
    const { bare } = run(
      { '@id': 'https://e.org/1', '@included': [{ '@id': 'https://e.org/2', name: 'x' }] },
      { '@version': 1.1, name: 'https://schema.org/name' },
    )
    expect(bare[0]).toHaveProperty('@included')
  })
})

describe('value expansion', () => {
  it('coerces by @type', () => {
    const { bare } = run(
      { age: '42' },
      {
        age: {
          '@id': 'https://e.org/age',
          '@type': 'http://www.w3.org/2001/XMLSchema#integer',
        },
      },
    )
    expect(bare).toEqual([
      {
        'https://e.org/age': [
          { '@value': '42', '@type': 'http://www.w3.org/2001/XMLSchema#integer' },
        ],
      },
    ])
  })

  it('applies the default language and @direction', () => {
    const { bare } = run(
      { name: 'Ada' },
      { '@language': 'en', '@direction': 'ltr', name: 'https://schema.org/name' },
    )
    expect(bare).toEqual([
      { 'https://schema.org/name': [{ '@value': 'Ada', '@language': 'en', '@direction': 'ltr' }] },
    ])
  })

  it('a term-level @language null cancels the default', () => {
    const { bare } = run(
      { code: 'X1' },
      { '@language': 'en', code: { '@id': 'https://e.org/code', '@language': null } },
    )
    expect(bare).toEqual([{ 'https://e.org/code': [{ '@value': 'X1' }] }])
  })

  it('keeps a @json value verbatim', () => {
    const { bare } = run(
      { blob: { a: [1, 2] } },
      { '@version': 1.1, blob: { '@id': 'https://e.org/blob', '@type': '@json' } },
    )
    expect(bare).toEqual([
      { 'https://e.org/blob': [{ '@value': { a: [1, 2] }, '@type': '@json' }] },
    ])
  })
})

describe('the public result', () => {
  // @lat: [[processing#Processing#Source Mapping]]
  it('contains no pointer, envelope or tool-specific key', () => {
    const result = expandDocument(
      { '@id': 'https://e.org/1', name: 'Ada' },
      ctx({ name: 'https://schema.org/name' }),
    )
    const bare = bareExpanded(result)
    const text = JSON.stringify(bare)
    expect(text).not.toContain('pointer')
    expect(text).not.toContain('provenance')
    // The symbols are gone from the stripped copy, and present on the original.
    expect(pointersIn(result).length).toBeGreaterThan(0)
    expect(pointersIn({ expanded: bare })).toEqual([])
  })

  it('locates a dropped key by its pointer', () => {
    const input = { '@id': 'https://e.org/1', mystery: 'x' }
    const { observations } = expandDocument(input, ctx({ name: 'https://schema.org/name' }))
    const dropped = observations.filter((o) => o.kind === 'key-dropped')
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.pointer).toBe('/mystery')
    expect(pointerResolves(input, '/mystery')).toBe(true)
    expect(pointerGet(input, '/mystery')).toBe('x')
  })

  it('distinguishes a drop under @vocab from a drop outright', () => {
    const withoutVocab = expandDocument({ mystery: 'x' }, ctx({}))
    const withVocab = expandDocument({ mystery: 'x' }, ctx({ '@vocab': 'https://e.org/' }))
    const a = withoutVocab.observations.find((o) => o.kind === 'key-dropped')
    expect(a).toMatchObject({ underVocab: false })
    // Under @vocab the key is not dropped at all — it becomes an invented IRI.
    expect(withVocab.observations.some((o) => o.kind === 'key-dropped')).toBe(false)
    expect(bareExpanded(withVocab)).toEqual([
      { 'https://e.org/mystery': [{ '@value': 'x' }] },
    ])
  })

  it('reports a coercion that did not fire', () => {
    const { observations } = expandDocument(
      { author: 'https://example.org/ada' },
      ctx({ author: 'https://schema.org/author' }),
    )
    const finding = observations.find((o) => o.kind === 'coercion-did-not-fire')
    expect(finding).toMatchObject({ term: 'author', pointer: '/author' })
  })
})

describe('pointers always resolve', () => {
  const cases: Array<[string, unknown, unknown]> = [
    ['a plain node', { '@id': 'https://e.org/1', name: 'Ada' }, { name: 'https://schema.org/name' }],
    [
      'a list',
      { items: ['a', 'b', 'c'] },
      { items: { '@id': 'https://e.org/i', '@container': '@list' } },
    ],
    [
      'a language map',
      { label: { en: 'a', fr: 'b' } },
      { label: { '@id': 'https://e.org/l', '@container': '@language' } },
    ],
    [
      'an index map',
      { items: { one: { '@id': 'https://e.org/1' } } },
      { items: { '@id': 'https://e.org/i', '@container': '@index' } },
    ],
    [
      'nesting and a type-scoped context',
      { '@type': 'Person', detail: { name: 'Ada' } },
      {
        '@version': 1.1,
        Person: { '@id': 'https://e.org/P', '@context': { name: 'https://e.org/given' } },
        name: 'https://schema.org/name',
        detail: '@nest',
      },
    ],
    [
      'nested arrays of node objects',
      { items: [{ name: 'a' }, { name: 'b', items: [{ name: 'c' }] }] },
      { name: 'https://schema.org/name', items: 'https://e.org/items' },
    ],
    [
      'a graph container',
      { items: [{ name: 'a' }, { name: 'b' }] },
      {
        '@version': 1.1,
        name: 'https://schema.org/name',
        items: { '@id': 'https://e.org/i', '@container': '@graph' },
      },
    ],
  ]

  // @lat: [[processing#Processing#Source Mapping]]
  it.each(cases)('every pointer resolves: %s', (_name, document, local) => {
    const result = expandDocument(document, ctx(local))
    expect(pointersIn(result).length).toBeGreaterThan(0)
    expect(unresolvedPointers(document, result)).toEqual([])
  })
})
