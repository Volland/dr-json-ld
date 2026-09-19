/**
 * Comparing two versions, and naming what kind of change each difference is.
 *
 * The five classes exist because JSON-LD's failure modes do not collapse into
 * the usual three. A JSON key change is `breaking` — consumers' documents stop
 * compacting the same way — while asserting nothing different about the data. An
 * IRI change is `semantic`: every document still parses and every one now means
 * something else, which is more dangerous than a break and would be misfiled as
 * one.
 *
 * Matching is by element id throughout, so a rename reads as a rename across a
 * version boundary exactly as it does within one.
 *
 * @lat: [[emitters#Emitters#Change Management#Change Classification]]
 */
import type { ContainerValue, Ir, IrTerm } from '../model/ir.js'

export const CHANGE_CLASSES = [
  'additive',
  'compatible',
  'breaking',
  'semantic',
  'illegal',
] as const

export type ChangeClass = (typeof CHANGE_CLASSES)[number]

/**
 * Severity order, for gating. `illegal` is worst because the protection it
 * violates was a promise to a downstream context; `semantic` outranks `breaking`
 * because a break is loud and a meaning change is silent.
 */
export const CLASS_ORDER: Record<ChangeClass, number> = {
  additive: 0,
  compatible: 1,
  breaking: 2,
  semantic: 3,
  illegal: 4,
}

export interface Difference {
  /** The element id both sides were matched by, when there is one. */
  elementId: string
  /** What kind of thing changed. */
  kind:
    | 'term-added'
    | 'term-removed'
    | 'term-key-changed'
    | 'term-iri-changed'
    | 'term-facet-changed'
    | 'namespace-changed'
    | 'mode-changed'
    | 'vocab-changed'
    | 'prefix-changed'
  class: ChangeClass
  /** What a reader needs to know, in one sentence. */
  message: string
  /** The term key, prefix name or field this concerns. */
  subject: string
  /** Set when the class was chosen under ambiguity, which forces `breaking`. */
  ambiguous?: boolean
  before?: string
  after?: string
}

export interface CompareResult {
  differences: Difference[]
  /** The worst class present, or `undefined` when nothing changed. */
  worst?: ChangeClass
}

export class CompareRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompareRefused'
  }
}

/**
 * Compare two resolved IRs — in practice, two versions' lockfiles.
 *
 * Refuses either side carrying a derived element id, because a rename could not
 * then be told from a removal plus an addition, and every classification below
 * depends on being able to.
 */
export function compareVersions(before: Ir, after: Ir): CompareResult {
  refuseDerivedIds(before, 'the older version')
  refuseDerivedIds(after, 'the newer version')

  const differences: Difference[] = []

  compareModelLevel(before, after, differences)
  compareTerms(before, after, differences)

  // Deterministic: the set and order depend only on the two versions. Sorted by
  // class first so the most dangerous difference is read first, then by element
  // id so two runs never disagree.
  differences.sort(
    (a, b) =>
      CLASS_ORDER[b.class] - CLASS_ORDER[a.class] ||
      a.elementId.localeCompare(b.elementId) ||
      a.kind.localeCompare(b.kind) ||
      a.subject.localeCompare(b.subject),
  )

  const worst = differences.reduce<ChangeClass | undefined>(
    (acc, d) => (acc === undefined || CLASS_ORDER[d.class] > CLASS_ORDER[acc] ? d.class : acc),
    undefined,
  )

  return { differences, ...(worst !== undefined ? { worst } : {}) }
}

function refuseDerivedIds(ir: Ir, which: string): void {
  const derived = [
    ...ir.terms.filter((t) => !t.idWritten).map((t) => `term "${t.key}"`),
    ...ir.examples.filter((e) => !e.idWritten).map((e) => `example "${e.path}"`),
  ]
  if (derived.length === 0) return
  throw new CompareRefused(
    `${which} records derived element ids on ${derived.join(
      ', ',
    )}. A derived id follows the key, so a rename could not be told from a removal plus an addition, and no comparison would be trustworthy.`,
  )
}

