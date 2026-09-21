/**
 * The W3C `toRdf` class, run over this processor's own expansion and RDF
 * conversion. A produced dataset and the expected N-Quads are compared after
 * URDNA2015 canonicalization — delegated, as canonicalization is — so blank
 * node labels never decide a result.
 *
 * @lat: [[processing#Processing#RDF Conversion#From JSON-LD to RDF]]
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  loadManifest,
  summarize,
  SUITE_DIR,
  type CaseOutcome,
  type SuiteCase,
} from './harness.js'
import { canonical, convert, skipReason } from './rdf-helpers.js'

const cases = loadManifest('toRdf')

function runCase(testCase: SuiteCase): CaseOutcome {
  const base = { id: testCase.id, name: testCase.name }
  const skip = skipReason(testCase)
  if (skip !== undefined) return { ...base, status: 'skipped', reason: skip }

  let actual: string
  try {
    actual = convert(testCase)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (!testCase.positive && (testCase.expectErrorCode === undefined || code === testCase.expectErrorCode)) {
      return { ...base, status: 'pass' }
    }
    return {
      ...base,
      status: 'fail',
      reason: testCase.positive
        ? `threw: ${error instanceof Error ? error.message : String(error)}`
        : `raised "${code}" where the manifest expects "${testCase.expectErrorCode}"`,
    }
  }
  if (!testCase.positive) {
    return {
      ...base,
      status: 'fail',
      reason: `expected the error "${testCase.expectErrorCode}" and none was raised`,
    }
  }
  // A syntax test only has to be accepted.
  if (testCase.expect === undefined) return { ...base, status: 'pass' }

  const expected = readFileSync(join(SUITE_DIR, testCase.expect), 'utf8')
  let same: boolean
  try {
    same = canonical(actual) === canonical(expected)
  } catch (error) {
    return { ...base, status: 'fail', reason: `the output is not valid N-Quads: ${String(error)}` }
  }
  return same
    ? { ...base, status: 'pass' }
    : { ...base, status: 'fail', reason: 'the dataset differs from the expected one after canonicalization' }
}

const outcomes = cases.map(runCase)
const report = summarize('toRdf', outcomes)

describe('W3C JSON-LD 1.1 toRdf suite', () => {
  it('reports every failing case with a reason', () => {
    const failures = report.outcomes.filter((o) => o.status === 'fail')
    const skipped = report.outcomes.filter((o) => o.status === 'skipped')
    const lines = [
      '# W3C JSON-LD 1.1 conformance — toRdf',
      '',
      `Cases: ${report.total}. Passed: ${report.passed}. Failed: ${report.failed}. Skipped: ${report.skipped}.`,
      '',
      'Datasets are compared after URDNA2015 canonicalization, so blank node labels never decide a result.',
      '',
      '## Failing cases',
      '',
      ...(failures.length === 0 ? ['None.'] : failures.map((f) => `- \`${f.id}\` ${f.name} — ${f.reason}`)),
      '',
      '## Skipped cases',
      '',
      ...(skipped.length === 0 ? ['None.'] : skipped.map((s) => `- \`${s.id}\` ${s.name} — ${s.reason}`)),
      '',
    ]
    const dir = fileURLToPath(new URL('../../../../docs/conformance/', import.meta.url))
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}toRdf.md`, lines.join('\n'))
    for (const outcome of report.outcomes) {
      if (outcome.status !== 'pass') expect(outcome.reason, outcome.id).toBeTruthy()
    }
  })

  /** A ratchet, raised only alongside a fix. See `docs/conformance/toRdf.md`. */
  it('passes at least the recorded number of cases', () => {
    const attempted = report.passed + report.failed
    console.log(`toRdf suite: ${report.passed}/${attempted} attempted (${report.skipped} skipped)`)
    expect(report.passed).toBeGreaterThanOrEqual(TO_RDF_RATCHET)
  })
})

export const TO_RDF_RATCHET = 415
