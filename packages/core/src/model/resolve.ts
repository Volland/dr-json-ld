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
import { pointerChild, pointerRoot, pointerTokens, type JsonPointer } from '../source/pointer.js'
import { resolveShapeFields } from '../shapes/fields.js'
import { deriveElementId, isElementId } from './element-id.js'
import {
  CONTAINER_VALUES,
  type ContainerValue,
  type ExampleExpectation,
  type InlineContext,
  type Ir,
  type IrExample,
  type IrField,
  type IrRange,
  type IrScopedContext,
  type IrShape,
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
      const scoped: IrTerm[] = []
      const term = resolveTerm(
        key,
        raw,
        pointerChild(termsPointer, key),
        { prefixes: resolving, vocab, namespace, mode, enclosing: [] },
        source,
        findings,
        takenIds,
        scoped,
      )
      if (term) terms.push(term, ...scoped)
    }
  }

  // A duplicate key does not survive YAML's own mapping, so it is detected on
  // the token stream rather than on the parsed value.
  reportDuplicateTermKeys(source, termsPointer, findings)
  reportDuplicateScopedKeys(source, findings)

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

  // ---- shapes ------------------------------------------------------------
  const shapes = resolveShapes(model['shapes'], {
    terms,
    prefixes: resolving,
    vocab,
    source,
    findings,
    takenIds,
  })

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
      const declaredShapes = Array.isArray(v['shapes'])
        ? (v['shapes'] as unknown[]).filter((t): t is string => typeof t === 'string')
        : undefined
      for (const shapeName of declaredShapes ?? []) {
        if (shapes.some((shape) => shape.name === shapeName)) continue
        findings.raise(
          'L0.view-unknown-shape',
          source,
          pointerChild(p, 'shapes'),
          `The view "${name}" names the shape "${shapeName}", which this model does not declare.`,
          { subject: shapeName },
        )
      }
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
        ...(declaredShapes !== undefined ? { shapes: declaredShapes } : {}),
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
    shapes,
    examples,
    views,
    source: source.path,
  }
  // Field keys resolve the way a processor resolves them, which needs the IR's
  // own context; referenced contexts are consulted later, where they are
  // available (see `resolveShapeFields`).
  ir.shapes = resolveShapeFields(ir)

  return { ir, findings: findings.all(), source }
}

interface TermScope {
  prefixes: Record<string, string>
  vocab: string | undefined
  namespace: { prefix: string; base: string }
  mode: ProcessingMode
  /**
   * The keys of the terms whose `@context` maps enclose this one, outermost
   * first. Empty for a top-level term.
   */
  enclosing: string[]
}

/** Keyword entries a scoped context map may carry as settings rather than terms. */
function isContextSetting(key: string): boolean {
  return key.startsWith('@')
}

