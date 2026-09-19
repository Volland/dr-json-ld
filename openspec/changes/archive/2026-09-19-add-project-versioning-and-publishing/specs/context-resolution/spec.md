## MODIFIED Requirements

### Requirement: Referenced contexts are vendored

The system SHALL provide a command that fetches every context a model references,
writes it into a directory committed with the model, and records its integrity hash in
the model. A context published by a version of this same project SHALL be resolved
from the published tree instead, using the version's recorded manifest hash rather
than a separately vendored copy.

#### Scenario: Vendoring for the first time

- **WHEN** the vendor command is run on a model referencing an external context
- **THEN** the context is written into the vendored directory
- **AND** its integrity hash is recorded in the model file as a targeted edit

#### Scenario: Refresh produces a reviewable change

- **WHEN** an upstream context has changed and the vendor command is run again
- **THEN** the vendored file and the recorded hash both change
- **AND** the change appears as an ordinary diff in the repository

#### Scenario: Referencing a version this project published

- **WHEN** a model references a context published by a version of its own project
- **THEN** it resolves from the published tree
- **AND** no copy is written into the vendored directory
- **AND** no network request is made

#### Scenario: Referencing a version that does not exist

- **WHEN** a model references a version of its own project that is not published
- **THEN** validation reports an error naming the model, the reference and the version
- **AND** does not attempt to fetch it
