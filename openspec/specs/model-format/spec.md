## Purpose

Defines the model file: what a model may declare about a JSON-LD vocabulary, how it
references contexts it does not own, and how it resolves into the intermediate
representation that the canvas, validation and every emitter are derived from.

## Requirements

### Requirement: Model file structure

A model SHALL be a YAML file declaring a format version, a namespace, a processing
mode, and the terms it defines. It MAY declare prefixes, referenced contexts and
examples. It MAY declare the project it belongs to and the version policy it follows.
The system SHALL publish a JSON Schema for model files at a stable URL so that
structural errors are reported in any editor that fetches it, without invoking the
modeler and without the extension installed.

#### Scenario: Structural error in a model file

- **WHEN** a model file declares a term whose definition is a number
- **THEN** the editor reports a structural error on that line
- **AND** the modeler reports the same file as invalid rather than rendering it

#### Scenario: Namespace is required

- **WHEN** a model file omits its namespace declaration
- **THEN** validation reports an error identifying the file
- **AND** no artifact is generated for that model

#### Scenario: Schema is identical in both packages

- **WHEN** the published JSON Schema and the copy contributed to the editor are compared
- **THEN** they are byte-identical

#### Scenario: Schema is reachable without the extension

- **WHEN** a model file is opened in an editor that fetches the schema from its published URL
- **THEN** the same structural errors are reported as in the extension

#### Scenario: A model naming a project that does not declare it

- **WHEN** a model names a project whose project file does not list that model
- **THEN** validation reports an error naming both the model and the project

#### Scenario: A model outside any project

- **WHEN** a model declares no project and no project file encloses it
- **THEN** the model resolves, emits and validates exactly as it does today

### Requirement: Terms are a flat map

A model SHALL declare terms as a flat map from JSON key to term definition. A term
SHALL NOT be declared as belonging to a class.

#### Scenario: One key means one thing

- **WHEN** a model declares the term `author`
- **THEN** that definition governs every occurrence of `author` in any document
- **AND** the emitted context contains exactly one entry for it

#### Scenario: Duplicate key

- **WHEN** a model declares the same term key twice
- **THEN** validation reports a duplicate-key error at the second declaration

### Requirement: Full JSON-LD 1.1 facet coverage

A term definition SHALL be able to express every JSON-LD 1.1 facet: `@id`, `@type`,
`@container`, `@language`, `@direction`, `@protected`, `@context`, `@nest`,
`@reverse`, `@prefix` and `@index`. A model SHALL additionally provide a per-term raw
escape hatch for any construct the metamodel has not yet given a name.

#### Scenario: A facet the canvas has no control for

- **WHEN** a model declares a term carrying `@propagate` through the raw escape hatch
- **THEN** the model resolves and the facet reaches the emitted context unchanged
- **AND** the term is still selectable on the canvas

#### Scenario: Scoped context on a term

- **WHEN** a term declares its own `@context`
- **THEN** the resolved IR records it as a scoped context attached to that term

### Requirement: Processing mode is declared by the model

A model SHALL declare whether it targets JSON-LD 1.1 or 1.0. The mode SHALL be a
property of the model file and SHALL NOT be a flag on a command.

#### Scenario: A 1.1-only facet under a 1.0 target

- **WHEN** a model declaring mode 1.0 uses `@protected` on a term
- **THEN** validation reports a downgrade diagnostic on that term
- **AND** the diagnostic states what a 1.0 processor does with it instead

#### Scenario: Mode does not change with the command

- **WHEN** the same model is checked by the CLI and by the extension
- **THEN** both report the same set of mode-related diagnostics

### Requirement: Referenced contexts are recorded with an integrity hash

A model MAY declare contexts it builds on by IRI. Each SHALL carry the integrity hash
of the vendored copy it was resolved against.

#### Scenario: A referenced context without a hash

- **WHEN** a model declares a referenced context that has never been vendored
- **THEN** validation reports that it must be vendored before the model can be used
- **AND** no command attempts to fetch it

### Requirement: Every element carries a stable identity

A term and an example SHALL each carry a short element id. The system SHALL backfill
ids into the model file as a targeted edit. An element whose id is absent SHALL
resolve with an id derived from its key, and the IR SHALL record which of the two it
was.

#### Scenario: Renaming a term preserves its identity

- **WHEN** a term's JSON key is changed and its element id is not
- **THEN** the IR reports one term whose key changed, not a removal and an addition
- **AND** its position on any diagram is unchanged

#### Scenario: Backfilling preserves the rest of the file

- **WHEN** ids are backfilled into a model file containing comments
- **THEN** every comment remains in place
- **AND** the only textual change is the added ids

#### Scenario: Derived ids are recorded as such

- **WHEN** a model with no ids at all is resolved
- **THEN** every element resolves with a derived id
- **AND** the IR marks each as derived rather than written

### Requirement: Examples are declared with expected outcomes

