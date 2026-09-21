import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findShape, type Ir } from '../src/model/ir.js'
import { resolveModelText } from '../src/model/resolve.js'
import { serializeIr } from '../src/model/serialize.js'
import { buildContextDocument } from '../src/emit/context-document.js'
import { validateModelText } from '../src/validate/validate.js'

const SHAPES = fileURLToPath(new URL('./fixtures/shapes/', import.meta.url))
const CREDENTIAL = fileURLToPath(new URL('./fixtures/models/credential.jsonld.yaml', import.meta.url))

function check(path: string, text = readFileSync(path, 'utf8')) {
  return validateModelText(text, path, {
    readExample: (p) => readFileSync(join(dirname(path), p), 'utf8'),
  })
}

function irOf(text: string): Ir {
  const { ir, findings } = resolveModelText(text, 'model.jsonld.yaml')
  expect(findings.filter((f) => f.severity === 'error')).toEqual([])
  return ir!
}

const MODEL = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#
mode: "1.1"
prefixes:
  xsd: http://www.w3.org/2001/XMLSchema#
  schema: https://schema.org/
terms:
  Person: { id: per001, "@id": schema:Person }
  Organization:
    id: org001
    "@id": schema:Organization
    "@context":
      name: { id: nmo001, "@id": ex:legalName }
  name: { id: nam001, "@id": schema:name }
  wrote: { id: wro001, "@reverse": schema:author, "@type": "@id" }
shapes:
  Person:
    id: shp001
    targetClass: Person
    fields:
      name: { min: 1, max: 1 }
      wrote: { range: iri }
  Organization:
    id: shp002
    targetClass: Organization
    closed: true
    fields:
      name: { max: 1 }
`

describe('the shapes layer in the IR', () => {
  it('records each shape with its target class, resolved', () => {
    const ir = irOf(MODEL)
    const person = findShape(ir, 'Person')!
    expect(person.id).toBe('shp001')
    expect(person.targetIri).toBe('https://schema.org/Person')
    expect(person.targetTermId).toBe('per001')
    expect(person.closed).toBe(false)
    expect(findShape(ir, 'Organization')!.closed).toBe(true)
  })

  it('records exactly-one cardinality', () => {
    const name = findShape(irOf(MODEL), 'Person')!.fields.find((f) => f.key === 'name')!
    expect([name.min, name.max]).toEqual([1, 1])
  })

  it('resolves a field key in the type-scoped context of the target class first', () => {
    const ir = irOf(MODEL)
    const orgName = findShape(ir, 'Organization')!.fields[0]!
    expect(orgName.iri).toBe('https://example.org/ns#legalName')
    expect(orgName.termId).toBe('nmo001')
    const personName = findShape(ir, 'Person')!.fields.find((f) => f.key === 'name')!
    expect(personName.iri).toBe('https://schema.org/name')
    expect(personName.termId).toBe('nam001')
  })

  it('records a @reverse field as constraining the inverse property', () => {
    const wrote = findShape(irOf(MODEL), 'Person')!.fields.find((f) => f.key === 'wrote')!
    expect(wrote.inverse).toBe(true)
    expect(wrote.iri).toBe('https://schema.org/author')
  })

  it('records a shape range by the element id of the shape it names', () => {
    const ir = irOf(readFileSync(CREDENTIAL, 'utf8'))
    const subject = findShape(ir, 'Credential')!.fields.find((f) => f.key === 'credentialSubject')!
    expect(subject.range).toEqual({ kind: 'shape', shape: 'DegreeSubject', shapeId: 'shs001' })
  })

  it('resolves an untyped nested shape in the model context', () => {
    const ir = irOf(readFileSync(CREDENTIAL, 'utf8'))
    const subject = findShape(ir, 'DegreeSubject')!
    expect(subject.target).toBeUndefined()
    expect(subject.targetIri).toBeNull()
    expect(subject.fields.map((f) => f.iri).sort()).toEqual([
      'https://example.org/credentials#degree',
      'https://schema.org/name',
    ])
  })

  it('serializes identically when shapes or fields are reordered', () => {
    const reordered = MODEL.replace(
      '      name: { min: 1, max: 1 }\n      wrote: { range: iri }\n',
      '      wrote: { range: iri }\n      name: { min: 1, max: 1 }\n',
    )
    expect(serializeIr(irOf(reordered))).toBe(serializeIr(irOf(MODEL)))
    const [head, tail] = MODEL.split('shapes:\n')
    const blocks = tail!.split(/\n(?= {2}Organization:)/)
    const swapped = `${head}shapes:\n${blocks[1]!.trimEnd()}\n${blocks[0]!}\n`
    expect(serializeIr(irOf(swapped))).toBe(serializeIr(irOf(MODEL)))
  })

  it('leaves the snapshot of a model without shapes as it was', () => {
    const without = MODEL.split('shapes:\n')[0]!
    expect(serializeIr(irOf(without))).not.toContain('"shapes"')
  })

  it('leaves the emitted context untouched: shapes own cardinality, terms own coercion', () => {
    const without = MODEL.split('shapes:\n')[0]!
    expect(buildContextDocument(irOf(MODEL))).toEqual(buildContextDocument(irOf(without)))
  })

  it('lets two shapes disagree about one term without a finding', () => {
    const report = validateModelText(MODEL, 'model.jsonld.yaml')
    expect(report.findings.filter((f) => f.ruleId.includes('shape'))).toEqual([])
  })

  it('checks the credential fixture clean at L2, before any document is held to a shape', () => {
    const report = validateModelText(readFileSync(CREDENTIAL, 'utf8'), CREDENTIAL, {
      level: 'L2',
      readExample: (p) => readFileSync(join(dirname(CREDENTIAL), p), 'utf8'),
    })
    expect(report.findings.filter((f) => f.severity !== 'info' && !f.file.includes('documents/'))).toEqual([])
  })
})

/**
 * Each fixture declares, on its first line, the one rule it must raise — or
 * `nothing`. A fixture that raised its rule for the wrong reason would also
 * raise something else, which the exact comparison catches.
 */
describe('shape findings, one fixture per rule', () => {
  const files = readdirSync(SHAPES).filter((f) => f.endsWith('.jsonld.yaml'))
  expect(files.length).toBeGreaterThan(10)

  for (const file of files) {
    const path = join(SHAPES, file)
    const text = readFileSync(path, 'utf8')
    const declared = /^# raises: (\S+)/.exec(text)?.[1]
    it(`${file} raises ${declared}`, () => {
      expect(declared, `${file} must declare what it raises`).toBeDefined()
      const raised = check(path, text).findings.filter(
        (f) => f.ruleId !== 'L2.term-unused' && f.ruleId !== 'L2.term-in-no-view',
      )
      if (declared === 'nothing') {
        expect(raised).toEqual([])
        return
      }
      expect(raised.map((f) => f.ruleId)).toEqual([declared])
      // The pointer is the feature: it names a place in the model that exists.
      const finding = raised[0]!
      expect(finding.pointer.startsWith('/shapes/') || finding.pointer.startsWith('/views/')).toBe(true)
      expect(finding.loc.line).toBeGreaterThan(1)
    })
  }
})
