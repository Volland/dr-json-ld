# Differential against `jsonld.js` — toRdf

Suite base: `https://w3c.github.io/json-ld-api/tests/`. Network off; both implementations read the vendored tree. Datasets are compared after URDNA2015 canonicalization.

Compared: 334. Agreed: 320. Diverged: 14. Not compared: 133.

## Divergences, adjudicated against the expected dataset

### This processor is right

- `#tc037` property-scoped contexts which are alias of @nest
- `#te111` Various relative IRIs as properties with with relative @vocab itself relative to an existing vocabulary base
- `#te112` Various relative IRIs as properties with with relative @vocab relative to another relative vocabulary base
- `#tli12` List with bad @base.
- `#twf05` Triples including invalid language tags are rejected

### `jsonld.js` is right

- `#tc013` type maps use scoped context from type index and not scoped context from containing
- `#tc031` @context resolutions respects relative URLs.
- `#tin06` json.api example
- `#tm019` string value of type map expands to node reference with @type: @vocab
- `#tn005` Nested nested containers
- `#tpr13` Override unprotected term.
- `#tso05` @propagate: true on type-scoped context with @import
- `#tso06` @propagate: false on property-scoped context with @import

### Neither matches the expected dataset

- `#tc038` Bibframe example (poor-mans inferrence)
