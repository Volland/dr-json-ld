/**
 * The VS Code host: webview and diagnostics plumbing only.
 *
 * The canvas is a companion webview opened beside the YAML editor, in the
 * manner of Markdown preview. Registering it as a `CustomTextEditorProvider`
 * would make it the default editor for model files and hide the YAML,
 * forfeiting the schema-driven completion that motivated choosing YAML at all.
 *
 * @lat: [[architecture#Architecture#Editing Surface]]
 */
import * as vscode from 'vscode'

import {
  backfillElementIds,
  findProjectFile,
  modelScaffold,
  nameProblem,
  PLACEHOLDER_BASE,
  PLACEHOLDER_PREFIX,
  PROJECT_FILE,
  projectScaffold,
  registerModel,
  resolveModelText,
  resolverFor,
  SourceIndex,
  validateModel,
  VendorStore,
  type Finding,
  type JsonPointer,
} from '@jsonld-modeler/core'

import { applyIntents, type Intent } from './intents/intent.js'
import { invalidate, project, type Projection } from './projection.js'
import {
  DEFAULT_VIEW,
  emptyLayout,
  emptyLayoutDocument,
  layoutFileName,
  type HostAdapter,
  type LayoutDocument,
  type LayoutSidecar,
} from './host/adapter.js'
import { releaseStateFor } from './release-state.js'
import { SCAFFOLD } from './scaffold.js'

const MODEL_SUFFIX = '.jsonld.yaml'
/** Where a project's models go, matching what `ldm init` writes. */
const MODELS_DIR = 'models'
const DIAGNOSTIC_SOURCE = 'jsonld-modeler'

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE)
  context.subscriptions.push(diagnostics)

  const refresh = (document: vscode.TextDocument): void => {
    if (!isModel(document)) return
    publishDiagnostics(diagnostics, document)
  }

  for (const document of vscode.workspace.textDocuments) refresh(document)
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => refresh(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
  )

  context.subscriptions.push(
    command('jsonldModeler.openCanvas', () => openCanvas(context, diagnostics)),
    command('jsonldModeler.newProject', () => newProject()),
    command('jsonldModeler.newModel', () => newModel()),
    command('jsonldModeler.backfillIds', () => backfillIds()),
  )
}

export function deactivate(): void {
  // Everything is a subscription; nothing to do.
}

/**
 * Every command goes through this. A command that returns a rejected promise
 * fails silently in VS Code, which is indistinguishable from doing nothing —
 * so the rejection is reported rather than swallowed.
 */
function command(id: string, body: () => Promise<void> | void): vscode.Disposable {
  return vscode.commands.registerCommand(id, async () => {
    try {
      await body()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await vscode.window.showErrorMessage(`JSON-LD Modeler: ${message}`)
    }
  })
}

function isModel(document: vscode.TextDocument): boolean {
  return document.uri.fsPath.endsWith(MODEL_SUFFIX)
}

/**
 * Finding the model a command should act on, in the order a user would expect:
 * the active editor, then a visible editor, then the only model in the
 * workspace, then a picker. Refusing outright when the active editor is the
 * canvas itself would be the most common way to hit the failure.
 */
async function findModel(): Promise<vscode.TextDocument> {
  const active = vscode.window.activeTextEditor?.document
  if (active && isModel(active)) return active

  const visible = vscode.window.visibleTextEditors.map((e) => e.document).find(isModel)
  if (visible) return visible

  const open = vscode.workspace.textDocuments.find(isModel)
  if (open) return open

  const found = await vscode.workspace.findFiles(`**/*${MODEL_SUFFIX}`, '**/node_modules/**', 50)
  if (found.length === 0) {
    throw new Error(
      `no ${MODEL_SUFFIX} file is open or in this workspace. Run "JSON-LD Modeler: New Model" to create one.`,
    )
  }
  if (found.length === 1) return vscode.workspace.openTextDocument(found[0]!)

  const picked = await vscode.window.showQuickPick(
    found.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
    { title: 'Which model?' },
  )
  if (!picked) throw new Error('no model was chosen')
  return vscode.workspace.openTextDocument(picked.uri)
}

/**
 * Findings to the Problems panel, each at its resolved location.
 *
 * @lat: [[validation#Validation#Findings]]
 */
