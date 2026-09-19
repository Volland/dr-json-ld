## Purpose

Defines what it means to validate a document against a context: a ladder of levels
answering different questions, the shape of a finding, and the reporting of what a
document silently lost — which no other level detects and which a successful
expansion conceals.

## ADDED Requirements

### Requirement: Validation is a ladder of levels

The system SHALL report findings at levels L0 (well-formedness), L1 (context errors)
and L2 (lossiness and coverage). A command SHALL name the highest level it runs. Each
finding SHALL record the level that produced it.

#### Scenario: Running a lower level

- **WHEN** a document is checked at L1
- **THEN** no L2 finding is reported
- **AND** the output states the level that was run

#### Scenario: Levels above this change

- **WHEN** a command is asked to run L3
- **THEN** it reports that the level is not available rather than reporting conformance

### Requirement: A finding carries a rule id and a location

Every finding SHALL carry a stable rule id, a level, a severity, a message, a JSON
Pointer, and a resolved line and column. Rule ids SHALL be unique and SHALL NOT be
reused for a different meaning.

#### Scenario: Every finding is locatable

- **WHEN** any finding is produced at any level
- **THEN** it carries a pointer that resolves to a position in a file the user wrote

#### Scenario: Message wording is not an interface

- **WHEN** a finding's message text changes
- **THEN** its rule id is unchanged
- **AND** examples requiring that rule id still pass

### Requirement: Findings are deterministically ordered

The set and order of findings SHALL depend only on the document and the model, not on
iteration order.

#### Scenario: Reordering document keys

- **WHEN** the same document is validated twice with its object keys in different order
- **THEN** the same findings are produced in the same order

### Requirement: Context errors are located in the model

L1 SHALL report errors the specification defines for a context — invalid term
definitions, cyclic IRI mappings, invalid container values, and redefinitions that
violate an upstream protected term — at the responsible term in the model file.

#### Scenario: An invalid container value

- **WHEN** a term declares a container value the specification does not allow
- **THEN** an L1 finding is reported at that term in the model file
- **AND** not at a position in a generated artifact

#### Scenario: Violating an upstream protected term

- **WHEN** a model redefines a term that a referenced context declares protected
- **THEN** an L1 finding is reported at the redefining term
- **AND** the finding names the referenced context that protects it

### Requirement: Lossiness is reported

L2 SHALL report what a document lost in expansion: keys that expanded to nothing, IRIs
left relative, blank nodes minted where an identifier was expected, and values whose
declared coercion did not apply.

#### Scenario: A document that silently empties

- **WHEN** a document's keys map to no term and expansion produces an empty result
- **THEN** expansion still succeeds
- **AND** an L2 finding is reported for every dropped key at its own position

#### Scenario: A relation left uncoerced

- **WHEN** a term without `@type: @id` carries a value that is an IRI string
- **THEN** an L2 finding reports that the value expanded as a literal rather than a reference

#### Scenario: Dropped under `@vocab` versus dropped outright

- **WHEN** a key is dropped in a model that declares `@vocab` and in one that does not
- **THEN** the two cases produce distinguishable findings

### Requirement: Coverage is reported at a lower severity

L2 SHALL report terms a model defines that no example uses, at a severity below that
of a lossiness finding.

#### Scenario: An unused term

- **WHEN** a model defines a term no example document uses
- **THEN** a coverage finding is reported
- **AND** it does not by itself cause a check to fail

### Requirement: Examples are validated against their declared outcomes

Checking a model SHALL validate every declared example and compare the findings to the
outcome the model declares for it.

#### Scenario: A negative example raising the wrong rule

- **WHEN** a negative example declares one rule id and validation raises a different one
- **THEN** the check fails and reports both

#### Scenario: Examples run without an editor

- **WHEN** the CLI checks a model in continuous integration
- **THEN** every example is validated with no editor present and no network access
