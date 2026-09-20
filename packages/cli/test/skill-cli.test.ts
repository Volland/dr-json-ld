/**
 * `ldm skill list` and `ldm skill install`.
 *
 * The scenarios in `specs/authoring-skills/spec.md`, driven through an injected
 * `Io` so nothing is spawned and nothing is written outside a temp directory.
 * The `--user` cases point `homedir` at that directory too, because a test that
 * wrote into the real home directory would be a test nobody could run twice.
 *
 * @lat: [[architecture#Architecture#Authoring Skills]]
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { EXIT_OK, EXIT_USAGE, run, type Io } from '../src/index.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function workspace(): { root: string; io: Io; out: string[]; err: string[]; written: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'ldm-skill-'))
  dirs.push(root)
  const out: string[] = []
  const err: string[] = []
  const written: string[] = []
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, content) => {
      written.push(p)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content)
    },
    exists: (p) => existsSync(p),
    cwd: () => root,
    // The point of the seam: `--user` is exercised for real without writing
    // into the home directory of whoever is running the suite.
    home: () => root,
  }
  return { root, io, out, err, written }
}

describe('ldm skill list', () => {
  // @lat: [[architecture#Architecture#Authoring Skills]]
  it('prints every skill with a summary', async () => {
    const { io, out } = workspace()
    expect(await run(['skill', 'list'], io)).toBe(EXIT_OK)
    const text = out.join('\n')
    for (const name of ['jsonld-design', 'jsonld-model-yaml', 'jsonld-findings', 'jsonld-publish']) {
      expect(text).toContain(name)
    }
    expect(text).toMatch(/guidance, never a verdict/)
  })

  it('is the same with and without a project enclosing the directory', async () => {
    const bare = workspace()
    expect(await run(['skill', 'list'], bare.io)).toBe(EXIT_OK)

    const withProject = workspace()
    writeFileSync(
      join(withProject.root, 'ldm.project.yaml'),
      'project: "1"\nname: demo\nmodels:\n  - name: a\n    path: a.jsonld.yaml\n',
    )
    expect(await run(['skill', 'list'], withProject.io)).toBe(EXIT_OK)

    expect(withProject.out).toEqual(bare.out)
  })

  it('bare `ldm skill` lists, and an unknown verb is a usage error', async () => {
    const { io, out } = workspace()
    expect(await run(['skill'], io)).toBe(EXIT_OK)
    expect(out.join('\n')).toContain('jsonld-design')

    const other = workspace()
    expect(await run(['skill', 'uninstall'], other.io)).toBe(EXIT_USAGE)
    expect(other.err.join('\n')).toContain('not a skill verb')
  })
})

describe('ldm skill install', () => {
  it('refuses without a target and writes nothing', async () => {
    const { io, err, written } = workspace()
    expect(await run(['skill', 'install'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--project')
    expect(err.join('\n')).toContain('--user')
    expect(written).toEqual([])
  })

  it('refuses both targets at once', async () => {
    const { io, err, written } = workspace()
    expect(await run(['skill', 'install', '--project', '--user'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('not both')
    expect(written).toEqual([])
  })

  it('writes into the project and prints every path', async () => {
    const { io, root, out } = workspace()
    expect(await run(['skill', 'install', '--project'], io)).toBe(EXIT_OK)
    expect(existsSync(join(root, '.claude/skills/jsonld-design/SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(root, '.github/chatmodes/jsonld-design.chatmode.md'))).toBe(true)
    expect(out.join('\n')).toContain('.claude/skills/jsonld-design/SKILL.md')
  })

  it('writes beneath the home directory for --user', async () => {
    const { io, root } = workspace()
    expect(await run(['skill', 'install', '--user', '--format', 'agent-skill'], io)).toBe(EXIT_OK)
    expect(existsSync(join(root, '.claude/skills/jsonld-publish/SKILL.md'))).toBe(true)
  })

  it('installs only the skills named', async () => {
    const { io, root } = workspace()
    expect(
      await run(['skill', 'install', '--project', 'jsonld-design', '--format', 'agent-skill'], io),
    ).toBe(EXIT_OK)
    expect(existsSync(join(root, '.claude/skills/jsonld-design/SKILL.md'))).toBe(true)
    expect(existsSync(join(root, '.claude/skills/jsonld-publish/SKILL.md'))).toBe(false)
  })

  /**
   * `--project` takes a value elsewhere in this CLI, so the shared parser
   * attaches the following word to the flag. Installing everything would be the
   * wrong recovery — this asserts the name is taken back instead.
   */
  it('recovers a skill name the --project flag swallowed', async () => {
    const { io, root } = workspace()
    expect(await run(['skill', 'install', '--project', 'jsonld-design'], io)).toBe(EXIT_OK)
    expect(existsSync(join(root, '.claude/skills/jsonld-design/SKILL.md'))).toBe(true)
    expect(existsSync(join(root, '.claude/skills/jsonld-publish/SKILL.md'))).toBe(false)
  })

  it('refuses an unknown skill name and lists the known ones', async () => {
    const { io, err, written } = workspace()
    expect(await run(['skill', 'install', '--user', 'jsonld-nonsense'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('jsonld-design')
    expect(written).toEqual([])
  })

  it('refuses an unknown format and writes nothing', async () => {
    const { io, err, written } = workspace()
    expect(await run(['skill', 'install', '--project', '--format', 'cursorrules'], io)).toBe(
      EXIT_USAGE,
    )
    expect(err.join('\n')).toContain('not a format')
    expect(written).toEqual([])
  })

  it('writes only the format asked for', async () => {
    const { io, root } = workspace()
    expect(await run(['skill', 'install', '--project', '--format', 'agents'], io)).toBe(EXIT_OK)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(root, '.claude/skills/jsonld-design/SKILL.md'))).toBe(false)
    expect(existsSync(join(root, '.github/chatmodes'))).toBe(false)
  })

  it('reports an unchanged skill as current and rewrites nothing', async () => {
    const first = workspace()
    await run(['skill', 'install', '--project', '--format', 'agent-skill'], first.io)

    const again: string[] = []
    const io: Io = { ...first.io, out: (line) => again.push(line) }
    const before = first.written.length
    expect(await run(['skill', 'install', '--project', '--format', 'agent-skill'], io)).toBe(EXIT_OK)
    expect(again.join('\n')).toContain('current')
    expect(first.written.length).toBe(before)
  })

  it('never overwrites a skill the user edited', async () => {
    const { io, root, out } = workspace()
    await run(['skill', 'install', '--project', '--format', 'agent-skill'], io)

    const path = join(root, '.claude/skills/jsonld-design/SKILL.md')
    writeFileSync(path, 'my own notes\n')
    out.length = 0

    expect(await run(['skill', 'install', '--project', '--format', 'agent-skill'], io)).toBe(EXIT_OK)
    expect(readFileSync(path, 'utf8')).toBe('my own notes\n')
    expect(out.join('\n')).toContain('modified')
    expect(out.join('\n')).toContain('--force')
  })

  it('--force replaces a modified skill and says so', async () => {
    const { io, root, out } = workspace()
    await run(['skill', 'install', '--project', '--format', 'agent-skill'], io)
    const path = join(root, '.claude/skills/jsonld-design/SKILL.md')
    writeFileSync(path, 'my own notes\n')
    out.length = 0

    expect(
      await run(['skill', 'install', '--project', '--format', 'agent-skill', '--force'], io),
    ).toBe(EXIT_OK)
    expect(readFileSync(path, 'utf8')).not.toBe('my own notes\n')
    expect(out.join('\n')).toContain('replaced')
  })
})

describe('skills change nothing the tool reports', () => {
  const MODEL = `jsonld: "1"
namespace:
  prefix: ex
  base: https://example.org/ns#
terms:
  name:
    "@id": ex:name
`

  /**
   * Locked decision 16 held as a property rather than a promise: guidance may
   * not become an input to a diagnostic. If installing skills could move a
   * finding or an exit code, the skills would be a second authority beside the
   * rule ids.
   */
  it('`ldm check` is identical with and without skills installed', async () => {
    const bare = workspace()
    writeFileSync(join(bare.root, 'm.jsonld.yaml'), MODEL)

    const before: string[] = []
    const withoutCode = await run(
      ['check', 'm.jsonld.yaml', '--json'],
      { ...bare.io, out: (line) => before.push(line) },
    )

    await run(['skill', 'install', '--project'], bare.io)

    const after: string[] = []
    const withCode = await run(
      ['check', 'm.jsonld.yaml', '--json'],
      { ...bare.io, out: (line) => after.push(line) },
    )

    expect(withCode).toBe(withoutCode)
    expect(JSON.parse(after.join('\n'))).toEqual(JSON.parse(before.join('\n')))
  })
})
