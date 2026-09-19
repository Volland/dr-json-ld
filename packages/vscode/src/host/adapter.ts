/**
 * The host adapter interface.
 *
 * The webview is written against this, not against VS Code's messaging API.
 * Retrofitting a second host onto a webview that assumed `acquireVsCodeApi` is
 * a rewrite of every interaction; writing the seam first costs roughly a tenth
 * of that and is testable in plain Node from the start.
 *
 * Nothing in this file imports `vscode`.
 *
 * @lat: [[architecture#Architecture#Host Adapter]]
 */
import type { Finding, JsonPointer } from '@json-ld-modeler/core'

import type { Projection } from '../projection.js'
import type { Intent } from '../intents/intent.js'

export interface HostAdapter {
  /** The current projection of the model. */
  readModel(): Promise<Projection>
  /**
   * Apply one named intent. The host turns it into targeted splices and sends a
   * fresh projection back, so nothing on either pane can diverge from the file.
   */
  applyIntent(intent: Intent): Promise<Projection>
  /** A vendored context, for completion and collision detection. Offline. */
  resolveVendoredContext(iri: string): Promise<unknown>
  /** Report findings to whatever the host shows diagnostics in. */
  reportFindings(findings: readonly Finding[]): Promise<void>
  /** Read the layout sidecar for one view and pane. */
  readLayout(view: string): Promise<LayoutSidecar>
  /** Persist layout. Keyed by element id, so a rename does not move a box. */
  writeLayout(view: string, layout: LayoutSidecar): Promise<void>
  /** Reveal a position in whatever the host uses to show the model file. */
  reveal(pointer: JsonPointer): Promise<void>
}

/**
 * Positions for the graph pane, keyed by element id and nested per view.
 *
 * The tree pane persists no coordinates in this change — its layout is derived
 * from structure — which defers the open question of whether the two panes
 * share a sidecar rather than answering it wrongly.
 *
 * @lat: [[architecture#Architecture#Layout]]
 */
export interface LayoutSidecar {
  /** The format version of the sidecar itself. */
  version: 1
  /** Element id to position, for the graph pane only. */
  graph: Record<string, { x: number; y: number }>
}

export function emptyLayout(): LayoutSidecar {
  return { version: 1, graph: {} }
}

/** The name of the sidecar file, beside the model. */
export function layoutFileName(modelFileName: string): string {
  return `${modelFileName.replace(/\.jsonld\.yaml$/, '')}.layout.json`
}

/** The whole sidecar, all views. */
export interface LayoutDocument {
  version: 1
  views: Record<string, LayoutSidecar>
}

export function emptyLayoutDocument(): LayoutDocument {
  return { version: 1, views: {} }
}

/** The default view name, for a model that declares none. */
export const DEFAULT_VIEW = 'all'
