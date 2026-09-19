## Purpose

Defines searching what already exists — every version the project has published, and
every context it has vendored — so an author can find a term before minting one, and
find which published version first introduced a term they are looking at.

## ADDED Requirements

### Requirement: Search covers published versions and vendored contexts

Search SHALL cover every version published in the project and every vendored context
the project's models reference. Each result SHALL name what matched, where it came
from, and the version or context it was found in.

#### Scenario: Finding a term before minting one

- **WHEN** an author searches for a term a vendored context already defines
- **THEN** the result names the term, its IRI and the context that defines it

#### Scenario: Finding a term in a published version

- **WHEN** an author searches for a term a published version defines
- **THEN** the result names the version and the term's IRI in it

#### Scenario: Distinguishing the two sources

- **WHEN** a term is defined both by a vendored context and by a published version
- **THEN** both results are returned
- **AND** each states which source it came from

### Requirement: Search is offline

Search SHALL make no network request.

#### Scenario: Searching with no network available

- **WHEN** a search is run with no network access
- **THEN** it completes over the published versions and vendored contexts present

### Requirement: Search matches terms, IRIs and notes

Search SHALL match against a term's JSON key, its IRI, and any note the model records
for it. A search SHALL state which of these matched.

#### Scenario: Matching an IRI

- **WHEN** an author searches for an IRI
- **THEN** every term mapping to that IRI is returned
- **AND** each result states that the IRI matched

#### Scenario: Matching a note

- **WHEN** an author searches for a word appearing only in a term's note
- **THEN** that term is returned
- **AND** the result states that the note matched

#### Scenario: No match

- **WHEN** a search matches nothing
- **THEN** the command reports that nothing matched and what it searched
- **AND** succeeds rather than failing

### Requirement: Search results are deterministic

The set and order of results SHALL depend only on the query and the content searched.

#### Scenario: Searching twice

- **WHEN** the same query is run twice against unchanged content
- **THEN** the same results are returned in the same order

### Requirement: The index reflects what is present

Search SHALL reflect the versions and vendored contexts currently present. A version
that fails verification SHALL NOT contribute results.

#### Scenario: A newly published version

- **WHEN** a version is published and a search is run
- **THEN** terms from that version are returned

#### Scenario: A version that fails verification

- **WHEN** a version's manifest does not match its files and a search is run
- **THEN** that version contributes no results
- **AND** the search reports that it was skipped and why
