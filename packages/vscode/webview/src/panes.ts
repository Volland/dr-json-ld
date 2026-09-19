/**
 * Both panes, derived from one projection.
 *
 * Deriving both from one projection is what makes "a facet absent on the other
 * pane" cheap and correct: the tree pane renders `@container` and the graph
 * pane has nothing to render for it, from the same input.
 *
 * This module is the pure part — the shapes each pane draws — so it is testable
 * in plain Node with no DOM. The React components render what it returns.
 *
 * @lat: [[architecture#Architecture#Panes]]
 */
import type { ProjectedTerm, Projection } from '../../src/projection.js'

export type PaneName = 'tree' | 'graph'

/** One row in the tree pane: the JSON shape a developer will type. */
export interface TreeNode {
  /** The element id, which is also the selection key. */
  id: string
  key: string
  /** The JSON shape this term produces, in words a developer reads. */
  shape: string
  /** Nesting depth, from `@nest` groups and scoped-context regions. */
  depth: number
  /** A scoped context is drawn as a region, not an annotation. */
  region?: { kind: 'scoped-context'; extent: string }
  /** Children, for a container that nests. */
  children: TreeNode[]
  pointer: string
}

/** One node in the graph pane: what the document means once the JSON is gone. */
export interface GraphNode {
  id: string
  label: string
  iri: string | null
  /** A term coerced to `@id` denotes an edge; anything else denotes a literal. */
  kind: 'reference' | 'literal'
  pointer: string
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label: string
}

export interface Panes {
  tree: TreeNode[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
}

/** Build both panes from one projection, for one view. */
export function derivePanes(projection: Projection, viewId: string): Panes {
  const view = projection.views.find((v) => v.id === viewId) ?? projection.views[0]
  const ids = new Set(view?.termIds ?? projection.terms.map((t) => t.id))
  const terms = projection.terms.filter((t) => ids.has(t.id))

  return { tree: buildTree(terms), graph: buildGraph(terms) }
}

/**
 * The tree pane draws JSON structure: nesting, containers, language maps,
 * `@nest` groupings, and the regions where a scoped context changes the active
 * context.
 */
function buildTree(terms: readonly ProjectedTerm[]): TreeNode[] {
  const roots: TreeNode[] = []
  const nestGroups = new Map<string, TreeNode>()

  for (const term of terms) {
    const node: TreeNode = {
      id: term.id,
      key: term.key,
      shape: describeShape(term),
      depth: 0,
      children: [],
      pointer: term.pointer,
      ...(term.scoped
        ? {
            region: {
              kind: 'scoped-context' as const,
              // Its effect is positional: it applies below this point and,
              // absent `@propagate: false`, keeps applying.
              extent: describeScopeExtent(term),
            },
          }
        : {}),
    }

    const nest = term.facets['@nest']
    if (typeof nest === 'string') {
      let group = nestGroups.get(nest)
      if (!group) {
        group = {
          id: `nest:${nest}`,
          key: nest,
          shape: 'a nesting key — it holds the terms below it and vanishes on expansion',
          depth: 0,
          children: [],
          pointer: '',
        }
        nestGroups.set(nest, group)
        roots.push(group)
      }
      group.children.push({ ...node, depth: 1 })
      continue
    }

    roots.push(node)
  }

  return roots
}

/** What a reader will have to type, given this term's containers. */
export function describeShape(term: ProjectedTerm): string {
  const containers = normalizeContainer(term.facets['@container'])

  if (containers.includes('@language')) {
    return 'a map from language tag to string'
  }
  if (containers.includes('@index')) {
    return containers.includes('@graph')
      ? 'a map from index to a named graph'
      : 'a map from index to value'
  }
  if (containers.includes('@id')) {
    return containers.includes('@graph')
      ? 'a map from IRI to a named graph'
      : 'a map from IRI to node'
  }
  if (containers.includes('@type')) return 'a map from type IRI to node'
  if (containers.includes('@graph')) return 'a graph object'
  if (containers.includes('@list')) return 'an ordered array — order is meaningful'
  if (containers.includes('@set')) {
    return 'always an array, even with one value'
  }
  if (term.facets['@type'] === '@id') return 'an IRI string, read as a reference'
  if (typeof term.facets['@type'] === 'string') {
    return `a value typed ${String(term.facets['@type'])}`
  }
  if (typeof term.facets['@language'] === 'string') {
    return `a string tagged ${String(term.facets['@language'])}`
  }
  return 'a value or an array of values'
}

function describeScopeExtent(term: ProjectedTerm): string {
  const context = term.facets['@context']
  const propagates =
    context !== null &&
    typeof context === 'object' &&
    !Array.isArray(context) &&
    (context as Record<string, unknown>)['@propagate'] === false
  return propagates
    ? `applies to values of "${term.key}" and stops at the next node object`
    : `applies to everything below "${term.key}"`
}

/**
 * The graph pane draws classes, IRIs and the edges between them. A term with no
 * `@type: @id` denotes a literal, which is why it has no edge — the most common
 * cause of a document that expands into a graph with no edges.
 */
function buildGraph(terms: readonly ProjectedTerm[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  for (const term of terms) {
    const isReference = term.facets['@type'] === '@id' || term.facets['@reverse'] !== undefined
    nodes.push({
      id: term.id,
      label: term.key,
      iri: term.iri,
      kind: isReference ? 'reference' : 'literal',
      pointer: term.pointer,
    })
  }

  // An edge is drawn where one term references another term's IRI, which is the
  // only structural relation the terms layer can state. Class membership is the
  // shapes layer, and this pane does not invent it.
  const byIri = new Map(terms.filter((t) => t.iri).map((t) => [t.iri!, t.id]))
  for (const term of terms) {
    if (term.facets['@type'] !== '@id' && term.facets['@reverse'] === undefined) continue
    const target = typeof term.iri === 'string' ? byIri.get(term.iri) : undefined
    if (target === undefined || target === term.id) continue
    edges.push({
      id: `${term.id}->${target}`,
      source: term.id,
      target,
      label: term.key,
    })
  }

  return { nodes, edges }
}

/**
 * What the *other* pane must render as visibly absent.
 *
 * A user who selects a term with `@container: @set` and sees the tree pane
 * change while the graph pane holds still has learned the lesson the tool
 * exists to teach; a user who sees the graph pane simply not react has learned
 * nothing and may conclude the tool is broken.
 *
 * @lat: [[architecture#Architecture#Panes#Selection]]
 */
export function absenceOn(pane: PaneName, term: ProjectedTerm): string | undefined {
  if (pane === 'graph') {
    if (term.shapeOnly.length === 0) return undefined
    const facets = term.shapeOnly.join(' and ')
    return `${facets} changes the JSON shape of "${term.key}" and no triple, so there is nothing to draw here.`
  }
  // The tree pane holds still for a change that is purely about identity.
  if (term.facets['@reverse'] !== undefined) {
    return `"${term.key}" is a reverse property: it changes which way the edge points and not the JSON shape.`
  }
  return undefined
}

function normalizeContainer(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}

/**
 * The shared selection model. A selection is an element id, so coordinating the
 * panes needs no cross-pane mapping table.
 */
export interface Selection {
  termId: string | undefined
}

export function selectedTerm(
  projection: Projection,
  selection: Selection,
): ProjectedTerm | undefined {
  return projection.terms.find((t) => t.id === selection.termId)
}
