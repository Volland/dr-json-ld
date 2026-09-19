import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Every schema this project publishes, and the file pattern it governs. */
const SCHEMAS: Array<{ file: string; fileMatch: string }> = [
  { file: 'model.schema.json', fileMatch: '*.jsonld.yaml' },
  { file: 'project.schema.json', fileMatch: 'ldm.project.yaml' },
]

function corePath(file: string): string {
  return fileURLToPath(new URL(`../schema/${file}`, import.meta.url))
}

function vscodePath(file: string): string {
  return fileURLToPath(new URL(`../../vscode/schema/${file}`, import.meta.url))
}

describe('published JSON Schema', () => {
  // @lat: [[architecture#Architecture#Surface Syntax]]
  it.each(SCHEMAS)('$file is byte-identical in core and in the extension', ({ file }) => {
    const core = readFileSync(corePath(file))
    const ext = readFileSync(vscodePath(file))
    expect(ext.equals(core)).toBe(true)
  })

  it.each(SCHEMAS)('$file is contributed for $fileMatch', ({ file, fileMatch }) => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../vscode/package.json', import.meta.url)), 'utf8'),
    )
    for (const key of ['jsonValidation', 'yamlValidation'] as const) {
      const entries: Array<{ fileMatch: string; url: string }> = manifest.contributes[key]
      expect(entries, key).toContainEqual({ fileMatch, url: `./schema/${file}` })
    }
  })

  it('the extension ships no schema core does not publish', () => {
    const shipped = readdirSync(fileURLToPath(new URL('../../vscode/schema/', import.meta.url)))
    expect(shipped.sort()).toEqual(SCHEMAS.map((s) => s.file).sort())
  })
})
