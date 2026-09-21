import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jsonld from 'jsonld'
import { DataFactory, Parser, Store } from 'n3'
import SHACLValidator from 'rdf-validate-shacl'
import { Validator } from 'shacl-engine'

import { capabilitiesFor } from '../src/emit/capability.js'
import { emit } from '../src/emit/emit.js'
import { resolveModelText } from '../src/model/resolve.js'
import { SourceIndex } from '../src/source/index-file.js'

const GOLDEN = fileURLToPath(new URL('./fixtures/golden/', import.meta.url))
const MODELS = fileURLToPath(new URL('./fixtures/models/', import.meta.url))
const BOOKSHELF = fileURLToPath(new URL('../../../examples/bookshelf/', import.meta.url))
const UPDATE = process.env['UPDATE_GOLDEN'] === '1'

function build(text: string, path = 'model.jsonld.yaml') {
  const { ir, findings } = resolveModelText(text, path)
  expect(findings.filter((f) => f.severity === 'error')).toEqual([])
  return { ir: ir!, source: SourceIndex.parse(text, { path }) }
}

function shacl(text: string, modelName = 'model.jsonld.yaml') {
  const { ir, source } = build(text)
  return emit(ir, { target: 'shacl', source, modelName })
}

function golden(name: string, actual: string): void {
  const path = join(GOLDEN, name)
  if (UPDATE || !existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, actual)
    return
  }
  expect(actual, `golden ${name} — rerun with UPDATE_GOLDEN=1 if intended`).toBe(
    readFileSync(path, 'utf8'),
  )
}

const CREDENTIAL = readFileSync(`${MODELS}credential.jsonld.yaml`, 'utf8')

const HEAD = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#
mode: "1.1"
prefixes:
  xsd: http://www.w3.org/2001/XMLSchema#
`

describe('the shacl target', () => {
  it('emits one node shape per shape, with its target class and property shapes', () => {
    const { text } = shacl(CREDENTIAL)
    expect(text).toContain('cred:CredentialShape\n  a sh:NodeShape ;\n  sh:targetClass cred:VerifiableCredential')
    expect(text.match(/sh:property \[/g)).toHaveLength(7)
    expect(text).toContain('sh:node cred:DegreeSubjectShape')
    expect(text).toContain('sh:class cred:DocumentVerification')
    expect(text).toContain('sh:nodeKind sh:IRI')
    expect(text).toContain('sh:datatype xsd:dateTime')
  })

  it('closes a closed shape and always allows rdf:type', () => {
    const { text } = shacl(CREDENTIAL)
    expect(text).toContain('sh:closed true ;\n  sh:ignoredProperties ( rdf:type )')
  })

  it('carries notes as sh:description', () => {
    expect(shacl(CREDENTIAL).text).toContain('sh:description "Every credential names')
  })

  it('constrains a @reverse field through sh:inversePath', () => {
    const { text } = shacl(`${HEAD}terms:
  Person: { id: per001, "@id": ex:Person }
  wrote: { id: wro001, "@reverse": ex:author, "@type": "@id" }
shapes:
  Author:
    id: shp001
    targetClass: Person
    fields:
      wrote: { min: 1 }
`)
    expect(text).toContain('sh:path [ sh:inversePath ex:author ]')
  })

  it('names what it does not carry in its header', () => {
    const { text } = shacl(CREDENTIAL)
    for (const capability of capabilitiesFor('shacl').capabilities) {
      if (capability.level === 'none') {
        expect(text).toContain(`# Not carried by this target: ${capability.key}`)
      }
    }
  })

  it('reports a model without shapes, and still emits a valid document', () => {
    const { ir, source } = build(readFileSync(`${BOOKSHELF}bookshelf.jsonld.yaml`, 'utf8'))
    const result = emit(ir, { target: 'shacl', source })
    expect(result.findings.map((f) => [f.ruleId, f.severity])).toEqual([['L1.shacl-no-shapes', 'info']])
    expect(new Parser().parse(result.text)).toEqual([])
  })

  it('downgrades cardinality on a @list field, at the field and in the artifact', () => {
    const { ir, source } = build(`${HEAD}terms:
  Book: { id: boo001, "@id": ex:Book }
  chapters: { id: cha001, "@id": ex:chapter, "@container": "@list" }
shapes:
  Book:
    id: shp001
    targetClass: Book
    fields:
      chapters: { min: 1, range: literal }
`)
    const result = emit(ir, { target: 'shacl', source })
    expect(result.findings.map((f) => f.ruleId)).toEqual(['L1.downgrade-shacl-list-cardinality'])
    expect(result.findings[0]!.pointer).toBe('/shapes/Book/fields/chapters')
    expect(result.text).toContain('# Downgrade: "chapters" is a @list')
    expect(result.text).toContain('sh:path ( ex:chapter [ sh:zeroOrMorePath rdf:rest ] rdf:first )')
    expect(() => new Parser().parse(result.text)).not.toThrow()
  })

  it('downgrades a field on a @graph container, emitting no constraint for it', () => {
    const { ir, source } = build(`${HEAD}terms:
  Claim: { id: cla001, "@id": ex:Claim }
  proof: { id: pro001, "@id": ex:proof, "@container": "@graph" }
shapes:
  Claim:
    id: shp001
    targetClass: Claim
    fields:
      proof: { min: 1 }
`)
    const result = emit(ir, { target: 'shacl', source })
    expect(result.findings.map((f) => f.ruleId)).toEqual(['L1.downgrade-shacl-graph-container'])
    expect(result.text).toContain('# Downgrade: "proof" is a @graph container')
    expect(result.text).not.toContain('ex:proof ;')
    expect(() => new Parser().parse(result.text)).not.toThrow()
  })
})

