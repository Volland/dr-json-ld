## 1. Phase A — Scoped terms in the IR

- [x] 1.1 Extend `IrTerm` with `scope: { parent }` and add the `scopedContext` settings record; keep reference contexts as `InlineContext`
- [x] 1.2 Parse a map-valued `@context` recursively with the top-level term parser, including shorthand string entries and keyword settings
- [x] 1.3 Make key uniqueness per context map and element-id uniqueness model-wide; derived ids for scoped terms include the enclosing keys
- [x] 1.4 Extend id backfill to scoped terms, rewriting a shorthand entry to a mapping as a targeted splice; test that comments survive
- [x] 1.5 Order scoped terms by element id in the serialized IR; add the reorder-is-a-no-op test
- [x] 1.6 Emit scoped contexts from scoped terms in `context` and `context-inline`, dropping ids and notes; golden files show only header churn for the bookshelf and every existing fixture
- [x] 1.7 Execution test: every emitted context with scoped terms is loaded by `jsonld.js` and expands every example identically to the pre-change emit
- [x] 1.8 Import a map-valued scoped context as scoped terms with written ids; add a VC v2–style fixture context with a protected type-scoped context
- [x] 1.9 Confirm the import round trip still holds: semantic equality, and import-emit-import-emit is byte-identical, including the new fixture
- [x] 1.10 Close the type-scoped reversion gaps `tc012`, `tc019`, `tc024`, `tc028`; raise the expand ratchet; rerun the differential against `jsonld.js` and record the outcome
- [x] 1.11 Model schema: `@context` map values validate as `anyOf: [term, {}]`; extend the accept corpus; assert every previously accepted corpus file is still accepted

## 2. Phase A — Scoped terms in comparison

- [x] 2.1 Lockfile carries `scope` and `scopedContext`; older lockfiles fall back to whole-value comparison of the scoped context, with the report note
- [x] 2.2 Classify a term moving between context maps as `breaking`, naming the old and new scope; add diff tests

## 3. Phase B — The shapes layer in the model

- [x] 3.1 Add `IrShape`, `IrField` and the range union to the IR; parse `shapes` from YAML, and `shapes` in views
- [x] 3.2 Resolve target classes and field keys through the processor's active context for a node of the target class (design decision 2)
- [x] 3.3 Record `@reverse` fields as inverse; order fields by resolved term id; add the reorder-is-a-no-op test
- [x] 3.4 Rules `L1.shape-unknown-target`, `L1.shape-unknown-shape`, `L1.shape-field-unresolved`, `L1.shape-field-is-nest` and `L1.shape-cardinality-invalid`, each with a pointer to the field or shape
- [x] 3.5 Rules `L1.shape-range-coercion-conflict` and `L1.shape-range-needs-id-coercion`, covering the datatype, language-map and reference cases
- [x] 3.6 Rule `L1.shape-field-ambiguous`, by re-resolving under a property-scoped context; rule `L2.shape-unused-in-view`
- [x] 3.7 Negative-example fixtures, one per rule from 3.4–3.6, each declaring its rule id; a recursive shape fixture that raises nothing
- [x] 3.8 Model schema: add `shapes` (fields, `min`/`max` bounds, the range forms) at format 1; extend the accept and reject corpora; regenerate the schema reference page; verify the copies are identical
- [x] 3.9 Lockfile carries shapes; shape and field classification (additive for a new class, breaking for tightening or a new shape on an existing class, compatible for loosening, breaking under ambiguity); diff tests

## 4. Phase C — RDF conversion

- [x] 4.1 Implement Deserialize JSON-LD to RDF over the expanded output, with deterministic blank-node labels
- [x] 4.2 Carry subject, predicate and object pointers per triple; add the `emit-triple` trace step; test that every pointer resolves
- [x] 4.3 Conformance: run the W3C `toRdf` class, canonicalized through `rdf-canonize`; set its ratchet; list failures by cause
- [x] 4.4 Differential: compare against `jsonld.js` `toRdf` after canonicalization over every in-scope case; record the divergences under Measured behaviour

## 5. Phase C — The `shacl` target