function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  document: vscode.TextDocument,
): void {
  const path = vscode.workspace.asRelativePath(document.uri)
  const source = SourceIndex.parse(document.getText(), { path })
  const root = dirnameOf(document.uri)
  const { ir } = resolveModelText(document.getText(), path)

  const report = validateModel(source, {
    ...(ir ? { resolveContext: resolverFor(ir, root) } : {}),
    readExample: (relative) => {
      try {
        const uri = vscode.Uri.joinPath(vscode.Uri.file(root), relative)
        const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath)
        return open?.getText()
      } catch {
        return undefined
      }
    },
  })

  // Findings can be in the model or in an example document; each goes to its
  // own file's diagnostics.
  const byFile = new Map<string, vscode.Diagnostic[]>()
  for (const finding of report.findings) {
    const key = finding.file === path ? document.uri.fsPath : resolveRelative(root, finding.file)
    const list = byFile.get(key) ?? []
    list.push(toDiagnostic(finding))
    byFile.set(key, list)
  }

  collection.set(document.uri, byFile.get(document.uri.fsPath) ?? [])
  for (const [file, list] of byFile) {
    if (file === document.uri.fsPath) continue
    collection.set(vscode.Uri.file(file), list)
  }
}

function toDiagnostic(finding: Finding): vscode.Diagnostic {
  const line = Math.max(0, finding.loc.line - 1)
  const column = Math.max(0, finding.loc.column - 1)
  const range = new vscode.Range(line, column, line, column + 1)
  const diagnostic = new vscode.Diagnostic(range, finding.message, severityOf(finding))
  diagnostic.source = DIAGNOSTIC_SOURCE
  // The rule id is the stable handle: it is what an example requires and what a
  // configuration downgrades, so it is what the panel shows as the code.
  diagnostic.code = finding.ruleId
  return diagnostic
}

function severityOf(finding: Finding): vscode.DiagnosticSeverity {
  switch (finding.severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error
    case 'warning':
      return vscode.DiagnosticSeverity.Warning
    default:
      return vscode.DiagnosticSeverity.Information
  }
}

/**
 * The project half of getting started, matching `ldm init`.
 *
 * A project must declare at least one model, so this writes both files. It
 * cannot write only the project file and leave the user to fill it in: that
 * file would fail every command until they did.
 *
 * @lat: [[architecture#Architecture#Projects#Starting one]]
 */
async function newProject(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('open a folder before creating a project')

  const projectUri = vscode.Uri.joinPath(folder.uri, PROJECT_FILE)
  if (await exists(projectUri)) {
    throw new Error(
      `${PROJECT_FILE} already exists in this folder. Use "New Model" to add a model to it.`,
    )
  }

  const name = await vscode.window.showInputBox({
    title: 'New JSON-LD Modeler project',
    prompt: 'Project name — it appears in the header of every artifact this project publishes',
    value: basenameOf(folder.uri),
    validateInput: (value) => nameProblem('project', value),
  })
  if (!name) return

  const modelName = await vscode.window.showInputBox({
    title: 'New JSON-LD Modeler project',
    prompt: 'Name of its first model',
    value: name,
    validateInput: (value) => nameProblem('model', value),
  })
  if (!modelName) return

  const declaredPath = `${MODELS_DIR}/${modelName}${MODEL_SUFFIX}`
  const modelUri = vscode.Uri.joinPath(folder.uri, MODELS_DIR, `${modelName}${MODEL_SUFFIX}`)
  if (await exists(modelUri)) throw new Error(`${declaredPath} already exists`)

  await vscode.workspace.fs.writeFile(modelUri, Buffer.from(modelScaffold(), 'utf8'))
  await vscode.workspace.fs.writeFile(
    projectUri,
    Buffer.from(projectScaffold({ name, models: [{ name: modelName, path: declaredPath }] }), 'utf8'),
  )

  const document = await vscode.workspace.openTextDocument(modelUri)
  await vscode.window.showTextDocument(document)
  void warnAboutPlaceholder(declaredPath)
}

