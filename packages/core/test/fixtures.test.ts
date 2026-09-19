import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jsonld from 'jsonld'

import { emit, stripComments } from '../src/emit/emit.js'
import { resolveModelText } from '../src/model/resolve.js'
import { resolverFor } from '../src/vendor/vendor.js'
import { SourceIndex } from '../src/source/index-file.js'
import { validateModel } from '../src/validate/validate.js'

const MODELS = fileURLToPath(new URL('./fixtures/models/', import.meta.url))

/** Every `.jsonld.yaml` under the fixture directory. */
const fixtureModels = readdirSync(MODELS).filter((f) => f.endsWith('.jsonld.yaml'))

function load(name: string) {
  const path = join(MODELS, name)
  const text = readFileSync(path, 'utf8')
  const source = SourceIndex.parse(text, { path: name })
  const { ir, findings } = resolveModelText(text, name)
  return { text, source, ir, findings }
}

function checkOf(name: string) {
  const { text, source, ir } = load(name)
  return validateModel(source, {
    ...(ir ? { resolveContext: resolverFor(ir, MODELS) } : {}),
    readExample: (relative) => {
      try {
        return readFileSync(join(MODELS, relative), 'utf8')
      } catch {
        return undefined
      }
    },
  })
  void text
}

/**
 * The continuous-integration task: every fixture model resolves, emits both
 * targets, and every example meets its expected outcome.
 *
 * @lat: [[metamodel#Metamodel#Examples]]
 */
describe('every fixture model', () => {
  it('there is at least one', () => {
    expect(fixtureModels.length).toBeGreaterThan(0)
  })

  it.each(fixtureModels)('%s resolves without an error finding', (name) => {
    const { ir, findings } = load(name)
    expect(ir).toBeDefined()
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
  })

  it.each(fixtureModels)('%s emits both targets', (name) => {
    const { ir, source } = load(name)
    for (const target of ['context', 'context-inline'] as const) {
      const result = emit(ir!, {
        target,
        source,
        resolveContext: resolverFor(ir!, MODELS),
        modelName: name,
      })
      expect(result.findings.filter((f) => f.severity === 'error'), target).toEqual([])
      expect(() => JSON.parse(stripComments(result.text))).not.toThrow()
    }
  })

  it.each(fixtureModels)('%s: every example meets its expected outcome', (name) => {
    const report = checkOf(name)
    for (const outcome of report.examples) {
      expect(
        outcome.met,
        `${outcome.path}: missing ${outcome.missing.join(', ') || 'nothing'}; unexpected ${
          outcome.unexpected.join(', ') || 'nothing'
        }`,
      ).toBe(true)
    }
    expect(report.findings.some((f) => f.ruleId === 'L0.example-outcome-unmet')).toBe(false)
  })

  it.each(fixtureModels)(
    '%s: an independent implementation round-trips every example through the emitted context',
    async (name) => {
      const { ir, source } = load(name)
      const emitted = emit(ir!, {
        target: 'context-inline',
        source,
        resolveContext: resolverFor(ir!, MODELS),
        modelName: name,
      })
      const artifact = JSON.parse(stripComments(emitted.text)) as { '@context': unknown }

      for (const example of ir!.examples) {
        // A negative example is a document that loses content on purpose, so a
        // round trip of it is not meaningful; a positive one must survive.
        if (example.expect.kind !== 'positive') continue
        const document = JSON.parse(readFileSync(join(MODELS, example.path), 'utf8'))

        const expanded = (await jsonld.expand({
          ...artifact,
          ...document,
        } as never)) as unknown[]
        const compacted = (await jsonld.compact(
          expanded as never,
          artifact['@context'] as never,
        )) as Record<string, unknown>
        const again = (await jsonld.expand(compacted as never)) as unknown[]

        expect(normalize(again), example.path).toEqual(normalize(expanded))
        expect(expanded.length, example.path).toBeGreaterThan(0)
      }
    },
  )
})

describe('the catalogue fixture', () => {
  const NAME = 'catalogue.jsonld.yaml'

  // @lat: [[metamodel#Metamodel#Terms#Containers]]
  it('covers every container form', () => {
    const { ir } = load(NAME)
    const containers = new Set(
      ir!.terms.flatMap((t) => t['@container'] ?? []).map((c) => String(c)),
    )
    expect([...containers].sort()).toEqual([
      '@graph',
      '@id',
      '@index',
      '@language',
      '@list',
      '@set',
      '@type',
    ])
  })

  it('references an external context and resolves it from the vendored copy', () => {
    const { ir } = load(NAME)
    expect(ir!.uses).toHaveLength(1)
    const resolve = resolverFor(ir!, MODELS)
    const upstream = resolve(ir!.uses[0]!.iri) as Record<string, unknown>
    expect(upstream).toBeDefined()
    const report = checkOf(NAME)
    expect(report.findings.some((f) => f.ruleId === 'L1.context-not-vendored')).toBe(false)
    expect(report.findings.some((f) => f.ruleId === 'L1.context-hash-mismatch')).toBe(false)
  })

  it('declares a scoped context', () => {
    const { ir } = load(NAME)
    expect(ir!.terms.find((t) => t.key === 'detail')!['@context']).toBeDefined()
  })

  // @lat: [[validation#Validation#The Ladder#L2 Lossiness]]
  it('has a document that silently loses most of its content', () => {
    const report = checkOf(NAME)
    const outcome = report.examples.find((e) => e.path.includes('empties'))!
    const dropped = outcome.findings.filter((f) => f.ruleId === 'L2.key-dropped')
    expect(dropped.length).toBeGreaterThanOrEqual(3)
    // Expansion still succeeded; nothing raised an error.
    expect(outcome.findings.every((f) => f.severity !== 'error')).toBe(true)
    // And each drop points at its own key in the document the user wrote.
    for (const finding of dropped) {
      expect(finding.file).toContain('catalogue-empties.json')
      expect(finding.loc.line).toBeGreaterThan(1)
    }
  })

  it('reports a relation left uncoerced at the value that reads as an IRI', () => {
    const report = checkOf(NAME)
    const outcome = report.examples.find((e) => e.path.includes('uncoerced'))!
    const finding = outcome.findings.find((f) => f.ruleId === 'L2.coercion-did-not-fire')!
    expect(finding).toBeDefined()
    expect(finding.pointer).toBe('/title')
  })

  it('reports no term as invisible, because the view includes them all', () => {
    const report = checkOf(NAME)
    expect(report.findings.filter((f) => f.ruleId === 'L2.term-in-no-view')).toEqual([])
  })
})

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
