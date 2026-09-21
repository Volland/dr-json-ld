# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] — 2026-09-21

### Fixed — the 0.3.0 extension registered no commands

Every command — Open Canvas, New Project, New Model, Backfill Element Ids —
failed with "command 'jsonldModeler.…' not found". The authoring skills added in
0.3.0 resolved their directory from `import.meta.url` when the module loaded.
Core is inlined into the extension's CommonJS bundle, where that value is
undefined, so loading the extension threw before any command was registered. The
palette still listed them, because it reads the manifest.

The directory is now resolved on first use, and the extension build loads its own
bundle and fails if doing so throws, so a module-scope crash can no longer ship.
All four commands were run in a real editor against the packaged extension before
this release.

### Fixed — `ldm import` read back nothing `ldm emit` wrote

An emitted context opens with `//` header lines, and `import` parsed it as strict
JSON, so the tool refused its own output. It now strips those lines first, as the
publish resolver already did.

## [0.3.0] — 2026-09-20

### Fixed — the published schema never reached your editor

The extension contributed its JSON Schema through `contributes.yamlValidation`,
which only Red Hat's YAML extension reads, and through `contributes.jsonValidation`,
which never applies to a YAML file at all. Nothing declared or recommended the
former, so on a clean install neither fired: a model file got no completion, no
hover and no structural error, while the README promised there was nothing to
install. Choosing YAML *because* an editor would validate it had bought nothing.

`redhat.vscode-yaml` is now a declared extension dependency, so installing this
extension installs what executes the schema. The dead `jsonValidation` entries
are gone. Two build checks hold it: a schema may only be contributed through a
point that can apply to the file pattern it names, and whatever reads that point
must be a declared dependency.

### Added — the project file is checked in the editor

`ldm.project.yaml` now reports findings as diagnostics at the line that produced
them. Every `L0.project-*` rule already existed and `ldm check` already reported
them; only the Problems panel stayed empty — in a file the extension itself
writes on **New Project**.

### Added — quick fixes for findings with one legal repair

A reverse term carrying a facet it may not carry, a duplicated element id, and a
term missing from the model's only view each offer a fix. Every repair is a
targeted splice, so comments and key order survive and the change is one undo
step. A rule with no single repair offers nothing rather than a guess.

### Changed — four files the tool used to accept are now refused

**This can turn a passing build red.** Holding each schema to what the
corresponding command accepts found four disagreements, every one of them a file
the schema refused and the command let through:

- a prefix name that cannot stand on the left of a compact IRI
- a model name no command could type
- a model path not ending in `.jsonld.yaml`
- a project name that cannot appear in a published path

Each now reports `L0.schema-violation` at its own line. `ldm init` had refused
all four from the beginning, through the same sentence the finding now carries —
so the tool had two rules and had not noticed. The name rule and the model suffix
now live in one place, used by scaffolding and parsing alike.

If `ldm check` starts failing after this upgrade, these are why, and the finding
names the file and the line.

### Added — a page for each published package

`@json-ld-modeler/ldm` and `@json-ld-modeler/core` each carry a README, a copy of
the licence, and the npm metadata that was missing: description, keywords,
repository directory, homepage and issue tracker. The CLI page is written for
someone choosing a tool — install, a real `ldm check` transcript, the command
table, a continuous-integration snippet and the exit codes. The core page is
written for someone building on the library — runnable examples for expansion
with observations, validation, tracing and emit, and a map of what the package
exports. Both link the site, the handbook, the essays and the extension.

### Fixed — the install line named the wrong package

The site and the extension README said `npm install -g ldm`, which installs an
unrelated log viewer: the bare name was taken, which is why the package is
scoped. Every install line and npm link outside this repository now names
`@json-ld-modeler/ldm`.

### Added — a fourth essay

*The format an agent and a human can share* joins the notes: why the interaction
layer rather than the graph model is the hard part, what expansion buys, what an
agent needs at a data boundary, and where JSON-LD-native storage stands.

