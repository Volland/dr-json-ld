/**
 * IRI handling: the small set of questions the processor and the model layer
 * both ask. Kept in one place because "is this an IRI" is answered differently
 * in three parts of the JSON-LD specification and guessing is how a term
 * silently becomes a literal.
 */

const KEYWORD = /^@[a-zA-Z]+$/

/** The JSON-LD keywords. A key matching this is never a term. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  '@base',
  '@container',
  '@context',
  '@direction',
  '@graph',
  '@id',
  '@import',
  '@included',
  '@index',
  '@json',
  '@language',
  '@list',
  '@nest',
  '@none',
  '@prefix',
  '@propagate',
  '@protected',
  '@reverse',
  '@set',
  '@type',
  '@value',
  '@version',
  '@vocab',
])

export function isKeyword(value: string): boolean {
  return KEYWORDS.has(value)
}

/** A string shaped like a keyword but not one. The spec says to ignore these. */
export function isKeywordLike(value: string): boolean {
  return KEYWORD.test(value) && !KEYWORDS.has(value)
}

const ABSOLUTE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/

export function isAbsoluteIri(value: string): boolean {
  return ABSOLUTE.test(value)
}

export function isBlankNodeId(value: string): boolean {
  return value.startsWith('_:')
}

/** `prefix:suffix`, where the suffix does not begin with `//`. */
export function splitCompactIri(value: string): { prefix: string; suffix: string } | undefined {
  const i = value.indexOf(':')
  if (i <= 0) return undefined
  const prefix = value.slice(0, i)
  const suffix = value.slice(i + 1)
  if (suffix.startsWith('//')) return undefined
  if (prefix === '_') return undefined
  return { prefix, suffix }
}

/**
 * Resolve a relative reference against a base, per RFC 3986. Returns the input
 * unchanged when there is no base, so the caller can see that it stayed
 * relative and report `L2.relative-iri`.
 */
export function resolveIri(base: string | undefined, reference: string): string {
  if (reference === '') return base ?? ''
  if (isAbsoluteIri(reference)) return reference
  if (!base) return reference
  try {
    return new URL(reference, base).href
  } catch {
    return resolveManually(base, reference)
  }
}

/**
 * `new URL` refuses a base whose scheme it does not know, and vocabulary IRIs
 * routinely use schemes it does not know. This is the RFC 3986 merge for the
 * cases that matter: a fragment, a query, an absolute path, and a relative path.
 */
function resolveManually(base: string, reference: string): string {
  if (reference.startsWith('#')) {
    const hash = base.indexOf('#')
    return (hash === -1 ? base : base.slice(0, hash)) + reference
  }
  if (reference.startsWith('?')) {
    const cut = base.search(/[?#]/)
    return (cut === -1 ? base : base.slice(0, cut)) + reference
  }
  const stripped = base.replace(/[?#].*$/, '')
  if (reference.startsWith('/')) {
    const schemeEnd = stripped.indexOf(':')
    const afterScheme = stripped.slice(schemeEnd + 1)
    if (afterScheme.startsWith('//')) {
      const authorityEnd = afterScheme.indexOf('/', 2)
      const authority =
        authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd)
      return `${stripped.slice(0, schemeEnd + 1)}${authority}${reference}`
    }
    return `${stripped.slice(0, schemeEnd + 1)}${reference}`
  }
  // A relative path replaces the last segment.
  const lastSlash = stripped.lastIndexOf('/')
  if (lastSlash === -1) return stripped + reference
  return `${stripped.slice(0, lastSlash + 1)}${reference}`
}

/**
 * Whether a string is plausibly an IRI a reader meant as a reference. Used only
 * by the `L2.coercion-did-not-fire` heuristic, never to decide semantics.
 */
export function looksLikeIri(value: string): boolean {
  return isAbsoluteIri(value) && /^(https?|urn|did|ftp|mailto):/i.test(value)
}

const LANGUAGE_TAG = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/

export function isWellFormedLanguageTag(value: string): boolean {
  return LANGUAGE_TAG.test(value)
}
