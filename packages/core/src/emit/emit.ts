/**
 * The two emit targets.
 *
 * `context` keeps referenced contexts as a live layer. `context-inline` flattens
 * them from the vendored copies and reports the fork rather than performing it
 * quietly.
 *
 * @lat: [[emitters#Emitters#Context Target]]
 */
import { FindingCollector } from '../findings/collector.js'
import type { Finding } from '../findings/finding.js'
import { FACETS_ONLY_IN_1_1 } from '../model/resolve.js'
import { topLevelTerms, type Ir, type IrTerm } from '../model/ir.js'
import { SourceIndex } from '../source/index-file.js'
import { pointerChild, pointerRoot, type JsonPointer } from '../source/pointer.js'
import { buildOwnLayer } from './context-document.js'
import { capabilitiesFor, type Downgrade, type TargetName } from './capability.js'
import { parseArtifact, render, stripComments } from './render.js'
import { emitShacl } from './shacl.js'

export interface EmitOptions {
  target: TargetName
  /** The model source, so a downgrade finding lands on the fact that caused it. */
  source: SourceIndex
  /** Reads a vendored context. Required by `context-inline`; unused by `context`. */
  resolveContext?: (iri: string) => unknown
  /** Overrides the header's model name. Defaults to the IR's source path. */
  modelName?: string
  /**
   * The project publishing this artifact. Named in the header only when the
   * artifact belongs to a version.
   */
  projectName?: string
  /**
   * The version this artifact belongs to. When absent the header names no
   * version at all, rather than a placeholder that would read as one.
   */
  versionId?: string
}

export interface EmitResult {
  target: TargetName
  /** The artifact, ready to write. */
  text: string
  /** The parsed artifact, for the execution test. Empty for `shacl`, which is Turtle. */
  document: Record<string, unknown>
  findings: Finding[]
  downgrades: Downgrade[]
}

/** Emit one artifact for one target. */
export function emit(ir: Ir, options: EmitOptions): EmitResult {
  if (options.target === 'shacl') {
    const shacl = emitShacl(ir, {
      source: options.source,
      modelName: options.modelName ?? ir.source,
      ...(options.resolveContext !== undefined ? { resolveContext: options.resolveContext } : {}),
      ...(options.versionId !== undefined
        ? { versionLine: versionHeaderLine(options.versionId, options.projectName).replace(/^\/\/ /, '') }
        : {}),
    })
    // A shapes graph is Turtle, not JSON; `document` is empty for it and the
    // execution test parses `text` with a Turtle parser instead.
    return { ...shacl, document: {} }
  }

  const findings = new FindingCollector()
  const downgrades: Downgrade[] = []
  const modelName = options.modelName ?? ir.source

  collectModeDowngrades(ir, options, findings, downgrades)

  const own = buildOwnLayer(ir)
  let context: unknown

  if (options.target === 'context') {
    const referenced = ir.uses.map((u) => u.iri)
    context = referenced.length === 0 ? own : [...referenced, own]
  } else {
    context = inlineLayer(ir, own, options, findings, downgrades)
  }

  const document: Record<string, unknown> = { '@context': context }

  // Each downgrade's comment lands at the position in the artifact it concerns.
  // A downgrade that concerns the artifact as a whole — an absorbed context —
  // lands in the header instead.
  const comments = new Map<JsonPointer, string[]>()
  for (const downgrade of downgrades) {
    if (downgrade.artifactPointer === pointerRoot()) continue
    const existing = comments.get(downgrade.artifactPointer) ?? []
    existing.push(downgrade.comment)
    comments.set(downgrade.artifactPointer, existing)
  }

  const text = render(document, {
    header: headerFor(options.target, modelName, downgrades, options, ir),
    comments,
  })

  return { target: options.target, text, document, findings: findings.all(), downgrades }
}

/**
 * Flatten every referenced context in from its vendored copy, reporting each
 * absorbed context as a downgrade against the `uses` entry that named it.
 */