## [0.2.0] — 2026-09-19

### Added — getting started

`ldm init` writes a project and its first model; `ldm init model <name>` adds
another and registers it in the project file, as a splice that leaves the file's
comments and ordering intact. The extension contributes the same two as **New
Project** and **New Model**, and **New Model** now places a model beside the ones
the enclosing project declares and registers it there.

Both surfaces share one pair of scaffolds in core, so the editor and the CLI
write the same bytes rather than relying on a test to notice when they stop
matching. Neither command overwrites an existing model: that would destroy its
element ids, the one thing in the file that cannot be reconstructed by reading
it. A scaffolded model keeps its placeholder namespace unless `--prefix` and
`--base` say otherwise, and both surfaces say so — a placeholder IRI resolves,
validates and emits exactly as a real one does, so nothing later can catch it.

## [0.1.0] — 2026-09-19

### Added — projects, versions and publishing

**Projects.** An `ldm.project.yaml` names the models that belong together, where
published output goes, and which hosts it must serve from. Commands find it by
searching upward. A model that declares no project resolves, emits and validates
exactly as before — this is additive throughout.

**Versions.** `ldm version new` freezes a model as an immutable,
content-addressed version holding the model as written, the lockfile, the
examples and the emitted artifacts, under a manifest that hashes every file and
then hashes itself. A version is never altered, only superseded; the store
refuses every write into one. Creating a version from a model with an error
finding, or with derived element ids, is refused.

**Aliases.** `ldm alias set | rename | rm | list` moves human names over
immutable versions. There is deliberately no command that renames a version: its
name is its content hash, so there is nothing to rename. Every alias operation
leaves every version byte-identical.

**The published tree.** `ldm publish` writes a static tree serveable from
GitHub Pages, an S3 bucket or any plain file host with no configuration. Host
adapters declare what each host requires — `.nojekyll`, an extension on every
key — and the whole tree is validated against every named host *before* the
first write, so a tree that works nowhere is never half-written. Publishing is
reproducible and uploads nothing.

**Comparison.** `ldm diff` compares two versions from their lockfiles, with
neither model file present, matching elements by element id so a rename reads as
a rename. Every difference is classified `additive`, `compatible`, `breaking`,
`semantic` or `illegal`, with an ambiguous direction classified `breaking`.
`--fail-on` gates a pull request. This is milestone 3's lockfile and change
classifier, pulled forward: an immutable version whose difference from its
predecessor cannot be named is a filing system, not a release process.

**Search.** `ldm search` finds a term across every published version and every
vendored context, offline, reporting which field matched and where the result
came from. A version that fails verification contributes nothing and is reported
as skipped. Matching nothing is a success.

**Self-published references.** A model may build on a version its own project
published; that resolves from the published tree, hash-checked, with no second
vendored copy and no network request.

**The canvas** gains a project-level model picker and a read-only panel showing
versions and aliases. Changing either stays at the command line, where the act
is explicit and reviewable.

### Changed

- Every emitted artifact belonging to a version names that version and its
  project in its header. An artifact emitted outside a version names neither,
  rather than a placeholder — its header is byte-identical to before.
- The lockfile lives inside a version rather than beside the model, so two past
  versions can be compared. Its content is unchanged.
- A model may declare the `project` it belongs to. Optional; a disagreement
  between a model and the project listing it is reported at the model.
- A view naming a term its own model does not declare is now an error.
- `ldm --help` works (previously the flag landed in the command slot).
- A positive example now tolerates nothing above `info` by default.

### Decided

- **A version's identity is a hash of its inputs, not of its manifest.** The
  first design said the manifest hash, which implementation showed to be
  circular: the artifacts name the version, the manifest hashes the artifacts,
  and the identity comes from the manifest. Identity therefore covers the model,
  the lockfile and the examples; the manifest still hashes every file and itself,
  for verification.
