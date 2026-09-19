## Purpose

Defines how a model learns about contexts it does not own: they are fetched once by a
deliberate act, committed to the repository with an integrity hash, and read from
there by every other command, so that no build depends on the network and no model
can direct a pipeline to fetch a URL.

## ADDED Requirements

### Requirement: Referenced contexts are vendored

The system SHALL provide a command that fetches every context a model references,
writes it into a directory committed with the model, and records its integrity hash in
the model.

#### Scenario: Vendoring for the first time

- **WHEN** the vendor command is run on a model referencing an external context
- **THEN** the context is written into the vendored directory
- **AND** its integrity hash is recorded in the model file as a targeted edit

#### Scenario: Refresh produces a reviewable change

- **WHEN** an upstream context has changed and the vendor command is run again
- **THEN** the vendored file and the recorded hash both change
- **AND** the change appears as an ordinary diff in the repository

### Requirement: Every other command is offline

No command other than the vendor refresh SHALL access the network.

#### Scenario: Checking without a network

- **WHEN** a model is checked with no network access available
- **THEN** the check completes using the vendored contexts

#### Scenario: A missing vendored context

- **WHEN** a model references a context that has not been vendored and a check is run
- **THEN** the command fails reporting that the context must be vendored
- **AND** does not attempt to fetch it

### Requirement: A hash mismatch is a hard error

The system SHALL compare each vendored file against the hash recorded in the model and
SHALL refuse to proceed on a mismatch.

#### Scenario: Vendored file edited by hand

- **WHEN** a vendored context file is modified without updating the model
- **THEN** every command that reads it fails, naming the entry
- **AND** no artifact is generated

#### Scenario: Verifying without fetching

- **WHEN** the vendor command is run in check mode
- **THEN** hashes are verified against the vendored files
- **AND** no network request is made

### Requirement: Resolution informs authoring

Terms from a vendored context SHALL be available for completion, for detecting a term
that collides with an upstream definition, and for checking protected-term violations.

#### Scenario: A term shadowing an upstream term

- **WHEN** a model defines a term that a referenced context already defines differently
- **THEN** the system reports the collision and names the referenced context

### Requirement: Fetching is constrained

The fetcher SHALL follow redirects, SHALL require a JSON-LD content type unless
explicitly overridden, and SHALL NOT follow an alternate-location indirection offered
by a response header.

#### Scenario: A response that is not JSON-LD

- **WHEN** a referenced IRI returns HTML
- **THEN** the vendor command fails naming the IRI and the content type received
- **AND** writes nothing into the vendored directory
