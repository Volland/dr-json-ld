/**
 * Just enough of the VS Code API to exercise the diagnostics plumbing in plain
 * Node.
 *
 * `extension.ts` is the one module in this repository that imports `vscode`, and
 * it was therefore the one module no test could reach. The stub is deliberately
 * small: it covers the diagnostics surface and nothing else, so it cannot drift
 * into a second implementation of the editor.
 */
export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position
  readonly end: Position
  /** Both the four-number form and the two-Position form the real API accepts. */
  constructor(start: Position, end: Position)
  constructor(startLine: number, startChar: number, endLine: number, endChar: number)
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    if (typeof a === 'number') {
      this.start = new Position(a, b as number)
      this.end = new Position(c as number, d as number)
    } else {
      this.start = a
      this.end = b as Position
    }
  }
}

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const

export class Diagnostic {
  source?: string
  code?: string | number
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: number,
  ) {}
}

export interface StubUri {
  fsPath: string
  toString(): string
}

export const Uri = {
  file(fsPath: string): StubUri {
    return { fsPath, toString: () => `file://${fsPath}` }
  },
  joinPath(base: StubUri, ...parts: string[]): StubUri {
    return Uri.file([base.fsPath.replace(/\/$/, ''), ...parts].join('/'))
  },
}

/** Records what was published, keyed by fsPath, so a test can read it back. */
export class DiagnosticCollection {
  readonly published = new Map<string, Diagnostic[]>()
  set(uri: StubUri, diagnostics: Diagnostic[]): void {
    this.published.set(uri.fsPath, diagnostics)
  }
  delete(uri: StubUri): void {
    this.published.delete(uri.fsPath)
  }
  dispose(): void {
    this.published.clear()
  }
}

export const languages = {
  createDiagnosticCollection: (_name: string): DiagnosticCollection => new DiagnosticCollection(),
  registerCodeActionsProvider: () => ({ dispose() {} }),
}

/** A text document over a string, which is all the diagnostics path reads. */
export function textDocument(fsPath: string, text: string): {
  uri: StubUri
  getText(): string
} {
  return { uri: Uri.file(fsPath), getText: () => text }
}

export const workspace = {
  textDocuments: [] as unknown[],
  asRelativePath: (uri: StubUri | string): string =>
    typeof uri === 'string' ? uri : uri.fsPath,
  onDidOpenTextDocument: () => ({ dispose() {} }),
  onDidChangeTextDocument: () => ({ dispose() {} }),
  onDidCloseTextDocument: () => ({ dispose() {} }),
}

export const window = {
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [] as unknown[],
  showErrorMessage: async (): Promise<void> => {},
}

export const commands = {
  registerCommand: () => ({ dispose() {} }),
}

// ---- code actions --------------------------------------------------------

export const CodeActionKind = {
  QuickFix: { value: 'quickfix' },
} as const

export class CodeAction {
  diagnostics: Diagnostic[] = []
  edit?: WorkspaceEdit
  constructor(
    readonly title: string,
    readonly kind: { value: string },
  ) {}
}

export interface Replacement {
  fsPath: string
  start: number
  end: number
  text: string
}

/**
 * Records replacements as offsets, which is what the splices already are, so a
 * test can apply them to the original text and compare against `applySplices`.
 */
export class WorkspaceEdit {
  readonly replacements: Replacement[] = []
  replace(uri: StubUri, range: Range, text: string): void {
    this.replacements.push({
      fsPath: uri.fsPath,
      start: (range.start as OffsetPosition).offset,
      end: (range.end as OffsetPosition).offset,
      text,
    })
  }
  get size(): number {
    return this.replacements.length
  }
}

/** A Position that remembers the offset it came from, so edits stay comparable. */
export class OffsetPosition extends Position {
  constructor(
    line: number,
    character: number,
    readonly offset: number,
  ) {
    super(line, character)
  }
}

/** A document over a string that can map offsets, as the provider needs. */
export function editableDocument(fsPath: string, text: string) {
  return {
    uri: Uri.file(fsPath),
    getText: () => text,
    positionAt(offset: number): OffsetPosition {
      const before = text.slice(0, offset)
      const line = before.split('\n').length - 1
      const character = offset - (before.lastIndexOf('\n') + 1)
      return new OffsetPosition(line, character, offset)
    },
  }
}
