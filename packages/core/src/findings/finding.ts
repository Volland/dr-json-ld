/**
 * One finding shape across every level, so a caller never handles two kinds of
 * error.
 *
 * @lat: [[validation#Validation#Findings]]
 */
import type { Position } from '../source/index-file.js'
import type { JsonPointer } from '../source/pointer.js'

export type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'

export type Severity = 'info' | 'warning' | 'error'

export const SEVERITY_ORDER: Record<Severity, number> = { info: 0, warning: 1, error: 2 }

export interface Finding {
  /** A stable string, namespaced by level. Never reused for a different meaning. */
  ruleId: string
  level: Level
  severity: Severity
  /** Wording is not an interface; the rule id is. */
  message: string
  /** Into the document or the model — whichever the user wrote. */
  pointer: JsonPointer
  /** The file the pointer is into. */
  file: string
  loc: Position
  /** What the finding is about: a term key, an example path, a `uses` IRI. */
  subject?: string
}

/**
 * Deterministic order, so a diff of findings between two runs reflects a change
 * in the document rather than a change in iteration order.
 */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    a.file.localeCompare(b.file) ||
    a.loc.line - b.loc.line ||
    a.loc.column - b.loc.column ||
    a.pointer.localeCompare(b.pointer) ||
    a.ruleId.localeCompare(b.ruleId) ||
    (a.subject ?? '').localeCompare(b.subject ?? '') ||
    a.message.localeCompare(b.message)
  )
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareFindings)
}

export function maxSeverity(findings: readonly Finding[]): Severity | undefined {
  let worst: Severity | undefined
  for (const f of findings) {
    if (worst === undefined || SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[worst]) {
      worst = f.severity
    }
  }
  return worst
}

export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === 'error')
}

/** Findings at or below a requested level. A command names the highest it runs. */
export function atOrBelowLevel(findings: readonly Finding[], level: Level): Finding[] {
  const ceiling = LEVEL_ORDER[level]
  return findings.filter((f) => LEVEL_ORDER[f.level] <= ceiling)
}

export const LEVEL_ORDER: Record<Level, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 }

/** The levels this milestone implements. L3 and L4 are reported as unavailable. */
export const IMPLEMENTED_LEVELS: readonly Level[] = ['L0', 'L1', 'L2']

export function isImplementedLevel(level: string): level is Level {
  return (IMPLEMENTED_LEVELS as readonly string[]).includes(level)
}
