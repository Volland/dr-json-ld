/**
 * Automatic layout for the graph pane, and the sidecar that overrides it.
 *
 * Positions a user arranges are stored separately from the model's semantics,
 * per view, keyed by element id — so renaming a term does not move its box and
 * moving a box does not change the model file.
 *
 * @lat: [[architecture#Architecture#Layout]]
 */
import ELK from 'elkjs/lib/elk.bundled.js'

import type { LayoutSidecar } from '../../src/host/adapter.js'
import type { GraphEdge, GraphNode } from './panes.js'

export interface Positioned {
  id: string
  x: number
  y: number
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 48

const elk = new ELK()

/**
 * Lay the graph out automatically, then let the sidecar override any box the
 * user has placed. The sidecar wins, because an arrangement a person made is
 * information the algorithm does not have.
 */
export async function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  sidecar: LayoutSidecar,
): Promise<Positioned[]> {
  if (nodes.length === 0) return []

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
    },
    children: nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  let computed: Positioned[]
  try {
    const result = (await elk.layout(graph)) as {
      children?: Array<{ id: string; x?: number; y?: number }>
    }
    computed = (result.children ?? []).map((child) => ({
      id: child.id,
      x: child.x ?? 0,
      y: child.y ?? 0,
    }))
  } catch {
    // A failed layout must not blank the pane; a column is legible enough to
    // work with while the user fixes whatever caused it.
    computed = nodes.map((node, i) => ({ id: node.id, x: 0, y: i * (NODE_HEIGHT + 24) }))
  }

  return computed.map((position) => {
    const saved = sidecar.graph[position.id]
    return saved ? { id: position.id, x: saved.x, y: saved.y } : position
  })
}

/** Record one box's position, keyed by element id rather than by name. */
export function withPosition(
  sidecar: LayoutSidecar,
  id: string,
  position: { x: number; y: number },
): LayoutSidecar {
  return { version: 1, graph: { ...sidecar.graph, [id]: position } }
}

/** Drop positions for elements the model no longer contains. */
export function prune(sidecar: LayoutSidecar, liveIds: ReadonlySet<string>): LayoutSidecar {
  const graph: LayoutSidecar['graph'] = {}
  for (const [id, position] of Object.entries(sidecar.graph)) {
    if (liveIds.has(id)) graph[id] = position
  }
  return { version: 1, graph }
}
