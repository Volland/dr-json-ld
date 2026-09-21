## Context

The motivation is in proposal.md, and the specs under `specs/` state what the system must do.

Where things stand today:

- A term's `@context` resolves to an opaque `InlineContext` value.
- The IR has no shapes.
- The processor expands and compacts but does not convert to RDF.
- `core`'s only runtime dependency is `yaml`.

This design depends on these `lat.md/` sections:

- [[lat.md/metamodel#Shapes]]
- [[lat.md/metamodel#Terms#Scoped Contexts]]
- [[lat.md/metamodel#Stable Element IDs]]
- [[lat.md/metamodel#Identity]]
- [[lat.md/validation#The Ladder#L3 Shape Conformance]]
- [[lat.md/emitters#Downstream Targets#SHACL Shapes]]
- [[lat.md/emitters#Capability Matrix]]
- [[lat.md/emitters#Change Management#Change Classification]]
- [[lat.md/processing#Source Mapping]]
- [[lat.md/architecture#Editing Surface#Intents]]
- [[lat.md/architecture#Editing Surface#Targeted edits]]
- [[lat.md/architecture#Panes#Tree pane]]
- [[lat.md/architecture#Layout]]

## Goals / Non-Goals

**Goals:**

- The work ships in four phases. Each one leaves the tool usable and can be released on its own:
  - **A.** Scoped terms.
  - **B.** Shapes in the model, with their L1 findings.
  - **C.** RDF conversion, the `shacl` target and L3.
  - **D.** The canvas.
- Field keys resolve through the processor's own context processing, never a second resolver.

**Non-Goals:**

- A shapes-aware compaction or frame. That belongs to the frame/JSON Schema pair in M3.
- A second format version of the model schema.

## Decisions

### 1. The metamodel changes (least reversible, so first)

**Scoped terms reuse the `@context` key; there is no new `scoped:` key.** When a term's `@context` is a map, each non-keyword entry is parsed with the same term parser as a top-level term, recursively. Its keyword entries (`@vocab`, `@propagate`, `@protected`, …) become settings of that scoped context.

- *Alternative, a separate `scoped:` key:* rejected. It would be a second way to say one thing, and import would have to choose between the two. It would also make the model file stop reading like the context it emits.
- *Why the `id` and `note` keys cannot collide:* they live inside a term definition, never at context-map level, and JSON-LD 1.1 forbids non-keyword keys in an expanded term definition. A scoped *term named* `id` is a map key, exactly as it is at the top level.

**The IR keeps `terms` as one flat array.** A scoped term gains `scope: { parent: <element id> }`, and each parent with a map context gains a `scopedContext` record holding its settings. A reference context (IRI or array) stays an `InlineContext` value, as today.

- Flat beats nested because diffing, projection, the layout sidecar and rename detection already walk one id-keyed array.
- A tree would have to be flattened again at every one of those consumers.

**Shapes are a new IR array of `IrShape { id, name, target, closed, note, fields }`.**

- `IrField` carries the key, the resolved term's element id, the IRI, `inverse`, `min`, `max` and a range.
- A range is a tagged union. Its `shape` variant holds the element id of the shape it names.
- A field has no element id of its own. Its identity is its shape plus the term it resolves to, which is exactly what makes a term rename carry the field with it.

**Effect on the lockfile and diffing.** The lockfile gains `scope`, `scopedContext` and `shapes`. The IR serializer's stable key order means that for models without scoped maps or shapes, only the lockfile's format marker changes.

Comparing against an older lockfile works as follows:

- A scoped context stored as a single value there is compared as a whole value.
- The report says the terms inside it could not be matched individually (see the version-comparison spec).
- A key moving between scopes is classified `breaking`.

**Effect on IRI stability and rename detection.**

- Promotion copies the IRI and mints a new element id. The top-level term stays in place and is still used by the other shape, so no triple changes for that shape's documents.
- A scoped term's derived id includes its parent's key, so it is stable across reloads but not across a parent rename. This is the same contract top-level derived ids already have.
- Node shapes are minted as `<namespace base><ShapeName>Shape`. Renaming a shape therefore changes that IRI, which the `shacl` header records.

### 2. Field keys resolve in the processor's active context

- For each shape, the resolver asks the processor for the active context applied to a node typed with the target class: the model context plus the class term's type-scoped context.
- It then resolves each field key there.
- For every field whose range is `{ shape: S }` and whose term carries a property-scoped context, `S`'s keys are resolved a second time under that context. A different answer is `L1.shape-field-ambiguous`.

*Alternative, a model-level lookup (scoped terms, then top-level):* rejected. It would diverge from expansion exactly where the processor has known gaps (`tc012`, `tc019`, `tc024`, `tc028`), and L3 would then contradict L1 with nobody able to say which was right.

### 3. RDF conversion is implemented here

- It is the JSON-LD 1.1 Deserialize-to-RDF algorithm over the expanded output, which already carries pointers.
- Each emitted quad is paired with `{ subject, predicate, object }` pointers.
- Blank nodes are labelled in document order, so labels are deterministic.
- Canonicalization for comparison is delegated to `rdf-canonize`, per decision 7.

*Alternative, `jsonld.js` `toRdf` with pointers re-derived afterwards:* rejected. The pointer is the feature, and re-deriving it would mean matching triples back to input by value, which is ambiguous for repeated values.

This affects the source map: it gains a triple-level entry type. The trace gains one step kind, `emit-triple`, which appears only in traced mode.

It touches W3C suite class `toRdf`, which gets its own ratchet. The differential test compares against `jsonld.js` `toRdf` after canonicalization.

### 4. The SHACL engine

The authority is `rdf-validate-shacl`:

- MIT licensed, pure JS and RDF/JS based, so it runs offline in Node and the extension host.
- It covers SHACL Core.
- It returns nested results for `sh:node` as `detail`, which is what locates a violation inside a nested shape.

Turtle is parsed and written with `n3`. The execution test runs `shacl-engine` as a second, independent engine over `jsonld.js`-produced RDF. Disagreement between the two engines fails the build, and the case is recorded under Measured behaviour.

**Amended during implementation.** The first draft named `shacl-engine` as the authority. At 1.1.2, `shacl-engine` depends on Comunica, a full SPARQL engine for SHACL-SPARQL, which this change lists as a non-goal. Shipping that in `core` and in the `.vsix` was not worth it, so the roles were swapped: the lighter engine is the authority, and the heavier one is a dev dependency used only to check it.

The phase C spike confirmed that both engines report the nested `sh:node` violation (a `sh:MinCountConstraintComponent` on the nested focus node) offline in Node. So the focus-node fallback was not needed.

- *Alternative, a structural validator over the compacted JSON:* rejected by [[lat.md/validation#The Ladder#L3 Shape Conformance]].

`rdf-validate-shacl` and `n3` become runtime dependencies of `core`. No `vscode` import is introduced, and the lint rule plus source-scan test stay in force.

### 5. Mapping a violation back to the document

- The finding's pointer is chosen by the `(focusNode, resultPath, value)` of the violation:
  - When a value is present, it is the object pointer of the triple `(focus, path, value)`.
  - `L3.closed` uses that triple's predicate pointer, which is the key.
  - `L3.min-count` uses the focus node's subject pointer.
- An inverse path looks up the reversed triple.
- Line and column come from the existing pointer resolver.

### 6. The `shacl` target and its capability set

| capability | `shacl` |
|---|---|
| `shapes` | `full` |
| `documentation` | `full` — `sh:description` |
| `prefixes` | `full` — Turtle prefixes |
| `terms` | `none` — coercion is a context fact; ranges carry what SHACL needs |
| `external-reference` | `none` — referenced contexts do not affect the shapes graph |
| `element-ids` | `none` |
| `examples` | `none` |

It raises two downgrades. Both are site-level diagnostics plus a Turtle `#` comment at the property shape:

- **list cardinality** — counts distinct members through `rdf:rest*/rdf:first`, not list positions
- **graph-container field** — no constraint is emitted

Unlike JSON, Turtle has comments, so this artifact needs no stripping step before the execution test.

The context targets gain `shapes: none`. They still differ only in `external-reference`, and the existing test asserting that is extended.

### 7. The model schema stays at format 1

- `shapes` is added as a new optional top-level property.
- A scoped `@context` map's values validate as `anyOf: [term definition, {}]`. This gives completion and hover from the term definition while rejecting nothing the old schema accepted.
- The schema can therefore be published in place, per model-schema-publication.
- A stricter nested schema would reject files the served schema accepted, so it would need format 2. It is not done here.

### 8. `ldm check` runs to the highest available level

- A model with shapes is checked through L3 by default.
- A model without shapes stops at L2, exactly as today.
- `--level` still caps it.

Consequence: adding a shape makes every positive example a conformance test, which is decision 13 working as intended.

### 9. The canvas

- **New intents:** `add-scoped-term`, `add-shape`, `add-field`, `set-field`, `remove-field`, `promote-term`.
  - Each produces one set of targeted splices and becomes one `WorkspaceEdit`, so it is one undo step.
  - `add-field` for a new key and `promote-term` each touch two places, and the host computes both splices against the same text.
- **Rename cascade:** renaming a term also rewrites every field key that resolves to its element id and every view entry.
- **Inspector:** a field table component. The range picker offers the declared prefixes' datatypes (from vendored contexts), class terms and shape names.
- **Promotion:** offered in the document, per [[lat.md/architecture#Editing Surface#Asking]].
- **Tree pane:** draws the selected shape's skeleton from the projection. A recursion is drawn once as a reference.
- **Graph pane:** draws a shape as its class node with a field list, and edges for class and shape ranges labelled `min..max`.
- **Layout sidecar:** positions for shapes are keyed by shape element id. The tree pane still persists nothing.

All of this lands in `vscode` (webview plus host). The field-table logic that computes splices lives in `core/edit`, so it is testable in Node.

## Risks / Trade-offs

- [Known type-scoped reversion gaps make field resolution and L3 disagree with `jsonld.js` on some documents] → The engine-agreement test surfaces them per example, `L1.shape-field-ambiguous` flags the riskiest pattern at authoring time, and fixing `tc012`/`tc019`/`tc024`/`tc028` is scheduled early in phase A.
- [Two new runtime dependencies grow the `.vsix` and the CLI] → Both are small pure-JS packages. **Measured in phase C:**
  - The bundled `dist/extension.cjs` grew from 215 KB (0.3.0) to 668 KB, minified. The webview bundle is unchanged.
  - The CLI, which runs from `node_modules` rather than a bundle, gains about 2.5 MB of installed dependencies: `n3`, `rdf-validate-shacl`, `clownface`, `@rdfjs/*`, `@vocabulary/sh`, `rdf-literal` and `rdf-validate-datatype`.
  - L3 was run from a CommonJS bundle built the way the extension's is, and gave the same findings as in Node ESM.
- [`rdf-validate-shacl`'s `validate()` is async only to load `owl:imports`] → L3 calls the synchronous steps behind it (`setDataGraph`, `validationEngine.validateAll`, `getReport`), so `validateModel` stays synchronous and nothing that calls it changes. An emitted shapes graph never declares `owl:imports`. If a later release moves those steps, the conformance and execution tests fail rather than the check silently passing.
- [Nested result details differ between engines] → The focus-node fallback (decision 4) keeps the shapes graph untouched.
- [The builder hides the global-term rule so well that authors stop understanding it] → Promotion is always asked, never silent, and the inspector labels each fact with the artifact that carries it.
- [`ldm check` newly fails in CI for a model that just gained a shape] → This is intended. The failure names the example and the rule, and `--level 2` restores the old behaviour explicitly.

## Migration Plan

- No model file needs editing. Existing scoped contexts become scoped terms with derived ids, and `ldm ids` writes real ones as a targeted edit.
- Emitted contexts are semantically unchanged. Header bytes change once.
- Rollback is dropping the release: format 1 files written with `shapes` are refused only by an older extension's schema, and never by a model that did not use them.

## Open Questions

- Whether `sh:targetClass` should also be emitted as `sh:targetSubjectsOf` for classes that documents commonly omit. This can be decided from the first real credential fixtures without changing the specs.
