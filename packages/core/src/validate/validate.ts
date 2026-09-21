/**
 * The validation ladder, L0 to L2.
 *
 * Users arrive expecting a context to behave like a schema, and it does not:
 * expansion is total and succeeds on a document it has emptied. The ladder is
 * how the tool gives a useful answer without pretending JSON-LD offers one.
 *
 * @lat: [[validation#Validation#The Ladder]]
 */
import { FindingCollector } from '../findings/collector.js'
import {
  atOrBelowLevel,
  hasErrors,
  LEVEL_ORDER,
  SEVERITY_ORDER,
  sortFindings,
  type Finding,
  type Level,
  type Severity,
} from '../findings/finding.js'
import { findTerm, scopedTermsOf, topLevelTerms, type Ir, type IrExample, type IrTerm } from '../model/ir.js'
import { resolveModel } from '../model/resolve.js'
import { checkShapes, reportShapeViewCoverage } from '../shapes/check.js'
import { toRdf } from '../processor/to-rdf.js'
import { checkConformance, prepareShapes, type PreparedShapes } from './conformance.js'
import { resolveShapeFieldsIn } from '../shapes/fields.js'
import { activeContextForModel } from '../processor/api.js'
import { expand, type Observation } from '../processor/expand.js'
import { JsonLdError, type ActiveContext } from '../processor/types.js'
import { SourceIndex } from '../source/index-file.js'
import { pointerLast, pointerRoot, pointerTokens, type JsonPointer } from '../source/pointer.js'

export interface ValidateOptions {
  /**
   * The highest level to run. A command names it, and the report repeats it.
   * Unset, a model with shapes is checked through L3 and one without through L2.
   */
  level?: Level
  /** Reads a vendored context. Offline; there is no fetch on this path. */
  resolveContext?: (iri: string) => unknown
  /** Loads an example document the model declares, relative to the model. */
  readExample?: (path: string) => string | undefined
}

export interface ExampleOutcome {
  path: string
  /** Findings this example produced, already ordered. */
  findings: Finding[]
  met: boolean
  /** Rule ids a negative example declared but did not raise. */
  missing: string[]
  /** Rule ids it raised that it did not declare. */
  unexpected: string[]
}

export interface ValidationReport {
  /** The highest level that actually ran. */
  level: Level
  findings: Finding[]
  examples: ExampleOutcome[]
  ir?: Ir
  /** True when any finding is at error severity. */
  failed: boolean
}

/**
 * A level this milestone does not implement is reported as unavailable rather
 * than answered — reporting conformance the tool cannot check would be worse
 * than refusing.
 */
export class LevelNotAvailable extends Error {
  readonly level: string
  constructor(level: string) {
    super(
      `Validation level ${level} is not available. This release implements L0 to L3; L4 needs the rule catalog.`,
    )
    this.name = 'LevelNotAvailable'
    this.level = level
  }
}

export function validateModelText(
  text: string,
  path: string,
  options: ValidateOptions = {},
): ValidationReport {
  return validateModel(SourceIndex.parse(text, { path }), options)
}

