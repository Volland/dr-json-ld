import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { bareExpanded, expandDocument } from '../../src/processor/api.js'
import { emptyContext } from '../../src/processor/types.js'
import {
  baseFor,
  caseFileExists,
  loadManifest,
  normalize,
  OUT_OF_SCOPE_CLASSES,
  readCaseFile,
  summarize,
  vendoredLoader,
  type CaseOutcome,
  type SuiteCase,
} from './harness.js'

const cases = loadManifest('expand')

function runCase(testCase: SuiteCase): CaseOutcome {
  const base = { id: testCase.id, name: testCase.name }

  if (testCase.option['processingMode'] === 'json-ld-1.0') {
    return { ...base, status: 'skipped', reason: 'targets the JSON-LD 1.0 processing mode' }
  }
  if (testCase.requires !== undefined) {
    return { ...base, status: 'skipped', reason: `requires the ${testCase.requires} feature` }
  }
  if (!caseFileExists(testCase.input)) {
    return { ...base, status: 'skipped', reason: 'the input document is not in the vendored tree' }
  }

  let input: unknown
  try {
    input = readCaseFile(testCase.input)
  } catch (error) {
    return { ...base, status: 'skipped', reason: `input is not JSON: ${message(error)}` }
  }

  const options = {
    resolveContext: vendoredLoader,
    ...(testCase.option['expandContext'] !== undefined
      ? { expandContext: vendoredLoader(baseFor(testCase).replace(/[^/]*$/, '') + String(testCase.option['expandContext'])) }
      : {}),
  }

  if (testCase.positive) {
    if (testCase.expect === undefined || !caseFileExists(testCase.expect)) {
      return { ...base, status: 'skipped', reason: 'the expected document is not vendored' }
    }
    let actual: unknown
    try {
      actual = bareExpanded(expandDocument(input, emptyContext(baseFor(testCase)), options))
    } catch (error) {
      return { ...base, status: 'fail', reason: `threw: ${message(error)}` }
    }
    const expected = readCaseFile(testCase.expect)
    const ok = JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
    return ok
      ? { ...base, status: 'pass' }
      : {
          ...base,
          status: 'fail',
          reason: `output differs from the expected document`,
        }
  }

  // A negative case must raise the error code the manifest names.
  try {
    bareExpanded(expandDocument(input, emptyContext(baseFor(testCase)), options))
  } catch (error) {
    const code = (error as { code?: string }).code
    if (testCase.expectErrorCode === undefined || code === testCase.expectErrorCode) {
      return { ...base, status: 'pass' }
    }
    return {
      ...base,
      status: 'fail',
      reason: `raised "${code}" where the manifest expects "${testCase.expectErrorCode}"`,
    }
  }
  return {
    ...base,
    status: 'fail',
    reason: `expected the error "${testCase.expectErrorCode}" and none was raised`,
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const outcomes = cases.map(runCase)
const report = summarize('expand', outcomes)

describe('W3C JSON-LD 1.1 expand suite', () => {
  // @lat: [[processing#Processing#Conformance]]
  it('reports every failing case with a reason, and the classes out of scope', () => {
    const failures = report.outcomes.filter((o) => o.status === 'fail')
    const skipped = report.outcomes.filter((o) => o.status === 'skipped')

    const lines = [
      '# W3C JSON-LD 1.1 conformance — expand',
      '',
      `Cases: ${report.total}. Passed: ${report.passed}. Failed: ${report.failed}. Skipped: ${report.skipped}.`,
      '',
      '## Out of scope for this change',
      '',
      ...OUT_OF_SCOPE_CLASSES.map(
        (c) => `- \`${c}\` — not implemented by this milestone; reported rather than skipped silently.`,
      ),
      '',
      '## Failing cases',
      '',
      ...(failures.length === 0
        ? ['None.']
        : failures.map((f) => `- \`${f.id}\` ${f.name} — ${f.reason}`)),
      '',
      '## Skipped cases',
      '',
      ...(skipped.length === 0
        ? ['None.']
        : skipped.map((s) => `- \`${s.id}\` ${s.name} — ${s.reason}`)),
      '',
    ]

    const dir = fileURLToPath(new URL('../../../../docs/conformance/', import.meta.url))
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}expand.md`, lines.join('\n'))

    // Every non-passing case carries a reason. That is the contract; the pass
    // rate itself is asserted by the ratchet below.
    for (const outcome of report.outcomes) {
      if (outcome.status !== 'pass') expect(outcome.reason, outcome.id).toBeTruthy()
    }
    expect(OUT_OF_SCOPE_CLASSES.length).toBeGreaterThan(0)
  })

  /**
   * A ratchet, not a target. It exists so an unexplained regression fails the
   * build; raising it is a deliberate act that accompanies a fix.
   */
  it('passes at least the recorded number of cases', () => {
    const attempted = report.passed + report.failed
    console.log(
      `expand suite: ${report.passed}/${attempted} attempted (${report.skipped} skipped)`,
    )
    expect(report.passed).toBeGreaterThanOrEqual(EXPAND_RATCHET)
  })
})

/** Raised only alongside a fix. See `docs/conformance/expand.md` for the list. */
export const EXPAND_RATCHET = 341
