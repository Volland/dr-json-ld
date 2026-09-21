/**
 * Expansion — JSON-LD 1.1 section 5.1, carrying a JSON Pointer through every
 * step.
 *
 * Expansion is total: it does not fail on a key it cannot resolve, it drops it.
 * That discarding is the behaviour this tool exists to make visible, so every
 * drop is recorded at the moment it is made, with the pointer already in hand.
 *
 * @lat: [[processing#Processing#Expansion]]
 */
import {
  isAbsoluteIri,
  isKeyword,
  isKeywordLike,
  looksLikeIri,
  splitCompactIri,
} from '../iri/iri.js'
import { pointerChild, type JsonPointer } from '../source/pointer.js'
import { expandIri, processContext } from './active-context.js'
import { tag } from './envelope.js'
import {
  cloneContext,
  JsonLdError,
  NO_INSTRUMENTATION,
  type ActiveContext,
  type Instrumentation,
  type TermDefinition,
} from './types.js'

/**
 * What expansion observed that a successful result conceals. L2 reads these;
 * they are recorded here because reconstructing them afterwards would require
 * re-deriving why something is missing.
 *
 * @lat: [[validation#Validation#The Ladder#L2 Lossiness]]
 */
export type Observation =
  | { kind: 'key-dropped'; key: string; pointer: JsonPointer; underVocab: boolean }
  /**
   * The key matched no term and only became an IRI because `@vocab` applied.
   * This is not a drop — it is worse, because nothing reports it.
   */
  | { kind: 'key-only-via-vocab'; key: string; iri: string; pointer: JsonPointer }
  | { kind: 'relative-iri'; value: string; pointer: JsonPointer }
  | { kind: 'blank-node-minted'; id: string; pointer: JsonPointer }
  | { kind: 'coercion-did-not-fire'; term: string; value: string; pointer: JsonPointer }
  | { kind: 'term-used'; term: string; pointer: JsonPointer }

export interface ExpandOptions {
  /** The document's own base IRI. */
  base?: string
  expandContext?: unknown
  resolveContext?: (iri: string) => unknown
  instrumentation?: Instrumentation
  /** Where the input document sits, for the pointers. Defaults to the root. */
  rootPointer?: JsonPointer
  ordered?: boolean
}

export interface ExpandResult {
  /** The expanded document, with provenance tagged onto every object. */
  expanded: unknown[]
  observations: Observation[]
}

interface State {
  instrumentation: Instrumentation
  observations: Observation[]
  resolveContext: ((iri: string) => unknown) | undefined
  blankNodeCounter: { n: number }
  ordered: boolean
}

export function expand(
  input: unknown,
  active: ActiveContext,
  options: ExpandOptions = {},
): ExpandResult {
  const state: State = {
    instrumentation: options.instrumentation ?? NO_INSTRUMENTATION,
    observations: [],
    resolveContext: options.resolveContext,
    blankNodeCounter: { n: 0 },
    ordered: options.ordered ?? false,
  }
  const rootPointer = options.rootPointer ?? ''

  let context = active
  if (options.expandContext !== undefined) {
    const inner =
      options.expandContext !== null &&
      typeof options.expandContext === 'object' &&
      '@context' in (options.expandContext as object)
        ? (options.expandContext as Record<string, unknown>)['@context']
        : options.expandContext
    context = processContext(context, inner, {
      resolveContext: state.resolveContext,
      instrumentation: state.instrumentation,
      pointer: rootPointer,
    })
  }

  let expanded = expandElement(state, context, null, input, rootPointer, false, false)

  // 5.1 step 8: a top-level result that is a single node object with only
  // `@graph` is unwrapped, and `null` becomes an empty array.
  if (expanded !== null && typeof expanded === 'object' && !Array.isArray(expanded)) {
    const object = expanded as Record<string, unknown>
    if (Object.keys(object).length === 1 && '@graph' in object) {
      expanded = object['@graph']
    }
  }
  if (expanded === null || expanded === undefined) expanded = []
  if (!Array.isArray(expanded)) expanded = [expanded]

  return { expanded: expanded as unknown[], observations: state.observations }
}

