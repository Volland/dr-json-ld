/**
 * The editor side of a quick fix: a diagnostic carrying a rule id the registry
 * knows becomes one code action whose edit is the registry's splices, and a rule
 * it does not know becomes nothing.
 *
 * Every decision about what a repair *is* is tested in core. What is tested here
 * is only the plumbing — that the lookup happens, that the edit lands at the
 * right offsets, and that it arrives as one edit so the editor can undo it in
 * one step.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Quick fixes]]
 */
import { describe, expect, it } from 'vitest'

import { applySplices } from '@json-ld-modeler/core'

import { QuickFixProvider } from '../src/extension.js'
import {
  CodeActionKind,
  Diagnostic,
  DiagnosticSeverity,
  Range,
  editableDocument,
} from './vscode-stub.js'

const MODEL = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#

# This comment must survive the repair.
terms:
  parent:
    id: aaa111
    "@reverse": ex:child
    "@id": ex:parent
`

/** A diagnostic as `toDiagnostic` would have produced it, at a 0-based line. */
function diagnosticAt(line: number, code: string): Diagnostic {
  const d = new Diagnostic(new Range(line, 0, line, 1), 'irrelevant', DiagnosticSeverity.Error)
  d.source = 'jsonld-modeler'
  d.code = code
  return d
}

function actionsFor(text: string, diagnostics: Diagnostic[]) {
  const document = editableDocument('/w/vocabulary.jsonld.yaml', text)
   
  return new QuickFixProvider().provideCodeActions(document as any, null as any, {
    diagnostics,
  } as any)
}

/**
 * The line `needle` is on, 0-based, as the editor counts.
 *
 * Note that the reverse-property finding is positioned at the *term*, not at the
 * facet it names: a term carrying both `@id` and `@reverse` is wrong as a whole,
 * and there is no single facet to point at until the repair chooses one.
 */
function lineOf(text: string, needle: string): number {
  return text.split('\n').findIndex((l) => l.includes(needle))
}

describe('a finding with a registered repair offers a code action', () => {
  // @lat: [[architecture#Architecture#Editing Surface#Quick fixes]]
  it('offers one action, titled with what it will do', () => {
    const line = lineOf(MODEL, '  parent:')
    const actions = actionsFor(MODEL, [diagnosticAt(line, 'L1.invalid-reverse-property')])

    expect(actions).toHaveLength(1)
    expect(actions[0]!.title).toMatch(/Remove `@id`/)
    expect(actions[0]!.kind).toBe(CodeActionKind.QuickFix)
    expect(actions[0]!.diagnostics).toHaveLength(1)
  })

  it('applies as one edit, so the editor undoes it in one step', () => {
    const line = lineOf(MODEL, '  parent:')
    const [action] = actionsFor(MODEL, [diagnosticAt(line, 'L1.invalid-reverse-property')])

    const replacements = action!.edit!.replacements
    expect(replacements).toHaveLength(1)

    // The edit's offsets are the registry's splices, so applying either gives
    // the same text — the translation adds nothing and loses nothing.
    const applied = applySplices(
      MODEL,
      replacements.map((r) => ({ start: r.start, end: r.end, text: r.text })),
    )
    expect(applied).not.toContain('"@id": ex:parent')
    expect(applied).toContain('"@reverse": ex:child')
    expect(applied).toContain('# This comment must survive the repair.')
  })

  // @lat: [[architecture#Architecture#Editing Surface#Quick fixes]]
  it('offers nothing for a rule id the registry does not know', () => {
    const line = lineOf(MODEL, 'terms:')
    for (const ruleId of ['L1.unknown-prefix', 'L2.coercion-did-not-fire', 'L1.facet-not-in-mode']) {
      expect(actionsFor(MODEL, [diagnosticAt(line, ruleId)]), ruleId).toEqual([])
    }
  })

  it('ignores a diagnostic that is not ours', () => {
    const line = lineOf(MODEL, '  parent:')
    const foreign = new Diagnostic(
      new Range(line, 0, line, 1),
      'from the YAML extension',
      DiagnosticSeverity.Error,
    )
    foreign.source = 'yaml'
    foreign.code = 'L1.invalid-reverse-property'
    expect(actionsFor(MODEL, [foreign])).toEqual([])
  })

  it('offers nothing when no finding sits on the diagnostic’s line', () => {
    // A stale diagnostic, left behind after an edit moved the problem.
    expect(actionsFor(MODEL, [diagnosticAt(0, 'L1.invalid-reverse-property')])).toEqual([])
  })
})
