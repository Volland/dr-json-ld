<h1 align="center">
  <img src="https://raw.githubusercontent.com/Volland/dr-json-ld/main/packages/vscode/media/icon.png" width="96" height="96" alt="">
  <br>
  JSON-LD Modeler
</h1>

<p align="center">
  <strong>Author a <code>@context</code> as a reviewable YAML model, see it as two coordinated diagrams,<br>
  and find out what your documents are silently losing.</strong>
</p>

---

A `@context` is not a schema, and the most expensive JSON-LD bug is not an error.
Expansion is *total*: it does not fail on a key it cannot resolve, it drops it. A
document can lose most of its content while every processor involved reports
success.

This extension exists to make that visible.

## What you get

### Two coordinated panes

The canvas opens beside your model file and shows the **JSON shape a developer
will type** next to the **RDF graph it denotes**, sharing one selection.

The entire difficulty of JSON-LD lives in the gap between those two pictures — a
`@container` that restructures the JSON and changes no triple, a `@nest` that
vanishes on expansion, a scoped context that makes one key mean two things.
Select a term with `@container: @set` and the tree pane changes while the graph
pane holds still, **and says so**. A facet that exists on only one side is drawn
as visibly absent on the other, rather than as nothing.

### Findings that point at your file

Validation runs a ladder — L0 well-formedness, L1 context errors, L2 lossiness —
and every finding lands in the Problems panel at a line you wrote:

| | |
| --- | --- |
| `L2.key-dropped` | `"writtenBy" matched no term and expands to nothing. Expansion still succeeded; this content is simply gone.` |
| `L2.coercion-did-not-fire` | `"https://example.org/ada" reads as an IRI but "author" has no @type: @id, so it expanded as a literal rather than a reference.` |
| `L1.protected-term-redefinition` | `"name" is declared protected by https://schema.org/, where it maps to … Protection is a promise to downstream contexts.` |

Context errors are reported **at the term in your model**, never at a position in
a generated artifact you did not write.

### Editing that does not reformat your file

Every canvas action becomes a targeted text splice computed from the YAML syntax
tree. Comments, key order and formatting elsewhere in the file survive untouched,
and edits arrive as `WorkspaceEdit`s so the editor owns undo.

### Completion from the schema you already have

Models are YAML validated by a published JSON Schema the extension contributes,
so completion, hover and structural errors come from your editor's existing YAML
tooling. No language server to install.

## Getting started

1. **JSON-LD Modeler: New Project** — writes an `ldm.project.yaml` and its first
   model. Or **JSON-LD Modeler: New Model** for a model on its own; in a folder
   that already has a project, it registers the model there for you.
2. Set the namespace. A new model carries a placeholder — `ex` at
   `https://example.org/ns#` — and nothing later will flag it, because a
   placeholder IRI resolves, validates and emits exactly as a real one does.
3. Open the canvas: **JSON-LD Modeler: Open Canvas**.
4. Add terms from the canvas, or type in the file. Both panes follow the file.

```yaml
jsonld: "1"

namespace:
  prefix: cat
  base: https://example.org/catalogue#

mode: "1.1"

terms:
  # `@set` is the closest thing JSON-LD has to future-proofing: always an array,
  # so a property that becomes multi-valued later does not change the shape of
  # every document that already exists.
  tags:
    id: tag001
    "@id": cat:tag
    "@container": "@set"

  # A scoped context applies below this point. Its effect is positional, which is
  # why the canvas draws it as a region rather than as an annotation.
  detail:
    id: det001
    "@id": cat:detail
    "@context":
      title: https://example.org/catalogue#detailTitle

examples:
  - id: exa001
    path: documents/ok.json
    expect: { ok: true }

  # A negative example names the rule ids it must raise. One that merely fails
  # passes even when it fails for the wrong reason.
  - id: exa002
    path: documents/empties.json
    expect:
      rules: [L2.key-dropped]
```

## Commands

| Command | What it does |
| --- | --- |
| `JSON-LD Modeler: Open Canvas` | Opens the two-pane canvas beside the model |
| `JSON-LD Modeler: New Model` | Scaffolds a `.jsonld.yaml` with written element ids |
| `JSON-LD Modeler: Backfill Element Ids` | Writes stable ids in as a targeted edit |

## The CLI is what your pull request runs

The extension is for authoring. Gating is [`@json-ld-modeler/ldm`](https://www.npmjs.com/package/@json-ld-modeler/ldm):

```bash
npm install -g @json-ld-modeler/ldm

ldm check vocabulary.jsonld.yaml       # what your examples lose
ldm emit  vocabulary.jsonld.yaml --out build
ldm diff  stable next --fail-on breaking
```

Every command except `ldm vendor` runs with the network off — a command that
fetches URLs a model names, running against an outside pull request, is a
request-forgery primitive, so exactly one command can do it and a person invokes
it.

## Design decisions worth knowing before you adopt it

**The `@context` is generated.** The YAML model is canonical and holds semantics
only. Generated artifacts carry a header saying so, and a repository that lets
someone hand-edit one will lose that edit — run `ldm emit` in CI and compare.

**Element id is identity.** The JSON key and the IRI are both mutable attributes
of it, and they mean different things: a key change breaks consumers' documents
while changing no RDF; an IRI change alters meaning while every document still
parses. Renames are detected via ids, never inferred from similarity.

**An external context is referenced, not flattened.** JSON-LD composes at runtime
by design. Flattening is available as a separate target that *reports the fork*
rather than performing it quietly.

## Conformance

Expansion and compaction are implemented in this project rather than delegated,
because the lossiness reporting needs a JSON Pointer from every output back to
the input that produced it — and no library exposes that.

Conformance is therefore observed rather than claimed. The W3C JSON-LD 1.1 test
suite is vendored and run with the network off, and every in-scope case is
additionally run through `jsonld.js` with the outputs compared. Cases that do not
pass are listed with a reason; `frame`, `toRdf`, `fromRdf`, `flatten` and `html`
are out of scope for this release and are reported as such rather than skipped
silently.

## Not in this release

The shapes layer and everything that consumes it — SHACL, framing, JSON Schema,
the vocabulary document, generated types. Validation L3 and L4. RDF to JSON-LD
conversion.

Deferred is not cancelled: each is reachable from the current design, and the
design record in `lat.md/` says how.

## Links

- [Handbook, guides and the minibook](https://volland.github.io/dr-json-ld/)
- [Source](https://github.com/Volland/dr-json-ld)
- [Issues](https://github.com/Volland/dr-json-ld/issues)

MIT licensed.
