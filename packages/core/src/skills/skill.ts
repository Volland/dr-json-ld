/**
 * The authoring skills: what the tool knows about writing a model, packaged so
 * that the agent drafting one can read it.
 *
 * A skill is prose and nothing else. It produces no finding, no edit and no
 * exit code, and nothing in `check`, `emit`, `explain` or `diff` reads this
 * directory — which is locked decision 16 held structurally rather than by
 * discipline. Where a skill would need a fact about a particular model, it
 * names the command that produces it, because a document cannot know what is
 * in a file it has never seen.
 *
 * One source, three renderings. Agent Skills, a vendor-neutral `AGENTS.md`
 * bundle, and Copilot chatmodes are three framings of the same body; keeping
 * one source is what stops them disagreeing by the second release.
 *
 * @lat: [[architecture#Architecture#Authoring Skills]]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** One skill, as it is written on disk and as every renderer receives it. */
export interface Skill {
  /** Stable across releases; the directory name and the installed name. */
  name: string
  /** One line, for `ldm skill list` and for each format's frontmatter. */
  summary: string
  /** The commands this skill routes to. Asserted to exist. */
  commands: readonly string[]
  /** The prose. Markdown, with no frontmatter of its own. */
  body: string
}

/** The source tree: `skills/<name>/skill.md`, one directory per skill. */
const SKILLS_DIR = fileURLToPath(new URL('../../skills/', import.meta.url))

/**
 * A skill file opens with a minimal header — `summary:` and `commands:` — and
 * then the body. It is deliberately not YAML frontmatter: the source is not any
 * one of the three output formats, and borrowing one format's header would
 * quietly make that format the canonical one.
 */
const HEADER = /^---\n([\s\S]*?)\n---\n/

export class SkillError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillError'
  }
}

export function parseSkill(name: string, text: string): Skill {
  const header = HEADER.exec(text)
  if (!header) throw new SkillError(`skill "${name}" has no header block`)

  const fields = new Map<string, string>()
  for (const line of header[1]!.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }

  const summary = fields.get('summary')
  if (!summary) throw new SkillError(`skill "${name}" declares no summary`)

  const commands = (fields.get('commands') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '')

  return { name, summary, commands, body: text.slice(header[0].length).trim() }
}

let cached: readonly Skill[] | undefined

/** Every skill this build carries, in a stable order. */
export function loadSkills(): readonly Skill[] {
  if (cached) return cached
  const names = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  cached = names.map((name) =>
    parseSkill(name, readFileSync(`${SKILLS_DIR}${name}/skill.md`, 'utf8')),
  )
  return cached
}

/** One skill by name, or `undefined` when this build does not carry it. */
export function skillNamed(name: string): Skill | undefined {
  return loadSkills().find((skill) => skill.name === name)
}

/** Every rule id a skill body names, for the test that they all exist. */
export function ruleIdsIn(body: string): string[] {
  return [...new Set(body.match(/\bL[0-4]\.[a-z0-9-]+/g) ?? [])].sort()
}

/** Every `ldm` command a skill body names, in the same spirit. */
export function commandsIn(body: string): string[] {
  return [...new Set((body.match(/\bldm\s+([a-z]+)/g) ?? []).map((m) => m.split(/\s+/)[1]!))].sort()
}
