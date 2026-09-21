## ADDED Requirements

### Requirement: Shape differences are classified

Shapes SHALL be matched by element id. Fields SHALL be matched by the element id of the
term each resolves to. A difference is classified by its effect on documents that
conformed to the older version.

#### Scenario: A new shape for a new class

- **WHEN** the newer version declares a shape whose target class the older version did not declare
- **THEN** the difference is classified `additive`

#### Scenario: A new shape for an existing class

- **WHEN** the newer version declares a shape targeting a class the older version already declared
- **THEN** the difference is classified `breaking`
- **AND** the report states that documents of that class were unconstrained before

#### Scenario: Tightening a field

- **WHEN** a field's `min` rises, its `max` falls, its range narrows, or a shape becomes closed
- **THEN** the difference is classified `breaking`
- **AND** the report states that documents which conformed may no longer conform

#### Scenario: Loosening a field

- **WHEN** a field's `min` falls, its `max` rises or is removed, a shape becomes open, or a field or shape is removed
- **THEN** the difference is classified `compatible`

#### Scenario: A range that is neither narrower nor wider

- **WHEN** a field's range changes from one datatype to an unrelated one
- **THEN** the difference is classified `breaking`
- **AND** the report says the classification was made under ambiguity

### Requirement: Scoped terms are compared as terms

A scoped term SHALL be compared by element id with the same classification as a
top-level term. A term whose element id moves from one context map to another SHALL be
classified `breaking`, because the set of documents in which its key applies changed.

#### Scenario: Promoting a key into a type-scoped context

- **WHEN** a key's term with an unchanged element id moved from the top level into a class's scoped context
- **THEN** the difference is classified `breaking`
- **AND** the report names the old and new scope

#### Scenario: Comparing against a version from before scoped terms

- **WHEN** the older version's lockfile records a scoped context as a single value without scoped terms
- **THEN** the scoped context is compared as a whole value
- **AND** the report states that scoped terms could not be matched individually
