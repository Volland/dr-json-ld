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

  /**
   * A contribution point is only worth declaring if something installed reads it
   * for the file pattern it names. `jsonValidation` is read by the editor's own
   * JSON language service, which never sees a YAML file, so contributing a
   * `*.yaml` pattern through it looks like support and delivers none — which is
   * exactly the state this table replaced.
   *
   * @lat: [[architecture#Architecture#Surface Syntax#Reaching the editor]]
   */
  const CONTRIBUTION_POINTS: Array<{
    point: string
    readBy: string
    appliesTo: (fileMatch: string) => boolean
  }> = [
    {
      point: 'yamlValidation',
      readBy: 'redhat.vscode-yaml',
      appliesTo: (fileMatch) => fileMatch.endsWith('.yaml') || fileMatch.endsWith('.yml'),
    },
    {
      point: 'jsonValidation',
      readBy: "the editor's built-in JSON language service",
      appliesTo: (fileMatch) => fileMatch.endsWith('.json'),
    },
  ]

  const manifest = (): {
    extensionDependencies?: string[]
    contributes: Record<string, Array<{ fileMatch: string; url: string }> | unknown>
  } =>
    JSON.parse(
      readFileSync(fileURLToPath(new URL('../../vscode/package.json', import.meta.url)), 'utf8'),
    )

  /** The point that actually delivers a schema for a given file pattern. */
  function deliveringPoint(fileMatch: string): { point: string; readBy: string } {
    const found = CONTRIBUTION_POINTS.find((p) => p.appliesTo(fileMatch))
    if (!found) throw new Error(`no contribution point can apply to ${fileMatch}`)
    return found
  }

  // @lat: [[architecture#Architecture#Surface Syntax#Reaching the editor]]
  it.each(SCHEMAS)('$file is contributed for $fileMatch', ({ file, fileMatch }) => {
    const { point } = deliveringPoint(fileMatch)
    const entries = manifest().contributes[point] as
      | Array<{ fileMatch: string; url: string }>
      | undefined
    expect(entries, `contributes.${point} is missing`).toBeDefined()
    expect(entries, point).toContainEqual({ fileMatch, url: `./schema/${file}` })
  })

  /**
   * The inverse, and the one that would have caught the original defect: an
   * entry declared through a point that cannot apply to the pattern it names.
   */
  it('no schema is contributed through a point that cannot apply to its pattern', () => {
    const contributes = manifest().contributes
    const wrong: string[] = []
    for (const { point, readBy, appliesTo } of CONTRIBUTION_POINTS) {
      const entries = contributes[point] as Array<{ fileMatch: string }> | undefined
      for (const entry of entries ?? []) {
        if (!appliesTo(entry.fileMatch)) {
          wrong.push(
            `contributes.${point} declares "${entry.fileMatch}", but ${point} is read by ${readBy}, which never sees that file`,
          )
        }
      }
    }
    expect(wrong).toEqual([])
  })

  // @lat: [[architecture#Architecture#Surface Syntax#Reaching the editor]]
  it.each(SCHEMAS)('$file reaches the editor through a declared dependency', ({ fileMatch }) => {
    const { readBy } = deliveringPoint(fileMatch)
    const declared = manifest().extensionDependencies ?? []
    expect(
      declared,
      `${readBy} executes the schema for ${fileMatch}, so it must be an extension dependency`,
    ).toContain(readBy)
  })

  it('the extension ships no schema core does not publish', () => {
    const shipped = readdirSync(fileURLToPath(new URL('../../vscode/schema/', import.meta.url)))
    expect(shipped.sort()).toEqual(SCHEMAS.map((s) => s.file).sort())
  })
})
