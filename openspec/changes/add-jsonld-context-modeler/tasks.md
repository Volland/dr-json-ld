## 1. Repository and package skeleton

- [ ] 1.1 Create the npm workspace with `packages/core`, `packages/cli`, `packages/vscode`; TypeScript base config, ESLint, Vitest, MIT licence
- [ ] 1.2 Add the ESLint rule and the source-scanning test that forbid any `vscode` import from `core`, and prove both fail on a deliberately added import
- [ ] 1.3 Add continuous integration running build, lint and test on every push, with the network disabled for the test job

## 2. Model format and JSON Schema

- [ ] 2.1 Write the JSON Schema 2020-12 for `.jsonld.yaml` in `core`: `jsonld`, `namespace`, `mode`, `uses`, `terms`, `examples`
- [ ] 2.2 Extend the schema to every JSON-LD 1.1 term facet — `@id`, `@type`, `@container`, `@language`, `@direction`, `@protected`, `@context`, `@nest`, `@reverse`, `@prefix`, `@index` — plus the per-term raw escape hatch
- [ ] 2.3 Copy the schema into `packages/vscode`, contribute it via `contributes.jsonValidation`, and add the test asserting the two copies are byte-identical
- [ ] 2.4 Write the scaffold template used by `ldm init` and by the extension's new-model command, holding written ids and one seeded term, and a test that resolves and emits from it

## 3. Parse, resolve and the IR

- [ ] 3.1 Parse a model with the `yaml` Document API, retaining source locations for every term and facet
- [ ] 3.2 Define the IR and resolve a model into it: namespace, mode, prefixes, referenced contexts, terms with facets, examples
- [ ] 3.3 Implement the IR serializer with arrays ordered by element id and object keys sorted, plus a test that it is byte-identical on repeat and unchanged by reordering declarations — the lockfile prerequisite
- [ ] 3.4 Report model-level errors as findings with locations: unknown prefix, duplicate key, malformed IRI, facet illegal for the declared mode

## 4. Element ids

- [ ] 4.1 Mint, backfill and write element ids onto terms and examples as a targeted splice, preserving comments and key order
- [ ] 4.2 Derive ids from the key when absent, record `idWritten` on the IR element, and add a helper listing elements with derived ids
- [ ] 4.3 Tests: a hand-written model, a fully backfilled model, a model with one missing id, and a rename that preserves the id

## 5. Expansion with provenance

- [ ] 5.1 Implement the active-context construction algorithm, including term definitions, prefixes, `@vocab` and `@base`
- [ ] 5.2 Implement type-scoped and property-scoped contexts and `@propagate`
- [ ] 5.3 Implement the expansion algorithm over the provenance envelope, so every node, value and dropped key carries the JSON Pointer of its input
- [ ] 5.4 Implement value expansion: coercion by `@type`, language maps, `@direction`, value objects, `@json`
- [ ] 5.5 Implement every `@container` form — `@list`, `@set`, `@index`, `@id`, `@type`, `@language`, `@graph` — and `@nest`, `@reverse`, `@included`
- [ ] 5.6 Add the pointer-to-line/column resolver over the parsed document, and the public API that strips the envelope to bare expanded JSON
- [ ] 5.7 Property test: every pointer produced by an expansion resolves to a node that exists in the input

## 6. Compaction

- [ ] 6.1 Implement the inverse-context construction and term selection
- [ ] 6.2 Implement the compaction algorithm, including container and language-map reconstruction
- [ ] 6.3 Property test: expand, compact and expand again reaches a fixed point for every example and every suite case in scope

## 7. Conformance

- [ ] 7.1 Vendor the W3C JSON-LD 1.1 test suite as a fixture and write the harness that runs a named class of it
- [ ] 7.2 Run the **expand** class; record passes, failures and the reason for each failure
- [ ] 7.3 Run the **compact** class and the network-free **remote-context** cases; mark **frame**, **toRdf** and **fromRdf** explicitly out of scope rather than skipping them silently
- [ ] 7.4 Add the differential test running every in-scope case through `jsonld.js` and deep-comparing the bare output
- [ ] 7.5 Resolve every divergence found in 7.4 and record the finding — and which implementation was right — in the config's measured-behaviour section

## 8. Trace

- [ ] 8.1 Emit a trace entry at each instrumentation point already added for provenance: term lookup, IRI resolution, active-context change, value coercion, key dropped
- [ ] 8.2 Add traced mode as opt-in, assert it is off by default, and test that a traced run and an untraced run produce identical output

## 9. Validation L0 to L2

