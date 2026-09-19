/**
 * A plain-Node implementation of {@link HostAdapter}.
 *
 * It exists so every canvas interaction is testable without an editor anywhere
 * near it, and so the claim that the webview does not assume an editor host is
 * checked rather than asserted.
 *
 * @lat: [[architecture#Architecture#Host Adapter]]
 */
import { resolve as resolvePath } from 'node:path'

import {
  resolveModelText,
  resolverFor,
  SourceIndex,
  validateModel,
  VendorStore,
  type Finding,
  type JsonPointer,
} from '@jsonld-modeler/core'

import { applyIntents, type Intent } from '../intents/intent.js'
import { releaseStateFor } from '../release-state.js'
import { invalidate, project, type Projection } from '../projection.js'
import {
  DEFAULT_VIEW,
  emptyLayout,
  emptyLayoutDocument,
  type HostAdapter,
  type LayoutDocument,
  type LayoutSidecar,
} from './adapter.js'

export interface NodeHostOptions {
  /** The model file's contents. Held in memory; the host owns persistence. */
  text: string
  path?: string
  /** The directory the model sits in, for vendored contexts. */
  root?: string
  layout?: LayoutDocument
  onReveal?: (pointer: JsonPointer) => void
}

export class NodeHost implements HostAdapter {
  text: string
  readonly path: string
  private readonly root: string | undefined
  private layout: LayoutDocument
  private revision = 0
  private lastValid: Projection | undefined
  private readonly onReveal: ((pointer: JsonPointer) => void) | undefined

  /** Findings last reported, so a test can assert what the Problems panel saw. */
  reported: Finding[] = []

  /**
   * Intents are serialised: a gesture that posts two must not have the second
   * spliced against offsets the first already moved.
   */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: NodeHostOptions) {
    this.text = options.text
    this.path = options.path ?? 'model.jsonld.yaml'
    this.root = options.root
    this.layout = options.layout ?? emptyLayoutDocument()
    this.onReveal = options.onReveal
  }

  async readModel(): Promise<Projection> {
    return this.serialise(() => this.projectNow())
  }

  async applyIntent(intent: Intent): Promise<Projection> {
    return this.serialise(() => {
      this.text = applyIntents(this.text, [intent])
      this.revision++
      return this.projectNow()
    })
  }

  async resolveVendoredContext(iri: string): Promise<unknown> {
    if (this.root === undefined) return undefined
    const { ir } = resolveModelText(this.text, this.path)
    if (!ir) return undefined
    return resolverFor(ir, this.root)(iri)
  }

  async reportFindings(findings: readonly Finding[]): Promise<void> {
    this.reported = [...findings]
  }

  async readLayout(view: string): Promise<LayoutSidecar> {
    return this.layout.views[view] ?? emptyLayout()
  }

  async writeLayout(view: string, layout: LayoutSidecar): Promise<void> {
    this.layout = { ...this.layout, views: { ...this.layout.views, [view]: layout } }
  }

  async reveal(pointer: JsonPointer): Promise<void> {
    this.onReveal?.(pointer)
  }

  /** The sidecar as it stands, for a test asserting what was persisted. */
  layoutDocument(): LayoutDocument {
    return this.layout
  }

  private projectNow(): Projection {
    const source = SourceIndex.parse(this.text, { path: this.path })
    const { ir } = resolveModelText(this.text, this.path)
    // "Unparseable" means the YAML did not parse, not that the model has
    // findings — a model with an unknown prefix still has a diagram worth
    // drawing, and a file mid-keystroke does not.
    if (source.errors.length > 0 || !ir) {
      return invalidate(this.lastValid, source.errors[0]?.message ?? 'the model did not resolve')
    }

    const store = this.root === undefined ? undefined : new VendorStore({ root: this.root })
    const report = validateModel(source, {
      ...(this.root !== undefined ? { resolveContext: resolverFor(ir, this.root) } : {}),
    })
    this.reported = report.findings

    const release =
      this.root === undefined
        ? undefined
        : releaseStateFor({ modelPath: resolvePath(this.root, this.path) })

    const projection = project(ir, {
      findings: report.findings,
      revision: this.revision,
      locate: (pointer) => source.positionOf(pointer),
      ...(store ? { isVendored: (iri: string) => store.has(iri) } : {}),
      ...(release !== undefined ? { release } : {}),
    })
    this.lastValid = projection
    return projection
  }

  private serialise<T>(work: () => T): Promise<T> {
    const next = this.queue.then(work)
    // The queue never rejects, so one failed intent does not wedge the host.
    this.queue = next.catch(() => undefined)
    return next
  }
}

export { DEFAULT_VIEW }
