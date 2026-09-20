## 1. Make the schema executable in a clean editor

- [x] 1.1 Confirm `redhat.vscode-yaml`'s licence and marketplace id, and record both in design.md before depending on it.
- [x] 1.2 Add `extensionDependencies: ["redhat.vscode-yaml"]` to `packages/vscode/package.json`.
- [x] 1.3 Remove the two `contributes.jsonValidation` entries; keep `yamlValidation` as the only contribution point for both schemas.
- [x] 1.4 Extend `packages/core/test/schema-copies.test.ts` so the contribution assertion checks `yamlValidation` only, fails on any schema contributed through a point that cannot apply to its file pattern, and fails if a published schema is not contributed at all.
- [x] 1.5 Add a test asserting the manifest declares the schema executor as an extension dependency.

## 2. Convert the schemas to editor-executable constraints

- [x] 2.1 Replace `propertyNames` with `patternProperties` + `additionalProperties: false` for `prefixes` and `terms` in `packages/core/schema/model.schema.json`, keeping `prefixName` and `termKey` as `$defs` so the reference page still documents them.
- [x] 2.2 Do the same for `models` in `packages/core/schema/project.schema.json`.
- [x] 2.3 Mirror both schemas byte-identically into `packages/vscode/schema/` and `site/schemas/`; confirm `schema-copies.test.ts` passes.
- [x] 2.4 Regenerate the schema reference page with `scripts/schema-reference.mjs` and confirm the workflow's diff check passes.
- [x] 2.5 Add a test that fails the build when a schema uses a keyword the editor's schema execution does not evaluate, unless that constraint is listed in a command-only record naming the rule id that reports it. Ship the record empty.
- [x] 2.6 Add accept and reject corpus cases for a bad prefix name and a term key starting with `@`, and confirm each is refused by the schema and by validation. (The bad model name is a project case and lands in 3.1 with the project corpus. The prefix-name case exposed a real disagreement: the schema refused it and `validateModel` did not, so `resolveModel` now raises `L0.schema-violation` on an unusable prefix name.)

## 3. Hold the project schema to what parsing accepts