- [ ] 9.1 Define the finding shape and the deterministic ordering, and route L0 well-formedness findings through it
- [ ] 9.2 Implement L1: context errors raised by active-context construction, located at the term in the *model* rather than in a generated artifact
- [ ] 9.3 Implement L1 protected-term violation detection against a vendored referenced context
- [ ] 9.4 Implement L2 findings recorded during expansion: key dropped, IRI left relative, blank node minted where an identifier was expected, coercion did not fire
- [ ] 9.5 Implement the L2 coverage direction — terms defined but unused — at a lower severity
- [ ] 9.6 Write the rule-id registry with a test that every emitted finding names a registered id, and that no id is reused
- [ ] 9.7 Negative-example task: fixture documents for each L1 and L2 rule, each asserting the exact rule ids raised and their pointers

## 10. Context resolution

- [ ] 10.1 Implement the vendor directory layout, the hash record on the model, and the offline reader
- [ ] 10.2 Implement the fetcher: redirect following, content-type requirement, no `Link`-header indirection; it is the only network code in the repository
- [ ] 10.3 Implement `--check`: verify hashes without fetching, as the continuous-integration form
- [ ] 10.4 Tests: hash mismatch is a hard error naming the entry; every command other than vendor fails closed when the vendor directory is missing rather than fetching

## 11. Emit targets

- [ ] 11.1 Implement the capability matrix and the downgrade diagnostic plus artifact-comment mechanism
- [ ] 11.2 Implement the `context` target: referenced array form, generated-file header, model-derived term order
- [ ] 11.3 Implement the `context-inline` target: flatten from vendored copies, and emit a downgrade per absorbed context naming it and its hash
- [ ] 11.4 Implement the mode-1.0 downgrade: a 1.1-only facet still emits, with a diagnostic saying what a 1.0 processor will do instead
- [ ] 11.5 Golden-file tests for both targets across the fixture models
- [ ] 11.6 Execution test: load each emitted context in `jsonld.js` and round-trip every example document through it

## 12. Import

- [ ] 12.1 Implement `import`: prefixes, `@vocab`, terms and every facet into a model, with ids minted and referenced contexts recorded in `uses`
- [ ] 12.2 Vendor referenced contexts as part of the import, so the on-ramp is one command
- [ ] 12.3 Report what a context cannot carry — class membership, documentation, intent behind `@vocab` — rather than inventing it
- [ ] 12.4 Property test: import then emit is semantically equal to the input under a normalizing comparison, and import-emit-import reaches a fixed point

## 13. CLI

- [ ] 13.1 Implement `ldm check`, `emit` and `ids` with the exit codes from design D11
- [ ] 13.2 Implement `ldm import`, `vendor` and `explain --trace`
- [ ] 13.3 CLI tests: gating on level, `--json` output stability, missing vendor directory, hash mismatch, and usage errors

## 14. Extension and host adapter

- [ ] 14.1 Define the host adapter interface and implement it over VS Code messaging; add a plain-Node implementation used by tests
- [ ] 14.2 Wire diagnostics: every finding to the Problems panel at its resolved location
- [ ] 14.3 Implement the new-model command, the model-finding fallback chain, and the command wrapper that reports rather than swallows a rejection
- [ ] 14.4 Implement intents and targeted splices for creating, renaming, retyping and deleting a term, with host-side serialization of intents
- [ ] 14.5 Test that no webview source calls `window.prompt`, `window.confirm` or `window.alert`

## 15. Canvas

- [ ] 15.1 Build the projection the host sends, and assert it carries every facet the metamodel carries
- [ ] 15.2 Implement the tree pane: nesting, containers, language maps, `@nest` groups, scoped contexts as nested regions; no persisted coordinates
- [ ] 15.3 Implement the graph pane with React Flow and ELK auto-layout
- [ ] 15.4 Implement the shared selection model and the absent-on-the-other-pane rendering
- [ ] 15.5 Implement the inspector: common facets as fields, the advanced section, the raw escape hatch
- [ ] 15.6 Implement views and the graph-pane layout sidecar keyed by element id and nested per view, with a test that moving a box leaves the model file unchanged

## 16. Examples

- [ ] 16.1 Implement `examples:` resolution and the expected-outcome check, including a negative example naming required rule ids
- [ ] 16.2 Write the fixture models and their examples, covering a referenced context, a scoped context, each container form, and a document that silently loses most of its content
- [ ] 16.3 Continuous-integration task: every fixture model resolves, emits both targets, and every example meets its expected outcome

## 17. Documentation

- [ ] 17.1 Update `lat.md/metamodel.md` and `lat.md/processing.md` with what the implementation settled, adding `@lat:` refs in the new tests
- [ ] 17.2 Update `lat.md/architecture.md#Roadmap` and `lat.md/emitters.md#Capability Matrix` with the shipped capability sets
- [ ] 17.3 Record in the config's measured-behaviour section everything observed about the W3C suite, `jsonld.js` divergences, and any real-world context that does not match the specification
- [ ] 17.4 Write the README and a CHANGELOG entry
- [ ] 17.5 Run `lat check`
