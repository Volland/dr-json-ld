/**
 * One skill, three renderings.
 *
 * Agent Skills, a vendor-neutral `AGENTS.md` bundle and Copilot chatmodes are
 * three framings of the same prose. Each renderer is a pure function from a
 * parsed {@link Skill} to the files it produces, so a fourth format is a
 * function rather than a redesign — which is the whole reason the source is not
 * itself one of the output formats.
 *
 * Frontmatter differs between them. The body may not, and a test parses each
 * rendering back out to assert it.
 *
 * @lat: [[architecture#Architecture#Authoring Skills#Three formats, one source]]
 */
import type { Skill } from './skill.js'

/** The formats `ldm skill install --format` selects between. */
export const FORMATS = ['agent-skill', 'agents', 'chatmode'] as const
export type Format = (typeof FORMATS)[number]

/** One file a renderer produces: a path relative to the install root. */
export interface RenderedFile {
  path: string
  content: string
}

/**
 * The line every rendering carries. A skill is prose the tool ships, and a
 * reader who mistakes it for the tool's verdict on their model has misread it
 * in the one way that matters.
 */
const PROVENANCE =
  'Shipped with `@json-ld-modeler/ldm`. Guidance only — it produces no diagnostic, no edit and no exit code. Anything about a specific model comes from the commands named here.'

function commandLine(skill: Skill): string {
  if (skill.commands.length === 0) return ''
  return `\n\nCommands this skill defers to: ${skill.commands.map((c) => `\`ldm ${c}\``).join(', ')}.`
}

/** Anthropic Agent Skills: a directory per skill holding `SKILL.md`. */
export function renderAgentSkill(skill: Skill): RenderedFile[] {
  return [
    {
      path: `${skill.name}/SKILL.md`,
      content: `---
name: ${skill.name}
description: ${skill.summary}
---

<!-- ${PROVENANCE} -->

${skill.body}${commandLine(skill)}
`,
    },
  ]
}

/** Copilot chatmodes: one `*.chatmode.md` per skill. */
export function renderChatmode(skill: Skill): RenderedFile[] {
  return [
    {
      path: `${skill.name}.chatmode.md`,
      content: `---
description: ${skill.summary}
---

<!-- ${PROVENANCE} -->

${skill.body}${commandLine(skill)}
`,
    },
  ]
}

/**
 * The vendor-neutral bundle: one `AGENTS.md` naming every skill, and the bodies
 * beside it. One file rather than one per skill, because the convention is that
 * an agent reads `AGENTS.md` and nothing tells it to go looking for more.
 */
export function renderAgents(skills: readonly Skill[]): RenderedFile[] {
  const index = `# Authoring JSON-LD models

${PROVENANCE}

${skills.map((s) => `- [${s.name}](ldm-skills/${s.name}.md) — ${s.summary}`).join('\n')}
`

  return [
    { path: 'AGENTS.md', content: index },
    ...skills.map((skill) => ({
      path: `ldm-skills/${skill.name}.md`,
      content: `<!-- ${PROVENANCE} -->\n\n${skill.body}${commandLine(skill)}\n`,
    })),
  ]
}

/** Every file a format produces for a given set of skills. */
export function render(format: Format, skills: readonly Skill[]): RenderedFile[] {
  switch (format) {
    case 'agent-skill':
      return skills.flatMap(renderAgentSkill)
    case 'chatmode':
      return skills.flatMap(renderChatmode)
    case 'agents':
      return renderAgents(skills)
  }
}

/**
 * Where a format's files go beneath the install root. An Agent Skill lands in
 * `.claude/skills/`, a chatmode in `.github/chatmodes/`, and the neutral bundle
 * at the root because that is where an agent looks for `AGENTS.md`.
 */
export function directoryFor(format: Format): string {
  switch (format) {
    case 'agent-skill':
      return '.claude/skills'
    case 'chatmode':
      return '.github/chatmodes'
    case 'agents':
      return ''
  }
}

/**
 * Recovers the body from a rendered file, for the test that asserts the three
 * formats carry the same prose. Frontmatter and the provenance comment are the
 * only things a format is allowed to differ in.
 */
export function bodyOf(content: string): string {
  return content
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^<!--[\s\S]*?-->\n/m, '')
    .replace(/\n\nCommands this skill defers to:.*$/s, '')
    .trim()
}