function compareModelLevel(before: Ir, after: Ir, out: Difference[]): void {
  if (before.namespace.base !== after.namespace.base) {
    out.push({
      elementId: '',
      kind: 'namespace-changed',
      // Every term's IRI moves with the base, so every document now means
      // something else while continuing to parse.
      class: 'semantic',
      subject: 'namespace.base',
      message: `The namespace base changed from ${before.namespace.base} to ${after.namespace.base}. Every term's IRI moved with it: documents still parse and every one now asserts something different.`,
      before: before.namespace.base,
      after: after.namespace.base,
    })
  }
  if (before.namespace.prefix !== after.namespace.prefix) {
    out.push({
      elementId: '',
      kind: 'namespace-changed',
      class: 'compatible',
      subject: 'namespace.prefix',
      message: `The namespace prefix changed from "${before.namespace.prefix}" to "${after.namespace.prefix}". A prefix is a shorthand in the emitted context; no IRI moved.`,
      before: before.namespace.prefix,
      after: after.namespace.prefix,
    })
  }
  if (before.mode !== after.mode) {
    const toOlder = after.mode === '1.0'
    out.push({
      elementId: '',
      kind: 'mode-changed',
      class: toOlder ? 'breaking' : 'compatible',
      subject: 'mode',
      message: toOlder
        ? `The processing mode changed from ${before.mode} to ${after.mode}. A 1.0 processor reads 1.1-only facets differently rather than rejecting them, so what consumers get changes silently.`
        : `The processing mode changed from ${before.mode} to ${after.mode}, which only widens what the context may express.`,
      before: before.mode,
      after: after.mode,
    })
  }
  if ((before.vocab ?? null) !== (after.vocab ?? null)) {
    out.push({
      elementId: '',
      kind: 'vocab-changed',
      // `@vocab` decides what an unmapped key becomes. Changing it changes the
      // meaning of every document that has one.
      class: 'semantic',
      subject: 'vocab',
      message: `@vocab changed from ${before.vocab ?? 'unset'} to ${after.vocab ?? 'unset'}. Every unmapped key in every document now expands to a different IRI, or stops expanding.`,
      ...(before.vocab !== undefined ? { before: before.vocab } : {}),
      ...(after.vocab !== undefined ? { after: after.vocab } : {}),
    })
  }

  for (const name of new Set([...Object.keys(before.prefixes), ...Object.keys(after.prefixes)])) {
    const was = before.prefixes[name]
    const now = after.prefixes[name]
    if (was === now) continue
    if (was === undefined) {
      out.push({
        elementId: '',
        kind: 'prefix-changed',
        class: 'additive',
        subject: name,
        message: `The prefix "${name}" was added, mapping to ${now}.`,
        after: now!,
      })
      continue
    }
    if (now === undefined) {
      out.push({
        elementId: '',
        kind: 'prefix-changed',
        class: 'breaking',
        subject: name,
        message: `The prefix "${name}" was removed. A compact IRI written against it no longer resolves.`,
        before: was,
      })
      continue
    }
    out.push({
      elementId: '',
      kind: 'prefix-changed',
      class: 'semantic',
      subject: name,
      message: `The prefix "${name}" changed from ${was} to ${now}. Every compact IRI written against it now names a different IRI.`,
      before: was,
      after: now,
    })
  }
}

