/**
 * Compaction — JSON-LD 1.1 section 5.2, and the inverse context that drives it.
 *
 * Compaction does not produce a unique shape: whether a single-valued property
 * appears as a value or a one-element array depends on the data and on the
 * context. That is recorded here so a later JSON Schema target is not attempted
 * without a frame to pin the shape first.
 *
 * @lat: [[processing#Processing#Compaction]]
 */
import { isAbsoluteIri, isKeyword } from '../iri/iri.js'
import { expandIri, processContext } from './active-context.js'
import { isGraphObject, isListObject, isValueObject } from './expand.js'
import type { ActiveContext, TermDefinition } from './types.js'

/**
 * The inverse context: IRI to container to type/language to term. Built once
 * per compaction and consulted by term selection.
 */
export interface InverseContext {
  [iri: string]: {
    [container: string]: {
      '@language'?: Record<string, string>
      '@type'?: Record<string, string>
      '@any'?: Record<string, string>
    }
  }
}

const DEFAULT_CONTAINERS = ['@index', '@index@set', '@language', '@language@set', '@none']

export function buildInverseContext(active: ActiveContext): InverseContext {
  const inverse: InverseContext = {}
  const defaultLanguage = (active.defaultLanguage ?? '@none').toLowerCase()

  // Terms are considered shortest first, then lexicographically, so the term a
  // reader would have chosen wins deterministically.
  const terms = [...active.terms.entries()].sort(([a], [b]) =>
    a.length !== b.length ? a.length - b.length : a.localeCompare(b),
  )

  for (const [term, definition] of terms) {
    if (!definition.iri) continue
    const container =
      definition.container.length > 0 ? [...definition.container].sort().join('') : '@none'
    const entry = (inverse[definition.iri] ??= {})
    const containerEntry = (entry[container] ??= {})
    const any = (containerEntry['@any'] ??= {})
    const languages = (containerEntry['@language'] ??= {})
    const types = (containerEntry['@type'] ??= {})

    any['@none'] ??= term

    if (definition.reverse) {
      types['@reverse'] ??= term
      continue
    }
    if (definition.typeMapping === '@none') {
      languages['@any'] ??= term
      types['@any'] ??= term
      continue
    }
    if (definition.typeMapping !== undefined) {
      types[definition.typeMapping] ??= term
      continue
    }
    if (definition.hasLanguageMapping && definition.hasDirectionMapping) {
      const key =
        definition.languageMapping !== null && definition.directionMapping !== null
          ? `${definition.languageMapping ?? ''}_${definition.directionMapping ?? ''}`.toLowerCase()
          : definition.languageMapping === null && definition.directionMapping === null
            ? '@null'
            : `${definition.languageMapping ?? '@none'}_${definition.directionMapping ?? '@none'}`.toLowerCase()
      languages[key] ??= term
      continue
    }
    if (definition.hasLanguageMapping) {
      languages[(definition.languageMapping ?? '@null').toLowerCase()] ??= term
      continue
    }
    if (definition.hasDirectionMapping) {
      languages[
        definition.directionMapping === null ? '@none' : `_${definition.directionMapping}`
      ] ??= term
      continue
    }
    languages[defaultLanguage] ??= term
    languages['@none'] ??= term
    types['@none'] ??= term
  }

  return inverse
}

export interface CompactOptions {
  compactArrays?: boolean
  compactToRelative?: boolean
  ordered?: boolean
}

/** Compact an expanded document against an active context. */
export function compact(
  expanded: unknown,
  active: ActiveContext,
  options: CompactOptions = {},
): unknown {
  const inverse = buildInverseContext(active)
  const compactArrays = options.compactArrays ?? true
  const state = { active, inverse, compactArrays, ordered: options.ordered ?? false }
  const result = compactElement(state, null, expanded)
  if (!Array.isArray(result)) return result
  // The API step after the algorithm: an array result becomes a map with a
  // single `@graph` entry, so a compacted document is always a JSON object.
  if (result.length === 0) return {}
  return { [compactIri(state, '@graph', { vocab: true })]: result }
}

interface CompactState {
  active: ActiveContext
  inverse: InverseContext
  compactArrays: boolean
  ordered: boolean
}