function expandElement(
  state: State,
  active: ActiveContext,
  activeProperty: string | null,
  element: unknown,
  pointer: JsonPointer,
  insideList: boolean,
  fromMap: boolean,
): unknown {
  if (element === null || element === undefined) return null

  // A scalar under `@graph` or the document root is dropped.
  if (typeof element !== 'object') {
    if (activeProperty === null || activeProperty === '@graph') return null
    const definition = termDefinition(active, activeProperty)
    const propertyContext = definition?.localContext
    const scoped =
      propertyContext !== undefined
        ? enterScope(state, definition!, active, pointer, 'property-scoped')
        : active
    return expandValue(state, scoped, activeProperty, element as string | number | boolean, pointer)
  }

  if (Array.isArray(element)) {
    const out: unknown[] = []
    element.forEach((item, i) => {
      const childPointer = pointerChild(pointer, i)
      const expanded = expandElement(
        state,
        active,
        activeProperty,
        item,
        childPointer,
        insideList,
        fromMap,
      )
      if (expanded === null) return
      const definition = activeProperty ? termDefinition(active, activeProperty) : undefined
      if (
        (activeProperty === '@list' || definition?.container.includes('@list')) &&
        Array.isArray(expanded)
      ) {
        out.push(tag({ '@list': expanded }, childPointer))
        return
      }
      if (Array.isArray(expanded)) out.push(...expanded)
      else out.push(expanded)
    })
    return out
  }

  return expandObject(state, active, activeProperty, element as Record<string, unknown>, pointer, fromMap)
}

function expandObject(
  state: State,
  activeIn: ActiveContext,
  activeProperty: string | null,
  element: Record<string, unknown>,
  pointer: JsonPointer,
  fromMap: boolean,
): unknown {
  let active = activeIn

  // Step 3 — the property-scoped context is read from the context the property
  // was expanded in, *before* step 7 reverts it. A term defined by a type-scoped
  // context keeps its own scoped context even though the type-scoped context
  // itself stops applying at this node.
  const propertyDefinition = activeProperty ? termDefinition(activeIn, activeProperty) : undefined

  // Step 7 — a non-propagating scoped context stops applying on entering a new
  // node object. A value object and a bare node reference are not new node
  // objects, and neither is an entry reached from a map, so all three keep it.
  if (active.previousContext !== undefined && !fromMap) {
    const keys = Object.keys(element)
    const isValue = keys.some((k) => expandIri(active, k, { vocab: true }) === '@value')
    const isBareReference =
      keys.length === 1 && expandIri(active, keys[0]!, { vocab: true }) === '@id'
    if (!isValue && !isBareReference && activeProperty !== '@graph') {
      state.instrumentation.onEvent({
        kind: 'active-context-change',
        reason: 'revert',
        detail: 'the non-propagating scoped context ceases to apply here',
        pointer,
      })
      active = active.previousContext
    }
  }

  // 8 — a property-scoped context applies before the object's own.
  if (propertyDefinition?.localContext !== undefined) {
    active = enterScope(state, propertyDefinition, active, pointer, 'property-scoped')
  }

  // 9 — the object's own `@context`.
  if ('@context' in element) {
    active = processContext(active, element['@context'], {
      resolveContext: state.resolveContext,
      instrumentation: state.instrumentation,
      pointer: pointerChild(pointer, '@context'),
    })
    state.instrumentation.onEvent({
      kind: 'active-context-change',
      reason: 'document',
      detail: 'the node object declares its own @context',
      pointer: pointerChild(pointer, '@context'),
    })
  }

  // 11 — type-scoped contexts, applied in lexicographical order of the type's
  // *value*, before any other key is looked at. This is what makes a type-scoped
  // redefinition apply below the scope and not above it.
  const typeScoped = active
  const typeKeys = Object.keys(element).filter(
    (k) => expandIri(typeScoped, k, { vocab: true }) === '@type',
  )
  for (const key of typeKeys.sort()) {
    const raw = element[key]
    const types = (Array.isArray(raw) ? raw : [raw])
      .filter((t): t is string => typeof t === 'string')
      .sort()
    for (const type of types) {
      const definition = typeScoped.terms.get(type)
      if (definition?.localContext !== undefined) {
        active = enterScope(state, definition, active, pointer, 'type-scoped')
      }
    }
  }

  const result: Record<string, unknown> = {}
  let nests: string[] = []
  let inputType: string | undefined
  for (const key of typeKeys) {
    const raw = element[key]
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (t): t is string => typeof t === 'string',
    )
    const last = values[values.length - 1]
    if (last !== undefined) inputType = expandIri(active, last, { vocab: true })
  }

  expandEntries(state, active, activeProperty, element, pointer, result, nests, inputType, typeScoped)

  // Nested keys, processed after the object's own.
  nests = collectNests(active, element)
  for (const nestKey of nests) {
    const nestPointer = pointerChild(pointer, nestKey)
    const nestValues = element[nestKey]
    const list = Array.isArray(nestValues) ? nestValues : [nestValues]
    list.forEach((nested, i) => {
      if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
        throw new JsonLdError(
          'invalid @nest value',
          'a nested value must be a map or an array of maps',
          nestPointer,
        )
      }
      const childPointer = Array.isArray(nestValues) ? pointerChild(nestPointer, i) : nestPointer
      // A scoped context on the nesting term applies to what is nested under
      // it, the same way it would on an ordinary property.
      const nestDefinition = active.terms.get(nestKey)
      const nestActive =
        nestDefinition?.localContext !== undefined
          ? enterScope(state, nestDefinition, active, childPointer, 'property-scoped')
          : active

      // The pointer identifies the original key in the input document, which is
      // the point of carrying it through `@nest` at all.
      expandEntries(
        state,
        nestActive,
        activeProperty,
        nested as Record<string, unknown>,
        childPointer,
        result,
        [],
        inputType,
        typeScoped,
      )
    })
  }

  return finishObject(state, active, activeProperty, result, pointer)
}

