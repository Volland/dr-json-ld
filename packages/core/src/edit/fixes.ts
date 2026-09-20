/**
 * Quick fixes: the repair a finding implies, as a targeted splice.
 *
 * A finding names what is wrong and where. For a small number of rules there is
 * exactly one legal repair, and making the user retype it is make-work. For most
 * rules there is not, and guessing would be worse than silence — so this is a
 * registry keyed by rule id rather than a heuristic, and a rule absent from it
 * offers nothing.
 *
 * It lives in `core` and returns splices rather than editor edits, so the same
 * repair is reachable from a command and every entry is testable in plain Node.
 * Nothing here may import `vscode`.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Quick fixes]]
 * @lat: [[validation#Validation#Findings]]
 */
import type { Finding } from '../findings/finding.js'
import { mintElementId } from '../model/element-id.js'
import { SourceIndex } from '../source/index-file.js'
import { pointerChild, pointerRoot, type JsonPointer } from '../source/pointer.js'
import { blockExtent, endOfLine, indentAt, startOfLine, type Splice } from './splice.js'

export interface QuickFix {
  /** The rule this repairs. */
  ruleId: string
  /** What applying it will do, in the user's words. Shown as the action's title. */
  title: string
  /**
   * True when the repair changes the RDF a document produces, rather than only
   * making the model legal. Such a fix must say so in its title.
   */
  changesMeaning: boolean
  /** Against the model text the finding was produced from. */
  splices: Splice[]
}

/**
 * Produces the repair for one finding, or `undefined` when this particular
 * finding has no single answer after all — an entry may decline.
 */
type FixFactory = (finding: Finding, source: SourceIndex) => QuickFix | undefined

/** The object at a pointer, or `undefined`. */
function objectAt(source: SourceIndex, pointer: JsonPointer): Record<string, unknown> | undefined {
  const tokens = pointer.split('/').slice(1).map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))
  let node: unknown = source.data
  for (const token of tokens) {
    if (node === null || typeof node !== 'object') return undefined
    node = Array.isArray(node) ? node[Number(token)] : (node as Record<string, unknown>)[token]
  }
  return node !== null && typeof node === 'object' && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : undefined
}

/** Remove the whole block a key introduces, including its line and newline. */
function deleteKey(source: SourceIndex, pointer: JsonPointer): Splice | undefined {
  const range = source.keyRangeOf(pointer)
  if (!range) return undefined
  const { start, end } = blockExtent(source.text, range.start)
  // Take the trailing newline with it, so removing a line leaves no blank one.
  const after = source.text[end] === '\n' ? end + 1 : end
  return { start, end: after, text: '' }
}

/**
 * A `@reverse` term names its IRI through `@reverse`, so `@id` and `@nest` have
 * nothing to name and a container other than `@set` or `@index` cannot apply.
 * The repair is to remove the facet that may not be there — never `@reverse`
 * itself, which is the one the author clearly meant.
 */
const fixInvalidReverse: FixFactory = (finding, source) => {
  // The finding points either at the term or at a facet inside it. Either way
  // the term is what must be inspected.
  const termPointer = finding.pointer.endsWith('/@reverse')
    ? finding.pointer.slice(0, -'/@reverse'.length)
    : finding.pointer
  const term = objectAt(source, termPointer)
  if (!term || !('@reverse' in term)) return undefined

  const offending = ['@id', '@nest'].filter((facet) => facet in term)
  const container = term['@container']
  const containerIllegal =
    container !== undefined &&
    ![container].flat().every((v) => v === '@set' || v === '@index')
  if (containerIllegal) offending.push('@container')
  if (offending.length !== 1) return undefined

  const facet = offending[0]!
  const splice = deleteKey(source, pointerChild(termPointer, facet))
  if (!splice) return undefined
  return {
    ruleId: finding.ruleId,
    title: `Remove \`${facet}\` — a \`@reverse\` term names its IRI through \`@reverse\``,
    changesMeaning: false,
    splices: [splice],
  }
}

/**
 * A duplicate element id is repaired by minting a fresh one for this element,
 * never by touching the element that had it first: the id is identity, and
 * moving it would silently re-point whatever referenced it.
 *
 * `backfillElementIds` cannot do this — it writes ids onto elements that have
 * none, and a duplicate already has one.
 */