A model MAY declare example documents by path. Each SHALL record the outcome that
validating it must produce. A negative example SHALL name the rule ids it must raise.

#### Scenario: A positive example that regresses

- **WHEN** a model changes so that a positive example now raises an error finding
- **THEN** checking the model fails and names the example and the finding

#### Scenario: A negative example that fails for the wrong reason

- **WHEN** a negative example raises findings but not the rule ids it declared
- **THEN** checking the model fails and reports the expected and actual rule ids

### Requirement: Model resolves into a stably ordered IR

Resolution SHALL produce an IR whose arrays are ordered by element id and whose object
keys are sorted, so that a canonical snapshot can be taken without changing the IR.

#### Scenario: Reordering declarations changes nothing

- **WHEN** terms are reordered in the model file with no other change
- **THEN** the serialized IR is byte-identical to the one produced before

### Requirement: The schema refuses illegal facet combinations

The model schema SHALL reject a term definition whose facets cannot occur together in
JSON-LD, rather than accepting it structurally and leaving it to validation. It SHALL
reject a `@container` value that is not a legal container mapping or combination; a
`@reverse` term carrying a `@container` other than `@set` or `@index`; and a
`@reverse` term carrying `@id` or `@nest`.

The schema SHALL NOT reject a facet combination JSON-LD permits, even where the
combination is a likely mistake. A term carrying both `@language` and a `@type`
coercion is legal — the language is ignored — and SHALL be accepted. A model
declaring `mode: "1.0"` and using a facet JSON-LD 1.1 introduced SHALL be accepted,
because per locked decision 5 that is a downgrade reported as `L1.facet-not-in-mode`
at warning severity, not an illegal model.

#### Scenario: An impossible container combination

- **WHEN** a model declares a term whose `@container` combines mappings JSON-LD does not permit together
- **THEN** the editor reports a structural error on that term
- **AND** validation reports `L1.invalid-container-mapping` at the same term

#### Scenario: A reverse term carrying an illegal container

- **WHEN** a model declares a term with `@reverse` and a `@container` other than `@set` or `@index`
- **THEN** the editor reports a structural error on that term
- **AND** validation reports `L1.invalid-reverse-property` at the same term

#### Scenario: A reverse term carrying an id or a nest

- **WHEN** a model declares a term with `@reverse` and either `@id` or `@nest`
- **THEN** the editor reports a structural error on that term
- **AND** validation reports `L1.invalid-reverse-property` at the same term

#### Scenario: A language alongside a type coercion

- **WHEN** a model declares a term with both `@language` and a `@type` coercion
- **THEN** the schema accepts the term
- **AND** validation reports no error, because JSON-LD ignores the language rather than refusing the definition

#### Scenario: A 1.1 facet in a 1.0 model

- **WHEN** a model declaring `mode: "1.0"` uses a facet JSON-LD 1.0 does not define
- **THEN** the schema accepts the model
- **AND** validation reports `L1.facet-not-in-mode` at warning severity
- **AND** `ldm check` exits cleanly, because a downgrade is not a failure

#### Scenario: A facet reached through the raw escape hatch

- **WHEN** a term carries a facet through the per-term raw escape hatch
- **THEN** the schema does not reject it on the grounds of the co-constraints above
- **AND** the facet reaches the emitted `context` target unchanged

### Requirement: The schema and validation agree on what a model may say

Every model file the schema rejects SHALL also be reported by validation as an error
carrying a named rule id, and every model file validation accepts without an error
SHALL be accepted by the schema. The schema SHALL be the earlier report of the same
fact, never a second and different opinion. A finding at warning severity SHALL NOT
correspond to a schema rejection, because a warning names a model the tool accepts.

Earlier means *while the user types*. A refusal the editor's schema execution does not
evaluate is therefore not an earlier report of anything, and SHALL either be expressed
in a form the editor evaluates or be recorded as command-only against the rule id that
reports it.

#### Scenario: The schema rejects what validation accepts

- **WHEN** a model file is rejected by the schema and validation reports no error
- **THEN** the build fails naming the model file and the constraint that rejected it

#### Scenario: Validation rejects what the schema accepts

- **WHEN** a model file is accepted by the schema and validation reports a co-constraint error
- **THEN** the build fails naming the model file and the rule id

#### Scenario: A downgrade is not a rejection

- **WHEN** a model file produces only findings at warning severity
- **THEN** the schema accepts it
- **AND** the build does not fail

#### Scenario: A schema rejection is also a finding

- **WHEN** a model file violating a facet co-constraint is checked
- **THEN** validation reports the specific L1 rule for that constraint at error severity

#### Scenario: A refusal the editor never evaluates

- **WHEN** the schema refuses a model file only through a construct the editor's schema execution ignores
- **THEN** the build fails unless that refusal is recorded as command-only
- **AND** the record names the rule id validation reports it under

