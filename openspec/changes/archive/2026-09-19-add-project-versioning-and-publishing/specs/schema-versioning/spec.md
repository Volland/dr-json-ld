## Purpose

Defines what a version of a model is: an immutable, content-addressed snapshot
carrying a manifest that checksums every file in it, and the movable aliases that let
a human name survive a correction without ever editing what was published.

## ADDED Requirements

### Requirement: A version is immutable once created

A version SHALL be created from a model and never altered afterwards. Every command
that writes SHALL refuse to write inside an existing version.

#### Scenario: Writing into an existing version

- **WHEN** any command would modify a file inside an existing version
- **THEN** the command fails naming the version
- **AND** no file in that version changes

#### Scenario: Correcting a published mistake

- **WHEN** an author needs to change something already published as a version
- **THEN** the tool directs them to create a new version
- **AND** the existing version remains byte-identical

### Requirement: A version carries a manifest with a checksum

Every version SHALL contain a manifest recording, for each file in the version, that
file's path and its integrity hash, plus one hash over the manifest itself. The
manifest SHALL record the model the version was made from, the moment it was created,
and the format version of the manifest.

#### Scenario: Verifying a version

- **WHEN** a version is verified
- **THEN** every file's hash is compared against the manifest
- **AND** the manifest's own hash is compared against its contents

#### Scenario: A file in a version is edited by hand

- **WHEN** a file inside a version is modified without the manifest being updated
- **THEN** verification fails naming the file, the recorded hash and the hash found
- **AND** every command that reads that version fails rather than using it

#### Scenario: The manifest itself is edited

- **WHEN** the manifest is modified to match a hand-edited file
- **THEN** verification fails because the manifest's own hash no longer matches

### Requirement: A version is addressed by its content

A version's identity SHALL be derived from the hash of its inputs — the model as
written, the lockfile, and the example documents — and SHALL NOT depend on the
generated artifacts, which are a function of those inputs. Two versions created from
identical inputs SHALL have the same identity, and two versions created from different
inputs SHALL NOT.

#### Scenario: Re-creating an unchanged model

- **WHEN** a version is created from a model that has not changed since the last version
- **THEN** the tool reports that the content is identical to the existing version
- **AND** creates no second copy

#### Scenario: An artifact naming its own version

- **WHEN** a version's emitted artifact names the version's identity in its header
- **THEN** the identity is unchanged by that naming
- **AND** the manifest still records the artifact's hash as written

### Requirement: An alias is a movable name for a version

An alias SHALL be a human-chosen name pointing at exactly one version. Creating,
retargeting and deleting an alias SHALL leave every version byte-identical. An alias
SHALL NOT be required for a version to exist.

#### Scenario: Renaming

- **WHEN** an alias is renamed
- **THEN** the alias resolves under its new name
- **AND** does not resolve under the old one
- **AND** the version it points at is unchanged

#### Scenario: Retargeting an alias after a correction

- **WHEN** a new version corrects an older one and an alias is pointed at the new version
- **THEN** the alias resolves to the new version
- **AND** the older version remains readable at its own identity

#### Scenario: An alias naming no version

- **WHEN** an alias points at a version that does not exist
- **THEN** validation reports an error naming the alias and the missing version

#### Scenario: An alias colliding with a version identity

- **WHEN** an alias is given a name that is already a version identity
- **THEN** the command fails rather than creating an ambiguous name

### Requirement: A version records what it was derived from

A version created by cloning another SHALL record the version it was cloned from. A
version created as the successor of another SHALL record its predecessor.

#### Scenario: Reading a version's lineage

- **WHEN** a cloned version is inspected
- **THEN** it names the version it was cloned from

#### Scenario: A lineage naming a version that is gone

- **WHEN** a version names a predecessor that is not present
- **THEN** verification reports it
- **AND** the version itself still verifies, since its own content is intact

### Requirement: A version refuses derived element ids

Creating a version from a model whose element ids are derived rather than written
SHALL be refused.

#### Scenario: Versioning a model with derived ids

- **WHEN** a version is created from a model carrying at least one derived id
- **THEN** the command fails naming the elements with derived ids
- **AND** directs the author to write ids in first
