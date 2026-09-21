## MODIFIED Requirements

### Requirement: Expansion and compaction are implemented by this system

The system SHALL implement the JSON-LD 1.1 expansion and compaction algorithms and the
conversion of an expanded document to an RDF dataset. It SHALL delegate framing,
canonicalization and N-Quads serialization to existing implementations.

#### Scenario: Expansion of a document with a scoped context

- **WHEN** a document uses a type-scoped context that redefines a term
- **THEN** expansion applies the redefinition below the scope and not above it

#### Scenario: Container forms

- **WHEN** a document uses each of `@list`, `@set`, `@index`, `@id`, `@type`,
  `@language` and `@graph`
- **THEN** expansion produces the form the specification defines for each

#### Scenario: Converting a document to RDF

- **WHEN** a document is converted to RDF
- **THEN** the dataset contains the triples the JSON-LD 1.1 Deserialize JSON-LD to RDF algorithm defines for it

### Requirement: Conformance is measured against the W3C test suite

The system SHALL run the W3C JSON-LD 1.1 test suite for the expand, compact and toRdf
classes and for remote-context cases that require no network. Classes outside this change's
scope SHALL be reported as out of scope rather than skipped silently. Cases that do not
pass SHALL be listed with a reason. The toRdf class SHALL carry its own ratchet.

#### Scenario: Suite results are visible

- **WHEN** the conformance suite runs
- **THEN** the report names every failing case and the reason for each
- **AND** names the classes that are out of scope

#### Scenario: toRdf is compared after canonicalization

- **WHEN** a toRdf case is run
- **THEN** the produced dataset and the expected N-Quads are compared after canonicalization, so blank node labels do not decide the result

## ADDED Requirements

### Requirement: Every triple carries a source pointer

RDF conversion SHALL associate every triple with the JSON Pointer of the node object
that supplied its subject and of the key and value that supplied its predicate and
object. Blank node labels SHALL be assigned deterministically for a given input.

#### Scenario: Locating a triple

- **WHEN** a document is converted to RDF
- **THEN** every triple resolves to a line and column of the key that produced it

#### Scenario: A subject without a key of its own

- **WHEN** a triple's subject is a blank node for a node object that has no `@id`
- **THEN** the subject's pointer names that node object

#### Scenario: Stable blank nodes

- **WHEN** the same document is converted twice
- **THEN** both datasets use the same blank node labels
