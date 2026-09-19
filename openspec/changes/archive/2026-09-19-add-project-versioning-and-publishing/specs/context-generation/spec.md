## MODIFIED Requirements

### Requirement: Generated artifacts identify themselves

Every emitted artifact SHALL carry a header identifying it as generated and naming the
model it was generated from. When the artifact belongs to a version, the header SHALL
additionally name that version's identity and the project that published it, so a
consumer holding only the artifact can say which release it is reading.

#### Scenario: Reading a generated context

- **WHEN** an emitted context is opened
- **THEN** it states that it is generated and from which model

#### Scenario: Reading a published context

- **WHEN** an emitted context taken from a published version is opened
- **THEN** it names the version's identity and the project that published it
- **AND** still states that it is generated and from which model

#### Scenario: An artifact emitted outside a version

- **WHEN** a model is emitted without creating a version
- **THEN** the header names the model
- **AND** names no version, rather than naming a placeholder
