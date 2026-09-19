## Context

See proposal.md — Why. Requirements are in `specs/*/spec.md`; this document covers how.

**The metamodel is created by this change**, which makes it the least reversible thing here and the reason it is decided first. Only the `terms:` layer is built. The `shapes:` layer is designed far enough to guarantee the terms layer does not occupy names or semantics it will need — see `lat.md/metamodel#Metamodel#Shapes`, which already settles that cardinality belongs to a shape and coercion to a term.

**IR effect on the lockfile and diffing:** the lockfile is deferred to milestone 3, but its two prerequisites are paid for now. The IR serializer orders arrays by element id and sorts object keys, so a snapshot taken later is canonical without changing the IR. And every element carries a written id, so a later diff can tell a rename from a removal plus an addition.

**IRI stability and rename detection:** a term's identity is its element id, never its key or its IRI (`lat.md/metamodel#Metamodel#Identity`). A model's namespace prefix plus base IRI gives its own terms their global identity, so identity never depends on a file path. Because key and IRI are both mutable attributes of a stable id, the milestone-3 classifier can distinguish a `breaking` key change from a `semantic` IRI change without re-deriving anything.

**Package:** everything except the webview and diagnostics plumbing lands in `packages/core`. No `vscode` import is introduced; the boundary is enforced by lint and by a test that scans the source (`lat.md/architecture#Architecture#Package Boundary`).

Constraints the design leans on:

- `lat.md/architecture#Architecture#Source of Truth`: the `@context` is generated, and the generated file says so.
- `lat.md/architecture#Architecture#Editing Surface#Targeted edits`: canvas edits are splices computed from the YAML syntax tree, never a re-serialization.
- `lat.md/architecture#Architecture#Host Adapter`: the webview does not know it is in an editor.
- `lat.md/metamodel#Metamodel#Terms`: terms are global to a model because they are global to a context.
- `lat.md/metamodel#Metamodel#Composition`: an external context is referenced, not flattened.
- `lat.md/processing#Processing#Source Mapping`: a finding without a source pointer is not finished.
- `lat.md/processing#Processing#Context Resolution#Offline by default`: only an explicit refresh touches the network.
- `lat.md/emitters#Emitters#Capability Matrix`: nothing is silently dropped.
- `lat.md/emitters#Emitters#Verification`: no artifact ships that is only snapshotted.

## Goals / Non-Goals

**Goals:**

- Every seam is crossed once: YAML splice, IR, processor, source map, host adapter, pane coordination, sidecar, continuous integration.
- The processor's conformance is observed against an external authority rather than asserted, from the first commit.
- A finding anywhere in the system is reportable at a position in a file the user wrote.
- A model emits, imports back, and resolves to the same model — tested as a property, not as a fixture.

**Non-Goals:**

- Performance work. Correctness and provenance first; the instance graph's aggregation strategy is an open question that milestone 2 must answer.
- A plugin API. The capability set is what it would eventually expose, and it stays internal until three targets exist.
- Reconstructing a model from documents alone. Import reads a context.

## Decisions

### D1. The model file is YAML with a published JSON Schema, and terms are a flat map

A model declares `jsonld` (format version), `namespace` (prefix and base IRI), `mode` (1.1 or 1.0), `uses` (referenced contexts with their integrity hashes), `terms`, and `examples`. `terms` is a flat map from JSON key to a term definition carrying its facets.

- *Why flat:* a `@context` is a flat map, and one entry governs every occurrence of that key everywhere in the document. Nesting terms under owning classes would model something JSON-LD cannot emit and would produce a context that contradicted the diagram. This is the single most common way a graph-schema intuition misleads here, and the file shape refuses it up front.
- *Why a published schema rather than a parser:* completion and structural errors come from existing YAML tooling at no cost, and the surface syntax stays swappable while the IR and emitters remain the durable asset. The schema lives once in `core` and is copied into the extension, with a test asserting the two are byte-identical.
- *Rejected:* a bespoke DSL (a language server is a prerequisite, not a bonus); making `.jsonld` itself the model file (decision 2 in the config).

