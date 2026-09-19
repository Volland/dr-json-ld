## Purpose

Defines how two versions are compared: a canonical lockfile of the resolved IR, a
match by element id so a rename reads as a rename, and a classification of every
difference into the five classes JSON-LD's failure modes actually require.

## Requirements

### Requirement: A version carries a lockfile

Every version SHALL contain a canonical snapshot of the resolved IR, with arrays
ordered by element id and object keys sorted, so that two snapshots can be compared
without re-resolving either model.

#### Scenario: Reordering declarations changes nothing

- **WHEN** terms are reordered in a model with no other change and a version is created
- **THEN** the lockfile is byte-identical to the previous version's
- **AND** comparing the two reports no change

#### Scenario: Comparing without the model

- **WHEN** two versions are compared and neither model file is present
- **THEN** the comparison succeeds using the lockfiles alone

### Requirement: Differences are matched by element id

Comparison SHALL match elements between two versions by element id, never by key,
IRI or position.

#### Scenario: A renamed term

- **WHEN** a term's JSON key changed between two versions and its element id did not
- **THEN** the comparison reports one term whose key changed
- **AND** does not report a removal and an addition

#### Scenario: A retyped term

- **WHEN** a term's IRI changed between two versions and its element id did not
- **THEN** the comparison reports one term whose IRI changed

### Requirement: Every difference is classified

Each difference SHALL be classified as exactly one of `additive`, `compatible`,
`breaking`, `semantic` or `illegal`. A difference whose direction is ambiguous SHALL
be classified `breaking`.

#### Scenario: A JSON key change

- **WHEN** a term's key changed
- **THEN** the difference is classified `breaking`
- **AND** the report states that consumers' documents stop compacting the same way

#### Scenario: An IRI change

- **WHEN** a term's IRI changed
- **THEN** the difference is classified `semantic`
- **AND** the report states that every document still parses and now means something else

#### Scenario: Removing a protected term

- **WHEN** a term declared `@protected` in the older version is absent from the newer one
- **THEN** the difference is classified `illegal`

#### Scenario: A new term

- **WHEN** the newer version declares a term the older one did not
- **THEN** the difference is classified `additive`

#### Scenario: Adding a set container

- **WHEN** a term gains `@container: @set` and changes nothing else
- **THEN** the difference is classified `compatible`

#### Scenario: An ambiguous difference

- **WHEN** a difference cannot be placed in one class with confidence
- **THEN** it is classified `breaking`
- **AND** the report says the classification was made under ambiguity

### Requirement: Comparison output is deterministic

The set and order of reported differences SHALL depend only on the two versions
compared.

#### Scenario: Comparing twice

- **WHEN** the same two versions are compared twice
- **THEN** the same differences are reported in the same order

### Requirement: Comparison gates on a class

The comparison command SHALL fail when any difference is at or above a class the
caller names.

#### Scenario: Gating a pull request

- **WHEN** a comparison is run gated on `breaking` and a `semantic` difference is found
- **THEN** the command fails naming that difference

#### Scenario: Gating passes

- **WHEN** a comparison is run gated on `breaking` and every difference is `additive`
- **THEN** the command succeeds

### Requirement: Comparison refuses derived ids

Comparing a version whose lockfile records derived element ids SHALL be refused,
because a rename could not then be told from a removal plus an addition.

#### Scenario: A lockfile with derived ids

- **WHEN** a comparison involves a version recording at least one derived id
- **THEN** the command fails naming the elements and the version