- **The checksum is not a signature.** The field is named `integrity` and the
  documentation says so. Signing is a separate change with a key-management
  story.

### Added — milestone 1, the thin vertical slice

The first release. A layered build was rejected: the expensive decisions are all
at the seams between layers, so every seam is crossed once before anything is
built on top of it.

**Model format.** `<name>.jsonld.yaml` declaring a namespace, a processing mode,
prefixes, referenced contexts with integrity hashes, `terms` with total JSON-LD
1.1 facet coverage, examples with expected outcomes, and named views. A JSON
Schema 2020-12 published from `core` and contributed to the editor, with a test
asserting the two copies are byte-identical.

**Element ids.** A short stable identity on every term, example and view,
backfilled by `ldm ids` as a targeted splice that preserves comments and key
order. A file with no ids resolves with derived ones, and the IR records which
of the two each was.

**Processor.** Expansion and compaction implemented in this project, carrying a
JSON Pointer from every produced node, value and dropped key back to the input.
An opt-in trace of each algorithm step, off by default and asserted not to
change the output. Framing, canonicalization and N-Quads are delegated.

**Conformance.** The W3C JSON-LD 1.1 suite vendored as a fixture and run with
the network off, plus a differential test against `jsonld.js` over every
in-scope case. Failing cases are listed with a reason; out-of-scope classes are
named rather than skipped silently. Reports land in `docs/conformance/`.

**Validation L0 to L2.** Well-formedness; context errors located at the term in
the model rather than in a generated artifact; and lossiness — keys that
expanded to nothing, IRIs left relative, blank nodes minted where an identifier
was expected, coercion that did not fire, and terms defined but unused. Every
finding carries a stable rule id from a registry, a JSON Pointer and a resolved
line and column, in an order that depends only on the input.

**Context resolution.** `ldm vendor` fetches each referenced context once into a
committed directory and records its hash. Every other command reads only that
directory. The fetcher follows redirects, requires a JSON-LD content type unless
explicitly overridden, and does not honour a `Link` header pointing elsewhere.
`ldm vendor --check` verifies hashes without fetching.

**Emit.** The `context` target, which keeps referenced contexts as a live layer,
and `context-inline`, which flattens them from the vendored copies and reports
the fork as a downgrade. Both declare a capability set; the two differ in
exactly one entry. Every emitted artifact is loaded by an independent
implementation and used to round-trip every declared example.

**Import.** `ldm import` turns an existing `@context` into a model, recovering
every facet it states and reporting what a context structurally cannot carry —
class membership, documentation, the intent behind `@vocab` — rather than
inventing it. Import then emit is semantically equal to the input; a second
round is byte-identical.

**CLI.** `ldm check | emit | import | vendor | ids | explain`, exiting 1 on
findings at error severity and 2 on a usage error.

**Canvas.** Two coordinated panes derived from one projection — the JSON shape
and the RDF graph — sharing one selection model, with a facet that exists on
only one side drawn as visibly absent on the other. Scoped contexts as nested
regions, `@nest` groups, named views, an inspector with a raw escape hatch, and
graph-pane layout in a sidecar keyed by element id and nested per view. Every
question is asked in the rendered document; a test asserts that no webview
source reaches for `window.prompt`, `window.confirm` or `window.alert`.

### Decided

- **The two panes do not share a layout sidecar.** The tree pane persists no
  coordinates — its layout is derived entirely from structure — so the sidecar
  holds graph-pane positions only. This settles an open question by default
  rather than answering it wrongly.

### Not in this release

The shapes layer and every target that consumes it, validation L3 and L4, RDF to
JSON-LD conversion, the lockfile and change classifier, the rule catalog, the
optional LLM layer, the hosted playground, and the package extracted for sharing
with `lpg-modeler`. Each is reachable from the current design; the IR serializer
already orders keys stably so a lockfile can be added without disturbing it.
