/**
 * Parse a model file and resolve it into the IR.
 *
 * Resolution is total in the same sense expansion is: it reports what it could
 * not make sense of as findings and still produces the best IR it can, so the
 * canvas has something to draw while the file is wrong.
 *
 * @lat: [[metamodel#Metamodel]]
 */
import { FindingCollector } from '../findings/collector.js'
import type { Finding } from '../findings/finding.js'
import {
  isAbsoluteIri,
  isKeyword,
  isLegalPrefixName,
  isWellFormedLanguageTag,
  resolveIri,
  splitCompactIri,
} from '../iri/iri.js'
import { SourceIndex } from '../source/index-file.js'
import { pointerChild, pointerRoot, type JsonPointer } from '../source/pointer.js'
import { deriveElementId, isElementId } from './element-id.js'
import {
  CONTAINER_VALUES,
  type ContainerValue,
  type ExampleExpectation,
  type InlineContext,
  type Ir,
  type IrExample,
  type IrTerm,
  type IrUses,
  type IrView,
  type ProcessingMode,
} from './ir.js'

export const MODEL_FORMAT_VERSION = '1'

/** Facets JSON-LD 1.1 introduced. Under mode 1.0 each is a downgrade at its site. */
export const FACETS_ONLY_IN_1_1: readonly string[] = [
  '@protected',
  '@context',
  '@nest',
  '@prefix',
  '@direction',
  '@index',
]

/** Container values JSON-LD 1.1 introduced. */
const CONTAINERS_ONLY_IN_1_1: readonly ContainerValue[] = ['@id', '@type', '@graph']

export interface ResolveResult {
  /** `undefined` only when the file did not parse at all. */
  ir?: Ir
  findings: Finding[]
  source: SourceIndex
}

export interface ResolveOptions {
  /** Shown in findings. Defaults to the index's own path. */
  path?: string
}

export function resolveModelText(text: string, path: string): ResolveResult {
  return resolveModel(SourceIndex.parse(text, { path }))
}