export function validateModel(
  source: SourceIndex,
  options: ValidateOptions = {},
): ValidationReport {
  if (options.level !== undefined && LEVEL_ORDER[options.level] > LEVEL_ORDER['L3']) {
    throw new LevelNotAvailable(options.level)
  }

  const findings = new FindingCollector()

  // ---- L0: the model file is a valid model -------------------------------
  const resolved = resolveModel(source)
  findings.addAll(resolved.findings)
  let ir = resolved.ir
  // A model with shapes makes every positive example a conformance test.
  const level: Level = options.level ?? (ir !== undefined && ir.shapes.length > 0 ? 'L3' : 'L2')
  if (!ir) {
    return finish(level, findings.all(), [], undefined)
  }

  // ---- L1: the context this model denotes is legal ------------------------
  let active: ActiveContext | undefined
  if (LEVEL_ORDER[level] >= LEVEL_ORDER['L1']) {
    // The specific checks run first. Context construction then reports only what
    // they did not already cover, so a protected-term violation is described by
    // the check that knows which context protects it rather than by the
    // processor's generic message.
    checkVendored(ir, source, findings, options)
    checkUpstreamCollisions(ir, source, findings, options)
    active = buildContext(ir, source, findings, options)
    // Field keys are resolved again against the full context, referenced
    // contexts included, now that they can be read.
    if (active !== undefined && ir.shapes.length > 0) {
      ir = { ...ir, shapes: resolveShapeFieldsIn(ir, active) }
      checkShapes(ir, active, source, findings)
    }
  }

  // ---- L2: what documents lose, and what the model leaves unexercised -----
  const examples: ExampleOutcome[] = []
  if (LEVEL_ORDER[level] >= LEVEL_ORDER['L2'] && active) {
    // ---- L3: the shapes graph the `shacl` target emits, run by an engine ---
    const shapes =
      LEVEL_ORDER[level] >= LEVEL_ORDER['L3']
        ? prepareShapes(ir, {
            source,
            ...(options.resolveContext !== undefined
              ? { resolveContext: options.resolveContext }
              : {}),
          })
        : undefined
    const used = new Set<string>()
    for (const example of ir.examples) {
      examples.push(runExample(ir, example, active, source, options, used, level, shapes))
    }
    reportCoverage(ir, used, source, findings)
    reportViewCoverage(ir, source, findings)
    reportShapeViewCoverage(ir, source, findings)
  }

  // A negative example that raised what it declared has done its job. Its
  // findings are still reported — the document is meant to be wrong, and the
  // editor shows where — but they do not fail the check.
  const expected = new Set<Finding>()
  for (const outcome of examples) {
    findings.addAll(outcome.findings)
    const example = ir.examples.find((e) => e.path === outcome.path)
    if (outcome.met && example?.expect.kind === 'negative') {
      const declared = new Set(example.expect.rules)
      for (const finding of outcome.findings) if (declared.has(finding.ruleId)) expected.add(finding)
    }
    if (!outcome.met) {
      findings.raise(
        'L0.example-outcome-unmet',
        source,
        example?.pointer ?? pointerRoot(),
        describeUnmet(outcome),
        { subject: outcome.path },
      )
    }
  }

  return finish(level, atOrBelowLevel(findings.all(), level), examples, ir, expected)
}

function finish(
  level: Level,
  findings: Finding[],
  examples: ExampleOutcome[],
  ir: Ir | undefined,
  expected: ReadonlySet<Finding> = new Set(),
): ValidationReport {
  const ordered = sortFindings(findings)
  return {
    level,
    findings: ordered,
    examples,
    ...(ir !== undefined ? { ir } : {}),
    failed: hasErrors(ordered.filter((f) => !expected.has(f))),
  }
}

/** A referenced context must be vendored before the model can be used. */
function checkVendored(
  ir: Ir,
  source: SourceIndex,
  findings: FindingCollector,
  options: ValidateOptions,
): void {
  for (const entry of ir.uses) {
    if (entry.integrity === undefined) {
      findings.raise(
        'L1.context-not-vendored',
        source,
        entry.pointer,
        `${entry.iri} has no recorded integrity hash. Run \`ldm vendor\` — no command other than the vendor refresh touches the network.`,
        { subject: entry.iri },
      )
      continue
    }
    if (options.resolveContext?.(entry.iri) === undefined) {
      findings.raise(
        'L1.context-not-vendored',
        source,
        entry.pointer,
        `${entry.iri} is recorded with a hash but is not in the vendored directory. Run \`ldm vendor\`.`,
        { subject: entry.iri },
      )
    }
  }
}

/**
 * Build the active context, turning any specification error into an L1 finding
 * located at the term in the *model* rather than in a generated artifact.
 */
function buildContext(
  ir: Ir,
  source: SourceIndex,
  findings: FindingCollector,
  options: ValidateOptions,
): ActiveContext | undefined {
  try {
    return activeContextForModel(ir, {
      ...(options.resolveContext !== undefined
        ? { resolveContext: options.resolveContext }
        : {}),
    })
  } catch (error) {
    if (!(error instanceof JsonLdError)) throw error
    const rule = ruleForCode(error.code)
    const term = termForContextError(ir, error)
    const pointer = term?.pointer ?? pointerRoot()
    // Another check has already said this, with more context. Without a term to
    // pin it to there is nowhere better to put it, so any earlier report of the
    // same rule is enough to stand down.
    if (term === undefined ? findings.has(rule) : findings.has(rule, term.pointer)) {
      return undefined
    }
    findings.raise(
      rule,
      source,
      pointer,
      `${error.message}${term ? ` (term "${term.key}")` : ''}`,
      ...(term ? [{ subject: term.key }] : []),
    )
    return undefined
  }
}

