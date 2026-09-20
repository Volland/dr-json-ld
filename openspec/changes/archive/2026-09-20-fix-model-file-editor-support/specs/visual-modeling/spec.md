## MODIFIED Requirements

### Requirement: Validation surfaces in the editor

Findings SHALL be reported as editor diagnostics at the position in the model file, the
project file or the document that produced them. A finding whose position is in a file
other than the one being edited SHALL be reported against that file. Each diagnostic
SHALL carry the finding's rule id as its code, so a finding is referenceable from the
editor by the same handle an example requires and a configuration downgrades.

#### Scenario: A finding is reachable from the canvas

- **WHEN** a finding is reported against a term
- **THEN** a diagnostic appears at that term in the Problems panel
- **AND** selecting it reveals the corresponding element on the canvas

#### Scenario: A finding against the project file

- **WHEN** a project file names a model whose file does not exist
- **THEN** a diagnostic carrying `L0.project-model-missing` appears at that entry in the project file
- **AND** it appears without any command being run

#### Scenario: A finding against a file that is not open

- **WHEN** validating an open model reports a finding positioned in one of its example documents
- **THEN** the diagnostic is reported against the example document rather than the model

#### Scenario: A diagnostic names its rule

- **WHEN** any finding is reported as a diagnostic
- **THEN** the diagnostic's code is the finding's rule id