export function resolveModel(source: SourceIndex, _options: ResolveOptions = {}): ResolveResult {
  const findings = new FindingCollector()

  for (const error of source.errors) {
    findings.add({
      ruleId: 'L0.unparseable',
      level: 'L0',
      severity: 'error',
      message: error.message,
      pointer: pointerRoot(),
      file: source.path,
      loc: error.range.from,
    })
  }

  const root = source.data
  if (root === undefined || root === null || typeof root !== 'object' || Array.isArray(root)) {
    if (source.errors.length === 0) {
      findings.raise(
        'L0.not-an-object',
        source,
        pointerRoot(),
        'A model file must contain a mapping at its root.',
      )
    }
    return { findings: findings.all(), source }
  }

  const model = root as Record<string, unknown>

  // ---- format version ----------------------------------------------------
  const format = typeof model['jsonld'] === 'string' ? (model['jsonld'] as string) : undefined
  if (format === undefined) {
    findings.raise(
      'L0.unknown-format-version',
      source,
      pointerRoot(),
      'A model must declare `jsonld` — the version of this format it is written against.',
    )
  } else if (format !== MODEL_FORMAT_VERSION) {
    findings.raise(
      'L0.unknown-format-version',
      source,
      pointerChild(pointerRoot(), 'jsonld'),
      `This tool knows model format "${MODEL_FORMAT_VERSION}"; the file declares "${format}".`,
      { subject: format },
    )
  }

  // ---- namespace ---------------------------------------------------------
  const nsPointer = pointerChild(pointerRoot(), 'namespace')
  const nsRaw = model['namespace']
  let namespace = { prefix: '', base: '' }
  if (nsRaw === undefined || nsRaw === null || typeof nsRaw !== 'object') {
    findings.raise(
      'L0.missing-namespace',
      source,
      nsPointer,
      'A model must declare a namespace: the prefix and base IRI that give its own terms their global identity.',
    )
  } else {
    const ns = nsRaw as Record<string, unknown>
    const prefix = typeof ns['prefix'] === 'string' ? (ns['prefix'] as string) : ''
    const base = typeof ns['base'] === 'string' ? (ns['base'] as string) : ''
    if (!prefix) {
      findings.raise(
        'L0.missing-namespace',
        source,
        pointerChild(nsPointer, 'prefix'),
        'The namespace must declare a prefix.',
      )
    }
    if (!base) {
      findings.raise(
        'L0.missing-namespace',
        source,
        pointerChild(nsPointer, 'base'),
        'The namespace must declare a base IRI.',
      )
    } else if (!isAbsoluteIri(base)) {
      findings.raise(
        'L1.malformed-iri',
        source,
        pointerChild(nsPointer, 'base'),
        `The namespace base must be an absolute IRI; "${base}" is not.`,
        { subject: base },
      )
    }
    namespace = { prefix, base }
  }

  // ---- project -------------------------------------------------------------
  let project: string | undefined
  if (model['project'] !== undefined) {
    if (typeof model['project'] === 'string' && model['project'] !== '') {
      project = model['project'] as string
    } else {
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointerRoot(), 'project'),
        '`project` must be the name of the project this model belongs to.',
      )
    }
  }

  // ---- mode --------------------------------------------------------------
  const modeRaw = model['mode']
  let mode: ProcessingMode = '1.1'
  if (modeRaw !== undefined) {
    if (modeRaw === '1.1' || modeRaw === '1.0') {
      mode = modeRaw
    } else {
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointerRoot(), 'mode'),
        `Processing mode must be "1.1" or "1.0"; found ${JSON.stringify(modeRaw)}.`,
      )
    }
  }

  // ---- prefixes ----------------------------------------------------------
  // Declared prefixes only; the namespace prefix is added to the *resolution*
  // set below rather than to the model's declarations.
  const prefixes: Record<string, string> = {}
  const prefixesPointer = pointerChild(pointerRoot(), 'prefixes')
  const prefixesRaw = model['prefixes']
  if (prefixesRaw !== undefined && prefixesRaw !== null) {
    if (typeof prefixesRaw !== 'object' || Array.isArray(prefixesRaw)) {
      findings.raise(
        'L0.schema-violation',
        source,
        prefixesPointer,
        '`prefixes` must be a mapping from prefix name to absolute IRI.',
      )
    } else {
      for (const [name, value] of Object.entries(prefixesRaw as Record<string, unknown>)) {
        const p = pointerChild(prefixesPointer, name)
        // The name, before the value: a prefix that cannot appear on the left of
        // a compact IRI is unusable however well-formed its IRI is.
        if (!isLegalPrefixName(name)) {
          findings.raise(
            'L0.schema-violation',
            source,
            p,
            `"${name}" is not a usable prefix name. A prefix begins with a letter or underscore and continues with letters, digits, "_", "." or "-".`,
            { subject: name },
          )
          continue
        }
        if (typeof value !== 'string') {
          findings.raise(
            'L0.schema-violation',
            source,
            p,
            `Prefix "${name}" must map to a string.`,
            { subject: name },
          )
          continue
        }
        if (!isAbsoluteIri(value)) {
          findings.raise(
            'L1.malformed-iri',
            source,
            p,
            `Prefix "${name}" must map to an absolute IRI; "${value}" is not.`,
            { subject: name },
          )
        }
        prefixes[name] = value
      }
    }
  }

  const resolving: Record<string, string> = { ...prefixes }
  if (namespace.prefix && namespace.base) resolving[namespace.prefix] ??= namespace.base

  // ---- vocab and base ----------------------------------------------------
  let vocab: string | undefined
  if (typeof model['vocab'] === 'string') {
    vocab = expandModelIri(
      model['vocab'] as string,
      resolving,
      undefined,
      source,
      pointerChild(pointerRoot(), 'vocab'),
      findings,
    )
  }
  let base: string | undefined
  if (typeof model['base'] === 'string') {
    base = model['base'] as string
    if (!isAbsoluteIri(base)) {
      findings.raise(
        'L1.malformed-iri',
        source,
        pointerChild(pointerRoot(), 'base'),
        `\`base\` must be an absolute IRI; "${base}" is not.`,
        { subject: base },
      )
    }
  }

  // ---- uses --------------------------------------------------------------
  const uses: IrUses[] = []
  const usesPointer = pointerChild(pointerRoot(), 'uses')
  const usesRaw = model['uses']
  if (Array.isArray(usesRaw)) {
    usesRaw.forEach((entry, i) => {
      const p = pointerChild(usesPointer, i)
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        findings.raise('L0.schema-violation', source, p, 'A `uses` entry must be a mapping.')
        return
      }
      const e = entry as Record<string, unknown>
      const iri = typeof e['iri'] === 'string' ? (e['iri'] as string) : undefined
      if (!iri) {
        findings.raise(
          'L0.schema-violation',
          source,
          p,
          'A `uses` entry must declare the context IRI it references.',
        )
        return
      }
      if (!isAbsoluteIri(iri)) {
        findings.raise(
          'L1.malformed-iri',
          source,
          pointerChild(p, 'iri'),
          `A referenced context must be named by an absolute IRI; "${iri}" is not.`,
          { subject: iri },
        )
      }
      uses.push({
        iri,
        ...(typeof e['integrity'] === 'string' ? { integrity: e['integrity'] as string } : {}),
        ...(typeof e['note'] === 'string' ? { note: e['note'] as string } : {}),
        pointer: p,
      })
    })
  } else if (usesRaw !== undefined && usesRaw !== null) {
    findings.raise('L0.schema-violation', source, usesPointer, '`uses` must be a sequence.')
  }

  // ---- terms -------------------------------------------------------------
  const takenIds = new Set<string>()
  const terms: IrTerm[] = []
  const termsPointer = pointerChild(pointerRoot(), 'terms')
  const termsRaw = model['terms']
  if (termsRaw === undefined || termsRaw === null) {
    findings.raise(
      'L0.schema-violation',
      source,
      termsPointer,
      'A model must declare `terms`, even if the map is empty.',
    )
  } else if (typeof termsRaw !== 'object' || Array.isArray(termsRaw)) {
    findings.raise(
      'L0.schema-violation',
      source,
      termsPointer,
      '`terms` must be a flat map from JSON key to term definition.',
    )
  } else {
    for (const [key, raw] of Object.entries(termsRaw as Record<string, unknown>)) {
      const term = resolveTerm(
        key,
        raw,
        pointerChild(termsPointer, key),
        { prefixes: resolving, vocab, namespace, mode },
        source,
        findings,
        takenIds,
      )
      if (term) terms.push(term)
    }
  }

  // A duplicate key does not survive YAML's own mapping, so it is detected on
  // the token stream rather than on the parsed value.
  reportDuplicateTermKeys(source, termsPointer, findings)

  // ---- examples ----------------------------------------------------------
  const examples: IrExample[] = []
  const examplesPointer = pointerChild(pointerRoot(), 'examples')
  const examplesRaw = model['examples']
  if (Array.isArray(examplesRaw)) {
    examplesRaw.forEach((entry, i) => {
      const example = resolveExample(
        entry,
        pointerChild(examplesPointer, i),
        source,
        findings,
        takenIds,
      )
      if (example) examples.push(example)
    })
  } else if (examplesRaw !== undefined && examplesRaw !== null) {
    findings.raise('L0.schema-violation', source, examplesPointer, '`examples` must be a sequence.')
  }

  // ---- views -------------------------------------------------------------
  const views: IrView[] = []
  const viewsPointer = pointerChild(pointerRoot(), 'views')
  const viewsRaw = model['views']
  if (Array.isArray(viewsRaw)) {
    viewsRaw.forEach((entry, i) => {
      const p = pointerChild(viewsPointer, i)
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        findings.raise('L0.schema-violation', source, p, 'A view must be a mapping.')
        return
      }
      const v = entry as Record<string, unknown>
      const name = typeof v['name'] === 'string' ? (v['name'] as string) : undefined
      if (!name) {
        findings.raise('L0.schema-violation', source, p, 'A view must declare a name.')
        return
      }
      const identity = identityOf(v['id'], 'view', name, p, source, findings, takenIds)
      const declared = Array.isArray(v['terms'])
        ? (v['terms'] as unknown[]).filter((t): t is string => typeof t === 'string')
        : []
      // A view names terms of exactly one model. A name the model does not
      // declare is a term that will never appear on any diagram, which is the
      // opposite of what a view is for.
      for (const termKey of declared) {
        if (terms.some((t) => t.key === termKey)) continue
        findings.raise(
          'L0.view-unknown-term',
          source,
          p,
          `The view "${name}" names "${termKey}", which this model does not declare. A view names terms of exactly one model.`,
          { subject: termKey },
        )
      }

      views.push({
        ...identity,
        name,
        ...(typeof v['note'] === 'string' ? { note: v['note'] as string } : {}),
        terms: declared,
        pointer: p,
      })
    })
  } else if (viewsRaw !== undefined && viewsRaw !== null) {
    findings.raise('L0.schema-violation', source, viewsPointer, '`views` must be a sequence.')
  }

  const ir: Ir = {
    format: format ?? MODEL_FORMAT_VERSION,
    ...(project !== undefined ? { project } : {}),
    namespace,
    mode,
    ...(vocab !== undefined ? { vocab } : {}),
    ...(base !== undefined ? { base } : {}),
    prefixes,
    uses,
    terms,
    examples,
    views,
    source: source.path,
  }

  return { ir, findings: findings.all(), source }
}

