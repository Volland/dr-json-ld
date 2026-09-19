/**
 * The rule-id registry. A rule id is what an example requires, what a
 * configuration downgrades, and what documentation explains — so a message can
 * be reworded without breaking any of them.
 *
 * Every id in this table is unique and is never reused for a different meaning.
 *
 * @lat: [[validation#Validation#Findings]]
 */
import type { Level, Severity } from './finding.js'

export interface RuleDefinition {
  id: string
  level: Level
  /** The severity a finding takes unless the call site deliberately lowers it. */
  severity: Severity
  /** One line, for the catalog and for `--help`-style listings. */
  summary: string
}

function def(
  id: string,
  level: Level,
  severity: Severity,
  summary: string,
): RuleDefinition {
  return { id, level, severity, summary }
}

export const RULES = {
  // ---- L0 well-formedness -------------------------------------------------
  'L0.unparseable': def('L0.unparseable', 'L0', 'error', 'The file is not valid YAML or JSON.'),
  'L0.not-an-object': def(
    'L0.not-an-object',
    'L0',
    'error',
    'The model file does not contain a mapping at its root.',
  ),
  'L0.schema-violation': def(
    'L0.schema-violation',
    'L0',
    'error',
    'The model does not satisfy the published model schema.',
  ),
  'L0.missing-namespace': def(
    'L0.missing-namespace',
    'L0',
    'error',
    'The model declares no namespace.',
  ),
  'L0.unknown-format-version': def(
    'L0.unknown-format-version',
    'L0',
    'error',
    'The model declares a format version this tool does not know.',
  ),
  'L0.duplicate-term-key': def(
    'L0.duplicate-term-key',
    'L0',
    'error',
    'The same term key is declared twice.',
  ),
  'L0.duplicate-element-id': def(
    'L0.duplicate-element-id',
    'L0',
    'error',
    'Two elements carry the same element id.',
  ),
  'L0.example-missing': def(
    'L0.example-missing',
    'L0',
    'error',
    'A declared example document does not exist at its path.',
  ),
  'L0.example-unparseable': def(
    'L0.example-unparseable',
    'L0',
    'error',
    'A declared example document is not valid JSON.',
  ),

  // ---- L0 project structure -----------------------------------------------
  'L0.project-missing-name': def(
    'L0.project-missing-name',
    'L0',
    'error',
    'The project declares no name.',
  ),
  'L0.project-no-models': def(
    'L0.project-no-models',
    'L0',
    'error',
    'The project declares no models.',
  ),
  'L0.project-model-missing': def(
    'L0.project-model-missing',
    'L0',
    'error',
    'A model the project declares does not exist at its path.',
  ),
  'L0.project-duplicate-model': def(
    'L0.project-duplicate-model',
    'L0',
    'error',
    'Two names in one project point at the same model file.',
  ),
  'L0.project-unknown-host': def(
    'L0.project-unknown-host',
    'L0',
    'error',
    'The project names a host this build does not know.',
  ),
  'L0.model-claimed-twice': def(
    'L0.model-claimed-twice',
    'L0',
    'error',
    'Two projects declare the same model.',
  ),
  'L0.model-project-mismatch': def(
    'L0.model-project-mismatch',
    'L0',
    'error',
    'A model names a project whose project file does not list it.',
  ),
  'L0.view-unknown-term': def(
    'L0.view-unknown-term',
    'L0',
    'error',
    'A view names a term its own model does not declare.',
  ),

  // ---- L1 context errors --------------------------------------------------
  'L1.unknown-prefix': def(
    'L1.unknown-prefix',
    'L1',
    'error',
    'A compact IRI uses a prefix the model does not declare.',
  ),
  'L1.malformed-iri': def('L1.malformed-iri', 'L1', 'error', 'An IRI is not well formed.'),
  'L1.invalid-container-mapping': def(
    'L1.invalid-container-mapping',
    'L1',
    'error',
    'A term declares a container value the specification does not allow.',
  ),
  'L1.cyclic-iri-mapping': def(
    'L1.cyclic-iri-mapping',
    'L1',
    'error',
    'A term definition resolves to itself.',
  ),
  'L1.invalid-term-definition': def(
    'L1.invalid-term-definition',
    'L1',
    'error',
    'A term definition is not legal JSON-LD.',
  ),
  'L1.invalid-type-mapping': def(
    'L1.invalid-type-mapping',
    'L1',
    'error',
    'A term declares a type coercion that is not an IRI or a recognised keyword.',
  ),
  'L1.invalid-language-mapping': def(
    'L1.invalid-language-mapping',
    'L1',
    'error',
    'A term declares a language that is not a well-formed language tag.',
  ),
  'L1.invalid-scoped-context': def(
    'L1.invalid-scoped-context',
    'L1',
    'error',
    'A term-scoped context is not a legal context.',
  ),
  'L1.invalid-reverse-property': def(
    'L1.invalid-reverse-property',
    'L1',
    'error',
    'A reverse property carries a facet it may not carry.',
  ),
  'L1.protected-term-redefinition': def(
    'L1.protected-term-redefinition',
    'L1',
    'error',
    'The model redefines a term a referenced context declares protected.',
  ),
  'L1.term-shadows-referenced-context': def(
    'L1.term-shadows-referenced-context',
    'L1',
    'warning',
    'The model defines a term a referenced context already defines differently.',
  ),
  'L1.facet-not-in-mode': def(
    'L1.facet-not-in-mode',
    'L1',
    'warning',
    'A facet defined only in JSON-LD 1.1 is used by a model targeting 1.0.',
  ),
  'L1.context-not-vendored': def(
    'L1.context-not-vendored',
    'L1',
    'error',
    'A referenced context has not been vendored.',
  ),
  'L1.context-hash-mismatch': def(
    'L1.context-hash-mismatch',
    'L1',
    'error',
    'A vendored context does not match the hash recorded in the model.',
  ),

  // ---- L2 lossiness and coverage -----------------------------------------
  'L2.key-dropped': def(
    'L2.key-dropped',
    'L2',
    'warning',
    'A key mapped to no term and expanded to nothing.',
  ),
  'L2.key-dropped-under-vocab': def(
    'L2.key-dropped-under-vocab',
    'L2',
    'warning',
    'A key mapped to no term in a model that declares @vocab, and expanded to an invented IRI.',
  ),
  'L2.relative-iri': def(
    'L2.relative-iri',
    'L2',
    'warning',
    'An IRI was left relative because no base resolved it.',
  ),
  'L2.blank-node-minted': def(
    'L2.blank-node-minted',
    'L2',
    'warning',
    'A blank node was minted where an identifier was expected.',
  ),
  'L2.coercion-did-not-fire': def(
    'L2.coercion-did-not-fire',
    'L2',
    'warning',
    'A value that looks like a reference expanded as a literal because no @type: @id applies.',
  ),
  'L2.term-unused': def(
    'L2.term-unused',
    'L2',
    'info',
    'The model defines a term no example document uses.',
  ),
  'L2.term-in-no-view': def(
    'L2.term-in-no-view',
    'L2',
    'info',
    'The model defines a term no view includes, so it cannot be seen on any diagram.',
  ),

  // ---- Emit downgrades ----------------------------------------------------
  'L1.downgrade-external-reference-forked': def(
    'L1.downgrade-external-reference-forked',
    'L1',
    'warning',
    'A target absorbed a referenced context, forking the upstream vocabulary.',
  ),
  'L1.downgrade-facet-unsupported': def(
    'L1.downgrade-facet-unsupported',
    'L1',
    'warning',
    'A target cannot carry a model fact.',
  ),

  // ---- Example outcomes ---------------------------------------------------
  'L0.example-outcome-unmet': def(
    'L0.example-outcome-unmet',
    'L0',
    'error',
    'A declared example did not produce the outcome the model records for it.',
  ),

  // ---- Import -------------------------------------------------------------
  'L1.import-not-recoverable': def(
    'L1.import-not-recoverable',
    'L1',
    'info',
    'A context structurally cannot carry a fact, so import did not invent one.',
  ),
} as const satisfies Record<string, RuleDefinition>

export type RuleId = keyof typeof RULES

export const RULE_IDS: readonly string[] = Object.keys(RULES)

export function isRegisteredRule(id: string): id is RuleId {
  return Object.prototype.hasOwnProperty.call(RULES, id)
}

export function ruleDefinition(id: RuleId): RuleDefinition {
  return RULES[id]
}
