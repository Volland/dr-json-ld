import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { readdirSync, readFileSync, statSync } from 'node:fs'

import {
  AliasStore,
  createVersionFromModel,
  loadProject,
  PROJECT_FILE,
  VersionStore,
} from '@json-ld-modeler/core'

import { NodeHost } from '../src/host/node-host.js'
import { releaseStateFor } from '../src/release-state.js'
import { directHost } from '../webview/src/host.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const CREATED = '2026-01-01T00:00:00Z'

const MODEL = `jsonld: "1"
project: suite
namespace:
  prefix: ex
  base: https://example.org/ns#
terms:
  name:
    id: aaa111
    "@id": ex:name
examples: []
`

const OTHER = MODEL.replace('prefix: ex', 'prefix: ot').replace(
  'base: https://example.org/ns#',
  'base: https://example.org/other#',
).replace('"@id": ex:name', '"@id": ot:name')

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'ldm-release-'))
  dirs.push(root)
  const files: Record<string, string> = {
    [PROJECT_FILE]: `project: "1"\nname: suite\nmodels:\n  catalogue: catalogue.jsonld.yaml\n  people: people.jsonld.yaml\n`,
    'catalogue.jsonld.yaml': MODEL,
    'people.jsonld.yaml': OTHER,
  }
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function versionCatalogue(root: string): string {
  const { project } = loadProject(join(root, PROJECT_FILE))
  return createVersionFromModel(
    new VersionStore(project!.versionsDir),
    join(root, 'catalogue.jsonld.yaml'),
    { created: CREATED, project: 'suite', modelName: 'catalogue' },
  ).id
}

describe('release state', () => {
  // @lat: [[architecture#Architecture#Host Adapter]]
  it('lists the project’s models, marking the active one', () => {
    const root = workspace()
    const release = releaseStateFor({ modelPath: join(root, 'catalogue.jsonld.yaml') })!

    expect(release.projectName).toBe('suite')
    expect(release.siblingModels.map((m) => m.name).sort()).toEqual(['catalogue', 'people'])
    expect(release.siblingModels.find((m) => m.active)?.name).toBe('catalogue')
  })

  it('is absent outside a project', () => {
    const root = mkdtempSync(join(tmpdir(), 'ldm-noproject-'))
    dirs.push(root)
    writeFileSync(join(root, 'm.jsonld.yaml'), MODEL.replace('project: suite\n', ''))
    expect(releaseStateFor({ modelPath: join(root, 'm.jsonld.yaml') })).toBeUndefined()
  })

  it('lists only this model’s versions, newest first', () => {
    const root = workspace()
    const id = versionCatalogue(root)

    const release = releaseStateFor({ modelPath: join(root, 'catalogue.jsonld.yaml') })!
    expect(release.versions.map((v) => v.id)).toEqual([id])
    expect(release.versions[0]!.verified).toBe(true)

    // The sibling has none of its own.
    const sibling = releaseStateFor({ modelPath: join(root, 'people.jsonld.yaml') })!
    expect(sibling.versions).toEqual([])
  })

  it('lists aliases pointing at this model’s versions', () => {
    const root = workspace()
    const id = versionCatalogue(root)
    const { project } = loadProject(join(root, PROJECT_FILE))
    new AliasStore(project!.versionsDir).set('stable', id, new VersionStore(project!.versionsDir))

    const release = releaseStateFor({ modelPath: join(root, 'catalogue.jsonld.yaml') })!
    expect(release.aliases).toEqual([{ name: 'stable', versionId: id }])
  })

  it('marks a version that does not verify, rather than hiding it', () => {
    const root = workspace()
    const id = versionCatalogue(root)
    const { project } = loadProject(join(root, PROJECT_FILE))
    writeFileSync(join(project!.versionsDir, id, 'model.jsonld.yaml'), 'tampered')

    const release = releaseStateFor({ modelPath: join(root, 'catalogue.jsonld.yaml') })!
    expect(release.versions).toHaveLength(1)
    expect(release.versions[0]!.verified).toBe(false)
  })
})

describe('the canvas is project-aware', () => {
  it('the projection carries the release state when there is a project', async () => {
    const root = workspace()
    const id = versionCatalogue(root)
    const host = new NodeHost({
      text: readFileSync(join(root, 'catalogue.jsonld.yaml'), 'utf8'),
      path: 'catalogue.jsonld.yaml',
      root,
    })
    const projection = await host.readModel()

    expect(projection.release?.projectName).toBe('suite')
    expect(projection.release?.versions.map((v) => v.id)).toEqual([id])
    expect(projection.release?.siblingModels).toHaveLength(2)
  })

  it('the projection carries none outside a project', async () => {
    const host = new NodeHost({ text: MODEL.replace('project: suite\n', '') })
    expect((await host.readModel()).release).toBeUndefined()
  })

  /**
   * Versions are immutable and retargeting an alias is deliberate, so the canvas
   * shows both and changes neither.
   */
  it('offers no intent that would change a version or an alias', async () => {
    const root = workspace()
    versionCatalogue(root)
    const host = new NodeHost({
      text: readFileSync(join(root, 'catalogue.jsonld.yaml'), 'utf8'),
      path: 'catalogue.jsonld.yaml',
      root,
    })
    const before = await host.readModel()

    // Every intent the webview may post concerns terms only.
    await host.applyIntent({ kind: 'create-term', key: 'summary' })
    const after = await host.readModel()
    expect(after.release?.versions).toEqual(before.release?.versions)
    expect(after.release?.aliases).toEqual(before.release?.aliases)
  })

  it('opens a sibling through the host rather than re-pointing the canvas', async () => {
    const opened: string[] = []
    const host = directHost({
      readModel: async () => ({}) as never,
      applyIntent: async () => ({}) as never,
      writeLayout: async () => undefined,
      reveal: async () => undefined,
      openModel: async (path: string) => {
        opened.push(path)
      },
    })
    host.openModel('/somewhere/people.jsonld.yaml')
    await Promise.resolve()
    expect(opened).toEqual(['/somewhere/people.jsonld.yaml'])
  })
})

describe('the package boundary holds', () => {
  // @lat: [[architecture#Architecture#Package Boundary]]
  it('no core source imports vscode, transitively or otherwise', () => {
    const coreSrc = join(
      dirname(new URL(import.meta.url).pathname),
      '..',
      '..',
      'core',
      'src',
    )
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (entry.endsWith('.ts')) {
          const text = readFileSync(full, 'utf8')
          if (/(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])vscode(?:\/[^'"]*)?\1/.test(text)) {
            offenders.push(full)
          }
        }
      }
    }
    walk(coreSrc)
    expect(offenders).toEqual([])
  })
})