interface TermScope {
  prefixes: Record<string, string>
  vocab: string | undefined
  namespace: { prefix: string; base: string }
  mode: ProcessingMode
}

function resolveTerm(
  key: string,
  raw: unknown,
  pointer: JsonPointer,
  scope: TermScope,
  source: SourceIndex,
  findings: FindingCollector,
  takenIds: Set<string>,
): IrTerm | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    findings.raise(
      'L0.schema-violation',
      source,
      pointer,
      `The definition of term "${key}" must be a mapping; found ${describe(raw)}.`,
      { subject: key },
    )
    return undefined
  }
  const def = raw as Record<string, unknown>
  const identity = identityOf(def['id'], 'term', key, pointer, source, findings, takenIds)

  const term: IrTerm = {
    ...identity,
    key,
    iri: null,
    pointer,
  }

  // @id
  if ('@id' in def) {
    const value = def['@id']
    if (value === null) {
      term['@id'] = null
      term.iri = null
    } else if (typeof value === 'string') {
      term['@id'] = value
      term.iri = expandModelIri(
        value,
        scope.prefixes,
        scope.vocab,
        source,
        pointerChild(pointer, '@id'),
        findings,
        key,
      )
      if (term.iri === value && value === key) {
        findings.raise(
          'L1.cyclic-iri-mapping',
          source,
          pointerChild(pointer, '@id'),
          `Term "${key}" maps to itself and resolves to nothing.`,
          { subject: key },
        )
      }
    } else {
      findings.raise(
        'L1.invalid-term-definition',
        source,
        pointerChild(pointer, '@id'),
        `\`@id\` on term "${key}" must be a string or null.`,
        { subject: key },
      )
    }
  }

  // @reverse
  if ('@reverse' in def) {
    const value = def['@reverse']
    if (typeof value !== 'string') {
      findings.raise(
        'L1.invalid-reverse-property',
        source,
        pointerChild(pointer, '@reverse'),
        `\`@reverse\` on term "${key}" must be a string.`,
        { subject: key },
      )
    } else {
      term['@reverse'] = value
      if ('@id' in def) {
        findings.raise(
          'L1.invalid-reverse-property',
          source,
          pointer,
          `Term "${key}" declares both \`@id\` and \`@reverse\`; a term may carry only one.`,
          { subject: key },
        )
      }
      term.iri = expandModelIri(
        value,
        scope.prefixes,
        scope.vocab,
        source,
        pointerChild(pointer, '@reverse'),
        findings,
        key,
      )
    }
  }

  // Neither @id nor @reverse: the IRI comes from @vocab, or from the model's own
  // namespace, which is what makes a bare term declaration useful.
  if (!('@id' in def) && !('@reverse' in def)) {
    if (scope.vocab) {
      term.iri = scope.vocab + key
    } else if (scope.namespace.base) {
      term.iri = scope.namespace.base + key
    } else {
      findings.raise(
        'L1.invalid-term-definition',
        source,
        pointer,
        `Term "${key}" declares no \`@id\` and the model declares neither \`vocab\` nor a namespace base to derive one from.`,
        { subject: key },
      )
    }
  }

  // @type
  if ('@type' in def) {
    const value = def['@type']
    if (value === null) {
      term['@type'] = null
    } else if (typeof value !== 'string') {
      findings.raise(
        'L1.invalid-type-mapping',
        source,
        pointerChild(pointer, '@type'),
        `\`@type\` on term "${key}" must be a string or null.`,
        { subject: key },
      )
    } else if (value === '@id' || value === '@vocab' || value === '@json' || value === '@none') {
      term['@type'] = value
    } else if (isKeyword(value)) {
      findings.raise(
        'L1.invalid-type-mapping',
        source,
        pointerChild(pointer, '@type'),
        `\`@type: ${value}\` on term "${key}" is not a legal type mapping.`,
        { subject: key },
      )
    } else {
      term['@type'] = value
      expandModelIri(
        value,
        scope.prefixes,
        scope.vocab,
        source,
        pointerChild(pointer, '@type'),
        findings,
        key,
      )
    }
  }

  // @container
  if ('@container' in def) {
    const value = def['@container']
    const p = pointerChild(pointer, '@container')
    if (value === null) {
      term['@container'] = null
    } else {
      const list = Array.isArray(value) ? value : [value]
      const valid: ContainerValue[] = []
      for (const item of list) {
        if (typeof item === 'string' && (CONTAINER_VALUES as readonly string[]).includes(item)) {
          valid.push(item as ContainerValue)
        } else {
          findings.raise(
            'L1.invalid-container-mapping',
            source,
            p,
            `\`@container: ${JSON.stringify(item)}\` on term "${key}" is not a container value the specification allows.`,
            { subject: key },
          )
        }
      }
      if (!isLegalContainerCombination(valid)) {
        findings.raise(
          'L1.invalid-container-mapping',
          source,
          p,
          `The container combination ${JSON.stringify(valid)} on term "${key}" is not allowed.`,
          { subject: key },
        )
      }
      // Sorted so the IR is canonical regardless of how the author wrote it.
      term['@container'] = [...valid].sort()
      if (scope.mode === '1.0') {
        for (const c of valid) {
          if (CONTAINERS_ONLY_IN_1_1.includes(c)) {
            findings.raise(
              'L1.facet-not-in-mode',
              source,
              p,
              `\`@container: ${c}\` is defined only in JSON-LD 1.1; this model targets 1.0, where a 1.0 processor ignores the container and reads values as plain ${c === '@graph' ? 'nodes' : 'values'}.`,
              { subject: key },
            )
          }
        }
      }
    }
  }

  // @language
  if ('@language' in def) {
    const value = def['@language']
    if (value === null) {
      term['@language'] = null
    } else if (typeof value !== 'string') {
      findings.raise(
        'L1.invalid-language-mapping',
        source,
        pointerChild(pointer, '@language'),
        `\`@language\` on term "${key}" must be a string or null.`,
        { subject: key },
      )
    } else if (!isWellFormedLanguageTag(value)) {
      findings.raise(
        'L1.invalid-language-mapping',
        source,
        pointerChild(pointer, '@language'),
        `"${value}" is not a well-formed language tag.`,
        { subject: key },
      )
      term['@language'] = value
    } else {
      term['@language'] = value
    }
  }

  // @direction
  if ('@direction' in def) {
    const value = def['@direction']
    if (value === null || value === 'ltr' || value === 'rtl') {
      term['@direction'] = value as 'ltr' | 'rtl' | null
    } else {
      findings.raise(
        'L1.invalid-term-definition',
        source,
        pointerChild(pointer, '@direction'),
        `\`@direction\` on term "${key}" must be "ltr", "rtl" or null.`,
        { subject: key },
      )
    }
  }

  // @protected, @prefix
  for (const flag of ['@protected', '@prefix'] as const) {
    if (flag in def) {
      const value = def[flag]
      if (typeof value !== 'boolean') {
        findings.raise(
          'L1.invalid-term-definition',
          source,
          pointerChild(pointer, flag),
          `\`${flag}\` on term "${key}" must be a boolean.`,
          { subject: key },
        )
      } else {
        term[flag] = value
      }
    }
  }

  // @nest, @index
  for (const facet of ['@nest', '@index'] as const) {
    if (facet in def) {
      const value = def[facet]
      if (typeof value !== 'string') {
        findings.raise(
          'L1.invalid-term-definition',
          source,
          pointerChild(pointer, facet),
          `\`${facet}\` on term "${key}" must be a string.`,
          { subject: key },
        )
      } else {
        term[facet] = value
      }
    }
  }

  // @context — the scoped context, recorded on the IR as attached to this term.
  if ('@context' in def) {
    const value = def['@context']
    if (isInlineContext(value)) {
      term['@context'] = value
    } else {
      findings.raise(
        'L1.invalid-scoped-context',
        source,
        pointerChild(pointer, '@context'),
        `The scoped context on term "${key}" must be null, an IRI, a mapping, or a sequence of those.`,
        { subject: key },
      )
    }
  }

  if ('raw' in def) {
    const value = def['raw']
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointer, 'raw'),
        `\`raw\` on term "${key}" must be a mapping.`,
        { subject: key },
      )
    } else {
      term.raw = value as Record<string, unknown>
    }
  }

  if (typeof def['note'] === 'string') term.note = def['note'] as string

  // Mode-1.0 downgrades on the remaining facets.
  if (scope.mode === '1.0') {
    for (const facet of FACETS_ONLY_IN_1_1) {
      if (facet in def) {
        findings.raise(
          'L1.facet-not-in-mode',
          source,
          pointerChild(pointer, facet),
          `\`${facet}\` is defined only in JSON-LD 1.1; this model targets 1.0, where a 1.0 processor ignores it and ${downgradeConsequence(facet)}.`,
          { subject: key },
        )
      }
    }
  }

  // Unknown keys: the schema catches these in the editor, but the CLI must too.
  for (const k of Object.keys(def)) {
    if (KNOWN_TERM_KEYS.has(k)) continue
    findings.raise(
      'L0.schema-violation',
      source,
      pointerChild(pointer, k),
      `\`${k}\` is not a facet the model format defines. Put it under \`raw\` if a JSON-LD processor should see it.`,
      { subject: key },
    )
  }

  return term
}