function compareTerms(before: Ir, after: Ir, out: Difference[]): void {
  const beforeById = new Map(before.terms.map((t) => [t.id, t]))
  const afterById = new Map(after.terms.map((t) => [t.id, t]))

  for (const [id, was] of beforeById) {
    const now = afterById.get(id)
    if (now === undefined) {
      // Removing a protected term is illegal: the protection was a promise to
      // every downstream context, and it is not the publisher's to withdraw.
      const isProtected = was['@protected'] === true
      out.push({
        elementId: id,
        kind: 'term-removed',
        class: isProtected ? 'illegal' : 'breaking',
        subject: was.key,
        message: isProtected
          ? `The term "${was.key}" was removed, and it was declared @protected. Protection is a promise to downstream contexts; withdrawing it is not a change a publisher may make.`
          : `The term "${was.key}" was removed. Documents using that key stop compacting the same way.`,
        before: was.key,
      })
      continue
    }
    compareTerm(was, now, out)
  }

  for (const [id, now] of afterById) {
    if (beforeById.has(id)) continue
    out.push({
      elementId: id,
      kind: 'term-added',
      class: 'additive',
      subject: now.key,
      message: `The term "${now.key}" was added, mapping to ${now.iri ?? 'nothing'}.`,
      after: now.key,
    })
  }
}

function compareTerm(was: IrTerm, now: IrTerm, out: Difference[]): void {
  if (was.key !== now.key) {
    out.push({
      elementId: was.id,
      kind: 'term-key-changed',
      class: 'breaking',
      subject: now.key,
      message: `The term's JSON key changed from "${was.key}" to "${now.key}". Consumers' documents stop compacting the same way, while the data asserts exactly what it did before.`,
      before: was.key,
      after: now.key,
    })
  }

  if (was.iri !== now.iri) {
    out.push({
      elementId: was.id,
      kind: 'term-iri-changed',
      class: 'semantic',
      subject: now.key,
      message: `The IRI of "${now.key}" changed from ${was.iri ?? 'nothing'} to ${now.iri ?? 'nothing'}. Every document still parses and every one now means something else.`,
      ...(was.iri !== null ? { before: was.iri } : {}),
      ...(now.iri !== null ? { after: now.iri } : {}),
    })
  }

  compareFacets(was, now, out)
}