async function newModel(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('open a folder before creating a model')

  const name = await vscode.window.showInputBox({
    title: 'New JSON-LD model',
    prompt: 'File name, without the suffix',
    value: 'vocabulary',
    validateInput: (value) => nameProblem('model', value),
  })
  if (!name) return

  // A model belongs to at most one project, and the project it belongs to is
  // the one enclosing it. Writing it beside the models already declared there
  // is what lets the registration below name a path that project can read.
  const projectFile = findProjectFile(folder.uri.fsPath)
  const uri = vscode.Uri.joinPath(
    folder.uri,
    ...(projectFile === undefined ? [] : [MODELS_DIR]),
    `${name}${MODEL_SUFFIX}`,
  )
  if (await exists(uri)) throw new Error(`${name}${MODEL_SUFFIX} already exists`)

  await vscode.workspace.fs.writeFile(uri, Buffer.from(SCAFFOLD, 'utf8'))

  if (projectFile !== undefined) {
    const declaredPath = `${MODELS_DIR}/${name}${MODEL_SUFFIX}`
    const projectUri = vscode.Uri.file(projectFile)
    const text = Buffer.from(await vscode.workspace.fs.readFile(projectUri)).toString('utf8')
    const updated = registerModel(text, projectFile, name, declaredPath)
    if (updated.changed) {
      await vscode.workspace.fs.writeFile(projectUri, Buffer.from(updated.text, 'utf8'))
    }
  }

  const document = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(document)
  void warnAboutPlaceholder(`${name}${MODEL_SUFFIX}`)
}

/**
 * The scaffolded namespace is the one thing in a new model that is certainly
 * wrong and that nothing later will flag: `ex:name` resolves, validates and
 * emits exactly as a real IRI would.
 */
async function warnAboutPlaceholder(path: string): Promise<void> {
  await vscode.window.showInformationMessage(
    `JSON-LD Modeler: the namespace in ${path} is a placeholder — ${PLACEHOLDER_PREFIX} at ${PLACEHOLDER_BASE}. Identity is the IRI, never the file path, so set it before you publish.`,
  )
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch {
    return false
  }
}

function basenameOf(uri: vscode.Uri): string {
  const name = uri.path.split('/').filter(Boolean).pop() ?? ''
  return nameProblem('project', name) === undefined ? name : ''
}

async function backfillIds(): Promise<void> {
  const document = await findModel()
  const result = backfillElementIds(document.getText(), document.uri.fsPath)
  if (!result.changed) {
    await vscode.window.showInformationMessage(
      'JSON-LD Modeler: every element already carries a written id.',
    )
    return
  }
  const edit = new vscode.WorkspaceEdit()
  edit.replace(document.uri, wholeDocument(document), result.text)
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error('the workspace edit was refused')
  }
  await vscode.window.showInformationMessage(
    `JSON-LD Modeler: wrote ${result.added.length} element id${
      result.added.length === 1 ? '' : 's'
    }.`,
  )
}

function wholeDocument(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(0, 0, document.lineCount, 0)
}

/**
 * The VS Code implementation of the host adapter. Canvas edits reach the file
 * as `WorkspaceEdit`s, so the editor owns undo and dirty state.
 */
class VsCodeHost implements HostAdapter {
  private revision = 0
  private lastValid: Projection | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly diagnostics: vscode.DiagnosticCollection,
  ) {}

  async readModel(): Promise<Projection> {
    return this.serialise(() => this.projectNow())
  }

  async applyIntent(intent: Intent): Promise<Projection> {
    return this.serialise(async () => {
      const next = applyIntents(this.document.getText(), [intent])
      const edit = new vscode.WorkspaceEdit()
      edit.replace(this.document.uri, wholeDocument(this.document), next)
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new Error('the workspace edit was refused')
      }
      this.revision++
      return this.projectNow()
    })
  }

  async resolveVendoredContext(iri: string): Promise<unknown> {
    const path = vscode.workspace.asRelativePath(this.document.uri)
    const { ir } = resolveModelText(this.document.getText(), path)
    if (!ir) return undefined
    return resolverFor(ir, dirnameOf(this.document.uri))(iri)
  }

  async reportFindings(findings: readonly Finding[]): Promise<void> {
    this.diagnostics.set(this.document.uri, findings.map(toDiagnostic))
  }

  async readLayout(view: string): Promise<LayoutSidecar> {
    const document = await this.readLayoutDocument()
    return document.views[view] ?? emptyLayout()
  }

  async writeLayout(view: string, layout: LayoutSidecar): Promise<void> {
    const current = await this.readLayoutDocument()
    const next: LayoutDocument = {
      version: 1,
      views: { ...current.views, [view]: layout },
    }
    await vscode.workspace.fs.writeFile(
      this.layoutUri(),
      Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8'),
    )
  }

  async reveal(pointer: JsonPointer): Promise<void> {
    const path = vscode.workspace.asRelativePath(this.document.uri)
    const source = SourceIndex.parse(this.document.getText(), { path })
    const position = source.positionOf(pointer)
    const editor = await vscode.window.showTextDocument(this.document, {
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.One,
    })
    const at = new vscode.Position(Math.max(0, position.line - 1), Math.max(0, position.column - 1))
    editor.selection = new vscode.Selection(at, at)
    editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  }

  private layoutUri(): vscode.Uri {
    const name = this.document.uri.path.split('/').pop() ?? 'model.jsonld.yaml'
    return vscode.Uri.joinPath(this.document.uri, '..', layoutFileName(name))
  }

  private async readLayoutDocument(): Promise<LayoutDocument> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.layoutUri())
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as LayoutDocument
    } catch {
      return emptyLayoutDocument()
    }
  }

  private projectNow(): Projection {
    const path = vscode.workspace.asRelativePath(this.document.uri)
    const text = this.document.getText()
    const source = SourceIndex.parse(text, { path })
    const { ir } = resolveModelText(text, path)
    // "Unparseable" means the YAML did not parse, not that the model has
    // findings — a model with an unknown prefix still has a diagram worth
    // drawing, and a file mid-keystroke does not.
    if (source.errors.length > 0 || !ir) {
      return invalidate(this.lastValid, source.errors[0]?.message ?? 'the model did not resolve')
    }
    const root = dirnameOf(this.document.uri)
    const store = new VendorStore({ root })
    const report = validateModel(source, { resolveContext: resolverFor(ir, root) })
    const release = releaseStateFor({ modelPath: this.document.uri.fsPath })
    const projection = project(ir, {
      findings: report.findings,
      revision: this.revision,
      locate: (pointer) => source.positionOf(pointer),
      isVendored: (iri) => store.has(iri),
      ...(release !== undefined ? { release } : {}),
    })
    this.lastValid = projection
    return projection
  }

  private serialise<T>(work: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => undefined)
    return next
  }
}

