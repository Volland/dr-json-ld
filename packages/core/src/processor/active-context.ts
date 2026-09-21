/**
 * Context processing and IRI expansion — JSON-LD 1.1 sections 4.1 and 4.2.
 *
 * Errors raised here are what L1 reports, and they are located at the term in
 * the *model* rather than in a generated artifact, which is why every term
 * definition carries the pointer it came from.
 *
 * @lat: [[validation#Validation#The Ladder#L1 Context Errors]]
 */
import { isAbsoluteIri, isKeyword, isKeywordLike, resolveIri, splitCompactIri } from '../iri/iri.js'
import { pointerChild, type JsonPointer } from '../source/pointer.js'
import {
  cloneContext,
  emptyContext,
  JsonLdError,
  NO_INSTRUMENTATION,
  type ActiveContext,
  type ContainerValue,
  type Instrumentation,
  type TermDefinition,
} from './types.js'

const VALID_CONTAINERS: ReadonlySet<string> = new Set([
  '@list',
  '@set',
  '@index',
  '@id',
  '@type',
  '@language',
  '@graph',
  '@none',
])

export interface ContextOptions {
  instrumentation?: Instrumentation
  /** Resolves a referenced context IRI to its vendored document. Offline. */
  resolveContext?: (iri: string) => unknown
  /** The pointer of the context being processed, for trace and findings. */
  pointer?: JsonPointer
  /** Contexts already being processed, so a cycle is an error rather than a hang. */
  remoteStack?: readonly string[]
  /** Term definitions whose scoped contexts may override a protected term. */
  overrideProtected?: boolean
  /** Whether `@propagate: false` applies to this invocation. */
  propagate?: boolean
  /** Whether this run is validating scoped contexts only (no side effects wanted). */
  validateScopedContext?: boolean
  /** Leave a referenced context unresolved instead of failing on it. */
  skipRemote?: boolean
}

/**
 * Build an active context from a local context. `localContext` is whatever a
 * `@context` entry holds: null, an IRI, a map, or an array of those.
 */
