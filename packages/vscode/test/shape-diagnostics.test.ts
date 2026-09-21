/**
 * L3 findings are located in the example document a shape rejected, and reach
 * the editor there, each carrying its rule id as the diagnostic code.
 *
 * @lat: [[validation#Validation#The Ladder#L3 Shape Conformance]]
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { publishDiagnostics } from '../src/extension.js'
import { DiagnosticCollection, textDocument, workspace } from './vscode-stub.js'

const MODELS = fileURLToPath(new URL('../../core/test/fixtures/models/', import.meta.url))

describe('L3 in the editor', () => {
  it('reports a shape violation against the example document, coded by its rule id', () => {
    const model = `${MODELS}credential.jsonld.yaml`
    // Examples are read from open documents; open every one the model names.
    workspace.textDocuments = readdirSync(`${MODELS}documents`)
      .filter((f) => f.startsWith('credential-'))
      .map((f) => textDocument(`${MODELS}documents/${f}`, readFileSync(`${MODELS}documents/${f}`, 'utf8')))

    const collection = new DiagnosticCollection()
    publishDiagnostics(collection as never, textDocument(model, readFileSync(model, 'utf8')) as never)
    workspace.textDocuments = []

    const inExample = collection.published.get(`${MODELS}documents/credential-missing-issuer.json`) ?? []
    const minCount = inExample.find((d) => d.code === 'L3.min-count')
    expect(minCount, `got ${inExample.map((d) => d.code).join(', ') || 'nothing'}`).toBeDefined()
    expect(minCount!.source).toBe('jsonld-modeler')

    const badDate = collection.published.get(`${MODELS}documents/credential-bad-date.json`) ?? []
    const datatype = badDate.find((d) => d.code === 'L3.datatype')!
    // Zero-based: line 5 of the document, where `validFrom` is written.
    expect(datatype.range.start.line).toBe(4)

    // The model itself carries no L3 finding; shapes are checked in documents.
    const inModel = collection.published.get(model) ?? []
    expect(inModel.filter((d) => String(d.code).startsWith('L3.'))).toEqual([])
  })
})
