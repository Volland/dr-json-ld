## MODIFIED Requirements

### Requirement: A conformance corpus exercises the schema

The system SHALL maintain, for every published schema, a corpus of files that schema
must accept and files it must reject, each reject case naming the constraint it
violates. Each corpus SHALL run against its published schema on every build. A published
schema with no corpus SHALL fail the build.

#### Scenario: A must-accept case is rejected

- **WHEN** a schema change rejects a file in that schema's must-accept corpus
- **THEN** the build fails naming the file and the constraint that rejected it

#### Scenario: A must-reject case is accepted

- **WHEN** a schema change accepts a file in that schema's must-reject corpus
- **THEN** the build fails naming the file and the constraint it was meant to violate

#### Scenario: Every fixture model is in the corpus

- **WHEN** the corpus is run
- **THEN** every fixture model that `ldm check` accepts is also accepted by the schema

#### Scenario: A published schema with no corpus

- **WHEN** a schema is published and no accept/reject corpus exists for it
- **THEN** the build fails naming the schema
