/**
 * The W3C JSON-LD 1.1 test suite harness.
 *
 * Conformance is observed, not claimed. The suite is vendored as a fixture so
 * it runs with the network off, and every case this processor does not pass is
 * listed with a reason rather than hidden.
 *
 * @lat: [[processing#Processing#Conformance]]
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUITE_DIR = fileURLToPath(new URL('../fixtures/w3c/', import.meta.url))

/** The suite's own base, which every case's IRIs are relative to. */
export const SUITE_BASE = 'https://w3c.github.io/json-ld-api/tests/'

export type SuiteClass = 'expand' | 'compact' | 'remote-doc' | 'toRdf'

/** Classes this change does not implement. Reported, never silently skipped. */
export const OUT_OF_SCOPE_CLASSES = ['frame', 'fromRdf', 'flatten', 'html'] as const

export interface SuiteCase {
  id: string
  name: string
  purpose?: string
  positive: boolean
  input: string
  expect?: string
  context?: string
  expectErrorCode?: string
  option: Record<string, unknown>
  requires?: string
}

export function loadManifest(suiteClass: SuiteClass): SuiteCase[] {
  const manifest = JSON.parse(
    readFileSync(join(SUITE_DIR, `${suiteClass}-manifest.jsonld`), 'utf8'),
  ) as { sequence: Array<Record<string, unknown>> }

  return manifest.sequence.map((entry) => {
    const types = ([] as string[]).concat(entry['@type'] as string | string[])
    return {
      id: String(entry['@id']),
      name: String(entry['name'] ?? entry['@id']),
      ...(entry['purpose'] !== undefined ? { purpose: String(entry['purpose']) } : {}),
      positive: types.includes('jld:PositiveEvaluationTest') || types.includes('jld:PositiveSyntaxTest'),
      input: String(entry['input']),
      ...(entry['expect'] !== undefined ? { expect: String(entry['expect']) } : {}),
      ...(entry['context'] !== undefined ? { context: String(entry['context']) } : {}),
      ...(entry['expectErrorCode'] !== undefined
        ? { expectErrorCode: String(entry['expectErrorCode']) }
        : {}),
      option: (entry['option'] as Record<string, unknown>) ?? {},
      ...(entry['requires'] !== undefined ? { requires: String(entry['requires']) } : {}),
    }
  })
}

/** Read a file the manifest names, relative to the suite directory. */
export function readCaseFile(relative: string): unknown {
  const path = join(SUITE_DIR, relative)
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function caseFileExists(relative: string): boolean {
  return existsSync(join(SUITE_DIR, relative))
}

/** The base IRI a case runs under, which several cases override. */
export function baseFor(testCase: SuiteCase): string {
  const override = testCase.option['base']
  if (typeof override === 'string') return override
  return SUITE_BASE + testCase.input
}

/**
 * A loader over the vendored copies. A case naming a document outside the
 * vendored tree resolves to `undefined`, which the runner reports as a case that
 * needs the network rather than as a failure.
 */
export function vendoredLoader(iri: string): unknown {
  if (!iri.startsWith(SUITE_BASE)) return undefined
  const relative = iri.slice(SUITE_BASE.length)
  const path = resolve(SUITE_DIR, relative)
  if (!path.startsWith(resolve(SUITE_DIR))) return undefined
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export interface CaseOutcome {
  id: string
  name: string
  status: 'pass' | 'fail' | 'skipped'
  /** Why it failed, or why it was skipped. Never empty for a non-pass. */
  reason?: string
}

export interface SuiteReport {
  suiteClass: SuiteClass
  total: number
  passed: number
  failed: number
  skipped: number
  outcomes: CaseOutcome[]
}

export function summarize(suiteClass: SuiteClass, outcomes: CaseOutcome[]): SuiteReport {
  return {
    suiteClass,
    total: outcomes.length,
    passed: outcomes.filter((o) => o.status === 'pass').length,
    failed: outcomes.filter((o) => o.status === 'fail').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    outcomes,
  }
}

/** Compare expanded output the way the suite intends: order-insensitive. */
export function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    // `@list` is ordered and must not be sorted. In a compacted document it may
    // hold a single value rather than an array.
    const child = (value as Record<string, unknown>)[key]
    out[key] = key === '@list' ? normalizeOrdered(child) : normalize(child)
  }
  return out
}

function normalizeOrdered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeOrdered)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key]
    out[key] = key === '@list' ? normalizeOrdered(child) : normalize(child)
  }
  return out
}

export { dirname }
