## Context

See proposal.md — Why. The constraints that shape the approach:

- `[[lat.md/architecture#Architecture#Surface Syntax]]` states the mechanism as
  `contributes.jsonValidation`. That is factually wrong for a YAML file and is the
  sentence this change corrects; `openspec/config.yaml` repeats it and must follow.
- `[[lat.md/architecture#Architecture#Package Boundary]]` — `core` must never import
  `vscode`. Every quick fix must therefore be computed in `core` and applied in `vscode`.
- `[[lat.md/architecture#Architecture#Editing Surface#Targeted edits]]` — an edit is a
  splice computed from the YAML syntax tree, never `Document.toString()`. The machinery
  (`blockExtent`, `indentAt`, `applySplices`) already exists and is proven by the canvas.
- `[[lat.md/validation#Validation#Findings]]` — the rule id is the stable handle. It is
  already on every diagnostic as its `code`, which is what a quick-fix provider keys on.
- `[[lat.md/architecture#Architecture#Surface Syntax#What the schema refuses]]` — the
  schema's reach is bounded by `validateModel`. This change moves no boundary; it only
  changes the *form* some constraints take.

The metamodel does not change. No term, namespace, IRI or element id is affected, the
IR is untouched, the lockfile and `ldm diff` classify identically, the processor is not
modified and no W3C suite class is touched. Every emitter produces byte-identical output.

## Goals / Non-Goals

**Goals:**
- A clean install gives completion, hover and structural errors on a model file.
- The two file kinds behave the same: project file gets what the model file gets.
- A schema constraint that cannot fire in the editor is a build failure or an explicit
  record, never a silent hole.
- A quick fix is a core computation the CLI could also run, not editor-only behavior.

**Non-Goals:**
- Any provider that knows JSON-LD (prefix or vendored-term completion). The schema is
  the only source of completion in this change.
- Any quick fix that needs the network (`ldm vendor`), or that is really a command.

## Decisions

### Take a hard `extensionDependencies` rather than a recommendation

The dependency, verified before taking it: marketplace id `redhat.vscode-yaml`,
publisher Red Hat, licence **MIT** — compatible with this project's MIT licence.

Its discovery mechanism was verified too, because the whole change rests on it.
`vscode-yaml`'s `extension.ts` iterates `extensions.all`, reads
`packageJSON.contributes.yamlValidation` from every installed extension, resolves a
`./`-relative `url` against that extension's own URI, and prepends `/` to a `fileMatch`
that names no path. `vscode-json-languageservice` then strips that leading `/` and
prepends `**/`. So `*.jsonld.yaml` is evaluated as `**/*.jsonld.yaml` and matches a
model at any depth: the contribution's *shape* is already correct, and the only thing
broken is that nothing is installed to read it. Nothing about `fileMatch` needs to
change.

`extensionDependencies: ["redhat.vscode-yaml"]` makes the editor install the schema
executor with the extension and refuse to run without it.

Alternatives: `extensionPack`, which installs it but lets a user disable it, returning
silently to today's broken state; a workspace `extensions.json` recommendation, which
only covers people who open this repository and does nothing for a user of the
published extension; and a first-party language server, rejected in the proposal.

Cost accepted: a user who dislikes that extension cannot avoid it. That is the honest
form of a dependency we already have and merely failed to declare.

### `patternProperties` instead of `propertyNames`

**This decision's original rationale was wrong and is corrected here.** It claimed
`vscode-json-languageservice` does not implement `propertyNames`. Verified against the
code that actually runs — `yaml-language-server`'s `schemaValidation/baseValidator.ts`
validates every key node against the `propertyNames` subschema, and its draft-2019 and
draft-2020 validators additionally implement `prefixItems`, `unevaluatedProperties`,
`unevaluatedItems`, `dependentRequired` and `$dynamicRef`. Its 2020-12 coverage is
effectively total; the only keyword absent from `src/` is `contentSchema`, which is
annotation-only. Nothing in either schema was unexecutable.

The conversion is kept anyway, on its own merits rather than on necessity:

| Location | From | To |
| --- | --- | --- |
| `prefixes` | `propertyNames: prefixName` | `patternProperties: {"^[A-Za-z_][A-Za-z0-9_.-]*$": absoluteIri}`, `additionalProperties: false` |
| `terms` | `propertyNames: termKey` | `patternProperties: {"^[^@]": term}`, `additionalProperties: false` |
| project `models` | `propertyNames: modelName` | `patternProperties: {"^[A-Za-z0-9][A-Za-z0-9._-]*$": …}`, `additionalProperties: false` |

What it buys: a bad key reports as "Property `@foo` is not allowed" at the key, rather
than as a nested `propertyNames` failure, and the generated schema reference now prints
each map's key shape, which it previously omitted. The accept/reject sets are identical
— the existing corpus and agreement tests pass unchanged, which is the proof.

