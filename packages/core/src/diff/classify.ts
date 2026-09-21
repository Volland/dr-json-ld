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
import { termContextValue } from '../emit/context-document.js'
import {
  termPath,
  type ContainerValue,
  type Ir,
  type IrField,
  type IrRange,
  type IrShape,
  type IrTerm,
} from '../model/ir.js'

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
    | 'term-scope-changed'
    | 'shape-added'
    | 'shape-removed'
    | 'shape-changed'
    | 'field-added'
    | 'field-removed'
    | 'field-changed'
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
  /**
   * What the comparison could not do, stated rather than hidden. Not a
   * difference and not gated on.
   */
  notes: string[]
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
  const notes: string[] = []

  compareModelLevel(before, after, differences)
  compareTerms(before, after, differences, notes)
  compareShapes(before, after, differences)

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

  return { differences, notes, ...(worst !== undefined ? { worst } : {}) }
}

function refuseDerivedIds(ir: Ir, which: string): void {
  const derived = [
    ...ir.terms.filter((t) => !t.idWritten).map((t) => `term "${termPath(ir, t)}"`),
    ...(ir.shapes ?? []).filter((s) => !s.idWritten).map((s) => `shape "${s.name}"`),
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

function compareTerms(before: Ir, after: Ir, out: Difference[], notes: string[]): void {
  const beforeById = new Map(before.terms.map((t) => [t.id, t]))
  const afterById = new Map(after.terms.map((t) => [t.id, t]))

  // A lockfile written before scoped terms existed holds a scoped context as a
  // single value. Its terms have no ids to match by, so the newer side's scoped
  // terms under such a parent are compared through the parent's whole value
  // rather than reported one by one as additions.
  const comparedWhole = new Set<string>()
  for (const [id, was] of beforeById) {
    const now = afterById.get(id)
    if (now !== undefined && isLegacyScopedMap(was) && now.scopedContext !== undefined) {
      comparedWhole.add(id)
    }
  }
  const underWhole = (ir: Ir, term: IrTerm): boolean => {
    for (let t: IrTerm | undefined = term; t?.scope !== undefined; ) {
      if (comparedWhole.has(t.scope.parent)) return true
      t = ir.terms.find((p) => p.id === t!.scope!.parent)
    }
    return false
  }

  for (const [id, was] of beforeById) {
    const now = afterById.get(id)
    const wasPath = termPath(before, was)
    if (now === undefined) {
      // Removing a protected term is illegal: the protection was a promise to
      // every downstream context, and it is not the publisher's to withdraw. A
      // scoped term is protected by its own flag or by its context's.
      const isProtected = was['@protected'] === true || protectedByContext(before, was)
      out.push({
        elementId: id,
        kind: 'term-removed',
        class: isProtected ? 'illegal' : 'breaking',
        subject: wasPath,
        message: isProtected
          ? `The term "${wasPath}" was removed, and it was declared @protected. Protection is a promise to downstream contexts; withdrawing it is not a change a publisher may make.`
          : `The term "${wasPath}" was removed. Documents using that key stop compacting the same way.`,
        before: was.key,
      })
      continue
    }
    compareTerm(before, after, was, now, out, comparedWhole.has(id), notes)
  }

  for (const [id, now] of afterById) {
    if (beforeById.has(id)) continue
    if (underWhole(after, now)) continue
    const path = termPath(after, now)
    out.push({
      elementId: id,
      kind: 'term-added',
      class: 'additive',
      subject: path,
      message: `The term "${path}" was added, mapping to ${now.iri ?? 'nothing'}.`,
      after: now.key,
    })
  }
}

/** A term whose `@context` is a map but which carries no scoped terms: an old lockfile. */
function isLegacyScopedMap(term: IrTerm): boolean {
  const value = term['@context']
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !term.scopedContext
}

/** Whether the scoped context holding this term is itself protected. */
function protectedByContext(ir: Ir, term: IrTerm): boolean {
  if (term.scope === undefined) return false
  const parent = ir.terms.find((t) => t.id === term.scope!.parent)
  return parent?.scopedContext?.settings['@protected'] === true
}

/** Where a term lives, for a message: the top level, or inside another term's context. */
function scopeName(ir: Ir, term: IrTerm): string {
  if (term.scope === undefined) return 'the top level'
  const parent = ir.terms.find((t) => t.id === term.scope!.parent)
  return parent ? `the scoped context of "${termPath(ir, parent)}"` : 'a scoped context'
}

function compareTerm(
  before: Ir,
  after: Ir,
  was: IrTerm,
  now: IrTerm,
  out: Difference[],
  compareWhole: boolean,
  notes: string[],
): void {
  const path = termPath(after, now)
  // A term whose element id moved from one context map to another applies to a
  // different set of documents, which is breaking in whichever direction it
  // moved: documents outside the new scope lose the definition, or documents
  // inside it gain one.
  if ((was.scope?.parent ?? null) !== (now.scope?.parent ?? null)) {
    const from = scopeName(before, was)
    const to = scopeName(after, now)
    out.push({
      elementId: was.id,
      kind: 'term-scope-changed',
      class: 'breaking',
      subject: path,
      message: `"${now.key}" moved from ${from} to ${to}. The set of documents in which the key has this meaning changed.`,
      before: from,
      after: to,
    })
  }

  if (compareWhole) {
    const wasValue = was['@context']
    const nowValue = termContextValue(now, after)
    notes.push(
      `The older version records the scoped context of "${path}" as a single value, from before scoped terms had element ids. It was compared as a whole value, and its scoped terms could not be matched individually.`,
    )
    if (JSON.stringify(sortDeep(wasValue)) !== JSON.stringify(sortDeep(nowValue))) {
      out.push({
        elementId: was.id,
        kind: 'term-facet-changed',
        class: 'breaking',
        ambiguous: true,
        subject: `${path}.@context`,
        message: `The scoped context on "${path}" changed. It was compared as a whole value, because the older version predates scoped terms; whether the change is compatible cannot be decided without the documents, so it is classified as breaking — a false alarm costs a review and a false additive costs production data.`,
        before: JSON.stringify(wasValue),
        after: JSON.stringify(nowValue),
      })
    }
    // The rest of this term is compared as usual; only its context was legacy.
    now = { ...now, scopedContext: undefined, '@context': wasValue }
  }

  if (was.key !== now.key) {
    out.push({
      elementId: was.id,
      kind: 'term-key-changed',
      class: 'breaking',
      subject: path,
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
      subject: path,
      message: `The IRI of "${path}" changed from ${was.iri ?? 'nothing'} to ${now.iri ?? 'nothing'}. Every document still parses and every one now means something else.`,
      ...(was.iri !== null ? { before: was.iri } : {}),
      ...(now.iri !== null ? { after: now.iri } : {}),
    })
  }

  compareFacets(was, now, out, path)
}

function compareFacets(was: IrTerm, now: IrTerm, out: Difference[], path: string): void {
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
      subject: `${path}.${facet}`,
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
  // alarm costs a review and a false `additive` costs production data. A map
  // context's terms are compared as terms, by id; what is compared here is
  // whether it is a map at all, or which reference, and its settings.
  if (JSON.stringify(contextShape(was)) !== JSON.stringify(contextShape(now))) {
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

/**
 * Shapes are matched by element id, and fields by the element id of the term
 * each resolves to. A difference is classified by what it does to documents
 * that conformed to the older version: tightening can reject one, loosening
 * cannot.
 */
function compareShapes(before: Ir, after: Ir, out: Difference[]): void {
  const beforeShapes = before.shapes ?? []
  const afterShapes = after.shapes ?? []
  const beforeById = new Map(beforeShapes.map((s) => [s.id, s]))
  const afterById = new Map(afterShapes.map((s) => [s.id, s]))

  for (const [id, was] of beforeById) {
    const now = afterById.get(id)
    if (now === undefined) {
      out.push({
        elementId: id,
        kind: 'shape-removed',
        class: 'compatible',
        subject: was.name,
        message: `The shape "${was.name}" was removed. Every document that conformed still does; nothing checks it any more.`,
        before: was.name,
      })
      continue
    }
    compareShape(was, now, out)
  }

  // A class the older version already declared had documents nobody
  // constrained; a shape arriving for it can reject some of them.
  const knownClasses = new Set<string>()
  for (const term of before.terms) if (term.iri !== null) knownClasses.add(term.iri)
  for (const shape of beforeShapes) if (shape.targetIri !== null) knownClasses.add(shape.targetIri)

  for (const [id, now] of afterById) {
    if (beforeById.has(id)) continue
    const existing = now.targetIri !== null && knownClasses.has(now.targetIri)
    out.push({
      elementId: id,
      kind: 'shape-added',
      class: existing ? 'breaking' : 'additive',
      subject: now.name,
      message: existing
        ? `The shape "${now.name}" was added for ${now.target}, a class the older version already declared. Documents of that class were unconstrained before, and some may no longer conform.`
        : `The shape "${now.name}" was added${now.target !== undefined ? ` for the new class ${now.target}` : ''}.`,
      after: now.name,
    })
  }
}

function compareShape(was: IrShape, now: IrShape, out: Difference[]): void {
  const push = (
    kind: Difference['kind'],
    subject: string,
    cls: ChangeClass,
    message: string,
    extra: Partial<Difference> = {},
  ): void => {
    out.push({ elementId: was.id, kind, class: cls, subject, message, ...extra })
  }

  if (was.name !== now.name) {
    push(
      'shape-changed',
      now.name,
      'compatible',
      `The shape "${was.name}" was renamed to "${now.name}". No document changes; the node shape's IRI in the \`shacl\` artifact moves with the name.`,
      { before: was.name, after: now.name },
    )
  }
  if ((was.targetIri ?? null) !== (now.targetIri ?? null)) {
    push(
      'shape-changed',
      `${now.name}.targetClass`,
      'breaking',
      `The shape "${now.name}" now applies to ${now.target ?? 'no class'} instead of ${was.target ?? 'no class'}. A different set of documents is checked.`,
      { ambiguous: true, before: was.target ?? '', after: now.target ?? '' },
    )
  }
  if (was.closed !== now.closed) {
    push(
      'shape-changed',
      `${now.name}.closed`,
      now.closed ? 'breaking' : 'compatible',
      now.closed
        ? `The shape "${now.name}" became closed. A document carrying a property no field names no longer conforms.`
        : `The shape "${now.name}" became open. Every document that conformed still does.`,
    )
  }

  const identity = (f: IrField) => f.termId ?? `key:${f.key}`
  const wasFields = new Map(was.fields.map((f) => [identity(f), f]))
  const nowFields = new Map(now.fields.map((f) => [identity(f), f]))

  for (const [key, field] of wasFields) {
    if (nowFields.has(key)) continue
    // On a closed shape a field is also a permission; removing it forbids the key.
    push(
      'field-removed',
      `${now.name}.${field.key}`,
      now.closed ? 'breaking' : 'compatible',
      now.closed
        ? `The field "${field.key}" was removed from the closed shape "${now.name}". Documents carrying it no longer conform.`
        : `The field "${field.key}" was removed from "${now.name}". Every document that conformed still does.`,
    )
  }
  for (const [key, field] of nowFields) {
    if (wasFields.has(key)) continue
    const constrains =
      (field.min ?? 0) > 0 || field.max !== undefined || field.range !== undefined
    const tightens = constrains && !was.closed
    push(
      'field-added',
      `${now.name}.${field.key}`,
      tightens ? 'breaking' : 'compatible',
      tightens
        ? `The field "${field.key}" was added to "${now.name}" with constraints. Documents that carried "${field.key}" freely, or not at all, may no longer conform.`
        : `The field "${field.key}" was added to "${now.name}" without narrowing what conformed.`,
    )
  }

  for (const [key, was_] of wasFields) {
    const now_ = nowFields.get(key)
    if (now_ === undefined) continue
    compareField(now.name, was_, now_, push)
  }
}

function compareField(
  shape: string,
  was: IrField,
  now: IrField,
  push: (
    kind: Difference['kind'],
    subject: string,
    cls: ChangeClass,
    message: string,
    extra?: Partial<Difference>,
  ) => void,
): void {
  const subject = `${shape}.${now.key}`
  const wasMin = was.min ?? 0
  const nowMin = now.min ?? 0
  if (wasMin !== nowMin) {
    const tighter = nowMin > wasMin
    push(
      'field-changed',
      `${subject}.min`,
      tighter ? 'breaking' : 'compatible',
      tighter
        ? `"${now.key}" in "${shape}" now needs at least ${nowMin} value(s), up from ${wasMin}. Documents that conformed may no longer.`
        : `"${now.key}" in "${shape}" now needs at least ${nowMin} value(s), down from ${wasMin}.`,
      { before: String(wasMin), after: String(nowMin) },
    )
  }
  if (was.max !== now.max) {
    const tighter =
      now.max !== undefined && (was.max === undefined || now.max < was.max)
    push(
      'field-changed',
      `${subject}.max`,
      tighter ? 'breaking' : 'compatible',
      tighter
        ? `"${now.key}" in "${shape}" now allows at most ${now.max} value(s), down from ${was.max ?? 'no limit'}. Documents that conformed may no longer.`
        : `"${now.key}" in "${shape}" now allows ${now.max ?? 'any number of'} value(s), up from ${was.max}.`,
      {
        ...(was.max !== undefined ? { before: String(was.max) } : {}),
        ...(now.max !== undefined ? { after: String(now.max) } : {}),
      },
    )
  }
  const direction = rangeDirection(was.range, now.range)
  if (direction !== 'same') {
    const before = describeRange(was.range)
    const after = describeRange(now.range)
    push(
      'field-changed',
      `${subject}.range`,
      direction === 'wider' ? 'compatible' : 'breaking',
      direction === 'wider'
        ? `The range of "${now.key}" in "${shape}" widened from ${before} to ${after}. Every document that conformed still does.`
        : direction === 'narrower'
          ? `The range of "${now.key}" in "${shape}" narrowed from ${before} to ${after}. Documents that conformed may no longer.`
          : `The range of "${now.key}" in "${shape}" changed from ${before} to ${after}, which is neither narrower nor wider. Classified as breaking because the direction is ambiguous.`,
      { before, after, ...(direction === 'unrelated' ? { ambiguous: true } : {}) },
    )
  }
}

/**
 * How a range moved. `node` admits every IRI, class and shape range; `literal`
 * admits every datatype and `langString`; no range admits everything. Anything
 * else that changed is unrelated.
 */
function rangeDirection(
  was: IrRange | undefined,
  now: IrRange | undefined,
): 'same' | 'wider' | 'narrower' | 'unrelated' {
  const key = (r: IrRange | undefined) => (r === undefined ? 'any' : JSON.stringify(rangeIdentity(r)))
  if (key(was) === key(now)) return 'same'
  if (now === undefined) return 'wider'
  if (was === undefined) return 'narrower'
  if (admits(now, was)) return 'wider'
  if (admits(was, now)) return 'narrower'
  return 'unrelated'
}

function rangeIdentity(range: IrRange): unknown {
  switch (range.kind) {
    case 'datatype':
      return { kind: range.kind, iri: range.iri }
    case 'class':
      return { kind: range.kind, iri: range.iri }
    case 'shape':
      return { kind: range.kind, shapeId: range.shapeId }
    default:
      return { kind: range.kind }
  }
}

/** Whether every value `inner` admits is also admitted by `outer`. */
function admits(outer: IrRange, inner: IrRange): boolean {
  if (outer.kind === 'node') return ['iri', 'class', 'shape'].includes(inner.kind)
  if (outer.kind === 'literal') return ['datatype', 'langString'].includes(inner.kind)
  return false
}

function describeRange(range: IrRange | undefined): string {
  if (range === undefined) return 'any value'
  switch (range.kind) {
    case 'datatype':
      return range.datatype
    case 'class':
      return `{ class: ${range.class} }`
    case 'shape':
      return `{ shape: ${range.shape} }`
    default:
      return range.kind
  }
}

function contextShape(term: IrTerm): unknown {
  if (term.scopedContext !== undefined) return { map: sortDeep(term.scopedContext.settings) }
  return term['@context'] ?? null
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortDeep((value as Record<string, unknown>)[key])
  }
  return out
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
