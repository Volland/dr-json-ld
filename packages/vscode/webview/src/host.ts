/**
 * The webview's view of its host.
 *
 * The webview reaches its host through this and nothing else. It never calls
 * `acquireVsCodeApi` directly, and it never assumes an editor is there — which
 * is what lets the same code be driven by a plain-Node host in a test.
 *
 * @lat: [[architecture#Architecture#Host Adapter]]
 */
import type { Intent } from '../../src/intents/intent.js'
import type { LayoutSidecar } from '../../src/host/adapter.js'
import type { Projection } from '../../src/projection.js'

export interface WebviewHost {
  /** Called whenever a fresh projection arrives. */
  onProjection(listener: (projection: Projection) => void): () => void
  postIntent(intent: Intent): void
  postLayout(view: string, layout: LayoutSidecar): void
  reveal(pointer: string): void
  /** Open another model in the project. The host opens its canvas. */
  openModel(path: string): void
  ready(): void
}

type Listener = (projection: Projection) => void

interface VsCodeApi {
  postMessage(message: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

/** The VS Code implementation, built only when that API is present. */
export function vscodeHost(): WebviewHost {
  const api = acquireVsCodeApi()
  const listeners = new Set<Listener>()

  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as Record<string, unknown> | null
    if (message?.['kind'] !== 'projection') return
    for (const listener of listeners) listener(message['projection'] as Projection)
  })

  return {
    onProjection(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    postIntent: (intent) => api.postMessage({ kind: 'intent', intent }),
    postLayout: (view, layout) => api.postMessage({ kind: 'layout', view, layout }),
    reveal: (pointer) => api.postMessage({ kind: 'reveal', pointer }),
    openModel: (path) => api.postMessage({ kind: 'open-model', path }),
    ready: () => api.postMessage({ kind: 'ready' }),
  }
}

/**
 * A host backed by an object rather than by messaging, used by tests and by any
 * future non-editor host.
 */
export function directHost(adapter: {
  readModel(): Promise<Projection>
  applyIntent(intent: Intent): Promise<Projection>
  writeLayout(view: string, layout: LayoutSidecar): Promise<void>
  reveal(pointer: string): Promise<void>
  openModel?(path: string): Promise<void>
}): WebviewHost {
  const listeners = new Set<Listener>()
  const publish = (projection: Projection): void => {
    for (const listener of listeners) listener(projection)
  }
  return {
    onProjection(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    postIntent: (intent) => {
      void adapter.applyIntent(intent).then(publish)
    },
    postLayout: (view, layout) => {
      void adapter.writeLayout(view, layout)
    },
    reveal: (pointer) => {
      void adapter.reveal(pointer)
    },
    openModel: (path) => {
      void adapter.openModel?.(path)
    },
    ready: () => {
      void adapter.readModel().then(publish)
    },
  }
}
