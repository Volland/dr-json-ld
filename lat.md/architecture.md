# Architecture

jsonld-modeler is a VS Code extension and CLI for authoring JSON-LD contexts as a reviewable YAML model, viewing them as two coordinated diagrams, and generating the `@context` and its downstream artifacts from a single model.

It is a sibling of `lpg-modeler`, which does the same job for Labeled Property Graph schemas, and it deliberately copies that project's shape wherever JSON-LD does not force a different answer. Where it diverges — two panes rather than one diagram, a processor written here rather than a schema compiled, contexts that compose at runtime rather than imports that flatten — the divergence is a consequence of what JSON-LD is, and is argued at the section that introduces it.

## Source of Truth

The canonical artifact is a hand-editable YAML model file holding semantics only. The `@context` is generated from it, as every other artifact is. Diagram coordinates live in a sidecar, so rearranging a diagram changes nothing.

This is the least obvious of the decisions, because a `@context` is unlike a DDL script: it is itself an interchange artifact, published at a stable URL and hand-edited by people who have never heard of this tool. Making it generated buys what a context cannot hold — comments, [[metamodel#Stable Element IDs]], [[metamodel#Shapes]], [[metamodel#Examples]], and the record of which artifact carries which fact. The cost is real and is paid explicitly: a generated context carries a header saying so, and a repository that lets someone hand-edit it will lose that edit. Continuous integration is expected to regenerate and compare.

Importing an existing context is therefore a bootstrap rather than a synchronization — see [[processing#Context Resolution]] for the separate question of contexts the model does not own.

## Surface Syntax

Models are YAML validated by a JSON Schema the extension contributes through `contributes.jsonValidation`, so completion, hover, and structural errors come from VS Code's existing YAML tooling at no cost.

Owning no parser is a deliberate trade, and it is the same one `lpg-modeler` made. The durable asset is the intermediate representation, the processor and the emitters; the surface syntax stays swappable. The schema lives once in `core` and is copied into the extension, with a test asserting the two are identical — an editor and a CLI that disagree about what a model may say is the one failure this arrangement invites.

The file suffix is `.jsonld.yaml`. It is deliberately not `.jsonld`: the file is *about* JSON-LD and is not itself JSON-LD, and a tool that blurred that would be teaching the wrong thing in its first five seconds.

## Package Boundary

The repository is a monorepo of three packages: `core` holds parsing, the IR, resolution, the JSON-LD processor, validation and every emitter; `cli` wraps core for continuous integration; `vscode` adds only webview and diagnostics plumbing.

`core` must never import `vscode`, enforced by lint and by a test that scans the source. This keeps the processor's conformance suite and every emitter test runnable in plain Node with no editor harness, which matters more here than it did for `lpg-modeler`: the W3C JSON-LD 1.1 suite is several thousand cases and must run in continuous integration without an editor anywhere near it.

`core` also holds no network code outside a single explicit resolver, for the reasons in [[processing#Context Resolution#Offline by default]].

## Host Adapter

The webview is written against a narrow host interface — read the model, apply a splice, resolve a vendored context, report a diagnostic, persist layout — rather than against VS Code's messaging API. The extension supplies one implementation.

Two of this tool's purposes, explaining JSON-LD and showing an expansion [[processing#Trace]], produce things people want to send to someone else, and a hosted playground is the natural home for that. Retrofitting a second host onto a webview that assumed `acquireVsCodeApi` is a rewrite of every interaction; writing the seam first costs roughly a tenth of that and is testable in plain Node from the start. The playground itself is deferred — see [[architecture#Roadmap]] — but nothing in the webview may assume its host is an editor.

## Editing Surface

The canvas is a companion webview opened beside the YAML editor, in the manner of Markdown preview. It is the authoring surface: a user creates terms, assigns facets and arranges them without opening the file, which remains canonical and reviewable.

Registering the canvas as a `CustomTextEditorProvider` is rejected for the reason `lpg-modeler` rejected it: it would become the default editor for model files and hide the YAML, forfeiting the schema-driven completion that motivated choosing YAML at all. Canvas edits reach the file as `WorkspaceEdit`s, so the editor owns undo and dirty state.

### Targeted edits

Every canvas action becomes a set of targeted text splices computed from the YAML syntax tree, never a re-serialization of the document.

`Document.toString()` normalizes flow-collection padding across the whole file, so re-serializing turns a one-facet change into a whole-file diff. A block's extent is found by indentation rather than by node range, because a YAML node's own range can run past its block into whatever follows. This is machinery `lpg-modeler` has already proven, and it is the first candidate for the extracted package described in [[architecture#Roadmap]].

### Intents

The webview holds no model state. It posts a named intent, the extension host turns that into edits, and a fresh projection comes back, so nothing on either pane can diverge from the file.

The host handles one intent at a time. A single gesture can post two — creating a term and attaching it to a shape — and both would otherwise be spliced against the same original text, so the second would land at offsets the first had already moved.

The projection carries whatever the metamodel carries. A facet the canvas cannot show silently invites someone to author a model that contradicts what they see, which in JSON-LD is unusually easy: a `@container` the canvas omitted changes what the document must look like without changing any IRI.

### Asking

Every question the canvas asks — a term name, an IRI, a confirmation — is rendered in the document. The webview never calls `window.prompt`, `window.confirm` or `window.alert`.

A VS Code webview is a sandboxed iframe in which those three return immediately without showing anything, so an action routed through one does nothing at all, and does it silently. A test asserts that no webview source reaches for them. Asking in the document also buys what a native prompt cannot: an IRI field that offers the prefixes the model already declares, and the vendored terms that [[processing#Context Resolution#Vendoring]] made available.

### Inspector

The panel beside the panes holds what a term is — its key, its IRI, and its facets — with the common facets given fields and the remainder behind an advanced section plus a raw escape hatch.

Total coverage of JSON-LD 1.1 with curated prominence is locked; the inspector is where the curation lives. Presenting `@propagate` beside `@id` as though they were equally likely would work directly against a tool whose stated purpose includes guiding people toward proper representation. The raw escape hatch exists so that coverage never depends on the inspector having grown a field yet.

## Panes

The canvas is two coordinated representations of one model: a tree pane showing the JSON shape a developer will type, and a graph pane showing the RDF it denotes. They share one selection model.

This is the tool's central claim. Every other JSON-LD tool shows one of these and leaves the reader to infer the other, and the entire difficulty of JSON-LD lives in the gap — a `@container` that restructures the JSON and changes no triple, a `@nest` that vanishes on expansion, a scoped context that makes one key mean two things. Two panes make the gap the subject rather than an omission, and the two-layer [[metamodel#Terms]] already models exactly this distinction.

### Tree pane

The tree pane draws JSON structure: nesting, containers, language maps, `@nest` groupings, and the regions where a scoped context changes the active context.

A scoped context is drawn as a nested region rather than as an annotation, because its effect is positional — it applies below a point and, absent `@propagate: false`, keeps applying. An annotation would state the fact while hiding the scope, which is the part people get wrong.

### Graph pane

The graph pane draws classes, IRIs and the edges between them: what the document means once the JSON is gone.

It is the pane that most resembles `lpg-modeler`'s canvas, and it reuses React Flow with ELK for automatic layout. React Flow is DOM-based and degrades past a few hundred nodes, which is acceptable precisely because [[architecture#Views]] caps how much any one diagram shows.

### Selection

Selecting anything in either pane selects the corresponding thing in the other, and a facet that exists on only one side renders as visibly absent on the opposite pane rather than as nothing.

Absence must be drawn. A user who selects a term with `@container: @set` and sees the tree pane change while the graph pane holds still has learned the lesson the tool exists to teach; a user who sees the graph pane simply not react has learned nothing and may conclude the tool is broken.

## Views

A view names a subset of a model's terms and shapes, forming one pair of diagrams. One model can carry an overview beside several focused ones.

A single diagram of a real vocabulary is unreadable — schema.org alone is on the order of a thousand terms — and this matters more here than for an LPG schema, because a model that layers on a vendored context can reference far more than it declares. Validation reports a declared term that appears in no view, so it cannot be silently invisible.

## Layout

Positions are stored in a sidecar keyed by [[metamodel#Stable Element IDs]], nested per view, so renaming a term does not move its box and moving a box does not change the model file.

Whether the two panes share one sidecar with two coordinate spaces or keep separate sidecars is deliberately unsettled; it is recorded as an open question and must be decided by the change that first persists a tree-pane position. The tree pane may need no coordinates at all if its layout is fully derived from structure, which would settle it by default.

## Examples

A model declares its example documents, stores them as their own files, and records what validating each one must produce.

Keeping payloads out of the model file is a readability decision: a realistic document is hundreds of lines and would swamp the vocabulary it illustrates, and it deserves its own diff. Declaring them in the model is what makes a failure unambiguous — a document that fails has an expectation to fail against, so it is either the document or the model, and the model says which was intended. See [[metamodel#Examples]] and [[validation#Expected Outcomes]].

## Distribution

The extension ships to the Marketplace as `pavlyshyn.jsonld-modeler`; the CLI is `ldm` on npm. The CLI is what a pull request runs.

`ldm` rather than `jsonld`, because `jsonld.js` already publishes a `jsonld` binary and a name collision in a tool whose credibility rests on being the careful one about JSON-LD would be a poor first impression. The extension bundle inlines core so that it is self-contained.

## Roadmap

Work is cut into milestones, each of which leaves the tool usable. The first is a thin vertical slice rather than a layer, because the expensive decisions are all at the seams between layers.

`lpg-modeler` learned this the hard way and recorded it: shipping a compiler first would have left it unusable for its stated purpose until a second release, and visual authoring was pulled forward. The same reasoning applies with more force here, since the differentiating feature is visual.

### Milestone 1

The terms layer, the processor with source mapping, validation L0 to L2, the context target and its inlined variant, context import, vendored resolution, examples, and the dual-pane canvas.

Every seam is exercised once: splice, IR, source map, host adapter, pane coordination, sidecar, continuous integration. Nothing is built on an untested seam. It is also demoable, which a compiler-first path is not.

### Still deferred

Everything outside milestone 1: the shapes layer and every target that consumes it, RDF import, the lockfile, the rule catalog, the optional LLM layer, the hosted playground, and the extracted shared package.

In full: the shapes layer, SHACL, framing and JSON Schema, the vocabulary document, types and the docs site, RDF import, the lockfile and its change classifier, the rule catalog and its explanation corpus, the optional LLM layer, the hosted playground, and the package extracted for sharing with `lpg-modeler`.

Deferred is not cancelled. Each is reachable from this design: the IR serializer orders keys stably so a lockfile can be added without disturbing it, the terms layer leaves the names [[metamodel#Shapes]] will need unoccupied, and [[emitters#Capability Matrix]] is declared from the first target rather than retrofitted when a second appears.

The extracted package waits on evidence rather than intuition. Two consumers is the honest bar for an abstraction and both exist, but which parts generalize is a guess until this project has used them once — with the exception of the [[architecture#Editing Surface#Targeted edits|splice logic]], whose bugs are file-corrupting and must not be fixed twice.