export function processContext(
  active: ActiveContext,
  localContext: unknown,
  options: ContextOptions = {},
): ActiveContext {
  const instrumentation = options.instrumentation ?? NO_INSTRUMENTATION
  const pointer = options.pointer ?? ''
  const remoteStack = options.remoteStack ?? []

  // Section 4.1 step 3: a map carrying `@propagate` decides for itself, which
  // is how an embedded context opts out of reaching nested node objects.
  let propagate = options.propagate
  if (
    localContext !== null &&
    typeof localContext === 'object' &&
    !Array.isArray(localContext) &&
    typeof (localContext as Record<string, unknown>)['@propagate'] === 'boolean'
  ) {
    propagate = (localContext as Record<string, unknown>)['@propagate'] as boolean
  }

  let result = cloneContext(active)
  if (propagate === false) {
    result.propagate = false
    // Section 4.1 step 4: the revert target is recorded once, on the outermost
    // non-propagating context, so a stack of scoped contexts unwinds to where
    // the first of them began rather than to the one just below.
    result.previousContext ??= active
  }

  const contexts = Array.isArray(localContext) ? localContext : [localContext]

  for (const context of contexts) {
    // 5.1 — null resets to the initial context, keeping the original base.
    if (context === null) {
      // A protected term is a promise to downstream contexts, so a `null` that
      // would erase one is refused rather than honoured.
      if (!options.overrideProtected) {
        for (const definition of result.terms.values()) {
          if (definition.protected) {
            throw new JsonLdError(
              'invalid context nullification',
              `nullifying the context would remove the protected term "${definition.term}"`,
              pointer,
            )
          }
        }
      }
      const reset = emptyContext(active.originalBaseIri)
      reset.propagate = options.propagate !== false
      if (options.propagate === false) reset.previousContext = result.previousContext ?? active
      instrumentation.onEvent({
        kind: 'active-context-change',
        reason: 'document',
        detail: 'context reset to the initial context by `null`',
        pointer,
      })
      result = reset
      continue
    }

    // 5.2 — a string is a reference to a context that must already be vendored.
    if (typeof context === 'string') {
      if (options.skipRemote) continue
      const iri = resolveIri(result.baseIri, context)
      if (remoteStack.includes(iri)) {
        throw new JsonLdError(
          'recursive context inclusion',
          `the context ${iri} includes itself`,
          pointer,
        )
      }
      if (!options.resolveContext) {
        throw new JsonLdError(
          'loading remote context failed',
          `${iri} has not been vendored. Run \`ldm vendor\` — no command other than the vendor refresh touches the network.`,
          pointer,
        )
      }
      const document = options.resolveContext(iri)
      if (document === undefined) {
        throw new JsonLdError(
          'loading remote context failed',
          `${iri} has not been vendored. Run \`ldm vendor\` — no command other than the vendor refresh touches the network.`,
          pointer,
        )
      }
      const inner =
        document !== null && typeof document === 'object' && '@context' in (document as object)
          ? (document as Record<string, unknown>)['@context']
          : document
      instrumentation.onEvent({
        kind: 'active-context-change',
        reason: 'document',
        detail: `referenced context ${iri}`,
        pointer,
      })
      result = processContext(result, inner, {
        ...options,
        remoteStack: [...remoteStack, iri],
      })
      continue
    }

    if (typeof context !== 'object' || Array.isArray(context)) {
      throw new JsonLdError(
        'invalid local context',
        `a context must be null, an IRI, or a mapping; found ${describe(context)}`,
        pointer,
      )
    }

    // 5.5 — @version
    const rawMap = context as Record<string, unknown>
    if ('@version' in rawMap) {
      const version = rawMap['@version']
      if (version !== 1.1 && version !== '1.1') {
        throw new JsonLdError(
          'invalid @version value',
          `@version must be 1.1; found ${JSON.stringify(version)}`,
          pointer,
        )
      }
    }

    // 5.6 — @import pulls a vendored context in *underneath* this one, so the
    // local entries override what it brings.
    let map = context as Record<string, unknown>
    if ('@import' in map) {
      const target = map['@import']
      if (typeof target !== 'string') {
        throw new JsonLdError('invalid @import value', '@import must be a string', pointer)
      }
      const iri = resolveIri(result.baseIri, target)
      const document = options.resolveContext?.(iri)
      if (document === undefined) {
        throw new JsonLdError(
          'invalid remote context',
          `${iri} has not been vendored. Run \`ldm vendor\` — no command other than the vendor refresh touches the network.`,
          pointer,
        )
      }
      const imported =
        document !== null && typeof document === 'object' && '@context' in (document as object)
          ? (document as Record<string, unknown>)['@context']
          : document
      if (imported === null || typeof imported !== 'object' || Array.isArray(imported)) {
        throw new JsonLdError(
          'invalid remote context',
          `the context imported from ${iri} must be a single mapping`,
          pointer,
        )
      }
      if ('@import' in (imported as Record<string, unknown>)) {
        throw new JsonLdError(
          'invalid context entry',
          'an imported context may not itself use @import',
          pointer,
        )
      }
      const merged = { ...(imported as Record<string, unknown>), ...map }
      delete merged['@import']
      map = merged
    }

    // 5.7 — @base
    if ('@base' in map) {
      const value = map['@base']
      if (value === null) {
        delete result.baseIri
      } else if (typeof value === 'string') {
        result.baseIri = isAbsoluteIri(value) ? value : resolveIri(result.baseIri, value)
      } else {
        throw new JsonLdError('invalid base IRI', '@base must be a string or null', pointer)
      }
    }

    // 5.8 — @vocab
    if ('@vocab' in map) {
      const value = map['@vocab']
      if (value === null) {
        delete result.vocab
      } else if (typeof value === 'string') {
        // `@vocab: "ex:ns/"` names a prefix, and `@vocab: ""` names the base.
        // Keeping either verbatim mints IRIs nobody serves.
        result.vocab = value.startsWith('_:')
          ? value
          : expandIri(result, value, { vocab: true, documentRelative: true })
      } else {
        throw new JsonLdError(
          'invalid vocab mapping',
          '@vocab must be a string or null',
          pointer,
        )
      }
    }

    // 5.9 — @language
    if ('@language' in map) {
      const value = map['@language']
      if (value === null) {
        result.defaultLanguage = null
      } else if (typeof value === 'string') {
        result.defaultLanguage = value
      } else {
        throw new JsonLdError(
          'invalid default language',
          '@language must be a string or null',
          pointer,
        )
      }
    }

    // 5.10 — @direction
    if ('@direction' in map) {
      const value = map['@direction']
      if (value === null) {
        result.defaultDirection = null
      } else if (value === 'ltr' || value === 'rtl') {
        result.defaultDirection = value
      } else {
        throw new JsonLdError(
          'invalid base direction',
          '@direction must be "ltr", "rtl" or null',
          pointer,
        )
      }
    }

    // 5.11 — @propagate
    if ('@propagate' in map) {
      const value = map['@propagate']
      if (typeof value !== 'boolean') {
        throw new JsonLdError('invalid @propagate value', '@propagate must be a boolean', pointer)
      }
      result.propagate = value
    }

    // 5.13 — term definitions
    const protectedFlag = map['@protected'] === true
    const defined = new Map<string, boolean>()
    for (const key of Object.keys(map)) {
      if (
        key === '@base' ||
        key === '@direction' ||
        key === '@import' ||
        key === '@language' ||
        key === '@propagate' ||
        key === '@protected' ||
        key === '@version' ||
        key === '@vocab'
      ) {
        continue
      }
      createTermDefinition(result, map, key, defined, {
        ...options,
        pointer: pointerChild(pointer, key),
        protectedFlag,
      })
    }
  }

  return result
}

