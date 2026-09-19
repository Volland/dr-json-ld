/**
 * `ldm ids`: mint and write element ids onto terms and examples as a targeted
 * splice, so every comment stays in place and the only textual change is the
 * added ids.
 *
 * @lat: [[metamodel#Metamodel#Stable Element IDs]]
 */
import { applySplices, indentAt, startOfLine, type Splice } from '../edit/splice.js'
import { SourceIndex } from '../source/index-file.js'
import { pointerChild, pointerRoot, type JsonPointer } from '../source/pointer.js'
import { isElementId, mintElementId } from './element-id.js'

export interface BackfillResult {
  text: string
  /** One entry per id written, for the command's report. */
  added: Array<{ kind: 'term' | 'example' | 'view'; key: string; id: string }>
  changed: boolean
}

interface Candidate {
  kind: 'term' | 'example' | 'view'
  key: string
  pointer: JsonPointer
}

/**
 * Write an id onto every element that has none. An element that already carries
 * one keeps it — that is the whole point of the id, so a rename is a rename.
 */
export function backfillElementIds(text: string, path: string): BackfillResult {
  const source = SourceIndex.parse(text, { path })
  const root = source.data
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return { text, added: [], changed: false }
  }
  const model = root as Record<string, unknown>

  const taken = new Set<string>()
  const candidates: Candidate[] = []

  const terms = model['terms']
  if (terms !== null && typeof terms === 'object' && !Array.isArray(terms)) {
    for (const [key, def] of Object.entries(terms as Record<string, unknown>)) {
      const pointer = pointerChild(pointerChild(pointerRoot(), 'terms'), key)
      const existing = definitionId(def)
      if (existing) taken.add(existing)
      else candidates.push({ kind: 'term', key, pointer })
    }
  }

  for (const [field, kind] of [
    ['examples', 'example'],
    ['views', 'view'],
  ] as const) {
    const list = model[field]
    if (!Array.isArray(list)) continue
    list.forEach((entry, i) => {
      const pointer = pointerChild(pointerChild(pointerRoot(), field), i)
      const existing = definitionId(entry)
      if (existing) {
        taken.add(existing)
        return
      }
      const key =
        entry !== null && typeof entry === 'object'
          ? String(
              (entry as Record<string, unknown>)['path'] ??
                (entry as Record<string, unknown>)['name'] ??
                i,
            )
          : String(i)
      candidates.push({ kind, key, pointer })
    })
  }

  const splices: Splice[] = []
  const added: BackfillResult['added'] = []

  for (const candidate of candidates) {
    const id = mintElementId(taken)
    taken.add(id)
    const splice = spliceForId(text, source, candidate.pointer, id)
    if (!splice) continue
    splices.push(splice)
    added.push({ kind: candidate.kind, key: candidate.key, id })
  }

  if (splices.length === 0) return { text, added: [], changed: false }
  return { text: applySplices(text, splices), added, changed: true }
}

function definitionId(def: unknown): string | undefined {
  if (def === null || typeof def !== 'object' || Array.isArray(def)) return undefined
  const raw = (def as Record<string, unknown>)['id']
  if (raw === undefined || raw === null) return undefined
  const value = String(raw)
  return isElementId(value) ? value : undefined
}

/**
 * The id is inserted as the first line of the element's block, which is where a
 * reader looks for it and which keeps a comment written above the element above
 * it still.
 */
function spliceForId(
  text: string,
  source: SourceIndex,
  pointer: JsonPointer,
  id: string,
): Splice | undefined {
  // The *key* range, not the value range: a term's value is the mapping that
  // starts on the next line, and inserting relative to it puts the id inside
  // the first facet instead of beside it.
  const range = source.keyRangeOf(pointer)
  if (!range) return undefined

  const blockStart = startOfLine(text, range.start)
  const keyIndent = indentAt(text, range.start)

  // A flow mapping (`{ "@id": ex:x }`) has no line to insert into, so the id
  // goes inside the braces instead.
  const lineEnd = text.indexOf('\n', range.start)
  const firstLine = text.slice(blockStart, lineEnd === -1 ? text.length : lineEnd)
  const flow = /\{\s*/.exec(firstLine)
  const isSequenceItem = /^\s*-\s/.test(firstLine)

  if (flow && firstLine.indexOf('{') > firstLine.indexOf(':')) {
    const braceOffset = blockStart + firstLine.indexOf('{')
    const after = braceOffset + 1
    const spacing = /^\s*\}/.test(text.slice(after)) ? '' : ' '
    return { start: after, end: after, text: ` id: ${id},${spacing}` }
  }

  if (isSequenceItem) {
    // `- path: ...` — the id becomes the item's first key, replacing the dash's
    // own content position so the rest of the item keeps its indentation.
    const dashIndex = firstLine.indexOf('-')
    const contentStart = blockStart + dashIndex + 1
    const gap = /^[ \t]*/.exec(text.slice(contentStart))![0]
    // The item's keys start one past the dash plus the gap after it; that column
    // is where the key the id displaces must line up again.
    const itemIndent = ' '.repeat(dashIndex + 1 + gap.length)
    return {
      start: contentStart + gap.length,
      end: contentStart + gap.length,
      text: `id: ${id}\n${itemIndent}`,
    }
  }

  // A block mapping: insert a new line after the key's own line, indented one
  // step in from the key.
  const childIndent = childIndentOf(text, blockStart, keyIndent)
  const insertAt = lineEnd === -1 ? text.length : lineEnd
  return { start: insertAt, end: insertAt, text: `\n${childIndent}id: ${id}` }
}

/** The indentation the element's existing children use, or two spaces in. */
function childIndentOf(text: string, blockStart: number, keyIndent: string): string {
  const lines = text.slice(blockStart).split('\n')
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const indent = line.length - line.trimStart().length
    if (indent <= keyIndent.length) break
    return line.slice(0, indent)
  }
  return `${keyIndent}  `
}
