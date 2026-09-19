## Why

Nothing exists yet. This is milestone 1: the thin vertical slice that exercises every architectural seam once, so the expensive decisions are tested before anything is built on them.

A layered build was rejected. `lpg-modeler` recorded that shipping a compiler first would have left it unusable for its stated purpose until a second release, and pulled visual authoring forward (`lat.md/architecture#Architecture#Roadmap`). That holds with more force here: the differentiating feature is visual, and the riskiest component — a JSON-LD processor written in this project — is justified only by what the visual and validation surfaces do with its output.

## What Changes

- **Model format.** `<name>.jsonld.yaml`: namespace, processing mode, prefixes, `terms:` with full JSON-LD 1.1 facet coverage, referenced external contexts with integrity hashes, and `examples:`. A JSON Schema published from `core` and contributed to the editor. Element ids backfilled by `ldm ids`.
- **Processor.** Expansion and compaction in `core`, carrying a JSON Pointer through every step, with an opt-in trace of each algorithm step. Framing and canonicalization delegated.
- **Validation L0–L2.** Well-formedness; context errors located at the term in the *model*; and lossiness — keys that expand to nothing, relative IRIs, unintended blank nodes, coercion that did not fire, terms defined but unused. Every finding carries a rule id, a JSON Pointer and a line/column.
- **Context resolution.** `ldm vendor` fetches each referenced context once into a committed directory and records its hash. Every other command runs with the network off.
- **Emit.** `context` (references preserved) and `context-inline` (flattened, reporting the fork as a downgrade).
- **Import.** An existing `.jsonld` context becomes a model; anything unrecovered is reported rather than guessed.
- **Canvas.** Two coordinated panes — JSON-shape tree and RDF graph — one selection model, layout sidecar keyed by element id, named views.
- **CLI.** `ldm check | emit | import | vendor | ids | explain`.

## Non-goals

- The `shapes:` layer and everything consuming it: SHACL, frame, JSON Schema, vocabulary document, types, docs site.
- Validation L3 and L4 — no SHACL engine, no rule catalog, no explanation corpus.
- RDF to JSON-LD conversion.
- The lockfile, the change classifier and `ldm diff`.
- The optional LLM layer, the hosted playground, and extracting the package shared with `lpg-modeler`.

## Locked decisions

Touches none. It is the first implementation of decisions 1–18. It settles no recorded open question except one it cannot avoid: whether the two panes share a layout sidecar, which the canvas work must decide.

## Capabilities

### New Capabilities

- `model-format`: what a model may declare and how it resolves into the IR.
- `context-resolution`: vendoring, pinning, and the offline guarantee.
- `jsonld-processing`: expansion, compaction, source mapping, trace, conformance.
- `document-validation`: the L0–L2 ladder and what a finding carries.
- `context-generation`: the `context` and `context-inline` targets.
- `context-import`: bootstrapping a model from an existing context.
- `visual-modeling`: the two panes, views, the sidecar, and targeted edits.

### Modified Capabilities

None — this is the first change.

## Impact

- New repository: `packages/core`, `packages/cli`, `packages/vscode`. No `vscode` import in `core`.
- New dependencies: `yaml`, `jsonld` (test oracle only), `@xyflow/react`, `elkjs`, `vitest`.
- The W3C JSON-LD 1.1 test suite is vendored as a test fixture.
- `lat.md/`: all five documents already describe this change and are updated as it lands.
