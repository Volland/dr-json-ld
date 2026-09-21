## Purpose

Defines the shapes layer of a model: class-level structure — which terms a class uses, how many values each takes, what those values must be, and whether the class is closed. None of this can be expressed in a `@context`.

## Requirements

### Requirement: A model may declare shapes

A model MAY declare a `shapes` map from shape name to shape. Each shape SHALL carry an element id. It MAY declare a target class, `closed` (default `false`), a `note`, and a `fields` map. A target class SHALL be given as a term key or as a compact or absolute IRI. A shape without a target class SHALL apply only where a field's range names it, which is how an untyped nested node — a credential's subject — is described. A model that declares no shapes SHALL resolve, emit and validate exactly as it did before the shapes layer existed.

#### Scenario: A credential shape

- **WHEN** a model declares a shape `Credential` targeting the term `VerifiableCredential`, with fields `issuer`, `validFrom` and `credentialSubject`
- **THEN** the model resolves
- **AND** the IR records one shape with that target class IRI and three fields

#### Scenario: A shape for an untyped nested node

- **WHEN** a shape `DegreeSubject` declares no target class and is named only by the range of `credentialSubject`
- **THEN** the model resolves without a finding about it
- **AND** its fields resolve in the model's context, with no type-scoped context applied

#### Scenario: A model without shapes is unchanged

- **WHEN** a model that declares no `shapes` is resolved and emitted to the `context` target
- **THEN** the IR records no shapes
- **AND** no finding is raised about shapes

### Requirement: A field states cardinality and range

Each field SHALL be keyed by the JSON key a document uses under the target class. A field MAY state `min` (a non-negative integer, default 0), `max` (a positive integer, default unbounded) and `range`. A range SHALL be one of:

- `iri`: an IRI node
- `node`: an IRI or blank node
- `literal`: any literal
- `langString`: a language-tagged string
- a datatype, as a compact or absolute IRI
- `{ class: <term key or IRI> }`: a node typed with that class
- `{ shape: <shape name> }`: a node conforming to another shape in the model

A field without a range SHALL constrain only cardinality.

#### Scenario: A required single value

- **WHEN** a field declares `min: 1` and `max: 1`
- **THEN** the IR records exactly-one cardinality for that field

#### Scenario: A nested shape

- **WHEN** the field `credentialSubject` declares `range: { shape: DegreeSubject }`
- **THEN** the IR records a reference from that field to the shape `DegreeSubject` by its element id

#### Scenario: Minimum above maximum

- **WHEN** a field declares `min: 2` and `max: 1`
- **THEN** validation reports `L1.shape-cardinality-invalid` at that field

### Requirement: Shapes own cardinality, terms own coercion

A field SHALL NOT change how a key's values are coerced. Coercion (`@type`, `@container`, `@language`, `@direction`) SHALL remain on the term. A field's range SHALL be consistent with the coercion of the term its key resolves to. Two shapes MAY state different cardinalities for one term.

#### Scenario: Two classes disagree on cardinality

- **WHEN** shape `A` declares `name` with `max: 1` and shape `B` declares `name` with no maximum
- **THEN** the model resolves without a finding about `name`
- **AND** the emitted context contains one unchanged entry for `name`

#### Scenario: A range that contradicts the coercion

- **WHEN** a field declares `range: xsd:dateTime` and its key resolves to a term coerced with `@type: @id`
- **THEN** validation reports `L1.shape-range-coercion-conflict` at the field, naming both the range and the coercion

#### Scenario: A language map with a plain string range

- **WHEN** a field declares `range: xsd:string` and its key resolves to a term with `@container: @language`
- **THEN** validation reports `L1.shape-range-coercion-conflict`
- **AND** the message states that the values will be `langString`

#### Scenario: A reference range without reference coercion

- **WHEN** a field declares a `class`, `shape`, `iri` or `node` range and its term carries no `@type: @id` or `@type: @vocab`
- **THEN** validation reports `L1.shape-range-needs-id-coercion` at warning severity
- **AND** the message states that a string value under that key becomes a literal, not a reference

### Requirement: A field key resolves as a processor would

A field key SHALL resolve in the active context a processor would apply to a node of the target class. The target class term's type-scoped terms come first, then the model's own terms, then referenced contexts. A field SHALL denote the IRI the resolved term maps to. For a `@reverse` term, the field SHALL constrain the inverse property.

#### Scenario: A type-scoped term wins

- **WHEN** the term `VerifiableCredential` carries a scoped term `name` mapped to `cred:name`, the model's top-level `name` maps to `schema:name`, and a shape targeting `VerifiableCredential` declares a field `name`
- **THEN** that field constrains `cred:name`

#### Scenario: An unresolvable key

- **WHEN** a field key resolves to no term and no `@vocab` applies
- **THEN** validation reports `L1.shape-field-unresolved` at the field

#### Scenario: A nest key is not a property

- **WHEN** a field key resolves to a term whose `@id` is `@nest`
- **THEN** validation reports `L1.shape-field-is-nest` at the field

#### Scenario: A shape reached through a property-scoped context

- **WHEN** shape `S` is the range of a field whose term carries a scoped term that redefines one of `S`'s field keys
- **THEN** validation reports `L1.shape-field-ambiguous` at that field of `S`
- **AND** the message names both IRIs the key denotes and the field through which `S` was reached

### Requirement: References within the shapes layer resolve

Every class and shape a shape names SHALL resolve.

#### Scenario: An unknown target class

- **WHEN** a shape's target class is neither a term key nor an IRI whose prefix is declared
- **THEN** validation reports `L1.shape-unknown-target` at the shape

#### Scenario: An unknown class in a range

- **WHEN** a field declares `range: { class: Missing }` and `Missing` is neither a term key nor an IRI whose prefix is declared
- **THEN** validation reports `L1.shape-unknown-class` at the field's range

#### Scenario: An unknown shape in a range

- **WHEN** a field declares `range: { shape: Missing }` and no shape of that name exists
- **THEN** validation reports `L1.shape-unknown-shape` at the field

#### Scenario: A recursive shape

- **WHEN** shape `Person` has a field `knows` whose range is `{ shape: Person }`
- **THEN** the model resolves without a finding

### Requirement: A view may include shapes

A view MAY list shapes by name in addition to terms. A shape SHALL be shown in a view that lists it. A shape that appears in no view SHALL be reported so that it cannot be invisible.

#### Scenario: A shape that no view lists

- **WHEN** a model declares a shape that no view lists and the model declares at least one view
- **THEN** validation reports `L2.shape-unused-in-view` at info severity
