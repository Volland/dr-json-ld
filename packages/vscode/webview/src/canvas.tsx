/**
 * The canvas: two coordinated panes over one model, plus the inspector.
 *
 * Every question it asks — a term name, an IRI, a confirmation — is rendered in
 * the document. A VS Code webview is a sandboxed iframe in which
 * `window.prompt`, `window.confirm` and `window.alert` return immediately
 * without showing anything, so an action routed through one does nothing at
 * all, and does it silently.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Asking]]
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'

import type { FieldSpec, IrRange, RangeSpec } from '@json-ld-modeler/core'

import type { LayoutSidecar } from '../../src/host/adapter.js'
import type { Intent } from '../../src/intents/intent.js'
import type {
  ProjectedField,
  ProjectedShape,
  ProjectedTerm,
  Projection,
  ProjectionRelease,
} from '../../src/projection.js'
import { vscodeHost, type WebviewHost } from './host.js'
import { layoutGraph, withPosition } from './layout.js'
import {
  absenceOn,
  cardinality,
  derivePanes,
  deriveSkeleton,
  selectedShape,
  selectedTerm,
  selectionFor,
  type Selection,
  type TreeNode,
} from './panes.js'

/** Facets the inspector gives a field. The rest live behind `Advanced`. */
const PROMINENT = ['@id', '@type', '@container'] as const
const ADVANCED = [
  '@language',
  '@direction',
  '@protected',
  '@nest',
  '@reverse',
  '@prefix',
  '@index',
] as const

interface Props {
  host: WebviewHost
}

export function Canvas({ host }: Props): JSX.Element {
  const [projection, setProjection] = useState<Projection | undefined>(undefined)
  const [selection, setSelection] = useState<Selection>({ termId: undefined })
  const [viewId, setViewId] = useState<string | undefined>(undefined)
  const [sidecar, setSidecar] = useState<LayoutSidecar>({ version: 1, graph: {} })
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [asking, setAsking] = useState<AskState | undefined>(undefined)

  useEffect(() => {
    const off = host.onProjection(setProjection)
    host.ready()
    return off
  }, [host])

  const view = useMemo(() => {
    if (!projection) return undefined
    return projection.views.find((v) => v.id === viewId) ?? projection.views[0]
  }, [projection, viewId])

  const panes = useMemo(
    () => (projection && view ? derivePanes(projection, view.id) : undefined),
    [projection, view],
  )

  useEffect(() => {
    if (!panes) return
    let cancelled = false
    void layoutGraph(panes.graph.nodes, panes.graph.edges, sidecar).then((laid) => {
      if (cancelled) return
      setPositions(new Map(laid.map((p) => [p.id, { x: p.x, y: p.y }])))
    })
    return () => {
      cancelled = true
    }
  }, [panes, sidecar])

  const post = useCallback((intent: Intent) => host.postIntent(intent), [host])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Moving a box changes the sidecar and nothing else. The model file is
      // untouched, which is what makes rearranging free.
      let next = sidecar
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue
        next = withPosition(next, change.id, change.position)
      }
      if (next === sidecar) return
      setSidecar(next)
      if (view) host.postLayout(view.id, next)
    },
    [host, sidecar, view],
  )

  if (!projection) return <main className="canvas loading">Reading the model…</main>

  const term = selectedTerm(projection, selection)
  const shape = selectedShape(projection, selection)
  const treeRows = shape ? deriveSkeleton(projection, shape.id) : (panes?.tree ?? [])

  return (
    <main className="canvas">
      {!projection.valid && (
        <div className="banner" role="status">
          The model file is not valid right now — showing the last diagram that was.
          {projection.invalidReason ? ` ${projection.invalidReason}` : ''}
        </div>
      )}

      <header className="toolbar">
        {projection.release && projection.release.siblingModels.length > 1 && (
          <label>
            Model{' '}
            <select
              value={projection.release.siblingModels.find((m) => m.active)?.path ?? ''}
              onChange={(event) => host.openModel(event.target.value)}
            >
              {projection.release.siblingModels.map((model) => (
                <option key={model.path} value={model.path}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          View{' '}
          <select
            value={view?.id ?? ''}
            onChange={(event) => setViewId(event.target.value)}
          >
            {projection.views.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setAsking({ kind: 'create-term' })}>
          Add a term
        </button>
        <button type="button" onClick={() => setAsking({ kind: 'add-shape' })}>
          Add a shape
        </button>
        {term && (
          <>
            <button
              type="button"
              onClick={() => setAsking({ kind: 'add-scoped-term', parentId: term.id, value: term.path })}
            >
              Add a scoped term
            </button>
            <button
              type="button"
              onClick={() => setAsking({ kind: 'rename-term', id: term.id, value: term.key })}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => setAsking({ kind: 'delete-term', id: term.id, value: term.key })}
            >
              Delete
            </button>
          </>
        )}
      </header>

      {asking && (
        <AskInDocument
          state={asking}
          projection={projection}
          onCancel={() => setAsking(undefined)}
          onSubmit={(intent) => {
            post(intent)
            setAsking(undefined)
          }}
        />
      )}

      <div className="panes">
        <section className="pane tree" aria-label="JSON shape">
          <h2>{shape ? `A document shaped by ${shape.name}` : 'JSON shape'}</h2>
          {treeRows.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              selection={selection}
              onSelect={(id) => setSelection({ termId: id })}
              onReveal={host.reveal}
            />
          ))}
          {term && <Absence pane="tree" term={term} />}
        </section>

        <section className="pane graph" aria-label="RDF graph">
          <h2>What it denotes</h2>
          <ReactFlow
            nodes={toFlowNodes(panes?.graph.nodes ?? [], positions, selection)}
            edges={toFlowEdges(panes?.graph.edges ?? [])}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => setSelection(selectionFor(node.id))}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
          {term && <Absence pane="graph" term={term} />}
        </section>

        <aside className="inspector" aria-label="Inspector">
          {shape ? (
            <ShapeInspector
              shape={shape}
              projection={projection}
              onEdit={post}
              onAsk={setAsking}
            />
          ) : term ? (
            <Inspector term={term} onEdit={post} />
          ) : (
            <p>Select a term or a shape to see what it is.</p>
          )}
          {projection.release && <Release release={projection.release} />}
        </aside>
      </div>
    </main>
  )
}

