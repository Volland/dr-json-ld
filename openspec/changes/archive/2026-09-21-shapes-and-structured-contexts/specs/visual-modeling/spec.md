## MODIFIED Requirements

### Requirement: The canvas is the authoring surface

The system SHALL open a canvas beside the model file. A user SHALL be able to create a
term, set its facets, rename it and delete it entirely from the canvas. The same SHALL
hold for a scoped term, a shape and a field.

#### Scenario: Creating a model from an empty canvas

- **WHEN** a user opens a new model and adds two terms with facets entirely from the canvas
- **THEN** the model file contains those terms with those facets
- **AND** the user has not typed into the file

#### Scenario: Every question is asked in the document

- **WHEN** the canvas needs a term name or a confirmation
- **THEN** it is asked in the rendered document
- **AND** no browser dialog function is called

#### Scenario: Describing a credential without typing into the file

- **WHEN** a user creates a shape for `VerifiableCredential` on the canvas and adds `issuer`, `validFrom` and `credentialSubject` with cardinality and ranges
- **THEN** the model file contains that shape, and a term for every field key that did not exist
- **AND** the user has not typed into the file

#### Scenario: Renaming a term that fields use

- **WHEN** a user renames a term on the canvas that a shape names as a field key
- **THEN** the field key is renamed in the same edit
- **AND** undoing it once restores both

### Requirement: The projection carries the whole metamodel

The projection sent to the canvas SHALL carry every facet the metamodel can express,
every scoped term with its facets, and every shape with its fields.

#### Scenario: A facet added to the metamodel

- **WHEN** the metamodel gains a facet the canvas has no dedicated control for
- **THEN** the projection still carries it
- **AND** it is visible and editable through the inspector's raw escape hatch

#### Scenario: A scoped term is in the projection

- **WHEN** a term carries a scoped context of three terms
- **THEN** the projection carries all three with their element ids and facets

### Requirement: Named views scope each diagram

A view SHALL name a subset of a model, forming one pair of diagrams. A user SHALL be
able to create a view and add or remove terms and shapes from it on the canvas.

#### Scenario: Focusing a subset

- **WHEN** a model has fifty terms and a user creates a view containing five
- **THEN** both panes show only those five

#### Scenario: Term belonging to no view

- **WHEN** a model contains a term that no view includes
- **THEN** validation reports it so it cannot be silently invisible

#### Scenario: A view of one shape

- **WHEN** a view lists the shape `Credential`
- **THEN** both panes show that shape, its fields' terms and the shapes its fields reach

## ADDED Requirements

### Requirement: Scoped terms are elements on the canvas

A scoped term SHALL be selectable, inspectable and editable like a top-level term. The
inspector SHALL offer to add a scoped term to any term. A scoped term SHALL be drawn
inside the region of the scoped context that holds it.

#### Scenario: Adding a scoped term

- **WHEN** a user selects `publisher` and adds a scoped term `name` mapped to `schema:legalName`
- **THEN** the model file's `publisher` gains that scoped term with a written id
- **AND** the tree pane draws it inside the `publisher` region

#### Scenario: Selecting a scoped term

- **WHEN** a user selects the scoped `name` under `publisher`
- **THEN** the graph pane selects its IRI, distinct from the top-level `name`

### Requirement: Shapes are authored as a field table

Selecting a shape or its target class SHALL open the shape in the inspector as a table
of fields. Each row SHALL show the key, the IRI it resolves to, the range, `min` and
`max`, and the term's coercion. The range control SHALL offer the declared prefixes'
datatypes, the model's classes and the model's shapes. Adding a field SHALL offer
existing terms first and SHALL create a term only when asked.

#### Scenario: Adding a field from an existing term

- **WHEN** a user adds the field `issuer` to `Credential` and `issuer` is already a term
- **THEN** only the shape changes in the model file

#### Scenario: Adding a field for a new key

- **WHEN** a user adds the field `evidence` and no term `evidence` exists
- **THEN** the canvas asks in the document for its IRI
- **AND** one edit adds both the term and the field

#### Scenario: A fact only SHACL carries

- **WHEN** a user views a field's `min` and `max` in the inspector
- **THEN** the inspector marks them as carried by the `shacl` target and absent from the `@context`

### Requirement: Both panes draw shapes

The graph pane SHALL draw a shape as its target class carrying its fields, and each
`class` or `shape` range as an edge labelled with its cardinality. The tree pane SHALL
draw the JSON skeleton of a document conforming to the selected shape: its keys, the
container form each value takes, nested shapes as nested objects, and scoped-context
regions.

#### Scenario: A nested credential structure

- **WHEN** a user selects the shape `Credential` whose `credentialSubject` has range `{ shape: DegreeSubject }`
- **THEN** the tree pane shows `credentialSubject` holding an object with `DegreeSubject`'s keys
- **AND** the graph pane shows an edge from `Credential` to `DegreeSubject` labelled with the field's cardinality

#### Scenario: A recursive shape is drawn finitely

- **WHEN** a user selects a shape whose field refers to the shape itself
- **THEN** the tree pane draws the recursion once, as a reference, and does not expand it again

### Requirement: A conflicting coercion is resolved by promotion, never silently

When a user sets a field's range in a way that contradicts the coercion of its term, and
another shape uses that term consistently with its current coercion, the canvas SHALL
offer in the document to promote the key into the target class's type-scoped context.
It SHALL NOT change the shared term's coercion without asking. Promotion SHALL create a
scoped term with a new element id, the same IRI and the new coercion.

#### Scenario: Two classes need different coercions for one key

- **WHEN** `Person` uses `name` as a plain string, and a user sets `Organization`'s `name` field to `range: iri`
- **THEN** the canvas offers to give `Organization` its own `name` in a type-scoped context
- **AND** on acceptance, `Organization` carries a scoped `name` coerced with `@type: @id` and `Person`'s `name` is unchanged
- **AND** no `L1.shape-range-coercion-conflict` remains

#### Scenario: The target class is not a term

- **WHEN** promotion is needed and the shape's target class is an IRI with no term in the model
- **THEN** the offer states that a type-scoped context needs a class term and offers to create it first

#### Scenario: Promotion is a single undo step

- **WHEN** a user accepts a promotion and then undoes once
- **THEN** the model file is as it was before the range was set
