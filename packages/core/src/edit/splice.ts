/**
 * Targeted text splices computed from the YAML syntax tree.
 *
 * `Document.toString()` normalises flow-collection padding across the whole
 * file, so re-serialising turns a one-facet change into a whole-file diff. Every
 * edit in this project is therefore a splice against offsets in the original
 * text, never a re-serialisation.
 *
 * @lat: [[architecture#Architecture#Editing Surface#Targeted edits]]
 */

export interface Splice {
  /** Byte offset where the replacement begins. */
  start: number
  /** Byte offset where the replaced region ends. `start` for an insertion. */
  end: number
  text: string
}

/**
 * Apply splices to text. Applied from the end backwards so that each one lands
 * at offsets in the original text — which is what lets a caller compute several
 * splices from one parse without re-parsing between them.
 *
 * Overlapping splices are refused rather than silently resolved: a gesture that
 * produced two overlapping edits has a bug the user should not absorb.
 */
export function applySplices(text: string, splices: readonly Splice[]): string {
  if (splices.length === 0) return text
  const ordered = [...splices].sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1]!
    const current = ordered[i]!
    if (current.start < previous.end) {
      throw new Error(
        `overlapping splices: [${previous.start}, ${previous.end}) and [${current.start}, ${current.end})`,
      )
    }
  }
  let out = text
  for (let i = ordered.length - 1; i >= 0; i--) {
    const s = ordered[i]!
    out = out.slice(0, s.start) + s.text + out.slice(s.end)
  }
  return out
}

/** The indentation of the line containing `offset`. */
export function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const match = /^[ \t]*/.exec(text.slice(lineStart))
  return match ? match[0] : ''
}

/** The offset just past the end of the line containing `offset`, before its newline. */
export function endOfLine(text: string, offset: number): number {
  const nl = text.indexOf('\n', offset)
  return nl === -1 ? text.length : nl
}

/** The offset at the start of the line containing `offset`. */
export function startOfLine(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1
}

/**
 * The extent of the block a key introduces, found by indentation.
 *
 * A YAML node's own range can run past its block into whatever follows, so the
 * indentation is the authority here rather than the node range.
 */
export function blockExtent(text: string, keyOffset: number): { start: number; end: number } {
  const start = startOfLine(text, keyOffset)
  const baseIndent = indentAt(text, keyOffset).length
  const lines = text.split('\n')

  // Which line does `start` fall on?
  let lineIndex = 0
  let offset = 0
  for (; lineIndex < lines.length; lineIndex++) {
    const length = lines[lineIndex]!.length + 1
    if (offset + length > start) break
    offset += length
  }

  let end = start + lines[lineIndex]!.length
  let cursor = offset + lines[lineIndex]!.length + 1
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const line = lines[i]!
    const isBlank = line.trim() === ''
    const indent = line.length - line.trimStart().length
    if (!isBlank && indent <= baseIndent) break
    if (!isBlank) end = cursor + line.length
    cursor += line.length + 1
  }
  return { start, end }
}