function resolveTerm(
  key: string,
  raw: unknown,
  pointer: JsonPointer,
  scope: TermScope,
  source: SourceIndex,
  findings: FindingCollector,
  takenIds: Set<string>,
  scopedOut: IrTerm[],
  parentId?: string,
): IrTerm | undefined {
  const isScoped = scope.enclosing.length > 0
  // Inside a scoped context a term definition may be written the way a context
  // writes it: a bare IRI, or null to decouple the key.
  if (isScoped && (raw === null || typeof raw === 'string')) raw = { '@id': raw }
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
  // A scoped term's derived id folds in the keys enclosing it, so `name` under
  // `publisher` and the top-level `name` are two elements, not a collision.
  const identity = identityOf(def['id'], 'term', key, pointer, source, findings, takenIds, [
    ...scope.enclosing,
    key,
  ])

  const term: IrTerm = {
    ...identity,
    key,
    ...(parentId !== undefined ? { scope: { parent: parentId } } : {}),
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
  // namespace, which is what makes a bare term declaration useful. A scoped term
  // has no namespace fallback: it is emitted as written, and a processor reads
  // an `@id`-less definition against `@vocab` alone.
  if (!('@id' in def) && !('@reverse' in def)) {
    if (scope.vocab) {
      term.iri = scope.vocab + key
    } else if (isScoped) {
      term.iri = null
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

  // @context — the scoped context. A map is resolved into scoped terms of their
  // own; an IRI, an array or null stays a reference, recorded as written.
  if ('@context' in def) {
    const value = def['@context']
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      term.scopedContext = resolveScopedContext(
        term,
        value as Record<string, unknown>,
        pointerChild(pointer, '@context'),
        scope,
        source,
        findings,
        takenIds,
        scopedOut,
      )
    } else if (isInlineContext(value)) {
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

  // Mode-1.0 downgrades on the remaining facets. A scoped term's facets are
  // inert under 1.0 already — its enclosing `@context` is the downgrade.
  if (scope.mode === '1.0' && !isScoped) {
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

/**
 * Resolve a map-valued scoped context: keyword entries become settings, every
 * other entry a scoped term whose parent is `owner`. Scoped terms are appended
 * to `out` in declaration order, each followed by its own scoped terms.
 */
function resolveScopedContext(
  owner: IrTerm,
  map: Record<string, unknown>,
  pointer: JsonPointer,
  scope: TermScope,
  source: SourceIndex,
  findings: FindingCollector,
  takenIds: Set<string>,
  out: IrTerm[],
): IrScopedContext {
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(map)) {
    if (isContextSetting(key)) settings[key] = value
  }

  // Inside the map, a sibling that names a namespace is usable as a prefix, as
  // it would be to a processor, and `@vocab` replaces the outer one.
  const prefixes = { ...scope.prefixes }
  for (const [key, value] of Object.entries(map)) {
    if (isContextSetting(key) || key.includes(':')) continue
    const iri =
      typeof value === 'string'
        ? value
        : value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)['@id']
          : undefined
    if (typeof iri === 'string' && isAbsoluteIri(iri) && /[/#:?[\]@]$/.test(iri)) {
      prefixes[key] = iri
    }
  }
  let vocab = scope.vocab
  if (typeof settings['@vocab'] === 'string') {
    vocab = expandModelIri(
      settings['@vocab'] as string,
      prefixes,
      scope.vocab,
      source,
      pointerChild(pointer, '@vocab'),
      findings,
    )
  } else if (settings['@vocab'] === null) {
    vocab = undefined
  }

  const inner: TermScope = {
    ...scope,
    prefixes,
    vocab,
    enclosing: [...scope.enclosing, owner.key],
  }
  for (const [key, raw] of Object.entries(map)) {
    if (isContextSetting(key)) continue
    const nested: IrTerm[] = []
    const term = resolveTerm(
      key,
      raw,
      pointerChild(pointer, key),
      inner,
      source,
      findings,
      takenIds,
      nested,
      owner.id,
    )
    if (term) out.push(term, ...nested)
  }
  return { settings }
}

interface ShapesScope {
  terms: IrTerm[]
  prefixes: Record<string, string>
  vocab: string | undefined
  source: SourceIndex
  findings: FindingCollector
  takenIds: Set<string>
}

const SHAPE_KEYS = new Set(['id', 'targetClass', 'closed', 'note', 'fields'])
const FIELD_KEYS = new Set(['min', 'max', 'range', 'note'])
const SIMPLE_RANGES = new Set(['iri', 'node', 'literal', 'langString'])

/**
 * The shapes layer, structurally: every shape with its target and fields. What
 * a field key *means* is settled afterwards against the model's own context,
 * because a key resolves the way a processor would resolve it under the target
 * class, not by looking it up here.
 */
function resolveShapes(raw: unknown, scope: ShapesScope): IrShape[] {
  const { source, findings } = scope
  const shapesPointer = pointerChild(pointerRoot(), 'shapes')
  if (raw === undefined || raw === null) return []
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    findings.raise(
      'L0.schema-violation',
      source,
      shapesPointer,
      '`shapes` must be a map from shape name to shape.',
    )
    return []
  }

  const shapes: IrShape[] = []
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const pointer = pointerChild(shapesPointer, name)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      findings.raise(
        'L0.schema-violation',
        source,
        pointer,
        `The shape "${name}" must be a mapping.`,
        { subject: name },
      )
      continue
    }
    const def = value as Record<string, unknown>
    for (const key of Object.keys(def)) {
      if (SHAPE_KEYS.has(key)) continue
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointer, key),
        `\`${key}\` is not something a shape declares. A shape has \`targetClass\`, \`closed\`, \`note\` and \`fields\`.`,
        { subject: name },
      )
    }
    const identity = identityOf(def['id'], 'shape', name, pointer, source, findings, scope.takenIds)

    // A shape without a target applies only where a field's range names it —
    // an untyped nested node, such as a credential's subject.
    const target = typeof def['targetClass'] === 'string' ? (def['targetClass'] as string) : ''
    if (def['targetClass'] !== undefined && !target) {
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointer, 'targetClass'),
        `\`targetClass\` on shape "${name}" must name a class term of this model, or a class IRI.`,
        { subject: name },
      )
    }
    const resolvedTarget = target
      ? resolveClassReference(target, scope, pointerChild(pointer, 'targetClass'), 'L1.shape-unknown-target', `The target class "${target}" of shape "${name}"`)
      : { iri: null }

    let closed = false
    if (def['closed'] !== undefined) {
      if (typeof def['closed'] === 'boolean') closed = def['closed']
      else {
        findings.raise(
          'L0.schema-violation',
          source,
          pointerChild(pointer, 'closed'),
          '`closed` must be true or false.',
          { subject: name },
        )
      }
    }

    const fields: IrField[] = []
    const fieldsRaw = def['fields']
    const fieldsPointer = pointerChild(pointer, 'fields')
    if (fieldsRaw !== undefined && fieldsRaw !== null) {
      if (typeof fieldsRaw !== 'object' || Array.isArray(fieldsRaw)) {
        findings.raise(
          'L0.schema-violation',
          source,
          fieldsPointer,
          '`fields` must be a map from JSON key to field.',
          { subject: name },
        )
      } else {
        for (const [key, fieldRaw] of Object.entries(fieldsRaw as Record<string, unknown>)) {
          const field = resolveField(key, fieldRaw, pointerChild(fieldsPointer, key), scope)
          if (field) fields.push(field)
        }
      }
    }

    shapes.push({
      ...identity,
      name,
      ...(target ? { target } : {}),
      targetIri: resolvedTarget.iri,
      ...(resolvedTarget.termId !== undefined ? { targetTermId: resolvedTarget.termId } : {}),
      closed,
      ...(typeof def['note'] === 'string' ? { note: def['note'] as string } : {}),
      fields,
      pointer,
    })
  }

  // A shape range names a shape by its key, and the shapes are all known now.
  for (const shape of shapes) {
    for (const field of shape.fields) {
      if (field.range?.kind !== 'shape') continue
      const named = shapes.find((s) => s.name === (field.range as { shape: string }).shape)
      if (named) {
        field.range = { ...field.range, shapeId: named.id }
        continue
      }
      findings.raise(
        'L1.shape-unknown-shape',
        source,
        pointerChild(field.pointer, 'range'),
        `The field "${field.key}" of shape "${shape.name}" names the shape "${field.range.shape}", which this model does not declare.`,
        { subject: field.range.shape },
      )
    }
  }

  // A repeated shape name or field key is gone from the parsed value.
  for (const duplicate of source.duplicateKeys) {
    const tokens = pointerTokens(duplicate.pointer)
    const isShape = tokens.length === 2 && tokens[0] === 'shapes'
    const isField = tokens.length === 4 && tokens[0] === 'shapes' && tokens[2] === 'fields'
    if (!isShape && !isField) continue
    findings.add({
      ruleId: 'L0.schema-violation',
      level: 'L0',
      severity: 'error',
      message: isShape
        ? `The shape "${tokens[1]}" is declared twice.`
        : `The field "${tokens[3]}" is declared twice in shape "${tokens[1]}".`,
      pointer: duplicate.pointer,
      file: source.path,
      loc: duplicate.key.from,
      subject: tokens[tokens.length - 1]!,
    })
  }

  return shapes
}

