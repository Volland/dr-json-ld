import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jsonld from 'jsonld'

import { baseFor, loadManifest, readCaseFile, SUITE_BASE, SUITE_DIR, vendoredLoader, type SuiteCase } from './harness.js'
import { canonical, convert, expandContextFor, rdfOptionsFor, skipReason } from './rdf-helpers.js'

/**
 * The differential oracle for RDF conversion: every in-scope positive `toRdf`
 * case is converted by this processor and by `jsonld.js`, and the canonical
 * datasets compared. A divergence is adjudicated against the suite's own
 * expected dataset, which is the authority.
 *
 * @lat: [[processing#Processing#RDF Conversion#From JSON-LD to RDF]]
 */

const offlineLoader = async (url: string): Promise<unknown> => {
  const document = vendoredLoader(url)
  if (document === undefined) throw new Error(`not vendored: ${url}`)
  return { contextUrl: null, documentUrl: url, document }
}

type Verdict = 'this processor' | 'jsonld.js' | 'neither'
type Divergence = { id: string; name: string; right: Verdict }

async function compareCase(testCase: SuiteCase): Promise<'agree' | 'skipped' | Divergence> {
  if (skipReason(testCase) !== undefined || !testCase.positive || testCase.expect === undefined) {
    return 'skipped'
  }
  let theirs: string
  try {
    const expandContext = expandContextFor(testCase)
    theirs = (await jsonld.toRDF(readCaseFile(testCase.input) as never, {
      base: baseFor(testCase),
      format: 'application/n-quads',
      documentLoader: offlineLoader as never,
      safe: false,
      ...rdfOptionsFor(testCase),
      ...(expandContext !== undefined ? { expandContext } : {}),
    } as never)) as unknown as string
  } catch {
    // The reference implementation refused the case; that is no evidence either way.
    return 'skipped'
  }
  let ours: string
  try {
    ours = convert(testCase)
  } catch {
    ours = ''
  }
  // Output that is not N-Quads at all is compared as unparseable rather than
  // failing the run: `jsonld.js` writes an IRI it should have dropped as-is.
  const a = canonicalOr(ours, '<unparseable output from this processor>')
  const b = canonicalOr(theirs, '<unparseable output from jsonld.js>')
  if (a === b) return 'agree'
  const expected = canonical(readFileSync(join(SUITE_DIR, testCase.expect), 'utf8'))
  const right: Verdict = a === expected ? 'this processor' : b === expected ? 'jsonld.js' : 'neither'
  return { id: testCase.id, name: testCase.name, right }
}

function canonicalOr(nquads: string, fallback: string): string {
  try {
    return canonical(nquads)
  } catch {
    return fallback
  }
}

describe('differential over the W3C toRdf suite', () => {
  it('records every divergence from jsonld.js, and which side the suite agrees with', async () => {
    const results = await Promise.all(loadManifest('toRdf').map(compareCase))
    const divergences = results.filter((r): r is Divergence => typeof r === 'object')
    const agreed = results.filter((r) => r === 'agree').length
    const skipped = results.filter((r) => r === 'skipped').length

    const section = (who: Verdict, title: string) => {
      const list = divergences.filter((d) => d.right === who)
      return [`### ${title}`, '', ...(list.length === 0 ? ['None.'] : list.map((d) => `- \`${d.id}\` ${d.name}`)), '']
    }
    const lines = [
      '# Differential against `jsonld.js` — toRdf',
      '',
      `Suite base: \`${SUITE_BASE}\`. Network off; both implementations read the vendored tree. Datasets are compared after URDNA2015 canonicalization.`,
      '',
      `Compared: ${agreed + divergences.length}. Agreed: ${agreed}. Diverged: ${divergences.length}. Not compared: ${skipped}.`,
      '',
      '## Divergences, adjudicated against the expected dataset',
      '',
      ...section('this processor', 'This processor is right'),
      ...section('jsonld.js', '`jsonld.js` is right'),
      ...section('neither', 'Neither matches the expected dataset'),
    ]
    const dir = fileURLToPath(new URL('../../../../docs/conformance/', import.meta.url))
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}toRdf-differential.md`, lines.join('\n'))

    console.log(`toRdf differential: ${agreed} agree, ${divergences.length} diverge, ${skipped} not compared`)
    expect(agreed).toBeGreaterThanOrEqual(TO_RDF_DIFFERENTIAL_RATCHET)
  })
})

/** Raised only alongside a fix. See `docs/conformance/toRdf-differential.md`. */
export const TO_RDF_DIFFERENTIAL_RATCHET = 320
