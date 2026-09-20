## Purpose

Defines what an editor must actually provide for a model file or a project file:
which component executes the published JSON Schema, which schema constructs may be
relied on to fire while the user types, and which findings carry a repair the user
can apply without leaving the file.

## ADDED Requirements

### Requirement: The editor's schema execution is a declared dependency

The extension SHALL declare the component that executes a published JSON Schema against
a YAML file as a hard dependency, so that installing the extension installs it. The
extension SHALL NOT rely on a contribution point that the installed set of components
does not read. Documentation describing schema-driven completion SHALL name the
component that provides it.

#### Scenario: Installing into a clean editor

- **WHEN** the extension is installed into an editor carrying no other extension
- **THEN** the component that executes the schema is installed with it
- **AND** opening a model file offers completion from the model schema
- **AND** a structural error in the model file is underlined without any command being run

#### Scenario: A contribution point nothing reads

- **WHEN** the extension declares a schema through a contribution point that no installed component reads for the file pattern it names
- **THEN** the build fails naming the contribution point and the file pattern

#### Scenario: Documentation claims support the mechanism does not give

- **WHEN** the extension's documentation states how schema-driven completion arrives
- **THEN** it names the component that executes the schema
- **AND** it does not claim that nothing needs installing

### Requirement: Each schema is contributed for the files it governs

Each published JSON Schema SHALL be contributed for exactly the file pattern it governs
— the model schema for a `.jsonld.yaml` model file, the project schema for the project
file — through the contribution point that the declared dependency reads. A schema
SHALL NOT be contributed through a point that cannot apply to the file pattern named.

#### Scenario: Every published schema is contributed

- **WHEN** the extension manifest is compared against the set of published schemas
- **THEN** each schema appears once for the file pattern it governs
- **AND** no schema is contributed that the library does not publish

#### Scenario: Opening a project file

- **WHEN** a project file is opened
- **THEN** completion and structural errors come from the project schema

### Requirement: A schema refusal is executable by the editor

Where a schema expresses a refusal, that refusal SHALL be expressed in a form the
editor's schema execution actually evaluates, or the refusal SHALL be recorded as
command-only. A refusal recorded as command-only SHALL still be reported by validation
with its rule id, and the record SHALL name the rule id that reports it.

#### Scenario: A constraint the editor cannot evaluate

- **WHEN** a schema constraint is written with a keyword the editor's schema execution ignores
- **THEN** the build fails unless the constraint is recorded as command-only
- **AND** the record names the rule id that reports the same fact

#### Scenario: An editor-executable refusal fires while typing

- **WHEN** a model file violates a schema refusal that is not recorded as command-only
- **THEN** the editor underlines it without a command being run

#### Scenario: A command-only refusal still fails the build

- **WHEN** a model file violates a refusal recorded as command-only
- **THEN** `ldm check` reports it at error severity with its rule id
- **AND** `ldm check` exits non-zero

### Requirement: A finding with one unambiguous repair offers a quick fix

The system SHALL maintain a registry naming, for each rule id, whether a finding of that
rule has an unambiguous repair. Where one exists, the editor SHALL offer it as a quick
fix on the diagnostic carrying that rule id, titled with what it will do. A rule id
absent from the registry SHALL offer no quick fix rather than a guessed one. A quick fix
whose repair changes what the model means SHALL say so in its title.

#### Scenario: A repairable finding

- **WHEN** a diagnostic carries a rule id the registry names as repairable
- **THEN** a quick fix is offered on that diagnostic
- **AND** its title states what applying it will do

#### Scenario: A finding with no single repair

- **WHEN** a diagnostic carries a rule id the registry does not name
- **THEN** no quick fix is offered for it

#### Scenario: Applying a quick fix resolves the finding

- **WHEN** a quick fix is applied to a finding
- **THEN** re-validating the model no longer reports that finding at that position
- **AND** no finding at error severity that was absent before is introduced

#### Scenario: A repair that changes meaning

- **WHEN** a quick fix would change the RDF a document produces rather than only the model's legality
- **THEN** its title says that it changes what the model means

### Requirement: A quick fix is a targeted edit

A quick fix SHALL reach the file as a targeted edit computed from the YAML syntax tree,
never as a re-serialization of the document. Comments, key order and formatting outside
the repaired region SHALL survive unchanged, and the edit SHALL be undoable as one step.

#### Scenario: A commented model is repaired

- **WHEN** a quick fix is applied to a model file carrying comments and a non-alphabetical key order
- **THEN** the resulting diff touches only the repaired region
- **AND** every comment and the key order elsewhere are unchanged

#### Scenario: Undoing a quick fix

- **WHEN** a quick fix is applied and undone
- **THEN** the file is byte-identical to what it was before
