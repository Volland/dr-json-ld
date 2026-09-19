## MODIFIED Requirements

### Requirement: Model file structure

A model SHALL be a YAML file declaring a format version, a namespace, a processing
mode, and the terms it defines. It MAY declare prefixes, referenced contexts and
examples. It MAY declare the project it belongs to and the version policy it follows.
The system SHALL publish a JSON Schema for model files so that structural
errors are reported in the editor without invoking the modeler.

#### Scenario: Structural error in a model file

- **WHEN** a model file declares a term whose definition is a number
- **THEN** the editor reports a structural error on that line
- **AND** the modeler reports the same file as invalid rather than rendering it

#### Scenario: Namespace is required

- **WHEN** a model file omits its namespace declaration
- **THEN** validation reports an error identifying the file
- **AND** no artifact is generated for that model

#### Scenario: Schema is identical in both packages

- **WHEN** the published JSON Schema and the copy contributed to the editor are compared
- **THEN** they are byte-identical

#### Scenario: A model naming a project that does not declare it

- **WHEN** a model names a project whose project file does not list that model
- **THEN** validation reports an error naming both the model and the project

#### Scenario: A model outside any project

- **WHEN** a model declares no project and no project file encloses it
- **THEN** the model resolves, emits and validates exactly as it does today
