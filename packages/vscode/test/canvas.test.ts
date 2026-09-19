import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveModelText } from '@jsonld-modeler/core'

import { NodeHost } from '../src/host/node-host.js'
import { emptyLayout, layoutFileName } from '../src/host/adapter.js'
import { applyIntents, IntentError, splicesFor } from '../src/intents/intent.js'
import { project } from '../src/projection.js'
import { SCAFFOLD } from '../src/scaffold.js'
import { absenceOn, derivePanes, describeShape } from '../webview/src/panes.js'
import { directHost } from '../webview/src/host.js'
import { prune, withPosition } from '../webview/src/layout.js'

const MODEL = `jsonld: "1"

namespace:
  prefix: ex
  base: https://example.org/ns#

terms:
  # The display name.
  name:
    id: aaa111
    "@id": ex:name

  author:
    id: bbb222
    "@id": ex:author
    "@type": "@id"

  tags:
    id: ccc333
    "@id": ex:tag
    "@container": "@set"

  label:
    id: ddd444
    "@id": ex:label
    "@container": "@language"

  detail:
    id: eee555
    "@id": ex:detail
    "@context":
      name: https://example.org/ns#innerName

  meta:
    id: fff666
    "@id": ex:meta
    "@nest": detail

examples: []
`

function projectionOf(text: string) {
  const { ir } = resolveModelText(text, 'model.jsonld.yaml')
  return project(ir!)
}

describe('the projection', () => {
  // @lat: [[architecture#Architecture#Editing Surface#Intents]]
  it('carries every facet the metamodel can express', () => {
    const projection = projectionOf(MODEL)
    const term = (key: string) => projection.terms.find((t) => t.key === key)!

    expect(term('author').facets['@type']).toBe('@id')
    expect(term('tags').facets['@container']).toEqual(['@set'])
    expect(term('label').facets['@container']).toEqual(['@language'])
    expect(term('detail').facets['@context']).toEqual({
      name: 'https://example.org/ns#innerName',
    })
    expect(term('meta').facets['@nest']).toBe('detail')
  })

  it('carries a facet the canvas has no dedicated control for', () => {
    const withRaw = MODEL.replace(
      '  meta:\n    id: fff666\n    "@id": ex:meta\n    "@nest": detail\n',
      '  meta:\n    id: fff666\n    "@id": ex:meta\n    raw:\n      "@propagate": false\n',
    )
    const projection = projectionOf(withRaw)
    const meta = projection.terms.find((t) => t.key === 'meta')!
    expect(meta.raw).toEqual({ '@propagate': false })
  })

  it('projects a default view when the model declares none', () => {
    const projection = projectionOf(MODEL)
    expect(projection.views).toHaveLength(1)
    expect(projection.views[0]!.termIds).toHaveLength(projection.terms.length)
  })
})

describe('two coordinated panes', () => {
  // @lat: [[architecture#Architecture#Panes]]
  it('derives both from one projection', () => {
    const projection = projectionOf(MODEL)
    const panes = derivePanes(projection, projection.views[0]!.id)
    expect(panes.tree.length).toBeGreaterThan(0)
    expect(panes.graph.nodes).toHaveLength(projection.terms.length)
    // One selection key serves both panes.
    const treeIds = new Set(collectIds(panes.tree))
    for (const node of panes.graph.nodes) {
      if (node.id.startsWith('nest:')) continue
      expect(treeIds.has(node.id)).toBe(true)
    }
  })

  it('draws the JSON shape each container produces', () => {
    const projection = projectionOf(MODEL)
    const shapeOf = (key: string) =>
      describeShape(projection.terms.find((t) => t.key === key)!)
    expect(shapeOf('tags')).toContain('always an array')
    expect(shapeOf('label')).toContain('map from language tag')
    expect(shapeOf('author')).toContain('read as a reference')
  })

  it('draws a scoped context as a nested region', () => {
    const projection = projectionOf(MODEL)
    const panes = derivePanes(projection, projection.views[0]!.id)
    const detail = findNode(panes.tree, 'eee555')!
    expect(detail.region?.kind).toBe('scoped-context')
    expect(detail.region?.extent).toContain('below')
  })

  it('groups a @nest term under its nesting key', () => {
    const projection = projectionOf(MODEL)
    const panes = derivePanes(projection, projection.views[0]!.id)
    const group = panes.tree.find((n) => n.id === 'nest:detail')!
    expect(group.children.map((c) => c.id)).toEqual(['fff666'])
  })

  // @lat: [[architecture#Architecture#Panes#Selection]]
  it('renders a shape-only facet as visibly absent on the graph pane', () => {
    const projection = projectionOf(MODEL)
    const tags = projection.terms.find((t) => t.key === 'tags')!
    const message = absenceOn('graph', tags)
    expect(message).toBeDefined()
    expect(message).toContain('@container')
    expect(message).toContain('no triple')
    // And the tree pane has something to show for it, so it does not hold still.
    expect(absenceOn('tree', tags)).toBeUndefined()
  })

  it('shows a term coerced to @id as a reference and a plain one as a literal', () => {
    const projection = projectionOf(MODEL)
    const panes = derivePanes(projection, projection.views[0]!.id)
    const kind = (id: string) => panes.graph.nodes.find((n) => n.id === id)!.kind
    expect(kind('bbb222')).toBe('reference')
    expect(kind('aaa111')).toBe('literal')
  })

  it('a view scopes both panes to its subset', () => {
    const withView = `${MODEL}views:
  - { id: v11111, name: Names, terms: [name, author] }
`
    const projection = projectionOf(withView)
    const panes = derivePanes(projection, projection.views[0]!.id)
    expect(panes.graph.nodes.map((n) => n.id).sort()).toEqual(['aaa111', 'bbb222'])
    expect(collectIds(panes.tree).sort()).toEqual(['aaa111', 'bbb222'])
  })
})