/**
 * A context error must land on the term in the *model*, because the generated
 * artifact is not a file the user wrote.
 *
 * The processor carries a pointer into the context document it was given, whose
 * keys are the model's term keys — so the last segment names the term. The
 * error message is a fallback, and a poor one: it quotes whatever was wrong,
 * which is often a facet value rather than a term.
 */
function termForContextError(ir: Ir, error: JsonLdError): IrTerm | undefined {
  if (error.pointer !== undefined) {
    const scoped = termAtContextPointer(ir, error.pointer)
    if (scoped) return scoped
  }
  const fromPointer = error.pointer === undefined ? undefined : pointerLast(error.pointer)
  if (fromPointer !== undefined) {
    const byPointer = ir.terms.find((t) => t.key === fromPointer)
    if (byPointer) return byPointer
  }
  const quoted = /"([^"]+)"/.exec(error.message)
  const name = quoted?.[1]
  if (name === undefined) return undefined
  return ir.terms.find((t) => t.key === name)
}

/**
 * The deepest term a pointer into the emitted context names, following
 * `<key>/@context/<key>` down through scoped contexts. The same key at two
 * depths is two terms, so the last segment alone cannot say which.
 */
function termAtContextPointer(ir: Ir, pointer: JsonPointer): IrTerm | undefined {
  const tokens = pointerTokens(pointer)
  // Skip the document's own `@context` and, in the array form, the layer index.
  let i = tokens[0] === '@context' ? 1 : 0
  if (i < tokens.length && /^[0-9]+$/.test(tokens[i]!)) i++
  const top = findTerm(ir, tokens[i] ?? '')
  if (top === undefined) return undefined
  let found: IrTerm = top
  for (i += 1; i + 1 < tokens.length && tokens[i] === '@context'; i += 2) {
    const key = tokens[i + 1]
    const child: IrTerm | undefined = scopedTermsOf(ir, found.id).find((t) => t.key === key)
    if (child === undefined) break
    found = child
  }
  return found
}

function ruleForCode(code: string) {
  switch (code) {
    case 'invalid container mapping':
      return 'L1.invalid-container-mapping' as const
    case 'cyclic IRI mapping':
      return 'L1.cyclic-iri-mapping' as const
    case 'invalid type mapping':
      return 'L1.invalid-type-mapping' as const
    case 'invalid language mapping':
      return 'L1.invalid-language-mapping' as const
    case 'invalid scoped context':
      return 'L1.invalid-scoped-context' as const
    case 'invalid reverse property':
      return 'L1.invalid-reverse-property' as const
    case 'protected term redefinition':
      return 'L1.protected-term-redefinition' as const
    case 'loading remote context failed':
      return 'L1.context-not-vendored' as const
    case 'invalid IRI mapping':
      return 'L1.malformed-iri' as const
    default:
      return 'L1.invalid-term-definition' as const
  }
}

/**
 * A term the model defines that a referenced context already defines is either
 * a protected-term violation or a collision worth naming.
 */