function inlineLayer(
  ir: Ir,
  own: Record<string, unknown>,
  options: EmitOptions,
  findings: FindingCollector,
  downgrades: Downgrade[],
): Record<string, unknown> {
  // `@version` leads, because a processor reading the file top to bottom must
  // know which version it is reading before it reaches a 1.1-only facet.
  const merged: Record<string, unknown> = ir.mode === '1.1' ? { '@version': 1.1 } : {}

  // Entries are absorbed in declaration order so the artifact is reproducible
  // and the model's own terms remain the final layer.
  for (const entry of ir.uses) {
    const document = options.resolveContext?.(entry.iri)
    if (document === undefined) {
      findings.raise(
        'L1.context-not-vendored',
        options.source,
        entry.pointer,
        `${entry.iri} must be vendored before \`context-inline\` can flatten it. Run \`ldm vendor\`.`,
        { subject: entry.iri },
      )
      continue
    }
    const inner =
      document !== null && typeof document === 'object' && '@context' in (document as object)
        ? (document as Record<string, unknown>)['@context']
        : document
    Object.assign(merged, flatten(inner))

    const finding = findings.raise(
      'L1.downgrade-external-reference-forked',
      options.source,
      entry.pointer,
      `\`context-inline\` absorbed ${entry.iri} at hash ${
        entry.integrity ?? 'an unrecorded hash'
      }. This forks the upstream vocabulary: the consumer stops receiving upstream corrections and may collide with a consumer who loaded the original.`,
      { subject: entry.iri },
    )
    downgrades.push({
      finding,
      artifactPointer: pointerRoot(),
      comment: `Absorbed ${entry.iri} (${entry.integrity ?? 'hash not recorded'}). This is a fork of that vocabulary at the moment it was vendored.`,
    })
  }

  // The model's own terms overwrite anything absorbed, which is the same
  // precedence the array form gives them.
  Object.assign(merged, own)
  return merged
}

function flatten(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (Array.isArray(value)) {
    const out: Record<string, unknown> = {}
    for (const item of value) Object.assign(out, flatten(item))
    return out
  }
  if (typeof value !== 'object') return {}
  const copy = { ...(value as Record<string, unknown>) }
  // A `@version` from an absorbed context is not this model's declaration.
  delete copy['@version']
  delete copy['@protected']
  return copy
}

/**
 * A 1.1-only facet under a model targeting 1.0 still emits; the downgrade says
 * what a 1.0 processor will do with it instead.
 *
 * @lat: [[emitters#Emitters#Capability Matrix]]
 */
function collectModeDowngrades(
  ir: Ir,
  options: EmitOptions,
  findings: FindingCollector,
  downgrades: Downgrade[],
): void {
  if (ir.mode !== '1.0') return

  // Scoped terms are inert under 1.0 already: their enclosing `@context` is the
  // downgrade, reported on the term that carries it.
  for (const term of topLevelTerms(ir)) {
    for (const facet of facetsUsedBy(term)) {
      if (!FACETS_ONLY_IN_1_1.includes(facet)) continue
      const finding = findings.raise(
        'L1.downgrade-facet-unsupported',
        options.source,
        pointerChild(term.pointer, facet),
        `\`${facet}\` on "${term.key}" is defined only in JSON-LD 1.1 and this model targets 1.0. The facet is still emitted; a 1.0 processor ${consequence(
          facet,
        )}.`,
        { subject: term.key },
      )
      downgrades.push({
        finding,
        artifactPointer: artifactPointerFor(ir, term, facet),
        comment: `"${term.key}" carries ${facet}, which is JSON-LD 1.1 only. A 1.0 processor ${consequence(
          facet,
        )}.`,
      })
    }

    const containers = term['@container'] ?? []
    for (const container of containers) {
      if (container !== '@id' && container !== '@type' && container !== '@graph') continue
      const finding = findings.raise(
        'L1.downgrade-facet-unsupported',
        options.source,
        pointerChild(term.pointer, '@container'),
        `\`@container: ${container}\` on "${term.key}" is defined only in JSON-LD 1.1 and this model targets 1.0. The facet is still emitted; a 1.0 processor ignores the container and reads the map as an ordinary node object.`,
        { subject: term.key },
      )
      downgrades.push({
        finding,
        artifactPointer: artifactPointerFor(ir, term, '@container'),
        comment: `"${term.key}" carries @container: ${container}, which is JSON-LD 1.1 only. A 1.0 processor reads the map as an ordinary node object.`,
      })
    }
  }
}