function expandEntries(
  state: State,
  active: ActiveContext,
  activeProperty: string | null,
  element: Record<string, unknown>,
  pointer: JsonPointer,
  result: Record<string, unknown>,
  _nests: string[],
  inputType: string | undefined,
  /**
   * The context as it stood before any type-scoped context was applied.
   * Section 5.1.2 step 11 keeps it precisely so `@type` values are expanded
   * against it; expanding them against the scoped context would let a type
   * nullify the context that gives the type itself its meaning.
   */
  typeScoped: ActiveContext,
): void {
  const keys = state.ordered ? Object.keys(element).sort() : Object.keys(element)

  for (const key of keys) {
    if (key === '@context') continue
    const keyPointer = pointerChild(pointer, key)
    const value = element[key]
    const expandedProperty = expandIri(active, key, {
      vocab: true,
      instrumentation: state.instrumentation,
      pointer: keyPointer,
    })

    // 13.2 — a key that maps to nothing is dropped, and that is recorded here.
    if (
      expandedProperty === key &&
      !isKeyword(expandedProperty) &&
      !isAbsoluteIri(expandedProperty) &&
      !expandedProperty.startsWith('_:')
    ) {
      recordDrop(state, active, key, keyPointer)
      continue
    }
    if (isKeywordLike(expandedProperty)) {
      state.instrumentation.onEvent({
        kind: 'key-dropped',
        key,
        reason: 'keyword-like',
        pointer: keyPointer,
      })
      state.observations.push({ kind: 'key-dropped', key, pointer: keyPointer, underVocab: false })
      continue
    }

    const definition = termDefinition(active, key)
    if (
      definition === undefined &&
      !isKeyword(expandedProperty) &&
      active.vocab !== undefined &&
      active.vocab !== '' &&
      expandedProperty === active.vocab + key
    ) {
      state.observations.push({
        kind: 'key-only-via-vocab',
        key,
        iri: expandedProperty,
        pointer: keyPointer,
      })
    }
    if (definition && definition.iri === null) {
      state.instrumentation.onEvent({
        kind: 'key-dropped',
        key,
        reason: 'null-mapping',
        pointer: keyPointer,
      })
      state.observations.push({ kind: 'key-dropped', key, pointer: keyPointer, underVocab: false })
      continue
    }
    if (definition) {
      state.observations.push({ kind: 'term-used', term: key, pointer: keyPointer })
    }

    if (definition?.nestValue !== undefined) {
      // Handled in the nest pass.
      continue
    }

    if (isKeyword(expandedProperty)) {
      expandKeywordEntry(
        state,
        expandedProperty === '@type' ? typeScoped : active,
        activeProperty,
        expandedProperty,
        value,
        keyPointer,
        result,
        inputType,
      )
      continue
    }

    const expandedValue = expandPropertyValue(
      state,
      active,
      key,
      definition,
      value,
      keyPointer,
      expandedProperty,
    )
    if (expandedValue === null || expandedValue === undefined) continue

    if (definition?.reverse) {
      const reverseMap = (result['@reverse'] ??= tag({}, keyPointer)) as Record<string, unknown>
      const items = Array.isArray(expandedValue) ? expandedValue : [expandedValue]
      for (const item of items) {
        if (isValueObject(item) || isListObject(item)) {
          throw new JsonLdError(
            'invalid reverse property value',
            'a reverse property may not have a value object or a list object as its value',
            keyPointer,
          )
        }
        ;((reverseMap[expandedProperty] ??= []) as unknown[]).push(item)
      }
      continue
    }

    addValue(result, expandedProperty, expandedValue, true)
  }
}

