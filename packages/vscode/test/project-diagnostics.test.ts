/**
 * The project file is the second canonical file kind. Until this change the
 * editor said nothing about it: `ldm check` reported every `L0.project-*` rule
 * and the Problems panel stayed empty, so the only way to learn a project file
 * was wrong was to run a command.
 *
 * @lat: [[architecture#Architecture#Projects#Checked like a model]]
 * @lat: [[validation#Validation#Findings]]
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { PROJECT_FILE } from '@json-ld-modeler/core'

import { isProjectFile, publishProjectDiagnostics } from '../src/extension.js'
import { DiagnosticCollection, textDocument } from './vscode-stub.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ldm-diag-'))
  dirs.push(root)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

/** Publish `text` as the project file at `root` and read the diagnostics back. */
function publish(root: string, text: string) {
  const collection = new DiagnosticCollection()
  const path = join(root, PROJECT_FILE)
  const document = textDocument(path, text)
   
  publishProjectDiagnostics(collection as any, document as any)
  return collection.published.get(path) ?? []
}

describe('the project file reports findings in the editor', () => {
  // @lat: [[architecture#Architecture#Projects#Checked like a model]]
  it('reports a declared model whose file does not exist', () => {
    const root = workspace({})
    const diagnostics = publish(
      root,
      'project: "1"\nname: catalogue\nmodels:\n  gone: models/gone.jsonld.yaml\n',
    )

    const missing = diagnostics.find((d) => d.code === 'L0.project-model-missing')
    expect(
      missing,
      `expected L0.project-model-missing, got ${diagnostics.map((d) => d.code).join(', ') || 'nothing'}`,
    ).toBeDefined()
    expect(missing!.source).toBe('jsonld-modeler')
    // The entry, not the root: the underline belongs on the line the author wrote.
    expect(missing!.range.start.line).toBe(3)
  })

  it('reports nothing for a project file that is well formed', () => {
    const root = workspace({ 'models/core.jsonld.yaml': 'jsonld: "1"\n' })
    const diagnostics = publish(
      root,
      'project: "1"\nname: catalogue\nmodels:\n  core: models/core.jsonld.yaml\n',
    )
    expect(diagnostics.map((d) => `${d.code}`)).toEqual([])
  })

  it('carries the rule id as the diagnostic code, for every finding it reports', () => {
    const root = workspace({})
    const diagnostics = publish(root, 'project: "1"\nname: "my project"\nmodels: {}\n')
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const d of diagnostics) expect(`${d.code}`).toMatch(/^L[0-4]\./)
  })

  it('recognises the project file and nothing else', () => {
     
    const is = (p: string): boolean => isProjectFile(textDocument(p, '') as any)
    expect(is(`/w/${PROJECT_FILE}`)).toBe(true)
    expect(is('/w/vocabulary.jsonld.yaml')).toBe(false)
    expect(is('/w/other.yaml')).toBe(false)
  })
})
