## Purpose

Defines the `shacl` target: the shapes layer emitted as a SHACL shapes graph in Turtle. The same graph is the authority for L3 validation, so a consumer running the shipped file gets the same verdict the tool gives.

## ADDED Requirements

### Requirement: The shacl target emits the shapes layer

The `shacl` target SHALL emit one Turtle document holding a `sh:NodeShape` for every shape in the model. Each emitted shape SHALL name the shape's target class with `sh:targetClass` and SHALL carry one `sh:property` per field. A field's path SHALL be the IRI its key resolves to, or `sh:inversePath` of that IRI for a `@reverse` term. The model's prefixes SHALL be emitted as Turtle prefixes.

#### Scenario: Emitting a credential shape

- **WHEN** a model with a shape `Credential` targeting `cred:VerifiableCredential` is emitted to the `shacl` target
- **THEN** the artifact contains a node shape with `sh:targetClass cred:VerifiableCredential`
- **AND** one property shape per declared field

#### Scenario: A model without shapes

- **WHEN** a model declaring no shapes is emitted to the `shacl` target
- **THEN** the artifact carries its header and no node shape
- **AND** a finding at info severity states that the model declares no shapes

### Requirement: Field constraints map to SHACL core

A field SHALL map to SHACL core constraints:

| model | SHACL |
|---|---|
| `min` | `sh:minCount` |
| `max` | `sh:maxCount` |
| `iri` | `sh:nodeKind sh:IRI` |
| `node` | `sh:nodeKind sh:BlankNodeOrIRI` |
| `literal` | `sh:nodeKind sh:Literal` |
| `langString` | `sh:datatype rdf:langString` |
| a datatype | `sh:datatype` |
| `{ class }` | `sh:class` |
| `{ shape }` | `sh:node` naming the emitted shape |

A closed shape SHALL emit `sh:closed true` with `rdf:type` among `sh:ignoredProperties`. A shape's or field's `note` SHALL be emitted as `sh:description`.

#### Scenario: A closed shape

- **WHEN** a shape declares `closed: true`
- **THEN** the emitted node shape carries `sh:closed true`
- **AND** `rdf:type` is listed in `sh:ignoredProperties`

#### Scenario: A nested shape

- **WHEN** a field's range is another shape
- **THEN** its property shape carries `sh:node` pointing at that shape's emitted node

### Requirement: The shacl target declares its capabilities and downgrades

The `shacl` target SHALL declare its capability set. A field whose constraint SHACL cannot state as the model means it SHALL be a downgrade. The downgrade SHALL appear as a diagnostic at the field in the model and as a `#` comment at the property shape in the artifact.

#### Scenario: Cardinality on a list

- **WHEN** a field states `min` or `max` for a key whose term has `@container: @list`
- **THEN** the property shape constrains the list's members through an `rdf:rest*/rdf:first` path
- **AND** a downgrade states that SHACL counts distinct members, not list positions

#### Scenario: A field on a graph container

- **WHEN** a field's key resolves to a term with `@container: @graph`
- **THEN** the artifact carries a comment at that field saying no constraint is emitted
- **AND** a downgrade diagnostic states that values in a named graph are not reached by the shapes graph

#### Scenario: What SHACL does not carry

- **WHEN** a model is emitted to the `shacl` target
- **THEN** the header names `terms` coercion, `element-ids` and `examples` as `none`

### Requirement: The SHACL artifact identifies itself

The emitted Turtle SHALL begin with the same generated-artifact header as every other target: it SHALL name the model and, inside a version, the version identity and project.

#### Scenario: Reading a generated shapes graph

- **WHEN** an emitted SHACL artifact is opened
- **THEN** its leading comments state that it is generated and from which model

### Requirement: Emitted SHACL is executed, not only snapshotted

The emitted shapes graph SHALL be parsed by an independent Turtle parser and executed by an independent SHACL engine against every example's RDF. The engine's verdict SHALL agree with the example's declared L3 outcome.

#### Scenario: A positive example conforms

- **WHEN** a positive example is converted to RDF by an independent JSON-LD implementation and validated against the emitted shapes graph
- **THEN** the engine reports conformance

#### Scenario: A negative example fails for its declared reason

- **WHEN** a negative example declaring `L3.min-count` is validated the same way
- **THEN** the engine reports a `sh:MinCountConstraintComponent` violation