function compareFacets(was: IrTerm, now: IrTerm, out: Difference[]): void {
  const push = (
    facet: string,
    cls: ChangeClass,
    message: string,
    ambiguous = false,
  ): void => {
    out.push({
      elementId: was.id,
      kind: 'term-facet-changed',
      class: cls,
      subject: `${now.key}.${facet}`,
      message,
      ...(ambiguous ? { ambiguous: true } : {}),
      ...(renderFacet(was, facet) !== undefined ? { before: renderFacet(was, facet)! } : {}),
      ...(renderFacet(now, facet) !== undefined ? { after: renderFacet(now, facet)! } : {}),
    })
  }

  // ---- @container ----------------------------------------------------------
  const wasContainers = normalizeContainers(was['@container'])
  const nowContainers = normalizeContainers(now['@container'])
  if (wasContainers.join(',') !== nowContainers.join(',')) {
    const onlyGainedSet =
      wasContainers.length === 0 && nowContainers.length === 1 && nowContainers[0] === '@set'
    if (onlyGainedSet) {
      // A document that already sent one value still compacts; a document that
      // sent an array already worked. Nothing a consumer wrote breaks.
      push(
        '@container',
        'compatible',
        `"${now.key}" gained @container: @set. Values are now always an array, which existing documents already satisfy and which lets the property become multi-valued without changing any document's shape.`,
      )
    } else if (wasContainers.length === 0) {
      push(
        '@container',
        'breaking',
        `"${now.key}" gained @container: ${nowContainers.join(', ')}. The JSON shape a document must use changed.`,
      )
    } else {
      push(
        '@container',
        'breaking',
        `The container of "${now.key}" changed from ${wasContainers.join(', ') || 'none'} to ${
          nowContainers.join(', ') || 'none'
        }. The JSON shape a document must use changed.`,
      )
    }
  }

  // ---- @type ---------------------------------------------------------------
  if ((was['@type'] ?? null) !== (now['@type'] ?? null)) {
    const gainedIdCoercion = now['@type'] === '@id' && was['@type'] == null
    push(
      '@type',
      'semantic',
      gainedIdCoercion
        ? `"${now.key}" gained @type: @id. Values that were literals become references — the data asserts something different without any document changing.`
        : `The type coercion of "${now.key}" changed from ${was['@type'] ?? 'none'} to ${
            now['@type'] ?? 'none'
          }. Values expand differently, so the data means something else.`,
    )
  }

  // ---- @protected ----------------------------------------------------------
  const wasProtected = was['@protected'] === true
  const nowProtected = now['@protected'] === true
  if (wasProtected !== nowProtected) {
    push(
      '@protected',
      wasProtected ? 'illegal' : 'compatible',
      wasProtected
        ? `"${now.key}" is no longer @protected. The protection was a promise to downstream contexts, and withdrawing it is not a change a publisher may make.`
        : `"${now.key}" became @protected, which only constrains what a later context may do.`,
    )
  }

  // ---- @language and @direction -------------------------------------------
  for (const facet of ['@language', '@direction'] as const) {
    if ((was[facet] ?? null) === (now[facet] ?? null)) continue
    push(
      facet,
      'semantic',
      `The ${facet} of "${now.key}" changed from ${String(was[facet] ?? 'none')} to ${String(
        now[facet] ?? 'none',
      )}. Values carry a different tag, so the data asserts something else.`,
    )
  }

  // ---- @reverse ------------------------------------------------------------
  if ((was['@reverse'] ?? null) !== (now['@reverse'] ?? null)) {
    push(
      '@reverse',
      'semantic',
      `"${now.key}" changed which way its edge points. Every document using it now asserts the relation in the other direction.`,
    )
  }

  // ---- @nest, @prefix, @index ---------------------------------------------
  if ((was['@nest'] ?? null) !== (now['@nest'] ?? null)) {
    push(
      '@nest',
      'breaking',
      `The nesting of "${now.key}" changed from ${was['@nest'] ?? 'none'} to ${
        now['@nest'] ?? 'none'
      }. Documents must place the key somewhere else.`,
    )
  }
  if ((was['@prefix'] ?? null) !== (now['@prefix'] ?? null)) {
    push(
      '@prefix',
      'compatible',
      `Whether "${now.key}" may be used as a compact-IRI prefix changed. No existing document changes meaning.`,
    )
  }
  if ((was['@index'] ?? null) !== (now['@index'] ?? null)) {
    push(
      '@index',
      'breaking',
      `The index property of "${now.key}" changed. Documents using the index map read differently.`,
    )
  }

  // ---- the scoped context and the escape hatch -----------------------------
  // Both can change what a document means in ways that are not decidable by
  // inspection, so an ambiguous direction classifies as `breaking`: a false
  // alarm costs a review and a false `additive` costs production data.
  if (JSON.stringify(was['@context'] ?? null) !== JSON.stringify(now['@context'] ?? null)) {
    push(
      '@context',
      'breaking',
      `The scoped context on "${now.key}" changed. A scoped context changes what keys mean below it, and whether that is compatible cannot be decided without the documents — classified as breaking because a false alarm costs a review and a false additive costs production data.`,
      true,
    )
  }
  if (JSON.stringify(was.raw ?? null) !== JSON.stringify(now.raw ?? null)) {
    push(
      'raw',
      'breaking',
      `The raw escape hatch on "${now.key}" changed. Its contents reach the emitted context unchanged, so this tool cannot say what it does — classified as breaking because the direction is ambiguous.`,
      true,
    )
  }
}

function normalizeContainers(value: ContainerValue[] | null | undefined): string[] {
  if (value === null || value === undefined) return []
  return [...value].sort()
}

function renderFacet(term: IrTerm, facet: string): string | undefined {
  if (facet === 'raw') {
    return term.raw === undefined ? undefined : JSON.stringify(term.raw)
  }
  const value = (term as unknown as Record<string, unknown>)[facet]
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Whether any difference is at or above `gate`. */
export function atOrAbove(differences: readonly Difference[], gate: ChangeClass): Difference[] {
  return differences.filter((d) => CLASS_ORDER[d.class] >= CLASS_ORDER[gate])
}

export function isChangeClass(value: string): value is ChangeClass {
  return (CHANGE_CLASSES as readonly string[]).includes(value)
}
