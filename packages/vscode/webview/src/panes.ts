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
import type {
  ProjectedField,
  ProjectedShape,
  ProjectedTerm,
  Projection,
} from '../../src/projection.js'

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
  /** How many values a shape's field takes, `min..max`, on a skeleton row. */
  cardinality?: string
  /** A shape reached again below itself: drawn once, as a reference. */
  recursion?: string
}

/** One node in the graph pane: what the document means once the JSON is gone. */
export interface GraphNode {
  id: string
  label: string
  iri: string | null
  /** A term coerced to `@id` denotes an edge; anything else a literal; a shape its class. */
  kind: 'reference' | 'literal' | 'shape'
  pointer: string
  /** A shape's fields, one line each: `key min..max range`. */
  fields?: string[]
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
  const scoped = scopedWithin(projection, terms)
  const shapeIds = new Set(view?.shapeIds ?? (projection.shapes ?? []).map((s) => s.id))
  const shapes = reachable(projection, (projection.shapes ?? []).filter((s) => shapeIds.has(s.id)))

  const graph = buildGraph([...terms, ...scoped])
  addShapes(graph, shapes, projection)
  return { tree: buildTree(terms, projection), graph }
}

/** Every scoped term under the given terms, to any depth. */
function scopedWithin(projection: Projection, terms: readonly ProjectedTerm[]): ProjectedTerm[] {
  const out: ProjectedTerm[] = []
  const parents = new Set(terms.map((t) => t.id))
  for (const term of projection.scopedTerms ?? []) {
    if (term.parentId !== undefined && parents.has(term.parentId)) {
      out.push(term)
      parents.add(term.id)
    }
  }
  return out
}

/** A view of one shape also shows the shapes its fields reach. */
function reachable(projection: Projection, shapes: readonly ProjectedShape[]): ProjectedShape[] {
  const out = new Map(shapes.map((s) => [s.id, s]))
  const queue = [...shapes]
  while (queue.length > 0) {
    const shape = queue.pop()!
    for (const field of shape.fields) {
      if (field.range?.kind !== 'shape' || field.range.shapeId === null) continue
      const next = (projection.shapes ?? []).find((s) => s.id === (field.range as { shapeId: string }).shapeId)
      if (next !== undefined && !out.has(next.id)) {
        out.set(next.id, next)
        queue.push(next)
      }
    }
  }
  return [...out.values()]
}

/** `min..max`, with `*` for no maximum. */
export function cardinality(field: Pick<ProjectedField, 'min' | 'max'>): string {
  return `${field.min ?? 0}..${field.max ?? '*'}`
}

export function describeRange(field: ProjectedField): string {
  const range = field.range
  if (range === undefined) return 'any value'
  switch (range.kind) {
    case 'datatype':
      return range.datatype
    case 'class':
      return `a ${range.class}`
    case 'shape':
      return `a ${range.shape}`
    default:
      return range.kind
  }
}

/**
 * Shapes in the graph pane: the target class carrying its fields, and an edge
 * for every class or shape range, labelled with the field and its cardinality.
 */
function addShapes(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  shapes: readonly ProjectedShape[],
  projection: Projection,
): void {
  const nodeFor = (shape: ProjectedShape) => `shape:${shape.id}`
  for (const shape of shapes) {
    graph.nodes.push({
      id: nodeFor(shape),
      label: shape.target !== undefined ? `${shape.name} — ${shape.target}` : shape.name,
      iri: shape.targetIri,
      kind: 'shape',
      pointer: shape.pointer,
      fields: shape.fields.map((f) => `${f.key} ${cardinality(f)} ${describeRange(f)}`),
    })
  }
  const shown = new Set(shapes.map((s) => s.id))
  for (const shape of shapes) {
    for (const field of shape.fields) {
      const label = `${field.key} ${cardinality(field)}`
      if (field.range?.kind === 'shape' && field.range.shapeId !== null && shown.has(field.range.shapeId)) {
        graph.edges.push({
          id: `${nodeFor(shape)}.${field.key}`,
          source: nodeFor(shape),
          target: `shape:${field.range.shapeId}`,
          label,
        })
      }
      if (field.range?.kind === 'class' && field.range.iri !== null) {
        // A class range points at the shape for that class when one is shown,
        // and otherwise at the class term itself.
        const target =
          shapes.find((s) => s.targetIri === (field.range as { iri: string }).iri) ??
          undefined
        const classTerm = projection.terms.find((t) => t.iri === (field.range as { iri: string }).iri)
        const to = target !== undefined ? nodeFor(target) : classTerm?.id
        if (to !== undefined && graph.nodes.some((n) => n.id === to)) {
          graph.edges.push({ id: `${nodeFor(shape)}.${field.key}`, source: nodeFor(shape), target: to, label })
        }
      }
    }
  }
}

