## 1. Project file and resolution

- [x] 1.1 Write the JSON Schema 2020-12 for the project file — models, published-tree directory, host adapters — copy it into `packages/vscode` and extend the byte-identity test to cover both schemas
- [x] 1.2 Implement the project loader and the upward search from a working directory, including the no-project path in which a model is operated on by path exactly as today
- [x] 1.3 Report project-level findings with locations: a model the project does not declare, a model claimed by two projects, a model naming a project that does not list it
- [x] 1.4 Extend the model schema and resolver with the optional `project` declaration, and assert an existing model with no project resolves byte-identically to today
- [x] 1.5 Implement checking a project as a whole, with findings from every model in one deterministically ordered report naming which model produced each
- [x] 1.6 Negative-example task: a fixture project per project-level rule, each asserting the exact rule ids raised and their pointers
- [x] 1.7 Reject a view naming a term its own model does not declare, with a finding at the view

## 2. The version store

- [x] 2.1 Define the manifest format — per-file path and integrity hash, the manifest self-hash, source model, creation moment, manifest format version — and its canonical serialization
- [x] 2.2 Implement version creation: freeze a model's files, compute the manifest, derive the identity from the manifest hash
- [x] 2.3 Implement verification: every file against its recorded hash, and the manifest against its own hash; add the test that editing a file *and* its manifest entry still fails
- [x] 2.4 Make the store refuse every write inside an existing version, and add the test that no file changes when such a write is attempted
- [x] 2.5 Detect identical content on re-creation and report it rather than writing a second copy
- [x] 2.6 Refuse version creation from a model carrying derived element ids, naming the elements
- [x] 2.7 Record lineage — cloned-from and predecessor — and verify a version whose predecessor is absent still verifies itself
- [x] 2.8 Negative-example task: fixture versions for each verification failure, each asserting the exact rule ids and the file named

## 3. Aliases

- [x] 3.1 Implement the alias file — name to version identity — as a separate mutable file that no version references
- [x] 3.2 Implement create, retarget and delete, with a test asserting every version is byte-identical before and after each
- [x] 3.3 Report an alias pointing at a missing version, and refuse an alias whose name collides with a version identity
- [x] 3.4 Test the correction workflow end to end: publish, find a mistake, publish a new version, retarget the alias, and confirm the old version is still readable at its own identity

## 4. The lockfile and comparison

- [x] 4.1 Write the lockfile into each version using the existing IR serializer, and assert it is byte-identical for a model whose declarations were only reordered
- [x] 4.2 Implement comparison over two lockfiles with neither model file present, matching elements by element id
- [x] 4.3 Implement the five change classes from locked decision 12, with ambiguity classifying as `breaking` and the report saying so
- [x] 4.4 Make comparison output deterministic, and test that comparing the same pair twice reports the same differences in the same order
- [x] 4.5 Implement gating on a class, and refuse comparison involving a lockfile recording derived ids
- [x] 4.6 Test each class against a fixture pair: key change is `breaking`, IRI change is `semantic`, removed `@protected` is `illegal`, new term is `additive`, added `@container: @set` is `compatible`
- [x] 4.7 Negative-example task: fixture version pairs for each refusal, asserting the exact rule ids

## 5. The published tree and host adapters

- [x] 5.1 Implement the tree writer: artifacts under a version path, the published index naming every version and alias with its manifest hash
- [x] 5.2 Define the host adapter interface — path constraints, required side files, how an alias path is realised — and implement the GitHub Pages, S3 and plain-file-host adapters
- [x] 5.3 Validate a tree against every adapter the project names, failing with the host, the path and the violated constraint, and writing nothing
- [x] 5.4 Emit alias paths per adapter, and test that a version path and an alias path return the same bytes
- [x] 5.5 Make publishing reproducible, and test that a second run reports no change and leaves every file byte-identical
- [x] 5.6 Report a tree whose contents and index disagree
- [x] 5.7 Golden-file tests for the published tree across the fixture projects, for each host adapter
- [x] 5.8 Execution task: load each artifact from the published tree in `jsonld.js` and round-trip every declared example through it
- [x] 5.9 Negative-example task: a fixture project per host-constraint violation, asserting the rule ids and that nothing was written

## 6. Emitted artifacts gain a version identity

- [x] 6.1 Extend the generated-file header to name the version identity and the project when the artifact belongs to a version, and to name neither rather than a placeholder when it does not
- [x] 6.2 Golden-file tests for both targets, published and unpublished, confirming the unpublished header is unchanged from today
- [x] 6.3 Execution task: confirm the added header lines are still stripped to strict JSON and still load in `jsonld.js`

## 7. Resolving a context this project published

- [x] 7.1 Resolve a reference to a version of the model's own project from the published tree, using the manifest hash and writing nothing into the vendor directory
- [x] 7.2 Report a reference to a version of the same project that is not published, without attempting to fetch it
- [x] 7.3 Test that this path makes no network request, and that `ldm vendor` remains the only command that can

## 8. Search

- [x] 8.1 Build the index over published versions and vendored contexts, recording for each entry the term key, the IRI, the note and the source it came from
- [x] 8.2 Implement matching against key, IRI and note, with each result stating which matched and which source it came from
- [x] 8.3 Exclude a version that fails verification, and report that it was skipped and why
- [x] 8.4 Make results deterministic, and report no match as a success rather than a failure
- [x] 8.5 Test that search completes with the network off, and that a newly published version is searchable immediately

## 9. CLI

- [x] 9.1 Implement `ldm publish`, `ldm version new` and `ldm clone` with the exit codes from design D11 of the previous change
- [x] 9.2 Implement `ldm alias` — create, retarget, delete, list
- [x] 9.3 Implement `ldm diff` with `--fail-on`, and `ldm search`
- [x] 9.4 Make `ldm check` and `ldm emit` project-aware, resolving a model by name while keeping the existing by-path behaviour
- [x] 9.5 CLI tests: gating on class, `--json` output stability for diff and search, a missing published tree, a hash mismatch, and usage errors

## 10. Extension

- [x] 10.1 Add the project-level model picker and make the canvas resolve a model through the project
- [x] 10.2 Surface version and alias state read-only in the canvas, and confirm no `vscode` import reaches `core`

## 11. Fixtures

- [x] 11.1 Write a fixture project containing two models, one referencing a version the other published
- [x] 11.2 Write fixture versions covering a clean publish, a correction with a retargeted alias, and a pair exercising all five change classes
- [x] 11.3 Continuous-integration task: every fixture project checks, publishes for every host adapter, verifies, and every example meets its expected outcome with the network off

## 12. Documentation

- [x] 12.1 Add `lat.md/architecture#Architecture` sections for the project and the published tree, and record the settled publishing-strategy question
- [x] 12.2 Update `lat.md/metamodel#Metamodel` for the optional project declaration, stating explicitly that identity remains the IRI and never the published path
- [x] 12.3 Update `lat.md/emitters#Emitters#Change Management` to record that the lockfile lives inside a version rather than beside the model, and why
- [x] 12.4 Record in the config's measured-behaviour section what was observed about each host's path handling, and add `@lat:` refs in the new tests
- [x] 12.5 Update the README and add a CHANGELOG entry
- [x] 12.6 Run `lat check`
