## Why

The extension promises that completion, hover and structural errors for a model file
"come from your editor's existing YAML tooling. No language server to install." They do
not. `contributes.yamlValidation` is read only by `redhat.vscode-yaml`, which nothing
here declares or documents, and `contributes.jsonValidation` never applies to a YAML
file at all. On a clean VS Code the published schema is inert, so choosing YAML *because*
the editor would validate it bought nothing. Three smaller defects sit beside it: the
project file gets no editor diagnostics, the project schema has no corpus holding it to
what `parseProject` accepts, and a finding carries a rule id but no repair.

## What Changes

- Declare `redhat.vscode-yaml` in `extensionDependencies`, so installing the extension
  installs what executes the schema. Correct the README's "no language server" claim.
- Remove `contributes.jsonValidation` for both file patterns: it matches nothing and
  implies a mechanism that does not exist. Not breaking — the entries were already inert.
- Hold the schemas to the subset the editor's validator executes. Where a constraint
  lives only in a keyword `vscode-json-languageservice` ignores (`propertyNames` is the
  case in hand), restate it in a form the editor runs, or record that only `ldm check`
  reports it.
- Report diagnostics for `ldm.project.yaml` on the path the model file already uses. The
  `L0.project-*` rules exist and `ldm check` reports them; the editor is silent.
- Give the project schema the accept/reject corpus and the agreement test against
  `parseProject` that the model schema already has.
- Give findings with one obvious repair a quick fix, computed as a targeted splice
  through the existing `blockExtent`/`applySplices` machinery, never a re-serialization.

## Capabilities

### New Capabilities
- `editor-language-support`: what the editor must provide for a model or project file —
  which extension executes the schema, which schema constructs are editor-executable,
  and the quick fixes reachable from a finding.

### Modified Capabilities
- `visual-modeling`: "Validation surfaces in the editor" extends to the project file.
- `model-format`: the schema/validation agreement additionally requires that a refusal be
  expressed in a form the editor executes, or be recorded as command-only.
- `project-structure`: the project schema and project parsing agree on what a project
  file may say, the way the model pair already does.
- `model-schema-publication`: the conformance corpus requirement covers every published
  schema, not only the model schema.

## Non-goals

- No first-party language server, completion provider or hover provider.
- No new rule ids, no new validation level, no change to any emitter.
- No JSON-LD-aware completion of prefixes or vendored terms; the schema cannot express
  it and it needs a provider. Separate proposal.
- No change to the schema's reach. What it refuses stays bounded by `model-format`'s
  "schema refuses illegal facet combinations", including its two deliberate acceptances.

## Locked decisions

Touches none. It restores the arrangement decision 2 and `architecture#Surface Syntax`
already assume — a canonical YAML file whose editor support comes from the schema — by
making the delivery mechanism real. Decision 5's downgrade-is-not-a-rejection bound is
preserved and now also governs the project schema.

## Milestones

Not an M1 OUT item; nothing is pulled forward. This is a defect in shipped M1 work:
`architecture#Surface Syntax` states the mechanism incorrectly and is corrected with the
code. No open question is settled.

## Targets

None affected. Every target emits identical bytes before and after.

## Impact

- `packages/vscode/package.json` — `extensionDependencies`, contribution points.
- `packages/vscode/src/extension.ts` — project-file diagnostics, a `CodeActionProvider`.
- `packages/core/src/edit/` — quick-fix splices, kept testable without an editor.
- `packages/core/schema/*.json` and both mirrors — editor-executable constraint forms.
- `packages/core/test/` — project corpus, agreement test, contribution assertions.
- `packages/vscode/README.md`, `lat.md/architecture.md`, `openspec/config.yaml`.