function checkUpstreamCollisions(
  ir: Ir,
  source: SourceIndex,
  findings: FindingCollector,
  options: ValidateOptions,
): void {
  if (!options.resolveContext) return

  for (const entry of ir.uses) {
    const document = options.resolveContext(entry.iri)
    if (document === null || typeof document !== 'object') continue
    const inner = ('@context' in (document as object)
      ? (document as Record<string, unknown>)['@context']
      : document) as unknown
    const upstream = flattenContext(inner)
    if (!upstream) continue

    for (const term of topLevelTerms(ir)) {
      const theirs = upstream[term.key]
      if (theirs === undefined) continue
      const theirIri = definitionIri(theirs)
      const isProtected =
        theirs !== null &&
        typeof theirs === 'object' &&
        !Array.isArray(theirs) &&
        (theirs as Record<string, unknown>)['@protected'] === true

      if (isProtected && theirIri !== term.iri) {
        findings.raise(
          'L1.protected-term-redefinition',
          source,
          term.pointer,
          `"${term.key}" is declared protected by ${entry.iri}, where it maps to ${theirIri}. A protected term is a promise to downstream contexts and may not be redefined.`,
          { subject: term.key },
        )
        continue
      }
      if (theirIri !== undefined && theirIri !== term.iri) {
        findings.raise(
          'L1.term-shadows-referenced-context',
          source,
          term.pointer,
          `"${term.key}" is already defined by ${entry.iri}, where it maps to ${theirIri}. This model maps it to ${term.iri}.`,
          { subject: term.key },
        )
      }
    }
  }
}

function flattenContext(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    const out: Record<string, unknown> = {}
    for (const item of value) Object.assign(out, flattenContext(item) ?? {})
    return out
  }
  return value as Record<string, unknown>
}

function definitionIri(definition: unknown): string | undefined {
  if (typeof definition === 'string') return definition
  if (definition !== null && typeof definition === 'object' && !Array.isArray(definition)) {
    const id = (definition as Record<string, unknown>)['@id']
    if (typeof id === 'string') return id
  }
  return undefined
}

/** Validate one declared example and compare against the outcome it records. */
function runExample(
  ir: Ir,
  example: IrExample,
  active: ActiveContext,
  modelSource: SourceIndex,
  options: ValidateOptions,
  used: Set<string>,
  level: Level,
  shapes?: PreparedShapes,
): ExampleOutcome {
  const findings = new FindingCollector()

  const text = options.readExample?.(example.path)
  if (text === undefined) {
    findings.raise(
      'L0.example-missing',
      modelSource,
      example.pointer,
      `The example document ${example.path} does not exist.`,
      { subject: example.path },
    )
    return outcome(example, findings.all(), false, [], [])
  }

  const source = SourceIndex.parse(text, { path: example.path })
  if (source.errors.length > 0 || source.data === undefined) {
    findings.raise(
      'L0.example-unparseable',
      modelSource,
      example.pointer,
      `The example document ${example.path} is not valid JSON: ${
        source.errors[0]?.message ?? 'no content'
      }`,
      { subject: example.path },
    )
    return outcome(example, findings.all(), false, [], [])
  }

  let observations: Observation[] = []
  try {
    const result = expand(source.data, active, {
      ...(options.resolveContext !== undefined
        ? { resolveContext: options.resolveContext }
        : {}),
      // Ordered so the findings do not depend on key order in the document.
      ordered: true,
    })
    observations = result.observations
    if (shapes !== undefined) checkConformance(shapes, toRdf(result.expanded), source, findings)
  } catch (error) {
    if (!(error instanceof JsonLdError)) throw error
    findings.raise(
      'L0.example-unparseable',
      source,
      error.pointer ?? pointerRoot(),
      error.message,
      { subject: example.path },
    )
  }

  reportLossiness(ir, observations, source, findings, used)

  const produced = findings.all()
  const ids = new Set(produced.map((f) => f.ruleId))

  if (example.expect.kind === 'positive') {
    const ceiling = SEVERITY_ORDER[example.expect.maxSeverity]
    const tooLoud = produced.filter((f) => SEVERITY_ORDER[f.severity] > ceiling)
    return outcome(example, produced, tooLoud.length === 0, [], tooLoud.map((f) => f.ruleId))
  }

  // A rule above the level being run cannot be raised by this run, so an
  // expectation of one is not tested here rather than failed.
  const declared = example.expect.rules.filter((r) => {
    const ruleLevel = /^(L[0-4])\./.exec(r)?.[1] as Level | undefined
    return ruleLevel === undefined || LEVEL_ORDER[ruleLevel] <= LEVEL_ORDER[level]
  })
  const missing = declared.filter((r) => !ids.has(r))
  const unexpected = [...ids].filter((id) => !declared.includes(id)).sort()
  return outcome(example, produced, missing.length === 0, missing, unexpected)
}

