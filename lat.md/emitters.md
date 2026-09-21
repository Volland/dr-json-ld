# Emitters

An emitter turns the resolved IR into one artifact for one target. The `@context` is a target like any other, which is what the [[architecture#Source of Truth]] decision means in practice.

Targets divide into two groups. The context targets are mechanical: the [[metamodel#Terms|terms layer]] is context-shaped by construction, so emitting it is a projection rather than a translation, and almost nothing can be lost. Every other target consumes the [[metamodel#Shapes|shapes layer]] and is a genuine translation into a formalism with its own limits, which is where the capability matrix earns its place.

## Capability Matrix

Every target declares what it can express. A model fact that a requested target cannot carry is a downgrade: an editor diagnostic at the site in the model, and a comment at the lossy position in the generated artifact.

The matrix is declared from the first target rather than retrofitted when a second appears, because it is also the seam a future plugin interface would expose, and because a downgrade discovered late tends to be resolved by widening the metamodel — which is the wrong repair. Nothing is ever silently dropped. This is inherited wholesale from `lpg-modeler`, where it was the decision that kept a generated artifact honest about what it had not enforced.

For milestone 1 the matrix has one interesting entry: a model targeting [[metamodel#Processing Mode|processing mode]] 1.0 that uses a 1.1-only facet. The context still emits, and the downgrade says what a 1.0 processor will do with it instead.

### Shipped capability sets

Both context targets declare the same eight capabilities and differ in exactly one. Keeping the rest identical is what makes the difference legible, and a test asserts that only `external-reference` differs.

| capability | `context` | `context-inline` |
| --- | --- | --- |
| `external-reference` | `full` — references stay live | `downgraded` — flattened, forking upstream |
| `terms` | `full` | `full` |
| `prefixes` | `full` | `full` |
| `scoped-contexts` | `full` — rebuilt from scoped terms | `full` |
| `documentation` | `none` — a context has nowhere to put a note | `none` |
| `element-ids` | `none` — identity stays in the model | `none` |
| `examples` | `none` — examples stay in the model | `none` |
| `shapes` | `none` — the `shacl` target carries them | `none` |

A `none` entry is named in the artifact's header rather than left to be noticed. `shapes` is named only when the model declares shapes: a model without them has nothing the context is failing to carry, and naming it anyway would have churned every artifact written before the shapes layer existed. No individual shape raises a downgrade against a context target.

The `shacl` target declares its own set, and two of its entries are downgrades at a field:

| capability | `shacl` |
| --- | --- |
| `shapes` | `full` |
| `documentation` | `full` — `sh:description` |
| `prefixes` | `full` — Turtle prefixes |
| `terms` | `none` — coercion is a context fact |
| `scoped-contexts` | `none` — resolved into field paths |
| `external-reference` | `none` — decides only what keys resolve to |
| `list-cardinality` | `downgraded` — counts distinct members, not positions |
| `named-graphs` | `none` — a `@graph` container's values are not reached |
| `element-ids` | `none` |
| `examples` | `none` — L3 validates them against this graph | A downgrade's comment sits at the position it concerns, which means an emitted artifact is JSON with `//` lines; the execution test strips them and hands the strict JSON to an independent implementation, so what is verified is the same bytes minus the commentary.

## Context Target

The default target emits a `@context` document that references its external contexts by IRI, preserving the array form, with the model's own terms as the final layer.

Referencing rather than flattening is what JSON-LD's own model of composition assumes, and it keeps the artifact small, the diff readable, and upstream fixes reaching the consumer. The emitted file carries a header identifying it as generated and naming the model it came from, because the decision to generate an artifact people are used to hand-editing is only safe if the artifact says so.

Ordering is stable and derived from the model rather than from a hash, so that a change to one term produces a one-line diff.

## Inlined Context Target

A second target emits the same context with every referenced context flattened into it, producing a self-contained document that needs no network at runtime.

It exists because some consumers genuinely cannot fetch, and it reports what it has done rather than doing it quietly: inlining forks the upstream vocabulary at a moment in time, so the consumer stops receiving upstream corrections and may collide with another consumer who loaded the original. That is a downgrade in the matrix, not a formatting option. The vendored copy is the source, so the artifact is reproducible — see [[processing#Context Resolution#Vendoring]].

## Downstream Targets

Everything below consumes the shapes layer. SHACL ships; the rest are recorded here so that nothing built so far forecloses them.

The dependency order is worth stating once: shapes unblock SHACL; SHACL is the authority for [[validation#The Ladder#L3 Shape Conformance]]; a frame pins the compacted shape; JSON Schema and generated types both describe that pinned shape and are meaningless without it.

### SHACL Shapes

The shapes layer emitted as a SHACL shapes graph, over the expanded form of a document.

It is emitted and executed by the same definition, which is the point: a consumer who runs the shipped SHACL gets the same verdict the tool gave. Constraints that SHACL cannot express, and constraints whose closed-world reading would contradict an open-world one, are downgrades rather than reinterpretations — the mistake `lpg-modeler` locked a decision against when it restricted OWL to a safe assertional subset.

As built, `ldm emit --target shacl` writes Turtle by hand rather than through a library writer, because a downgrade's comment must sit at the property shape it concerns and Turtle — unlike JSON — has comments. Each shape becomes a node shape at `<namespace base><Name>Shape` with `sh:targetClass`; each field a property shape whose path is the property its key resolves to, or `sh:inversePath` of it for a `@reverse` term. Ranges map to SHACL core: `sh:nodeKind`, `sh:datatype`, `sh:class`, `sh:node`. A closed shape always ignores `rdf:type`.

A field on a `@list` term constrains the list's members through `rdf:rest*/rdf:first`, and when it states a cardinality that is a downgrade, since SHACL counts distinct members rather than positions. A field on a `@graph` container gets no constraint at all, and says so, since a shapes graph does not reach into named graphs. The execution test parses the output with an independent Turtle parser and runs it with two independent SHACL engines over RDF from `jsonld.js`; they must agree with each other and with each example's declared outcome.

It is not yet one of a version's artifacts: a published version carries the context targets. Adding it there is a separate change to the published tree.

### Frame and JSON Schema

A frame that pins the compacted JSON shape, and a JSON Schema 2020-12 describing that pinned shape.

They ship as a pair because a JSON Schema without a frame asserts a shape [[processing#Compaction|compaction does not guarantee]]. Together they are what makes a context useful to an API team that knows no RDF, which is the broadest adoption path this project has.

### Vocabulary Document

The model's own vocabulary as a dereferenceable document: labels, comments, class hierarchy, and the safe assertional subset only.

A context maps terms to IRIs, and a published vocabulary whose IRIs resolve to nothing is a promise not kept. What the tool should recommend about where those IRIs live and how they are versioned is an open question and must be settled before this target ships, since the target is the thing that would encode the recommendation.

### Types and Docs

TypeScript types generated from the frame-pinned shape, and a human-readable documentation site for the vocabulary.

Both are strictly derivative and are the easiest things to defer. The documentation site can reuse the generation pipeline `lpg-modeler` already has.

## Change Management

A canonical, stable-ordered snapshot of the resolved IR carried by every version, diffed between two of them to classify what changed.

This is the feature that turns the tool from a convenience into something an organization adopts, because publishing a context is publishing an interface and nothing in the JSON-LD ecosystem tells you when you have broken it. It was planned for milestone 3 and pulled forward with versioning: an immutable version whose difference from its predecessor cannot be named is a filing system, not a release process.

### Lockfile

Canonical JSON of the resolved IR, arrays sorted by [[metamodel#Stable Element IDs|element id]], object keys sorted. It lives inside each [[architecture#Versions and the Published Tree|version]].

Sorting by id rather than by name means reordering declarations changes nothing and a rename does not present as a move. Locking a model whose ids are derived rather than written is refused, because a rename could not then be told from a removal plus an addition.

This section originally placed the lockfile beside the model. It moved, and the reason is comparison: comparing two versions must work when neither model file is present — from a published tree alone, or between two tags. A lockfile beside the working tree can only ever compare the present against one past, never two pasts. The content is unchanged; only where it lives is.

### Change Classification

Every change is matched by element id and classified: `additive`, `compatible`, `breaking`, `semantic`, or `illegal`.

The five classes exist because JSON-LD's failure modes do not collapse into the usual three. A JSON key change is `breaking` — consumers' documents stop compacting the same way — while asserting nothing different about the data. An IRI change is `semantic`: every document still parses and every one now means something else, which is more dangerous than a break and would be misfiled as one. Removing a `@protected` term is `illegal`, since the protection was a promise to downstream contexts. Adding `@container: @set` is `compatible`. An ambiguous direction classifies as `breaking`, because a false alarm costs a review and a false `additive` costs production data.

`ldm diff --fail-on` gates a pull request on the class, comparing two versions by identity or by alias.

Scoped terms are matched by element id like any other. A term whose id moves from one context map to another is `breaking`, since the set of documents in which its key has that meaning changed; the report names both scopes. A lockfile from before scoped terms records a scoped context as one value, and it is compared as one value, with a note that its terms could not be matched individually.

The [[metamodel#Shapes|shapes layer]] added kinds of difference, not classes — the five were chosen for JSON-LD's failure modes, and they fit. A shape is matched by id and a field by the id of the term it resolves to. Each difference is classified by what it does to documents that conformed: raising a minimum, lowering a maximum, narrowing a range or closing a shape is `breaking`; the reverse, and removing a field or shape, is `compatible`. A new shape is `additive` for a new class and `breaking` for a class the older version already declared, whose documents were unconstrained. A range changed to an unrelated one is `breaking` under ambiguity.

## Verification

No artifact ships that is only snapshotted. Every emitted artifact is executed by an independent implementation of the standard it claims to speak, and golden files exist solely to detect unintended churn.

`lpg-modeler` recorded the reason: a golden file froze an invalid comment syntax that the target database rejected, proving only that the output had not changed rather than that it was ever valid. JSON-LD is an unusually favourable case for this rule, because every artifact here has a third-party implementation available — the emitted context is loaded by `jsonld.js` and used to round-trip every [[metamodel#Examples|example]], the emitted SHACL is executed by a SHACL engine and must reject each negative example, the emitted JSON Schema is run by `ajv`, and the processor itself is measured against the W3C suite as described in [[processing#Conformance]].

Round-trip properties are first-class tests rather than an afterthought: a model that emits a context, imports it and resolves to the same model; a document that expands, compacts and expands to a fixed point; and a source pointer that always resolves to a node that exists.
