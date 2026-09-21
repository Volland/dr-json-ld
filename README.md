# jsonld-modeler

Author a JSON-LD `@context` as a reviewable YAML model, see it as two
coordinated diagrams, and find out what your documents are silently losing.

A `@context` is not a schema. Expansion is total: it does not fail on a key it
cannot resolve, it drops it — so a document can lose most of its content while
every processor involved reports success. This tool exists to make that visible,
which is why it implements expansion and compaction itself rather than calling a
library: every finding it reports points at a line in a file you wrote.

## What it does

**A model, not a hand-edited artifact.** The canonical file is
`<name>.jsonld.yaml`, holding semantics only. The `@context` is generated from
it and says so in its header. A JSON Schema ships with the extension and is
published at its own URL, so completion and structural errors come from your
editor's YAML tooling — Red Hat's YAML extension, which the extension installs
with itself.

**Two panes.** The canvas shows the JSON shape a developer will type beside the
RDF graph it denotes, sharing one selection. The whole difficulty of JSON-LD
lives in the gap between those two — a `@container` that restructures the JSON
and changes no triple, a `@nest` that vanishes on expansion, a scoped context
that makes one key mean two things. A facet that exists on only one side is
drawn as visibly absent on the other rather than as nothing.

**Shapes, and scoped contexts you can edit.** A scoped context written as a
map holds terms of its own, each with an id and facets, so a credential's
protected type-scoped context is something the canvas edits rather than a blob.
`shapes:` says which fields a class has, how many values each takes and what
they must be — class structure a `@context` cannot express. `ldm emit --target
shacl` writes it as a SHACL shapes graph, and the canvas builds it as a field
table beside the JSON skeleton a conforming document takes.

**A validation ladder.** L0 well-formedness, L1 context errors located at the
term in your model rather than in a generated artifact, L2 lossiness: keys
that expanded to nothing, IRIs left relative, blank nodes minted where an
identifier was expected, coercion that did not fire. And L3 conformance, when
the model has shapes: a SHACL engine runs the emitted shapes graph over each
example, and every violation is reported at the value or key in the document.
Every finding carries a stable rule id, a JSON Pointer and a line and column.

**Vendored contexts.** `ldm vendor` fetches each referenced context once into a
committed directory and records its hash. Every other command runs with the
network off. A mismatch is a hard error naming the entry.

**Projects and versions.** A project names the models that belong together.
Publishing freezes a model as an immutable, content-addressed version with a
manifest that checksums every file in it, and writes a static tree that serves
from GitHub Pages, an S3 bucket or any plain file host with no configuration.
Human names like `stable` are movable labels over those versions, so a published
URL survives a correction. `ldm diff` says what changed between two versions and
what *kind* of change it was.

## Install

```bash
npm install -g @json-ld-modeler/ldm   # the CLI; the command it installs is `ldm`
```

The extension is `pavlyshyn.jsonld-modeler` on the Marketplace.

## Use

Start from nothing:

```bash
ldm init                                       # a project and its first model
ldm init model core                            # one more, registered in the project
ldm init --prefix cat --base https://example.org/catalogue#   # with a real namespace
```

A scaffolded model carries a placeholder namespace unless you pass one, and both
`ldm init` and the extension say so. Nothing downstream will: `ex:name` resolves,
validates and emits exactly as a real IRI does.

Or start from a context you already have:

```bash
ldm import schema-subset.jsonld --out vocabulary.jsonld.yaml   # bring your own context
ldm vendor vocabulary.jsonld.yaml                              # the one command that fetches
ldm check vocabulary.jsonld.yaml                               # what your examples lose, and whether they conform
ldm emit vocabulary.jsonld.yaml --out build                    # generate the @context
ldm emit vocabulary.jsonld.yaml --target shacl --out build     # generate the shapes graph
ldm explain vocabulary.jsonld.yaml doc.json --trace            # why it means that
```

Inside a project:

```bash
ldm check                              # every model, one report
ldm version new --alias stable         # freeze this model, label it
ldm publish                            # write the static tree
ldm diff stable next --fail-on breaking  # two aliases, or two identities
ldm search curator                     # what already exists, offline
```

Exit codes: `0` clean, `1` findings at error severity, `2` usage.

There is no command that renames a version — a version's name is its content
hash, so there is nothing to rename. `ldm alias rename` moves the label instead,
and `ldm alias set` points it at a corrected version. Both leave every published
version byte-identical.

### A project

```yaml
# ldm.project.yaml
project: "1"
name: catalogue-suite
baseUrl: https://vocab.example.org/

models:
  core: models/core.jsonld.yaml
  catalogue: models/catalogue.jsonld.yaml

published: published
versions: versions
hosts: [plain, github-pages, s3]
```

`published/` is a static tree you commit and copy wherever you serve from. The
tool never uploads: every host already has a mature tool for that, and what this
owes you is a tree those tools can copy verbatim — plus a refusal when a name
would produce a path your host silently mangles.

### A model

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

  # A scoped context applies below this point. Its effect is positional, which
  # is why the canvas draws it as a region rather than as an annotation.
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

## Conformance

Conformance is observed, not claimed. The W3C JSON-LD 1.1 test suite is vendored
as a fixture and run with the network off, and every in-scope case is
additionally run through `jsonld.js` with the outputs compared. Per-case results
are regenerated into `docs/conformance/`; the conclusions, including which
implementation was right for each divergence, are in the project config's
measured-behaviour section.

Cases that do not pass are listed with a reason. `frame`, `fromRdf`, `flatten`
and `html` are out of scope for this release and are reported as such rather
than skipped silently.

## What this release does not do

Framing, JSON Schema, the vocabulary document, generated types, the docs site.
The instance-graph overlay on the canvas. Validation L4. RDF to JSON-LD
conversion. The optional LLM layer and the hosted playground.

It also does not upload to a host, fetch from a remote registry, or sign
anything. A checksum detects accident and casual tampering; it is not a
signature, and nothing here implies otherwise.

Deferred is not cancelled — each is reachable from the current design, and
`lat.md/` records how.

## Layout

```
packages/core      parsing, the IR, the JSON-LD processor, validation, emitters
packages/cli       `ldm`, which is what a pull request runs
packages/vscode    webview and diagnostics plumbing only
lat.md/            the design record: what this does and why
openspec/          the change proposals and their specs
```

`core` never imports `vscode`, enforced by lint and by a test that scans the
source — so the conformance suite and every emitter test run in plain Node.

## Licence

MIT.
