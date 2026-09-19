import { describe, expect, it } from 'vitest'
import jsonld from 'jsonld'

import { bareExpanded, expandDocument } from '../src/processor/api.js'
import { processContext } from '../src/processor/active-context.js'
import { emptyContext } from '../src/processor/types.js'

/**
 * The differential oracle. A divergence is a question with a right answer, and
 * the answer is recorded in `docs/measured-behaviour.md` rather than tolerated.
 *
 * @lat: [[processing#Processing#Conformance]]
 */

const BASE = 'https://example.org/doc'

/**
 * The context is applied externally rather than inlined, because an array
 * document cannot carry an `@context` entry and because this is the same path
 * `ours` takes — comparing anything else would compare two different questions.
 */
async function reference(document: unknown, context: unknown): Promise<unknown> {
  return (await jsonld.expand(document as never, {
    base: BASE,
    expandContext: { '@context': context } as never,
  })) as unknown
}

function ours(document: unknown, context: unknown): unknown {
  const active = processContext(emptyContext(BASE), context)
  return bareExpanded(expandDocument(document, active))
}

const CASES: Array<{ name: string; context: unknown; document: unknown }> = [
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
    name: 'a relative reference resolved against the base',
    context: { author: { '@id': 'https://schema.org/author', '@type': '@id' } },
    document: { author: 'ada' },
  },
  {
    name: 'prefixes and compact IRIs',
    context: { schema: 'https://schema.org/', name: 'schema:name' },
    document: { name: 'Ada', 'schema:email': 'a@b.c' },
  },
  {
    name: '@vocab',
    context: { '@vocab': 'https://example.org/ns#' },
    document: { anything: 'x', other: 2 },
  },
  {
    name: 'a list container',
    context: { items: { '@id': 'https://e.org/items', '@container': '@list' } },
    document: { items: ['a', 'b'] },
  },
  {
    name: 'a set container',
    context: { items: { '@id': 'https://e.org/items', '@container': '@set' } },
    document: { items: 'a' },
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
    name: 'an id map',
    context: {
      '@version': 1.1,
      label: 'https://e.org/label',
      items: { '@id': 'https://e.org/items', '@container': '@id' },
    },
    document: { items: { 'https://e.org/1': { label: 'x' } } },
  },
  {
    name: 'a type map',
    context: {
      '@version': 1.1,
      label: 'https://e.org/label',
      items: { '@id': 'https://e.org/items', '@container': '@type' },
    },
    document: { items: { 'https://e.org/T': { label: 'x' } } },
  },
  {
    name: 'a graph container',
    context: {
      '@version': 1.1,
      label: 'https://e.org/label',
      items: { '@id': 'https://e.org/items', '@container': '@graph' },
    },
    document: { items: { label: 'x' } },
  },
  {
    name: 'a type-scoped context',
    context: {
      '@version': 1.1,
      Person: { '@id': 'https://schema.org/Person', '@context': { name: 'https://e.org/given' } },
      name: 'https://schema.org/name',
    },
    document: { '@type': 'Person', name: 'Ada' },
  },
  {
    name: 'a property-scoped context',
    context: {
      '@version': 1.1,
      label: 'https://e.org/outer',
      detail: { '@id': 'https://e.org/detail', '@context': { label: 'https://e.org/scoped' } },
    },
    document: { label: 'a', detail: { label: 'b' } },
  },
  {
    name: 'a non-propagating scoped context',
    context: {
      '@version': 1.1,
      label: 'https://e.org/outer',
      inner: 'https://e.org/inner',
      detail: {
        '@id': 'https://e.org/detail',
        '@context': { '@propagate': false, label: 'https://e.org/scoped' },
      },
    },
    document: { detail: { label: 'a', inner: { label: 'b' } } },
  },
  {
    name: '@nest',
    context: { '@version': 1.1, name: 'https://schema.org/name', detail: '@nest' },
    document: { detail: { name: 'Ada' } },
  },
  {
    name: '@reverse on a term',
    context: { child: { '@reverse': 'https://e.org/parent', '@type': '@id' } },
    document: { child: 'https://e.org/kid' },
  },
  {
    name: 'an @reverse keyword entry',
    context: { parent: { '@id': 'https://e.org/parent', '@type': '@id' } },
    document: { '@id': 'https://e.org/1', '@reverse': { parent: { '@id': 'https://e.org/2' } } },
  },
  {
    name: '@included',
    context: { '@version': 1.1, name: 'https://schema.org/name' },
    document: { '@id': 'https://e.org/1', '@included': [{ '@id': 'https://e.org/2', name: 'x' }] },
  },
  {
    name: 'typed values',
    context: {
      age: { '@id': 'https://e.org/age', '@type': 'http://www.w3.org/2001/XMLSchema#integer' },
    },
    document: { age: '42' },
  },
  {
    name: 'a default language and direction',
    context: { '@language': 'en', '@direction': 'ltr', name: 'https://schema.org/name' },
    document: { name: 'Ada' },
  },
  {
    name: 'a term-level language null cancelling the default',
    context: { '@language': 'en', code: { '@id': 'https://e.org/code', '@language': null } },
    document: { code: 'X1' },
  },
  {
    name: '@json',
    context: { '@version': 1.1, blob: { '@id': 'https://e.org/blob', '@type': '@json' } },
    document: { blob: { a: [1, 2] } },
  },
  {
    name: 'a value object',
    context: { name: 'https://schema.org/name' },
    document: { name: { '@value': 'Ada', '@language': 'en' } },
  },
  {
    name: 'a nested graph',
    context: { '@version': 1.1, name: 'https://schema.org/name' },
    document: { '@graph': [{ name: 'a' }, { name: 'b' }] },
  },
  {
    name: 'a term whose definition is null, dropping the key',
    context: { name: 'https://schema.org/name', secret: null },
    document: { name: 'Ada', secret: 'hidden' },
  },
  {
    name: 'a key that maps to nothing',
    context: { name: 'https://schema.org/name' },
    document: { name: 'Ada', mystery: 'x' },
  },
  {
    name: 'numbers and booleans',
    context: { '@vocab': 'https://e.org/' },
    document: { n: 1, f: 1.5, b: true, s: 'x', nil: null },
  },
  {
    name: 'an array of node objects',
    context: { '@vocab': 'https://e.org/' },
    document: [{ a: 1 }, { b: 2 }],
  },
  {
    name: 'a protected term',
    context: { '@version': 1.1, name: { '@id': 'https://schema.org/name', '@protected': true } },
    document: { name: 'Ada' },
  },
  {
    name: 'a term used as a prefix',
    context: { '@version': 1.1, ex: { '@id': 'https://e.org/', '@prefix': true } },
    document: { 'ex:thing': 'x' },
  },
  {
    name: 'an index map with an index property',
    context: {
      '@version': 1.1,
      label: 'https://e.org/label',
      items: {
        '@id': 'https://e.org/items',
        '@container': '@index',
        '@index': 'https://e.org/key',
      },
    },
    document: { items: { first: { label: 'x' } } },
  },
]

describe('differential against jsonld.js', () => {
  // @lat: [[processing#Processing#Conformance]]
  it.each(CASES)('agrees on $name', async ({ context, document }) => {
    const expected = (await reference(document, context)) as unknown[]
    const actual = ours(document, context) as unknown[]
    expect(normalize(actual)).toEqual(normalize(expected))
  })
})

/**
 * Expanded output is unordered within a property array and between the entries
 * of an object, so the comparison sorts both. Anything that survives this is a
 * real divergence rather than an ordering difference.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(normalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = normalize((value as Record<string, unknown>)[key])
  }
  return out
}