interface DefineOptions extends ContextOptions {
  protectedFlag?: boolean
}

/**
 * Create Term Definition — JSON-LD 1.1 section 4.2.2. `defined` guards against
 * a definition that depends on itself.
 */
function createTermDefinition(
  active: ActiveContext,
  localContext: Record<string, unknown>,
  term: string,
  defined: Map<string, boolean>,
  options: DefineOptions,
): void {
  const pointer = options.pointer ?? ''
  const state = defined.get(term)
  if (state === true) return
  if (state === false) {
    throw new JsonLdError('cyclic IRI mapping', `the definition of "${term}" is cyclic`, pointer)
  }
  if (term === '') {
    throw new JsonLdError('invalid term definition', 'a term may not be the empty string', pointer)
  }
  defined.set(term, false)

  let value = localContext[term]

  // 4 — @type may be redefined, but only with a container and protected flag.
  if (term === '@type') {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !isLegalTypeRedefinition(value as Record<string, unknown>)
    ) {
      throw new JsonLdError(
        'keyword redefinition',
        '@type may only be redefined with @container: @set and @protected',
        pointer,
      )
    }
  } else if (isKeyword(term)) {
    throw new JsonLdError('keyword redefinition', `"${term}" is a keyword`, pointer)
  } else if (isKeywordLike(term)) {
    // A term shaped like a keyword is ignored, per the specification.
    defined.set(term, true)
    return
  }

  const previous = active.terms.get(term)
  active.terms.delete(term)

  // 7-9 — normalise the value shapes.
  if (value === null) {
    value = { '@id': null }
  } else if (typeof value === 'string') {
    value = { '@id': value }
  } else if (value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    throw new JsonLdError(
      'invalid term definition',
      `the definition of "${term}" must be a string, a mapping or null`,
      pointer,
    )
  }

  const def = value as Record<string, unknown>
  const definition: TermDefinition = {
    term,
    iri: null,
    container: [],
    reverse: false,
    protected: def['@protected'] === true || options.protectedFlag === true,
    prefix: false,
    hasLanguageMapping: false,
    hasDirectionMapping: false,
    pointer,
  }

  if ('@protected' in def && typeof def['@protected'] !== 'boolean') {
    throw new JsonLdError('invalid @protected value', '@protected must be a boolean', pointer)
  }

  // 12 — @type
  if ('@type' in def) {
    const type = def['@type']
    if (typeof type !== 'string') {
      throw new JsonLdError('invalid type mapping', '@type must be a string', pointer)
    }
    let expanded = expandIri(active, type, {
      vocab: true,
      localContext,
      defined,
      instrumentation: options.instrumentation,
      pointer,
    })
    if (type === '@id' || type === '@vocab' || type === '@json' || type === '@none') {
      expanded = type
    } else if (isKeyword(expanded)) {
      throw new JsonLdError(
        'invalid type mapping',
        `@type: ${type} is not a legal type mapping`,
        pointer,
      )
    } else if (!isAbsoluteIri(expanded) && !expanded.startsWith('_:')) {
      throw new JsonLdError(
        'invalid type mapping',
        `@type: ${type} does not expand to an IRI`,
        pointer,
      )
    }
    definition.typeMapping = expanded
  }

  // 13 — @reverse
  if ('@reverse' in def) {
    if ('@id' in def || '@nest' in def) {
      throw new JsonLdError(
        'invalid reverse property',
        `"${term}" declares @reverse alongside @id or @nest`,
        pointer,
      )
    }
    const reverse = def['@reverse']
    if (typeof reverse !== 'string') {
      throw new JsonLdError('invalid IRI mapping', '@reverse must be a string', pointer)
    }
    if (isKeywordLike(reverse)) {
      defined.set(term, true)
      return
    }
    const iri = expandIri(active, reverse, {
      vocab: true,
      localContext,
      defined,
      instrumentation: options.instrumentation,
      pointer,
    })
    if (!isAbsoluteIri(iri) && !iri.startsWith('_:')) {
      throw new JsonLdError(
        'invalid IRI mapping',
        `@reverse: ${reverse} does not expand to an IRI`,
        pointer,
      )
    }
    definition.iri = iri
    definition.reverse = true
    applyContainer(definition, def, pointer, true)
    applyScopedContext(definition, def, active, options)
    active.terms.set(term, definition)
    defined.set(term, true)
    return
  }

  // 14 — @id, or derive from the term itself.
  if ('@id' in def && def['@id'] !== term) {
    const id = def['@id']
    if (id === null) {
      definition.iri = null
    } else if (typeof id !== 'string') {
      throw new JsonLdError('invalid IRI mapping', '@id must be a string or null', pointer)
    } else if (isKeywordLike(id)) {
      defined.set(term, true)
      return
    } else {
      const iri = expandIri(active, id, {
        vocab: true,
        localContext,
        defined,
        instrumentation: options.instrumentation,
        pointer,
      })
      if (!isKeyword(iri) && !isAbsoluteIri(iri) && !iri.startsWith('_:')) {
        throw new JsonLdError(
          'invalid IRI mapping',
          `@id: ${id} does not expand to an IRI or a keyword`,
          pointer,
        )
      }
      if (iri === '@context') {
        throw new JsonLdError('invalid keyword alias', 'a term may not alias @context', pointer)
      }
      definition.iri = iri
      // A term whose IRI ends in a gen-delim, or which is a blank node, may be
      // used as a compact-IRI prefix.
      if (/[:/?#[\]@]$/.test(iri) || iri.startsWith('_:')) definition.prefix = true
    }
  } else if (term.includes(':') && splitCompactIri(term)) {
    const { prefix, suffix } = splitCompactIri(term)!
    if (Object.prototype.hasOwnProperty.call(localContext, prefix)) {
      createTermDefinition(active, localContext, prefix, defined, options)
    }
    const prefixDefinition = active.terms.get(prefix)
    definition.iri = prefixDefinition?.iri ? prefixDefinition.iri + suffix : term
  } else if (term.includes('/')) {
    definition.iri = expandIri(active, term, { vocab: true })
  } else if (term === '@type') {
    definition.iri = '@type'
  } else if (active.vocab !== undefined) {
    definition.iri = active.vocab + term
  } else {
    throw new JsonLdError(
      'invalid IRI mapping',
      `"${term}" has no @id and the active context declares no @vocab to derive one from`,
      pointer,
    )
  }

  applyContainer(definition, def, pointer, false)

  // 20 — @index
  if ('@index' in def) {
    const index = def['@index']
    if (!definition.container.includes('@index')) {
      throw new JsonLdError(
        'invalid term definition',
        `"${term}" declares @index without @container: @index`,
        pointer,
      )
    }
    if (typeof index !== 'string') {
      throw new JsonLdError('invalid term definition', '@index must be a string', pointer)
    }
    const expanded = expandIri(active, index, { vocab: true })
    if (!isAbsoluteIri(expanded)) {
      throw new JsonLdError(
        'invalid term definition',
        `@index: ${index} does not expand to an IRI`,
        pointer,
      )
    }
    definition.indexMapping = index
  }

  applyScopedContext(definition, def, active, options)

  // 22 — @language, only when @type is absent.
  if ('@language' in def && !('@type' in def)) {
    const language = def['@language']
    if (language !== null && typeof language !== 'string') {
      throw new JsonLdError(
        'invalid language mapping',
        '@language must be a string or null',
        pointer,
      )
    }
    definition.languageMapping = language
    definition.hasLanguageMapping = true
  }

  // 23 — @direction, only when @type is absent.
  if ('@direction' in def && !('@type' in def)) {
    const direction = def['@direction']
    if (direction !== null && direction !== 'ltr' && direction !== 'rtl') {
      throw new JsonLdError(
        'invalid base direction',
        '@direction must be "ltr", "rtl" or null',
        pointer,
      )
    }
    definition.directionMapping = direction
    definition.hasDirectionMapping = true
  }

  // 24 — @nest
  if ('@nest' in def) {
    const nest = def['@nest']
    if (typeof nest !== 'string') {
      throw new JsonLdError('invalid @nest value', '@nest must be a string', pointer)
    }
    if (isKeyword(nest) && nest !== '@nest') {
      throw new JsonLdError(
        'invalid @nest value',
        `@nest may not be the keyword ${nest}`,
        pointer,
      )
    }
    definition.nestValue = nest
  }

  // 25 — @prefix
  if ('@prefix' in def) {
    const prefix = def['@prefix']
    if (typeof prefix !== 'boolean') {
      throw new JsonLdError('invalid @prefix value', '@prefix must be a boolean', pointer)
    }
    if (term.includes(':') || term.includes('/')) {
      throw new JsonLdError(
        'invalid term definition',
        '@prefix may not be set on a term that is itself a compact IRI',
        pointer,
      )
    }
    if (prefix && definition.iri !== null && isKeyword(definition.iri)) {
      throw new JsonLdError(
        'invalid term definition',
        '@prefix may not be set on a term whose IRI mapping is a keyword',
        pointer,
      )
    }
    definition.prefix = prefix
  }

  for (const key of Object.keys(def)) {
    if (!ALLOWED_TERM_KEYS.has(key)) {
      throw new JsonLdError(
        'invalid term definition',
        `"${key}" is not an entry a term definition may carry`,
        pointer,
      )
    }
  }

  // 26 — a protected term may not be redefined to something different.
  if (previous?.protected && !options.overrideProtected) {
    if (!sameDefinition(previous, definition)) {
      throw new JsonLdError(
        'protected term redefinition',
        `"${term}" is protected by an earlier context and may not be redefined`,
        pointer,
      )
    }
    active.terms.set(term, previous)
    defined.set(term, true)
    return
  }

  active.terms.set(term, definition)
  defined.set(term, true)
}

const ALLOWED_TERM_KEYS: ReadonlySet<string> = new Set([
  '@id',
  '@reverse',
  '@container',
  '@context',
  '@direction',
  '@index',
  '@language',
  '@nest',
  '@prefix',
  '@protected',
  '@type',
])

function isLegalTypeRedefinition(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  if (keys.some((k) => k !== '@container' && k !== '@protected')) return false
  if ('@container' in value) {
    const container = value['@container']
    const list = Array.isArray(container) ? container : [container]
    if (!list.every((c) => c === '@set' || c === '@id')) return false
  }
  return true
}

function applyContainer(
  definition: TermDefinition,
  def: Record<string, unknown>,
  pointer: JsonPointer,
  isReverse: boolean,
): void {
  if (!('@container' in def)) return
  const raw = def['@container']
  const list = (Array.isArray(raw) ? raw : [raw]) as unknown[]
  for (const item of list) {
    if (typeof item !== 'string' || !VALID_CONTAINERS.has(item)) {
      throw new JsonLdError(
        'invalid container mapping',
        `${JSON.stringify(item)} is not a container value the specification allows`,
        pointer,
      )
    }
  }
  const values = list as ContainerValue[]
  if (isReverse && !values.every((v) => v === '@set' || v === '@index')) {
    throw new JsonLdError(
      'invalid reverse property',
      'a reverse property may only carry @container: @set or @index',
      pointer,
    )
  }
  if (!isLegalContainerCombination(values)) {
    throw new JsonLdError(
      'invalid container mapping',
      `the container combination ${JSON.stringify(values)} is not allowed`,
      pointer,
    )
  }
  definition.container = [...values].sort()
}

function isLegalContainerCombination(values: readonly ContainerValue[]): boolean {
  if (values.length === 0) return false
  if (values.length === 1) return true
  const set = new Set(values)
  if (set.has('@list')) return false
  const withoutSet = new Set(values.filter((v) => v !== '@set'))
  if (withoutSet.size <= 1) return true
  if (withoutSet.size === 2 && withoutSet.has('@graph')) {
    return withoutSet.has('@id') || withoutSet.has('@index')
  }
  return false
}

/**
 * The scoped context is recorded rather than processed, because its effect is
 * positional: it applies below the point where the term is used.
 */
function applyScopedContext(
  definition: TermDefinition,
  def: Record<string, unknown>,
  active: ActiveContext,
  options: DefineOptions,
): void {
  if (!('@context' in def)) return
  const local = def['@context']
  // Validate now so an illegal scoped context is an L1 finding at the term that
  // declares it, not an error somewhere in a document that happens to use it.
  //
  // Remote references are *not* followed here. A scoped context is applied where
  // the term is used, and following it at definition time makes a context that
  // legitimately refers back to the one defining it look like a cycle.
  try {
    processContext(active, local, {
      ...options,
      overrideProtected: true,
      validateScopedContext: true,
      resolveContext: undefined,
      skipRemote: true,
    })
  } catch (error) {
    throw new JsonLdError(
      'invalid scoped context',
      error instanceof Error ? error.message : String(error),
      options.pointer,
    )
  }
  definition.localContext = local
  definition.baseContext = active
  if (typeof local === 'object' && local !== null && !Array.isArray(local)) {
    const propagate = (local as Record<string, unknown>)['@propagate']
    if (typeof propagate === 'boolean') definition.propagate = propagate
  }
}

function sameDefinition(a: TermDefinition, b: TermDefinition): boolean {
  return (
    a.iri === b.iri &&
    a.typeMapping === b.typeMapping &&
    a.reverse === b.reverse &&
    a.prefix === b.prefix &&
    a.nestValue === b.nestValue &&
    a.indexMapping === b.indexMapping &&
    a.hasLanguageMapping === b.hasLanguageMapping &&
    a.languageMapping === b.languageMapping &&
    a.hasDirectionMapping === b.hasDirectionMapping &&
    a.directionMapping === b.directionMapping &&
    JSON.stringify(a.container) === JSON.stringify(b.container) &&
    JSON.stringify(a.localContext ?? null) === JSON.stringify(b.localContext ?? null)
  )
}

export interface ExpandIriOptions {
  /** Resolve against `@vocab` rather than `@base`. */
  vocab?: boolean
  /** Resolve a relative reference against the document base. */
  documentRelative?: boolean
  localContext?: Record<string, unknown>
  defined?: Map<string, boolean>
  instrumentation?: Instrumentation
  pointer?: JsonPointer
}

/**
 * IRI Expansion — JSON-LD 1.1 section 4.2.3. The one place a term becomes an
 * IRI, so the one place a trace entry for it is emitted.
 */
export function expandIri(
  active: ActiveContext,
  value: string,
  options: ExpandIriOptions = {},
): string {
  const instrumentation = options.instrumentation
  const pointer = options.pointer ?? ''

  if (isKeyword(value)) return value
  if (isKeywordLike(value)) return value

  // If the value is a term in the local context being processed, define it now.
  if (options.localContext && options.defined) {
    if (
      Object.prototype.hasOwnProperty.call(options.localContext, value) &&
      options.defined.get(value) !== true
    ) {
      createTermDefinition(active, options.localContext, value, options.defined, {
        instrumentation: options.instrumentation ?? NO_INSTRUMENTATION,
        pointer,
      })
    }
  }

  const definition = active.terms.get(value)
  if (options.vocab && definition) {
    instrumentation?.onEvent({
      kind: 'term-lookup',
      term: value,
      found: true,
      iri: definition.iri,
      pointer,
    })
    return definition.iri ?? value
  }

  // Section 4.2.3 step 6: anything with a colon after the first character is
  // either a compact IRI or already an IRI, and in both cases `@vocab` must not
  // be prepended to it. Testing `@vocab` first would turn `schema:name` into
  // `https://example.org/ns#schema:name`, which is the subtlest way to mint an
  // IRI nobody serves.
  const colon = value.indexOf(':')
  if (colon > 0) {
    const prefix = value.slice(0, colon)
    const suffix = value.slice(colon + 1)
    if (prefix === '_' || suffix.startsWith('//')) return value

    if (options.localContext && options.defined) {
      if (
        Object.prototype.hasOwnProperty.call(options.localContext, prefix) &&
        options.defined.get(prefix) !== true
      ) {
        createTermDefinition(active, options.localContext, prefix, options.defined, {
          instrumentation: options.instrumentation ?? NO_INSTRUMENTATION,
          pointer,
        })
      }
    }
    const prefixDefinition = active.terms.get(prefix)
    if (prefixDefinition?.iri && prefixDefinition.prefix) {
      const output = prefixDefinition.iri + suffix
      instrumentation?.onEvent({
        kind: 'iri-resolution',
        input: value,
        output,
        relative: false,
        vocab: false,
        pointer,
      })
      return output
    }
    // No prefix definition. Step 6.5 returns the value only when it has the
    // form of an IRI; `#Test:2` has a colon but no scheme, so it falls through
    // to base resolution below.
    if (isAbsoluteIri(value)) return value
  }

  if (value.startsWith('_:')) return value

  if (options.vocab && active.vocab !== undefined) {
    const output = active.vocab + value
    instrumentation?.onEvent({
      kind: 'iri-resolution',
      input: value,
      output,
      relative: false,
      vocab: true,
      pointer,
    })
    return output
  }

  if (options.documentRelative) {
    const output = resolveIri(active.baseIri, value)
    instrumentation?.onEvent({
      kind: 'iri-resolution',
      input: value,
      output,
      relative: output === value && !isAbsoluteIri(output),
      vocab: false,
      pointer,
    })
    return output
  }

  return value
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}