function compactElement(
  state: CompactState,
  activeProperty: string | null,
  element: unknown,
): unknown {
  if (Array.isArray(element)) {
    const out: unknown[] = []
    for (const item of element) {
      const compacted = compactElement(state, activeProperty, item)
      if (compacted !== null && compacted !== undefined) out.push(compacted)
    }
    // Section 4.1 step 2.3: a single-element array collapses when the active
    // property has no @list or @set container. At the document root there is no
    // active property and so no container, which is why `null` unwraps too.
    if (state.compactArrays && out.length === 1 && !mustBeArray(state, activeProperty)) {
      return out[0]
    }
    return out
  }

  if (element === null || typeof element !== 'object') return element

  const object = element as Record<string, unknown>
  const definition = activeProperty ? termDefinitionFor(state, activeProperty) : undefined

  // A property-scoped context applies while compacting the value.
  let active = state.active
  if (definition?.localContext !== undefined) {
    // Compaction re-enters with the scoped context so the term chosen inside is
    // the one a reader of the compacted document would write.
    active = scopedContext(state, definition)
  }
  const scopedState = active === state.active ? state : { ...state, active, inverse: buildInverseContext(active) }

  if (isValueObject(object) || '@id' in object) {
    const compacted = compactValue(scopedState, activeProperty, object)
    if (compacted !== undefined) return compacted
  }

  if (isListObject(object)) {
    const container = definition?.container ?? []
    const list = compactElement(scopedState, activeProperty, object['@list'])
    if (container.includes('@list')) return list
    const key = compactIri(scopedState, '@list', { vocab: true })
    // `@list` is an array by definition; collapsing a one-member list would
    // turn an ordered sequence into a single value.
    const out: Record<string, unknown> = { [key]: Array.isArray(list) ? list : [list] }
    if ('@index' in object) {
      out[compactIri(scopedState, '@index', { vocab: true })] = object['@index']
    }
    return out
  }

  return compactNode(scopedState, activeProperty, object)
}

