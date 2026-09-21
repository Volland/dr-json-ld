## Purpose

Defines what it means to validate a document against a context: a ladder of levels
answering different questions, the shape of a finding, and the reporting of what a
document silently lost — which no other level detects and which a successful
expansion conceals.

## Requirements

### Requirement: Validation is a ladder of levels

The system SHALL report findings at levels L0 (well-formedness), L1 (context and model
errors), L2 (lossiness and coverage) and L3 (shape conformance). A command SHALL name
the highest level it runs. Each finding SHALL record the level that produced it. When no
level is requested, a model that declares shapes SHALL be checked through L3 and a model
that declares none through L2, for a single model and for every model of a project.

#### Scenario: Running a lower level

- **WHEN** a document is checked at L1
- **THEN** no L2 or L3 finding is reported
- **AND** the output states the level that was run

#### Scenario: Running L3

- **WHEN** a document is checked at L3
- **THEN** findings from L0, L1 and L2 are reported alongside L3 findings
- **AND** the output states that L3 was run

#### Scenario: The level follows the model

- **WHEN** a model declaring shapes is checked with no level requested
- **THEN** the check runs through L3
- **AND** the same model checked with `--level L2` reports no L3 finding

#### Scenario: Levels above this change

- **WHEN** a command is asked to run L4
- **THEN** it reports that the level is not available rather than reporting guidance

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
outcome the model declares for it. A negative example that raised every rule it declared
SHALL NOT fail the check, although its findings SHALL still be reported. A declared rule
above the level being run SHALL NOT be tested by that run.

#### Scenario: A negative example raising the wrong rule

- **WHEN** a negative example declares one rule id and validation raises a different one
- **THEN** the check fails and reports both

#### Scenario: Examples run without an editor

- **WHEN** the CLI checks a model in continuous integration
- **THEN** every example is validated with no editor present and no network access

#### Scenario: A negative example that did its job

- **WHEN** a negative example declares `L3.min-count` and raises it at error severity
- **THEN** the finding is reported against the example document
- **AND** the check does not fail because of it

#### Scenario: An expectation above the level run

- **WHEN** a negative example declares only `L3.datatype` and the model is checked at `--level L2`
- **THEN** the example is not reported as unmet

### Requirement: Shape conformance is decided by a SHACL engine

L3 SHALL convert a document to RDF with the system's own RDF conversion and validate it
with a SHACL engine against the shapes graph the `shacl` target emits for the model.
No other definition of conformance SHALL exist. Each violation SHALL become a finding
whose rule id names the SHACL constraint component:

| rule id | SHACL constraint component |
|---|---|
| `L3.min-count` | `sh:MinCountConstraintComponent` |
| `L3.max-count` | `sh:MaxCountConstraintComponent` |
| `L3.datatype` | `sh:DatatypeConstraintComponent` |
| `L3.node-kind` | `sh:NodeKindConstraintComponent` |
| `L3.class` | `sh:ClassConstraintComponent` |
| `L3.node` | `sh:NodeConstraintComponent` |
| `L3.closed` | `sh:ClosedConstraintComponent` |

Every L3 finding reporting a violation SHALL be at error severity.

#### Scenario: A missing required field

- **WHEN** a credential document omits `issuer` and the `Credential` shape declares `issuer` with `min: 1`
- **THEN** L3 reports `L3.min-count`
- **AND** the finding's pointer names the node object that lacks the key

#### Scenario: A value of the wrong kind

- **WHEN** `validFrom` holds `"yesterday"` and its field range is `xsd:dateTime` while its term coerces to `xsd:dateTime`
- **THEN** L3 reports `L3.datatype` at the pointer of that value

#### Scenario: A key a closed shape does not allow

- **WHEN** a node of a closed shape's target class carries a key that maps to a property no field names
- **THEN** L3 reports `L3.closed` at the pointer of that key

#### Scenario: A reference that was meant to be a node

- **WHEN** a field with a `class` range receives a string value and its term has no `@type: @id`
- **THEN** L3 reports `L3.node-kind` or `L3.class` at that value
- **AND** the model carries `L1.shape-range-needs-id-coercion` for the same field

### Requirement: A violation inside a nested shape is located where it occurs

A violation inside a node reached through a `shape` range SHALL be reported at the pointer
of the nested node or value that violates it, not only at the field that referenced
the shape.

#### Scenario: A nested credential subject missing a field

- **WHEN** a credential's `credentialSubject` lacks a field its `DegreeSubject` shape requires
- **THEN** L3 reports `L3.min-count` at the pointer of the `credentialSubject` node object
- **AND** also reports `L3.node` at the `credentialSubject` key, naming the nested finding

### Requirement: A document no shape targets is reported

A document checked at L3 in which no node is an instance of any shape's target class
SHALL receive a finding saying so, so that "no violations" cannot be mistaken for
"conforms".

#### Scenario: Nothing was checked

- **WHEN** a document whose nodes carry no targeted class is checked at L3
- **THEN** L3 reports `L3.no-target` at info severity at the document root

### Requirement: Shape findings are raised by negative examples

Every L1 shape rule and every L3 rule SHALL be exercised by a negative example in the
system's own fixtures, and each fixture SHALL declare the rule id it must raise.

#### Scenario: A negative credential example

- **WHEN** the fixture credential lacking `issuer` is checked at L3
- **THEN** it raises `L3.min-count` and the example passes as declared
