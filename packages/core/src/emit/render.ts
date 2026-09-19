/**
 * Rendering a generated artifact with comments at chosen positions.
 *
 * JSON has no comments, and the capability matrix requires one at the lossy
 * position — so the artifact is JSON with `//` lines, which is what every
 * editor and most loaders already accept. {@link stripComments} produces the
 * strict JSON an independent implementation is handed, so the execution test in
 * `lat.md/emitters#Emitters#Verification` runs against the same bytes minus the
 * commentary.
 *
 * @lat: [[emitters#Emitters#Capability Matrix]]
 */
import { pointerChild, pointerRoot, type JsonPointer } from '../source/pointer.js'

export interface RenderOptions {
  /** Lines emitted above everything, without a pointer. */
  header?: readonly string[]
  /** Comment lines to place immediately above the node a pointer names. */
  comments?: ReadonlyMap<JsonPointer, readonly string[]>
  indent?: number
}

/**
 * Render a value as JSON, inserting comment lines above the nodes named by
 * pointers. Key order is the insertion order of the object, because term order
 * is derived from the model and a one-term change must be a one-line diff.
 */
export function render(value: unknown, options: RenderOptions = {}): string {
  const indent = options.indent ?? 2
  const comments = options.comments ?? new Map<JsonPointer, readonly string[]>()
  const lines: string[] = []

  for (const line of options.header ?? []) lines.push(`// ${line}`)

  emit(value, pointerRoot(), 0, '', lines, comments, indent)
  return `${lines.join('\n')}\n`
}

function emit(
  value: unknown,
  pointer: JsonPointer,
  depth: number,
  suffix: string,
  lines: string[],
  comments: ReadonlyMap<JsonPointer, readonly string[]>,
  indent: number,
  keyPrefix = '',
): void {
  const pad = ' '.repeat(depth * indent)

  for (const comment of comments.get(pointer) ?? []) {
    lines.push(`${pad}// ${comment}`)
  }

  if (value === null || typeof value !== 'object') {
    lines.push(`${pad}${keyPrefix}${JSON.stringify(value)}${suffix}`)
    return
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}${keyPrefix}[]${suffix}`)
      return
    }
    lines.push(`${pad}${keyPrefix}[`)
    value.forEach((item, i) => {
      emit(
        item,
        pointerChild(pointer, i),
        depth + 1,
        i === value.length - 1 ? '' : ',',
        lines,
        comments,
        indent,
      )
    })
    lines.push(`${pad}]${suffix}`)
    return
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  )
  if (entries.length === 0) {
    lines.push(`${pad}${keyPrefix}{}${suffix}`)
    return
  }
  lines.push(`${pad}${keyPrefix}{`)
  entries.forEach(([key, item], i) => {
    emit(
      item,
      pointerChild(pointer, key),
      depth + 1,
      i === entries.length - 1 ? '' : ',',
      lines,
      comments,
      indent,
      `${JSON.stringify(key)}: `,
    )
  })
  lines.push(`${pad}}${suffix}`)
}

/**
 * Remove `//` comment lines, producing strict JSON.
 *
 * Only whole comment lines are removed: a `//` inside a string is left alone,
 * which matters because every IRI in a context contains one.
 */
export function stripComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
}

/** Parse an emitted artifact back into a document. */
export function parseArtifact(text: string): unknown {
  return JSON.parse(stripComments(text))
}