function expandKeywordEntry(
  state: State,
  active: ActiveContext,
  activeProperty: string | null,
  keyword: string,
  value: unknown,
  pointer: JsonPointer,
  result: Record<string, unknown>,
  _inputType: string | undefined,
): void {
  switch (keyword) {
    case '@id': {
      if (typeof value !== 'string') {
        throw new JsonLdError('invalid @id value', '@id must be a string', pointer)
      }
      // Section 4.2.3 step 3: a string shaped like a keyword but not one is
      // ignored, which for `@id` means the entry exists and identifies nothing.
      if (isKeywordLike(value)) {
        result['@id'] = null
        return
      }
      const iri = expandIri(active, value, {
        documentRelative: true,
        instrumentation: state.instrumentation,
        pointer,
      })
      if (!isAbsoluteIri(iri) && !iri.startsWith('_:')) {
        state.observations.push({ kind: 'relative-iri', value: iri, pointer })
      }
      result['@id'] = iri
      return
    }
    case '@type': {
      const values = Array.isArray(value) ? value : [value]
      const expanded: string[] = []
      for (const item of values) {
        if (typeof item !== 'string') {
          throw new JsonLdError('invalid type value', '@type must be a string or an array', pointer)
        }
        const iri = expandIri(active, item, {
          vocab: true,
          documentRelative: true,
          instrumentation: state.instrumentation,
          pointer,
        })
        if (!isKeyword(iri) && !isAbsoluteIri(iri) && !iri.startsWith('_:')) {
          state.observations.push({ kind: 'relative-iri', value: iri, pointer })
        }
        expanded.push(iri)
      }
      addValue(result, '@type', Array.isArray(value) ? expanded : expanded[0], Array.isArray(value))
      return
    }
    case '@graph': {
      const expanded = expandElement(state, active, '@graph', value, pointer, false, false)
      addValue(result, '@graph', toArray(expanded), true)
      return
    }
    case '@included': {
      const expanded = expandElement(state, active, null, value, pointer, false, false)
      const items = toArray(expanded)
      for (const item of items) {
        if (!isNodeObject(item)) {
          throw new JsonLdError(
            'invalid @included value',
            '@included must contain node objects',
            pointer,
          )
        }
      }
      addValue(result, '@included', items, true)
      return
    }
    case '@value': {
      // Whether a non-scalar is legal depends on `@type: @json`, which may not
      // have been seen yet, so the check happens in `finishObject`.
      result['@value'] = value
      return
    }
    case '@language': {
      if (typeof value !== 'string') {
        throw new JsonLdError(
          'invalid language-tagged string',
          '@language must be a string',
          pointer,
        )
      }
      result['@language'] = value
      return
    }
    case '@direction': {
      if (value !== 'ltr' && value !== 'rtl') {
        throw new JsonLdError('invalid base direction', '@direction must be "ltr" or "rtl"', pointer)
      }
      result['@direction'] = value
      return
    }
    case '@index': {
      if (typeof value !== 'string') {
        throw new JsonLdError('invalid @index value', '@index must be a string', pointer)
      }
      result['@index'] = value
      return
    }
    case '@list': {
      if (activeProperty === null || activeProperty === '@graph') return
      const expanded = expandElement(state, active, activeProperty, value, pointer, true, false)
      result['@list'] = toArray(expanded)
      return
    }
    case '@set': {
      const expanded = expandElement(state, active, activeProperty, value, pointer, false, false)
      // `@set` is transparent: its contents replace it entirely.
      if (expanded !== null) {
        Object.defineProperty(result, SET_PASSTHROUGH, {
          value: expanded,
          enumerable: false,
          configurable: true,
        })
      }
      return
    }
    case '@reverse': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new JsonLdError('invalid @reverse value', '@reverse must be a map', pointer)
      }
      const expanded = expandElement(state, active, '@reverse', value, pointer, false, false)
      if (expanded === null || typeof expanded !== 'object' || Array.isArray(expanded)) return
      const reversed = expanded as Record<string, unknown>
      // A doubly-reversed property becomes a forward property again.
      if ('@reverse' in reversed) {
        for (const [property, items] of Object.entries(
          reversed['@reverse'] as Record<string, unknown>,
        )) {
          addValue(result, property, items, true)
        }
      }
      const reverseMap = (result['@reverse'] ??= tag({}, pointer)) as Record<string, unknown>
      for (const [property, items] of Object.entries(reversed)) {
        if (property === '@reverse') continue
        for (const item of toArray(items)) {
          if (isValueObject(item) || isListObject(item)) {
            throw new JsonLdError(
              'invalid reverse property value',
              'a reverse property may not have a value object or a list object as its value',
              pointer,
            )
          }
          ;((reverseMap[property] ??= []) as unknown[]).push(item)
        }
      }
      return
    }
    case '@nest':
      // Collected separately so a nested key's pointer names the original key.
      return
    case '@json': {
      result['@value'] = value
      result['@type'] = '@json'
      return
    }
    default:
      // A keyword this processor does not expand is dropped rather than guessed at.
      return
  }
}