- [x] 5.1 Spike: confirm the authority engine gives nested `sh:node` details offline in Node and in the extension host; if not, adopt the focus-node fallback. Record the result (roles swapped: `rdf-validate-shacl` is the authority, `shacl-engine` the test-only engine — see design decision 4)
- [x] 5.2 Add `n3` and `rdf-validate-shacl` as `core` runtime dependencies (`shacl-engine` as a dev dependency); the package-boundary test still passes with no `vscode` import
- [x] 5.3 Emitter: node shapes, property shapes, inverse paths, `sh:closed`/`sh:ignoredProperties`, `sh:description`, prefixes, and a deterministic order
- [x] 5.4 Capability set for `shacl`; downgrades for list cardinality (the `rdf:rest*/rdf:first` path) and graph-container fields, as a diagnostic plus a Turtle comment
- [x] 5.5 Add the `shapes: none` capability and header line to the context targets; extend the test that they differ only in `external-reference`
- [x] 5.6 Golden files for the `shacl` target over the credential and bookshelf fixtures
- [x] 5.7 Execution test: parse the output with `n3`, validate every example (as `jsonld.js` RDF) with `shacl-engine`, and assert agreement with the declared outcomes and with `rdf-validate-shacl`
- [x] 5.8 `ldm emit --target shacl` in the CLI with a test

## 6. Phase C — Validation at L3

- [x] 6.1 Run L3: own RDF conversion → `rdf-validate-shacl` against the emitted shapes graph; map constraint components to `L3.*` rule ids at error severity
- [x] 6.2 Map violations to pointers by `(focus, path, value)` (design decision 5), including inverse paths and nested details
- [x] 6.3 Add `L3.no-target` at info severity
- [x] 6.4 `ldm check` runs to L3 by default when the model has shapes; `--level` caps it; L4 reports unavailable
- [x] 6.5 Negative examples for `L3.min-count`, `L3.max-count`, `L3.datatype`, `L3.node-kind`, `L3.class`, `L3.node`, `L3.closed` and `L3.no-target`, plus a positive credential example
- [x] 6.6 Test that L3 diagnostics surface against the example document in the extension, with the rule id as code
- [x] 6.7 Measure the `.vsix` and CLI bundle-size change and record it

## 7. Phase D — Canvas: scoped terms

- [x] 7.1 Projection carries scoped terms, their settings and shapes; update the projection test
- [x] 7.2 `add-scoped-term` intent and inspector action; the tree pane draws scoped terms inside their region; graph-pane selection distinguishes same-key terms
- [x] 7.3 Rename cascade: renaming a term rewrites field keys and view entries in one edit; test single-step undo

## 8. Phase D — Canvas: shape builder

- [x] 8.1 Splice builders in `core/edit` for `add-shape`, `add-field`, `set-field` and `remove-field`, with Node tests including comment preservation
- [x] 8.2 Inspector field table with a range picker (datatypes, class terms, shapes), cardinality inputs and a "carried by `shacl`, absent from `@context`" marker
- [x] 8.3 Adding a field for a new key asks for the IRI in the document and adds term and field in one edit
- [x] 8.4 Graph pane: shape nodes with field lists, and range edges labelled `min..max`; the layout sidecar keys shapes by element id
- [x] 8.5 Tree pane: skeleton of the selected shape, with nested shapes, container forms, scoped regions, and recursion drawn once
- [x] 8.6 `promote-term` intent: offered in the document on a coercion conflict; creates the class term first if missing; one undo step; test that the conflict finding is gone and the other shape is unchanged
- [x] 8.7 Test via the non-editor host adapter: describe the credential entirely from the canvas and compare the model file to the expected one
- [x] 8.8 Extend the webview source-scan test to the new components (no `window.prompt`/`confirm`/`alert`)

## 9. Documentation and wrap-up

- [x] 9.1 Add a credential example under `examples/` with shapes, a positive example and a negative example
- [x] 9.2 Update the authoring skills (designing a vocabulary, writing the model file) for shapes and scoped terms
- [x] 9.3 Update `lat.md/`:
  - `metamodel#Shapes` and `metamodel#Terms#Scoped Contexts`: as built
  - `validation#The Ladder#L3 Shape Conformance`: as built
  - `emitters#Downstream Targets#SHACL Shapes`: as built
  - `emitters#Capability Matrix#Shipped capability sets`: add `shacl` and `shapes`
  - `processing`: RDF conversion
  - `architecture#Editing Surface`: shape builder and promotion
  - `architecture#Roadmap`: M2 status
- [x] 9.4 Run `lat check` and fix every failure
