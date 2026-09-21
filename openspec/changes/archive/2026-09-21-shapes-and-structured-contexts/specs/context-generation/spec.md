## ADDED Requirements

### Requirement: Context targets emit scoped terms from the IR

The `context` and `context-inline` targets SHALL emit a scoped context from its scoped
terms and settings in the IR, in the same form as the model's own terms. Element ids and
notes SHALL NOT appear in an emitted scoped context. A model written before scoped terms
became first-class SHALL emit a semantically equal context.

#### Scenario: An existing model is unchanged

- **WHEN** a model with a scoped context written before this change is emitted to the `context` target
- **THEN** the emitted context is semantically equal to the one emitted before this change
- **AND** its header is unchanged, because the model declares no shapes

#### Scenario: Identity stays in the model

- **WHEN** a scoped term carrying an element id and a note is emitted
- **THEN** the emitted scoped context contains neither

### Requirement: Context targets name the shapes layer as not carried

The `context` and `context-inline` targets SHALL declare a `shapes` capability of `none`,
because a `@context` cannot express shapes. When the model declares shapes, the artifact's
header SHALL say that they are not carried. Individual shapes SHALL NOT each raise a
downgrade. A model declaring no shapes SHALL NOT have the capability named in its header,
so artifacts emitted before the shapes layer existed are unchanged.

#### Scenario: Emitting a context for a model with shapes

- **WHEN** a model declaring shapes is emitted to the `context` target
- **THEN** the header names `shapes` as `none` and names the `shacl` target as the one that carries them
- **AND** no downgrade diagnostic is raised on any shape

#### Scenario: The two context targets still differ in one capability

- **WHEN** the capability sets of `context` and `context-inline` are compared
- **THEN** they differ only in `external-reference`