function resolveField(
  key: string,
  raw: unknown,
  pointer: JsonPointer,
  scope: ShapesScope,
): IrField | undefined {
  const { source, findings } = scope
  // `issuer:` with nothing under it is a field that constrains nothing yet.
  const def: Record<string, unknown> =
    raw === null || raw === undefined ? {} : (raw as Record<string, unknown>)
  if (typeof def !== 'object' || Array.isArray(def)) {
    findings.raise(
      'L0.schema-violation',
      source,
      pointer,
      `The field "${key}" must be a mapping of \`min\`, \`max\`, \`range\` and \`note\`.`,
      { subject: key },
    )
    return undefined
  }
  for (const k of Object.keys(def)) {
    if (FIELD_KEYS.has(k)) continue
    findings.raise(
      'L0.schema-violation',
      source,
      pointerChild(pointer, k),
      `\`${k}\` is not something a field declares. A field has \`min\`, \`max\`, \`range\` and \`note\`.`,
      { subject: key },
    )
  }

  const field: IrField = { key, termId: null, iri: null, inverse: false, pointer }
  const min = def['min']
  if (min !== undefined) {
    if (typeof min === 'number' && Number.isInteger(min) && min >= 0) field.min = min
    else {
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointer, 'min'),
        `\`min\` on field "${key}" must be a non-negative integer.`,
        { subject: key },
      )
    }
  }
  const max = def['max']
  if (max !== undefined) {
    if (typeof max === 'number' && Number.isInteger(max) && max >= 1) field.max = max
    else {
      findings.raise(
        'L0.schema-violation',
        source,
        pointerChild(pointer, 'max'),
        `\`max\` on field "${key}" must be a positive integer; leave it out for no maximum.`,
        { subject: key },
      )
    }
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    findings.raise(
      'L1.shape-cardinality-invalid',
      source,
      pointer,
      `The field "${key}" requires at least ${field.min} values and allows at most ${field.max}; no document can satisfy both.`,
      { subject: key },
    )
  }

  if (def['range'] !== undefined) {
    const range = resolveRange(def['range'], pointerChild(pointer, 'range'), key, scope)
    if (range) field.range = range
  }
  if (typeof def['note'] === 'string') field.note = def['note'] as string
  return field
}

