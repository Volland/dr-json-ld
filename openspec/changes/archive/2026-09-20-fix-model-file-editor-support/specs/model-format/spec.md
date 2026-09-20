## MODIFIED Requirements

### Requirement: The schema and validation agree on what a model may say

Every model file the schema rejects SHALL also be reported by validation as an error
carrying a named rule id, and every model file validation accepts without an error
SHALL be accepted by the schema. The schema SHALL be the earlier report of the same
fact, never a second and different opinion. A finding at warning severity SHALL NOT
correspond to a schema rejection, because a warning names a model the tool accepts.

Earlier means *while the user types*. A refusal the editor's schema execution does not
evaluate is therefore not an earlier report of anything, and SHALL either be expressed
in a form the editor evaluates or be recorded as command-only against the rule id that
reports it.

#### Scenario: The schema rejects what validation accepts

- **WHEN** a model file is rejected by the schema and validation reports no error
- **THEN** the build fails naming the model file and the constraint that rejected it

#### Scenario: Validation rejects what the schema accepts

- **WHEN** a model file is accepted by the schema and validation reports a co-constraint error
- **THEN** the build fails naming the model file and the rule id

#### Scenario: A downgrade is not a rejection

- **WHEN** a model file produces only findings at warning severity
- **THEN** the schema accepts it
- **AND** the build does not fail

#### Scenario: A schema rejection is also a finding

- **WHEN** a model file violating a facet co-constraint is checked
- **THEN** validation reports the specific L1 rule for that constraint at error severity

#### Scenario: A refusal the editor never evaluates

- **WHEN** the schema refuses a model file only through a construct the editor's schema execution ignores
- **THEN** the build fails unless that refusal is recorded as command-only
- **AND** the record names the rule id validation reports it under