const SET_PASSTHROUGH = Symbol('set-passthrough')

/**
 * Expand a property's value, honouring every `@container` form.
 *
 * @lat: [[metamodel#Metamodel#Terms#Containers]]
 */
function expandPropertyValue(
  state: State,
  active: ActiveContext,
  key: string,
  definition: TermDefinition | undefined,
  value: unknown,
  pointer: JsonPointer,
  _expandedProperty: string,
): unknown {
  const container = definition?.container ?? []

  // Step 13.9: a term typed `@json` takes its value verbatim. Recursing would
  // read the JSON as a node object and drop every key in it.
  if (definition?.typeMapping === '@json') {
    state.instrumentation.onEvent({
      kind: 'value-coercion',
      term: key,
      coercion: '@json',
      pointer,
    })
    return tag({ '@value': value, '@type': '@json' }, pointer)
  }

  // A language map: keys are language tags, values are strings.
  if (container.includes('@language') && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const out: unknown[] = []
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [language, item] of state.ordered ? entries.sort(byKey) : entries) {
      const itemPointer = pointerChild(pointer, language)
      for (const scalar of toArray(item)) {
        if (scalar === null) continue
        if (typeof scalar !== 'string') {
          throw new JsonLdError(
            'invalid language map value',
            'a language map value must be a string',
            itemPointer,
          )
        }
        const entry: Record<string, unknown> = { '@value': scalar }
        if (language !== '@none') {
          const expandedLanguage = expandIri(active, language, { vocab: true })
          if (expandedLanguage !== '@none') entry['@language'] = language
        }
        const direction = definition?.hasDirectionMapping
          ? definition.directionMapping
          : active.defaultDirection
        if (direction) entry['@direction'] = direction
        out.push(tag(entry, itemPointer))
      }
    }
    return out
  }

  // An index, id, or type map.
  const indexKind = container.includes('@index')
    ? '@index'
    : container.includes('@id')
      ? '@id'
      : container.includes('@type')
        ? '@type'
        : undefined

  if (indexKind && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const out: unknown[] = []
    const entries = Object.entries(value as Record<string, unknown>)
    const indexProperty = definition?.indexMapping
    for (const [index, item] of state.ordered ? entries.sort(byKey) : entries) {
      const itemPointer = pointerChild(pointer, index)
      let scoped = active
      let mapItem = item
      if (indexKind === '@type') {
        const typeDefinition = active.terms.get(index)
        if (typeDefinition?.localContext !== undefined) {
          scoped = enterScope(state, typeDefinition, active, itemPointer, 'type-scoped')
        }
        // Step 13.8.3.7.1: a string under a type map names a node, not a
        // literal — the map key already supplied the type.
        mapItem = Array.isArray(item)
          ? item.map((v) => (typeof v === 'string' ? { '@id': v } : v))
          : typeof item === 'string'
            ? { '@id': item }
            : item
      }
      // `@none` may be aliased by a term, so the key is expanded before it is
      // compared — a literal comparison silently indexes by the alias instead.
      const expandedIndex = expandIri(active, index, { vocab: true })
      const isNone = expandedIndex === '@none'

      const expandedItems = toArray(
        expandElement(state, scoped, key, mapItem, itemPointer, false, true),
      )
      for (const raw of expandedItems) {
        if (raw === null || typeof raw !== 'object') continue
        let node = raw as Record<string, unknown>

        // Step 13.8.3.7: a graph container wraps the item *before* the index or
        // id is attached, so the key names the graph rather than a node in it.
        if (container.includes('@graph') && !isGraphObject(node)) {
          node = tag({ '@graph': [node] }, itemPointer)
        }

        if (isNone) {
          out.push(node)
          continue
        }
        if (indexKind === '@index' && !('@index' in node)) {
          if (indexProperty) {
            const expandedIndex = expandElement(state, active, indexProperty, index, itemPointer, false, false)
            addValue(node, expandIri(active, indexProperty, { vocab: true }), expandedIndex, true)
          } else {
            node['@index'] = index
          }
        } else if (indexKind === '@id' && !('@id' in node)) {
          node['@id'] = expandIri(active, index, {
            documentRelative: true,
            instrumentation: state.instrumentation,
            pointer: itemPointer,
          })
          // The node was expanded before the map key reached it, so it looked
          // like a blank node on the way through. It is not: the container
          // supplied its identifier. Retract the observation rather than report
          // a loss that did not happen.
          retractBlankNode(state, itemPointer)
        } else if (indexKind === '@type') {
          const existing = toArray(node['@type'])
          node['@type'] = [expandedIndex, ...existing]
        }
        out.push(node)
      }
    }
    return out
  }

  // A graph container wraps each value in a named or unnamed graph.
  if (container.includes('@graph') && !container.includes('@id') && !container.includes('@index')) {
    const items = toArray(expandElement(state, active, key, value, pointer, false, false))
    // Step 13.10 converts every value into a graph object without asking
    // whether it already is one, so a graph under a `@graph` term nests.
    return items.map((item) => tag({ '@graph': toArray(item) }, pointer))
  }

  const expanded = expandElement(
    state,
    active,
    key,
    value,
    pointer,
    container.includes('@list'),
    false,
  )
  if (expanded === null) return null

  // A `@list` container wraps the values, unless they already are a list.
  if (container.includes('@list')) {
    // Step 13.9: only an expanded value that is *itself* a list object is left
    // alone. Unwrapping a one-element array that happens to hold one would lose
    // the outer list, which is exactly what a list of lists is.
    if (isListObject(expanded)) return expanded
    return tag({ '@list': toArray(expanded) }, pointer)
  }

  return expanded
}

