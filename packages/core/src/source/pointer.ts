/**
 * JSON Pointer (RFC 6901) as the one currency for "where did this come from".
 *
 * Every node, value and dropped key an expansion produces carries one of these,
 * and it resolves to a line and column through {@link SourceIndex}.
 *
 * @lat: [[processing#Processing#Source Mapping]]
 */

export type JsonPointer = string

const ROOT: JsonPointer = ''

export function pointerRoot(): JsonPointer {
  return ROOT
}

/** Escape one reference token per RFC 6901 section 3. */
export function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** Append one token (an object key or an array index) to a pointer. */
export function pointerChild(parent: JsonPointer, token: string | number): JsonPointer {
  return `${parent}/${escapeToken(String(token))}`
}

export function pointerTokens(pointer: JsonPointer): string[] {
  if (pointer === ROOT) return []
  if (!pointer.startsWith('/')) {
    throw new Error(`not a JSON Pointer: ${JSON.stringify(pointer)}`)
  }
  return pointer.slice(1).split('/').map(unescapeToken)
}

export function pointerParent(pointer: JsonPointer): JsonPointer {
  const i = pointer.lastIndexOf('/')
  return i <= 0 ? ROOT : pointer.slice(0, i)
}

/** The last token, or `undefined` at the root. */
export function pointerLast(pointer: JsonPointer): string | undefined {
  const tokens = pointerTokens(pointer)
  return tokens[tokens.length - 1]
}

const MISSING = Symbol('json-pointer-missing')

/**
 * Resolve a pointer against a parsed value. Returns {@link MISSING} — exposed as
 * `pointerResolves` returning `false` — when the pointer names nothing.
 */
export function pointerGet(root: unknown, pointer: JsonPointer): unknown {
  let current: unknown = root
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(current)) {
      // A pointer into an array must be a non-negative decimal index with no
      // leading zeroes, per RFC 6901.
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return MISSING
      const index = Number(token)
      if (index >= current.length) return MISSING
      current = current[index]
      continue
    }
    if (current !== null && typeof current === 'object') {
      const obj = current as Record<string, unknown>
      if (!Object.prototype.hasOwnProperty.call(obj, token)) return MISSING
      current = obj[token]
      continue
    }
    return MISSING
  }
  return current
}

/** Whether a pointer names a node that exists in `root`. */
export function pointerResolves(root: unknown, pointer: JsonPointer): boolean {
  return pointerGet(root, pointer) !== MISSING
}
