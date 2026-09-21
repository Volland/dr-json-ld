/**
 * A parsed file that can answer "which line and column is this JSON Pointer?".
 *
 * Model files are YAML and example documents are JSON. YAML 1.2 is a superset of
 * JSON, so one index serves both and there is exactly one implementation of the
 * pointer-to-position mapping in the project.
 *
 * @lat: [[processing#Processing#Source Mapping]]
 */
import {
  isDocument,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
  type ParsedNode,
} from 'yaml'

import { pointerChild, pointerRoot, type JsonPointer } from './pointer.js'

/** A 1-based line and column, the shape an editor wants. */
export interface Position {
  line: number
  column: number
}

export interface Range {
  /** Byte offset of the first character. */
  start: number
  /** Byte offset one past the last character. */
  end: number
  from: Position
  to: Position
}

export interface LocatedNode {
  /** The whole node — for a pair, key and value together. */
  value: Range
  /** The key alone, when this node is an object member. */
  key?: Range
}

/** A key that repeats one earlier in the same mapping. */
export interface DuplicateKey {
  /** The pointer both occurrences share. */
  pointer: JsonPointer
  /** The range of the second occurrence's key. */
  key: Range
}

export interface SourceIndexOptions {
  /** Shown in findings and errors. */
  path: string
}

export class SourceIndex {
  readonly path: string
  readonly text: string
  /** The parsed value, plain JS. `undefined` when the file did not parse. */
  readonly data: unknown
  /** Parse errors, already positioned. */
  readonly errors: Array<{ message: string; range: Range }>
  /**
   * Every key that repeats a key earlier in the same mapping, in document
   * order. The parsed value keeps only one of them, so this is the only place
   * the second occurrence is still visible.
   */
  readonly duplicateKeys: DuplicateKey[]

  private readonly lineStarts: number[]
  private readonly byPointer: Map<JsonPointer, LocatedNode>

  private constructor(
    path: string,
    text: string,
    data: unknown,
    errors: Array<{ message: string; range: Range }>,
    lineStarts: number[],
    byPointer: Map<JsonPointer, LocatedNode>,
    duplicateKeys: DuplicateKey[],
  ) {
    this.path = path
    this.text = text
    this.data = data
    this.errors = errors
    this.duplicateKeys = duplicateKeys
    this.lineStarts = lineStarts
    this.byPointer = byPointer
  }

  static parse(text: string, options: SourceIndexOptions): SourceIndex {
    const lineStarts = computeLineStarts(text)
    const toPosition = (offset: number) => offsetToPosition(lineStarts, offset)
    const toRange = (range: readonly [number, number, number] | undefined): Range => {
      const start = range ? range[0] : 0
      // `yaml` reports [start, value-end, node-end]; the value end is the one a
      // reader would underline, and the node end runs on through trailing
      // whitespace and comments.
      const end = range ? range[1] : 0
      return { start, end, from: toPosition(start), to: toPosition(end) }
    }

    const doc: Document.Parsed = parseDocument(text, {
      keepSourceTokens: true,
      // A duplicate key is a finding this project reports itself, with a
      // position; letting `yaml` throw would lose the second occurrence.
      uniqueKeys: false,
    })

    const errors = doc.errors.map((e) => ({
      message: e.message,
      range: toRange(e.pos.length >= 2 ? [e.pos[0]!, e.pos[1]!, e.pos[1]!] : undefined),
    }))

    const byPointer = new Map<JsonPointer, LocatedNode>()
    const duplicateKeys: DuplicateKey[] = []
    if (doc.contents) {
      indexNode(doc.contents as ParsedNode, pointerRoot(), byPointer, toRange, duplicateKeys)
    }

    let data: unknown
    try {
      data = doc.toJS({ maxAliasCount: 1000 })
    } catch {
      data = undefined
    }

    return new SourceIndex(options.path, text, data, errors, lineStarts, byPointer, duplicateKeys)
  }