function byKey(a: [string, unknown], b: [string, unknown]): number {
  return a[0].localeCompare(b[0])
}

/**
 * Value Expansion — JSON-LD 1.1 section 5.3.2: coercion by `@type`, the default
 * language, and `@direction`.
 */
function expandValue(
  state: State,
  active: ActiveContext,
  activeProperty: string,
  value: string | number | boolean,
  pointer: JsonPointer,
): unknown {
  const definition = termDefinition(active, activeProperty)
  const typeMapping = definition?.typeMapping

  if (typeMapping === '@id' && typeof value === 'string') {
    state.instrumentation.onEvent({
      kind: 'value-coercion',
      term: activeProperty,
      coercion: '@id',
      pointer,
    })
    const iri = expandIri(active, value, {
      documentRelative: true,
      instrumentation: state.instrumentation,
      pointer,
    })
    if (!isAbsoluteIri(iri) && !iri.startsWith('_:')) {
      state.observations.push({ kind: 'relative-iri', value: iri, pointer })
    }
    return tag({ '@id': iri }, pointer)
  }

  if (typeMapping === '@vocab' && typeof value === 'string') {
    state.instrumentation.onEvent({
      kind: 'value-coercion',
      term: activeProperty,
      coercion: '@vocab',
      pointer,
    })
    return tag(
      {
        '@id': expandIri(active, value, {
          vocab: true,
          documentRelative: true,
          instrumentation: state.instrumentation,
          pointer,
        }),
      },
      pointer,
    )
  }

  const result: Record<string, unknown> = { '@value': value }

  if (typeMapping !== undefined && typeMapping !== '@id' && typeMapping !== '@vocab' && typeMapping !== '@none') {
    result['@type'] = typeMapping
    state.instrumentation.onEvent({
      kind: 'value-coercion',
      term: activeProperty,
      coercion: typeMapping,
      pointer,
    })
  } else if (typeof value === 'string') {
    const language = definition?.hasLanguageMapping
      ? definition.languageMapping
      : active.defaultLanguage
    if (language !== null && language !== undefined) result['@language'] = language
    const direction = definition?.hasDirectionMapping
      ? definition.directionMapping
      : active.defaultDirection
    if (direction !== null && direction !== undefined) result['@direction'] = direction

    // The coercion that did not fire: a string that reads as an IRI, under a
    // term with no `@type: @id`. The most common cause of a document that
    // expands into a graph with no edges.
    if (typeMapping === undefined && looksLikeIri(value)) {
      state.observations.push({
        kind: 'coercion-did-not-fire',
        term: activeProperty,
        value,
        pointer,
      })
    }
  }

  return tag(result, pointer)
}

