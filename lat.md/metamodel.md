# Metamodel

A model declares a namespace, the terms it defines, the example documents that exercise them, and — from milestone 2 — the shapes that give those terms structure. It is YAML, and it is the only file a user edits.

The metamodel has two layers and the split is load-bearing. The terms layer is mechanically context-shaped: everything in it emits into a `@context` one for one, and nothing in it means anything a JSON-LD processor would not already agree with. The shapes layer carries structure a context cannot express at all. Keeping them apart is what lets every surface in the tool answer honestly which of the two knows a given fact, and it is why the canvas can draw [[architecture#Panes#Selection|a facet as absent]] on the pane that cannot hold it.

## Terms

A term maps a JSON key to an IRI and carries the JSON-LD facets that govern how values under that key are read. Terms are global to a model, as they are global to a context.

Globality is a property of JSON-LD rather than a simplification: a `@context` is a flat map, and one entry for `author` governs every occurrence of `author` anywhere in the document unless a [[metamodel#Terms#Scoped Contexts|scoped context]] intervenes. A metamodel that let two classes each own an `author` term would be modelling something JSON-LD cannot emit, and would produce a context that quietly contradicted the diagram. This is the single most common way a graph-schema intuition misleads here.

### Facets

A facet is one JSON-LD keyword on a term: `@id`, `@type`, `@container`, `@language`, `@direction`, `@protected`, `@context`, `@nest`, `@reverse`, `@prefix`, `@index`. The metamodel covers all of them.

Total coverage is not optional. Importing a real context that uses a facet the model cannot hold would force the importer either to fail or to lie, and being the tool people bring their existing context to is the whole on-ramp. Coverage is separated from prominence: the inspector curates, the metamodel does not — see [[architecture#Editing Surface#Inspector]].

Two facets are singled out because they are routinely misunderstood. `@type: @id` is what makes a string a reference rather than a label, and its absence is the most common cause of a document that expands into a graph with no edges. `@protected` is the only facet that constrains what a *later* context may do, which is why removing one is classified as illegal rather than breaking — see [[emitters#Change Management#Change Classification]].

### Prefixes and Vocab

A model declares prefixes and may declare `@vocab`. Both are terms in the emitted context and both are modelled explicitly rather than inferred from the shape of an IRI.

`@vocab` deserves a warning the tool is expected to give: it makes every unmapped key expand rather than drop, which converts the loudest failure in [[validation#The Ladder#L2 Lossiness]] into a silent one. A key with a typo becomes a real IRI nobody serves. It is the right tool for a closed internal vocabulary and the wrong one for a published context, and the distinction belongs in the guidance catalog rather than in a refusal.

The implementation settled two things here. A model's namespace prefix is its identity rather than a declaration, so it is kept out of the declared `prefixes` and merged in only where resolution needs it — emitting it unasked would add a term to the artifact that the author never wrote, and an import round trip would read it back as one. And a compact IRI is resolved against the declared prefixes *before* being tested as an absolute IRI, because `schema:name` satisfies both readings and testing the other way round silently mints `schema:name` as its own scheme.

### Scoped Contexts

A term or a type may carry its own context, which changes the active context below the point where it applies. The metamodel holds type-scoped and property-scoped contexts as first-class, along with `@propagate`.

This is where a key stops meaning one thing. A scoped context is the mechanism by which `name` under a `Person` and `name` under a `Product` may be different properties, and it is the only way JSON-LD offers to do that. It is also the feature most likely to produce a document whose author cannot explain what it means, which is why it is drawn as [[architecture#Panes#Tree pane|a region rather than an annotation]] and why the [[processing#Trace]] records every active-context change.

#### Scoped terms

A scoped context written as a map holds terms of its own. Each entry is resolved by the same term parser as a top-level term — element id, facets, note — to any depth; keyword entries are settings of that context.

The map keeps the `@context` key rather than gaining a new one, so the model still reads like the context it emits, and import has one form to produce. A bare IRI or `null` entry is accepted as a context writes it, and `ldm ids` rewrites it to a mapping so it can carry an id. A `@context` given as an IRI or an array is a reference to someone else's context and holds no terms of this model.

In the IR, scoped terms join the one flat term array with a `scope` naming their parent, and the parent records the map's settings. Flat rather than nested because diffing, the projection, the layout sidecar and rename detection all walk one id-keyed array. Key uniqueness is per map: `name` at the top level and `name` under `publisher` are two terms. The emitter rebuilds the map from settings and scoped terms, dropping ids and notes, and a scoped term without `@id` is emitted as written so a processor reads it against `@vocab` exactly as before.

This is what makes a credential context — almost entirely protected type-scoped contexts — something the canvas can edit rather than an opaque blob.

### Containers

`@container` governs the JSON shape a value takes — `@list`, `@set`, `@index`, `@id`, `@type`, `@language`, `@graph` — and, with the exception of `@list`, changes no triple.

This is the clearest case of the gap the two panes exist to show. `@set` is worth its own note because it is the closest thing JSON-LD has to future-proofing: a term declared `@set` is always an array, so a property that becomes multi-valued later does not change the shape of every document that already exists. That advice belongs in the guidance catalog.

## Processing Mode

A model declares whether it targets JSON-LD 1.1 or 1.0. The declaration is part of the model, not a flag on a command.

A 1.0 processor does not reject a 1.1 context; it reads it differently, which is a silent divergence rather than an error, and it is invisible to the author. Making the target explicit lets every 1.1-only facet become a [[emitters#Capability Matrix|downgrade]] at its own site when the model targets 1.0. Putting it on the command instead would mean the same model file was correct or incorrect depending on how it was invoked, which no diagnostic could then be attached to.

## Identity

A term has two names and they are not interchangeable: the JSON key consumers write, and the IRI the data means. Neither is the term's identity.

Changing the key breaks every consumer's documents while changing no triple. Changing the IRI changes what the data asserts while every document continues to parse. A tool that called both "a rename" would be misreporting one of them, and the one it misreported would be whichever mattered more. Identity is therefore separate from both — see [[metamodel#Stable Element IDs]] — and the distinction is what [[emitters#Change Management#Change Classification]] is built on.

## Stable Element IDs

Every term, shape and example carries a short generated identifier, backfilled by the tool and written into the file. It is the term's identity, and both the key and the IRI are mutable attributes of it.

Ids are what make a rename a rename. Without them, a key change is indistinguishable from a delete plus an add, which would lose the box's position on every diagram, lose the shape references pointing at it, and — once the lockfile exists — report a breaking change as a removal and an unrelated addition. A file that carries no identifiers yet is read with derived ones, which follow the key: they survive a reload but not a rename, until the tool writes real ones in.

Scoped terms and shapes carry ids too. A scoped term's derived id folds in the keys enclosing it, so it survives a reload but not a rename of its parent — the same contract a top-level derived id has with its own key. A shape field has no id of its own: its identity is its shape plus the element id of the term its key resolves to, which is what lets a term rename carry the field with it.

Ids are written as a targeted splice rather than by re-serialising, for the reason in [[architecture#Editing Surface#Targeted edits]], and the splice is computed from the *key's* range rather than the value's: a term's value is the mapping that starts on the next line, so inserting relative to it puts the id inside the first facet instead of beside it.

## Namespaces

A model declares a prefix and a base IRI, which together give its own terms their global identity. Identity is the IRI, never the file path.

A vocabulary that is worth writing down is worth being referenceable, and a term whose identity depended on where its file happened to sit could not be referenced by anyone else. This also means minting IRIs is a commitment the tool should say out loud: an IRI that resolves to nothing is a defensible choice, and one made by accident is not.

Versioning does not touch this. A model may name the [[architecture#Projects|project]] it belongs to, and a project publishes each version at its own path — but a term's IRI is what the model declares and nothing else. A term does not acquire a version number, and the same term in two versions is the same term. What is versioned is the artifact, not the meaning.

That separation is what keeps rename detection working across a version boundary: matching is by [[metamodel#Stable Element IDs|element id]], so a key change reads as a key change and an IRI change reads as a meaning change, in a comparison of two releases exactly as in one working tree.

## Shapes

The shapes layer declares class-level structure: which terms a class uses, their cardinality, their value ranges, and whether the class is open or closed. None of it is expressible in a `@context`.

It is the unblocker for almost everything after: [[validation#The Ladder#L3 Shape Conformance]], the [[emitters#Downstream Targets#SHACL Shapes|SHACL target]], the frame that pins a JSON shape, the JSON Schema derived from that frame, and the instance overlay on the [[architecture#Panes#Graph pane]]. The first two ship; the rest remain reachable from it.

One question was settled in advance because it decides the layer's shape: cardinality belongs to a shape, not to a term. A term is global and a class is not, so two classes may legitimately disagree about how many values a property takes. Coercion — `@type`, `@container`, `@language` — belongs to the term, because JSON-LD gives it nowhere else to live.

### A shape and its fields

A shape names a target class — a class term, or an IRI — or none, and says whether it is closed. Its fields are keyed by the JSON key a document uses under the class, each with `min`, `max` and a range.

A range is `iri`, `node`, `literal`, `langString`, a datatype, `{ class }` or `{ shape }`; nesting a shape in a range is how a credential's structure is described. A shape without a target class applies only where a range names it, which is how an untyped nested node — a credential's subject — is described; requiring every shape to have a class was tried and dropped the first time a real credential was modelled.

### Field keys resolve as a processor would

A field key resolves in the active context a processor applies to a node of the target class: the model's context, then the class term's type-scoped context. The processor's own context machinery answers it, never a second resolver.

A model-level lookup was rejected: it would diverge from expansion exactly where expansion is hardest, and L3 would then contradict L1 with nobody able to say which was right. The model's own context is used when the IR is resolved; referenced contexts are consulted again by validation and by the SHACL emitter, where they can be read. When a shape is reached through a field whose term carries a property-scoped context that redefines one of its keys, the key means two things, and that is `L1.shape-field-ambiguous`.

### Shapes own cardinality, terms own coercion

A field may narrow what a key's values must be but never how they are read. A range that contradicts the term's coercion is a finding at the field, and its repair is a type-scoped context, never a quiet change to the shared term.

`L1.shape-range-coercion-conflict` covers a datatype range on a reference-coerced key, a plain-string range on a language map, and the like; `L1.shape-range-needs-id-coercion` warns that a node range on a term with no `@type: @id` accepts only embedded objects, because a string becomes a literal. The canvas offers the repair as a promotion: the class gets its own term for the key, with the shared IRI and the coercion the shape needs, and every other class keeps reading the key as before.

## Examples

A model declares each example document by path, names what it is meant to exercise, and records the outcome validating it must produce, including the specific findings a negative example must raise.

An example without an expectation cannot fail usefully, because nothing says whether the document or the model was wrong. Recording the expectation makes the model self-testing in continuous integration, gives the [[architecture#Panes|canvas]] real data to project, and — because a negative example names its finding ids — makes the validator's own test suite and the teaching material the same artifact. See [[validation#Expected Outcomes]].

A positive example tolerates nothing above `info` unless it says otherwise. Defaulting to tolerating a warning was tried and rejected: lossiness is a warning, and it is the thing this tool exists to catch, so that default would have made the flagship finding non-failing in continuous integration.

## Format Version

A model file declares the version of this format it is written against, so it can be validated by anything rather than only inside this tool.

Self-description is what allows the JSON Schema to be published and the file to be read by tooling that has never heard of the extension. It is also how a future format change stays diagnosable rather than presenting as a parse error.

## Composition

A model may build on contexts it does not own. Those are referenced, not imported: an external context stays a live layer in the emitted artifact rather than being flattened into it.

This is the sharpest divergence from `lpg-modeler`, where an import is sealed and flattened. JSON-LD composes at runtime by design — `"@context": ["https://schema.org", {…}]` is the idiom, not a workaround — and flattening it silently forks the upstream vocabulary, so the consumer no longer receives upstream fixes and may collide with a consumer who loaded the original. Flattening remains available as [[emitters#Inlined Context Target|a separate target]] for consumers who cannot fetch at runtime, and it reports the fork rather than performing it quietly.

What the tool knows about a referenced context comes from [[processing#Context Resolution#Vendoring]], and it is what makes completion, collision detection and protected-term checking possible at all.
