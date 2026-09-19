import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RULE_IDS, RULES, isRegisteredRule } from '../src/findings/rules.js'
import { LevelNotAvailable, validateModelText } from '../src/validate/validate.js'

const DOCUMENTS = fileURLToPath(new URL('./fixtures/documents/', import.meta.url))

function readExample(path: string): string | undefined {
  try {
    return readFileSync(join(DOCUMENTS, path.replace(/^.*\//, '')), 'utf8')
  } catch {
    return undefined
  }
}

const MODEL = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#
prefixes:
  schema: https://schema.org/
terms:
  name:
    id: aaa111
    "@id": schema:name
  author:
    id: bbb222
    "@id": schema:author
    "@type": "@id"
  tags:
    id: ccc333
    "@id": ex:tag
    "@container": "@set"
examples:
`

function withExamples(entries: string): string {
  return MODEL + entries
}

function validate(model: string, options: Parameters<typeof validateModelText>[2] = {}) {
  return validateModelText(model, 'model.jsonld.yaml', { readExample, ...options })
}

describe('the ladder', () => {
  // @lat: [[validation#Validation#The Ladder]]
  it('names the level it ran, and runs no higher', () => {
    const model = withExamples(
      '  - { id: e11111, path: documents/silently-empties.json, expect: { ok: true } }\n',
    )
    const atL1 = validate(model, { level: 'L1' })
    expect(atL1.level).toBe('L1')
    expect(atL1.findings.some((f) => f.level === 'L2')).toBe(false)

    const atL2 = validate(model, { level: 'L2' })
    expect(atL2.level).toBe('L2')
    expect(atL2.findings.some((f) => f.level === 'L2')).toBe(true)
  })

  it('reports that L3 is not available rather than reporting conformance', () => {
    expect(() => validate(MODEL + '[]\n', { level: 'L3' })).toThrow(LevelNotAvailable)
    try {
      validate(MODEL + '[]\n', { level: 'L3' })
    } catch (error) {
      expect((error as Error).message).toContain('not available')
      expect((error as Error).message).toContain('shapes layer')
    }
  })
})

describe('findings', () => {
  // @lat: [[validation#Validation#Findings]]
  it('every finding carries a registered rule id, a pointer and a position', () => {
    const model = withExamples(
      [
        '  - { id: e11111, path: documents/silently-empties.json, expect: { ok: true } }',
        '  - { id: e22222, path: documents/uncoerced-relation.json, expect: { ok: true } }',
        '  - { id: e33333, path: documents/blank-node.json, expect: { ok: true } }',
        '',
      ].join('\n'),
    )
    const report = validate(model)
    expect(report.findings.length).toBeGreaterThan(0)
    for (const finding of report.findings) {
      expect(isRegisteredRule(finding.ruleId), finding.ruleId).toBe(true)
      expect(RULES[finding.ruleId as keyof typeof RULES].level).toBe(finding.level)
      expect(finding.file).toBeTruthy()
      expect(finding.loc.line).toBeGreaterThan(0)
      expect(finding.loc.column).toBeGreaterThan(0)
      expect(typeof finding.pointer).toBe('string')
    }
  })

  it('no rule id is reused for a different meaning', () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length)
    for (const [key, rule] of Object.entries(RULES)) {
      expect(rule.id).toBe(key)
      expect(rule.id.startsWith(rule.level)).toBe(true)
      expect(rule.summary.length).toBeGreaterThan(10)
    }
  })

  it('are produced in the same order however the document keys are ordered', () => {
    const model = withExamples(
      '  - { id: e11111, path: documents/silently-empties.json, expect: { ok: true } }\n',
    )
    const first = validate(model).findings
    const reorderedDocument = JSON.stringify(
      Object.fromEntries(
        Object.entries(JSON.parse(readExample('silently-empties.json')!)).reverse(),
      ),
      null,
      2,
    )
    const second = validateModelText(model, 'model.jsonld.yaml', {
      readExample: (p) => (p.includes('silently') ? reorderedDocument : readExample(p)),
    }).findings
    expect(second.map((f) => f.ruleId)).toEqual(first.map((f) => f.ruleId))
  })
})

describe('L1 context errors', () => {
  // @lat: [[validation#Validation#The Ladder#L1 Context Errors]]
  it('locates an invalid container value at the term in the model', () => {
    const report = validate(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'terms:',
        '  tags:',
        '    "@id": ex:tag',
        '    "@container": "@bag"',
      ].join('\n'),
    )
    const finding = report.findings.find((f) => f.ruleId === 'L1.invalid-container-mapping')!
    expect(finding).toBeDefined()
    expect(finding.file).toBe('model.jsonld.yaml')
    expect(finding.pointer).toBe('/terms/tags/@container')
  })

  it('reports a referenced context that has not been vendored, and does not fetch', () => {
    const report = validate(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'uses:',
        '  - iri: https://schema.org/',
        'terms: {}',
      ].join('\n'),
    )
    const finding = report.findings.find((f) => f.ruleId === 'L1.context-not-vendored')!
    expect(finding).toBeDefined()
    expect(finding.subject).toBe('https://schema.org/')
    expect(finding.message).toContain('ldm vendor')
  })

  it('reports a protected-term violation and names the context that protects it', () => {
    const vendored = {
      '@context': {
        name: { '@id': 'https://schema.org/name', '@protected': true },
      },
    }
    const report = validate(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'uses:',
        '  - iri: https://example.org/upstream.jsonld',
        '    integrity: sha256-AAAA',
        'terms:',
        '  name:',
        '    "@id": ex:differentName',
      ].join('\n'),
      { resolveContext: (iri) => (iri.includes('upstream') ? vendored : undefined) },
    )
    const finding = report.findings.find((f) => f.ruleId === 'L1.protected-term-redefinition')!
    expect(finding).toBeDefined()
    expect(finding.message).toContain('https://example.org/upstream.jsonld')
    expect(finding.pointer).toBe('/terms/name')
  })

  it('reports a term that shadows an upstream one', () => {
    const vendored = { '@context': { name: 'https://schema.org/name' } }
    const report = validate(
      [
        'jsonld: "1"',
        'namespace: { prefix: ex, base: "https://example.org/ns#" }',
        'uses:',
        '  - iri: https://example.org/upstream.jsonld',
        '    integrity: sha256-AAAA',
        'terms:',
        '  name:',
        '    "@id": ex:ourName',
      ].join('\n'),
      { resolveContext: (iri) => (iri.includes('upstream') ? vendored : undefined) },
    )
    const finding = report.findings.find(
      (f) => f.ruleId === 'L1.term-shadows-referenced-context',
    )!
    expect(finding).toBeDefined()
    expect(finding.severity).toBe('warning')
  })
})

/**
 * One fixture document per L2 rule, each asserting the exact rule ids raised and
 * their pointers. A negative example that merely fails passes even when it fails
 * for the wrong reason.
 *
 * @lat: [[validation#Validation#Expected Outcomes]]
 */
describe('L2 lossiness, by negative example', () => {
  const cases: Array<{
    name: string
    document: string
    model: string
    rule: string
    pointer: string
  }> = [
    {
      name: 'a document that silently empties',
      document: 'documents/silently-empties.json',
      model: MODEL,
      rule: 'L2.key-dropped',
      pointer: '/title',
    },
    {
      name: 'a relation left uncoerced',
      document: 'documents/uncoerced-relation.json',
      model: MODEL,
      rule: 'L2.coercion-did-not-fire',
      pointer: '/name',
    },
    {
      name: 'a blank node minted where an identifier was expected',
      document: 'documents/blank-node.json',
      model: MODEL,
      rule: 'L2.blank-node-minted',
      pointer: '',
    },
    {
      name: 'an IRI left relative',
      document: 'documents/relative-iri.json',
      model: MODEL,
      rule: 'L2.relative-iri',
      pointer: '/@id',
    },
  ]

  it.each(cases)('$name raises $rule at its own position', ({ document, model, rule, pointer }) => {
    const withExample = `${model}  - { id: e99999, path: ${document}, expect: { rules: [${rule}] } }\n`
    const report = validate(withExample)
    const raised = report.findings.filter((f) => f.ruleId === rule)
    expect(raised.length).toBeGreaterThan(0)
    expect(raised.map((f) => f.pointer)).toContain(pointer)
    // The pointer resolves into the document the user wrote, not the model.
    expect(raised[0]!.file).toBe(document)
    // And the declared outcome is met, so the check passes.
    expect(report.examples[0]!.met).toBe(true)
    expect(report.findings.some((f) => f.ruleId === 'L0.example-outcome-unmet')).toBe(false)
  })

  it('distinguishes a drop under @vocab from a drop outright', () => {
    const withVocab = [
      'jsonld: "1"',
      'namespace: { prefix: ex, base: "https://example.org/ns#" }',
      'vocab: https://example.org/ns#',
      'terms:',
      '  name:',
      '    "@id": ex:name',
      'examples:',
      '  - { id: e44444, path: documents/dropped-under-vocab.json, expect: { rules: [L2.key-dropped-under-vocab] } }',
      '',
    ].join('\n')
    const report = validate(withVocab)
    const finding = report.findings.find((f) => f.ruleId === 'L2.key-dropped-under-vocab')!
    expect(finding).toBeDefined()
    expect(finding.message).toContain('invented IRI')
    expect(report.findings.some((f) => f.ruleId === 'L2.key-dropped')).toBe(false)
    expect(report.examples[0]!.met).toBe(true)
  })
})

describe('coverage', () => {
  // @lat: [[validation#Validation#The Ladder#L2 Lossiness]]
  it('reports an unused term below lossiness severity, and does not fail the check', () => {
    const model = withExamples(
      '  - { id: e11111, path: documents/ok.json, expect: { ok: true } }\n',
    )
    const report = validate(model)
    const unused = report.findings.filter((f) => f.ruleId === 'L2.term-unused')
    // `ok.json` uses name, author and tags, so nothing is unused.
    expect(unused).toEqual([])

    const extended = model.replace(
      'examples:',
      '  unusedTerm:\n    id: ddd444\n    "@id": ex:unused\nexamples:',
    )
    const withUnused = validate(extended)
    const finding = withUnused.findings.find((f) => f.ruleId === 'L2.term-unused')!
    expect(finding).toBeDefined()
    expect(finding.severity).toBe('info')
    expect(withUnused.failed).toBe(false)
  })

  it('reports a term that no view includes', () => {
    const model = `${withExamples('  - { id: e11111, path: documents/ok.json, expect: { ok: true } }\n')}views:
  - { id: v11111, name: Overview, terms: [name] }
`
    const report = validate(model)
    const hidden = report.findings.filter((f) => f.ruleId === 'L2.term-in-no-view')
    expect(hidden.map((f) => f.subject).sort()).toEqual(['author', 'tags'])
  })
})

describe('expected outcomes', () => {
  // @lat: [[validation#Validation#Expected Outcomes]]
  it('fails a positive example that regresses, naming the example and the finding', () => {
    const model = withExamples(
      '  - { id: e11111, path: documents/silently-empties.json, expect: { ok: true, maxSeverity: info } }\n',
    )
    const report = validate(model)
    const unmet = report.findings.find((f) => f.ruleId === 'L0.example-outcome-unmet')!
    expect(unmet).toBeDefined()
    expect(unmet.subject).toBe('documents/silently-empties.json')
    expect(unmet.message).toContain('L2.key-dropped')
    expect(report.failed).toBe(true)
  })

  it('fails a negative example that raises the wrong rule, reporting expected and actual', () => {
    const model = withExamples(
      '  - { id: e11111, path: documents/silently-empties.json, expect: { rules: [L2.relative-iri] } }\n',
    )
    const report = validate(model)
    const unmet = report.findings.find((f) => f.ruleId === 'L0.example-outcome-unmet')!
    expect(unmet.message).toContain('L2.relative-iri')
    expect(unmet.message).toContain('L2.key-dropped')
    expect(report.examples[0]!.missing).toEqual(['L2.relative-iri'])
    expect(report.examples[0]!.unexpected).toContain('L2.key-dropped')
  })

  it('reports a declared example whose file does not exist', () => {
    const model = withExamples(
      '  - { id: e11111, path: documents/nope.json, expect: { ok: true } }\n',
    )
    const report = validate(model)
    expect(report.findings.some((f) => f.ruleId === 'L0.example-missing')).toBe(true)
    expect(report.failed).toBe(true)
  })
})