  /** The range of the node a pointer names, or `undefined` if it names nothing. */
  rangeOf(pointer: JsonPointer): Range | undefined {
    return this.byPointer.get(pointer)?.value
  }

  /**
   * The range of the *key* a pointer names. A dropped key is reported at its
   * key, not at the value the reader is not interested in.
   */
  keyRangeOf(pointer: JsonPointer): Range | undefined {
    const node = this.byPointer.get(pointer)
    return node?.key ?? node?.value
  }

  /**
   * The position a finding should carry. Prefers the key, falls back to the
   * value, then to the nearest ancestor that does exist, and finally to the
   * start of the file — a finding is never left without a position.
   */
  positionOf(pointer: JsonPointer): Position {
    let p: JsonPointer = pointer
    for (;;) {
      const range = this.keyRangeOf(p)
      if (range) return range.from
      if (p === pointerRoot()) return { line: 1, column: 1 }
      const i = p.lastIndexOf('/')
      p = i <= 0 ? pointerRoot() : p.slice(0, i)
    }
  }

  has(pointer: JsonPointer): boolean {
    return this.byPointer.has(pointer)
  }

  /** Every pointer the file contains, in document order. */
  pointers(): JsonPointer[] {
    return [...this.byPointer.keys()]
  }

  offsetToPosition(offset: number): Position {
    return offsetToPosition(this.lineStarts, offset)
  }
}

function computeLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1)
  }
  return starts
}

function offsetToPosition(lineStarts: number[], offset: number): Position {
  // Binary search for the last line start at or before `offset`.
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: offset - lineStarts[lo]! + 1 }
}

type ToRange = (range: readonly [number, number, number] | undefined) => Range

function indexNode(
  node: Node,
  pointer: JsonPointer,
  out: Map<JsonPointer, LocatedNode>,
  toRange: ToRange,
  duplicates: DuplicateKey[],
  keyRange?: Range,
): void {
  const value = toRange(node.range ?? undefined)
  const entry: LocatedNode = keyRange ? { value, key: keyRange } : { value }
  // The first occurrence wins, so a duplicate key reports the *second* one as
  // the duplicate while the first keeps the canonical position.
  if (!out.has(pointer)) out.set(pointer, entry)

  if (isMap(node)) {
    const seen = new Set<string>()
    for (const item of node.items) {
      if (!isPair(item)) continue
      const keyNode = item.key as Node
      const key = scalarKey(keyNode)
      if (key === undefined) continue
      const childPointer = pointerChild(pointer, key)
      const kr = toRange((keyNode as ParsedNode).range ?? undefined)
      if (seen.has(key)) duplicates.push({ pointer: childPointer, key: kr })
      seen.add(key)
      const valueNode = item.value as Node | null
      if (valueNode && (isMap(valueNode) || isSeq(valueNode) || isScalar(valueNode))) {
        indexNode(valueNode, childPointer, out, toRange, duplicates, kr)
      } else if (!out.has(childPointer)) {
        // A key with no value still has a position, which is what a finding on
        // an empty term definition needs.
        out.set(childPointer, { value: kr, key: kr })
      }
    }
    return
  }

  if (isSeq(node)) {
    node.items.forEach((item, i) => {
      const child = item as Node
      if (isMap(child) || isSeq(child) || isScalar(child)) {
        indexNode(child, pointerChild(pointer, i), out, toRange, duplicates)
      }
    })
  }
}

function scalarKey(node: Node): string | undefined {
  if (isScalar(node)) {
    const v = node.value
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (v === null) return 'null'
  }
  return undefined
}

/** Parse a file that is expected to be JSON, keeping positions. */
export function indexJson(text: string, path: string): SourceIndex {
  return SourceIndex.parse(text, { path })
}

/** Parse a model file, keeping positions. */
export function indexYaml(text: string, path: string): SourceIndex {
  return SourceIndex.parse(text, { path })
}

export { isDocument }