describe('the context targets and the shapes layer', () => {
  it('name shapes as not carried, and point at the shacl target', () => {
    const { ir, source } = build(CREDENTIAL)
    for (const target of ['context', 'context-inline'] as const) {
      const { text } = emit(ir, { target, source })
      expect(text).toContain('// Not carried by this target: shapes')
      expect(text).toContain('The `shacl` target carries the shapes layer.')
    }
  })

  it('raise no downgrade for any shape', () => {
    const { ir, source } = build(CREDENTIAL)
    expect(emit(ir, { target: 'context', source }).findings).toEqual([])
  })

  it('still differ from each other only in external-reference', () => {
    const context = capabilitiesFor('context').capabilities
    const inline = capabilitiesFor('context-inline').capabilities
    const differing = context.filter(
      (c) => JSON.stringify(c) !== JSON.stringify(inline.find((i) => i.key === c.key)),
    )
    expect(differing.map((c) => c.key)).toEqual(['external-reference'])
    expect(context.find((c) => c.key === 'shapes')?.level).toBe('none')
  })
})

describe('golden files for the shacl target', () => {
  it('credential and bookshelf emit without churn', () => {
    golden('credential.shacl.ttl', shacl(CREDENTIAL, 'credential.jsonld.yaml').text)
    golden(
      'bookshelf.shacl.ttl',
      shacl(readFileSync(`${BOOKSHELF}bookshelf.jsonld.yaml`, 'utf8'), 'bookshelf.jsonld.yaml').text,
    )
  })
})

/**
 * The emitted shapes graph, executed: parsed by an independent Turtle parser,
 * and run by two independent SHACL engines over RDF that an independent JSON-LD
 * implementation produced. The engines must agree with each other and with the
 * outcome each document is declared to have.
 */
describe('the shacl target is executed, not only snapshotted', () => {
  const EXPECTED: Record<string, string[]> = {
    'credential-ok.json': [],
    'credential-missing-issuer.json': ['MinCount'],
    'credential-two-issuers.json': ['MaxCount'],
    'credential-bad-date.json': ['Datatype'],
    'credential-anonymous-issuer.json': ['NodeKind'],
    'credential-wrong-evidence.json': ['Class'],
    'credential-subject-without-degree.json': ['Node'],
    'credential-degree-extra-property.json': ['Closed', 'Node'],
    'credential-untyped.json': [],
  }

  const { ir, source } = build(CREDENTIAL)
  const shapesText = emit(ir, { target: 'shacl', source }).text
  const context = emit(ir, { target: 'context', source }).document['@context']

  async function dataFor(file: string): Promise<Store> {
    const document = JSON.parse(readFileSync(`${MODELS}documents/${file}`, 'utf8'))
    const nquads = (await jsonld.toRDF({ '@context': context, ...document } as never, {
      format: 'application/n-quads',
    } as never)) as unknown as string
    return new Store(new Parser({ format: 'N-Quads' }).parse(nquads))
  }

  const components = (values: Array<string | undefined>) =>
    [...new Set(values.map((v) => (v ?? '').replace(/^.*#(.*)ConstraintComponent$/, '$1')))].sort()

  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file}: both engines agree, and report ${expected.join(', ') || 'conformance'}`, async () => {
      const shapes = new Store(new Parser().parse(shapesText))
      const data = await dataFor(file)

      const authority = await new SHACLValidator(shapes).validate(data)
      const independent = await new Validator(shapes, { factory: DataFactory }).validate({ dataset: data })

      const a = components(authority.results.map((r) => r.sourceConstraintComponent?.value))
      const b = components(
        (independent.results as Array<{ constraintComponent?: { value: string } }>).map(
          (r) => r.constraintComponent?.value,
        ),
      )
      expect(authority.conforms).toBe(expected.length === 0)
      expect(independent.conforms).toBe(authority.conforms)
      expect(a).toEqual(expected)
      expect(b).toEqual(a)
    })
  }
})
