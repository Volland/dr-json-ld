/**
 * The schema and the validator must not have two opinions.
 *
 * The schema is the *earlier* report of a fact the validator also reports —
 * earlier because it fires on a keystroke rather than on a command. That is
 * only useful while the two agree, and the failure it invites is silent: an
 * editor underlining a model that `ldm check` accepts teaches the author that
 * the underline is noise.
 *
 * The bound is severity, not existence. A warning names a model the tool
 * accepts — `validateModel` reports `failed: hasErrors(...)` — so a warning may
 * never correspond to a schema rejection. `L1.facet-not-in-mode` is the case
 * that matters: per locked decision 5 a 1.1 facet in a 1.0 model is a
 * downgrade, and a schema that refused it would be relitigating that decision
 * by way of a JSON file.
 *
 * @lat: [[architecture#Architecture#Surface Syntax#What the schema refuses]]
 * @lat: [[validation#Validation#Findings]]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { SourceIndex } from '../src/source/index-file.js'
import { validateModel } from '../src/validate/validate.js'
import type { Finding } from '../src/findings/finding.js'
import { loadSchema } from './schema-corpus.test.js'

const CORPUS = fileURLToPath(new URL('./fixtures/schema/', import.meta.url))

function corpus(kind: 'accept' | 'reject'): Array<{ name: string; file: string }> {
  return readdirSync(`${CORPUS}${kind}`)
    .filter((f) => f.endsWith('.jsonld.yaml'))
    .sort()
    .map((name) => ({ name, file: `${CORPUS}${kind}/${name}` }))
}

function check(file: string, name: string): Finding[] {
  const text = readFileSync(file, 'utf8')
  return validateModel(SourceIndex.parse(text, { path: name }), { level: 'L1' }).findings
}

const errors = (findings: readonly Finding[]): Finding[] =>
  findings.filter((f) => f.severity === 'error')

function show(findings: readonly Finding[]): string {
  return findings.map((f) => `${f.severity} ${f.ruleId} @ ${f.loc.line}:${f.loc.column}`).join('\n')
}

describe('the schema and the validator agree', () => {
  const validate = loadSchema()

  // @lat: [[architecture#Architecture#Surface Syntax#What the schema refuses]]
  it.each(corpus('reject'))('$name is refused by both', ({ name, file }) => {
    expect(validate(parse(readFileSync(file, 'utf8'))), 'the schema').toBe(false)
    const found = errors(check(file, name))
    expect(
      found.length,
      `the schema refused ${name} but validation reported no error`,
    ).toBeGreaterThan(0)
  })

  it.each(corpus('accept'))('$name is accepted by both', ({ name, file }) => {
    const found = errors(check(file, name))
    expect(found, `the schema accepted ${name} but validation reported:\n${show(found)}`).toEqual([])
  })

  it('a downgrade is a warning, and therefore not a rejection', () => {
    // The mode-1.0 case, asserted directly rather than inferred from the corpus
    // passing: this is the whole reason the schema stops where it does.
    const file = `${CORPUS}accept/legal-but-suspicious.jsonld.yaml`
    const findings = check(file, 'legal-but-suspicious.jsonld.yaml')
    expect(findings.some((f) => f.ruleId === 'L1.facet-not-in-mode')).toBe(true)
    expect(errors(findings)).toEqual([])
  })

  it('every rejection carries a line and column into the model file', () => {
    for (const { name, file } of corpus('reject')) {
      for (const finding of errors(check(file, name))) {
        expect(finding.loc.line, `${name} ${finding.ruleId}`).toBeGreaterThan(0)
        expect(finding.loc.column, `${name} ${finding.ruleId}`).toBeGreaterThan(0)
        expect(finding.file).toBe(name)
      }
    }
  })

  it('each co-constraint is reached by at least one corpus case', () => {
    const reached = new Set<string>()
    for (const { name, file } of corpus('reject')) {
      for (const finding of errors(check(file, name))) reached.add(finding.ruleId)
    }
    expect([...reached]).toEqual(
      expect.arrayContaining(['L1.invalid-container-mapping', 'L1.invalid-reverse-property']),
    )
  })
})
