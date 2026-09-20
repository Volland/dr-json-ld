## MODIFIED Requirements

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

## ADDED Requirements

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
- **AND** the finding carries a line and column into the model file