const KNOWN_TERM_KEYS = new Set([
  'id',
  'note',
  'raw',
  '@id',
  '@type',
  '@container',
  '@language',
  '@direction',
  '@protected',
  '@context',
  '@nest',
  '@reverse',
  '@prefix',
  '@index',
])

function downgradeConsequence(facet: string): string {
  switch (facet) {
    case '@protected':
      return 'a later context may redefine the term freely'
    case '@context':
      return 'the scoped context never takes effect, so the term keeps its outer meaning everywhere'
    case '@nest':
      return 'the nesting key is treated as an ordinary key and is dropped'
    case '@prefix':
      return 'the term may still be used as a compact-IRI prefix, which 1.1 would have refused'
    case '@direction':
      return 'the base direction is lost from every value'
    case '@index':
      return 'the index property is not preserved as a triple'
    default:
      return 'the facet has no effect'
  }
}

function isLegalContainerCombination(values: readonly ContainerValue[]): boolean {
  if (values.length <= 1) return true
  const set = new Set(values)
  // `@graph` may combine with `@id` or `@index`, and either with `@set`.
  const withoutSet = new Set(values.filter((v) => v !== '@set'))
  if (set.has('@list')) return false // @list combines with nothing
  if (withoutSet.size <= 1) return true
  if (withoutSet.has('@graph') && withoutSet.size === 2) {
    return withoutSet.has('@id') || withoutSet.has('@index')
  }
  return false
}