/**
 * The JSON skeleton of a document conforming to a shape: its keys, the form each
 * value takes, nested shapes as nested objects, and the type-scoped region the
 * keys are read in. A shape reached again below itself is drawn once, as a
 * reference, so a recursive shape stays finite.
 */
export function deriveSkeleton(projection: Projection, shapeId: string): TreeNode[] {
  const shape = (projection.shapes ?? []).find((s) => s.id === shapeId)
  if (shape === undefined) return []
  return skeleton(projection, shape, 0, new Set([shape.id]))
}

function skeleton(
  projection: Projection,
  shape: ProjectedShape,
  depth: number,
  seen: ReadonlySet<string>,
): TreeNode[] {
  const allTerms = [...projection.terms, ...(projection.scopedTerms ?? [])]
  const rows = shape.fields.map((field): TreeNode => {
    const term = allTerms.find((t) => t.id === field.termId)
    const row: TreeNode = {
      id: field.termId ?? `field:${shape.id}.${field.key}`,
      key: field.key,
      shape: term !== undefined ? describeShape(term) : `resolves to ${field.iri ?? 'nothing'}`,
      depth,
      children: [],
      pointer: field.pointer,
      cardinality: cardinality(field),
    }
    if (field.range?.kind !== 'shape' || field.range.shapeId === null) return row
    const nested = (projection.shapes ?? []).find((s) => s.id === (field.range as { shapeId: string }).shapeId)
    if (nested === undefined) return row
    if (seen.has(nested.id)) return { ...row, recursion: nested.name }
    return {
      ...row,
      shape: `an object shaped by ${nested.name}`,
      children: skeleton(projection, nested, depth + 1, new Set([...seen, nested.id])),
    }
  })
  // Keys read through the class's type-scoped context sit inside its region.
  const classTerm = projection.terms.find((t) => t.id === shape.targetTermId)
  if (classTerm === undefined || classTerm.scopedTermIds.length === 0) return rows
  const scoped = new Set(classTerm.scopedTermIds)
  const inside = rows.filter((r) => scoped.has(r.id))
  if (inside.length === 0) return rows
  return [
    {
      id: `region:${classTerm.id}`,
      key: `@type: ${classTerm.key}`,
      shape: 'keys below are read in the class’s type-scoped context',
      depth,
      children: inside,
      pointer: classTerm.pointer,
      region: { kind: 'scoped-context', extent: `applies to nodes typed ${classTerm.key}` },
    },
    ...rows.filter((r) => !scoped.has(r.id)),
  ]
}

/**
 * The tree pane draws JSON structure: nesting, containers, language maps,
 * `@nest` groupings, and the regions where a scoped context changes the active
 * context.
 */
function buildTree(terms: readonly ProjectedTerm[], projection?: Projection): TreeNode[] {
  const roots: TreeNode[] = []
  const nestGroups = new Map<string, TreeNode>()

  for (const term of terms) {
    const node: TreeNode = {
      id: term.id,
      key: term.key,
      shape: describeShape(term),
      depth: 0,
      // A scoped term is drawn inside the region of the context that holds it.
      children: projection === undefined ? [] : scopedRows(projection, term, 1),
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

function scopedRows(projection: Projection, parent: ProjectedTerm, depth: number): TreeNode[] {
  return (projection.scopedTerms ?? [])
    .filter((t) => t.parentId === parent.id)
    .map((term) => ({
      id: term.id,
      key: term.key,
      shape: describeShape(term),
      depth,
      children: scopedRows(projection, term, depth + 1),
      pointer: term.pointer,
      ...(term.scoped
        ? { region: { kind: 'scoped-context' as const, extent: describeScopeExtent(term) } }
        : {}),
    }))
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
  /** A selected shape, which the inspector shows as a field table. */
  shapeId?: string | undefined
}

/** The selected term, top-level or scoped: a scoped `name` is not the top-level one. */
export function selectedTerm(
  projection: Projection,
  selection: Selection,
): ProjectedTerm | undefined {
  return (
    projection.terms.find((t) => t.id === selection.termId) ??
    (projection.scopedTerms ?? []).find((t) => t.id === selection.termId)
  )
}

export function selectedShape(
  projection: Projection,
  selection: Selection,
): ProjectedShape | undefined {
  if (selection.shapeId === undefined) return undefined
  return (projection.shapes ?? []).find((s) => s.id === selection.shapeId)
}

/** A graph node id to the selection it stands for. */
export function selectionFor(nodeId: string): Selection {
  return nodeId.startsWith('shape:')
    ? { termId: undefined, shapeId: nodeId.slice('shape:'.length) }
    : { termId: nodeId }
}
