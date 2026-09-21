<h1 align="center">
  <img src="https://raw.githubusercontent.com/Volland/dr-json-ld/main/packages/vscode/media/icon.png" width="96" height="96" alt="">
  <br>
  ldm
</h1>

<p align="center">
  <strong>Author a JSON-LD <code>@context</code> as a reviewable YAML model,<br>
  and find out what your documents are silently losing.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@json-ld-modeler/ldm"><img src="https://img.shields.io/npm/v/@json-ld-modeler/ldm?color=0B3D8F" alt="npm"></a>
  <a href="https://github.com/Volland/dr-json-ld/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-0B3D8F" alt="MIT"></a>
  <a href="https://volland.github.io/dr-json-ld/"><img src="https://img.shields.io/badge/handbook-read-0B3D8F" alt="Handbook"></a>
</p>

---

**The most expensive JSON-LD bug is not an error.**

Expansion is *total*. It does not fail on a key it cannot resolve — it drops it.
A document can lose most of its content while every processor in your pipeline
reports success, and nothing in your test suite goes red.

`ldm` is the command that catches that, in CI, on the data you actually ship.

```console
$ ldm check vocabulary.jsonld.yaml
Checked vocabulary.jsonld.yaml at L2.
documents/order.json:3:3  warning L2.key-dropped  "writtenBy" matched no term and expands to nothing. Expansion still succeeded; this content is simply gone.
documents/order.json:7:3  warning L2.coercion-did-not-fire  "https://example.org/people/ada" reads as an IRI but "author" has no `@type: @id`, so it expanded as a literal rather than a reference. The term is not declared by this model.
vocabulary.jsonld.yaml:59:3  info    L2.term-unused  No example document uses "byType".
3 findings.
```

Every finding carries a stable rule id, a JSON Pointer, and a line and column in
a file *you* wrote — never a position in a generated artifact.

## Install

```bash
npm install -g @json-ld-modeler/ldm    # the command it installs is `ldm`
```

Or without installing anything:

```bash
npx @json-ld-modeler/ldm check vocabulary.jsonld.yaml
```

Node 20 or newer. No native dependencies, no service to run.

## Sixty seconds

Start from nothing:

```bash
ldm init --prefix cat --base https://example.org/catalogue#
ldm check                         # every model in the project, one report
```

Or start from a `@context` you already have:

```bash
ldm import schema-subset.jsonld --out vocabulary.jsonld.yaml
ldm vendor vocabulary.jsonld.yaml       # the one command that touches the network
ldm check  vocabulary.jsonld.yaml       # what your examples lose
ldm emit   vocabulary.jsonld.yaml --out build
ldm explain vocabulary.jsonld.yaml doc.json --trace
```

`ldm explain --trace` is the one to reach for when a document does not mean what
you think it means: it prints every term lookup, every IRI resolution, every
change to the active context and every key dropped, in order, for *your*
document rather than for an example in a specification.

## Commands

**One model**

| | |
| --- | --- |
| `ldm check <model>` | Run the validation ladder — `--level L0\|L1\|L2\|L3`, `--json`; through L3 by default when the model has shapes |
| `ldm emit <model>` | Generate an artifact — `--target context\|context-inline\|shacl`, `--out <dir>` |
| `ldm import <context>` | Turn an existing `@context` into a model — `--out <model>` |
| `ldm vendor <model>` | Fetch referenced contexts once and hash them — `--check` |
| `ldm explain <model> <doc>` | Why the document means that — `--trace` |
| `ldm ids <model>` | Backfill stable element ids |

**A project** — found by searching upward, or named with `--project`

| | |
| --- | --- |
| `ldm check --project` | Every model, one report |
| `ldm version new [<model>]` | Freeze a model as a content-addressed version — `--alias <name>` |
| `ldm alias set \| rename \| rm \| list` | Move the human-readable labels |
| `ldm clone <version-or-alias>` | Start a new draft from a frozen version |
| `ldm publish` | Write the static tree you commit and serve |
| `ldm diff <a> <b>` | What changed and what *kind* of change — `--fail-on breaking` |
| `ldm search <query>` | What already exists, offline |

**Authoring skills** — guidance for a coding agent working on a model

| | |
| --- | --- |
| `ldm skill list` | What this build carries |
| `ldm skill install --project\|--user` | Write them — `--format agent-skill,agents,chatmode`, `--force` |

There is no default install target. `--project` writes beneath the current
directory and `--user` beneath your home directory, and the two are not
interchangeable enough to guess between. A skill you have edited is never
overwritten; `--force` takes the new version.

A skill is prose and produces nothing — no finding, no edit, no exit code.
Anything about *your* model comes from the commands the skill names. Installing
them changes no output `ldm check` produces, which is asserted rather than
promised.

Run `ldm` with no arguments for the full usage text.

There is no command that renames a version — a version's name is its content
hash, so there is nothing to rename. `ldm alias rename` moves the label instead,
and both leave every published version byte-identical.

