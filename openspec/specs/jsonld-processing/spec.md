## Purpose

Defines the JSON-LD processor this project implements: expansion and compaction that
carry provenance from every output back to the input that produced it, the trace that
explains a run, and how conformance is observed rather than asserted.

## Requirements

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

### Requirement: Every expansion output carries a source pointer

Expansion SHALL associate every produced node, every value, and every dropped key with
a JSON Pointer identifying the input that produced it. The system SHALL resolve a
pointer to a line and column in the file the user edited.

#### Scenario: A dropped key can be located

- **WHEN** a document contains a key that maps to no term and expands to nothing
- **THEN** the system reports its JSON Pointer
- **AND** resolves that pointer to the line and column of the key in the source file

#### Scenario: A pointer under nesting

- **WHEN** a value is reached through `@nest` and a type-scoped context
- **THEN** its pointer identifies the original key in the input document

#### Scenario: Pointers always resolve

- **WHEN** any document is expanded
- **THEN** every pointer produced resolves to a node that exists in that document

### Requirement: The public expansion result is plain JSON-LD

The system SHALL expose an expansion result stripped of provenance, equal to what a
conformant processor returns.

#### Scenario: Provenance does not leak into output

- **WHEN** a document is expanded through the public interface
- **THEN** the result contains no pointer, envelope or tool-specific key

### Requirement: Traced mode records the algorithm's steps

The system SHALL offer an opt-in traced expansion producing an ordered record of term
lookups, IRI resolutions, active-context changes, value coercions and dropped keys.
Tracing SHALL be off by default.

#### Scenario: Explaining a scoped context

- **WHEN** a document that uses a property-scoped context is expanded with tracing on
- **THEN** the trace records the active-context change at the point it takes effect
- **AND** records where it ceases to apply

#### Scenario: Tracing does not change results

- **WHEN** the same document is expanded with tracing on and with tracing off
- **THEN** both produce identical output

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

### Requirement: Output is compared against a reference implementation

Every in-scope suite case SHALL additionally be processed by an independent JSON-LD
implementation and the two outputs compared. A divergence SHALL be resolved and
recorded, not tolerated.

#### Scenario: A divergence from the reference implementation

- **WHEN** this system and the reference implementation produce different output for a case
- **THEN** the test fails
- **AND** the case cannot be marked resolved until the finding is recorded

### Requirement: Round trips are stable

Expanding, compacting and expanding again SHALL reach a fixed point.

#### Scenario: Fixed point over examples

- **WHEN** each example document is expanded, compacted against its model's context,
  and expanded again
- **THEN** the second expansion equals the first

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
