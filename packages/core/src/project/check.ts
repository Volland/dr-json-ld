/**
 * Checking a project: every model it declares, reported together.
 *
 * The findings of all the models are merged into one deterministically ordered
 * report, and each names the model it came from — so a reader of a fifty-model
 * project can tell whose problem a line is without counting file paths.
 *
 * @lat: [[validation#Validation#Findings]]
 */
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { FindingCollector } from '../findings/collector.js'
import { hasErrors, LEVEL_ORDER, sortFindings, type Finding, type Level } from '../findings/finding.js'
import { resolveModelText } from '../model/resolve.js'
import { SourceIndex } from '../source/index-file.js'
import { resolverFor } from '../vendor/vendor.js'
import { chainResolvers, selfPublishedResolver } from '../publish/self-resolver.js'
import {
  findAllProjectFiles,
  loadProject,
  type Project,
  type ProjectModel,
} from './project.js'
import { validateModel, type ExampleOutcome } from '../validate/validate.js'

export interface ProjectModelReport {
  model: ProjectModel
  findings: Finding[]
  examples: ExampleOutcome[]
  /** The level this model was checked through. */
  level: Level
  /**
   * The model's own verdict. A negative example that raised what it declared
   * does not fail it, though its findings are still reported.
   */
  failed: boolean
}

export interface ProjectReport {
  project: Project
  level: Level
  /** Every finding, from the project file and from every model, in one order. */
  findings: Finding[]
  models: ProjectModelReport[]
  failed: boolean
}

export interface CheckProjectOptions {
  level?: Level
  /** Where to look for other projects claiming the same model. Defaults to the project root. */
  searchRoot?: string
  /** Findings already produced by loading the project file. */
  projectFindings?: readonly Finding[]
}

/**
 * Check every model the project declares.
 *
 * The project file's own findings come first, because a project that does not
 * load is the reason every model under it is unreadable, and burying that under
 * fifty model findings would be unhelpful.
 */
export function checkProject(
  project: Project,
  options: CheckProjectOptions = {},
): ProjectReport {
  const all = new FindingCollector()
  all.addAll(options.projectFindings ?? [])

  const source = SourceIndex.parse(readFileSync(project.file, 'utf8'), { path: project.file })
  all.addAll(crossProjectFindings(project, source, options.searchRoot ?? project.root))
  const projectFailed = hasErrors(all.all())

  const models: ProjectModelReport[] = []
  for (const model of project.models) {
    if (!existsSync(model.path)) continue
    const report = checkOneModel(project, model, options.level)
    models.push(report)
    all.addAll(report.findings)
  }

  // Unset, each model is checked as far as it allows — through L3 when it
  // declares shapes — and the project reports the furthest any model went.
  const level =
    options.level ??
    models.reduce<Level>((acc, m) => (LEVEL_ORDER[m.level] > LEVEL_ORDER[acc] ? m.level : acc), 'L2')
  const findings = sortFindings(all.all())
  return { project, level, findings, models, failed: projectFailed || models.some((m) => m.failed) }
}

function checkOneModel(project: Project, model: ProjectModel, level?: Level): ProjectModelReport {
  const text = readFileSync(model.path, 'utf8')
  // The path is relative to the project, so a finding reads the same wherever
  // the command was run from.
  const path = relative(project.root, model.path)
  const source = SourceIndex.parse(text, { path })
  const { ir } = resolveModelText(text, path)

  const extra = new FindingCollector()

  // A model may name the project it belongs to. If it names a different one, or
  // one that does not list it, that is a disagreement worth reporting at the
  // model rather than leaving for someone to notice.
  if (ir?.project !== undefined && ir.project !== project.name) {
    extra.raise(
      'L0.model-project-mismatch',
      source,
      '/project',
      `This model names the project "${ir.project}", and the project that declares it is "${project.name}".`,
      { subject: model.name },
    )
  }

  // A model may build on a version this same project published. That resolves
  // from the published tree, so it must be tried before the vendored directory
  // reports the reference as unvendored.
  const resolveContext = ir
    ? chainResolvers(
        selfPublishedResolver({ project }),
        resolverFor(ir, resolve(model.path, '..')),
      )
    : undefined

  const report = validateModel(source, {
    ...(level !== undefined ? { level } : {}),
    ...(resolveContext ? { resolveContext } : {}),
    readExample: (relativePath) => {
      const full = resolve(model.path, '..', relativePath)
      return existsSync(full) ? readFileSync(full, 'utf8') : undefined
    },
  })

  return {
    model,
    findings: sortFindings([...report.findings, ...extra.all()]),
    examples: report.examples,
    level: report.level,
    failed: report.failed || hasErrors(extra.all()),
  }
}

/**
 * A model claimed by two projects. Reported against the project being checked,
 * naming both projects, because from either side the fix is the same: one of
 * them must stop declaring it.
 */
export function crossProjectFindings(
  project: Project,
  source: SourceIndex,
  searchRoot: string,
): Finding[] {
  const findings = new FindingCollector()

  for (const file of findAllProjectFiles(searchRoot)) {
    if (resolve(file) === resolve(project.file)) continue
    let other: Project | undefined
    try {
      other = loadProject(file).project
    } catch {
      // A project file that cannot be read is that project's problem to report,
      // not a reason to fail the one being checked.
      continue
    }
    if (!other) continue

    for (const mine of project.models) {
      const theirs = other.models.find((m) => m.path === mine.path)
      if (!theirs) continue
      findings.raise(
        'L0.model-claimed-twice',
        source,
        mine.pointer,
        `${mine.declaredPath} is declared by "${project.name}" as "${mine.name}" and by "${other.name}" as "${theirs.name}" (${relative(project.root, other.file)}). A model belongs to at most one project.`,
        { subject: mine.name },
      )
    }
  }

  return findings.all()
}

/** Which model produced a finding, for a report that names it. */
export function modelForFinding(report: ProjectReport, finding: Finding): string | undefined {
  return report.models.find((m) => m.findings.includes(finding))?.model.name
}
