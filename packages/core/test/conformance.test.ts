import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateModelText, type ValidationReport } from '../src/validate/validate.js'

const CREDENTIAL = fileURLToPath(new URL('./fixtures/models/credential.jsonld.yaml', import.meta.url))

function check(level?: 'L1' | 'L2' | 'L3'): ValidationReport {
  return validateModelText(readFileSync(CREDENTIAL, 'utf8'), CREDENTIAL, {
    ...(level !== undefined ? { level } : {}),
    readExample: (p) => readFileSync(join(dirname(CREDENTIAL), p), 'utf8'),
  })
}

const findingsIn = (report: ValidationReport, file: string) =>
  report.findings
    .filter((f) => f.file.endsWith(file) && f.level === 'L3')
    .map((f) => [f.ruleId, f.pointer, `${f.loc.line}:${f.loc.column}`])

describe('L3 shape conformance', () => {
  it('runs by default for a model with shapes, and every declared example is met', () => {
    const report = check()
    expect(report.level).toBe('L3')
    expect(report.examples.filter((e) => !e.met)).toEqual([])
    expect(report.failed).toBe(false)
  })

  it('reports nothing at L3 for a document that conforms', () => {
    expect(findingsIn(check(), 'credential-ok.json')).toEqual([])
  })

  it('locates a missing required field at the node that lacks it', () => {
    expect(findingsIn(check(), 'credential-missing-issuer.json')).toEqual([['L3.min-count', '', '1:1']])
  })

  it('locates a value of the wrong kind at the value', () => {
    expect(findingsIn(check(), 'credential-bad-date.json')).toEqual([['L3.datatype', '/validFrom', '5:3']])
    expect(findingsIn(check(), 'credential-anonymous-issuer.json')).toEqual([
      ['L3.node-kind', '/issuer', '4:3'],
    ])
    expect(findingsIn(check(), 'credential-wrong-evidence.json')).toEqual([['L3.class', '/evidence', '15:3']])
  })

  it('locates a violation inside a nested shape where it occurs, and names the field that reached it', () => {
    const findings = findingsIn(check(), 'credential-subject-without-degree.json')
    expect(findings).toContainEqual(['L3.min-count', '/credentialSubject', '6:3'])
    expect(findings).toContainEqual(['L3.node', '/credentialSubject', '6:3'])
  })

  it('locates a key a closed shape does not allow at the key', () => {
    const findings = findingsIn(check(), 'credential-degree-extra-property.json')
    expect(findings).toContainEqual(['L3.closed', '/credentialSubject/degree/degree', '13:7'])
  })

  it('says so when no node is of a targeted class, so "no violations" is not read as "conforms"', () => {
    const report = check()
    const noTarget = report.findings.filter((f) => f.ruleId === 'L3.no-target')
    expect(noTarget.map((f) => [f.file.replace(/.*\//, ''), f.severity])).toEqual([
      ['credential-untyped.json', 'info'],
    ])
  })

  it('reports every L3 finding at error severity, except the one that says nothing was checked', () => {
    for (const f of check().findings.filter((f) => f.level === 'L3' && f.ruleId !== 'L3.no-target')) {
      expect(f.severity).toBe('error')
    }
  })

  it('reports no L3 finding when a lower level is run', () => {
    for (const level of ['L1', 'L2'] as const) {
      const report = check(level)
      expect(report.level).toBe(level)
      expect(report.findings.filter((f) => f.level === 'L3')).toEqual([])
      expect(report.findings.filter((f) => f.ruleId === 'L0.example-outcome-unmet')).toEqual([])
    }
  })
})
