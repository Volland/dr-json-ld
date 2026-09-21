# Architecture

jsonld-modeler is a VS Code extension and CLI for authoring JSON-LD contexts as a reviewable YAML model, viewing them as two coordinated diagrams, and generating the `@context` and its downstream artifacts from a single model.

It is a sibling of `lpg-modeler`, which does the same job for Labeled Property Graph schemas, and it deliberately copies that project's shape wherever JSON-LD does not force a different answer. Where it diverges — two panes rather than one diagram, a processor written here rather than a schema compiled, contexts that compose at runtime rather than imports that flatten — the divergence is a consequence of what JSON-LD is, and is argued at the section that introduces it.

## Projects

A project names the models that belong together, where their published output goes, and which hosts that output must serve from. It is one file at the root of the directory holding them, and every command resolves a model through it.

A model still works alone: a command given a path and no project behaves exactly as it did before projects existed. The project adds a place to look, not a requirement to have one — which is what makes adopting it a three-step change rather than a migration.

Views stay scoped to one model. A view spanning several would need a term to mean something outside the model that declares it, and [[metamodel#Terms]] is explicit that a term is global to a *context*, not to a repository.

### Starting one

`ldm init` writes a project and its first model; `ldm init model <name>` adds another and registers it. The extension contributes the same two as **New Project** and **New Model**.

Both files come from [[packages/core/src/project/scaffold.ts#projectScaffold|one pair of scaffolds]] in core, so the editor and the CLI write the same bytes. Duplicating them would let the first file a user creates behave differently in continuous integration than it did on their machine — the worst possible moment for that to be true.

`ldm init` writes both files rather than only the project, because the project schema requires at least one model. A project file on its own would fail every command run against it, so a command that produced one would be handing the user a broken state and calling it a start.

Registering a model is a splice, for the reason [[architecture#Editing Surface#Targeted edits]] gives generally: re-serialising the project file would discard the comments the scaffold wrote and turn a one-line addition into a whole-file diff. A model is placed beside the ones the project already declares, so the layout a project chose is the layout it keeps.

#### Placeholder namespaces

A scaffolded model carries `ex` at `https://example.org/ns#` unless the caller passes `--prefix` and `--base`, and both surfaces say so out loud when it does.

Nothing downstream can catch it. A placeholder IRI resolves, validates and emits exactly as a real one does, so creation is the only moment at which the tool can point at it. Deriving the IRI from the directory name instead would be worse: [[metamodel#Identity]] is explicit that identity is the IRI and never the file path, and a guessed IRI is a claim about what the data means.

Neither command overwrites. Rewriting a model that is already there would destroy its [[metamodel#Stable Element IDs|element ids]], which are the one thing in the file that cannot be reconstructed by reading it.

### Checked like a model

The project file is the second canonical file kind, so it is held to what a model file is held to: its findings carry a rule id and a position, they reach the editor as diagnostics, and its schema and its parsing are required to agree.

None of that was true before. Every `L0.project-*` rule existed and `ldm check` reported them, but the editor published diagnostics only for `.jsonld.yaml`, so the only way to learn a project file was wrong was to run a command — in a file the extension itself writes on **New Project**.

The agreement is the same bound the model pair uses, and asserting it found three places where the two disagreed: a model name no command could type, a model path not ending in `.jsonld.yaml`, and a project name the schema's pattern refuses. Each was refused by the schema and accepted by parsing, which is the direction that teaches an author the underline is noise. Each now raises `L0.schema-violation` at its own line.

`ldm init` had refused all three from the beginning, through the same sentence the finding now carries. That is the tell: a tool that will not *create* a name but silently *accepts* it when hand-written has two rules and has not noticed. The name rule and the model suffix live in one place for that reason, used by scaffolding and parsing alike.

Editor diagnostics come from parsing the project file alone, not from checking every model it declares. The file is re-read on each keystroke, and a model's own findings are published against that model's file when it is open.

## Versions and the Published Tree

A version is an immutable, content-addressed snapshot of a model: the model as written, the [[emitters#Change Management#Lockfile|lockfile]], the examples, and the emitted artifacts, under a manifest that hashes every file and then hashes itself.

Publishing a context is publishing an interface, and an interface that can be edited in place is not one. A version is never altered — only superseded — and the store refuses every write into one rather than trusting callers not to try.

### Identity

A version's identity is a hash over its *inputs*: the model, the lockfile and the examples. The manifest hashes every file including the generated artifacts, and carries its own self-hash, but the identity does not come from it.

This is not the first answer. The identity was going to be the manifest hash, until the artifacts had to name the version they belong to — which makes a manifest-derived identity circular and non-convergent, since writing the id changes the bytes that determine it. Deriving the identity from the inputs keeps content-addressing intact, because the artifacts are a pure function of those inputs, and lets a consumer holding only a `@context` say which release it is reading.

The self-hash still matters, and is the difference between a checksum and a table of contents: without it, editing a file *and* its manifest entry would verify cleanly.

A hash detects accident and casual tampering. It is not a signature, and the field is called `integrity` so that nobody reads it as one.

### Aliases

`v2`, `stable`, `latest` are movable labels in a separate file that no version references. Retargeting one changes no version.

This is where immutability and human names stop being in tension. There is no command that renames a version, because there is no operation that could — the name *is* the content hash. A user who means "this release should be called v2" is renaming a label; a user who means "the published bytes were wrong" wants a new version and a retargeted label, which is two commands and is the honest shape of the operation.

### Hosts

A host adapter states what a host requires — path characters it cannot serve, a side file it needs — and publishing validates the whole tree against every adapter the project names before writing anything.

The tool does not upload. Uploading means credentials, retries and a permissions model, and every host already has a mature tool for it. What the tool owes is a tree those tools can copy verbatim, and a refusal when a name would produce a path the target host silently mangles. A tree that works nowhere is not worth half-writing, which is why validation precedes the first write.

A context the project itself published resolves from that tree rather than being vendored a second time, so [[processing#Context Resolution#Offline by default]] holds with one fewer copy of the same bytes.

## Source of Truth

The canonical artifact is a hand-editable YAML model file holding semantics only. The `@context` is generated from it, as every other artifact is. Diagram coordinates live in a sidecar, so rearranging a diagram changes nothing.

This is the least obvious of the decisions, because a `@context` is unlike a DDL script: it is itself an interchange artifact, published at a stable URL and hand-edited by people who have never heard of this tool. Making it generated buys what a context cannot hold — comments, [[metamodel#Stable Element IDs]], [[metamodel#Shapes]], [[metamodel#Examples]], and the record of which artifact carries which fact. The cost is real and is paid explicitly: a generated context carries a header saying so, and a repository that lets someone hand-edit it will lose that edit. Continuous integration is expected to regenerate and compare.

Importing an existing context is therefore a bootstrap rather than a synchronization — see [[processing#Context Resolution]] for the separate question of contexts the model does not own.

## Surface Syntax

Models are YAML validated by a JSON Schema, so completion, hover and structural errors come from the editor's existing YAML tooling rather than from a language server this project would otherwise have to write and maintain.

Owning no parser is a deliberate trade, and it is the same one `lpg-modeler` made. The durable asset is the intermediate representation, the processor and the emitters; the surface syntax stays swappable. The schema lives once in `core` and is copied into the extension and into the published site tree, with a test asserting all three are identical — an editor and a CLI that disagree about what a model may say is the one failure this arrangement invites.

The file suffix is `.jsonld.yaml`. It is deliberately not `.jsonld`: the file is *about* JSON-LD and is not itself JSON-LD, and a tool that blurred that would be teaching the wrong thing in its first five seconds.

### Reaching the editor

The schema reaches the editor through `contributes.yamlValidation`, which is read by `redhat.vscode-yaml`, declared as a hard dependency so that installing this extension installs the thing that executes the schema.

It did not, for the first two releases, and how it failed is the reason the arrangement is now asserted rather than assumed. The manifest contributed the schema through both `jsonValidation` and `yamlValidation`, and nothing read either: `jsonValidation` is read by the editor's own JSON language service, which never sees a YAML file, and `yamlValidation` is read only by an extension nothing here installed or named. The published schema was inert. The one reason for choosing YAML — that an editor would validate it at no cost — bought nothing, while the README promised that nothing needed installing.

A declared dependency rather than a recommendation or an extension pack, because the promise is unconditional. A pack lets a user disable the single component the feature depends on and returns silently to the state above, which is worse than an honest requirement. `redhat.vscode-yaml` is MIT, so the licence costs nothing.

Two properties hold it rather than a convention: every published schema is contributed through a point that *can* apply to the file pattern it names, and whatever reads that point is a declared dependency. Both are checked against the manifest.

#### Executable by the editor

A refusal the editor never evaluates is not an earlier report of anything, so every constraint in both schemas is either expressed in a form the editor runs or recorded as command-only against the rule id that reports it instead.

The record ships empty, and that is a measured result rather than a hope: `yaml-language-server`'s own validators evaluate `propertyNames`, `prefixItems`, `unevaluatedProperties` and `dependentRequired`, so its 2020-12 coverage is effectively total and nothing needed moving.

The check is therefore an allowlist, not a denylist. It fails on a keyword nobody has verified rather than on one known to be broken, because a list of unsupported keywords would assert almost nothing here, while a list of verified ones catches the keyword somebody adds later without checking.

Keyed maps are nonetheless written with `patternProperties` rather than `propertyNames`, for a smaller reason: a bad key then reports at the key itself as "not allowed", and the [[architecture#Distribution#Documentation site#Schema reference|reference page]] prints each map's key shape, which it could not read out of `propertyNames`.

### What the schema refuses

The schema carries the facet co-constraints JSON-LD itself imposes, as named `$defs` entries composed into the term through `allOf`.

They are three: a legal `@container` combination, a `@reverse` term whose container is `@set` or `@index` only, and a `@reverse` term carrying neither `@id` nor `@nest`.

They are named rather than inlined because a JSON Schema validator reports an anonymous `if`/`then` failure as "must not match schema" at the root. A named subschema with a title gives the editor a sentence to print and the [[architecture#Distribution#Documentation site#Schema reference|reference page]] something to document.

The reach stops exactly where [[packages/core/src/validate/validate.ts#validateModel|validation]] stops failing. Two combinations that look like mistakes are deliberately accepted: `@language` beside a `@type` coercion, which JSON-LD ignores rather than refuses, and a 1.1 facet in a `mode: "1.0"` model, which [[metamodel#Terms]] makes a downgrade at warning severity. A schema refusing either would be the only voice saying so, and a warning names a model the tool accepts.

This bound is a property rather than a convention: a corpus of must-accept and must-reject models runs against the schema and against `validateModel`, and a file the two disagree about fails the build. Continuous integration additionally asserts every reject case makes `ldm check` exit non-zero, because the schema is what an editor runs and the command is what a pull request runs.

`raw` is outside the co-constraints, because it exists for constructs the metamodel has not named. It is not a way past the command: the facets are merged into the emitted definition and the processor still reads them, so illegal JSON-LD in `raw` is reported later rather than not at all.

### Published at its own identifier

Each schema is served from the documentation site at a path carrying a schema format version, and its `$id` is the URL it is served from.

The `$id` previously named a host the project does not serve, so every editor outside the extension — and every agent — validated against a 404. A schema whose identifier is not the URL it answers at is worse than an unpublished one, because each `$ref` inside it resolves against the wrong base, so the deploy asserts the two match rather than trusting them.

The version segment is the model format version the file's own `jsonld:` key declares. A schema change that rejects a model the served schema accepted goes to a new segment *and* bumps that format version, because a model that must change to keep validating is a model-format change and not a packaging one. A change that only loosens or re-describes is published in place.

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

### Quick fixes

A finding names what is wrong and where. For a few rules there is exactly one legal repair, and those are offered as a quick fix on the diagnostic: a registry in `core` keyed by rule id, returning the same targeted splices the canvas uses.

The registry is keyed by rule id rather than inferred, because a guessed repair to a file the user owns is worse than no repair. A rule absent from it offers nothing, and each absence has a stated reason: the information is not in the finding (`L1.unknown-prefix`), there are two legal repairs (`L1.facet-not-in-mode`), the remedy is a network command rather than an edit (`L1.context-not-vendored`), or the repair is deletion (`L2.term-unused`).

It lives in `core` and returns splices rather than editor edits, so the same repair is reachable from a command, and every entry is testable in plain Node. The extension is a lookup and a translation into one `WorkspaceEdit`, which is also what makes a fix a single undo step. It re-validates to find the finding rather than rebuilding one from the diagnostic, because a diagnostic carries a rule id and a position but not the pointer and subject a repair reads.

The property that makes the registry safe to extend is per-entry and executable: apply the fix, re-validate, and the finding it claimed is gone while no error that was absent before has appeared. A fix that silenced a finding by breaking something else fails it.

A repair that changes what the model *means*, rather than only making it legal, must say so in its title. Nothing uses that yet. Its intended first user is `L2.coercion-did-not-fire`, which is reported in an example document and repaired in the model — a cross-file fix the registry cannot express while a fix is splices against one file.

### Intents

The webview holds no model state. It posts a named intent, the extension host turns that into edits, and a fresh projection comes back, so nothing on either pane can diverge from the file.

The host handles one intent at a time. A single gesture can post two — creating a term and attaching it to a shape — and both would otherwise be spliced against the same original text, so the second would land at offsets the first had already moved.

The projection carries whatever the metamodel carries. A facet the canvas cannot show silently invites someone to author a model that contradicts what they see, which in JSON-LD is unusually easy: a `@container` the canvas omitted changes what the document must look like without changing any IRI.

A gesture that needs several dependent edits is one intent that makes them all, applied in turn and returned as the one splice spanning what changed — so it is one undo step. Adding a field whose key has no term declares the term too; a promotion may create a class term, point the shape at it and add the scoped term. Renaming a term renames, in the same edit, every field that resolves to it and every view entry naming it, so a shape never loses a field to a rename. Scoped terms are edited by element id wherever they sit; one written as a flow mapping or a bare IRI, as contexts usually write them, is rewritten as a one-line flow mapping.

### Shape builder

Selecting a shape opens it in the inspector as a table of fields: key, range, `min`, `max`, and the coercion of the term the key resolves to. Each row says its cardinality and range are carried by `shacl`, absent from `@context`.

The coercion is shown beside the range because the two must agree and belong to different layers — [[metamodel#Shapes#Shapes own cardinality, terms own coercion]]. Adding a field offers existing keys first; a key with no term asks for its IRI in the document and adds both. When a range and a coercion disagree the row carries the finding and offers a promotion — give the class its own term for the key, in its type-scoped context — which is asked, never applied, because the alternative of changing the shared term's coercion would silently change every other class that uses it.

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

A scoped context is drawn as a nested region rather than as an annotation, because its effect is positional — it applies below a point and, absent `@propagate: false`, keeps applying. An annotation would state the fact while hiding the scope, which is the part people get wrong. Its scoped terms are drawn inside the region, and each is its own element: selecting a scoped `name` selects that term, not the top-level `name`.

With a shape selected, the pane draws the JSON skeleton a conforming document takes: its keys with their cardinality, the form each value takes, nested shapes as nested objects, and the class's type-scoped region around the keys read in it. A shape reached again below itself is drawn once, as a reference, so a recursive shape stays finite.

### Graph pane

The graph pane draws classes, IRIs and the edges between them: what the document means once the JSON is gone. A shape is drawn as its class carrying its fields, with an edge per class or shape range labelled `key min..max`.

It is the pane that most resembles `lpg-modeler`'s canvas, and it reuses React Flow with ELK for automatic layout. React Flow is DOM-based and degrades past a few hundred nodes, which is acceptable precisely because [[architecture#Views]] caps how much any one diagram shows.

### Selection

Selecting anything in either pane selects the corresponding thing in the other, and a facet that exists on only one side renders as visibly absent on the opposite pane rather than as nothing.

Absence must be drawn. A user who selects a term with `@container: @set` and sees the tree pane change while the graph pane holds still has learned the lesson the tool exists to teach; a user who sees the graph pane simply not react has learned nothing and may conclude the tool is broken.

## Views

A view names a subset of a model's terms and shapes, forming one pair of diagrams. One model can carry an overview beside several focused ones.

A single diagram of a real vocabulary is unreadable — schema.org alone is on the order of a thousand terms — and this matters more here than for an LPG schema, because a model that layers on a vendored context can reference far more than it declares. Validation reports a declared term that appears in no view, so it cannot be silently invisible.

## Layout

Positions are stored in a sidecar keyed by [[metamodel#Stable Element IDs]], nested per view, so renaming a term does not move its box and moving a box does not change the model file.

The tree pane persists no coordinates: its layout is fully derived from structure, which settles by default the question of whether the two panes share one sidecar with two coordinate spaces. The sidecar holds graph-pane positions only. A change that first wants a persisted tree-pane position must reopen the question rather than assume an answer.

## Examples

A model declares its example documents, stores them as their own files, and records what validating each one must produce.

Keeping payloads out of the model file is a readability decision: a realistic document is hundreds of lines and would swamp the vocabulary it illustrates, and it deserves its own diff. Declaring them in the model is what makes a failure unambiguous — a document that fails has an expectation to fail against, so it is either the document or the model, and the model says which was intended. See [[metamodel#Examples]] and [[validation#Expected Outcomes]].

## Authoring Skills

The tool ships guidance documents for the coding agent that now writes the first draft of most models. `ldm skill list` names them; `ldm skill install` writes them.

Four of them: designing a vocabulary, writing the model file, reading a finding, and publishing a version.

A skill is prose and produces nothing. Locked decision 16 requires the LLM layer to be optional, clearly labelled, and never the source of a diagnostic, an edit or a continuous-integration result, and that is held structurally rather than by discipline: nothing in `check`, `emit`, `explain` or `diff` reads the skills, and a test asserts `ldm check` gives identical findings and the identical exit code with them installed and absent. Where a skill would need a fact about a particular model it names the command that produces it, because a document cannot know what is in a file it has never seen.

The skills live in [[packages/core/src/skills/skill.ts#loadSkills|core]] rather than in the CLI. The extension is the obvious second consumer, and moving them later would change the source paths for anyone who had vendored them. They are markdown read at run time rather than strings baked into `dist`, so `tsc` stays the typechecker and nothing new enters the build.

### Three formats, one source

Agent Skills, a vendor-neutral `AGENTS.md` bundle and Copilot chatmodes are three framings of the same body, each produced by a pure function from the parsed skill.

Three hand-written files per skill is what every project shipping multi-agent guidance does, and it is why their formats disagree within two releases. Here the guard is mechanical: [[packages/core/test/skills.test.ts|a test]] parses each rendering back out and asserts the body, the rule ids and the commands are identical across all three. Frontmatter differs; content cannot.

Prose that is merely out of date is not detectable and is accepted — it is why a skill routes to a command rather than answering. What *is* checkable is checked: every rule id a skill names must exist in the registry, and every command it names must be a command. A skill citing a rule that was renamed sends the reader looking for something that is not there, which is worse than citing none.

### Installing

`ldm skill install` requires `--project` or `--user`, and has no default.

The failure mode of guessing is writing files into a directory the caller did not mean, and a wrong `--user` install is invisible — it then applies to every repository they open afterwards.

Overwrite protection is by comparison rather than by timestamp: a file identical to what would be written is *current*, a file that differs is *modified* and is left alone, and `--force` takes the new version. There is no merge, because a skill is prose and a three-way merge of prose is a worse outcome than a clear refusal.

The home directory is reached through [[packages/cli/src/io.ts#Io|the CLI's `Io` seam]] rather than from `node:os` at the call site, for the same reason `cwd` is: a verb that writes outside the working directory has to be drivable by a test that does not write into the home directory of whoever is running it.

Nothing here reaches the network — the skills ship inside the package — and continuous integration proves it by running the install in a network namespace holding only loopback, as every offline step there runs.

## Distribution

The extension ships to the Marketplace as `pavlyshyn.jsonld-modeler`; the CLI is `@json-ld-modeler/ldm` on npm, installing a command called `ldm`. The CLI is what a pull request runs.

`ldm` rather than `jsonld`, because `jsonld.js` already publishes a `jsonld` binary and a name collision in a tool whose credibility rests on being the careful one about JSON-LD would be a poor first impression. The bare name `ldm` turned out to be taken too — an unrelated log viewer holds it — so the package is scoped and only the command is short. The command is the name a user types every day; the package name is one they type once.

Each published package carries its own README and a copy of the licence. npm renders only what is inside the tarball, so a scoped package whose page is empty reads as abandoned, and the two packages have different audiences: the CLI page is for someone choosing a tool, the core page for someone building on the library. Both link the site, the handbook and the extension, because the install is where a reader arrives first.

Every install line outside this repository names `@json-ld-modeler/ldm`. The bare `ldm` on npm is the unrelated log viewer, so a `npm install -g ldm` in the site or the extension README installs somebody else's software — it is a wrong instruction rather than a stale one, and the scoped name is used even where the short command reads better.

The extension bundle inlines core so that it is self-contained. The CLI does not: it declares `@json-ld-modeler/core` as an ordinary dependency, because npm can resolve it and a published library is worth more to anyone building on the model than a saved megabyte is.

`tsc` is the typechecker, not the packager. It emits ESM with a bare import of `@json-ld-modeler/core`, and the extension host loads CommonJS and has no way to resolve a workspace package, so the shipped artifact is produced by `packages/vscode/build.mjs`: one CommonJS bundle with core inlined, and one self-contained IIFE for the canvas. A webview is a sandboxed iframe with no module loader, so the canvas cannot be anything else.

The build then loads the CommonJS bundle against an inert `vscode` and fails if it throws. Inlining core means core's module scope runs inside the extension host, where `import.meta.url` is undefined; 0.3.0 shipped resolving the skills directory eagerly, activation threw, and every command reported "not found". Core therefore resolves file paths on first use, never at module load.

`vsce` therefore runs with `--no-dependencies`, and `.vscodeignore` keeps the tsc output, the sources and the build tooling out of the `.vsix`. What ships is the two bundles, the icon, the two JSON Schemas and the three documents the Marketplace renders.

The Marketplace icon must be a PNG, so the artwork in `packages/vscode/media/` is authored as SVG and rasterized from it. The mark draws its letterforms as paths rather than setting them as text, because a logo that depended on a font being installed would render differently on whichever machine happened to build it.

### Documentation site

`site/` is a hand-written static site served from GitHub Pages: an introduction to the tool, a nine-chapter JSON-LD handbook, and four essays. No generator and no build step, so the deployed bytes are the committed bytes.

Jekyll runs on this host unless `.nojekyll` is present, and it drops every path beginning with an underscore. The marker is committed and the deploy workflow asserts it, because the failure it prevents is a silent 404 rather than a build error.

The workflow also resolves every relative `href` and `src` against the committed tree before deploying. A relative path that is wrong resolves anyway when a page is opened from disk, so the check has to run somewhere that is not a local browser.

#### Schema reference

`site/schemas/` serves the JSON Schemas at the URLs their `$id`s name, and beside each one a generated page documenting every field it defines, its type, whether it is required, and each named co-constraint.

The page is generated into the repository by `scripts/schema-reference.mjs` and the workflow re-runs the generator and fails on a diff. Generating at deploy time would produce a page nobody reviewed, and this one makes factual claims about the schema's fields; the arrangement is the same regeneration-and-compare the emitted `@context` uses, for the same reason. The generator lives outside `site/` because everything under `site/` deploys verbatim and a build script is not part of the published site.

Two assertions are added to the deploy rather than trusted. Every `*.schema.json` must parse and its `$id` must equal its served path — nothing else would catch a moved directory, because a schema is not an HTML page and the link checker never opens one. And the schema copies are compared in the *other* workflow as well, because this one fires only on `site/**`: a schema edited in `core` and not mirrored here would otherwise deploy nothing, change nothing, and leave the published URL quietly serving the old rules.

#### Legal pages

The site carries a German Impressum, Datenschutzerklärung and Nutzungsbedingungen, linked from the footer of every page. The operator is resident in Germany, so § 5 DDG applies to a documentation site as much as to a shop.

Two claims in those pages are asserted by the deploy workflow rather than trusted. Every page must link to all three, because an Impressum that is reachable from the landing page and nowhere else is the usual way this obligation is missed. And no page may fetch a subresource from another origin, because the Datenschutzerklärung says none does.

The second claim is why the fonts are self-hosted. Loading them from Google's CDN sends every visitor's IP address to Google, which LG München I ruled unlawful without consent (20.01.2022, 3 O 17493/20) — and a consent banner for a static documentation site is a worse outcome than serving 280 KB of WOFF2. Both families are SIL Open Font Licence 1.1, which permits it.

A checksum is not a signature, and the Nutzungsbedingungen say so in their own clause rather than leaving it to the README. A user who mistakes `integrity` for provenance has made a legally consequential mistake, not merely a technical one.

## Roadmap

Work is cut into milestones, each of which leaves the tool usable. The first is a thin vertical slice rather than a layer, because the expensive decisions are all at the seams between layers.

`lpg-modeler` learned this the hard way and recorded it: shipping a compiler first would have left it unusable for its stated purpose until a second release, and visual authoring was pulled forward. The same reasoning applies with more force here, since the differentiating feature is visual.

### Milestone 1

The terms layer, the processor with source mapping, validation L0 to L2, the context target and its inlined variant, context import, vendored resolution, examples, and the dual-pane canvas.

Every seam is exercised once: splice, IR, source map, host adapter, pane coordination, sidecar, continuous integration. Nothing is built on an untested seam. It is also demoable, which a compiler-first path is not.

What it ships: the terms layer with total JSON-LD 1.1 facet coverage and a published JSON Schema; parse, resolve and a canonically ordered IR; expansion and compaction implemented here with a JSON Pointer carried through every step; an opt-in trace; validation L0 to L2 with a rule-id registry; vendored, hash-pinned context resolution with a single fetcher; the `context` and `context-inline` targets with the capability sets in [[emitters#Capability Matrix]]; import with a semantic round-trip property; the CLI; and the dual-pane canvas with views and the layout sidecar.

What it measured rather than assumed: the processor's conformance against the W3C JSON-LD 1.1 suite and against `jsonld.js`, recorded per case in `docs/conformance/` and summarised in the project config. Expansion passes the large majority of the suite and compaction rather less; both are ratcheted, and the remaining gaps are named by cause rather than tallied.

The open question this milestone settles: **the two panes do not share a layout sidecar.** The tree pane persists no coordinates — its layout is derived entirely from structure — so the sidecar holds graph-pane positions only, keyed by [[metamodel#Stable Element IDs|element id]] and nested per view. Whether a future tree pane needs coordinates is a question for the change that first wants them.

### Milestone 2

The shapes layer, the SHACL target and L3 executed by a real engine, with scoped contexts made first-class on the way. The instance-graph overlay, the rest of the milestone, is not yet built.

What it ships: scoped terms with ids and facets, in the model, the IR, import, emit and comparison; `shapes:` with fields, cardinality and ranges, resolved through the processor's own active context; the L1 findings a shape can raise about itself; conversion to RDF with a pointer on every triple; the `shacl` target; L3 through `rdf-validate-shacl`, on by default for a model with shapes; classification of shape and scope differences; and a shape builder on the canvas.

What it measured: closing four type-scoped reversion cases took the expand suite from 336 to 341 and the differential from 256 to 261 agreeing cases. The `toRdf` class passes 415 of 444 attempted cases, every failure an expansion gap. The bundled extension grew from 215 KB to 668 KB with the SHACL engine and Turtle parser.

### Still deferred

Everything outside milestones 1 and 2: RDF import, the rule catalog, the optional LLM layer, the hosted playground, and the extracted shared package.

In full: the instance-graph overlay, framing and JSON Schema, the vocabulary document, types and the docs site, RDF import, the rule catalog and its explanation corpus, the optional LLM layer, the hosted playground, the `shacl` artifact inside a published version, and the package extracted for sharing with `lpg-modeler`. The lockfile and its change classifier, once on this list, ship.

Deferred is not cancelled. Each is reachable from this design: the IR serializer orders keys stably so a lockfile can be added without disturbing it, the terms layer leaves the names [[metamodel#Shapes]] will need unoccupied, and [[emitters#Capability Matrix]] is declared from the first target rather than retrofitted when a second appears.

The extracted package waits on evidence rather than intuition. Two consumers is the honest bar for an abstraction and both exist, but which parts generalize is a guess until this project has used them once — with the exception of the [[architecture#Editing Surface#Targeted edits|splice logic]], whose bugs are file-corrupting and must not be fixed twice.
