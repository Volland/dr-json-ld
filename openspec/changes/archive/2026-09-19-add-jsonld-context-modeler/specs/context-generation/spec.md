## Purpose

Defines the two targets that turn a model into a `@context`: one that keeps referenced
contexts as a live layer, and one that flattens them for consumers who cannot fetch —
which forks the upstream vocabulary and must say so.

## ADDED Requirements

### Requirement: The context target preserves references

The `context` target SHALL emit a context in which every referenced context appears as
an IRI in an array, with the model's own terms as the final layer.

#### Scenario: A model over an external vocabulary

- **WHEN** a model referencing an external context is emitted to the `context` target
- **THEN** the artifact references that context by IRI
- **AND** the model's own terms appear after it

#### Scenario: Term order is stable

- **WHEN** one term is changed and the model is emitted again
- **THEN** the artifact differs only at that term

### Requirement: Generated artifacts identify themselves

Every emitted artifact SHALL carry a header identifying it as generated and naming the
model it was generated from.

#### Scenario: Reading a generated context

- **WHEN** an emitted context is opened
- **THEN** it states that it is generated and from which model

### Requirement: The inline target flattens and reports the fork

The `context-inline` target SHALL emit a self-contained context with every referenced
context flattened in from its vendored copy, and SHALL report each absorbed context as
a downgrade.

#### Scenario: Emitting a self-contained context

- **WHEN** a model referencing an external context is emitted to `context-inline`
- **THEN** the artifact contains no reference to an external IRI
- **AND** the terms of the referenced context appear in it

#### Scenario: The fork is reported

- **WHEN** a context is absorbed by the `context-inline` target
- **THEN** a downgrade diagnostic is reported against the referencing entry in the model
- **AND** a comment at the top of the artifact names the absorbed context and the hash it came from

#### Scenario: Inlining is reproducible

- **WHEN** `context-inline` is run twice against unchanged vendored copies
- **THEN** both runs produce byte-identical artifacts

### Requirement: Targets declare capabilities and never drop silently

Every target SHALL declare what it can express. A model fact a target cannot carry
SHALL be reported as a downgrade diagnostic at its site in the model and as a comment
at the corresponding position in the artifact.

#### Scenario: A downgrade is visible in both places

- **WHEN** a target cannot express a model fact
- **THEN** a diagnostic appears on that fact in the model
- **AND** a comment appears at the lossy position in the generated artifact

### Requirement: A 1.1-only facet under a 1.0 target is a downgrade

When a model declares processing mode 1.0 and uses a facet defined only in 1.1, the
system SHALL emit the facet and report a downgrade stating how a 1.0 processor reads
the result.

#### Scenario: Protected terms under a 1.0 target

- **WHEN** a model declaring mode 1.0 marks a term protected and is emitted
- **THEN** the emitted context still carries the facet
- **AND** a downgrade states that a 1.0 processor ignores it

### Requirement: Emitted contexts are executed, not only snapshotted

Every emitted context SHALL be loaded by an independent JSON-LD implementation and used
to round-trip every declared example.

#### Scenario: Round-tripping an example through the emitted context

- **WHEN** an example document is expanded and compacted using the emitted context by an
  independent implementation
- **THEN** the result is semantically equal to the original document