describe('intents become targeted splices', () => {
  // @lat: [[architecture#Architecture#Editing Surface#Targeted edits]]
  it('renaming preserves every comment and changes only the key', () => {
    const after = applyIntents(MODEL, [{ kind: 'rename-term', id: 'aaa111', key: 'label2' }])
    expect(after).toContain('# The display name.')
    expect(after).toBe(MODEL.replace('  name:\n    id: aaa111', '  label2:\n    id: aaa111'))

    // The id is unchanged, so this is a rename rather than a removal and an add.
    const before = resolveModelText(MODEL, 'm.yaml').ir!
    const now = resolveModelText(after, 'm.yaml').ir!
    expect(now.terms.map((t) => t.id).sort()).toEqual(before.terms.map((t) => t.id).sort())
    expect(now.terms.find((t) => t.id === 'aaa111')!.key).toBe('label2')
  })

  it('creating a term appends it without touching the rest', () => {
    const after = applyIntents(MODEL, [{ kind: 'create-term', key: 'summary' }])
    expect(after).toContain('# The display name.')
    expect(after).toContain('  summary:')
    expect(after).toMatch(/summary:\n {4}id: [a-z0-9]{6}\n {4}"@id": ex:summary/)
    const { findings } = resolveModelText(after, 'm.yaml')
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
  })

  it('retyping a term sets a facet in place', () => {
    const after = applyIntents(MODEL, [
      { kind: 'retype-term', id: 'aaa111', facet: '@type', value: '@id' },
    ])
    const { ir } = resolveModelText(after, 'm.yaml')
    expect(ir!.terms.find((t) => t.id === 'aaa111')!['@type']).toBe('@id')
    expect(after).toContain('# The display name.')
  })

  it('unsetting a facet removes its line and nothing else', () => {
    const after = applyIntents(MODEL, [
      { kind: 'retype-term', id: 'bbb222', facet: '@type', value: undefined },
    ])
    const { ir } = resolveModelText(after, 'm.yaml')
    expect(ir!.terms.find((t) => t.id === 'bbb222')!['@type']).toBeUndefined()
    expect(after).toContain('"@id": ex:author')
  })

  it('deleting a term removes its block and leaves the neighbours intact', () => {
    const after = applyIntents(MODEL, [{ kind: 'delete-term', id: 'bbb222' }])
    const { ir } = resolveModelText(after, 'm.yaml')
    expect(ir!.terms.map((t) => t.key)).not.toContain('author')
    expect(after).toContain('# The display name.')
    expect(after).toContain('  tags:')
    expect(after).not.toContain('ex:author')
  })

  // @lat: [[architecture#Architecture#Editing Surface#Intents]]
  it('two intents from one gesture are applied in order against current offsets', () => {
    const after = applyIntents(MODEL, [
      { kind: 'create-term', key: 'summary' },
      { kind: 'retype-term', id: idOf(MODEL, 'name'), facet: '@language', value: 'en' },
    ])
    const { ir, findings } = resolveModelText(after, 'm.yaml')
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(ir!.terms.map((t) => t.key)).toContain('summary')
    expect(ir!.terms.find((t) => t.key === 'name')!['@language']).toBe('en')
  })

  it('refuses an intent that would produce a duplicate key', () => {
    expect(() => splicesFor(MODEL, { kind: 'create-term', key: 'name' })).toThrow(IntentError)
    expect(() =>
      splicesFor(MODEL, { kind: 'rename-term', id: 'aaa111', key: 'author' }),
    ).toThrow(IntentError)
  })

  it('refuses an intent naming an id no term carries', () => {
    expect(() => splicesFor(MODEL, { kind: 'delete-term', id: 'zzzzzz' })).toThrow(
      /no term carries/,
    )
  })
})

