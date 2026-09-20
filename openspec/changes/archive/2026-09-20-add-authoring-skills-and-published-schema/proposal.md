## Why

The tool teaches JSON-LD to a person sitting in front of the canvas. It teaches nothing to the coding agent that now writes most of the first draft of a model — which invents facet combinations JSON-LD forbids, reaches for `@container: @language` on a term with no string coercion, and hand-edits the generated `@context`. The schema that would have caught much of this is real and strict, but its `$id` is `https://pavlyshyn.dev/schemas/jsonld-modeler/model.schema.json`, which serves nothing: any editor outside the extension, and every agent, validates against a 404.

## What Changes

- A set of authoring **skills** shipped in `core`, each a directory of guidance: designing a JSON-LD vocabulary, writing the `.jsonld.yaml` surface, reading a `ldm check` finding, and publishing a context. Every skill routes its factual claims to a command — the skill says *run `ldm check`*, never *the answer is*.
- Three emitted skill formats from one source: Agent Skills (`SKILL.md`), a vendor-neutral `AGENTS.md` bundle, and Copilot `*.chatmode.md`.
- `ldm skill list` prints what this build carries. `ldm skill install [<name>...]` writes them. It has **no default install target**: `--project` or `--user` is required, and `--format` selects among the three. It refuses to overwrite a modified skill.
- The model schema gains the facet co-constraints it currently delegates to the validator: legal `@container` sets, and a `@reverse` term carrying neither `@id` nor `@nest` nor a `@container` beyond `@set`/`@index`. It gains only constraints JSON-LD itself imposes — a combination the specification permits stays accepted even where it is a likely mistake.
- The schema is published at a **versioned** path on the site — `/schemas/model/1/model.schema.json` — and its `$id` is retargeted there from the unresolvable one. A generated reference page documents every field from the schema bytes, so the page cannot drift.
- A must-accept / must-reject corpus runs against the schema in CI.

## Capabilities

### New Capabilities
- `authoring-skills`: what a skill is, what the shipped set covers, the three emitted formats, and the behaviour of `ldm skill list` and `ldm skill install`.
- `model-schema-publication`: the schema's published URL and version path, the identity of the published bytes and the two committed copies, the generated reference page, and the accept/reject corpus.

### Modified Capabilities
- `model-format`: the schema requirement tightens from structural validity to facet co-constraints, and states the published URL a model may validate against.

## Impact

No emitter changes. No target — `context`, `context-inline`, `shacl`, `frame`, `jsonschema`, `vocabulary`, `types`, `docs` — is affected, and no artifact any of them produces changes a byte. No processor change, so no W3C suite class is touched and no ratchet moves.

Code: `packages/core/skills/` and `packages/core/schema/`; a `skill` verb in `cli`; `site/schemas/` and one reference page; the schema-copy test widens to three copies; the Pages workflow asserts the published schema parses and its `$id` matches its URL.

**Locked decisions.** This touches **16**. A skill is guidance addressed to an LLM, so it falls under the clause requiring that layer to be optional, clearly labelled, and never the source of a diagnostic, an edit or a CI result. The decision is upheld rather than amended: a skill is a static document the user installs deliberately, it produces nothing, and every claim it makes about a specific model is deferred to `ldm check`. The **LLM layer** in the M1 OUT list is an in-product inference path and stays out; this ships no inference. Nothing else in M1 OUT is pulled forward.

**Open questions.** None settled.

## Non-goals

- No in-product LLM inference, no model-authoring assistant, no generated explanation text.
- No skill that validates, edits or emits. A skill never becomes a second authority beside the rule ids.
- No `ldm skill` verb that fetches from the network. The skills ship in the package; decision 10's offline rule holds.
- No custom domain. The `pavlyshyn.dev` `$id` is abandoned rather than made to resolve.
- No schema for the layout sidecar, the lockfile or a version manifest — those are emitted, not authored.