function compactNode(
  state: CompactState,
  activeProperty: string | null,
  object: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const keys = state.ordered ? Object.keys(object).sort() : Object.keys(object)

  // A type-scoped context takes effect before anything else is compacted, the
  // same way it does on expansion.
  let active = state.active
  const types = toArray(object['@type']).filter((t): t is string => typeof t === 'string')
  for (const type of [...types].sort()) {
    const compactedType = compactIri(state, type, { vocab: true })
    const definition = active.terms.get(compactedType)
    if (definition?.localContext !== undefined) {
      active = scopedContext(state, definition)
    }
  }
  const scoped =
    active === state.active ? state : { ...state, active, inverse: buildInverseContext(active) }

  for (const key of keys) {
    const value = object[key]

    if (key === '@id') {
      const compacted = compactIri(scoped, value as string, { vocab: false })
      result[compactIri(scoped, '@id', { vocab: true })] = compacted
      continue
    }

    if (key === '@type') {
      const compactedTypes = toArray(value).map((t) =>
        compactIri(scoped, t as string, { vocab: true }),
      )
      const alias = compactIri(scoped, '@type', { vocab: true })
      const definition = scoped.active.terms.get(alias)
      const asArray = definition?.container.includes('@set') === true
      result[alias] =
        compactedTypes.length === 1 && scoped.compactArrays && !asArray
          ? compactedTypes[0]
          : compactedTypes
      continue
    }

    if (key === '@reverse') {
      const remaining: Record<string, unknown> = {}
      for (const [property, rawItems] of Object.entries(value as Record<string, unknown>)) {
        for (const item of toArray(rawItems)) {
          // Selecting with `reverse: true` is what finds a term declared with
          // `@reverse`; without it the property stays inside the `@reverse` map
          // and the idiomatic form is never produced.
          const term = compactIri(scoped, property, {
            vocab: true,
            value: item,
            reverse: true,
          })
          const definition = scoped.active.terms.get(term)
          const compacted = compactElement(scoped, term, item)
          if (definition?.reverse) {
            const asArray = definition.container.includes('@set') || !scoped.compactArrays
            addCompacted(result, term, compacted, asArray)
          } else {
            addCompacted(remaining, term, compacted, !scoped.compactArrays)
          }
        }
      }
      if (Object.keys(remaining).length > 0) {
        result[compactIri(scoped, '@reverse', { vocab: true })] = remaining
      }
      continue
    }

    if (key === '@index') {
      const definition = activeProperty ? termDefinitionFor(scoped, activeProperty) : undefined
      if (definition?.container.includes('@index')) continue
      result[compactIri(scoped, '@index', { vocab: true })] = value
      continue
    }

    if (key === '@graph' || key === '@included') {
      const compacted = compactElement(scoped, key, value)
      result[compactIri(scoped, key, { vocab: true })] = compacted
      continue
    }

    if (isKeyword(key)) {
      result[compactIri(scoped, key, { vocab: true })] = value
      continue
    }

    const items = toArray(value)
    if (items.length === 0) {
      // An empty array still names the property, so its absence is not implied.
      const term = compactIri(scoped, key, { vocab: true, value: [], reverse: false })
      addCompacted(result, term, [], true)
      continue
    }

    for (const item of items) {
      const term = compactIri(scoped, key, { vocab: true, value: item, reverse: false })
      const definition = scoped.active.terms.get(term)
      const container = definition?.container ?? []

      // A language map is reconstructed from the language-tagged values.
      if (container.includes('@language') && isValueObject(item)) {
        const entry = item as Record<string, unknown>
        const language = (entry['@language'] as string | undefined) ?? '@none'
        const map = (result[term] ??= {}) as Record<string, unknown>
        addCompacted(map, language, entry['@value'], container.includes('@set'))
        continue
      }

      // An index, id or type map is reconstructed the same way.
      const mapKind = container.includes('@index')
        ? '@index'
        : container.includes('@id')
          ? '@id'
          : container.includes('@type')
            ? '@type'
            : undefined
      if (mapKind && !container.includes('@graph') && item !== null && typeof item === 'object') {
        const entry = { ...(item as Record<string, unknown>) }
        let mapKey: string | undefined
        if (mapKind === '@index') {
          mapKey = entry['@index'] as string | undefined
          delete entry['@index']
        } else if (mapKind === '@id') {
          const id = entry['@id'] as string | undefined
          mapKey = id === undefined ? undefined : compactIri(scoped, id, { vocab: false })
          delete entry['@id']
        } else {
          const entryTypes = toArray(entry['@type']) as string[]
          const first = entryTypes[0]
          mapKey = first === undefined ? undefined : compactIri(scoped, first, { vocab: true })
          if (entryTypes.length > 1) entry['@type'] = entryTypes.slice(1)
          else delete entry['@type']
        }
        const map = (result[term] ??= {}) as Record<string, unknown>
        const compacted = compactElement(scoped, term, entry)
        addCompacted(map, mapKey ?? '@none', compacted, container.includes('@set'))
        continue
      }

      // Graph containers. `@graph` alone unwraps a simple graph; combined with
      // `@id` or `@index` it builds a map keyed by the graph's own identifier,
      // which is the form the container exists to produce.
      if (container.includes('@graph') && isGraphObject(item)) {
        const graph = item as Record<string, unknown>
        const withId = container.includes('@id')
        const withIndex = container.includes('@index')
        const inner = compactElement(scoped, term, graph['@graph'])

        if (withId || withIndex) {
          const raw = withId ? graph['@id'] : graph['@index']
          const mapKey =
            typeof raw === 'string'
              ? withId
                ? compactIri(scoped, raw, { vocab: false })
                : raw
              : compactIri(scoped, '@none', { vocab: true })
          const map = (result[term] ??= {}) as Record<string, unknown>
          addCompacted(map, mapKey, inner, container.includes('@set'))
          continue
        }

        // A named graph, or one carrying an index, cannot go into a bare
        // `@graph` term without losing the name, so it keeps its wrapper.
        if ('@id' in graph || '@index' in graph) {
          const compacted = compactElement(scoped, term, item)
          addCompacted(result, term, compacted, container.includes('@set') || !scoped.compactArrays)
          continue
        }

        addCompacted(result, term, inner, container.includes('@set') || !scoped.compactArrays)
        continue
      }

      const compacted = compactElement(scoped, term, item)
      // Several values under one property may select several different terms,
      // so array-ness is a property of the chosen term, never of how many
      // values the source property happened to carry.
      const asArray =
        !container.includes('@list') && (container.includes('@set') || !scoped.compactArrays)
      addCompacted(result, term, compacted, asArray)
    }
  }

  return result
}

