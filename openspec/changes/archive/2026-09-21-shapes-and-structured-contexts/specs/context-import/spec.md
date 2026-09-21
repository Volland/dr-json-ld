## MODIFIED Requirements

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