### D2. Element ids are written into the file, and derived ids are a degraded mode

`ldm ids` backfills a short stable id onto every term and example. A file with missing ids parses, and those elements get ids derived from their key — enough to survive a reload, not enough to survive a rename.

A derived id following the key means a rename looks like a removal plus an addition, which loses layout and, later, misclassifies a change. Refusing to parse such a file was rejected: the first thing a user does is import someone else's context, which has no ids at all, and a tool that refuses its own import output is broken. The IR records whether each id was written or derived, so the milestone-3 lockfile can refuse what it must without a second pass.

### D3. Expansion carries a provenance envelope rather than returning bare JSON

Every node, value, and dropped key produced by expansion is wrapped with the JSON Pointer of the input that produced it. A pointer resolves to a line and column through the source map the YAML/JSON parser retains.

- *Why not correlate afterwards:* structural correlation degrades exactly at `@nest`, type-scoped contexts, value objects and `@included` — which is precisely where a user needs the pointer. Provenance carried through the algorithm costs a field on an internal structure and never degrades.
- *Effect on the source map:* it *is* the source map; there is no separate structure.
- *Effect on the trace:* the same instrumentation point emits a trace entry when tracing is on, so the two cannot disagree about what happened.
- A public API returns bare expanded JSON by stripping the envelope, so `jsonld.js` comparison in D5 is a direct deep-equality check.

### D4. L2 findings are recorded as expansion makes them, never reconstructed

When expansion drops a key, leaves an IRI relative, mints a blank node, or declines to coerce a value, it records a finding at that moment with the pointer already in hand.

Reconstructing lossiness by comparing input and output after the fact requires re-deriving why something is missing, which is the same correlation problem D3 rejected. Recording at the site is also the only way to distinguish a key dropped because no term matched from one dropped because `@vocab` was absent — a distinction the user needs and the output cannot show.

### D5. Conformance is the W3C suite plus a differential oracle

The processor runs the W3C JSON-LD 1.1 test suite, vendored as a fixture. The suite classes in scope for this change are **expand**, **compact**, and the **remote-document/context** cases that do not require network access. **frame**, **toRdf** and **fromRdf** are out of scope and are marked as such rather than silently skipped.

Every case is additionally run through `jsonld.js` and the outputs compared. A divergence is a question with a right answer, resolved and recorded in the config's measured-behaviour section. Cases the processor does not pass are listed with a reason and whether it is intended; a growing unexplained list is a release blocker.

*Rejected:* treating suite pass as sufficient. It proves the working group's cases pass, not that the implementation agrees with the one every consumer actually runs.

### D6. Findings are a single shape across every level

A finding is `{ ruleId, level, severity, message, pointer, loc, subject }`. L0 and L1 findings use it as much as L2 does, so a caller never handles two kinds of error.

Rule ids are stable strings, namespaced by level (`L1.invalid-container-mapping`, `L2.key-dropped`). They are what an example's expected outcome names, what a configuration downgrades, and what documentation explains — so a message can be reworded without breaking any of them. Findings are emitted in a deterministic order independent of object iteration order, because a diff of findings between two runs must reflect a change in the document.

### D7. Context resolution is a vendored directory with recorded hashes

`ldm vendor` fetches each entry in `uses`, writes it to `contexts/<host>/<path>.jsonld`, and records the hash in the model. Every other command reads only that directory. A mismatch is a hard error naming the entry.

- *Why vendored rather than cached:* a machine-local cache is an invisible input to the build. A committed directory makes upstream drift a reviewable diff produced by a deliberate act.
- *Why offline elsewhere:* reproducibility, and the narrower point that a command which fetches URLs a model names, running in continuous integration against an outside pull request, is a request-forgery primitive. `vendor` is the one place that exists and a person invokes it.
- The fetcher follows redirects, requires a JSON-LD content type or an explicit override, and does not honour a `Link` header pointing elsewhere.

### D8. Two emit targets, with one capability difference between them

`context` emits the referenced form: `"@context": [ ...referenced IRIs, { own terms } ]`. `context-inline` emits a single self-contained object with every referenced context flattened in from its vendored copy.

