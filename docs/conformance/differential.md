# Differential against `jsonld.js` — expand

Suite base: `https://w3c.github.io/json-ld-api/tests/`. Network off; both implementations read the vendored tree.

Compared: 273. Agreed: 261. Diverged: 12. Not compared: 112.

A divergence is a question with a right answer. Each one is resolved and the
finding — including which implementation was right — is recorded in the
project config's measured-behaviour section.

## Divergences

- `#t0038` Expanding blank node labels — output differs from jsonld.js
- `#t0131` Reverse term with property based indexed container — output differs from jsonld.js
- `#tc013` type maps use scoped context from type index and not scoped context from containing — output differs from jsonld.js
- `#tc031` @context resolutions respects relative URLs. — this processor threw where jsonld.js succeeded: loading remote context failed: http://example.org/a/c031/c031-context.jsonld has not been vendored. Run `ldm vendor` — no command other than the vendor refresh touches the network.
- `#tc037` property-scoped contexts which are alias of @nest — output differs from jsonld.js
- `#tc038` Bibframe example (poor-mans inferrence) — output differs from jsonld.js
- `#tin06` json.api example — output differs from jsonld.js
- `#tm019` string value of type map expands to node reference with @type: @vocab — output differs from jsonld.js
- `#tn005` Nested nested containers — output differs from jsonld.js
- `#tpr13` Override unprotected term. — this processor threw where jsonld.js succeeded: protected term redefinition: "unprotected" is protected by an earlier context and may not be redefined
- `#tso05` @propagate: true on type-scoped context with @import — this processor threw where jsonld.js succeeded: invalid scoped context: invalid remote context: https://w3c.github.io/json-ld-api/tests/expand/so05-context.jsonld has not been vendored. Run `ldm vendor` — no command other than the vendor refresh touches the network.
- `#tso06` @propagate: false on property-scoped context with @import — this processor threw where jsonld.js succeeded: invalid scoped context: invalid remote context: https://w3c.github.io/json-ld-api/tests/expand/so06-context.jsonld has not been vendored. Run `ldm vendor` — no command other than the vendor refresh touches the network.
