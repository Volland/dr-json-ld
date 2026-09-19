import { describe, expect, it } from 'vitest'

import { processContext } from '../src/processor/active-context.js'
import { bareExpanded, expandDocument } from '../src/processor/api.js'
import { expandTraced, formatTrace } from '../src/processor/trace.js'
import { emptyContext, NO_INSTRUMENTATION } from '../src/processor/types.js'
import { SourceIndex } from '../src/source/index-file.js'

function ctx(local: unknown) {
  return processContext(emptyContext('https://example.org/doc'), local)
}

const SCOPED = {
  '@version': 1.1,
  label: 'https://e.org/outer',
  inner: 'https://e.org/inner',
  detail: {
    '@id': 'https://e.org/detail',
    '@context': { '@propagate': false, label: 'https://e.org/scoped' },
  },
}

describe('traced expansion', () => {
  // @lat: [[processing#Processing#Trace]]
  it('records every instrumentation point', () => {
    const { trace } = expandTraced(
      { '@id': 'https://e.org/1', label: 'x', mystery: 'y' },
      ctx({ label: 'https://e.org/label' }),
    )
    const kinds = new Set(trace.map((t) => t.event.kind))
    expect(kinds).toContain('term-lookup')
    expect(kinds).toContain('key-dropped')
    expect(trace.map((t) => t.step)).toEqual(trace.map((_, i) => i))
  })

  it('records where a scoped context takes effect and where it ceases to apply', () => {
    const { trace } = expandTraced(
      { detail: { label: 'a', inner: { label: 'b' } } },
      ctx(SCOPED),
    )
    const changes = trace.filter((t) => t.event.kind === 'active-context-change')
    const reasons = changes.map((c) =>
      c.event.kind === 'active-context-change' ? c.event.reason : '',
    )
    expect(reasons).toContain('property-scoped')
    expect(reasons).toContain('revert')

    const takesEffect = changes.find(
      (c) => c.event.kind === 'active-context-change' && c.event.reason === 'property-scoped',
    )!
    const ceases = changes.find(
      (c) => c.event.kind === 'active-context-change' && c.event.reason === 'revert',
    )!
    expect(takesEffect.step).toBeLessThan(ceases.step)
    expect(
      takesEffect.event.kind === 'active-context-change' ? takesEffect.event.detail : '',
    ).toContain('does not propagate')
  })

  it('records a value coercion and an IRI resolution', () => {
    const { trace } = expandTraced(
      { author: 'ada' },
      ctx({ author: { '@id': 'https://schema.org/author', '@type': '@id' } }),
    )
    const coercion = trace.find((t) => t.event.kind === 'value-coercion')
    expect(coercion?.event).toMatchObject({ term: 'author', coercion: '@id' })
    const resolution = trace.find((t) => t.event.kind === 'iri-resolution')
    expect(resolution?.event).toMatchObject({ output: 'https://example.org/ada' })
  })

  // @lat: [[processing#Processing#Trace]]
  it('is off by default', () => {
    // The default instrumentation records nothing and the API takes no trace.
    const result = expandDocument({ label: 'x' }, ctx({ label: 'https://e.org/label' }))
    expect('trace' in result).toBe(false)
    expect(() => NO_INSTRUMENTATION.onEvent({
      kind: 'key-dropped',
      key: 'x',
      reason: 'no-term',
      pointer: '/x',
    })).not.toThrow()
  })

  it('produces identical output traced and untraced', () => {
    const cases: Array<[unknown, unknown]> = [
      [{ '@id': 'https://e.org/1', label: 'x', mystery: 'y' }, { label: 'https://e.org/label' }],
      [{ detail: { label: 'a', inner: { label: 'b' } } }, SCOPED],
      [
        { items: { en: 'a', fr: 'b' } },
        { items: { '@id': 'https://e.org/i', '@container': '@language' } },
      ],
    ]
    for (const [document, local] of cases) {
      const active = ctx(local)
      const untraced = bareExpanded(expandDocument(document, active))
      const traced = expandTraced(document, ctx(local))
      expect(JSON.parse(JSON.stringify(traced.expanded))).toEqual(untraced)
      expect(traced.observations).toEqual(expandDocument(document, ctx(local)).observations)
    }
  })

  it('resolves each entry to a line and column when the input is indexed', () => {
    const text = JSON.stringify({ '@id': 'https://e.org/1', mystery: 'y' }, null, 2)
    const source = SourceIndex.parse(text, { path: 'doc.json' })
    const { trace } = expandTraced(source.data, ctx({ label: 'https://e.org/label' }), {
      source,
    })
    const dropped = trace.find((t) => t.event.kind === 'key-dropped')!
    expect(dropped.loc).toBeDefined()
    expect(text.split('\n')[dropped.loc!.line - 1]).toContain('mystery')
  })

  it('formats one readable line per step', () => {
    const { trace } = expandTraced({ mystery: 'y' }, ctx({}))
    const lines = formatTrace(trace)
    expect(lines).toHaveLength(trace.length)
    expect(lines.join('\n')).toContain('no term matched and no @vocab applies')
  })
})
