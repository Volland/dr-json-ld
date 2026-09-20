/**
 * `ldm skill` — list the authoring skills this build carries, and install them.
 *
 * Install has no default target. `--project` or `--user` is required, because
 * the failure mode of guessing is writing files into a directory the caller did
 * not mean: a wrong `--user` install is invisible and then applies to every
 * repository they open afterwards.
 *
 * Nothing here reaches the network. The skills ship inside the package.
 *
 * @lat: [[architecture#Architecture#Authoring Skills#Installing]]
 */
import { isAbsolute, join, relative, resolve } from 'node:path'

import {
  directoryFor,
  FORMATS,
  loadSkills,
  render,
  type Format,
  type Skill,
} from '@json-ld-modeler/core'

import { EXIT_FINDINGS, EXIT_OK, UsageError, type Io } from './io.js'
import type { CommandContext } from './project-commands.js'

export function skillCommand(context: CommandContext): number {
  const verb = context.positional[0]
  if (verb === undefined || verb === 'list') return list(context)
  if (verb === 'install') return install(context)
  throw new UsageError(
    `"${verb}" is not a skill verb. Use \`ldm skill list\` or \`ldm skill install --project|--user\`.`,
  )
}

// ---- ldm skill list ----------------------------------------------------------

function list(context: CommandContext): number {
  const { io } = context
  const skills = loadSkills()

  io.out('Authoring skills in this build:')
  io.out('')
  const width = Math.max(...skills.map((s) => s.name.length))
  for (const skill of skills) {
    io.out(`  ${skill.name.padEnd(width)}  ${skill.summary}`)
  }
  io.out('')
  io.out(`Formats: ${FORMATS.join(', ')}.`)
  io.out('Install with `ldm skill install --project` or `--user`.')
  io.out('')
  io.out(
    'A skill is guidance, never a verdict: it produces no finding, no edit and no exit code.',
  )
  return EXIT_OK
}

// ---- ldm skill install -------------------------------------------------------

function install(context: CommandContext): number {
  const { io, flags } = context

  const root = targetRoot(context)
  const formats = formatsFrom(flags)
  const skills = selected(context)
  const force = flags.has('force')

  let written = 0
  let current = 0
  const modified: string[] = []

  for (const format of formats) {
    const base = directoryFor(format)
    for (const file of render(format, skills)) {
      const full = resolve(root, base === '' ? file.path : join(base, file.path))
      const shown = display(io, full)

      if (io.exists(full)) {
        const existing = io.readFile(full)
        if (existing === file.content) {
          io.out(`current   ${shown}`)
          current++
          continue
        }
        if (!force) {
          io.out(`modified  ${shown}`)
          modified.push(shown)
          continue
        }
        io.writeFile(full, file.content)
        io.out(`replaced  ${shown}`)
        written++
        continue
      }

      io.writeFile(full, file.content)
      io.out(`wrote     ${shown}`)
      written++
    }
  }

  io.out('')
  io.out(
    `${written} written, ${current} already current, ${modified.length} left as you had ${modified.length === 1 ? 'it' : 'them'}.`,
  )

  if (modified.length > 0) {
    io.out('')
    io.out(
      'A skill you have edited is never overwritten. To take this build\u2019s version, pass --force; to keep yours, do nothing.',
    )
  }
  return EXIT_OK
}

/**
 * The install root. There is deliberately no fallback: a default here would be
 * a guess about which of two very different places the caller meant.
 */
function targetRoot(context: CommandContext): string {
  const { io, flags } = context
  const project = flags.has('project')
  const user = flags.has('user')

  if (project && user) {
    throw new UsageError('pass either --project or --user, not both')
  }
  if (!project && !user) {
    throw new UsageError(
      'say where the skills go: --project writes beneath this directory, --user writes beneath your home directory. There is no default, because the two are not interchangeable.',
    )
  }
  return project ? io.cwd() : io.home()
}

/**
 * `--project` is a value-taking flag elsewhere — `ldm check --project <path>`
 * names a project file — so the shared parser swallows whatever follows it.
 * Here it is a destination and takes nothing, which means
 * `ldm skill install --project jsonld-design` arrives with the skill name
 * attached to the flag instead of in the positionals, and installing
 * everything is precisely the wrong way to recover.
 *
 * So the value is taken back. `ldm skill` accepts no project path, so a string
 * on `--project` can only ever be a name the caller meant as an argument.
 */
function reclaimed(context: CommandContext): string[] {
  const value = context.flags.get('project')
  return typeof value === 'string' ? [value] : []
}

function formatsFrom(flags: Map<string, string | true>): Format[] {
  const raw = flags.get('format')
  if (raw === undefined) return [...FORMATS]
  if (raw === true) throw new UsageError(`--format needs a value: ${FORMATS.join(', ')}`)

  const names = raw
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '')
  for (const name of names) {
    if (!(FORMATS as readonly string[]).includes(name)) {
      throw new UsageError(`--format "${name}" is not a format. Known: ${FORMATS.join(', ')}.`)
    }
  }
  if (names.length === 0) throw new UsageError('--format needs at least one format name')
  return names as Format[]
}

/** The skills named on the command line, or all of them. */
function selected(context: CommandContext): Skill[] {
  const skills = loadSkills()
  const named = [...context.positional.slice(1), ...reclaimed(context)]
  if (named.length === 0) return [...skills]

  const chosen: Skill[] = []
  for (const name of named) {
    const skill = skills.find((s) => s.name === name)
    if (!skill) {
      throw new UsageError(
        `"${name}" is not a skill this build carries. Known: ${skills.map((s) => s.name).join(', ')}.`,
      )
    }
    chosen.push(skill)
  }
  return chosen
}

function display(io: Io, path: string): string {
  const rel = relative(io.cwd(), path)
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel.split('\\').join('/')
}

export { EXIT_FINDINGS }
