---
summary: Writing the .jsonld.yaml model file — the fields, the facets, and what the schema refuses.
commands: init, check, emit, ids, import
---

# Writing a model file

The model is the canonical artifact. The `@context` is generated from it, as
every other artifact is. Edit the model; never edit the output.

## Point your editor at the schema

```yaml
# yaml-language-server: $schema=https://volland.github.io/dr-json-ld/schemas/model/1/model.schema.json
```

The VS Code extension contributes the same schema automatically for
`*.jsonld.yaml`. The published URL is for everything else — another editor,
another tool, or an agent that wants to check its own draft before writing it.

The `1` in that path is the model format version, the same `1` the file's
`jsonld:` key declares. It does not change meaning, so a model pinned to it goes
on validating.

## The shape of the file

```yaml
jsonld: "1"

namespace:
  prefix: ex
  base: https://example.org/ns#

mode: "1.1"          # or "1.0"; a property of the model, never a command flag

prefixes:
  schema: https://schema.org/
  xsd: http://www.w3.org/2001/XMLSchema#

uses:                # contexts you build on but do not own
  - iri: https://schema.org/
    integrity: sha256-...       # written by `ldm vendor`

terms:
  name:
    id: aaa111                  # element id; generated, stable, do not retype
    "@id": schema:name
  Person:
    id: per001
    "@id": schema:Person

shapes:                         # class structure a @context cannot express
  Person:
    id: shp001
    targetClass: Person
    fields:
      name: { min: 1, max: 1 }

examples:
  - path: documents/ok.json
    expect: { ok: true }

views:
  - name: Overview
    terms: [name, Person]
    shapes: [Person]
```

`jsonld`, `namespace` and `terms` are required. Everything else is optional.
Quote the facet keys — `"@id"`, not `@id` — because a bare `@` starts a YAML
directive.

## Element ids are identity

Every term — scoped terms included — every shape, example and view carries a short generated `id`. That id is the
thing the tool treats as identity; the key and the IRI are both mutable
attributes of it. Renames are detected through ids and never inferred from
similarity, which is why `ldm ids <model>` exists — it backfills ids for
anything written by hand.

An element id is the one thing in the file that cannot be reconstructed by
reading it. Nothing in this tool will overwrite a model that already has them,
and neither should you.

## The facets a term may carry

`@id`, `@type`, `@container`, `@language`, `@direction`, `@protected`,
`@context`, `@nest`, `@reverse`, `@prefix`, `@index` — the whole of JSON-LD 1.1
— plus `raw` for anything the model format has not yet named, and `note` for
documentation a `@context` cannot hold.

A term must carry at least one of `@id`, `@reverse` or `raw`. Without one of
those there is nothing to map the key to.

## Scoped terms

A term's `@context`, written as a map, holds terms of its own. Each entry is a
term with an element id and facets, exactly like a top-level one; the keyword
entries (`@protected`, `@propagate`, `@vocab`, …) are settings of that context.

```yaml
  VerifiableCredential:
    id: vc0001
    "@id": cred:VerifiableCredential
    "@context":
      "@protected": true
      issuer: { id: is0001, "@id": cred:issuer, "@type": "@id" }
```

A key may appear once per map, so `name` at the top level and `name` inside
`publisher`'s context are two terms. A bare IRI (`name: schema:legalName`) is
accepted, and `ldm ids` rewrites it to a mapping so it can carry its id. A
`@context` given as an IRI or an array is a reference to someone else's context
and holds no terms of this model.

## Shapes

`shapes:` says which fields a class has, how many values each takes and what
they must be. A shape names its `targetClass` — a class term or an IRI — or no
class at all, for a nested node that is only reached through another shape's
field. `closed: true` forbids properties no field names (`rdf:type` is always
allowed).

A field is keyed by the JSON key a document uses under the class, and states
`min`, `max` and `range`:

- `iri`, `node` (an IRI or blank node), `literal`, `langString`
- a datatype such as `xsd:dateTime`
- `{ class: Person }` or `{ shape: Address }`

The key resolves as a processor would resolve it under the class: its
type-scoped context first, then the model's terms. Shapes own cardinality;
terms own coercion. A range that disagrees with how the term reads the key — a
datatype on an `@type: @id` term, a node range on a term with no `@type: @id` —
is reported at the field (`L1.shape-range-coercion-conflict`,
`L1.shape-range-needs-id-coercion`). Fix it on the term, or give the class its
own term in its type-scoped context.

A model with shapes is checked through L3 by default: every example is converted
to RDF and validated against the SHACL that `ldm emit --target shacl` writes, and
a violation is reported at the JSON Pointer of the value or key in the document.
A negative example names the `L3.*` rules it must raise.

## What the schema refuses

Only combinations JSON-LD itself forbids:

- **A container combination that is not legal.** `@list` combines with nothing.
  Otherwise at most one container beyond `@set`, except that `@graph` may pair
  with `@id` or `@index`. Reported by the command as
  `L1.invalid-container-mapping`.
- **A reverse property with a container other than `@set` or `@index`**, and
  **a reverse property carrying `@id` or `@nest`** — `@reverse` already names the
  IRI. Both reported as `L1.invalid-reverse-property`.

Two things that look wrong and are deliberately accepted:

- **`@language` beside a `@type` coercion.** JSON-LD reads `@language` only when
  `@type` is absent, so the language is ignored rather than refused. It is legal,
  and the schema does not have opinions the command does not.
- **A 1.1 facet in a `mode: "1.0"` model.** That is a downgrade, reported as
  `L1.facet-not-in-mode` at *warning* severity. The model is accepted and
  `ldm check` exits zero.

`raw` is outside all of these, because it exists for constructs the format has
not named. It is not a way past the command: the facets are merged into the
emitted definition and a JSON-LD processor still reads them, so illegal JSON-LD
in `raw` is still illegal — reported later, and reported.

## Editing an existing model

Preserve comments and key order. Every edit this tool makes is a targeted splice
rather than a re-serialization, because re-serializing normalizes formatting
across the whole file and turns a one-facet change into a whole-file diff. Do
the same by hand: change the lines you mean to change.

## Do not hand-edit the generated context

`ldm emit <model>` writes the `@context`. It carries a header saying it is
generated. Continuous integration regenerates and compares, so an edit made
there is an edit that will be lost — and lost silently, at whatever moment
somebody next runs the command.

If you have a `@context` and no model, that is `ldm import <context>`. It is a
bootstrap, not a synchronization: it recovers what a context can express and
names, out loud, what it cannot.