/**
 * Step 13.4 and 13.5 of expansion: drop the entry, and record which kind of
 * drop it was. `@vocab` converts the loudest failure into a silent one, so the
 * two cases must be distinguishable.
 */
function recordDrop(
  state: State,
  active: ActiveContext,
  key: string,
  pointer: JsonPointer,
): void {
  const underVocab = active.vocab !== undefined
  state.instrumentation.onEvent({ kind: 'key-dropped', key, reason: 'no-term', pointer })
  state.observations.push({ kind: 'key-dropped', key, pointer, underVocab })
}

function enterScope(
  state: State,
  definition: TermDefinition,
  active: ActiveContext,
  pointer: JsonPointer,
  reason: 'type-scoped' | 'property-scoped',
): ActiveContext {
  // A type-scoped context defaults to not propagating; a property-scoped one
  // defaults to propagating.
  const defaultPropagate = reason === 'property-scoped'
  const propagate = definition.propagate ?? defaultPropagate
  // Section 5.1.2 steps 10 and 11 process the scoped context against the
  // context in force where the term is *used*, not the one it was defined in.
  // Using the defining context instead is what stops scoped contexts layering
  // on the intermediate contexts between the two.
  const next = processContext(active, definition.localContext, {
    resolveContext: state.resolveContext,
    instrumentation: state.instrumentation,
    pointer,
    overrideProtected: true,
    propagate,
  })
  next.propagate = propagate
  state.instrumentation.onEvent({
    kind: 'active-context-change',
    reason,
    detail: `the ${reason.replace('-scoped', '')}-scoped context on "${definition.term}" takes effect here${
      propagate ? '' : ' and does not propagate into nested node objects'
    }`,
    pointer,
  })
  return next
}

function collectNests(active: ActiveContext, element: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of Object.keys(element)) {
    const definition = active.terms.get(key)
    if (definition?.nestValue !== undefined) {
      const expanded = expandIri(active, definition.nestValue, { vocab: true })
      if (expanded !== '@nest') {
        throw new JsonLdError(
          'invalid @nest value',
          `@nest on "${key}" must expand to @nest`,
          '',
        )
      }
      out.push(key)
    } else if (expandIri(active, key, { vocab: true }) === '@nest') {
      out.push(key)
    }
  }
  return out
}

