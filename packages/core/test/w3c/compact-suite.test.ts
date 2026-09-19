import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { processContext } from '../../src/processor/active-context.js'
import { compact } from '../../src/processor/compact.js'
import { emptyContext } from '../../src/processor/types.js'
import { bareExpanded, expandDocument } from '../../src/processor/api.js'
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
  if (testCase.context === undefined || !caseFileExists(testCase.context)) {
    return { ...base, status: 'skipped', reason: 'the context document is not vendored' }
  }

  let input: unknown
  let contextDocument: Record<string, unknown>
  try {
    input = readCaseFile(testCase.input)
    contextDocument = readCaseFile(testCase.context) as Record<string, unknown>
  } catch (error) {
    return { ...base, status: 'skipped', reason: `input is not JSON: ${message(error)}` }
  }

  const documentBase = baseFor(testCase)
  const local = '@context' in contextDocument ? contextDocument['@context'] : contextDocument

  const run = (): unknown => {
    // Compaction runs over the expanded form, which is what the suite's inputs
    // are, so this exercises the two algorithms together.
    const expanded = bareExpanded(
      expandDocument(input, emptyContext(documentBase), { resolveContext: vendoredLoader }),
    )
    const active = processContext(emptyContext(documentBase), local, {
      resolveContext: vendoredLoader,
    })
    const compacted = compact(expanded, active, {
      compactArrays: testCase.option['compactArrays'] !== false,
    })
    // The suite's expected documents carry the `@context` back, so it is added
    // — but only when there is one, since an empty context is not written out.
    const hasContext =
      local !== null &&
      local !== undefined &&
      (Array.isArray(local) ? local.length > 0 : Object.keys(local as object).length > 0)
    return hasContext && typeof compacted === 'object' && compacted !== null
      ? { '@context': local, ...(compacted as Record<string, unknown>) }
      : compacted
  }

  if (testCase.positive) {
    if (testCase.expect === undefined || !caseFileExists(testCase.expect)) {
      return { ...base, status: 'skipped', reason: 'the expected document is not vendored' }
    }
    let actual: unknown
    try {
      actual = run()
    } catch (error) {
      return { ...base, status: 'fail', reason: `threw: ${message(error)}` }
    }
    const expected = readCaseFile(testCase.expect)
    const ok = JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
    return ok
      ? { ...base, status: 'pass' }
      : { ...base, status: 'fail', reason: 'output differs from the expected document' }
  }

  try {
    run()
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

const report = summarize('compact', loadManifest('compact').map(runCase))

describe('W3C JSON-LD 1.1 compact suite', () => {
  // @lat: [[processing#Processing#Conformance]]
  it('reports every failing case with a reason, and the classes out of scope', () => {
    const failures = report.outcomes.filter((o) => o.status === 'fail')
    const skipped = report.outcomes.filter((o) => o.status === 'skipped')
    const lines = [
      '# W3C JSON-LD 1.1 conformance — compact',
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
    writeFileSync(`${dir}compact.md`, lines.join('\n'))

    for (const outcome of report.outcomes) {
      if (outcome.status !== 'pass') expect(outcome.reason, outcome.id).toBeTruthy()
    }
  })

  it('passes at least the recorded number of cases', () => {
    const attempted = report.passed + report.failed
    console.log(
      `compact suite: ${report.passed}/${attempted} attempted (${report.skipped} skipped)`,
    )
    expect(report.passed).toBeGreaterThanOrEqual(COMPACT_RATCHET)
  })
})

/** Raised only alongside a fix. See `docs/conformance/compact.md`. */
export const COMPACT_RATCHET = 166
