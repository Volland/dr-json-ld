## Purpose

Defines where the model and project JSON Schemas are served, how a published schema is versioned so a tightening cannot retroactively invalidate a model that already validated, and the reference page and conformance corpus that keep the served bytes honest.

## ADDED Requirements

### Requirement: The schema is served at its own identifier

Each published JSON Schema SHALL be served from the documentation site at a path
carrying a schema format version, and its `$id` SHALL be exactly the URL it is served
from. A schema whose `$id` does not match its served path SHALL fail the deploy.

#### Scenario: Fetching the schema at its identifier

- **WHEN** the model schema's `$id` is requested
- **THEN** the site serves the schema document
- **AND** the document parses as JSON Schema

#### Scenario: Identifier and path disagree

- **WHEN** a schema is committed whose `$id` names a different path than the one it is served at
- **THEN** the deploy fails naming both the `$id` and the path
- **AND** nothing is published

#### Scenario: A model pointing at the published schema

- **WHEN** a model file declares the published schema URL in an editor that fetches it
- **THEN** structural errors are reported without the extension being installed

### Requirement: A schema format version is a separate path

The published schema SHALL live beneath a path segment naming its format version. A
change that rejects a model file the previous published schema accepted SHALL be
published at a new format version path, and the previous path SHALL continue to serve
its original bytes. A change that only accepts more, or only alters descriptions, MAY
be published in place at the same path.

#### Scenario: Tightening what the schema accepts

- **WHEN** a schema change rejects a model file the served schema accepted
- **THEN** it is published at a new format-version path
- **AND** the previous path still serves the bytes it served before

#### Scenario: A model pinned to a format version

- **WHEN** a model validates against a published format-version path
- **THEN** it continues to validate against that path after a newer version is published

### Requirement: Every copy of a schema is identical

A schema SHALL exist as one set of bytes reproduced wherever it is needed — the
library package, the editor extension, and the published site tree. All copies SHALL
be byte-identical, and a difference SHALL fail the build naming the copies that
differ.

#### Scenario: A copy drifts

- **WHEN** one copy of the model schema is edited and the others are not
- **THEN** the build fails naming the schema and the copies that disagree

#### Scenario: All copies agree

- **WHEN** every copy of every published schema is compared
- **THEN** they are byte-identical

### Requirement: The schema reference page is generated from the schema

The site SHALL carry a human-readable reference page documenting every field the
model schema defines, its type, whether it is required, and the constraints placed on
it. The page SHALL be generated from the schema document, and a page that does not
match the schema it was generated from SHALL fail the build.

#### Scenario: A field added to the schema

- **WHEN** a field is added to the model schema and the reference page is not regenerated
- **THEN** the build fails naming the field the page omits

#### Scenario: Reading the reference

- **WHEN** the reference page is opened
- **THEN** every field the schema defines appears with its constraints
- **AND** the page links to the schema at its `$id`

### Requirement: A conformance corpus exercises the schema

The system SHALL maintain a corpus of model files the schema must accept and model
files it must reject, each reject case naming the constraint it violates. The corpus
SHALL run against the published schema on every build.

#### Scenario: A must-accept case is rejected

- **WHEN** a schema change rejects a model file in the must-accept corpus
- **THEN** the build fails naming the file and the constraint that rejected it

#### Scenario: A must-reject case is accepted

- **WHEN** a schema change accepts a model file in the must-reject corpus
- **THEN** the build fails naming the file and the constraint it was meant to violate

#### Scenario: Every fixture model is in the corpus

- **WHEN** the corpus is run
- **THEN** every fixture model that `ldm check` accepts is also accepted by the schema