function facetsUsedBy(term: IrTerm): string[] {
  const out: string[] = []
  for (const facet of [
    '@protected',
    '@context',
    '@nest',
    '@prefix',
    '@direction',
    '@index',
  ] as const) {
    if (term[facet] !== undefined) out.push(facet)
    else if (facet === '@context' && term.scopedContext !== undefined) out.push(facet)
  }
  return out
}

function consequence(facet: string): string {
  switch (facet) {
    case '@protected':
      return 'ignores it, so a later context may redefine the term freely'
    case '@context':
      return 'ignores it, so the term keeps its outer meaning everywhere'
    case '@nest':
      return 'treats the nesting key as an ordinary key and drops it'
    case '@prefix':
      return 'may still use the term as a compact-IRI prefix, which 1.1 would have refused'
    case '@direction':
      return 'drops the base direction from every value'
    case '@index':
      return 'does not preserve the index as a triple'
    default:
      return 'ignores it'
  }
}

/** Where in the emitted document the downgrade's comment belongs. */
function artifactPointerFor(ir: Ir, term: IrTerm, facet: string): JsonPointer {
  const root = pointerChild(pointerRoot(), '@context')
  const layer = ir.uses.length === 0 ? root : pointerChild(root, ir.uses.length)
  return pointerChild(pointerChild(layer, term.key), facet)
}

/**
 * The generated-file header. The decision to generate an artifact people are
 * used to hand-editing is only safe if the artifact says so.
 *
 * Both targets write the same header shape, so a diff between the two is about
 * the context rather than about the preamble.
 */
function headerFor(
  target: TargetName,
  modelName: string,
  downgrades: Downgrade[],
  options: EmitOptions,
  ir: Ir,
): string[] {
  const lines = [
    `Generated by jsonld-modeler from ${modelName}. Do not edit.`,
    `Target: ${target}. Regenerate with \`ldm emit --target ${target}\`.`,
  ]
  // A consumer holding only the artifact can say which release it is reading.
  // An artifact emitted outside a version names no version rather than a
  // placeholder, which would read as one.
  if (options.versionId !== undefined) {
    // `render` prefixes each header line with `// `, so the shared builder's
    // prefix is stripped here and re-added there.
    lines.push(versionHeaderLine(options.versionId, options.projectName).replace(/^\/\/ /, ''))
  }
  for (const capability of capabilitiesFor(target).capabilities) {
    // A model with no shapes has nothing the context is failing to carry, and
    // naming it anyway would churn every artifact written before shapes existed.
    if (capability.key === 'shapes' && ir.shapes.length === 0) continue
    if (capability.level === 'none') {
      lines.push(`Not carried by this target: ${capability.key} — ${capability.note}`)
    }
  }
  // Only the artifact-wide downgrades; the rest sit at their own positions.
  for (const downgrade of downgrades) {
    if (downgrade.artifactPointer === pointerRoot()) lines.push(`Downgrade: ${downgrade.comment}`)
  }
  return lines
}

/** The header line naming the version. Written and rewritten in one place. */
const VERSION_HEADER = /^\/\/ Version: .*$/m

export function versionHeaderLine(versionId: string, projectName?: string): string {
  return projectName !== undefined
    ? `// Version: ${versionId}, published by the project ${projectName}.`
    : `// Version: ${versionId}.`
}

/**
 * Point an already-emitted artifact at a different version.
 *
 * A clone has its origin's inputs and its own identity, so its artifacts are the
 * origin's artifacts with one header line changed. Doing it here keeps that
 * line's shape in one place; a caller pattern-matching it would be the fragile
 * version of this.
 */
export function retargetVersionHeader(
  text: string,
  versionId: string,
  projectName?: string,
): string {
  const line = versionHeaderLine(versionId, projectName)
  if (VERSION_HEADER.test(text)) return text.replace(VERSION_HEADER, line)
  // No version line yet: insert it where one would have been written.
  return text.replace(/^(\/\/ Target: .*)$/m, `$1\n${line}`)
}

export { capabilitiesFor, parseArtifact, stripComments }