/**
 * Versions and aliases, shown and not edited.
 *
 * A version is immutable and retargeting an alias is a deliberate act with
 * consequences for every consumer, so both belong at a command line where the
 * act is explicit and reviewable — not behind a click on a diagram.
 *
 * @lat: [[emitters#Emitters#Change Management]]
 */
function Release({ release }: { release: ProjectionRelease }): JSX.Element {
  return (
    <section className="release" aria-label="Versions">
      <h2>Released</h2>
      {release.projectName && <p className="project">Project: {release.projectName}</p>}

      {release.versions.length === 0 ? (
        <p>
          No versions yet. Run <code>ldm version new</code> to freeze this model as one.
        </p>
      ) : (
        <ul className="versions">
          {release.versions.map((version) => (
            <li key={version.id} className={version.verified ? '' : 'unverified'}>
              <code>{version.id}</code>
              <span>{version.created}</span>
              {!version.verified && <strong> does not verify</strong>}
            </li>
          ))}
        </ul>
      )}

      {release.aliases.length > 0 && (
        <ul className="aliases">
          {release.aliases.map((alias) => (
            <li key={alias.name}>
              {alias.name} → <code>{alias.versionId}</code>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        Versions are immutable. To correct one, make a new version and point the alias at it
        with <code>ldm alias set</code>.
      </p>
    </section>
  )
}

function Absence({ pane, term }: { pane: 'tree' | 'graph'; term: ProjectedTerm }): JSX.Element | null {
  const message = absenceOn(pane, term)
  if (!message) return null
  // Absence is drawn. Holding still is what teaches the lesson; showing nothing
  // teaches nothing.
  return (
    <p className="absence" role="note">
      {message}
    </p>
  )
}

function TreeRow({
  node,
  selection,
  onSelect,
  onReveal,
}: {
  node: TreeNode
  selection: Selection
  onSelect: (id: string) => void
  onReveal: (pointer: string) => void
}): JSX.Element {
  const selected = selection.termId === node.id
  return (
    <div className={`tree-row${selected ? ' selected' : ''}`} style={{ marginLeft: node.depth * 16 }}>
      <button type="button" onClick={() => onSelect(node.id)} onDoubleClick={() => onReveal(node.pointer)}>
        <span className="key">{node.key}</span>
        {node.cardinality && <span className="cardinality">{node.cardinality}</span>}
        <span className="shape">
          {node.recursion ? `another ${node.recursion}, as drawn above` : node.shape}
        </span>
      </button>
      {node.region && (
        <div className="region" data-kind={node.region.kind}>
          <span>scoped context — {node.region.extent}</span>
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              selection={selection}
              onSelect={onSelect}
              onReveal={onReveal}
            />
          ))}
        </div>
      )}
      {!node.region &&
        node.children.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            selection={selection}
            onSelect={onSelect}
            onReveal={onReveal}
          />
        ))}
    </div>
  )
}