/** Value Compaction — JSON-LD 1.1 section 5.2.6. */
function compactValue(
  state: CompactState,
  activeProperty: string | null,
  value: Record<string, unknown>,
): unknown {
  const definition = activeProperty ? termDefinitionFor(state, activeProperty) : undefined
  const keys = Object.keys(value)

  if (isValueObject(value)) {
    const hasIndex = '@index' in value
    const indexIsHandled = definition?.container.includes('@index') === true
    const remaining = keys.filter((k) => k !== '@index' || !indexIsHandled)

    if (definition?.typeMapping !== undefined && value['@type'] === definition.typeMapping) {
      if (remaining.every((k) => k === '@value' || k === '@type' || k === '@index')) {
        return hasIndex && !indexIsHandled
          ? { [compactIri(state, '@value', { vocab: true })]: value['@value'], [compactIri(state, '@index', { vocab: true })]: value['@index'] }
          : value['@value']
      }
    }
    const raw = value['@value']
    if (
      typeof raw !== 'string' &&
      !('@type' in value) &&
      !('@language' in value) &&
      !('@direction' in value) &&
      definition?.typeMapping === undefined &&
      (!hasIndex || indexIsHandled)
    ) {
      // A default `@language` applies to strings only.
      return raw
    }

    if (definition?.typeMapping === '@none' || definition?.typeMapping === undefined) {
      const language = value['@language']
      const direction = value['@direction']
      const termLanguage = definition?.hasLanguageMapping
        ? definition.languageMapping
        : state.active.defaultLanguage
      const termDirection = definition?.hasDirectionMapping
        ? definition.directionMapping
        : state.active.defaultDirection
      const languageMatches =
        (language ?? null) === (termLanguage ?? null) ||
        (language === undefined && (termLanguage ?? null) === null)
      const directionMatches =
        (direction ?? null) === (termDirection ?? null) ||
        (direction === undefined && (termDirection ?? null) === null)
      if (
        languageMatches &&
        directionMatches &&
        !('@type' in value) &&
        remaining.every((k) => k === '@value' || k === '@language' || k === '@direction' || k === '@index')
      ) {
        if (hasIndex && !indexIsHandled) {
          return {
            [compactIri(state, '@value', { vocab: true })]: value['@value'],
            [compactIri(state, '@index', { vocab: true })]: value['@index'],
          }
        }
        return value['@value']
      }
    }
    // Not compactable to a scalar: keep the value object with its keys aliased.
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      if (key === '@index' && indexIsHandled) continue
      const alias = compactIri(state, key, { vocab: true })
      out[alias] =
        key === '@type' ? compactIri(state, value[key] as string, { vocab: true }) : value[key]
    }
    return out
  }

  // A node reference: `{"@id": ...}` alone compacts to the IRI when the term
  // coerces to `@id`.
  if (keys.length === 1 && keys[0] === '@id') {
    const id = value['@id'] as string
    if (definition?.typeMapping === '@id') return compactIri(state, id, { vocab: false })
    if (definition?.typeMapping === '@vocab') return compactIri(state, id, { vocab: true })
  }

  return undefined
}

export interface CompactIriOptions {
  vocab?: boolean
  value?: unknown
  reverse?: boolean
}

/**
 * IRI Compaction — JSON-LD 1.1 section 5.2.4. Term selection is what makes the
 * emitted document idiomatic rather than merely correct.
 */
export function compactIri(
  state: CompactState,
  iri: string | null,
  options: CompactIriOptions = {},
): string {
  if (iri === null) return iri as unknown as string
  const { active, inverse } = state

  if (options.vocab && inverse[iri]) {
    const term = selectTerm(state, iri, options)
    if (term) return term
  }

  if (options.vocab && active.vocab !== undefined && iri.startsWith(active.vocab)) {
    const suffix = iri.slice(active.vocab.length)
    if (suffix !== '' && !active.terms.has(suffix)) return suffix
  }

  // A compact IRI, choosing the shortest candidate so the result reads well.
  let candidate: string | undefined
  for (const [term, definition] of active.terms) {
    // `@prefix` governs whether a term may be *expanded* as a prefix. Compaction
    // may use any colon-free term whose IRI is a proper prefix, which is how
    // `title:/value` is produced for a term mapped to `.../article/title`.
    if (!definition.iri || term.includes(':')) continue
    if (iri === definition.iri || !iri.startsWith(definition.iri)) continue
    const suffix = iri.slice(definition.iri.length)
    const compacted = `${term}:${suffix}`
    // A candidate that is already a defined term is only safe when that
    // definition is a plain IRI mapping. `ex:contains` may expand to the right
    // IRI and still carry a coercion that does not apply to this value, in
    // which case emitting it would change what the document says.
    const existing = active.terms.get(compacted)
    if (existing && existing.iri !== iri) continue
    // In a property position a coercing term has already been considered and
    // rejected by term selection, so reaching for it here would change what the
    // document says. In an `@id` position there is no coercion to get wrong.
    if (existing && options.vocab && isCoercing(existing)) continue
    if (
      candidate === undefined ||
      compacted.length < candidate.length ||
      (compacted.length === candidate.length && compacted < candidate)
    ) {
      candidate = compacted
    }
  }
  if (candidate) return candidate

  if (!options.vocab && active.baseIri !== undefined) {
    const relative = relativizeIri(active.baseIri, iri)
    if (relative !== undefined) return relative
  }

  return iri
}