function isInlineContext(value: unknown): value is InlineContext {
  if (value === null) return true
  if (typeof value === 'string') return true
  if (Array.isArray(value)) {
    return value.every(
      (v) => v === null || typeof v === 'string' || (typeof v === 'object' && !Array.isArray(v)),
    )
  }
  return typeof value === 'object'
}

function resolveExample(
  raw: unknown,
  pointer: JsonPointer,
  source: SourceIndex,
  findings: FindingCollector,
  takenIds: Set<string>,
): IrExample | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    findings.raise('L0.schema-violation', source, pointer, 'An example must be a mapping.')
    return undefined
  }
  const e = raw as Record<string, unknown>
  const path = typeof e['path'] === 'string' ? (e['path'] as string) : undefined
  if (!path) {
    findings.raise(
      'L0.schema-violation',
      source,
      pointer,
      'An example must declare the path of the document it names.',
    )
    return undefined
  }

  const expectPointer = pointerChild(pointer, 'expect')
  const expectRaw = e['expect']
  let expect: ExampleExpectation | undefined
  if (expectRaw === null || typeof expectRaw !== 'object' || Array.isArray(expectRaw)) {
    findings.raise(
      'L0.schema-violation',
      source,
      expectPointer,
      `Example "${path}" must record the outcome validating it produces. An example without an expectation cannot fail usefully.`,
      { subject: path },
    )
  } else {
    const x = expectRaw as Record<string, unknown>
    if (x['ok'] === true) {
      const max = x['maxSeverity']
      expect = {
        kind: 'positive',
        // `info` by default. Lossiness is a warning, and it is the thing this
        // tool exists to catch — a default that tolerated it would make the
        // flagship finding non-failing in continuous integration. An author who
        // means to tolerate one says so.
        maxSeverity: max === 'info' || max === 'warning' || max === 'error' ? max : 'info',
      }
    } else if (Array.isArray(x['rules'])) {
      const rules = (x['rules'] as unknown[]).filter((r): r is string => typeof r === 'string')
      if (rules.length === 0) {
        findings.raise(
          'L0.schema-violation',
          source,
          expectPointer,
          `Negative example "${path}" must name at least one rule id. A negative example that merely fails passes even when it fails for the wrong reason.`,
          { subject: path },
        )
      } else {
        expect = { kind: 'negative', rules: [...rules].sort() }
      }
    } else {
      findings.raise(
        'L0.schema-violation',
        source,
        expectPointer,
        `Example "${path}" must declare either \`ok: true\` or a list of \`rules\` it must raise.`,
        { subject: path },
      )
    }
  }

  if (!expect) return undefined

  const identity = identityOf(e['id'], 'example', path, pointer, source, findings, takenIds)
  return {
    ...identity,
    path,
    ...(typeof e['note'] === 'string' ? { note: e['note'] as string } : {}),
    expect,
    pointer,
  }
}

