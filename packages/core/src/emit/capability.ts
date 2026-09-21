/**
 * The capability matrix.
 *
 * Every target declares what it can express. A model fact a target cannot carry
 * is a downgrade: a diagnostic at the site in the model, and a comment at the
 * lossy position in the generated artifact. Nothing is ever silently dropped.
 *
 * The matrix is declared from the first target rather than retrofitted when a
 * second appears, because a downgrade discovered late tends to be resolved by
 * widening the metamodel — which is the wrong repair.
 *
 * @lat: [[emitters#Emitters#Capability Matrix]]
 */
import type { Finding } from '../findings/finding.js'
import type { JsonPointer } from '../source/pointer.js'

export type TargetName = 'context' | 'context-inline' | 'shacl'

/** What a capability entry can say about one aspect of a target. */
export type CapabilityLevel =
  /** Fully expressed. */
  | 'full'
  /** Expressed, but with a consequence the model should know about. */
  | 'downgraded'
  /** Not expressible at all. */
  | 'none'

export interface Capability {
  /** A stable key, so a plugin interface could expose the same set later. */
  key: string
  level: CapabilityLevel
  /** What the level means for this target, in one sentence. */
  note: string
}

export interface TargetCapabilities {
  target: TargetName
  /** The file extension the target writes. */
  extension: string
  capabilities: Capability[]
}

/**
 * The two context targets differ in exactly one entry. Keeping the rest
 * identical is what makes the difference legible.
 */
export const CAPABILITIES: Record<TargetName, TargetCapabilities> = {
  context: {
    target: 'context',
    extension: '.jsonld',
    capabilities: [
      {
        key: 'external-reference',
        level: 'full',
        note: 'Referenced contexts stay live: the consumer keeps receiving upstream corrections.',
      },
      { key: 'terms', level: 'full', note: 'Every term and every 1.1 facet is emitted.' },
      { key: 'prefixes', level: 'full', note: 'Prefixes and @vocab are emitted as terms.' },
      {
        key: 'scoped-contexts',
        level: 'full',
        note: 'Scoped contexts are emitted from their scoped terms and settings.',
      },
      {
        key: 'documentation',
        level: 'none',
        note: 'A @context has nowhere to put a term note. Notes stay in the model.',
      },
      {
        key: 'element-ids',
        level: 'none',
        note: 'A @context has nowhere to put an element id. Identity stays in the model.',
      },
      {
        key: 'examples',
        level: 'none',
        note: 'A @context has nowhere to put an example. Examples stay in the model.',
      },
      {
        key: 'shapes',
        level: 'none',
        note: 'A @context cannot say which fields a class has or how many values each takes. The `shacl` target carries the shapes layer.',
      },
    ],
  },
  'context-inline': {
    target: 'context-inline',
    extension: '.jsonld',
    capabilities: [
      {
        key: 'external-reference',
        level: 'downgraded',
        note: 'Referenced contexts are flattened in, forking the upstream vocabulary at a moment in time.',
      },
      { key: 'terms', level: 'full', note: 'Every term and every 1.1 facet is emitted.' },
      { key: 'prefixes', level: 'full', note: 'Prefixes and @vocab are emitted as terms.' },
      {
        key: 'scoped-contexts',
        level: 'full',
        note: 'Scoped contexts are emitted from their scoped terms and settings.',
      },
      {
        key: 'documentation',
        level: 'none',
        note: 'A @context has nowhere to put a term note. Notes stay in the model.',
      },
      {
        key: 'element-ids',
        level: 'none',
        note: 'A @context has nowhere to put an element id. Identity stays in the model.',
      },
      {
        key: 'examples',
        level: 'none',
        note: 'A @context has nowhere to put an example. Examples stay in the model.',
      },
      {
        key: 'shapes',
        level: 'none',
        note: 'A @context cannot say which fields a class has or how many values each takes. The `shacl` target carries the shapes layer.',
      },
    ],
  },
  shacl: {
    target: 'shacl',
    extension: '.shacl.ttl',
    capabilities: [
      { key: 'shapes', level: 'full', note: 'Every shape becomes a node shape, every field a property shape.' },
      { key: 'documentation', level: 'full', note: 'Shape and field notes are emitted as sh:description.' },
      { key: 'prefixes', level: 'full', note: 'Prefixes are emitted as Turtle prefixes.' },
      {
        key: 'terms',
        level: 'none',
        note: 'Coercion is a context fact; the shapes graph carries each field as the property its key resolves to.',
      },
      {
        key: 'scoped-contexts',
        level: 'none',
        note: 'Scoped contexts are resolved into field paths; the contexts themselves are not carried.',
      },
      {
        key: 'external-reference',
        level: 'none',
        note: 'Referenced contexts only decide what field keys resolve to.',
      },
      {
        key: 'list-cardinality',
        level: 'downgraded',
        note: 'Cardinality on a @list field counts distinct members, not list positions.',
      },
      {
        key: 'named-graphs',
        level: 'none',
        note: 'Values in a @graph container are not reached by the shapes graph.',
      },
      {
        key: 'element-ids',
        level: 'none',
        note: 'A shapes graph has nowhere to put an element id. Identity stays in the model.',
      },
      {
        key: 'examples',
        level: 'none',
        note: 'Examples stay in the model; L3 validates them against this graph.',
      },
    ],
  },
}

export function capabilitiesFor(target: TargetName): TargetCapabilities {
  return CAPABILITIES[target]
}

export function capability(target: TargetName, key: string): Capability | undefined {
  return CAPABILITIES[target].capabilities.find((c) => c.key === key)
}

/**
 * A downgrade appears in two places: as a finding on the model fact, and as a
 * comment at the corresponding position in the artifact. Both are produced from
 * one record so they cannot disagree.
 */
export interface Downgrade {
  finding: Finding
  /**
   * The artifact position the comment belongs at: a JSON Pointer into the
   * emitted document, or the document root for a header comment.
   */
  artifactPointer: JsonPointer
  comment: string
}