`termKey` is restated as `pattern: "^[^@]"` in place of `minLength: 1` plus
`not: {pattern: "^@"}`. The two describe the same set: at least one character, the first
not `@`. Stating it positively lets one test assert that the `patternProperties` key and
the `$defs` entry have not drifted apart, which is how `prefixName`, `termKey` and
`modelName` stay documented on the reference page while the constraint lives in the
form the editor evaluates.

### The editor-executable ratchet is an allowlist, not a denylist

Because the editor's coverage is near-total, a test listing *unsupported* keywords would
assert almost nothing. It is inverted: the test collects every schema keyword the two
schemas actually use and fails on any keyword not in a set recorded as verified, naming
the keyword and the date and source of the last verification.

That way the check is not vacuous. It does not ask "is this keyword known to be broken"
— it asks "has anyone checked this keyword runs in the editor", and a keyword added
later fails the build until someone has. The command-only record is the escape hatch for
a keyword verified as unsupported, and it ships empty because none is.

### Quick fixes are `core` functions returning splices

A new `packages/core/src/edit/fixes.ts` exports a registry keyed by rule id, each entry
producing `Splice[]` from the finding and the parsed source, plus a title and a flag for
whether the repair changes meaning. `vscode` adds a `CodeActionProvider` that looks the
diagnostic's `code` up and turns the splices into one `WorkspaceEdit`.

This keeps decision 17 intact (no `vscode` import in `core`), makes every fix testable
in plain Node against the existing fixture models, and leaves the door open to an
`ldm check --fix` without moving anything.

The initial registry, chosen because each repair is the only legal one:

| Rule id | Repair | Changes meaning |
| --- | --- | --- |
| `L1.invalid-reverse-property` | Delete the facet a `@reverse` term may not carry — never `@reverse` itself | No |
| `L0.duplicate-element-id` | Mint a fresh id for the element that reported it | No |
| `L2.term-in-no-view` | Add the term to the model's view, offered only when there is exactly one | No |

Two corrections found while implementing:

`L0.duplicate-element-id` cannot use `backfillElementIds`. That routine writes ids
onto elements carrying *none*, and a duplicate already carries one, so it would skip
the case. The fix mints a fresh id and splices it over the duplicate — onto the element
that reported the finding, never onto the one that held the id first, because the id is
identity and moving it would silently re-point whatever referenced it.

`L2.coercion-did-not-fire` is **deferred**, not shipped. It is reported against the
*example document* and repaired in the *model*, so it is a cross-file fix: the code
action would have to resolve, from an arbitrary document, which model declares the term.
That is machinery this design does not cover, so the three model-file fixes ship alone.
The `changesMeaning` flag and its spec scenario stay — no entry uses them yet, and this
is the intended first user.

Deliberately absent: `L1.unknown-prefix` (the IRI is not recoverable from the finding),
`L1.facet-not-in-mode` (two legal repairs), `L1.context-not-vendored` and
`L1.context-hash-mismatch` (a network command, not an edit), `L2.term-unused` (the repair
is deletion). Each is a registry entry someone can add later without touching the shape.

The property test is per-entry and is what makes the registry safe: apply the fix,
re-validate, assert the finding is gone and no new error appeared.

### Project-file diagnostics reuse the model path

`activate` currently refreshes only on `isModel`. It gains a sibling predicate for
`ldm.project.yaml` routed to `checkProject`, publishing into the same
`DiagnosticCollection` with the same `toDiagnostic`. No new reporting path.

## Risks / Trade-offs

- **The dependency is unavailable or renamed in some editor** (VS Codium, Cursor) →
  the extension still activates and the canvas, commands and `jsonld-modeler` diagnostics
  all work; only schema completion is missing. Nothing is made worse than today.
- **`patternProperties` + `additionalProperties: false` changes error wording**, and the
  corpus asserts blame by resolving a named `$defs` entry → the two key-shape `$defs`
  (`prefixName`, `termKey`, `modelName`) stop being reachable as standalone validators.
  Keep them as `$defs` and reference the pattern from one place so the reference page
  still documents them.
- **A quick fix repairs the text but the canvas is open** → splices already arrive as
  `WorkspaceEdit`s, so the existing invalidate-and-reproject path handles it unchanged.
- **`L2.coercion-did-not-fire` changes RDF** → gated on the title saying so, and it is the
  one entry a reviewer should look at hardest.
- **A hard dependency is a marketplace-visible change** → it is a minor version bump on
  the extension, not a breaking change to any file format.

## Migration Plan

No data migration: no file a user owns changes shape. Order of work is in tasks.md.
Rollback is reverting the manifest and the schema conversion; a model that validated
before validates after, in both directions, which the corpus proves.

## Open Questions

- Whether `redhat.vscode-yaml` should also be listed in a workspace `extensions.json`
  for contributors of this repository. Cosmetic, decidable at any time, changes nothing
  in the specs.
