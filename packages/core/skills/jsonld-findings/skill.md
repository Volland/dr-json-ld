---
summary: Reading a finding — what the levels mean, what the common rule ids are asking for, and what to do about them.
commands: check, explain, emit
---

# Reading what `ldm check` tells you

Every finding carries a rule id, a level, a severity, and a line and column into
your own file. The rule id is the stable part: a message can be reworded, an id
cannot, so quote the id when you write something down.

```
model.jsonld.yaml:14:3  error   L1.unknown-prefix  "schema:name" uses the prefix ...
```

`ldm check <model> --json` gives the same thing as structured output, which is
what to use when something else has to read it.

## Exit codes

`0` clean, `1` findings at error severity, `2` a usage error.

Only **errors** fail. A warning names a model the tool accepts — most often a
downgrade, where a fact in your model cannot be carried by the target you asked
for. Info is an observation.

This distinction is the whole design: the tool refuses what JSON-LD refuses, and
reports everything else without blocking you.

## The levels

- **L0 — well-formedness.** The file parses, the structure is right, ids are
  unique, declared examples exist, a project and its models agree about each
  other.
- **L1 — the context is legal JSON-LD.** Prefixes resolve, IRIs are well formed,
  facets combine legally, referenced contexts are vendored and match their
  hashes.
- **L2 — what your documents actually lose.** Runs your example documents
  through expansion and reports what fell out.

`--level L0`, `L1` or `L2`; the default is `L2`.

## The findings that matter most

**`L2.key-dropped`** — a key in your document mapped to no term and expanded to
nothing. This is the finding this tool exists for. JSON-LD expansion is total: it
does not fail on a key it cannot resolve, it drops it. A document can lose most
of its content while every processor involved reports success. Fix by defining
the term, or by declaring `vocab:` if you meant unmapped keys to expand.

**`L2.key-dropped-under-vocab`** — the same, but you declared `@vocab`, so
instead of vanishing the key expanded to an IRI you never minted. Quieter and
worse.

**`L2.coercion-did-not-fire`** — a value that reads as a reference expanded as a
literal, because no `@type: "@id"` applies to its term. Your graph has a string
where you meant an edge. Run `ldm explain <model> <document>` and look at the
expanded form.

**`L1.unknown-prefix`** — a compact IRI uses a prefix the model does not declare,
so JSON-LD reads it as an absolute IRI in a scheme of that name. Declare the
prefix under `prefixes:`.

**`L1.context-not-vendored`** / **`L1.context-hash-mismatch`** — a referenced
context has not been fetched, or no longer matches the hash recorded for it. Run
`ldm vendor <model>` to fetch and re-pin. A mismatch is a hard error on purpose:
the bytes you validated against are not the bytes you have.

**`L1.facet-not-in-mode`** — a warning. A facet JSON-LD 1.1 introduced, in a
model declaring `mode: "1.0"`. A 1.0 processor ignores it; the message says what
that costs. The model is accepted.

**`L1.invalid-container-mapping`** / **`L1.invalid-reverse-property`** — a facet
combination JSON-LD forbids. These are also refused by the JSON Schema, so your
editor should have underlined them before you ran anything.

**`L2.term-unused`** / **`L2.term-in-no-view`** — info. A term no example
exercises, or one no view includes so it appears on no diagram.

## Examples make the model self-testing

A model declares its example documents and what validating each must produce:

```yaml
examples:
  - path: documents/ok.json
    expect: { ok: true, maxSeverity: info }

  - path: documents/empties.json
    note: Every key maps to nothing; expansion succeeds and the document empties.
    expect:
      rules:
        - L2.key-dropped
```

A negative example names the rule ids it *must* raise. That is what makes a
failure unambiguous — a document that fails has an expectation to fail against,
so it is either the document or the model that is wrong, and the model says
which was intended. Add one whenever you fix a finding, so it cannot come back.

## When a finding does not make sense

Do not guess at what the expansion did. `ldm explain <model> <document>` prints
the expanded document, `--trace` prints the ordered algorithm steps that
produced it, and the observations at the end name what the document lost. That
is the ground truth; this document is not.
