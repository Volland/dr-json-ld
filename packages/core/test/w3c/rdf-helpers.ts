/**
 * Shared by the `toRdf` suite and its differential: this processor's N-Quads
 * for a case, and canonical N-Quads for comparison.
 *
 * @lat: [[processing#Processing#RDF Conversion#From JSON-LD to RDF]]
 */
import rdfCanonize from 'rdf-canonize'

import { expandDocument } from '../../src/processor/api.js'
import { toNQuads, toRdf, type ToRdfOptions } from '../../src/processor/to-rdf.js'
import { emptyContext } from '../../src/processor/types.js'
import { baseFor, caseFileExists, readCaseFile, vendoredLoader, type SuiteCase } from './harness.js'

interface Canonizer {
  _canonizeSync(input: unknown, options: { algorithm: string }): string
  NQuads: { parse(text: string): unknown }
}
const canonizer = rdfCanonize as unknown as Canonizer

/** Canonical N-Quads, so blank node labels never decide a comparison. */
export function canonical(nquads: string): string {
  return canonizer._canonizeSync(canonizer.NQuads.parse(nquads), { algorithm: 'URDNA2015' })
}

export function rdfOptionsFor(testCase: SuiteCase): ToRdfOptions {
  const direction = testCase.option['rdfDirection']
  return {
    ...(direction === 'i18n-datatype' || direction === 'compound-literal'
      ? { rdfDirection: direction }
      : {}),
    ...(testCase.option['produceGeneralizedRdf'] === true ? { produceGeneralizedRdf: true } : {}),
  }
}

export function expandContextFor(testCase: SuiteCase): unknown {
  const option = testCase.option['expandContext']
  if (option === undefined) return undefined
  return vendoredLoader(baseFor(testCase).replace(/toRdf\/[^/]*$/, '') + String(option))
}

/** This processor's N-Quads for a case. Throws what expansion throws. */
export function convert(testCase: SuiteCase): string {
  const input = readCaseFile(testCase.input)
  const expandContext = expandContextFor(testCase)
  const { expanded } = expandDocument(input, emptyContext(baseFor(testCase)), {
    resolveContext: vendoredLoader,
    ...(expandContext !== undefined ? { expandContext } : {}),
  })
  return toNQuads(toRdf(expanded, rdfOptionsFor(testCase)))
}

export function skipReason(testCase: SuiteCase): string | undefined {
  if (
    testCase.option['processingMode'] === 'json-ld-1.0' ||
    testCase.option['specVersion'] === 'json-ld-1.0'
  ) {
    return 'targets the JSON-LD 1.0 processing mode'
  }
  if (testCase.requires !== undefined) return `requires the ${testCase.requires} feature`
  if (!caseFileExists(testCase.input)) return 'the input document is not in the vendored tree'
  return undefined
}
