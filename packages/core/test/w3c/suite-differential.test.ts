import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jsonld from 'jsonld'

import { bareExpanded, expandDocument } from '../../src/processor/api.js'
import { emptyContext } from '../../src/processor/types.js'
import {
  baseFor,
  caseFileExists,
  loadManifest,
  normalize,
  readCaseFile,
  SUITE_BASE,
  vendoredLoader,
  type SuiteCase,
} from './harness.js'

/**
 * The differential oracle over the suite itself.
 *
 * A suite pass proves the working group's cases pass. This proves the processor
 * agrees with the implementation every consumer actually runs — which is the
 * more useful of the two, and the one that turns a disagreement into a question
 * with a right answer.
 *
 * @lat: [[processing#Processing#Conformance]]
 */

/** `jsonld.js` is given the same vendored tree and no network. */
const offlineLoader = async (url: string): Promise<unknown> => {
  const document = vendoredLoader(url)
  if (document === undefined) throw new Error(`not vendored: ${url}`)
  return { contextUrl: null, documentUrl: url, document }
}

type Divergence = { id: string; name: string; detail: string }

async function compareCase(
  testCase: SuiteCase,
): Promise<'agree' | 'skipped' | Divergence> {
  if (testCase.option['processingMode'] === 'json-ld-1.0') return 'skipped'
  if (testCase.requires !== undefined) return 'skipped'
  if (!caseFileExists(testCase.input)) return 'skipped'
  if (!testCase.positive) return 'skipped'

  let input: unknown
  try {
    input = readCaseFile(testCase.input)
  } catch {
    return 'skipped'
  }

  const base = baseFor(testCase)

  let theirs: unknown
  try {
    theirs = await jsonld.expand(input as never, {
      base,
      documentLoader: offlineLoader as never,
      safe: false,
    })
  } catch {
    // The reference implementation refused the case. Its refusal is not evidence
    // about this processor, so the case is not counted either way.
    return 'skipped'
  }

  let ours: unknown
  try {
    ours = bareExpanded(
      expandDocument(input, emptyContext(base), { resolveContext: vendoredLoader }),
    )
  } catch (error) {
    return {
      id: testCase.id,
      name: testCase.name,
      detail: `this processor threw where jsonld.js succeeded: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }

  const a = JSON.stringify(normalize(ours))
  const b = JSON.stringify(normalize(theirs))
  if (a === b) return 'agree'
  return {
    id: testCase.id,
    name: testCase.name,
    detail: `output differs from jsonld.js`,
  }
}

describe('differential over the W3C suite', () => {
  // @lat: [[processing#Processing#Conformance]]
  it('records every divergence from jsonld.js', async () => {
    const cases = loadManifest('expand')
    const results = await Promise.all(cases.map(compareCase))

    const divergences = results.filter((r): r is Divergence => typeof r === 'object')
    const agreed = results.filter((r) => r === 'agree').length
    const skipped = results.filter((r) => r === 'skipped').length

    const lines = [
      '# Differential against `jsonld.js` — expand',
      '',
      `Suite base: \`${SUITE_BASE}\`. Network off; both implementations read the vendored tree.`,
      '',
      `Compared: ${agreed + divergences.length}. Agreed: ${agreed}. Diverged: ${divergences.length}. Not compared: ${skipped}.`,
      '',
      'A divergence is a question with a right answer. Each one is resolved and the',
      "finding — including which implementation was right — is recorded in the",
      "project config's measured-behaviour section.",
      '',
      '## Divergences',
      '',
      ...(divergences.length === 0
        ? ['None.']
        : divergences.map((d) => `- \`${d.id}\` ${d.name} — ${d.detail}`)),
      '',
    ]

    const dir = fileURLToPath(new URL('../../../../docs/conformance/', import.meta.url))
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}differential.md`, lines.join('\n'))

    console.log(
      `differential: ${agreed} agree, ${divergences.length} diverge, ${skipped} not compared`,
    )
    expect(agreed).toBeGreaterThanOrEqual(DIFFERENTIAL_RATCHET)
  })
})

/** Raised only alongside a fix. See `docs/conformance/differential.md`. */
export const DIFFERENTIAL_RATCHET = 261