/** Whether a term definition does more than map a key to an IRI. */
function isCoercing(definition: TermDefinition): boolean {
  return (
    definition.typeMapping !== undefined ||
    definition.hasLanguageMapping ||
    definition.hasDirectionMapping ||
    definition.container.length > 0 ||
    definition.reverse
  )
}

function selectTerm(
  state: CompactState,
  iri: string,
  options: CompactIriOptions,
): string | undefined {
  const { inverse, active } = state
  const entry = inverse[iri]
  if (!entry) return undefined

  const value = options.value
  const containers: string[] = []
  let typeLanguage: '@type' | '@language' = '@language'
  let typeLanguageValue = '@null'

  if (value !== undefined && value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if ('@index' in object && !isGraphObject(object)) {
      containers.push('@index', '@index@set')
    }
    if (options.reverse) {
      typeLanguage = '@type'
      typeLanguageValue = '@reverse'
      containers.push('@set')
    } else if (isListObject(object)) {
      if (!('@index' in object)) containers.push('@list')
      const list = object['@list'] as unknown[]
      if (list.length === 0) {
        typeLanguage = '@any'as never
        typeLanguageValue = '@none'
      } else {
        const common = commonTypeOrLanguage(list)
        typeLanguage = common.kind
        typeLanguageValue = common.value
      }
    } else if (isGraphObject(object)) {
      if ('@index' in object) containers.push('@graph@index', '@graph@index@set')
      if ('@id' in object) containers.push('@graph@id', '@graph@id@set')
      containers.push('@graph', '@graph@set', '@set')
      if (!('@index' in object)) containers.push('@graph@index', '@graph@index@set')
      if (!('@id' in object)) containers.push('@graph@id', '@graph@id@set')
      containers.push('@index', '@index@set')
    } else {
      if (isValueObject(object)) {
        const indexed = '@index' in object
        if ('@direction' in object && !indexed) {
          typeLanguageValue = `${(object['@language'] as string) ?? ''}_${object['@direction'] as string}`.toLowerCase()
          containers.push('@language', '@language@set')
        } else if ('@language' in object && !indexed) {
          typeLanguageValue = (object['@language'] as string).toLowerCase()
          containers.push('@language', '@language@set')
        } else if ('@type' in object) {
          typeLanguage = '@type'
          typeLanguageValue = object['@type'] as string
        } else {
          // An indexed language-tagged string is not a language-map member: a
          // language map has nowhere to put the index.
          typeLanguageValue = '@null'
        }
      } else {
        typeLanguage = '@type'
        typeLanguageValue = '@id'
        containers.push('@id', '@id@set', '@type', '@set@type')
      }
    }
  }
  // Section 4.6.3 steps 2.11 and 2.12: `@set` is always a candidate, then
  // `@none`. Leaving `@set` out is why a `@container: @set` term would lose to
  // the bare IRI and stop being selected at all.
  containers.push('@set', '@none')

  const preferred: string[] = [typeLanguageValue]
  if (typeLanguage === '@type' && typeLanguageValue === '@id') {
    // `@type: @vocab` is the better reading only when the reference is itself a
    // term; otherwise it would emit a bare string that re-expands against
    // `@vocab` into a different IRI.
    const reference = (value as Record<string, unknown>)['@id']
    const asTerm = typeof reference === 'string' ? compactIri(state, reference, { vocab: true }) : ''
    const definition = active.terms.get(asTerm)
    preferred.length = 0
    if (definition && definition.iri === reference) preferred.push('@vocab', '@id')
    else preferred.push('@id', '@vocab')
  }
  preferred.push('@none', '@any')

  for (const container of [...containers, ...DEFAULT_CONTAINERS]) {
    const containerEntry = entry[container]
    if (!containerEntry) continue
    const byKind = containerEntry[typeLanguage] ?? containerEntry['@any']
    if (!byKind) continue
    for (const key of preferred) {
      const term = byKind[key]
      if (term !== undefined && (!options.reverse || active.terms.get(term)?.reverse)) return term
    }
  }
  return undefined
}