const fixDuplicateElementId: FixFactory = (finding, source) => {
  const range = source.rangeOf(finding.pointer)
  if (!range) return undefined

  const taken = new Set<string>()
  const model = source.data as Record<string, unknown> | null
  const terms = model?.['terms']
  if (terms && typeof terms === 'object' && !Array.isArray(terms)) {
    for (const def of Object.values(terms as Record<string, unknown>)) {
      const id = (def as Record<string, unknown> | null)?.['id']
      if (typeof id === 'string') taken.add(id)
    }
  }
  for (const field of ['examples', 'views'] as const) {
    const list = model?.[field]
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      const id = (entry as Record<string, unknown> | null)?.['id']
      if (typeof id === 'string') taken.add(id)
    }
  }

  const fresh = mintElementId(taken)
  return {
    ruleId: finding.ruleId,
    title: `Give this element a fresh id (${fresh})`,
    changesMeaning: false,
    splices: [{ start: range.start, end: range.end, text: fresh }],
  }
}

/**
 * A term in no view cannot be seen on any diagram. With exactly one view the
 * repair is unambiguous; with several, which one the author meant is a question
 * only they can answer, so nothing is offered.
 */
const fixTermInNoView: FixFactory = (finding, source) => {
  const model = source.data as Record<string, unknown> | null
  const views = model?.['views']
  if (!Array.isArray(views) || views.length !== 1) return undefined

  const term = finding.subject
  if (!term) return undefined

  const viewPointer = pointerChild(pointerChild(pointerRoot(), 'views'), 0)
  const view = views[0] as Record<string, unknown> | null
  const listed = view?.['terms']
  if (!Array.isArray(listed)) return undefined

  const termsPointer = pointerChild(viewPointer, 'terms')
  const text = source.text

  // Append after the last entry, matching its indentation, so the existing
  // order and any comment between entries are untouched.
  if (listed.length > 0) {
    const last = source.rangeOf(pointerChild(termsPointer, listed.length - 1))
    if (!last) return undefined
    const lineStart = startOfLine(text, last.start)
    const isBlockSequence = /^\s*-\s/.test(text.slice(lineStart, endOfLine(text, last.start)))
    if (!isBlockSequence) return undefined
    const indent = indentAt(text, last.start)
    const at = endOfLine(text, last.start)
    return {
      ruleId: finding.ruleId,
      title: `Add "${term}" to the view "${String(view?.['name'] ?? '')}"`,
      changesMeaning: false,
      splices: [{ start: at, end: at, text: `\n${indent}- ${yamlScalar(term)}` }],
    }
  }

  // An empty `terms: []` — replace the flow sequence with a one-entry block.
  const range = source.rangeOf(termsPointer)
  if (!range) return undefined
  const indent = indentAt(text, startOfLine(text, range.start))
  return {
    ruleId: finding.ruleId,
    title: `Add "${term}" to the view "${String(view?.['name'] ?? '')}"`,
    changesMeaning: false,
    splices: [
      { start: range.start, end: range.end, text: `\n${indent}  - ${yamlScalar(term)}` },
    ],
  }
}

/** Quote a term key only when YAML would otherwise read it as something else. */
function yamlScalar(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value) ? value : JSON.stringify(value)
}

/**
 * The registry. A rule id absent from it offers no quick fix — deliberately,
 * because a guessed repair to a model file is worse than none.
 *
 * Absent on purpose, each for a stated reason:
 *   `L1.unknown-prefix`          the IRI is not recoverable from the finding
 *   `L1.facet-not-in-mode`       two legal repairs: drop the facet, or retarget
 *   `L1.context-not-vendored`    a network command, not an edit
 *   `L1.context-hash-mismatch`   likewise
 *   `L2.term-unused`             the repair is deletion
 *   `L2.coercion-did-not-fire`   reported in the example document, repaired in
 *                                the model — a cross-file fix this registry
 *                                cannot express yet
 */
export const QUICK_FIXES: Readonly<Record<string, FixFactory>> = {
  'L1.invalid-reverse-property': fixInvalidReverse,
  'L0.duplicate-element-id': fixDuplicateElementId,
  'L2.term-in-no-view': fixTermInNoView,
}

/** Whether any repair is registered for this rule. */
export function isFixable(ruleId: string): boolean {
  return ruleId in QUICK_FIXES
}

/**
 * The repair for one finding, or `undefined`. `source` must be the model the
 * finding is positioned in.
 */
export function fixFor(finding: Finding, source: SourceIndex): QuickFix | undefined {
  const factory = QUICK_FIXES[finding.ruleId]
  if (!factory) return undefined
  const fix = factory(finding, source)
  if (!fix || fix.splices.length === 0) return undefined
  return fix
}
