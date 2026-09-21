# Processing

Expansion and compaction are implemented in this project rather than delegated, because both the validation story and the teaching story need something no library exposes: a record of which input produced which output, and of how it got there.

Writing a JSON-LD processor is the largest single item in the plan and it is not undertaken for independence. It is undertaken for provenance. Every finding the tool reports must point at a position in the user's own document, and every explanation it offers is worth more when it runs on the user's own data than when it paraphrases the specification.

## Expansion

Expansion turns a compacted document into the form the specification defines, resolving every key against the active context and discarding what does not map.

That discarding is the behaviour the tool exists to make visible. Expansion is total: it does not fail on a key it cannot resolve, it drops it, and a document can lose most of its content while every processor involved reports success. A processor that merely returns the expanded form gives no way to see this, which is why the implementation records drops as it makes them rather than reconstructing them afterwards — see [[validation#The Ladder#L2 Lossiness]].

## Compaction

Compaction is the inverse, applying a context to an expanded document to produce idiomatic JSON. It is implemented here for the same reason as expansion, and it is what makes [[processing#RDF Conversion]] produce something a developer would willingly read.

Compaction does not produce a unique shape. Whether a single-valued property appears as a value or a one-element array, and whether a graph wrapper appears at all, depends on the data and on the context. This is why a JSON Schema over the compacted form is only honest when a frame pins the shape first, and it is recorded here so that the deferred [[emitters#Downstream Targets#Frame and JSON Schema]] target is not attempted without one.

## Source Mapping

Every node, value and dropped key in an expansion carries a JSON Pointer back to the input that produced it, and the pointer resolves to a line and column in the file the user edited.

This is the feature. A validation finding expressed in RDF terms is unactionable in a visual tool: the user is looking at their JSON, and being told that a triple failed a shape constraint gives them nothing to click. Correlating input and output after the fact was rejected because it degrades exactly where JSON-LD is confusing — `@nest`, type-scoped contexts, value objects, `@included` — which is precisely where the pointer is most needed. Carrying the pointer through the algorithm costs a field on an internal structure and never degrades.

A finding without a source pointer is not considered finished work.

The envelope is a side table rather than a wrapper object: the pointer is stored on each produced object under a symbol, so the expanded value is ordinary JSON and stripping provenance is a structural clone rather than a filter. That is what makes "provenance does not leak into output" a property the type system cannot accidentally violate.

RDF conversion extends the source map to triples: each triple records the pointer of the node object behind its subject, and of the key and value behind its predicate and object. That is what lets an L3 violation — which arrives as a focus node, a path and a value — land on the key or value the author typed. See [[processing#RDF Conversion#From JSON-LD to RDF]].

One observation is retracted rather than reported. A node inside an `@id` map is expanded before the map key reaches it, so it looks like a blank node on the way through; the container then supplies its identifier. Reporting the loss anyway would be a false positive at exactly the place a container is doing its job.

## Trace

An expansion may be run in traced mode, producing an ordered record of the algorithm's steps: each term lookup, each IRI resolution, each change to the active context, each value coerced, each key dropped, and each triple emitted.

The trace is the deep explanation feature, and it is a by-product of the instrumentation the source map already requires rather than a separate build. Prose about how JSON-LD works is abundant and mostly unread; the same explanation running on the document the user is currently confused about is not. It is also the only honest way to explain a [[metamodel#Terms#Scoped Contexts|scoped context]], whose whole behaviour is a sequence of active-context changes.

Traced mode is off by default. The trace is large and only the editor and the CLI's explain verb ask for it. The recorder only observes: a traced run and an untraced run produce identical output, which is asserted rather than assumed.

## Conformance

Conformance is observed, not claimed. The processor runs the W3C JSON-LD 1.1 test suite, and every case is additionally run through `jsonld.js` with the two outputs compared.

The suite alone proves the processor handles the cases the working group thought of. The differential test against a reference implementation catches the rest, and — more usefully — turns every disagreement into a question with a right answer, which is recorded in the project config's measured-behaviour section rather than resolved from memory. A case where this project is right and the reference is wrong is a finding worth writing down; assuming it without checking is not.

Cases the processor does not pass are listed rather than hidden, with the reason and whether it is intended. The per-case reports are regenerated by the test run into `docs/conformance/`, and the conclusions — including which implementation was right for each divergence — are recorded in the project config's measured-behaviour section.

Each suite carries a ratchet constant in its test file. It exists so an unexplained regression fails the build; raising it is a deliberate act that accompanies a fix, never a way to make a red build green.

The `toRdf` class is run too, over this processor's own expansion and RDF conversion, with datasets compared after URDNA2015 canonicalization so blank node labels never decide a result. As measured when it was added: 415 of 444 attempted cases pass, and every failure is an expansion gap shared with the expand class rather than a conversion bug. The differential against `jsonld.js` agrees on 320 datasets; of the 14 divergences, 5 are cases where this processor matches the suite and `jsonld.js` does not — two of them because `jsonld.js` writes an IRI it should have dropped straight into its N-Quads output.

## Delegated Algorithms

Framing, URDNA2015 canonicalization and N-Quads parsing are delegated to existing libraries rather than implemented here. Conversion to RDF is not: it is on the provenance path.

The line is drawn at provenance. Expansion and compaction are on the path between what the user wrote and what the tool reports, so they must carry pointers. Canonicalization is a pure function over an already-expanded graph with no user-facing intermediate steps, and framing — while user-facing — operates on expanded output whose pointers already exist. Implementing them would add risk and conformance surface for no provenance gain.

## Context Resolution

A model's [[metamodel#Composition|referenced contexts]] are resolved from a vendored copy in the repository, never from the network, except during an explicit refresh.

Resolution is what makes authoring intelligent: completion over terms the model does not declare, detection of a term that collides with an upstream one, and the check that a redefinition does not violate an upstream `@protected`. None of that is possible if a referenced context is an opaque string, and none of it should require a network connection to be reliable.

### Vendoring

An explicit command fetches each referenced context once, writes it into a committed directory, and records its integrity hash in the model. A mismatch between the recorded hash and the vendored file is a hard error.

This is the lockfile lesson, applied to a dependency that is unusually easy to overlook. An upstream context can be edited by its publisher with no commit on your side, and every artifact you emit and every validation you run would change meaning underneath you. Vendoring turns that into a reviewable diff produced by a deliberate act. The cost is that someone must refresh, which is the correct place for the cost to fall.

The directory layout mirrors the IRI — `contexts/<host>/<path>.jsonld` — so a reader can tell what a file is without opening it. Path segments are sanitised, because a model names the IRIs and a traversal segment in one must not decide where a file lands.

### Offline by default

Every command other than the refresh runs with no network access at all.

Reproducibility is the first reason: a build that fetches is a build that can fail or change for reasons no commit explains, and air-gapped continuous integration is a normal requirement. The second reason is narrower and sharper. A model file names the URLs to fetch, so a command that fetches what a model tells it to, running in continuous integration against a pull request from outside, is a request-forgery primitive. The refresh command is the one place that risk exists, and it is invoked by a person rather than by a pipeline.

Continuous integration enforces this rather than asserting it: each offline step runs through `scripts/offline.sh`, in a fresh network namespace holding only loopback. The first mechanism, dropping all outbound traffic on the runner, also cut the runner off from GitHub, and every job ended as "lost communication with the server" — so the isolation is per step, not per machine.

## RDF Conversion

JSON-LD converts to RDF inside the processor, carrying pointers, because L3 needs them. The reverse direction — RDF back into idiomatic JSON-LD — is a core conversion that is still deferred.

### From JSON-LD to RDF

The Deserialize JSON-LD to RDF algorithm runs over this processor's own expanded output, and every triple carries the pointers of the input that produced it.

It is implemented here rather than delegated because the pointer is the feature. Re-deriving pointers from a delegated conversion would mean matching triples back to the input by value, which is ambiguous exactly when a value repeats. Blank nodes are labelled in document order, so a document always converts to the same labels.

IRI resolution was rewritten for it as RFC 3986 section 5.2 over the strings themselves. The WHATWG `URL` parser it replaced percent-encodes characters, lower-cases hosts and appends a slash to an authority with no path — `//g` against `http://a/b` became `http://g/` — and each of those changes an IRI, which changes a triple. An IRI that is not well formed (whitespace, `<>`, a second `#`) is dropped rather than asserted, as the algorithm requires.

### From RDF to JSON-LD

RDF in any of the usual syntaxes converts to JSON-LD by the specification's own algorithm and is then compacted against the model's context, so the result is idiomatic rather than raw expanded form.

The second half is what makes this worth shipping. Converting Turtle to expanded JSON-LD is a solved problem available in several libraries and produces output nobody wants to read. Compacting it against a context the user controls produces the JSON their application would actually use, which is the reason they wanted the conversion. It is deferred past milestone 1 but is a core conversion rather than an add-on.
