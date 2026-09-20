import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Every schema this project publishes: the file pattern it governs, and where
 * on the site it is served. The served path is what the `$id` must say, because
 * a schema whose identifier is not the URL it answers at is a schema nobody
 * else can use — which is the state this arrangement replaced.
 */
const SCHEMAS: Array<{ file: string; fileMatch: string; published: string }> = [
  { file: 'model.schema.json', fileMatch: '*.jsonld.yaml', published: 'model/1' },
  { file: 'project.schema.json', fileMatch: 'ldm.project.yaml', published: 'project/1' },
]

/** Where the site is served from. The `$id`s are absolute, so this is needed. */
const SITE = 'https://volland.github.io/dr-json-ld'

function corePath(file: string): string {
  return fileURLToPath(new URL(`../schema/${file}`, import.meta.url))
}

function vscodePath(file: string): string {
  return fileURLToPath(new URL(`../../vscode/schema/${file}`, import.meta.url))
}

function sitePath(file: string, published: string): string {
  return fileURLToPath(new URL(`../../../site/schemas/${published}/${file}`, import.meta.url))
}

describe('published JSON Schema', () => {
  /**
   * Three copies now, not two: the library, the extension, and the tree the
   * documentation site deploys. A schema edited in one and not the others is
   * how an editor and a command come to disagree about what a model may say,
   * and the site copy adds a third way to be wrong that nothing else notices —
   * a stale served file 404s nobody and simply validates the wrong thing.
   *
   * @lat: [[architecture#Architecture#Surface Syntax]]
   */
  it.each(SCHEMAS)('$file is byte-identical in all three copies', ({ file, published }) => {
    const core = readFileSync(corePath(file))
    const disagreed: string[] = []
    if (!readFileSync(vscodePath(file)).equals(core)) disagreed.push(vscodePath(file))
    if (!readFileSync(sitePath(file, published)).equals(core)) {
      disagreed.push(sitePath(file, published))
    }
    expect(disagreed, `these copies differ from ${corePath(file)}`).toEqual([])
  })

  // @lat: [[architecture#Architecture#Distribution#Documentation site]]
  it.each(SCHEMAS)('$file is served at the URL its $id names', ({ file, published }) => {
    const schema = JSON.parse(readFileSync(corePath(file), 'utf8')) as { $id?: string }
    expect(schema.$id).toBe(`${SITE}/schemas/${published}/${file}`)
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
