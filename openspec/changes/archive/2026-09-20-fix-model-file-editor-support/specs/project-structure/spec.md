## ADDED Requirements

### Requirement: The project schema and project parsing agree on what a project file may say

Every project file the project schema rejects SHALL also be reported as an error
carrying a named `L0.project-*` rule id, and every project file that parses and checks
without an error SHALL be accepted by the project schema. The schema SHALL be the
earlier report of the same fact, never a second and different opinion, under the same
severity bound the model pair uses: a finding at warning severity SHALL NOT correspond
to a schema rejection.

#### Scenario: The project schema rejects what parsing accepts

- **WHEN** a project file is rejected by the project schema and checking it reports no error
- **THEN** the build fails naming the project file and the constraint that rejected it

#### Scenario: Parsing rejects what the project schema accepts

- **WHEN** a project file is accepted by the project schema and checking it reports an error
- **THEN** the build fails naming the project file and the rule id

#### Scenario: A rejection carries a position

- **WHEN** a project file is rejected by either the schema or checking
- **THEN** the finding carries a JSON Pointer and a line and column into the project file