function resolveRange(
  raw: unknown,
  pointer: JsonPointer,
  key: string,
  scope: ShapesScope,
): IrRange | undefined {
  const { source, findings } = scope
  if (typeof raw === 'string') {
    if (SIMPLE_RANGES.has(raw)) return { kind: raw as 'iri' | 'node' | 'literal' | 'langString' }
    if (raw.includes(':')) {
      const iri = expandModelIri(raw, scope.prefixes, undefined, source, pointer, findings, key)
      return { kind: 'datatype', datatype: raw, iri }
    }
  } else if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>)
    if (entries.length === 1 && typeof entries[0]![1] === 'string') {
      const [form, name] = entries[0] as [string, string]
      if (form === 'shape') return { kind: 'shape', shape: name, shapeId: null }
      if (form === 'class') {
        const resolved = resolveClassReference(
          name,
          scope,
          pointerChild(pointer, 'class'),
          'L1.shape-unknown-class',
          `The class "${name}" in the range of field "${key}"`,
        )
        return { kind: 'class', class: name, iri: resolved.iri }
      }
    }
  }
  findings.raise(
    'L0.schema-violation',
    source,
    pointer,
    `The range of field "${key}" must be \`iri\`, \`node\`, \`literal\`, \`langString\`, a datatype IRI such as \`xsd:dateTime\`, \`{ class: … }\` or \`{ shape: … }\`.`,
    { subject: key },
  )
  return undefined
}

/**
 * A class named by a shape: a top-level term of this model, or an IRI. A bare
 * word that is not a term resolves against `@vocab`, as it would in a document's
 * `@type`, and names nothing when there is none.
 */
function resolveClassReference(
  value: string,
  scope: ShapesScope,
  pointer: JsonPointer,
  rule: 'L1.shape-unknown-target' | 'L1.shape-unknown-class',
  what: string,
): { iri: string | null; termId?: string } {
  const term = scope.terms.find((t) => t.key === value && t.scope === undefined)
  if (term) return { iri: term.iri, termId: term.id }

  let iri: string | null = null
  const compact = splitCompactIri(value)
  if (compact) {
    const mapped = scope.prefixes[compact.prefix]
    if (mapped !== undefined) iri = mapped + compact.suffix
    else if (KNOWN_URI_SCHEMES.has(compact.prefix.toLowerCase()) && isAbsoluteIri(value)) iri = value
  } else if (isAbsoluteIri(value)) {
    // `https://…` is not a compact IRI — its suffix begins with `//` — but it is
    // an IRI the author wrote deliberately.
    iri = value
  } else if (scope.vocab) {
    iri = resolveIri(scope.vocab, value)
  }

  if (iri === null) {
    scope.findings.raise(
      rule,
      scope.source,
      pointer,
      `${what} is neither a term of this model nor an IRI whose prefix is declared.`,
      { subject: value },
    )
    return { iri: null }
  }
  // A class written as an IRI still finds its term, which is where a
  // type-scoped context would live.
  const byIri = scope.terms.find((t) => t.scope === undefined && t.iri === iri)
  return byIri ? { iri, termId: byIri.id } : { iri }
}

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
  derivedFrom: readonly string[] = [key],
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
  const derived = deriveElementId(kind, derivedFrom.join(String.fromCharCode(0)))
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
 * A key repeated inside one scoped context map. One key means one thing within
 * a map; the same key in two maps is two terms and is not reported.
 */
function reportDuplicateScopedKeys(source: SourceIndex, findings: FindingCollector): void {
  for (const duplicate of source.duplicateKeys) {
    const tokens = pointerTokens(duplicate.pointer)
    if (!isScopedTermPath(tokens)) continue
    const key = tokens[tokens.length - 1]!
    findings.add({
      ruleId: 'L0.duplicate-term-key',
      level: 'L0',
      severity: 'error',
      message: `Scoped term "${key}" is declared twice in one scoped context. One key means one thing within a context.`,
      pointer: duplicate.pointer,
      file: source.path,
      loc: duplicate.key.from,
      subject: key,
    })
  }
}

/** `terms/<key>/@context/<key>(/@context/<key>)*` */
function isScopedTermPath(tokens: readonly string[]): boolean {
  if (tokens.length < 4 || tokens.length % 2 !== 0 || tokens[0] !== 'terms') return false
  for (let i = 2; i < tokens.length; i += 2) if (tokens[i] !== '@context') return false
  return !isContextSetting(tokens[tokens.length - 1]!)
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
