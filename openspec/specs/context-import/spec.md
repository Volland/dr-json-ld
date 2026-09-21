## Purpose

Defines the on-ramp: turning a `@context` that already exists into a model, recovering
every facet it states, and reporting what a context structurally cannot carry rather
than inventing it.

## Requirements

### Requirement: An existing context becomes a model

The system SHALL produce a model from a `@context` document, recovering prefixes, the
vocabulary mapping, and every term with all of its facets. A scoped context given as a
map SHALL be imported as scoped terms, to any depth. A scoped context given as an IRI or
an array SHALL be imported as a reference.

#### Scenario: Importing a context that uses advanced facets

- **WHEN** a context using scoped contexts, containers and protected terms is imported
- **THEN** the resulting model carries every one of those facets
- **AND** the model resolves without error

#### Scenario: Element ids are minted on import

- **WHEN** a context with no element ids is imported
- **THEN** the resulting model has a written id on every term, including every scoped term

#### Scenario: Importing a credential context

- **WHEN** a context in which `VerifiableCredential` carries a protected type-scoped context of eight terms is imported
- **THEN** the model's `VerifiableCredential` term carries eight scoped terms, each with its facets and a written id
- **AND** the scoped context's `@protected` setting is recorded on the scoped context

#### Scenario: No shapes are invented

- **WHEN** a context with type-scoped contexts is imported
- **THEN** the resulting model declares no shapes
- **AND** the import report states that class membership was not recovered

### Requirement: Referenced contexts are recorded and vendored

An imported context that itself references other contexts SHALL record them as
references in the model and SHALL vendor them as part of the import.

#### Scenario: Importing a layered context

- **WHEN** a context that references an external vocabulary is imported
- **THEN** the model records that reference with an integrity hash
- **AND** the referenced context is written into the vendored directory

### Requirement: What cannot be recovered is reported

The system SHALL report what a context cannot express rather than inferring it: which
terms belong together as a class, human-readable documentation, and the intent behind
a vocabulary mapping.

#### Scenario: Import reports its limits

- **WHEN** a context is imported
- **THEN** the command reports that class membership and documentation were not present
- **AND** the model contains no invented class or description

### Requirement: Import and emit round-trip semantically

Importing a context and emitting it again SHALL produce a context semantically equal to
the input. Byte equality SHALL NOT be claimed.

#### Scenario: Semantic round trip

- **WHEN** a context is imported and emitted to the `context` target
- **THEN** the emitted context is semantically equal to the input under a normalizing
  comparison

#### Scenario: Round trip is a fixed point

- **WHEN** the emitted context is imported again and emitted again
- **THEN** the second emitted artifact is byte-identical to the first
