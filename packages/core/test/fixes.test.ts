/**
 * Every quick fix, proved by applying it.
 *
 * The property is the same for each entry and is what makes the registry safe
 * to extend: apply the repair, re-validate, and the finding it claimed to fix is
 * gone while nothing new is broken. A fix that merely silences a finding by
 * breaking the file elsewhere fails here.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Quick fixes]]
 * @lat: [[validation#Validation#Findings]]
 */
import { describe, expect, it } from 'vitest'

import { applySplices } from '../src/edit/splice.js'
import { fixFor, isFixable, QUICK_FIXES } from '../src/edit/fixes.js'
import { RULES } from '../src/findings/rules.js'
import type { Finding } from '../src/findings/finding.js'
import { SourceIndex } from '../src/source/index-file.js'
import { validateModel } from '../src/validate/validate.js'

const PATH = 'fixable.jsonld.yaml'

function check(text: string): Finding[] {
  return validateModel(SourceIndex.parse(text, { path: PATH }), { level: 'L2' }).findings
}

function findingFor(text: string, ruleId: string): Finding {
  const found = check(text).find((f) => f.ruleId === ruleId)
  if (!found) {
    throw new Error(
      `fixture does not produce ${ruleId}; it produces ${check(text).map((f) => f.ruleId).join(', ') || 'nothing'}`,
    )
  }
  return found
}

const errorsOf = (findings: readonly Finding[]): string[] =>
  findings.filter((f) => f.severity === 'error').map((f) => `${f.ruleId}@${f.loc.line}`)

/** One case per registry entry, so an entry without a case fails the sweep below. */
const CASES: Array<{ ruleId: string; name: string; model: string; expect?: RegExp }> = [
  {
    ruleId: 'L1.invalid-reverse-property',
    name: 'a reverse term also carrying @id',
    model: `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#

terms:
  parent:
    id: aaa111
    "@reverse": ex:child
    "@id": ex:parent
`,
    expect: /Remove `@id`/,
  },
  {
    ruleId: 'L1.invalid-reverse-property',
    name: 'a reverse term also carrying @nest',
    model: `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#

terms:
  parent:
    id: aaa111
    "@reverse": ex:child
    "@nest": meta
`,
    expect: /Remove `@nest`/,
  },
  {
    ruleId: 'L0.duplicate-element-id',
    name: 'two terms sharing one element id',
    model: `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#

terms:
  name:
    id: aaa111
    "@id": ex:name
  title:
    id: aaa111
    "@id": ex:title
`,
    expect: /fresh id/,
  },
  {
    ruleId: 'L2.term-in-no-view',
    name: 'a term missing from the model’s only view',
    model: `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#

terms:
  name:
    id: aaa111
    "@id": ex:name
  title:
    id: bbb222
    "@id": ex:title

views:
  - id: ccc333
    name: core
    terms:
      - name
`,
    expect: /Add "title" to the view "core"/,
  },
]

