## Why

A model is a flat list of terms. It cannot say that a `VerifiableCredential` has an `issuer`, a `validFrom` and one or more `credentialSubject`s, and a scoped context, which every credential context is built from, is an opaque blob the canvas cannot edit. This is planned milestone 2, not a pull-forward.

## What Changes

- **Scoped contexts become first-class.** Each term definition inside a term's `@context` map resolves as a term: element id, facets, inspector, diagram. No new YAML key; existing files keep their meaning.
- **The shapes layer.** A `shapes:` map. Each shape has an element id, a target class, open or closed, and fields that name a term and state `min`, `max` and a `range`: datatype, language string, any node, class, or another shape.
- **L1 shape findings**: unresolvable field key, range contradicting coercion, unknown target or shape.
- **New `shacl` target**, with downgrades for what SHACL cannot say.
- **Validation L3**: a real SHACL engine runs over each example's RDF, mapping violations to JSON Pointers.
- **RDF conversion is implemented here** so every triple keeps its source pointer.
- **Shape builder.** Selecting a class opens its fields as a table in the inspector,; the tree pane draws a conforming document's JSON skeleton. When one key needs a different coercion in two classes, the builder offers to move it into a type-scoped context and says so.
- Version comparison classifies shape and scope differences.

## Capabilities

### New Capabilities

- `shape-modeling`: the shapes layer, field-key resolution and model-level shape findings.
- `shacl-generation`: the `shacl` target and its downgrades.

### Modified Capabilities

- `model-format`: ids and key uniqueness for scoped terms; shapes in the file.
- `document-validation`: L3 becomes available.
- `jsonld-processing`: RDF conversion with source pointers.
- `context-generation`: scoped terms are emitted from the IR; `shapes` is a `none` capability.
- `context-import`: scoped contexts import as nested terms.
- `visual-modeling`: scoped terms and shapes are authored on the canvas.
- `version-comparison`: classifies shape and scope differences.

## Targets affected

`context` and `context-inline`: byte-identical for existing models apart from the capability header. `shacl`: new. Other targets are untouched.

## Locked decisions

Implements 4 and 6 unamended. Consistent with 7: RDF conversion joins the processor because L3's pointers depend on it; framing, canonicalization and N-Quads stay delegated. 14 holds: no third pane.

## Open questions settled

- **Shapes own cardinality, terms own coercion.** A field may narrow a range but never re-coerce a key. A conflicting coercion is a finding, and its repair is a type-scoped context.
- **Creating a scoped context on the canvas:** add a scoped term in the inspector, or accept the builder's offer to promote a key.

## Non-goals

The instance-graph overlay; inferring shapes on import; enumerations, patterns, lengths and numeric bounds; SHACL-SPARQL; named graphs; frame, JSON Schema and types.

## Impact

Mostly `core`. A SHACL engine becomes a runtime dependency. The model schema accepts `shapes:` in place, at format 1. `vscode`: the projection, intents, the inspector and both panes. `cli`: `ldm check --level 3` and `ldm emit --target shacl`.
