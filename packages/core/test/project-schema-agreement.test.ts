/**
 * The project schema and project parsing must not have two opinions, for the
 * same reason the model pair must not: the schema is the *earlier* report of a
 * fact the command also reports, and an editor underlining a project file that
 * `ldm check` accepts teaches the author that the underline is noise.
 *
 * The severity bound is the model pair's bound, unchanged. A warning names a
 * project the tool accepts, so a warning may never correspond to a rejection.
 *
 * @lat: [[architecture#Architecture#Projects#Checked like a model]]
 * @lat: [[validation#Validation#Findings]]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { parseProject } from '../src/project/project.js'
import type { Finding } from '../src/findings/finding.js'
import { loadProjectSchema } from './schema-corpus.test.js'

const CORPUS = fileURLToPath(new URL('./fixtures/project-schema/', import.meta.url))

function corpus(kind: 'accept' | 'reject'): Array<{ name: string; file: string }> {
  return readdirSync(`${CORPUS}${kind}`)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((name) => ({ name, file: `${CORPUS}${kind}/${name}` }))
}

/**
 * Parsed at the fixture's own path. The path matters: `parseProject` resolves
 * model paths against the file's directory, and a finding must point into the
 * file the author wrote.
 */
function check(file: string): Finding[] {
  return parseProject(readFileSync(file, 'utf8'), file).findings
}

const errors = (findings: readonly Finding[]): Finding[] =>
  findings.filter((f) => f.severity === 'error')

function show(findings: readonly Finding[]): string {
  return findings.map((f) => `${f.severity} ${f.ruleId} @ ${f.loc.line}:${f.loc.column}`).join('\n')
}

describe('the project schema and project parsing agree', () => {
  const validate = loadProjectSchema()

  /**
   * `L0.project-model-missing` is excluded deliberately. Every fixture here
   * names a model file the corpus does not ship, so that finding fires on all of
   * them — and a test satisfied by it would pass no matter what the structural
   * refusal did, which is the wrong-reason pass this corpus exists to prevent.
   */
  const STRUCTURAL = (findings: readonly Finding[]): Finding[] =>
    errors(findings).filter((f) => f.ruleId !== 'L0.project-model-missing')

  // @lat: [[architecture#Architecture#Projects#Checked like a model]]
  it.each(corpus('reject'))('$name is refused by both', ({ file }) => {
    expect(validate(parse(readFileSync(file, 'utf8'))), 'the schema').toBe(false)
    const found = STRUCTURAL(check(file))
    expect(
      found.map((f) => f.ruleId),
      'the schema refused this project file but parsing reported no structural error',
    ).not.toEqual([])
  })

  it.each(corpus('accept'))('$name is accepted by both', ({ name, file }) => {
    // A model path that does not exist on disk is not a schema question, and
    // every fixture points at a model this corpus deliberately does not ship.
    const structural = STRUCTURAL(check(file))
    expect(
      structural,
      `the schema accepted ${name} but parsing reported:\n${show(structural)}`,
    ).toEqual([])
  })

  // @lat: [[validation#Validation#Findings]]
  it('every rejection carries a line and column into the project file', () => {
    for (const { name, file } of corpus('reject')) {
      for (const finding of errors(check(file))) {
        expect(finding.loc.line, `${name} ${finding.ruleId}`).toBeGreaterThan(0)
        expect(finding.loc.column, `${name} ${finding.ruleId}`).toBeGreaterThan(0)
        expect(finding.pointer, `${name} ${finding.ruleId}`).toBeDefined()
      }
    }
  })

  it('a rejection is reported under a registered project rule id', () => {
    for (const { name, file } of corpus('reject')) {
      for (const finding of errors(check(file))) {
        expect(finding.ruleId, `${name}`).toMatch(/^L0\./)
      }
    }
  })
})