function identityOf(
  raw: unknown,
  kind: string,
  key: string,
  pointer: JsonPointer,
  source: SourceIndex,
  findings: FindingCollector,
  takenIds: Set<string>,
): { id: string; idWritten: boolean } {
  if (raw !== undefined && raw !== null) {
    const written = String(raw)
    if (!isElementId(written)) {
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointer, 'id'),
        `"${written}" is not a well-formed element id (six to twelve lowercase letters or digits).`,
        { subject: key },
      )
    } else if (takenIds.has(written)) {
      findings.raise(
        'L0.duplicate-element-id',
        source,
        pointerChild(pointer, 'id'),
        `Element id "${written}" is already used by another element.`,
        { subject: key },
      )
    } else {
      takenIds.add(written)
      return { id: written, idWritten: true }
    }
  }
  const derived = deriveElementId(kind, key)
  takenIds.add(derived)
  return { id: derived, idWritten: false }
}

/**
 * A duplicate key does not survive `toJS`, so the second occurrence is found by
 * re-reading the mapping's own items.
 */
function reportDuplicateTermKeys(
  source: SourceIndex,
  termsPointer: JsonPointer,
  findings: FindingCollector,
): void {
  // Pointer indexing keeps only the first occurrence of a key, so a duplicate is
  // found by re-reading the key tokens at the terms level in the raw document.
  const seen = new Set<string>()
  const keys = termKeyOccurrences(source)
  for (const { key, offset } of keys) {
    if (seen.has(key)) {
      const loc = source.offsetToPosition(offset)
      findings.add({
        ruleId: 'L0.duplicate-term-key',
        level: 'L0',
        severity: 'error',
        message: `Term "${key}" is declared twice. One key means one thing: a context has exactly one entry for it.`,
        pointer: pointerChild(termsPointer, key),
        file: source.path,
        loc,
        subject: key,
      })
    }
    seen.add(key)
  }
}