function commonTypeOrLanguage(list: unknown[]): {
  kind: '@type' | '@language'
  value: string
} {
  let common: string | undefined
  let kind: '@type' | '@language' = '@language'
  for (const item of list) {
    let itemValue = '@none'
    let itemKind: '@type' | '@language' = '@language'
    if (item !== null && typeof item === 'object') {
      const object = item as Record<string, unknown>
      if (isValueObject(object)) {
        if ('@language' in object) itemValue = (object['@language'] as string).toLowerCase()
        else if ('@type' in object) {
          itemKind = '@type'
          itemValue = object['@type'] as string
        } else itemValue = '@null'
      } else {
        itemKind = '@type'
        itemValue = '@id'
      }
    }
    if (common === undefined) {
      common = itemValue
      kind = itemKind
    } else if (common !== itemValue || kind !== itemKind) {
      return { kind: '@language', value: '@none' }
    }
  }
  return { kind, value: common ?? '@none' }
}

/**
 * Turn an absolute IRI into a reference relative to `base`, per RFC 3986
 * section 5.3 read backwards. Returns `undefined` when no relative form is
 * shorter or safer than the absolute one.
 */
function relativizeIri(base: string, iri: string): string | undefined {
  const b = split(base)
  const t = split(iri)
  if (!b || !t) return undefined
  if (b.scheme !== t.scheme || b.authority !== t.authority) return undefined

  if (b.path === t.path) {
    if (t.query !== undefined) return `?${t.query}${t.fragment !== undefined ? `#${t.fragment}` : ''}`
    if (t.fragment !== undefined) return `#${t.fragment}`
    // The last segment of the path, which reads better than an empty reference.
    const last = t.path.slice(t.path.lastIndexOf('/') + 1)
    return last === '' ? undefined : withSuffix(last, t)
  }

  const baseSegments = b.path.split('/').slice(0, -1)
  const targetSegments = t.path.split('/')
  const targetLast = targetSegments.pop() ?? ''

  let common = 0
  while (
    common < baseSegments.length &&
    common < targetSegments.length &&
    baseSegments[common] === targetSegments[common]
  ) {
    common++
  }
  // Nothing in common past the leading empty segment: the absolute form wins.
  if (common === 0) return undefined

  const up = baseSegments.length - common
  const down = targetSegments.slice(common)
  const parts = [...Array<string>(up).fill('..'), ...down, targetLast]
  const relative = parts.join('/')
  if (relative === '') return undefined
  // A first segment containing a colon would be read as a scheme.
  const first = parts[0] ?? ''
  if (first.includes(':')) return undefined
  return withSuffix(relative, t)
}

function withSuffix(path: string, t: { query?: string; fragment?: string }): string {
  return `${path}${t.query !== undefined ? `?${t.query}` : ''}${
    t.fragment !== undefined ? `#${t.fragment}` : ''
  }`
}

function split(
  iri: string,
): { scheme: string; authority: string; path: string; query?: string; fragment?: string } | undefined {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(iri)
  if (!match) return undefined
  return {
    scheme: match[1]!,
    authority: match[2]!,
    path: match[3] ?? '',
    ...(match[4] !== undefined ? { query: match[4] } : {}),
    ...(match[5] !== undefined ? { fragment: match[5] } : {}),
  }
}

function mustBeArray(state: CompactState, activeProperty: string | null): boolean {
  if (activeProperty === null) return false
  const definition = termDefinitionFor(state, activeProperty)
  if (!definition) return activeProperty === '@graph' || activeProperty === '@included'
  return definition.container.includes('@set') || definition.container.includes('@list')
}

function termDefinitionFor(state: CompactState, term: string): TermDefinition | undefined {
  return state.active.terms.get(term)
}

function scopedContext(state: CompactState, definition: TermDefinition): ActiveContext {
  // Compaction reuses the expansion's context processor, so a scoped context
  // cannot mean one thing going out and another coming back.
  return processContext(definition.baseContext ?? state.active, definition.localContext, {
    overrideProtected: true,
  })
}

function addCompacted(
  object: Record<string, unknown>,
  key: string,
  value: unknown,
  asArray: boolean,
): void {
  const existing = object[key]
  if (existing === undefined) {
    object[key] = asArray && !Array.isArray(value) ? [value] : value
    return
  }
  const list = Array.isArray(existing) ? existing : [existing]
  object[key] = [...list, ...(Array.isArray(value) ? value : [value])]
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

export { isAbsoluteIri, expandIri }
