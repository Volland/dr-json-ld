## Purpose

Defines the published tree: a static directory layout that serves a versioned
`@context` correctly from GitHub Pages, an S3 bucket or any plain file host without
server configuration, and the commands that produce and populate it.

## Requirements

### Requirement: Publishing writes a static tree

Publishing a version SHALL write the emitted artifacts for that version into a
directory tree that is serveable as static files. Every artifact SHALL be reachable at
a path containing the version's identity, and every alias SHALL be reachable at a path
containing the alias name.

#### Scenario: Serving from a plain file host

- **WHEN** the published tree is copied to a static file host with no configuration
- **THEN** every artifact is retrievable at the path the tree records for it
- **AND** no rewrite rule, redirect rule or server-side negotiation is required

#### Scenario: A version path and an alias path for the same artifact

- **WHEN** an alias points at a version and both paths are fetched
- **THEN** both return the same artifact content

### Requirement: Publishing is reproducible

Publishing the same version twice against an unchanged model SHALL produce a
byte-identical tree.

#### Scenario: Republishing

- **WHEN** publish is run twice with nothing changed in between
- **THEN** the second run reports that nothing changed
- **AND** every file in the tree is byte-identical to the first run's

### Requirement: A host adapter names what a host needs

The system SHALL support more than one host, and each SHALL be declared by an adapter
stating the side files and path constraints that host requires. A published tree SHALL
be valid for every host the project names.

#### Scenario: Publishing for a host that needs a side file

- **WHEN** a project names a host whose adapter requires a side file
- **THEN** publishing writes that side file into the tree

#### Scenario: A path a host cannot serve

- **WHEN** a version or alias name produces a path the named host cannot serve
- **THEN** publishing fails naming the host, the path and the constraint it violates
- **AND** writes nothing into the tree

#### Scenario: Publishing for several hosts at once

- **WHEN** a project names two hosts with different requirements
- **THEN** the published tree satisfies both
- **AND** publishing reports which side files each host required

### Requirement: The published tree records what it contains

A published tree SHALL carry an index naming every version and alias in it, with each
version's identity and manifest hash.

#### Scenario: Reading the index

- **WHEN** the published index is read
- **THEN** it names every published version and every alias
- **AND** names which version each alias points at

#### Scenario: The tree and the index disagree

- **WHEN** the tree contains a version the index does not name
- **THEN** verification reports it naming the version

### Requirement: Cloning copies a version under a new identity

Cloning a version SHALL produce a new version with the same content and a recorded
link to its origin. The origin SHALL be unchanged.

#### Scenario: Cloning

- **WHEN** a version is cloned
- **THEN** a new version exists whose content matches the origin
- **AND** the new version records the origin it was cloned from
- **AND** the origin verifies unchanged

### Requirement: Creating a new version starts from a model

Creating a new version SHALL take the current state of a model, refuse if the model
has error findings, and otherwise freeze it as an immutable version.

#### Scenario: A model with an error finding

- **WHEN** a new version is created from a model producing an error finding
- **THEN** the command fails reporting the findings
- **AND** no version is created

#### Scenario: A clean model

- **WHEN** a new version is created from a model with no error finding
- **THEN** the version exists, verifies, and contains the emitted artifacts for the model

### Requirement: Published artifacts are executed, not only written

Every artifact in a published version SHALL be loaded by an independent JSON-LD
implementation and used to round-trip every example the model declares, as the
`context` and `context-inline` targets already require.

#### Scenario: Round-tripping a published artifact

- **WHEN** an example document is expanded and compacted using an artifact taken from the
  published tree by an independent implementation
- **THEN** the result is semantically equal to the original document