/**
 * Every key token directly under `terms:`, with its offset, in document order.
 * Found by indentation, because a duplicate key is gone from the parsed value by
 * the time the resolver sees it.
 */
function termKeyOccurrences(source: SourceIndex): Array<{ key: string; offset: number }> {
  const lines = source.text.split('\n')
  const out: Array<{ key: string; offset: number }> = []
  let offset = 0
  let inTerms = false
  let termsIndent = -1
  let keyIndent = -1
  for (const line of lines) {
    const lineOffset = offset
    offset += line.length + 1
    const trimmed = line.trimEnd()
    if (trimmed === '' || /^\s*#/.test(trimmed)) continue
    const indent = line.length - line.trimStart().length
    if (!inTerms) {
      if (/^terms:\s*$/.test(trimmed) && indent === 0) {
        inTerms = true
        termsIndent = indent
      }
      continue
    }
    if (indent <= termsIndent) break
    if (keyIndent === -1) keyIndent = indent
    if (indent !== keyIndent) continue
    const m = /^(\s*)(?:"([^"]*)"|'([^']*)'|([^:#\s][^:#]*?))\s*:/.exec(line)
    if (!m) continue
    const key = m[2] ?? m[3] ?? m[4]
    if (key === undefined) continue
    out.push({ key: key.trim(), offset: lineOffset + m[1]!.length })
  }
  return out
}

