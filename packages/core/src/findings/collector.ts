/**
 * The one way a finding is made. Going through the registry is what makes the
 * test in `rule-registry.test.ts` — every emitted finding names a registered id
 * — true by construction rather than by review.
 *
 * @lat: [[validation#Validation#Findings]]
 */
import type { SourceIndex } from '../source/index-file.js'
import type { JsonPointer } from '../source/pointer.js'
import { sortFindings, type Finding, type Severity } from './finding.js'
import { RULES, type RuleId } from './rules.js'

export interface RaiseOptions {
  /** Overrides the registry severity. Used by the coverage direction, which is deliberately quieter. */
  severity?: Severity
  subject?: string
}

export class FindingCollector {
  private readonly items: Finding[] = []

  /**
   * @param source The file the pointer is into. A finding always points at a
   * file the user wrote, never at a generated artifact.
   */
  raise(
    id: RuleId,
    source: Pick<SourceIndex, 'path' | 'positionOf'>,
    pointer: JsonPointer,
    message: string,
    options: RaiseOptions = {},
  ): Finding {
    const rule = RULES[id]
    const finding: Finding = {
      ruleId: rule.id,
      level: rule.level,
      severity: options.severity ?? rule.severity,
      message,
      pointer,
      file: source.path,
      loc: source.positionOf(pointer),
      ...(options.subject !== undefined ? { subject: options.subject } : {}),
    }
    this.items.push(finding)
    return finding
  }

  /**
   * Whether this rule has already been raised — anywhere, or at `pointer` or
   * anywhere beneath it. The subtree check is what lets a check that knows only
   * which term is at fault stand down for one that knows which facet.
   */
  has(id: RuleId, pointer?: JsonPointer): boolean {
    return this.items.some(
      (f) =>
        f.ruleId === id &&
        (pointer === undefined ||
          f.pointer === pointer ||
          f.pointer.startsWith(`${pointer}/`)),
    )
  }

  add(finding: Finding): void {
    this.items.push(finding)
  }

  addAll(findings: readonly Finding[]): void {
    this.items.push(...findings)
  }

  /** Always sorted, because the order is part of the contract. */
  all(): Finding[] {
    return sortFindings(this.items)
  }

  get size(): number {
    return this.items.length
  }
}
