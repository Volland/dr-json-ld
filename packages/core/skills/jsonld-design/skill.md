---
summary: Designing a JSON-LD vocabulary — namespaces, when to mint an IRI, and when a key deserves a term.
commands: check, emit, explain
---

# Designing a JSON-LD vocabulary

This is about the decisions that are expensive to reverse. Everything here is
advice; nothing here is a verdict. Where a question is about *your* model, run
the command named beside it — this document has never seen your file.

## Identity is the IRI, never the file path

A term's meaning is its IRI. The key is what a document types, the file is where
you happened to put it, and both can change without changing what the data
means. The reverse is also true and is the dangerous direction: changing an IRI
changes the meaning of every document already published, while every one of them
still parses.

A scaffolded model carries the placeholder namespace `ex` at
`https://example.org/ns#`. Nothing downstream will catch it. A placeholder IRI
resolves, validates and emits exactly as a real one does, so the moment you
create a model is the only moment the tool can point at it. Set the namespace
before you publish anything.

## Reuse an IRI before minting one

If schema.org, Dublin Core or an existing vocabulary already names the thing,
use their IRI. A new IRI is a claim that you mean something nobody else has
meant, and most of the time that claim is false and expensive.

Reuse in this tool looks like one of two things:

- A prefix declaration plus a compact IRI: declare `schema:
  https://schema.org/` under `prefixes:`, then write `"@id": schema:name`. You
  are borrowing their IRI and defining your own term for it.
- A referenced context under `uses:`. You are building on their context, and
  their term definitions come with it. Run `ldm vendor <model>` to fetch and
  hash-pin it; every other command runs with the network off and will refuse a
  context that has not been vendored.

A compact IRI is tried against the declared prefixes *before* the absolute-IRI
test, so `schema:name` is read as the prefix `schema` and not as a URI in a
scheme called `schema` — but only when that prefix is declared. Undeclared, it
silently becomes an absolute IRI in a scheme nobody serves. `ldm check` reports
that as `L1.unknown-prefix`.

## A key deserves a term when a document will type it

The terms layer is a flat map from JSON key to IRI. It is flat on purpose: a
term is global to a context, so one key means one thing everywhere in every
document that context governs. There is no such thing as "`name` when it is on a
Person".

Consequences worth knowing before you fight them:

- Two classes needing the same key with different meanings is not a second
  top-level term. It is a *type-scoped context*: the class term carries its own
  `@context` with its own `name`, which applies below a node of that type. The
  canvas offers this as a promotion when two shapes disagree about a key.
- A key that appears only inside one nested structure still gets a global term.
  If you want it to mean something different in that position, that is a
  *scoped context* on the enclosing term, not a second definition.
- A key that no document will ever contain does not need a term. A vocabulary
  is not an ontology; it is the set of keys your documents type.

## Structure belongs to shapes

Which fields a class has, and how many values each takes, is not something a
`@context` can say. Declare it under `shapes:`. Keep the split clean: a shape
states cardinality and what a value must be; the term states how a key is read.
When a shape's range and a term's coercion disagree the shape is describing
values the context cannot produce, and `ldm check` says so at the field.

A shape with no target class describes a nested node that has no type of its
own — a credential's subject is the usual example — and applies only where a
field's range names it.

Once a model has shapes, its examples are conformance tests. `ldm check` runs
them through L3, and `ldm emit --target shacl` writes the shapes graph a
consumer can run to get the same verdict.

## Coercion is the decision people get wrong

`"@type": "@id"` is what makes a string a reference rather than a label. Without
it, `"author": "https://example.org/kim"` is a *string that looks like a URL*,
and the graph has no edge in it. The document is valid, the expansion succeeds,
and the relationship you thought you wrote is not there.

`ldm check` reports the suspicious version of this as
`L2.coercion-did-not-fire`, and `ldm explain <model> <document>` shows you the
expanded form so you can see whether the edge exists. Use it — this is the
single most common way a model is quietly wrong.

## Containers change the JSON, not the triples

With the sole exception of `@list`, a container changes the shape a document
takes and changes no triple. `@set` means "always an array even when there is
one". `@index`, `@id`, `@type` and `@language` turn a JSON object's keys into
something other than properties.

This matters for design because a container is a decision about the *ergonomics*
of the document, not about the meaning. Choose it for the developer typing the
JSON. The graph will not notice.

`@list` is the exception: it asserts order, and order is a fact about the data.

## Before you publish

Run `ldm check <model>`, then `ldm emit <model>` and read the `@context` it
produced. The context is a generated artifact — it carries a header saying so
and a repository that lets somebody hand-edit it will lose that edit. What you
publish is an interface, and the point of reading it before publishing is that
you cannot take it back.

See the `jsonld-publish` skill for what a version is and why nothing renames
one.