/**
 * Expand an IRI written in a model: a keyword passes through, a compact IRI is
 * resolved against the declared prefixes, and anything else is resolved against
 * `@vocab`.
 */
function expandModelIri(
  value: string,
  prefixes: Record<string, string>,
  vocab: string | undefined,
  source: SourceIndex,
  pointer: JsonPointer,
  findings: FindingCollector,
  subject?: string,
): string {
  if (isKeyword(value)) return value
  if (value.startsWith('_:')) return value

  // The compact-IRI reading is tried before the absolute-IRI one, because
  // `schema:author` satisfies both and the declared prefix is what the author
  // meant. Testing for an absolute IRI first would silently mint
  // `schema:author` as its own scheme.
  const compact = splitCompactIri(value)
  if (compact) {
    const mapped = prefixes[compact.prefix]
    if (mapped !== undefined) return mapped + compact.suffix
    // No declared prefix. A known URI scheme is an absolute IRI the author
    // wrote deliberately; anything else is a prefix they forgot to declare,
    // which JSON-LD would otherwise accept as an IRI nobody serves.
    if (!KNOWN_URI_SCHEMES.has(compact.prefix.toLowerCase())) {
      findings.raise(
        'L1.unknown-prefix',
        source,
        pointer,
        `"${value}" uses the prefix "${compact.prefix}", which this model does not declare. JSON-LD would read it as an absolute IRI in the "${compact.prefix}" scheme.`,
        subject !== undefined ? { subject } : {},
      )
    }
    return value
  }

  if (isAbsoluteIri(value)) return value
  if (vocab) return resolveIri(vocab, value)
  return value
}

/**
 * Schemes a model may legitimately name without declaring a prefix. Anything
 * else with a colon in it is read as a compact IRI whose prefix is missing.
 */
const KNOWN_URI_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'urn',
  'did',
  'mailto',
  'file',
  'ftp',
  'ftps',
  'tag',
  'data',
  'ws',
  'wss',
  'tel',
  'geo',
  'info',
  'doi',
])

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a sequence'
  return typeof value
}
