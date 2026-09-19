import { describe, expect, it } from 'vitest'
import jsonld from 'jsonld'

import { processContext } from '../src/processor/active-context.js'
import { buildInverseContext, compact } from '../src/processor/compact.js'
import { bareExpanded, expandDocument } from '../src/processor/api.js'
import { emptyContext } from '../src/processor/types.js'

const BASE = 'https://example.org/doc'

function ctx(local: unknown) {
  return processContext(emptyContext(BASE), local)
}

function expandBare(document: unknown, local: unknown): unknown[] {
  return bareExpanded(expandDocument(document, ctx(local)))
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = normalize((value as Record<string, unknown>)[key])
  }
  return out
}

describe('the inverse context', () => {
  // @lat: [[processing#Processing#Compaction]]
  it('indexes a term by its IRI, container and type', () => {
    const active = ctx({
      name: 'https://schema.org/name',
      author: { '@id': 'https://schema.org/author', '@type': '@id' },
      tags: { '@id': 'https://e.org/tag', '@container': '@set' },
    })
    const inverse = buildInverseContext(active)
    expect(inverse['https://schema.org/name']!['@none']!['@language']!['@none']).toBe('name')
    expect(inverse['https://schema.org/author']!['@none']!['@type']!['@id']).toBe('author')
    expect(inverse['https://e.org/tag']!['@set']).toBeDefined()
  })

  it('prefers the shortest term when two map to the same IRI', () => {
    const active = ctx({
      n: 'https://schema.org/name',
      theVeryLongName: 'https://schema.org/name',
    })
    const inverse = buildInverseContext(active)
    expect(inverse['https://schema.org/name']!['@none']!['@language']!['@none']).toBe('n')
  })
})

const ROUND_TRIP_CASES: Array<{ name: string; context: unknown; document: unknown }> = [
  {
    name: 'a plain node object',
    context: { name: 'https://schema.org/name' },
    document: { '@id': 'https://example.org/1', name: 'Ada' },
  },
  {
    name: 'a coerced reference',
    context: { author: { '@id': 'https://schema.org/author', '@type': '@id' } },
    document: { author: 'https://example.org/ada' },
  },
  {
    name: 'prefixes',
    context: { schema: 'https://schema.org/', name: 'schema:name' },
    document: { name: 'Ada' },
  },
  {
    name: '@vocab',
    context: { '@vocab': 'https://example.org/ns#' },
    document: { anything: 'x' },
  },
  {
    name: 'a list container',
    context: { items: { '@id': 'https://e.org/items', '@container': '@list' } },
    document: { items: ['a', 'b'] },
  },
  {
    name: 'a set container',
    context: { items: { '@id': 'https://e.org/items', '@container': '@set' } },
    document: { items: ['a'] },
  },
  {
    name: 'a language map',
    context: { label: { '@id': 'https://e.org/label', '@container': '@language' } },
    document: { label: { en: 'Name', fr: 'Nom' } },
  },
  {
    name: 'an index map',
    context: { items: { '@id': 'https://e.org/items', '@container': '@index' } },
    document: { items: { first: { '@id': 'https://e.org/1' } } },
  },
  {
    name: 'typed values',
    context: {
      age: { '@id': 'https://e.org/age', '@type': 'http://www.w3.org/2001/XMLSchema#integer' },
    },
    document: { age: '42' },
  },
  {
    name: 'a default language',
    context: { '@language': 'en', name: 'https://schema.org/name' },
    document: { name: 'Ada' },
  },
  {
    name: 'multiple values on one property',
    context: { '@vocab': 'https://e.org/' },
    document: { tag: ['a', 'b', 'c'] },
  },
  {
    name: 'a nested node object',
    context: { '@vocab': 'https://e.org/', child: { '@id': 'https://e.org/child' } },
    document: { child: { name: 'Ada' } },
  },
  {
    name: 'a graph',
    context: { '@vocab': 'https://e.org/' },
    document: { '@graph': [{ a: 1 }, { b: 2 }] },
  },
  {
    name: 'a reverse property',
    context: { child: { '@reverse': 'https://e.org/parent', '@type': '@id' } },
    document: { child: 'https://e.org/kid' },
  },
  {
    name: '@json',
    context: { '@version': 1.1, blob: { '@id': 'https://e.org/blob', '@type': '@json' } },
    document: { blob: { a: [1, 2] } },
  },
]

describe('expand, compact and expand again', () => {
  // @lat: [[emitters#Emitters#Verification]]
  it.each(ROUND_TRIP_CASES)('reaches a fixed point: $name', ({ context, document }) => {
    const active = ctx(context)
    const first = expandBare(document, context)
    const compacted = compact(first, active)
    const second = bareExpanded(expandDocument(compacted, active))
    expect(normalize(second)).toEqual(normalize(first))
  })

  it.each(ROUND_TRIP_CASES)(
    'compacts to something an independent implementation reads the same way: $name',
    async ({ context, document }) => {
      const active = ctx(context)
      const expanded = expandBare(document, context)
      const compacted = compact(expanded, active) as Record<string, unknown>

      // The compacted document is handed to jsonld.js with the same context; if
      // our term selection produced something misleading, this is where it shows.
      const reexpanded = (await jsonld.expand(compacted as never, {
        base: BASE,
        expandContext: { '@context': context } as never,
      })) as unknown[]
      expect(normalize(reexpanded)).toEqual(normalize(expanded))
    },
  )
})

describe('compaction reconstructs containers', () => {
  it('rebuilds a language map', () => {
    const context = { label: { '@id': 'https://e.org/label', '@container': '@language' } }
    const active = ctx(context)
    const expanded = expandBare({ label: { en: 'Name', fr: 'Nom' } }, context)
    expect(compact(expanded, active)).toEqual({ label: { en: 'Name', fr: 'Nom' } })
  })

  it('rebuilds a list', () => {
    const context = { items: { '@id': 'https://e.org/items', '@container': '@list' } }
    const active = ctx(context)
    const expanded = expandBare({ items: ['a', 'b'] }, context)
    expect(compact(expanded, active)).toEqual({ items: ['a', 'b'] })
  })

  it('keeps a @set term as an array even with one value', () => {
    const context = { items: { '@id': 'https://e.org/items', '@container': '@set' } }
    const active = ctx(context)
    const expanded = expandBare({ items: 'a' }, context)
    expect(compact(expanded, active)).toEqual({ items: ['a'] })
  })

  it('rebuilds an index map', () => {
    const context = { items: { '@id': 'https://e.org/items', '@container': '@index' } }
    const active = ctx(context)
    const expanded = expandBare({ items: { first: { '@id': 'https://e.org/1' } } }, context)
    expect(compact(expanded, active)).toEqual({ items: { first: { '@id': 'https://e.org/1' } } })
  })
})