describe('a quick fix repairs the finding it claims', () => {
  it.each(CASES)('$name', ({ ruleId, model, expect: titleShape }) => {
    const before = check(model)
    const finding = findingFor(model, ruleId)
    const source = SourceIndex.parse(model, { path: PATH })

    const fix = fixFor(finding, source)
    expect(fix, `${ruleId} is registered but declined this finding`).toBeDefined()
    if (titleShape) expect(fix!.title).toMatch(titleShape)

    const after = applySplices(model, fix!.splices)
    expect(after, 'the fix changed nothing').not.toBe(model)

    // The finding it claimed is gone...
    const remaining = check(after)
    expect(
      remaining.filter((f) => f.ruleId === ruleId && f.loc.line === finding.loc.line),
      `${ruleId} survived its own fix`,
    ).toEqual([])

    // ...and nothing that was not already broken is broken now.
    const introduced = errorsOf(remaining).filter((e) => !errorsOf(before).includes(e))
    expect(introduced, `${ruleId}'s fix introduced new errors`).toEqual([])
  })

  it('every registered rule id is a real rule, and is covered by a case', () => {
    const covered = new Set(CASES.map((c) => c.ruleId))
    for (const ruleId of Object.keys(QUICK_FIXES)) {
      expect(RULES[ruleId as keyof typeof RULES], `${ruleId} is not a registered rule`).toBeDefined()
      expect(covered.has(ruleId), `${ruleId} has no case in this file`).toBe(true)
    }
  })

  it('offers nothing for a rule with no single repair', () => {
    // Each of these is absent on purpose; see the registry's own list.
    for (const ruleId of [
      'L1.unknown-prefix',
      'L1.facet-not-in-mode',
      'L1.context-not-vendored',
      'L2.term-unused',
      'L2.coercion-did-not-fire',
    ]) {
      expect(isFixable(ruleId), `${ruleId} should offer no quick fix`).toBe(false)
    }
  })

  it('declines a term-in-no-view finding when the model has several views', () => {
    const model = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#

terms:
  name:
    id: aaa111
    "@id": ex:name
  title:
    id: bbb222
    "@id": ex:title

views:
  - id: ccc333
    name: core
    terms:
      - name
  - id: ddd444
    name: extra
    terms:
      - name
`
    const finding = findingFor(model, 'L2.term-in-no-view')
    const source = SourceIndex.parse(model, { path: PATH })
    // Which view the author meant is a question only they can answer.
    expect(fixFor(finding, source)).toBeUndefined()
  })
})

/**
 * The formatting property, which is the whole reason a fix is a splice rather
 * than a re-serialisation: `Document.toString()` normalises flow-collection
 * padding across the file, so a one-facet repair would arrive as a whole-file
 * diff and a reviewer could not see what changed.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Targeted edits]]
 */
describe('a quick fix is a targeted edit', () => {
  /** A model with comments, a deliberately non-alphabetical key order and flow style. */
  const ORNATE = `# The catalogue vocabulary.
# Second line of the header comment.
jsonld: "1"

namespace: { prefix: ex, base: "https://example.org/ns#" }

# Terms are ordered by importance, not alphabetically.
terms:
  title:
    id: bbb222
    "@id": ex:title    # trailing comment
    "@container": "@set"

  # The reverse of ex:child. This comment must survive.
  parent:
    id: aaa111
    "@reverse": ex:child
    "@id": ex:parent

  name:
    id: ccc333
    "@id": ex:name
`

  function linesChanged(before: string, after: string): string[] {
    const a = before.split('\n')
    const b = after.split('\n')
    const removed = a.filter((line, i) => b[i] !== line)
    return removed
  }

  it('touches only the repaired region, leaving every comment in place', () => {
    const finding = findingFor(ORNATE, 'L1.invalid-reverse-property')
    const source = SourceIndex.parse(ORNATE, { path: PATH })
    const fix = fixFor(finding, source)!
    const after = applySplices(ORNATE, fix.splices)

    // Exactly one line leaves the file: the `@id` the reverse term may not carry.
    const gone = ORNATE.split('\n').filter((l) => !after.split('\n').includes(l))
    expect(gone).toEqual(['    "@id": ex:parent'])

    // Every comment survives, including the trailing one and the header.
    for (const comment of [
      '# The catalogue vocabulary.',
      '# Second line of the header comment.',
      '# Terms are ordered by importance, not alphabetically.',
      '  # The reverse of ex:child. This comment must survive.',
      '    "@id": ex:title    # trailing comment',
    ]) {
      expect(after, `lost: ${comment}`).toContain(comment)
    }

    // The flow mapping is untouched — a re-serialisation would have reflowed it.
    expect(after).toContain('namespace: { prefix: ex, base: "https://example.org/ns#" }')

    // And the key order is unchanged: title still precedes parent precedes name.
    expect(after.indexOf('  title:')).toBeLessThan(after.indexOf('  parent:'))
    expect(after.indexOf('  parent:')).toBeLessThan(after.indexOf('  name:'))
  })

  it('changes one line and no other, for every registered fix', () => {
    for (const { ruleId, model } of CASES) {
      const finding = findingFor(model, ruleId)
      const fix = fixFor(finding, SourceIndex.parse(model, { path: PATH }))!
      const after = applySplices(model, fix.splices)
      // A repair is small by construction: at most one line differs in place,
      // plus at most one line added or removed.
      const delta = Math.abs(after.split('\n').length - model.split('\n').length)
      expect(delta, `${ruleId} changed the line count by ${delta}`).toBeLessThanOrEqual(1)
      expect(linesChanged(model, after).length, `${ruleId} rewrote the file`).toBeLessThanOrEqual(3)
    }
  })
})
