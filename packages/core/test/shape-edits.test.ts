import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  addFieldSplice,
  addShapeSplice,
  removeFieldSplice,
  renameReferenceSplices,
  setFieldSplice,
  setShapeSplice,
  ShapeEditError,
} from '../src/edit/shape-edits.js'
import { applySplices } from '../src/edit/splice.js'
import { findShape } from '../src/model/ir.js'
import { resolveModelText } from '../src/model/resolve.js'

const BOOKSHELF = readFileSync(
  fileURLToPath(new URL('../../../examples/bookshelf/bookshelf.jsonld.yaml', import.meta.url)),
  'utf8',
)
const CREDENTIAL = readFileSync(
  fileURLToPath(new URL('./fixtures/models/credential.jsonld.yaml', import.meta.url)),
  'utf8',
)

function resolved(text: string) {
  const { ir, findings } = resolveModelText(text, 'm.jsonld.yaml')
  expect(findings.filter((f) => f.severity === 'error'), text).toEqual([])
  return ir!
}

const comments = (text: string) => text.split('\n').filter((l) => l.trim().startsWith('#'))

describe('shape edits are targeted splices', () => {
  it('adds the first shape as a new section before the examples, keeping every comment', () => {
    const next = applySplices(BOOKSHELF, [addShapeSplice(BOOKSHELF, { name: 'Book', targetClass: 'Book' }, 'shb001')])
    const shape = findShape(resolved(next), 'Book')!
    expect(shape.id).toBe('shb001')
    expect(shape.targetTermId).toBe('bk0001')
    expect(next.indexOf('shapes:')).toBeLessThan(next.indexOf('examples:'))
    expect(comments(next)).toEqual(comments(BOOKSHELF))
    // Nothing else moved: the addition is one contiguous insertion.
    expect(next.replace(/shapes:\n {2}Book:\n {4}id: shb001\n {4}targetClass: Book\n\n/, '')).toBe(BOOKSHELF)
  })

  it('adds a shape after the last one when the section exists', () => {
    const next = applySplices(CREDENTIAL, [addShapeSplice(CREDENTIAL, { name: 'Evidence', closed: true }, 'she001')])
    const ir = resolved(next)
    expect(ir.shapes.map((s) => s.name)).toEqual(['Credential', 'DegreeSubject', 'Degree', 'Evidence'])
    expect(findShape(ir, 'Evidence')!.closed).toBe(true)
  })

  it('refuses a shape name that is taken', () => {
    expect(() => addShapeSplice(CREDENTIAL, { name: 'Degree' })).toThrow(ShapeEditError)
  })

  it('adds a field, creating `fields:` when the shape has none', () => {
    let text = applySplices(BOOKSHELF, [addShapeSplice(BOOKSHELF, { name: 'Book', targetClass: 'Book' }, 'shb001')])
    text = applySplices(text, [addFieldSplice(text, 'Book', 'title', { min: 1, range: 'langString' })])
    text = applySplices(text, [addFieldSplice(text, 'Book', 'author', { range: { class: 'Person' } })])
    const fields = findShape(resolved(text), 'Book')!.fields
    expect(fields.map((f) => [f.key, f.min, f.range?.kind])).toEqual([
      ['title', 1, 'langString'],
      ['author', undefined, 'class'],
    ])
    expect(text).toContain('    fields:\n      title: { min: 1, range: langString }\n      author: { range: { class: Person } }')
  })

  it('replaces a field in place', () => {
    const next = applySplices(
      CREDENTIAL,
      [setFieldSplice(CREDENTIAL, 'Credential', 'issuer', { min: 1, range: 'node', note: 'Who vouches.' })],
    )
    const issuer = findShape(resolved(next), 'Credential')!.fields.find((f) => f.key === 'issuer')!
    expect([issuer.min, issuer.max, issuer.range?.kind, issuer.note]).toEqual([1, undefined, 'node', 'Who vouches.'])
    expect(comments(next)).toEqual(comments(CREDENTIAL))
  })

  it('removes a field, and `fields:` with the last one', () => {
    let text = applySplices(CREDENTIAL, [removeFieldSplice(CREDENTIAL, 'Credential', 'evidence')])
    expect(findShape(resolved(text), 'Credential')!.fields.map((f) => f.key)).not.toContain('evidence')
    text = applySplices(text, [removeFieldSplice(text, 'Degree', 'name')])
    expect(findShape(resolved(text), 'Degree')!.fields).toEqual([])
    expect(text).not.toMatch(/closed: true\n {4}fields:\n\n/)
  })

  it('sets, changes and clears a shape property', () => {
    let text = applySplices(CREDENTIAL, [setShapeSplice(CREDENTIAL, 'Credential', 'closed', true)])
    expect(findShape(resolved(text), 'Credential')!.closed).toBe(true)
    text = applySplices(text, [setShapeSplice(text, 'Degree', 'closed', undefined)])
    expect(findShape(resolved(text), 'Degree')!.closed).toBe(false)
    text = applySplices(text, [setShapeSplice(text, 'DegreeSubject', 'targetClass', 'cred:Subject')])
    expect(findShape(resolved(text), 'DegreeSubject')!.targetIri).toBe('https://example.org/credentials#Subject')
  })

  it('renames the fields and view entries that name a renamed term', () => {
    const splices = renameReferenceSplices(CREDENTIAL, 'name', 'fullName', [{ shape: 'DegreeSubject' }, { shape: 'Degree' }], true)
    const next = applySplices(CREDENTIAL, splices)
    expect(next).toContain('      fullName: { max: 1, range: xsd:string }')
    expect(next).toContain('      fullName: { min: 1, max: 1 }')
    expect(next).toContain('degree, fullName]')
  })
})
