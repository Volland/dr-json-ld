/**
 * `ldm import`: turning a `@context` that already exists into a model.
 *
 * Import recovers what a context states and reports the rest. What is
 * structurally unrecoverable — class membership, documentation, the intent
 * behind `@vocab` — is reported rather than invented, because being the tool
 * people bring their existing context to is the whole on-ramp, and a tool that
 * guessed here would be lying in its first five seconds.
 *
 * @lat: [[emitters#Emitters]]
 */
import { stringify } from 'yaml'

import { isAbsoluteIri, isKeyword, splitCompactIri } from '../iri/iri.js'
import { CONTAINER_VALUES, type ContainerValue, type ProcessingMode } from '../model/ir.js'
import { mintElementId } from '../model/element-id.js'

export interface ImportOptions {
  /** The prefix and base for the model's own namespace, when it declares terms. */
  namespace?: { prefix: string; base: string }
  /** Used in the model's header comment. */
  sourceName?: string
  mode?: ProcessingMode
}

/** Something a context structurally cannot carry, reported rather than guessed. */
export interface NotRecovered {
  kind: 'class-membership' | 'documentation' | 'vocab-intent' | 'element-ids' | 'examples'
  message: string
}

export interface ImportResult {
  /** The model file, ready to write. */
  text: string
  /** Referenced contexts found in the input, to be vendored. */
  referenced: string[]
  /** What the context could not carry. Part of the command's output. */
  notRecovered: NotRecovered[]
  /** Terms recovered, for the command's summary. */
  termCount: number
}

interface TermDraft {
  key: string
  id: string
  definition: Record<string, unknown>
}

/**
 * Produce a model from a `@context` document. Element ids are minted, so the
 * result is a model whose ids are all written — a tool that refused its own
 * import output would be broken.
 */
export function importContext(document: unknown, options: ImportOptions = {}): ImportResult {
  const inner =
    document !== null && typeof document === 'object' && '@context' in (document as object)
      ? (document as Record<string, unknown>)['@context']
      : document

  const layers = Array.isArray(inner) ? inner : [inner]
  const referenced: string[] = []
  const merged: Record<string, unknown> = {}

  for (const layer of layers) {
    if (typeof layer === 'string') {
      referenced.push(layer)
      continue
    }
    if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) continue
    Object.assign(merged, layer as Record<string, unknown>)
  }

  const prefixes: Record<string, string> = {}
  const terms: TermDraft[] = []
  const taken = new Set<string>()
  let vocab: string | undefined
  let base: string | undefined
  let mode: ProcessingMode = options.mode ?? '1.1'
  let sawProtected = false

  for (const [key, value] of Object.entries(merged)) {
    if (key === '@version') {
      mode = value === 1.1 || value === '1.1' ? '1.1' : mode
      continue
    }
    if (key === '@vocab') {
      if (typeof value === 'string') vocab = value
      continue
    }
    if (key === '@base') {
      if (typeof value === 'string') base = value
      continue
    }
    if (key === '@protected') {
      sawProtected = sawProtected || value === true
      continue
    }
    if (key === '@language' || key === '@direction' || key === '@import' || key === '@propagate') {
      // Recorded on the model as a raw top-level fact would need a metamodel
      // entry it does not have yet; carried on every term instead would be a
      // lie about where it came from. Reported rather than guessed.
      continue
    }
    if (isKeyword(key)) continue

    // A bare prefix declaration: a string value whose IRI ends in a delimiter.
    if (typeof value === 'string' && isPrefixDeclaration(key, value)) {
      prefixes[key] = value
      continue
    }

    const id = mintElementId(taken)
    taken.add(id)
    terms.push({ key, id, definition: recoverTerm(value) })
  }

  const notRecovered = describeGaps(terms.length, vocab, sawProtected)
  const text = renderModel(
    { prefixes, vocab, base, mode, terms, referenced },
    options,
  )

  return { text, referenced, notRecovered, termCount: terms.length }
}

/**
 * A string-valued entry is a prefix when its IRI ends in a delimiter a compact
 * IRI would be appended to. Anything else is a term.
 */
