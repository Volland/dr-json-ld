/**
 * Shapes and scoped terms on both panes, derived from one projection.
 *
 * @lat: [[architecture#Architecture#Panes]]
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { resolveModelText, validateModelText } from '@json-ld-modeler/core'

import { project } from '../src/projection.js'
import { derivePanes, deriveSkeleton, selectedTerm, selectionFor, type TreeNode } from '../webview/src/panes.js'

const CREDENTIAL_PATH = fileURLToPath(new URL('../../core/test/fixtures/models/credential.jsonld.yaml', import.meta.url))
const CREDENTIAL = readFileSync(CREDENTIAL_PATH, 'utf8')

function projectionOf(text: string) {
  const { ir } = resolveModelText(text, 'm.jsonld.yaml')
  const report = validateModelText(text, 'm.jsonld.yaml', { level: 'L2' })
  return project(ir!, { findings: report.findings })
}

function flatten(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('the projection carries the shapes layer', () => {
  it('carries every shape, with its fields, their coercion and where they are carried', () => {
    const projection = projectionOf(CREDENTIAL)
    expect(projection.shapes.map((s) => s.name)).toEqual(['Credential', 'DegreeSubject', 'Degree'])
    const issuer = projection.shapes[0]!.fields.find((f) => f.key === 'issuer')!
    expect(issuer).toMatchObject({ min: 1, max: 1, range: { kind: 'iri' }, coercion: '@type: @id', carriedBy: 'shacl' })
  })

  it('carries every scoped term, with its element id and facets', () => {
    const projection = projectionOf(CREDENTIAL)
    const vc = projection.terms.find((t) => t.key === 'VerifiableCredential')!
    expect(vc.scopedTermIds).toHaveLength(4)
    const issuer = projection.scopedTerms.find((t) => t.id === 'iss001')!
    expect(issuer).toMatchObject({ parentId: vc.id, path: 'VerifiableCredential › issuer' })
    expect(issuer.facets['@type']).toBe('@id')
    // The parent still shows its context as emitted, for the region.
    expect((vc.facets['@context'] as Record<string, unknown>)['issuer']).toBeDefined()
  })
})

describe('scoped terms on both panes', () => {
  it('draws a scoped term inside the region of the term that holds it', () => {
    const projection = projectionOf(CREDENTIAL)
    const panes = derivePanes(projection, projection.views[0]!.id)
    const vc = panes.tree.find((n) => n.key === 'VerifiableCredential')!
    expect(vc.region?.kind).toBe('scoped-context')
    expect(vc.children.map((c) => c.key)).toEqual(['issuer', 'validFrom', 'credentialSubject', 'evidence'])
  })

  it('selects a scoped term as itself, distinct from a top-level term of the same key', () => {
    const text = CREDENTIAL.replace(
      '      evidence: { id: evi001, "@id": cred:evidence, "@type": "@id" }\n',
      '      evidence: { id: evi001, "@id": cred:evidence, "@type": "@id" }\n      name: { id: nmv001, "@id": cred:credentialName }\n',
    )
    const projection = projectionOf(text)
    const panes = derivePanes(projection, projection.views[0]!.id)
    const names = panes.graph.nodes.filter((n) => n.label === 'name')
    expect(names.map((n) => n.iri).sort()).toEqual([
      'https://example.org/credentials#credentialName',
      'https://schema.org/name',
    ])
    expect(selectedTerm(projection, { termId: 'nmv001' })!.path).toBe('VerifiableCredential › name')
  })
})

describe('shapes on both panes', () => {
  it('draws a shape as its class carrying its fields, and an edge per shape range with its cardinality', () => {
    const projection = projectionOf(CREDENTIAL)
    const { graph } = derivePanes(projection, projection.views[0]!.id)
    const credential = graph.nodes.find((n) => n.id === 'shape:shc001')!
    expect(credential.kind).toBe('shape')
    expect(credential.label).toBe('Credential — VerifiableCredential')
    expect(credential.fields).toContain('issuer 1..1 iri')
    const edge = graph.edges.find((e) => e.source === 'shape:shc001' && e.target === 'shape:shs001')!
    expect(edge.label).toBe('credentialSubject 1..*')
  })

  it('a view of one shape shows it, its fields’ terms and the shapes its fields reach', () => {
    const text = CREDENTIAL.replace(
      '    shapes: [Credential, DegreeSubject, Degree]',
      '    shapes: [Credential]',
    )
    const projection = projectionOf(text)
    const { graph } = derivePanes(projection, projection.views[0]!.id)
    expect(graph.nodes.filter((n) => n.kind === 'shape').map((n) => n.id).sort()).toEqual([
      'shape:shc001',
      'shape:shd001',
      'shape:shs001',
    ])
  })

  it('selects a shape from its graph node', () => {
    expect(selectionFor('shape:shc001')).toEqual({ termId: undefined, shapeId: 'shc001' })
    expect(selectionFor('iss001')).toEqual({ termId: 'iss001' })
  })

  it('draws the JSON skeleton of a conforming document, nested shapes as nested objects', () => {
    const projection = projectionOf(CREDENTIAL)
    const rows = deriveSkeleton(projection, 'shc001')
    // The credential's own keys are read in its type-scoped context.
    const region = rows.find((r) => r.region !== undefined)!
    expect(region.children.map((r) => r.key).sort()).toEqual(['credentialSubject', 'evidence', 'issuer', 'validFrom'])
    const subject = flatten(rows).find((r) => r.key === 'credentialSubject')!
    expect(subject.cardinality).toBe('1..*')
    expect(subject.children.map((c) => c.key).sort()).toEqual(['degree', 'name'])
    const degree = subject.children.find((c) => c.key === 'degree')!
    expect(degree.children.map((c) => c.key)).toEqual(['name'])
  })

  it('draws a recursive shape once, as a reference', () => {
    const text = CREDENTIAL.replace(
      '      degree: { min: 1, max: 1, range: { shape: Degree } }\n',
      '      degree: { min: 1, max: 1, range: { shape: Degree } }\n      name: { max: 1, range: xsd:string }\n',
    ).replace(
      '    fields:\n      name: { min: 1, max: 1 }\n',
      '    fields:\n      name: { min: 1, max: 1 }\n      degree: { range: { shape: Degree } }\n',
    )
    const projection = projectionOf(text)
    const rows = flatten(deriveSkeleton(projection, 'shd001'))
    const again = rows.find((r) => r.recursion !== undefined)!
    expect(again.recursion).toBe('Degree')
    expect(again.children).toEqual([])
  })
})

describe('a conflicting coercion is offered a promotion', () => {
  it('carries the conflict and the facets a class-scoped term would need', () => {
    const text = CREDENTIAL.replace(
      '      name: { max: 1, range: xsd:string }\n',
      '      name: { max: 1, range: iri }\n',
    )
    const projection = projectionOf(text)
    const name = projection.shapes.find((s) => s.name === 'DegreeSubject')!.fields.find((f) => f.key === 'name')!
    expect(name.conflict?.ruleId).toBe('L1.shape-range-needs-id-coercion')
    expect(name.promotion).toEqual({ '@type': '@id' })
    const issuer = projection.shapes[0]!.fields.find((f) => f.key === 'issuer')!
    expect(issuer.conflict).toBeUndefined()
  })
})

describe('the new canvas components ask in the document', () => {
  it('the shape inspector and its questions are in the source the scan covers', () => {
    const canvas = readFileSync(fileURLToPath(new URL('../webview/src/canvas.tsx', import.meta.url)), 'utf8')
    for (const component of ['function ShapeInspector', 'function FieldRow', "kind: 'field-iri'"]) {
      expect(canvas).toContain(component)
    }
    expect(/\b(?:window\s*\.\s*)?(?:prompt|confirm|alert)\s*\(/.test(canvas)).toBe(false)
  })
})
