/**
 * What the skills are allowed to say, and what the three formats are allowed to
 * differ in.
 *
 * Prose goes stale in ways no test can see. What a test *can* see is the
 * mechanical part: a rule id that no longer exists, a command that was never a
 * command, and two formats that have drifted apart. Those are checked here, and
 * the rest is review.
 *
 * @lat: [[architecture#Architecture#Authoring Skills]]
 */
import { describe, expect, it } from 'vitest'

import { RULES } from '../src/findings/rules.js'
import {
  bodyOf,
  directoryFor,
  FORMATS,
  render,
  type Format,
} from '../src/skills/render.js'
import { commandsIn, loadSkills, parseSkill, ruleIdsIn, SkillError } from '../src/skills/skill.js'

/** Every verb `ldm` accepts, from its own command table. */
const COMMANDS = new Set([
  'init',
  'check',
  'emit',
  'import',
  'vendor',
  'ids',
  'explain',
  'version',
  'clone',
  'alias',
  'publish',
  'diff',
  'search',
  'skill',
])

describe('the shipped skills', () => {
  const skills = loadSkills()

  it('there is one, and each carries a name and a summary', () => {
    expect(skills.length).toBeGreaterThan(0)
    for (const skill of skills) {
      expect(skill.name, 'name').toMatch(/^[a-z][a-z0-9-]*$/)
      expect(skill.summary.length, `${skill.name} summary`).toBeGreaterThan(20)
      expect(skill.body.length, `${skill.name} body`).toBeGreaterThan(200)
    }
  })

  it('names are unique', () => {
    expect(new Set(skills.map((s) => s.name)).size).toBe(skills.length)
  })

  /**
   * A rule id is the stable part of a finding — the thing a skill is allowed to
   * quote, precisely because a message can be reworded and an id cannot. A
   * skill naming an id that was renamed is worse than one naming none: it sends
   * the reader looking for something that is not there.
   *
   * @lat: [[validation#Validation#Findings]]
   */
  it('every rule id a skill names exists in the registry', () => {
    const unknown: string[] = []
    for (const skill of skills) {
      for (const id of ruleIdsIn(skill.body)) {
        if (!(id in RULES)) unknown.push(`${skill.name}: ${id}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('at least one skill names a rule id, so the check is not vacuous', () => {
    expect(skills.flatMap((s) => ruleIdsIn(s.body)).length).toBeGreaterThan(0)
  })

  it('every command a skill names is a command', () => {
    const unknown: string[] = []
    for (const skill of skills) {
      for (const command of [...commandsIn(skill.body), ...skill.commands]) {
        if (!COMMANDS.has(command)) unknown.push(`${skill.name}: ldm ${command}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('a skill with no header is refused', () => {
    expect(() => parseSkill('broken', 'no header here')).toThrow(SkillError)
    expect(() => parseSkill('broken', '---\ncommands: check\n---\nbody')).toThrow(SkillError)
  })
})

describe('the three renderings', () => {
  const skills = loadSkills()

  it.each(FORMATS)('%s produces a file for every skill', (format: Format) => {
    const files = render(format, skills)
    expect(files.length).toBeGreaterThanOrEqual(skills.length)
    for (const skill of skills) {
      expect(files.some((f) => f.path.includes(skill.name)), skill.name).toBe(true)
    }
  })

  it.each(FORMATS)('%s declares where it installs', (format: Format) => {
    expect(typeof directoryFor(format)).toBe('string')
  })

  /**
   * The guard against drift. Three hand-written files per skill is what every
   * project shipping multi-agent guidance does, and it is why their formats
   * disagree within two releases — so the bodies are compared rather than
   * reviewed.
   */
  it('carries the same prose in all three formats', () => {
    for (const skill of skills) {
      const bodies = FORMATS.map((format) => {
        const files = render(format, [skill])
        const file = files.find((f) => f.path.includes(skill.name) && f.path.endsWith('.md'))
        return bodyOf(file!.content)
      })
      for (const body of bodies) {
        expect(body, `${skill.name} differs between formats`).toBe(bodies[0])
      }
      expect(bodies[0]).toBe(skill.body)
    }
  })

  it('carries the same rule ids and commands in all three formats', () => {
    for (const skill of skills) {
      const seen = FORMATS.map((format) => {
        const file = render(format, [skill]).find(
          (f) => f.path.includes(skill.name) && f.path.endsWith('.md'),
        )!
        return {
          rules: ruleIdsIn(file.content).join(','),
          commands: commandsIn(bodyOf(file.content)).join(','),
        }
      })
      for (const one of seen) {
        expect(one, skill.name).toEqual(seen[0])
      }
    }
  })

  it('every rendering says it is guidance rather than a verdict', () => {
    for (const format of FORMATS) {
      for (const file of render(format, skills)) {
        expect(file.content, `${format} ${file.path}`).toMatch(/Guidance only|guidance/i)
      }
    }
  })

  it('the Agent Skill frontmatter carries the name and description', () => {
    for (const skill of skills) {
      const [file] = render('agent-skill', [skill])
      expect(file!.content).toMatch(new RegExp(`^---\\nname: ${skill.name}\\n`))
      expect(file!.content).toContain(`description: ${skill.summary}`)
      expect(file!.path).toBe(`${skill.name}/SKILL.md`)
    }
  })

  it('the neutral bundle indexes every skill from one AGENTS.md', () => {
    const files = render('agents', skills)
    const index = files.find((f) => f.path === 'AGENTS.md')
    expect(index).toBeDefined()
    for (const skill of skills) {
      expect(index!.content).toContain(skill.summary)
    }
  })
})