function finishObject(
  state: State,
  _active: ActiveContext,
  activeProperty: string | null,
  result: Record<string, unknown>,
  pointer: JsonPointer,
): unknown {
  const passthrough = (result as Record<symbol, unknown>)[SET_PASSTHROUGH]
  if (passthrough !== undefined && Object.keys(result).length === 0) {
    return passthrough
  }

  tag(result, pointer)

  // 15 — a value object is checked and normalised.
  if ('@value' in result) {
    const allowed = new Set(['@value', '@language', '@direction', '@index', '@type'])
    for (const key of Object.keys(result)) {
      if (!allowed.has(key)) {
        throw new JsonLdError(
          'invalid value object',
          `a value object may not carry ${key}`,
          pointer,
        )
      }
    }
    if ('@type' in result && ('@language' in result || '@direction' in result)) {
      throw new JsonLdError(
        'invalid value object',
        'a value object may not carry both @type and @language or @direction',
        pointer,
      )
    }
    // Step 15.4 precedes 15.5: under `@type: @json`, `null` is a JSON literal
    // rather than an absent value, so the type is consulted first.
    if (result['@type'] === '@json') return result
    if (result['@value'] === null) return null
    if (result['@value'] !== null && typeof result['@value'] === 'object') {
      throw new JsonLdError(
        'invalid value object value',
        '@value must be a scalar or null unless the term is typed @json',
        pointer,
      )
    }
    if ('@language' in result && typeof result['@value'] !== 'string') {
      throw new JsonLdError(
        'invalid language-tagged value',
        '@language may only accompany a string value',
        pointer,
      )
    }
    if ('@type' in result && typeof result['@type'] !== 'string') {
      throw new JsonLdError('invalid typed value', '@type must be a string', pointer)
    }
    // Step 19 also applies to a value object: at the root or under `@graph` it
    // denotes nothing, whatever language or type it carries. The check lives
    // here because the value-object branch returns before reaching step 19.
    if (activeProperty === null || activeProperty === '@graph') return null
    return result
  }

  // 16 — a `@type` entry whose value is not an array becomes one.
  if ('@type' in result && !Array.isArray(result['@type'])) {
    result['@type'] = [result['@type']]
  }

  // 17 — an object with only `@language` or only `@direction` is dropped.
  if ('@list' in result || '@set' in result) {
    if (Object.keys(result).length > 1 && !('@index' in result && Object.keys(result).length === 2)) {
      throw new JsonLdError(
        'invalid set or list object',
        'a list or set object may only carry @index alongside it',
        pointer,
      )
    }
    if ('@set' in result) return result['@set']
  }

  // A `@reverse` map that every entry was lifted out of denotes nothing.
  const reverseMap = result['@reverse']
  if (
    reverseMap !== null &&
    typeof reverseMap === 'object' &&
    Object.keys(reverseMap as object).length === 0
  ) {
    delete result['@reverse']
  }

  const keys = Object.keys(result)
  if (keys.length === 1 && (keys[0] === '@language' || keys[0] === '@direction')) return null

  // 19 — at the document root or under `@graph`, an object with no content, or
  // with only `@value` or `@list`, is dropped.
  if (activeProperty === null || activeProperty === '@graph') {
    // A value object or a list at the top level denotes nothing, whatever else
    // it carries — a language tag on a free-floating string is still free
    // floating.
    if (keys.length === 0 || '@value' in result || '@list' in result) return null
    if (keys.length === 1 && keys[0] === '@id') return null
  }

  // A node object with no `@id` denotes a blank node. Recorded, because a blank
  // node minted where an identifier was expected is a lossiness finding.
  if (
    !('@id' in result) &&
    !('@value' in result) &&
    !('@list' in result) &&
    keys.length > 0 &&
    !('@graph' in result && keys.length === 1)
  ) {
    const id = `_:b${state.blankNodeCounter.n++}`
    state.instrumentation.onEvent({ kind: 'blank-node-minted', id, pointer })
    state.observations.push({ kind: 'blank-node-minted', id, pointer })
  }

  return result
}

/** Drop a blank-node observation at or below `pointer`. */
function retractBlankNode(state: State, pointer: JsonPointer): void {
  for (let i = state.observations.length - 1; i >= 0; i--) {
    const observation = state.observations[i]!
    if (observation.kind !== 'blank-node-minted') continue
    if (observation.pointer === pointer || observation.pointer.startsWith(`${pointer}/`)) {
      state.observations.splice(i, 1)
    }
  }
}

function termDefinition(active: ActiveContext, term: string): TermDefinition | undefined {
  return active.terms.get(term)
}

function addValue(
  object: Record<string, unknown>,
  key: string,
  value: unknown,
  asArray: boolean,
): void {
  if (value === undefined) return
  const existing = object[key]
  if (existing === undefined) {
    object[key] = asArray ? toArray(value) : value
    return
  }
  const list = Array.isArray(existing) ? existing : [existing]
  object[key] = [...list, ...toArray(value)]
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

export function isValueObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && '@value' in (value as object)
}

export function isListObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && '@list' in (value as object)
}

export function isGraphObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && '@graph' in (value as object)
}

export function isNodeObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !isValueObject(value) &&
    !isListObject(value)
  )
}

export { splitCompactIri, cloneContext }