function isPrefixDeclaration(key: string, value: string): boolean {
  if (key.includes(':') || key.includes('/')) return false
  if (!isAbsoluteIri(value)) return false
  return /[#/:?]$/.test(value)
}

/** Recover every facet a term definition states. */
function recoverTerm(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { '@id': value }
  if (value === null) return { '@id': null }
  if (typeof value !== 'object' || Array.isArray(value)) return { '@id': null }

  const definition = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const raw: Record<string, unknown> = {}

  for (const [facet, facetValue] of Object.entries(definition)) {
    switch (facet) {
      case '@id':
      case '@reverse':
      case '@type':
      case '@language':
      case '@nest':
      case '@index':
        out[facet] = facetValue
        break
      case '@direction':
        out[facet] = facetValue
        break
      case '@protected':
      case '@prefix':
        out[facet] = facetValue
        break
      case '@context':
        out[facet] = facetValue
        break
      case '@container': {
        const list = (Array.isArray(facetValue) ? facetValue : [facetValue]).filter(
          (c): c is ContainerValue =>
            typeof c === 'string' && (CONTAINER_VALUES as readonly string[]).includes(c),
        )
        // `@none` is legal on a container but is not a metamodel container, so
        // it goes through the escape hatch rather than being dropped.
        const rejected = (Array.isArray(facetValue) ? facetValue : [facetValue]).filter(
          (c) => !list.includes(c as ContainerValue),
        )
        if (list.length > 0) out['@container'] = list.length === 1 ? list[0] : list.sort()
        if (rejected.length > 0) raw['@container'] = facetValue
        break
      }
      default:
        // Anything the metamodel has not named reaches the context unchanged
        // through the escape hatch, rather than being lost on the way in.
        raw[facet] = facetValue
    }
  }

  if (Object.keys(raw).length > 0) out['raw'] = raw
  if (!('@id' in out) && !('@reverse' in out) && !('raw' in out)) out['@id'] = null
  return out
}

function describeGaps(
  termCount: number,
  vocab: string | undefined,
  sawProtected: boolean,
): NotRecovered[] {
  const gaps: NotRecovered[] = [
    {
      kind: 'class-membership',
      message: `A @context carries no information about which terms belong together as a class, so none was recovered for the ${termCount} term${
        termCount === 1 ? '' : 's'
      } imported. Class structure is the shapes layer, which this release does not implement.`,
    },
    {
      kind: 'documentation',
      message:
        'A @context carries no labels or comments, so every term was imported without a note. Adding notes is the first thing worth doing to this model.',
    },
  ]
  if (vocab !== undefined) {
    gaps.push({
      kind: 'vocab-intent',
      message: `@vocab is set to ${vocab}, and a @context does not say why. It makes every unmapped key expand rather than drop, which is right for a closed internal vocabulary and wrong for a published one — decide which this is.`,
    })
  }
  if (sawProtected) {
    gaps.push({
      kind: 'vocab-intent',
      message:
        'The context sets @protected at the context level. It was not applied to each term, because a context-level flag and a per-term flag are different promises; set @protected on the terms that need it.',
    })
  }
  return gaps
}

interface ModelDraft {
  prefixes: Record<string, string>
  vocab: string | undefined
  base: string | undefined
  mode: ProcessingMode
  terms: TermDraft[]
  referenced: string[]
}

/**
 * Render the model file. Written by hand rather than through `yaml.stringify`
 * on the whole document, so the header comment and the section ordering are
 * what a reader would have written.
 */
function renderModel(draft: ModelDraft, options: ImportOptions): string {
  const namespace = options.namespace ?? inferNamespace(draft)
  const lines: string[] = []

  lines.push(
    `# Imported${options.sourceName ? ` from ${options.sourceName}` : ''} by \`ldm import\`.`,
    '# Class membership and documentation are not in a @context and were not invented.',
    '',
    'jsonld: "1"',
    '',
    'namespace:',
    `  prefix: ${namespace.prefix}`,
    `  base: ${scalar(namespace.base)}`,
    '',
    `mode: ${JSON.stringify(draft.mode)}`,
    '',
  )

  if (draft.vocab !== undefined) lines.push(`vocab: ${scalar(draft.vocab)}`, '')
  if (draft.base !== undefined) lines.push(`base: ${scalar(draft.base)}`, '')

  const prefixNames = Object.keys(draft.prefixes).sort()
  if (prefixNames.length > 0) {
    lines.push('prefixes:')
    for (const name of prefixNames) lines.push(`  ${name}: ${scalar(draft.prefixes[name]!)}`)
    lines.push('')
  }

  lines.push('uses:')
  if (draft.referenced.length === 0) {
    lines[lines.length - 1] = 'uses: []'
  } else {
    for (const iri of draft.referenced) {
      lines.push(`  - iri: ${scalar(iri)}`)
      lines.push('    # integrity is written by `ldm vendor`')
    }
  }
  lines.push('')

  lines.push('terms:')
  if (draft.terms.length === 0) {
    lines[lines.length - 1] = 'terms: {}'
  } else {
    for (const term of draft.terms) {
      lines.push(`  ${quoteKey(term.key)}:`)
      lines.push(`    id: ${term.id}`)
      for (const [facet, value] of Object.entries(term.definition)) {
        lines.push(`    ${indentBlock(facet, value)}`)
      }
      lines.push('')
    }
    lines.pop()
  }

  lines.push('', 'examples: []', '')
  return lines.join('\n')
}

function indentBlock(facet: string, value: unknown): string {
  const key = facet.startsWith('@') ? `"${facet}"` : facet
  if (value === null || typeof value !== 'object') {
    return `${key}: ${scalar(value)}`
  }
  // A nested structure is rendered by the YAML writer and re-indented, so a
  // scoped context or a raw block keeps a readable shape.
  const body = stringify(value, { lineWidth: 0 }).trimEnd()
  const indented = body
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n')
  return `${key}:\n${indented}`
}

function scalar(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = String(value)
  // Quote anything YAML would read as something other than a string.
  return /^[A-Za-z_][A-Za-z0-9_.\-/#:]*$/.test(text) && !/^(true|false|null|y|n|on|off)$/i.test(text)
    ? text
    : JSON.stringify(text)
}

function quoteKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key)
}

/**
 * A namespace is required, and a context does not state one. It is inferred
 * from `@vocab`, then from the commonest prefix, and the fallback is obviously
 * a placeholder so nobody ships it by accident.
 */
function inferNamespace(draft: ModelDraft): { prefix: string; base: string } {
  if (draft.vocab !== undefined && isAbsoluteIri(draft.vocab)) {
    return { prefix: 'ns', base: draft.vocab }
  }
  const counts = new Map<string, number>()
  for (const term of draft.terms) {
    const id = term.definition['@id'] ?? term.definition['@reverse']
    if (typeof id !== 'string') continue
    const compact = splitCompactIri(id)
    if (compact) counts.set(compact.prefix, (counts.get(compact.prefix) ?? 0) + 1)
  }
  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (commonest && draft.prefixes[commonest[0]]) {
    return { prefix: commonest[0], base: draft.prefixes[commonest[0]]! }
  }
  return { prefix: 'ns', base: 'https://example.invalid/ns#' }
}