describe('the host adapter', () => {
  // @lat: [[architecture#Architecture#Host Adapter]]
  it('drives every canvas action with no editor present', async () => {
    const host = new NodeHost({ text: MODEL })
    const initial = await host.readModel()
    expect(initial.terms).toHaveLength(6)

    await host.applyIntent({ kind: 'create-term', key: 'summary' })
    const renamed = await host.applyIntent({
      kind: 'rename-term',
      id: 'aaa111',
      key: 'displayName',
    })
    expect(renamed.terms.map((t) => t.key)).toContain('summary')
    expect(renamed.terms.find((t) => t.id === 'aaa111')!.key).toBe('displayName')
    expect(renamed.revision).toBe(2)
  })

  it('produces the same model edits as applying the intents directly', async () => {
    const intents = [
      { kind: 'create-term' as const, key: 'summary' },
      { kind: 'retype-term' as const, id: 'aaa111', facet: '@language', value: 'en' },
    ]
    const host = new NodeHost({ text: MODEL })
    for (const intent of intents) await host.applyIntent(intent)

    // Ids are minted, so the two runs differ only where an id was generated.
    const direct = applyIntents(MODEL, intents)
    expect(withoutGeneratedIds(host.text)).toBe(withoutGeneratedIds(direct))
  })

  it('serialises intents so one does not splice against the other’s offsets', async () => {
    const host = new NodeHost({ text: MODEL })
    // Both posted without awaiting, as one gesture would.
    const first = host.applyIntent({ kind: 'create-term', key: 'alpha' })
    const second = host.applyIntent({ kind: 'create-term', key: 'beta' })
    await Promise.all([first, second])

    const { ir, findings } = resolveModelText(host.text, 'm.yaml')
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(ir!.terms.map((t) => t.key)).toContain('alpha')
    expect(ir!.terms.map((t) => t.key)).toContain('beta')
  })

  it('a failed intent does not wedge the host', async () => {
    const host = new NodeHost({ text: MODEL })
    await expect(host.applyIntent({ kind: 'create-term', key: 'name' })).rejects.toThrow()
    const after = await host.applyIntent({ kind: 'create-term', key: 'fresh' })
    expect(after.terms.map((t) => t.key)).toContain('fresh')
  })

  it('keeps the last valid diagram when the file becomes unparseable', async () => {
    const host = new NodeHost({ text: MODEL })
    const valid = await host.readModel()
    // A tab where YAML requires spaces: the parser cannot recover.
    host.text = MODEL.replace('  author:', '\t author:')
    const invalid = await host.readModel()
    expect(invalid.valid).toBe(false)
    expect(invalid.invalidReason).toBeTruthy()
    // The canvas does not go blank.
    expect(invalid.terms).toEqual(valid.terms)
  })

  it('reports findings to whatever shows diagnostics', async () => {
    const host = new NodeHost({ text: MODEL.replace('"@id": ex:name', '"@id": nope:name') })
    await host.readModel()
    expect(host.reported.some((f) => f.ruleId === 'L1.unknown-prefix')).toBe(true)
  })

  it('reveals a pointer through the host rather than reaching for an editor', async () => {
    const revealed: string[] = []
    const host = new NodeHost({ text: MODEL, onReveal: (p) => revealed.push(p) })
    await host.reveal('/terms/name')
    expect(revealed).toEqual(['/terms/name'])
  })

  it('drives the webview host seam without messaging', async () => {
    const node = new NodeHost({ text: MODEL })
    const seen: number[] = []
    const host = directHost(node)
    host.onProjection((projection) => seen.push(projection.terms.length))
    host.ready()
    await Promise.resolve()
    host.postIntent({ kind: 'create-term', key: 'summary' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([6, 7])
  })
})

describe('layout', () => {
  // @lat: [[architecture#Architecture#Layout]]
  it('is keyed by element id, so a rename does not move a box', async () => {
    const host = new NodeHost({ text: MODEL })
    await host.writeLayout('all', withPosition(emptyLayout(), 'aaa111', { x: 120, y: 40 }))
    await host.applyIntent({ kind: 'rename-term', id: 'aaa111', key: 'displayName' })
    const layout = await host.readLayout('all')
    expect(layout.graph['aaa111']).toEqual({ x: 120, y: 40 })
  })

  it('moving a box leaves the model file unchanged', async () => {
    const host = new NodeHost({ text: MODEL })
    const before = host.text
    await host.writeLayout('all', withPosition(emptyLayout(), 'aaa111', { x: 9, y: 9 }))
    expect(host.text).toBe(before)
  })

  it('survives a reopen, and is nested per view', async () => {
    const host = new NodeHost({ text: MODEL })
    await host.writeLayout('overview', withPosition(emptyLayout(), 'aaa111', { x: 1, y: 2 }))
    await host.writeLayout('detail', withPosition(emptyLayout(), 'aaa111', { x: 3, y: 4 }))

    const reopened = new NodeHost({ text: MODEL, layout: host.layoutDocument() })
    expect((await reopened.readLayout('overview')).graph['aaa111']).toEqual({ x: 1, y: 2 })
    expect((await reopened.readLayout('detail')).graph['aaa111']).toEqual({ x: 3, y: 4 })
  })

  it('drops positions for elements the model no longer has', () => {
    const sidecar = withPosition(
      withPosition(emptyLayout(), 'aaa111', { x: 1, y: 1 }),
      'gone99',
      { x: 2, y: 2 },
    )
    expect(prune(sidecar, new Set(['aaa111'])).graph).toEqual({ aaa111: { x: 1, y: 1 } })
  })

  it('names the sidecar beside the model', () => {
    expect(layoutFileName('vocabulary.jsonld.yaml')).toBe('vocabulary.layout.json')
  })
})

describe('the webview asks in the document', () => {
  /**
   * A VS Code webview is a sandboxed iframe in which these three return
   * immediately without showing anything, so an action routed through one does
   * nothing at all — and does it silently.
   *
   * @lat: [[architecture#Architecture#Editing Surface#Asking]]
   */
  it('no webview source calls window.prompt, confirm or alert', () => {
    const root = fileURLToPath(new URL('../webview/src', import.meta.url))
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8')
      if (/\b(?:window\s*\.\s*)?(?:prompt|confirm|alert)\s*\(/.test(stripComments(text))) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the guard catches a deliberate call', () => {
    expect(/\b(?:window\s*\.\s*)?(?:prompt|confirm|alert)\s*\(/.test('window.confirm("x")')).toBe(
      true,
    )
    expect(/\b(?:window\s*\.\s*)?(?:prompt|confirm|alert)\s*\(/.test('const ok = confirm(x)')).toBe(
      true,
    )
    // A mention in prose is not a call, and comments are stripped before the
    // scan runs — otherwise this very file would trip its own guard.
    expect(/\b(?:window\s*\.\s*)?(?:prompt|confirm|alert)\s*\(/.test('// mentions confirm')).toBe(
      false,
    )
  })
})

describe('the scaffold', () => {
  // @lat: [[metamodel#Metamodel#Stable Element IDs]]
  it('is byte-identical to the template core publishes', () => {
    const template = readFileSync(
      fileURLToPath(new URL('../../core/templates/scaffold.jsonld.yaml', import.meta.url)),
      'utf8',
    )
    expect(SCAFFOLD).toBe(template)
  })

  it('resolves with every id written, and emits', async () => {
    const { ir, findings } = resolveModelText(SCAFFOLD, 'new.jsonld.yaml')
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(ir!.terms.every((t) => t.idWritten)).toBe(true)

    const { emit } = await import('@jsonld-modeler/core')
    const { SourceIndex } = await import('@jsonld-modeler/core')
    const result = emit(ir!, {
      target: 'context',
      source: SourceIndex.parse(SCAFFOLD, { path: 'new.jsonld.yaml' }),
    })
    expect(result.findings.filter((f) => f.severity === 'error')).toEqual([])
    // The artifact keeps the compact form the model wrote, and defines the
    // prefix that makes it resolve.
    const context = result.document['@context'] as Record<string, unknown>
    expect(context['name']).toBe('ex:name')
    expect(context['ex']).toBe('https://example.org/ns#')
    expect(ir!.terms.find((t) => t.key === 'name')!.iri).toBe('https://example.org/ns#name')
  })
})

function collectIds(nodes: readonly { id: string; children: readonly { id: string }[] }[]): string[] {
  const out: string[] = []
  const walk = (list: readonly { id: string; children?: readonly unknown[] }[]): void => {
    for (const node of list) {
      if (!node.id.startsWith('nest:')) out.push(node.id)
      walk((node.children ?? []) as readonly { id: string; children?: readonly unknown[] }[])
    }
  }
  walk(nodes as never)
  return out
}

function findNode(
  nodes: readonly { id: string; children: readonly unknown[] }[],
  id: string,
): { id: string; region?: { kind: string; extent: string } } | undefined {
  for (const node of nodes) {
    if (node.id === id) return node as never
    const found = findNode(node.children as never, id)
    if (found) return found
  }
  return undefined
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function idOf(text: string, key: string): string {
  const { ir } = resolveModelText(text, 'm.yaml')
  return ir!.terms.find((t) => t.key === key)!.id
}

function withoutGeneratedIds(text: string): string {
  return text.replace(/^\s*id: [a-z0-9]{6}$/gm, '    id: <generated>')
}
