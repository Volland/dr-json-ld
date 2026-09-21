import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { activeContextForModel, expandDocument } from '../src/processor/api.js'
import { toNQuads, toRdf, type TracedQuad } from '../src/processor/to-rdf.js'
import { resolveModelText } from '../src/model/resolve.js'
import { indexJson } from '../src/source/index-file.js'
import { pointerResolves } from '../src/source/pointer.js'
import type { Instrumentation, TraceEvent } from '../src/processor/types.js'

const MODELS = fileURLToPath(new URL('./fixtures/models/', import.meta.url))
const BOOKSHELF = fileURLToPath(new URL('../../../examples/bookshelf/', import.meta.url))

function convert(modelPath: string, documentPath: string, instrumentation?: Instrumentation) {
  const { ir } = resolveModelText(readFileSync(modelPath, 'utf8'), modelPath)
  const text = readFileSync(documentPath, 'utf8')
  const input = JSON.parse(text)
  const { expanded } = expandDocument(input, activeContextForModel(ir!))
  return {
    input,
    source: indexJson(text, documentPath),
    quads: toRdf(expanded, instrumentation ? { instrumentation } : {}),
  }
}

const credential = () =>
  convert(`${MODELS}credential.jsonld.yaml`, `${MODELS}documents/credential-ok.json`)

const find = (quads: TracedQuad[], predicate: string) =>
  quads.filter((q) => q.predicate.value.endsWith(predicate))

describe('RDF conversion carries source pointers', () => {
  it('gives every triple a subject, predicate and object pointer into the input', () => {
    for (const [model, document] of [
      [`${MODELS}credential.jsonld.yaml`, `${MODELS}documents/credential-ok.json`],
      [`${BOOKSHELF}bookshelf.jsonld.yaml`, `${BOOKSHELF}documents/book-ok.json`],
      [`${BOOKSHELF}bookshelf.jsonld.yaml`, `${BOOKSHELF}documents/person-ok.json`],
    ] as const) {
      const { input, quads, source } = convert(model, document)
      expect(quads.length).toBeGreaterThanOrEqual(3)
      for (const quad of quads) {
        for (const pointer of Object.values(quad.pointers)) {
          expect(pointerResolves(input, pointer), `${document}: ${pointer}`).toBe(true)
          expect(source.positionOf(pointer).line).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })

  it('locates a literal at its key and its value', () => {
    const { quads, source } = credential()
    const [validFrom] = find(quads, '#validFrom')
    expect(validFrom!.object).toMatchObject({
      termType: 'Literal',
      value: '2026-01-01T19:23:24Z',
      datatype: { value: 'http://www.w3.org/2001/XMLSchema#dateTime' },
    })
    expect(validFrom!.pointers).toEqual({
      subject: '',
      predicate: '/validFrom',
      object: '/validFrom',
    })
    expect(source.positionOf(validFrom!.pointers.predicate).line).toBe(5)
  })

  it('locates a nested node as the subject of its own triples', () => {
    const { quads } = credential()
    const [name] = find(quads, 'schema.org/name').filter((q) => q.object.value === 'Ada Lovelace')
    expect(name!.pointers.subject).toBe('/credentialSubject')
    expect(name!.pointers.object).toBe('/credentialSubject/name')
  })

  it('locates an array item at its index and its key without the index', () => {
    const { quads } = convert(`${BOOKSHELF}bookshelf.jsonld.yaml`, `${BOOKSHELF}documents/book-ok.json`)
    const keywords = find(quads, 'schema.org/keywords')
    expect(keywords.length).toBeGreaterThan(1)
    for (const quad of keywords) {
      expect(quad.pointers.object).toMatch(/^\/tags\/[0-9]+$/)
      expect(quad.pointers.predicate).toBe('/tags')
    }
  })

  it('labels blank nodes the same way every time', () => {
    const one = toNQuads(credential().quads)
    const two = toNQuads(credential().quads)
    expect(one).toBe(two)
  })

  it('records each emitted triple in traced mode', () => {
    const events: TraceEvent[] = []
    const { quads } = convert(
      `${MODELS}credential.jsonld.yaml`,
      `${MODELS}documents/credential-ok.json`,
      { onEvent: (e) => events.push(e) },
    )
    const emitted = events.filter((e) => e.kind === 'emit-triple')
    expect(emitted).toHaveLength(quads.length)
  })
})