Capability sets differ in exactly one entry: `context` declares `external-reference: live`, `context-inline` declares `external-reference: forked` and emits a downgrade for each referenced context it absorbed, as a diagnostic on the `uses` entry and as a comment at the top of the artifact naming the context and the hash it was taken from. A model targeting mode 1.0 that uses a 1.1-only facet produces a downgrade on that term from both targets; the facet is still emitted, and the downgrade says what a 1.0 processor will do instead.

Both artifacts carry a generated-file header naming the model. Term order is derived from the model, not hashed, so a one-term change is a one-line diff.

### D9. Import recovers what a context states and reports the rest

`ldm import <context.jsonld>` produces a model: prefixes, `@vocab`, terms and every facet, referenced contexts recorded in `uses` and vendored. Element ids are minted. Anything not recoverable is reported, not guessed.

What is structurally unrecoverable and must be reported rather than invented: which terms belong together as a class (there is no shapes information in a context), human-readable documentation (a context carries no labels or comments), and the author's intent behind `@vocab`. The report is part of the command's output, on the model that `lat.md/emitters#Emitters#Capability Matrix` reasoning would call a downgrade in the opposite direction.

Round-trip is a property test: import a context, emit it, and the emitted context must be semantically equal to the input under a normalizing comparison — not byte-equal, since key order and shorthand forms are not preserved and pretending otherwise would be a false guarantee.

### D10. The canvas is one projection rendered twice

The host sends a single projection of the IR. The webview derives both panes from it and holds no model state; a selection is an element id, so coordinating the panes needs no cross-pane mapping table.

Deriving both panes from one projection is what makes "a facet absent on the other pane" cheap and correct: the tree pane renders `@container` and the graph pane has nothing to render for it, from the same input. Layout for the graph pane is persisted in a sidecar keyed by element id and nested per view. **The tree pane persists no coordinates in this change** — its layout is fully derived from structure — which defers the open question of whether the panes share a sidecar rather than answering it wrongly.

Every canvas action posts a named intent; the host serializes intents one at a time, because one gesture can post two and the second would otherwise splice against offsets the first had already moved.

### D11. CLI surface

`ldm check <model> [--level L0|L1|L2] [--json]`, `ldm emit <model> [--target context|context-inline] [--out dir]`, `ldm import <context> [--out model]`, `ldm vendor <model> [--check]`, `ldm ids <model>`, `ldm explain <model> <document> [--trace]`.

Exit codes: 1 for findings at or above error severity, 2 for usage. `ldm vendor --check` verifies hashes without fetching and is the continuous-integration form. `ldm explain` is where the trace surfaces outside the editor.

## Risks / Trade-offs

- [Writing a conformant JSON-LD processor is the largest item and could consume the milestone] → The suite is vendored and run from the first processor commit, so progress is measured in passing cases rather than estimated. If expansion conformance slips, compaction and the canvas still have a correct expander to build on; the fallback of wrapping `jsonld.js` without provenance is explicitly *not* taken, because it would silently delete the L2 feature the milestone exists to prove.
- [A generated `@context` will be hand-edited by someone and the edit lost] → The header says it is generated, and `ldm emit` in continuous integration regenerates and compares, so the loss is caught in review rather than in production. This cost is accepted rather than mitigated away; it is the price of decision 2.
- [The two-pane canvas is unproven and may not be legible] → It is built in this milestone precisely so the risk is discovered while the metamodel can still absorb the answer. Views cap what any one diagram shows.
- [Vendoring makes the first run heavier than a tool that just fetches] → `ldm import` vendors as part of the import, so the common on-ramp pays it once without a separate step.
- [The processor and `jsonld.js` disagree and this project is wrong] → That is the intended outcome of the differential test. Every divergence is resolved and recorded before release rather than tallied.
- [Full 1.1 facet coverage is a large surface for a first milestone] → Coverage is in the metamodel and the processor, which the suite already forces. The inspector's curated prominence means the canvas does not owe a bespoke control for every facet; the raw escape hatch covers the tail.