/**
 * The inspector: the common facets given fields, the remainder behind an
 * advanced section, and a raw escape hatch so coverage never depends on a field
 * having grown yet.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Inspector]]
 */
function Inspector({
  term,
  onEdit,
}: {
  term: ProjectedTerm
  onEdit: (intent: Intent) => void
}): JSX.Element {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [rawText, setRawText] = useState(() => JSON.stringify(term.raw ?? {}, null, 2))
  const [rawError, setRawError] = useState<string | undefined>(undefined)

  useEffect(() => {
    setRawText(JSON.stringify(term.raw ?? {}, null, 2))
    setRawError(undefined)
  }, [term.id, term.raw])

  return (
    <div className="inspector-body">
      <h2>{term.path}</h2>
      <p className="iri">{term.iri ?? 'no IRI'}</p>
      {term.parentId !== undefined && (
        <p className="hint">
          A scoped term: it applies only below the term whose context holds it, and a key of the
          same name elsewhere is a different term.
        </p>
      )}
      {!term.idWritten && (
        <p className="warn">
          This term's id is derived from its key, so renaming it will read as a removal and an
          addition. Run <code>ldm ids</code> to write real ones in.
        </p>
      )}

      {PROMINENT.map((facet) => (
        <FacetField key={facet} term={term} facet={facet} onEdit={onEdit} />
      ))}

      <button type="button" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? 'Hide advanced' : 'Advanced'}
      </button>
      {showAdvanced &&
        ADVANCED.map((facet) => (
          <FacetField key={facet} term={term} facet={facet} onEdit={onEdit} />
        ))}

      <details className="raw">
        <summary>Raw</summary>
        <p>
          Anything the metamodel has not given a name. It reaches the emitted context unchanged.
        </p>
        <textarea
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          spellCheck={false}
          rows={6}
        />
        {rawError && <p className="warn">{rawError}</p>}
        <button
          type="button"
          onClick={() => {
            try {
              const parsed = JSON.parse(rawText) as Record<string, unknown>
              setRawError(undefined)
              onEdit({ kind: 'set-raw', id: term.id, raw: parsed })
            } catch (error) {
              setRawError(error instanceof Error ? error.message : String(error))
            }
          }}
        >
          Apply
        </button>
      </details>
    </div>
  )
}

function FacetField({
  term,
  facet,
  onEdit,
}: {
  term: ProjectedTerm
  facet: string
  onEdit: (intent: Intent) => void
}): JSX.Element {
  const current = term.facets[facet]
  const [draft, setDraft] = useState(() => renderFacetValue(current))

  useEffect(() => setDraft(renderFacetValue(current)), [current, term.id])

  return (
    <label className="facet">
      <span>{facet}</span>
      <input
        value={draft}
        placeholder="unset"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = parseFacetValue(draft)
          if (renderFacetValue(current) === draft) return
          onEdit({ kind: 'retype-term', id: term.id, facet, value: parsed })
        }}
      />
    </label>
  )
}