- [x] 3.1 Create `packages/core/test/fixtures/project-schema/{accept,reject}` with the reject cases naming the constraint they violate, mirroring the model corpus convention.
- [x] 3.2 Extend `schema-corpus.test.ts` to run every published schema against its own corpus, and fail when a published schema has no corpus.
- [x] 3.3 Add a project agreement test: every file the project schema rejects is reported by `parseProject`/`checkProject` as an error with an `L0.project-*` rule id, and every file they accept without error is accepted by the schema. (Found three real disagreements — an illegal model name, a model path not ending `.jsonld.yaml`, and a project name the schema's pattern refuses. `parseProject` now raises `L0.schema-violation` for each, reusing the sentence `ldm init` already refuses with. `nameProblem`/`SCAFFOLD_NAME_PATTERN` and a new `MODEL_SUFFIX` moved from `scaffold.ts` into `project.ts` so scaffolding and parsing share one rule without a circular import; `scaffold.ts` re-exports them.)
- [x] 3.4 Negative-example task: add reject fixtures for `L0.project-no-models`, `L0.project-model-missing`, `L0.project-unknown-host` and `L0.project-duplicate-model`, asserting the rule id and a line and column into the project file.

## 4. Diagnostics for the project file

- [x] 4.1 Add a project-file predicate beside `isModel` in `packages/vscode/src/extension.ts` and route it to `parseProject`, publishing into the existing `DiagnosticCollection`. (Plan said `checkProject`; `parseProject` is correct here — this runs on every keystroke, and `checkProject` would read every model from disk and re-report findings those files already publish for themselves.)
- [x] 4.2 Register the project file on the same open/change/close subscriptions the model file uses, and confirm `activationEvents` still fires for it.
- [x] 4.3 Add a test that a project file naming a missing model produces a diagnostic carrying `L0.project-model-missing` at that entry. (`extension.ts` had no test at all, being the one module that imports `vscode`. Added a minimal `vscode` test double covering the diagnostics surface plus a vitest alias, so the plumbing is reachable from plain Node.)

## 5. Quick fixes computed in core

- [x] 5.1 Create `packages/core/src/edit/fixes.ts`: a registry keyed by rule id, each entry giving a title, a changes-meaning flag, and `Splice[]` computed from the finding and the parsed source. Export it from `packages/core/src/index.ts`.
- [x] 5.2 Implement `L1.invalid-reverse-property` — delete the facet a `@reverse` term may not carry.
- [x] 5.3 Implement `L0.duplicate-element-id` by minting a fresh id for the offending element. (Plan said `backfillElementIds`; that routine only writes ids onto elements that have *none*, and a duplicate already has one, so it would have skipped the case entirely. The fresh id goes to the element that reported the finding, never to the one that held the id first — moving that would silently re-point whatever referenced it.)
- [x] 5.4 Implement `L2.term-in-no-view`, offered only when the model declares exactly one view.
- [ ] 5.5 DEFERRED by decision, not done. `L2.coercion-did-not-fire` is reported against the *example document* and repaired in the *model*, so it needs cross-file plumbing the registry cannot express yet. Confirmed with the user: ship the three model-file fixes now. The `changesMeaning` flag and its spec scenario stay in place with no entry using them; the registry's own comment records this as the intended first user.
- [x] 5.6 Add the per-entry property test: apply the fix, re-validate, assert the finding is gone at that position and no error-severity finding appeared that was absent before.
- [x] 5.7 Add a formatting test: a fixture model with comments and a non-alphabetical key order is repaired with a diff touching only the repaired region.
- [x] 5.8 Confirm `package-boundary.test.ts` still passes — `core` must import no `vscode`.

## 6. Wire quick fixes into the editor

- [x] 6.1 Register a `CodeActionProvider` in `packages/vscode/src/extension.ts` keyed on the diagnostic's `code`, turning registry splices into a single `WorkspaceEdit`. (The provider re-validates rather than reconstructing a finding from the diagnostic: a diagnostic carries the rule id and a position but not the pointer or subject a fix factory reads, and inventing those would put the repair in the wrong place as soon as the two drifted.)
- [x] 6.2 Confirm an applied fix is one undo step and that an open canvas reprojects through the existing invalidate path. (One `WorkspaceEdit` per fix, asserted in the test; the canvas reprojects because it already subscribes to `onDidChangeTextDocument`, which a `WorkspaceEdit` raises like any other edit.)
- [x] 6.3 Add a test that a rule id absent from the registry offers no code action.

## 7. Say the mechanism correctly everywhere

- [x] 7.1 Update `lat.md/architecture.md#Architecture#Surface Syntax` — the schema reaches the editor through `contributes.yamlValidation`, read by a declared extension dependency, not through `contributes.jsonValidation`. Add the editor-executable-constraint bound and the command-only record.
- [x] 7.2 Add a subsection under `lat.md/architecture.md#Architecture#Editing Surface` for the quick-fix registry: keyed by rule id, computed in `core`, splices not re-serialization, and why a meaning-changing repair must say so.
- [x] 7.3 Update `lat.md/validation.md#Validation#Findings` to note that a finding may carry a repair, and that the rule id is the key the registry uses.
- [x] 7.4 Correct the same `jsonValidation` claim in `openspec/config.yaml`'s tech-stack context.
- [x] 7.5 Correct `packages/vscode/README.md` — name the extension that provides completion instead of claiming nothing needs installing — and add a CHANGELOG entry.
- [x] 7.6 Add `// @lat:` code refs from the new fixes module, the code action provider and each new test to the sections written in 7.1–7.3.
- [x] 7.7 Run `lat check` — every wiki link and code ref must pass.