async function openCanvas(
  context: vscode.ExtensionContext,
  diagnostics: vscode.DiagnosticCollection,
): Promise<void> {
  const document = await findModel()
  const host = new VsCodeHost(document, diagnostics)

  const panel = vscode.window.createWebviewPanel(
    'jsonldModeler.canvas',
    `Canvas — ${document.uri.path.split('/').pop()}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  )

  panel.webview.html = canvasHtml(panel.webview, context.extensionUri)

  const post = async (): Promise<void> => {
    await panel.webview.postMessage({ kind: 'projection', projection: await host.readModel() })
  }

  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    try {
      await handleMessage(host, panel, message)
    } catch (error) {
      await panel.webview.postMessage({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // The file is the single source of truth: typing in it updates the canvas.
  const subscription = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (event.document.uri.fsPath === document.uri.fsPath) await post()
  })
  panel.onDidDispose(() => subscription.dispose())
  context.subscriptions.push(subscription)

  await post()
}

async function handleMessage(
  host: VsCodeHost,
  panel: vscode.WebviewPanel,
  message: unknown,
): Promise<void> {
  if (message === null || typeof message !== 'object') return
  const payload = message as Record<string, unknown>

  switch (payload['kind']) {
    case 'ready':
      await panel.webview.postMessage({ kind: 'projection', projection: await host.readModel() })
      return
    case 'intent': {
      const projection = await host.applyIntent(payload['intent'] as Intent)
      await panel.webview.postMessage({ kind: 'projection', projection })
      return
    }
    case 'layout':
      await host.writeLayout(
        (payload['view'] as string) ?? DEFAULT_VIEW,
        payload['layout'] as LayoutSidecar,
      )
      return
    case 'reveal':
      await host.reveal(payload['pointer'] as JsonPointer)
      return
    case 'open-model': {
      // Switching model opens that model's own canvas rather than re-pointing
      // this one: a canvas belongs to one model, and so does its layout.
      const path = payload['path']
      if (typeof path !== 'string') return
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One })
      await vscode.commands.executeCommand('jsonldModeler.openCanvas')
      return
    }
    default:
      return
  }
}

function canvasHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'canvas.js'),
  )
  const style = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'canvas.css'),
  )
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
      Math.floor(Math.random() * 62),
    ),
  ).join('')

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <link rel="stylesheet" href="${style}" />
    <title>JSON-LD Modeler canvas</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`
}

function dirnameOf(uri: vscode.Uri): string {
  return uri.fsPath.slice(0, uri.fsPath.lastIndexOf('/'))
}

function resolveRelative(root: string, relative: string): string {
  return relative.startsWith('/') ? relative : `${root}/${relative}`
}