function outcome(
  example: IrExample,
  findings: Finding[],
  met: boolean,
  missing: string[],
  unexpected: string[],
): ExampleOutcome {
  return { path: example.path, findings, met, missing, unexpected }
}

function describeUnmet(outcome: ExampleOutcome): string {
  if (outcome.missing.length > 0) {
    return `Example ${outcome.path} was declared to raise ${outcome.missing.join(
      ', ',
    )}, and did not. It raised ${
      outcome.findings.length === 0
        ? 'nothing'
        : [...new Set(outcome.findings.map((f) => f.ruleId))].sort().join(', ')
    }.`
  }
  return `Example ${outcome.path} was declared to pass, and raised ${[
    ...new Set(outcome.unexpected),
  ]
    .sort()
    .join(', ')}.`
}

/**
 * L2: what the document lost. Every finding here comes from an observation
 * expansion recorded at the moment it made it.
 *
 * @lat: [[validation#Validation#The Ladder#L2 Lossiness]]
 */
function reportLossiness(
  ir: Ir,
  observations: readonly Observation[],
  source: SourceIndex,
  findings: FindingCollector,
  used: Set<string>,
): void {
  for (const observation of observations) {
    switch (observation.kind) {
      case 'term-used':
        used.add(observation.term)
        break
      case 'key-dropped':
        findings.raise(
          'L2.key-dropped',
          source,
          observation.pointer,
          `"${observation.key}" matched no term and expands to nothing. Expansion still succeeded; this content is simply gone.`,
          { subject: observation.key },
        )
        break
      case 'key-only-via-vocab':
        findings.raise(
          'L2.key-dropped-under-vocab',
          source,
          observation.pointer,
          `"${observation.key}" matched no term and expanded to ${observation.iri} only because this model declares @vocab. A key that would otherwise have been dropped loudly becomes an invented IRI nobody serves.`,
          { subject: observation.key },
        )
        break
      case 'relative-iri':
        findings.raise(
          'L2.relative-iri',
          source,
          observation.pointer,
          `"${observation.value}" stayed relative because no base resolved it. A relative IRI in expanded output identifies nothing.`,
          { subject: observation.value },
        )
        break
      case 'blank-node-minted':
        findings.raise(
          'L2.blank-node-minted',
          source,
          observation.pointer,
          `This node has no @id, so a blank node (${observation.id}) was minted. A blank node cannot be referred to from outside this document.`,
          { subject: observation.id },
        )
        break
      case 'coercion-did-not-fire': {
        const term = ir.terms.find((t) => t.key === observation.term)
        findings.raise(
          'L2.coercion-did-not-fire',
          source,
          observation.pointer,
          `"${observation.value}" reads as an IRI but "${observation.term}" has no \`@type: @id\`, so it expanded as a literal rather than a reference.${
            term ? '' : ' The term is not declared by this model.'
          }`,
          { subject: observation.term },
        )
        break
      }
    }
  }
}

/**
 * The coverage direction: terms defined but unused. Reported below lossiness
 * severity, since a context may legitimately define more than any one document
 * uses.
 */
function reportCoverage(
  ir: Ir,
  used: ReadonlySet<string>,
  source: SourceIndex,
  findings: FindingCollector,
): void {
  if (ir.examples.length === 0) return
  for (const term of ir.terms) {
    if (used.has(term.key)) continue
    findings.raise(
      'L2.term-unused',
      source,
      term.pointer,
      `No example document uses "${term.key}".`,
      { severity: 'info', subject: term.key },
    )
  }
}

/** A term no view includes cannot be seen on any diagram. */
function reportViewCoverage(ir: Ir, source: SourceIndex, findings: FindingCollector): void {
  if (ir.views.length === 0) return
  const shown = new Set(ir.views.flatMap((v) => v.terms))
  // A scoped term is drawn inside the region of the term that holds it, so it is
  // visible wherever that term is.
  for (const term of topLevelTerms(ir)) {
    if (shown.has(term.key)) continue
    findings.raise(
      'L2.term-in-no-view',
      source,
      term.pointer,
      `No view includes "${term.key}", so it appears on no diagram.`,
      { severity: 'info', subject: term.key },
    )
  }
}

export type { Finding, Level, Severity, JsonPointer }
