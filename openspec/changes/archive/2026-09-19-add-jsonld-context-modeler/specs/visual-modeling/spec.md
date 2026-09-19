## Purpose

Defines the canvas as the authoring surface: two coordinated views of one model — the
JSON shape a developer types and the RDF graph it denotes — how edits reach the model
file without the user opening it, and how the gap between the two views is made
visible rather than hidden.

## ADDED Requirements

### Requirement: The canvas is the authoring surface

The system SHALL open a canvas beside the model file. A user SHALL be able to create a
term, set its facets, rename it and delete it entirely from the canvas.

#### Scenario: Creating a model from an empty canvas

- **WHEN** a user opens a new model and adds two terms with facets entirely from the canvas
- **THEN** the model file contains those terms with those facets
- **AND** the user has not typed into the file

#### Scenario: Every question is asked in the document

- **WHEN** the canvas needs a term name or a confirmation
- **THEN** it is asked in the rendered document
- **AND** no browser dialog function is called

### Requirement: Two coordinated panes

The canvas SHALL present a tree pane showing JSON structure and a graph pane showing
the RDF the model denotes. Both SHALL be derived from one projection of the model and
SHALL share one selection.

#### Scenario: Selecting in either pane

- **WHEN** a user selects a term in the tree pane
- **THEN** the corresponding element is selected in the graph pane

#### Scenario: A facet with no counterpart

- **WHEN** a user selects a term carrying `@container: @set`
- **THEN** the tree pane shows the shape it produces
- **AND** the graph pane renders the absence explicitly rather than showing nothing

#### Scenario: A scoped context is drawn as a region

- **WHEN** a term carries its own context
- **THEN** the tree pane draws the extent over which it applies as a nested region

### Requirement: The projection carries the whole metamodel

The projection sent to the canvas SHALL carry every facet the metamodel can express.

#### Scenario: A facet added to the metamodel

- **WHEN** the metamodel gains a facet the canvas has no dedicated control for
- **THEN** the projection still carries it
- **AND** it is visible and editable through the inspector's raw escape hatch

### Requirement: Model file remains canonical and readable

Canvas edits SHALL be applied to the model file as targeted modifications. Comments,
key order and formatting elsewhere in the file SHALL be preserved.

#### Scenario: Editing a commented model

- **WHEN** a model file contains comments above several terms and the user renames one
  term on the canvas
- **THEN** every comment remains in place
- **AND** the only textual change is the renamed term

#### Scenario: Undo after a canvas edit

- **WHEN** a user makes a canvas edit and then invokes undo in the editor
- **THEN** the model file returns to its previous content

#### Scenario: Two edits from one gesture

- **WHEN** one canvas gesture produces two intents
- **THEN** both are applied in order against current file offsets
- **AND** neither overwrites the other

### Requirement: Text and canvas stay synchronized

The canvas SHALL reflect the model file as the single source of truth. Editing the file
directly SHALL update the canvas.

#### Scenario: Editing the file while the canvas is open

- **WHEN** a user adds a term by typing in the model file with the canvas open
- **THEN** both panes show the new term without being reopened

#### Scenario: File becomes structurally invalid

- **WHEN** a user types text that makes the model file unparseable
- **THEN** the canvas retains the last valid diagram and indicates the model is invalid
- **AND** the canvas does not go blank

### Requirement: Validation surfaces in the editor

Findings SHALL be reported as editor diagnostics at the position in the model file or
document that produced them.

#### Scenario: A finding is reachable from the canvas

- **WHEN** a finding is reported against a term
- **THEN** a diagnostic appears at that term in the Problems panel
- **AND** selecting it reveals the corresponding element on the canvas

### Requirement: Named views scope each diagram

A view SHALL name a subset of a model, forming one pair of diagrams. A user SHALL be
able to create a view and add or remove terms from it on the canvas.

#### Scenario: Focusing a subset

- **WHEN** a model has fifty terms and a user creates a view containing five
- **THEN** both panes show only those five

#### Scenario: Term belonging to no view

- **WHEN** a model contains a term that no view includes
- **THEN** validation reports it so it cannot be silently invisible

### Requirement: Layout persists and survives rename

Positions arranged by a user in the graph pane SHALL be stored separately from the
model's semantics, per view, keyed so that renaming a term does not move it.

#### Scenario: Rearranging and reopening

- **WHEN** a user arranges the graph pane and reopens the model later
- **THEN** the arrangement is preserved

#### Scenario: Renaming a positioned term

- **WHEN** a user renames a term that has been positioned
- **THEN** its box remains in the same position under its new name

#### Scenario: Moving a box does not change semantics

- **WHEN** a user drags a box to a new position and makes no other edit
- **THEN** the model file is unchanged

### Requirement: The webview does not assume an editor host

The webview SHALL reach its host through an interface covering reading the model,
applying an edit, resolving a vendored context, reporting a finding and persisting
layout.

#### Scenario: Driving the canvas without an editor

- **WHEN** the webview is driven by a non-editor host implementation in a test
- **THEN** every canvas action completes and produces the same model edits