## In continuous integration

Exit codes are the interface: **0** clean, **1** findings at error severity,
**2** usage.

```yaml
- run: npm install -g @json-ld-modeler/ldm
- run: ldm vendor models/catalogue.jsonld.yaml --check   # hashes still match
- run: ldm check --project                               # nothing is being lost
- run: ldm diff stable next --fail-on breaking            # no silent break
```

**Everything except `ldm vendor` runs with the network off.** That is not a
convenience setting. A model file names the URLs to fetch, so a command that
fetches what a model tells it to — running in CI against a pull request from
outside — is a request-forgery primitive. Exactly one command can reach the
network, and a person invokes it.

`ldm vendor` writes each referenced context into a committed directory and
records its integrity hash in the model. An upstream publisher editing their
context then becomes a reviewable diff instead of a silent change of meaning.

## What a model looks like

Point any editor at the published schema and it checks the file as you type:

```yaml
# yaml-language-server: $schema=https://volland.github.io/dr-json-ld/schemas/model/1/model.schema.json
```

Every field is documented at
[the schema reference](https://volland.github.io/dr-json-ld/schemas/model/1/).
The VS Code extension contributes the same schema automatically.

```yaml
jsonld: "1"

namespace:
  prefix: cat
  base: https://example.org/catalogue#

mode: "1.1"

uses:
  - iri: https://example.org/vocab/core.jsonld
    integrity: sha256-…

terms:
  # `@set` is the closest thing JSON-LD has to future-proofing: always an
  # array, so a property that becomes multi-valued later does not change the
  # shape of every document that already exists.
  tags:
    id: tag001
    "@id": cat:tag
    "@container": "@set"

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

The YAML model is canonical and holds semantics only. The `@context` is
generated from it and says so in its header — run `ldm emit` in CI and compare,
so a hand edit to a generated artifact is caught in review.

## Authoring: the VS Code extension

`ldm` is what your pull request runs. For writing the model in the first place,
install **[JSON-LD Modeler](https://marketplace.visualstudio.com/items?itemName=pavlyshyn.jsonld-modeler)**
(`pavlyshyn.jsonld-modeler`):

- **Two coordinated panes** — the JSON shape a developer will type beside the
  RDF graph it denotes, sharing one selection. A `@container` that restructures
  the JSON and changes no triple is drawn as exactly that.
- **Findings in the Problems panel**, at the line in your model, not in a
  generated file.
- **Schema-driven completion** from the JSON Schema the extension contributes —
  no language server to install.
- **Edits that do not reformat your file**: every canvas action is a targeted
  splice, so comments and key order survive.

Same engine underneath — both this CLI and the extension are thin wrappers over
[`@json-ld-modeler/core`](https://www.npmjs.com/package/@json-ld-modeler/core).

## Conformance

Observed, not claimed. The W3C JSON-LD 1.1 test suite is vendored and run with
the network off, and every in-scope case is additionally run through `jsonld.js`
with the outputs compared. Cases that do not pass are listed with a reason;
`frame`, `toRdf`, `fromRdf`, `flatten` and `html` are out of scope for this
release and are reported as such rather than skipped silently.

Expansion and compaction are implemented here rather than delegated, because the
lossiness reporting needs a JSON Pointer from every output back to the input that
produced it — and no library exposes that.

## Learn JSON-LD while you are here

- 📖 **[The JSON-LD handbook](https://volland.github.io/dr-json-ld/book/)** — nine chapters, from `@context` to canonicalization
- ✍️ **[Notes from the shop](https://volland.github.io/dr-json-ld/blog/)** — longer essays:
  - [What linked data is for, and what it costs](https://volland.github.io/dr-json-ld/blog/linked-data.html)
  - [The context you sign](https://volland.github.io/dr-json-ld/blog/verifiable-credentials.html) — why verifiable credentials are hard
  - [Two pictures of the same graph](https://volland.github.io/dr-json-ld/blog/graphs.html)
  - [The format an agent and a human can share](https://volland.github.io/dr-json-ld/blog/agents.html) — expansion, agents and merge-by-IRI

## Links

- 🌐 [Website](https://volland.github.io/dr-json-ld/)
- 🧩 [VS Code extension](https://marketplace.visualstudio.com/items?itemName=pavlyshyn.jsonld-modeler)
- 📦 [`@json-ld-modeler/core`](https://www.npmjs.com/package/@json-ld-modeler/core) — the library
- 🛠 [Source](https://github.com/Volland/dr-json-ld) · [Issues](https://github.com/Volland/dr-json-ld/issues)

## Not in this release

Framing, JSON Schema, the vocabulary document, generated types. Validation L4.
RDF to JSON-LD conversion. Uploading to a host, or signing anything: a checksum detects accident
and casual tampering; it is not a signature, and nothing here implies otherwise.

Deferred is not cancelled — each is reachable from the current design, and the
design record in `lat.md/` says how.

MIT licensed.
