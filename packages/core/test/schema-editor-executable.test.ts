/**
 * A schema constraint is only an *earlier* report of a fact if the editor
 * evaluates it while the user types. A constraint written with a keyword the
 * editor's schema execution ignores is not an earlier report of anything: it
 * fails the command and stays silent in the file, which is the failure mode this
 * whole change exists to remove.
 *
 * The check is an allowlist rather than a denylist. The editor's coverage of
 * 2020-12 is near-total, so listing *unsupported* keywords would assert almost
 * nothing; asking instead whether a keyword has ever been verified catches the
 * one that gets added later without anybody checking.
 *
 * @lat: [[architecture#Architecture#Surface Syntax#Reaching the editor]]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCHEMAS = ['model.schema.json', 'project.schema.json']

const corePath = (file: string): string =>
  fileURLToPath(new URL(`../schema/${file}`, import.meta.url))

/**
 * Verified 2026-09-20 against `redhat-developer/yaml-language-server@main` —
 * `src/languageservice/parser/schemaValidation/`, which is what
 * `redhat.vscode-yaml` runs. `baseValidator.ts` evaluates each of these;
 * `draft2019Validator.ts` and `draft2020Validator.ts` add the 2019/2020 keywords.
 *
 * To add a keyword here, read that source and confirm it is evaluated. Do not
 * add one because a validator in a test (Ajv) accepts it — Ajv is not what the
 * user's editor runs.
 */
const VERIFIED_EXECUTABLE = new Set([
  // structural
  'type', 'properties', 'required', 'additionalProperties', 'patternProperties',
  'items', 'prefixItems', 'propertyNames', 'minProperties', 'maxProperties',
  'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
  // value
  'const', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum',
  'format', 'multipleOf',
  // composition
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'dependentSchemas', 'dependentRequired', 'dependencies',
  'unevaluatedProperties', 'unevaluatedItems',
  // references and annotations (annotations are not evaluated, but carry no
  // constraint, so they cannot hide a refusal)
  '$ref', '$defs', '$id', '$schema', '$anchor', '$dynamicRef', '$dynamicAnchor',
  'title', 'description', 'default', 'examples', 'deprecated', 'readOnly',
])

/**
 * A keyword verified as NOT evaluated by the editor, paired with the rule id
 * that reports the same fact when the command runs. Empty, and expected to stay
 * empty: every constraint in both schemas is executable.
 *
 * @lat: [[architecture#Architecture#Surface Syntax#Reaching the editor]]
 */
const COMMAND_ONLY: Array<{ keyword: string; reportedBy: string; why: string }> = []

/** Every keyword appearing in a schema position, ignoring object keys that are data. */
function keywordsUsed(node: unknown, inValuePosition = false): Set<string> {
  const found = new Set<string>()
  if (Array.isArray(node)) {
    for (const child of node) for (const k of keywordsUsed(child)) found.add(k)
    return found
  }
  if (!node || typeof node !== 'object') return found

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!inValuePosition) found.add(key)
    // These hold arbitrary author-chosen names, not keywords, so recurse into
    // their values while treating their own keys as data.
    if (key === 'properties' || key === '$defs' || key === 'patternProperties') {
      for (const sub of Object.values(value as Record<string, unknown>)) {
        for (const k of keywordsUsed(sub)) found.add(k)
      }
      continue
    }
    // `enum`, `const`, `default`, `examples` hold data, never subschemas.
    if (['enum', 'const', 'default', 'examples', 'required'].includes(key)) continue
    for (const k of keywordsUsed(value)) found.add(k)
  }
  return found
}

describe('every schema constraint is executable by the editor', () => {
  it.each(SCHEMAS)('%s uses only keywords verified to run in the editor', (file) => {
    const schema = JSON.parse(readFileSync(corePath(file), 'utf8'))
    const recorded = new Set(COMMAND_ONLY.map((c) => c.keyword))
    const unverified = [...keywordsUsed(schema)].filter(
      (k) => !VERIFIED_EXECUTABLE.has(k) && !recorded.has(k),
    )
    expect(
      unverified.sort(),
      `${file} uses ${unverified.join(', ')}, which nobody has verified the editor evaluates. ` +
        `Read yaml-language-server's schemaValidation source, then either add the keyword to ` +
        `VERIFIED_EXECUTABLE or record it in COMMAND_ONLY with the rule id that reports it.`,
    ).toEqual([])
  })

  it('every command-only keyword names the rule that reports it instead', () => {
    for (const entry of COMMAND_ONLY) {
      expect(entry.reportedBy, `${entry.keyword} must name a rule id`).toMatch(/^L[0-4]\./)
      expect(entry.why.length, `${entry.keyword} must say why`).toBeGreaterThan(0)
    }
  })

  /**
   * The key shape lives in `patternProperties` because that is the form the
   * editor evaluates, and in `$defs` because that is what the reference page
   * documents. This is what stops the two drifting apart.
   */
  it('each keyed map’s pattern matches the $defs entry documenting it', () => {
    const model = JSON.parse(readFileSync(corePath('model.schema.json'), 'utf8'))
    const project = JSON.parse(readFileSync(corePath('project.schema.json'), 'utf8'))
    const pairs: Array<[string, Record<string, unknown>, string]> = [
      ['prefixes', model.properties.prefixes, model.$defs.prefixName.pattern],
      ['terms', model.properties.terms, model.$defs.termKey.pattern],
      ['models', project.properties.models, project.$defs.modelName.pattern],
    ]
    for (const [name, node, documented] of pairs) {
      const patterns = Object.keys(node.patternProperties as Record<string, unknown>)
      expect(patterns, `${name} should constrain its keys with exactly one pattern`).toHaveLength(1)
      expect(patterns[0], `${name}'s key pattern and its $defs entry have drifted`).toBe(documented)
    }
  })
})
