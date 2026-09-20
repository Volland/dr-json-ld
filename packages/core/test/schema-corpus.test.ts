/**
 * The published JSON Schema, executed rather than read.
 *
 * A schema is only as good as what it refuses, and "additionalProperties: false"
 * everywhere makes a schema look stricter than it is. This corpus is the
 * evidence: every file under `accept/` must validate, every file under
 * `reject/` must not, and a reject case names the constraint it violates so
 * that a file failing for an unrelated reason cannot be mistaken for a passing
 * test.
 *
 * @lat: [[architecture#Architecture#Surface Syntax#What the schema refuses]]
 */
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const CORPUS = fileURLToPath(new URL('./fixtures/schema/', import.meta.url))
const SCHEMA = fileURLToPath(new URL('../schema/model.schema.json', import.meta.url))

/**
 * A reject case declares the `$defs` entry that must refuse it, on the first
 * line: `# reject: reverseContainerFacet`. Without it a case could pass by
 * violating something else entirely — a typo in a term key, say — and would go
 * on passing after the constraint it was written for had been deleted.
 */
const DECLARED = /^#\s*reject:\s*(\S+)/

const document = JSON.parse(readFileSync(SCHEMA, 'utf8')) as { $id: string }

function compiler(): Ajv2020 {
  return new Ajv2020({ strict: false, allErrors: true })
}

export function loadSchema(): ValidateFunction {
  return compiler().compile(document)
}

/**
 * Ajv reports `schemaPath` relative to whatever subschema a `$ref` resolved to,
 * so a failure inside `#/$defs/term` arrives as `#/additionalProperties` with
 * the name gone. Blame is therefore established by resolving the named entry
 * and running it directly, rather than by reading it out of an error.
 */
function namedConstraint(name: string): ValidateFunction | undefined {
  const ajv = compiler()
  ajv.addSchema(document)
  return ajv.getSchema(`${document.$id}#/$defs/${name}`)
}

/** The values a term-level or root-level constraint could be blaming. */
function candidates(model: unknown): unknown[] {
  const terms = (model as { terms?: Record<string, unknown> } | null)?.terms
  return [model, ...(terms && typeof terms === 'object' ? Object.values(terms) : [])]
}

describe('the model schema, executed against a corpus', () => {
  const validate = loadSchema()

  function cases(kind: 'accept' | 'reject'): Array<{ name: string; file: string }> {
    return readdirSync(`${CORPUS}${kind}`)
      .filter((f) => f.endsWith('.jsonld.yaml'))
      .sort()
      .map((name) => ({ name, file: `${CORPUS}${kind}/${name}` }))
  }

  // @lat: [[architecture#Architecture#Surface Syntax#What the schema refuses]]
  it.each(cases('accept'))('accepts $name', ({ file }) => {
    const model = parse(readFileSync(file, 'utf8'))
    const ok = validate(model)
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true)
  })

  it.each(cases('reject'))('rejects $name', ({ file }) => {
    const text = readFileSync(file, 'utf8')
    const declared = DECLARED.exec(text)?.[1]
    expect(declared, `${file} must declare the constraint it violates`).toBeDefined()

    const model = parse(text)
    expect(validate(model), 'the schema accepted a file the corpus says it must refuse').toBe(false)

    const constraint = namedConstraint(declared!)
    expect(constraint, `#/$defs/${declared} is not in the schema`).toBeDefined()
    expect(
      candidates(model).some((value) => !constraint!(value)),
      `nothing in ${file} violates #/$defs/${declared}, so this case is passing for the wrong reason`,
    ).toBe(true)
  })

  it('every fixture model the tool ships is in the accept corpus', () => {
    // A constraint that rejects a model this repository authored is a wrong
    // constraint, not a wrong model. Checking the real fixtures here means that
    // verdict arrives with the schema change rather than after it.
    const models = fileURLToPath(new URL('./fixtures/models/', import.meta.url))
    const shipped = readdirSync(models).filter((f) => f.endsWith('.jsonld.yaml'))
    expect(shipped.length).toBeGreaterThan(0)
    for (const name of shipped) {
      const ok = validate(parse(readFileSync(`${models}${name}`, 'utf8')))
      expect(ok, `${name}: ${JSON.stringify(validate.errors, null, 2)}`).toBe(true)
    }
  })

  it('the corpus is not empty in either direction', () => {
    expect(cases('accept').length).toBeGreaterThan(0)
    expect(cases('reject').length).toBeGreaterThan(0)
  })

  /**
   * The escape hatch is exempt, and only the schema can say so: a model putting
   * illegal JSON-LD in `raw` is still refused by `ldm check`, so this cannot be
   * an accept-corpus case. The claim here is narrower and is the one that
   * matters for the editor — the co-constraints look at the facets the
   * metamodel names, and do not descend into `raw`.
   */
  it.each([
    ['containerCombination', { '@container': ['@graph', '@id', '@index'] }],
    ['reverseContainerFacet', { '@reverse': 'ex:childOf', '@container': '@language' }],
    ['reverseExclusiveFacet', { '@reverse': 'ex:childOf', '@id': 'ex:parentOf' }],
  ])('%s does not descend into raw', (name, smuggled) => {
    const constraint = namedConstraint(name)!
    // The same facets at term level are refused …
    expect(constraint({ '@id': 'ex:a', ...smuggled })).toBe(false)
    // … and are not the constraint's business one level down.
    expect(constraint({ '@id': 'ex:a', raw: smuggled })).toBe(true)
  })

  /**
   * Eight hand-written container cases prove the constraint fires. They do not
   * prove it fires on exactly the right set, and an over-strict schema refusing
   * a legal model is the worse failure — it is unreportable by the corpus,
   * because nobody writes a case for a combination they never tried.
   *
   * So every subset of the container values is checked against the resolver's
   * own answer. The schema is not allowed its own opinion about which is which.
   */
  it('agrees with the resolver on every container combination', () => {
    const constraint = namedConstraint('containerCombination')!
    const values = ['@list', '@set', '@index', '@id', '@type', '@language', '@graph'] as const
    const disagreed: string[] = []

    for (let mask = 1; mask < 1 << values.length; mask++) {
      const combination = values.filter((_, i) => mask & (1 << i))
      const bySchema = constraint({ '@id': 'ex:a', '@container': combination })
      const byResolver = isLegalContainerCombination(combination)
      if (bySchema !== byResolver) {
        disagreed.push(
          `${JSON.stringify(combination)}: schema ${bySchema ? 'accepts' : 'rejects'}, resolver ${byResolver ? 'accepts' : 'rejects'}`,
        )
      }
    }
    expect(disagreed).toEqual([])
  })
})

/**
 * The resolver's rule, restated here rather than imported: this test is the
 * place the two are compared, so reading one from the other would compare a
 * thing to itself. A change to `resolve.ts` that is not mirrored here fails
 * `validate.test.ts` instead, which is where that comparison belongs.
 */
function isLegalContainerCombination(values: readonly string[]): boolean {
  if (values.length <= 1) return true
  const set = new Set(values)
  const withoutSet = new Set(values.filter((v) => v !== '@set'))
  if (set.has('@list')) return false
  if (withoutSet.size <= 1) return true
  if (withoutSet.has('@graph') && withoutSet.size === 2) {
    return withoutSet.has('@id') || withoutSet.has('@index')
  }
  return false
}
