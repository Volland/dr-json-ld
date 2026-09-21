## MODIFIED Requirements

### Requirement: Model file structure

A model SHALL be a YAML file declaring a format version, a namespace, a processing
mode, and the terms it defines. It MAY declare prefixes, referenced contexts,
examples, views and shapes. It MAY declare the project it belongs to and the version policy it follows.
The system SHALL publish a JSON Schema for model files at a stable URL so that
structural errors are reported in any editor that fetches it, without invoking the
modeler and without the extension installed. Accepting `shapes` SHALL NOT change the
format version, because it only widens what the schema accepts.

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

#### Scenario: Every model valid before stays valid

- **WHEN** a model file that validated against the format 1 schema before this change is validated again
- **THEN** it still validates

#### Scenario: A structural error in a shape

- **WHEN** a field declares `min: -1`
- **THEN** the editor reports a structural error on that line

### Requirement: Terms are a flat map

A model SHALL declare its top-level terms as a flat map from JSON key to term
definition. A term's `@context`, when it is a map, SHALL be a flat map of scoped terms
that apply below that term. A term SHALL NOT be declared as belonging to a class. A key
SHALL be unique within one map. The same key MAY appear in two maps, and then it
names two terms.

#### Scenario: One key means one thing

- **WHEN** a model declares the term `author` and no scoped context redefines it
- **THEN** that definition governs every occurrence of `author` in any document
- **AND** the emitted context contains exactly one entry for it

#### Scenario: Duplicate key

- **WHEN** a model declares the same term key twice in one map
- **THEN** validation reports a duplicate-key error at the second declaration

#### Scenario: The same key in a scoped context

- **WHEN** the model declares a top-level `name` and the term `publisher` carries a scoped `name`
- **THEN** the IR records two terms with distinct element ids
- **AND** the scoped one records `publisher` as the term whose context holds it

### Requirement: Full JSON-LD 1.1 facet coverage

A term definition SHALL be able to express every JSON-LD 1.1 facet: `@id`, `@type`,
`@container`, `@language`, `@direction`, `@protected`, `@context`, `@nest`,
`@reverse`, `@prefix` and `@index`. A scoped term SHALL be able to express the same
facets as a top-level term, including its own `@context`, to any depth. A model SHALL additionally provide a per-term raw
escape hatch for any construct the metamodel has not yet given a name.

#### Scenario: A facet the canvas has no control for

- **WHEN** a model declares a term carrying `@propagate` through the raw escape hatch
- **THEN** the model resolves and the facet reaches the emitted context unchanged
- **AND** the term is still selectable on the canvas

#### Scenario: Scoped context on a term

- **WHEN** a term declares its own `@context` as a map
- **THEN** the resolved IR records each term definition in it as a scoped term, with its own element id and facets
- **AND** records the map's keyword entries (`@vocab`, `@base`, `@language`, `@direction`, `@propagate`, `@protected`, `@import`, `@version`) as settings of that scoped context rather than as terms

#### Scenario: A scoped context given by reference

- **WHEN** a term declares its `@context` as an IRI or as an array
- **THEN** the IR records it as a referenced scoped context, exactly as before this change

#### Scenario: Shorthand scoped term

- **WHEN** a scoped context maps `name` to the string `https://schema.org/legalName`
- **THEN** the IR records a scoped term `name` whose `@id` is that IRI

### Requirement: Every element carries a stable identity

A term — top-level or scoped — a shape and an example SHALL each carry a short element
id, unique across the model. The system SHALL backfill ids into the model file as a
targeted edit. An element whose id is absent SHALL resolve with an id derived from its
key and, for a scoped term, the keys of the terms enclosing it. The IR SHALL record
which of the two it was.

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

#### Scenario: Backfilling a shorthand scoped term

- **WHEN** ids are backfilled into a scoped term written as a plain IRI string
- **THEN** that entry becomes a mapping carrying the id and the same IRI as `@id`
- **AND** the emitted context is unchanged

#### Scenario: A duplicate element id

- **WHEN** a scoped term carries the same element id as a top-level term
- **THEN** validation reports a duplicate-id error at the second declaration

### Requirement: Model resolves into a stably ordered IR

Resolution SHALL produce an IR whose arrays are ordered by element id and whose object
keys are sorted, so that a canonical snapshot can be taken without changing the IR.
Scoped terms SHALL be ordered by element id within their scoped context. A shape's
fields SHALL be ordered by the element id of the term each resolves to.

#### Scenario: Reordering declarations changes nothing

- **WHEN** terms are reordered in the model file with no other change
- **THEN** the serialized IR is byte-identical to the one produced before

#### Scenario: Reordering shapes and fields changes nothing

- **WHEN** shapes, or the fields within a shape, are reordered in the model file with no other change
- **THEN** the serialized IR is byte-identical to the one produced before