function renderFacetValue(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function parseFacetValue(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

type AskState =
  | { kind: 'create-term' }
  | { kind: 'rename-term'; id: string; value: string }
  | { kind: 'delete-term'; id: string; value: string }
  | { kind: 'add-shape' }
  | { kind: 'add-scoped-term'; parentId: string; value: string }
  /** A field whose key has no term yet: its IRI is asked for, and both are added. */
  | { kind: 'field-iri'; shape: string; key: string; field: FieldSpec }

/** Datatypes the range picker offers, written against `xsd:` when the model declares it. */
const DATATYPES = ['string', 'dateTime', 'date', 'integer', 'decimal', 'boolean', 'anyURI']

/**
 * A shape as a table of fields. Cardinality and range are shapes-layer facts,
 * carried by the `shacl` target and absent from every `@context`, and each row
 * says so; the coercion beside them is the term's, which the range must agree
 * with. A disagreement is offered a repair that is asked, never applied quietly.
 *
 * @lat: [[metamodel#Metamodel#Shapes]]
 */
function ShapeInspector({
  shape,
  projection,
  onEdit,
  onAsk,
}: {
  shape: ProjectedShape
  projection: Projection
  onEdit: (intent: Intent) => void
  onAsk: (state: AskState) => void
}): JSX.Element {
  const [newKey, setNewKey] = useState('')
  const classTerm = projection.terms.find((t) => t.id === shape.targetTermId)
  const keys = useMemo(() => {
    const scoped = (projection.scopedTerms ?? []).filter((t) => t.parentId === shape.targetTermId)
    return [...new Set([...scoped, ...projection.terms].map((t) => t.key))]
  }, [projection, shape.targetTermId])

  const addField = (): void => {
    const key = newKey.trim()
    if (key === '') return
    setNewKey('')
    if (keys.includes(key)) onEdit({ kind: 'add-field', shape: shape.name, key, field: {} })
    else onAsk({ kind: 'field-iri', shape: shape.name, key, field: {} })
  }

  return (
    <div className="inspector-body shape-inspector">
      <h2>{shape.name}</h2>
      <label className="facet">
        <span>target class</span>
        <input
          defaultValue={shape.target ?? ''}
          key={`${shape.id}:${shape.target ?? ''}`}
          placeholder="none — applies only where a range names it"
          list="class-terms"
          onBlur={(event) => {
            const value = event.target.value.trim()
            if (value === (shape.target ?? '')) return
            onEdit({ kind: 'set-shape', shape: shape.name, property: 'targetClass', ...(value ? { value } : {}) })
          }}
        />
      </label>
      <label className="facet">
        <span>closed</span>
        <input
          type="checkbox"
          checked={shape.closed}
          onChange={(event) =>
            onEdit({
              kind: 'set-shape',
              shape: shape.name,
              property: 'closed',
              ...(event.target.checked ? { value: true } : {}),
            })
          }
        />
      </label>
      <datalist id="class-terms">
        {projection.terms.map((t) => (
          <option key={t.id} value={t.key} />
        ))}
      </datalist>

      <table className="fields">
        <thead>
          <tr>
            <th>key</th>
            <th>range</th>
            <th>min</th>
            <th>max</th>
            <th>coercion</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shape.fields.map((field) => (
            <FieldRow
              key={`${shape.id}.${field.key}`}
              shape={shape}
              field={field}
              projection={projection}
              classKey={classTerm?.key}
              onEdit={onEdit}
            />
          ))}
        </tbody>
      </table>
      <p className="hint">
        Cardinality and range are carried by the <code>shacl</code> target and are absent from the
        <code> @context</code>. How a key is read — its coercion — stays on the term.
      </p>

      <div className="add-field">
        <input
          value={newKey}
          placeholder="add a field: a key"
          list="field-keys"
          onChange={(event) => setNewKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addField()
          }}
        />
        <datalist id="field-keys">
          {keys.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
        <button type="button" onClick={addField}>
          Add field
        </button>
      </div>
    </div>
  )
}

function FieldRow({
  shape,
  field,
  projection,
  classKey,
  onEdit,
}: {
  shape: ProjectedShape
  field: ProjectedField
  projection: Projection
  classKey: string | undefined
  onEdit: (intent: Intent) => void
}): JSX.Element {
  const spec = specOf(field)
  const set = (change: Partial<FieldSpec>): void => {
    const next: FieldSpec = { ...spec, ...change }
    for (const key of Object.keys(next) as Array<keyof FieldSpec>) {
      if (next[key] === undefined) delete next[key]
    }
    onEdit({ kind: 'set-field', shape: shape.name, key: field.key, field: next })
  }
  const number = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value))
  const xsd = projection.prefixes['xsd'] !== undefined ? 'xsd:' : 'http://www.w3.org/2001/XMLSchema#'

  return (
    <>
      <tr className={field.conflict ? 'conflict' : ''}>
        <td title={field.iri ?? 'resolves to nothing'}>
          {field.key}
          {field.inverse && <span className="hint"> (reverse)</span>}
        </td>
        <td>
          <select
            value={rangeValue(field.range)}
            onChange={(event) => set({ range: rangeFrom(event.target.value) })}
          >
            <option value="">any value</option>
            <optgroup label="nodes">
              <option value="iri">an IRI</option>
              <option value="node">an IRI or blank node</option>
              {projection.terms.map((t) => (
                <option key={t.id} value={`class:${t.key}`}>
                  a {t.key}
                </option>
              ))}
              {(projection.shapes ?? []).map((s) => (
                <option key={s.id} value={`shape:${s.name}`}>
                  shaped by {s.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="literals">
              <option value="literal">any literal</option>
              <option value="langString">a language-tagged string</option>
              {DATATYPES.map((d) => (
                <option key={d} value={`datatype:${xsd}${d}`}>
                  {xsd}
                  {d}
                </option>
              ))}
              {field.range?.kind === 'datatype' && !field.range.datatype.startsWith(xsd) && (
                <option value={`datatype:${field.range.datatype}`}>{field.range.datatype}</option>
              )}
            </optgroup>
          </select>
        </td>
        <td>
          <input
            type="number"
            min={0}
            defaultValue={field.min ?? ''}
            key={`min:${field.min ?? ''}`}
            onBlur={(event) => {
              if (number(event.target.value) !== field.min) set({ min: number(event.target.value) })
            }}
          />
        </td>
        <td>
          <input
            type="number"
            min={1}
            defaultValue={field.max ?? ''}
            key={`max:${field.max ?? ''}`}
            placeholder="*"
            onBlur={(event) => {
              if (number(event.target.value) !== field.max) set({ max: number(event.target.value) })
            }}
          />
        </td>
        <td className="coercion" title="How the term reads this key's values. It lives on the term, not the shape.">
          {field.coercion}
        </td>
        <td>
          <button
            type="button"
            title="Remove this field"
            onClick={() => onEdit({ kind: 'remove-field', shape: shape.name, key: field.key })}
          >
            ×
          </button>
        </td>
      </tr>
      <tr className="carried-by">
        <td colSpan={6}>
          {cardinality(field)} — carried by <code>shacl</code>, absent from <code>@context</code>
        </td>
      </tr>
      {field.conflict && (
        <tr className="conflict-row">
          <td colSpan={6}>
            <p className="warn">{field.conflict.message}</p>
            {field.promotion && (shape.targetTermId !== undefined || shape.targetIri !== null) && (
              <button
                type="button"
                onClick={() =>
                  onEdit({
                    kind: 'promote-term',
                    shape: shape.name,
                    key: field.key,
                    facets: field.promotion!,
                  })
                }
              >
                {classKey
                  ? `Give ${classKey} its own "${field.key}"`
                  : `Create a class term for ${shape.target ?? 'the target'} and give it its own "${field.key}"`}
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function specOf(field: ProjectedField): FieldSpec {
  const range = rangeSpec(field.range)
  return {
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(range !== undefined ? { range } : {}),
    ...(field.note !== undefined ? { note: field.note } : {}),
  }
}

function rangeSpec(range: IrRange | undefined): RangeSpec | undefined {
  if (range === undefined) return undefined
  switch (range.kind) {
    case 'datatype':
      return range.datatype
    case 'class':
      return { class: range.class }
    case 'shape':
      return { shape: range.shape }
    default:
      return range.kind
  }
}

function rangeValue(range: IrRange | undefined): string {
  if (range === undefined) return ''
  switch (range.kind) {
    case 'datatype':
      return `datatype:${range.datatype}`
    case 'class':
      return `class:${range.class}`
    case 'shape':
      return `shape:${range.shape}`
    default:
      return range.kind
  }
}

function rangeFrom(value: string): RangeSpec | undefined {
  if (value === '') return undefined
  if (value.startsWith('datatype:')) return value.slice('datatype:'.length)
  if (value.startsWith('class:')) return { class: value.slice('class:'.length) }
  if (value.startsWith('shape:')) return { shape: value.slice('shape:'.length) }
  return value
}

/**
 * Every question is asked in the rendered document. Asking here also buys what
 * a native prompt cannot: a field that can offer the prefixes the model already
 * declares.
 */
function AskInDocument({
  state,
  projection,
  onSubmit,
  onCancel,
}: {
  state: AskState
  projection: Projection
  onSubmit: (intent: Intent) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(
    state.kind === 'rename-term' || state.kind === 'delete-term' ? state.value : '',
  )
  const [second, setSecond] = useState('')

  // Two-part questions — a key and an IRI, a name and a class — are asked
  // together, with the model's own prefixes and classes offered.
  if (state.kind === 'add-shape' || state.kind === 'add-scoped-term' || state.kind === 'field-iri') {
    const prefixes = [projection.namespace.prefix, ...Object.keys(projection.prefixes)].filter(Boolean)
    const submitPair = (): void => {
      const first = value.trim()
      const other = second.trim()
      if (state.kind === 'add-shape') {
        if (first === '') return
        onSubmit({ kind: 'add-shape', name: first, ...(other ? { targetClass: other } : {}) })
      } else if (state.kind === 'add-scoped-term') {
        if (first === '') return
        onSubmit({ kind: 'add-scoped-term', parentId: state.parentId, key: first, ...(other ? { iri: other } : {}) })
      } else {
        const iri = first || `${projection.namespace.prefix}:${state.key}`
        onSubmit({ kind: 'add-field', shape: state.shape, key: state.key, field: state.field, createTerm: { iri } })
      }
    }
    const labels =
      state.kind === 'add-shape'
        ? ['Shape name', 'Target class (a term or an IRI; empty for a nested shape)']
        : state.kind === 'add-scoped-term'
          ? [`Scoped key under ${state.value}`, 'IRI']
          : [`"${state.key}" is not a term yet. Its IRI`]
    return (
      <div className="ask" role="dialog" aria-label={labels[0]}>
        <label>
          {labels[0]}
          <input
            autoFocus
            value={value}
            list={state.kind === 'field-iri' ? 'prefixes' : undefined}
            placeholder={state.kind === 'field-iri' ? `${projection.namespace.prefix}:${state.key}` : ''}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitPair()
              if (event.key === 'Escape') onCancel()
            }}
          />
        </label>
        {labels[1] && (
          <label>
            {labels[1]}
            <input
              value={second}
              list={state.kind === 'add-shape' ? 'class-terms-ask' : 'prefixes'}
              onChange={(event) => setSecond(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitPair()
                if (event.key === 'Escape') onCancel()
              }}
            />
          </label>
        )}
        <datalist id="prefixes">
          {prefixes.map((p) => (
            <option key={p} value={`${p}:`} />
          ))}
        </datalist>
        <datalist id="class-terms-ask">
          {projection.terms.map((t) => (
            <option key={t.id} value={t.key} />
          ))}
        </datalist>
        <button type="button" onClick={submitPair}>
          Add
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  }

  if (state.kind === 'delete-term') {
    return (
      <div className="ask" role="dialog" aria-label="Confirm">
        <p>
          Delete the term <strong>{state.value}</strong>? Every document that uses this key stops
          compacting the same way.
        </p>
        <button type="button" onClick={() => onSubmit({ kind: 'delete-term', id: state.id })}>
          Delete
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  }

  const submit = (): void => {
    if (value.trim() === '') return
    onSubmit(
      state.kind === 'create-term'
        ? { kind: 'create-term', key: value.trim() }
        : { kind: 'rename-term', id: state.id, key: value.trim() },
    )
  }

  return (
    <div className="ask" role="dialog" aria-label="Term name">
      <label>
        {state.kind === 'create-term' ? 'New term key' : 'New key for this term'}
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            if (event.key === 'Escape') onCancel()
          }}
        />
      </label>
      <button type="button" onClick={submit}>
        {state.kind === 'create-term' ? 'Add' : 'Rename'}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

function toFlowNodes(
  nodes: readonly { id: string; label: string; kind: string; iri: string | null; fields?: string[] }[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  selection: Selection,
): Node[] {
  return nodes.map((node) => ({
    id: node.id,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    selected: selection.termId === node.id || `shape:${selection.shapeId}` === node.id,
    // A shape is drawn as its class carrying its fields.
    data: { label: node.fields ? [node.label, ...node.fields].join('\n') : node.label },
    className: `graph-node ${node.kind}`,
  }))
}

function toFlowEdges(edges: readonly { id: string; source: string; target: string; label: string }[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  }))
}

const container = document.getElementById('root')
if (container) createRoot(container).render(<Canvas host={vscodeHost()} />)
