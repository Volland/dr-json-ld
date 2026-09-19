## Purpose

Defines the project: the unit that holds several models together, says where their
published output goes, and gives every command one place to resolve a model from
rather than a bare file path.

## ADDED Requirements

### Requirement: A project declares the models it contains

A project SHALL be declared by a single file at the root of the directory that holds
it. The file SHALL name the models belonging to the project and the directory into
which published versions are written. A model SHALL belong to at most one project.

#### Scenario: Resolving a model by name

- **WHEN** a command is given a project and a model name the project declares
- **THEN** the command operates on that model
- **AND** the command reports the same findings it would report for the model's path

#### Scenario: A model the project does not declare

- **WHEN** a command names a model the project file does not list
- **THEN** the command fails naming the model and listing the models the project declares
- **AND** no artifact is generated

#### Scenario: A model claimed by two projects

- **WHEN** two project files in one repository both declare the same model
- **THEN** validation reports an error naming both projects and the model

### Requirement: A project resolves from a working directory

Commands SHALL locate the project by searching upward from the working directory. A
command run outside any project SHALL continue to operate on a single model given by
path.

#### Scenario: Running inside a project

- **WHEN** a command is run in a subdirectory of a project with no project named
- **THEN** the enclosing project is used

#### Scenario: Running with no project at all

- **WHEN** a command is given a model path and no project exists above it
- **THEN** the command operates on that model alone
- **AND** reports that no project was found only if the command requires one

### Requirement: Views remain scoped to one model

A view SHALL name terms of exactly one model. The project SHALL NOT introduce a view
spanning several models.

#### Scenario: A view naming a term from another model

- **WHEN** a view names a term that its own model does not declare
- **THEN** validation reports an error at that view naming the term

### Requirement: A project is checked as a whole

Checking a project SHALL check every model it declares and report the findings of all
of them together, in the deterministic order findings already use.

#### Scenario: One model in a project fails

- **WHEN** a project is checked and one of its models produces an error finding
- **THEN** the check fails
- **AND** the output names which model produced each finding
