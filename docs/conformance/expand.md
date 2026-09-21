# W3C JSON-LD 1.1 conformance — expand

Cases: 385. Passed: 341. Failed: 35. Skipped: 9.

## Out of scope for this change

- `frame` — not implemented by this milestone; reported rather than skipped silently.
- `fromRdf` — not implemented by this milestone; reported rather than skipped silently.
- `flatten` — not implemented by this milestone; reported rather than skipped silently.
- `html` — not implemented by this milestone; reported rather than skipped silently.

## Failing cases

- `#t0077` expandContext option — output differs from the expected document
- `#t0115` Verifies that relative IRIs as properties with @vocab: '' in 1.0 generate an error — expected the error "invalid vocab mapping" and none was raised
- `#t0116` Verifies that relative IRIs as properties with relative @vocab in 1.0 generate an error — expected the error "invalid vocab mapping" and none was raised
- `#t0123` Value objects including invalid literal datatype IRIs are rejected — expected the error "invalid typed value" and none was raised
- `#t0131` Reverse term with property based indexed container — output differs from the expected document
- `#tc013` type maps use scoped context from type index and not scoped context from containing — output differs from the expected document
- `#tc031` @context resolutions respects relative URLs. — threw: loading remote context failed: http://example.org/a/c031/c031-context.jsonld has not been vendored. Run `ldm vendor` — no command other than the vendor refresh touches the network.
- `#tc038` Bibframe example (poor-mans inferrence) — output differs from the expected document
- `#tec02` Term definition on @type with empty map — expected the error "keyword redefinition" and none was raised
- `#ten04` @nest MUST NOT have a value object value — expected the error "invalid @nest value" and none was raised
- `#ter05` Invalid remote context — raised "keyword redefinition" where the manifest expects "invalid remote context"
- `#ter13` Invalid type mapping (not absolute IRI) — expected the error "invalid type mapping" and none was raised
- `#ter24` List of lists (from array) — expected the error "list of lists" and none was raised
- `#ter25` Invalid reverse property map — expected the error "invalid reverse property map" and none was raised
- `#ter26` Colliding keywords — expected the error "colliding keywords" and none was raised
- `#ter32` List of lists (from array) — expected the error "list of lists" and none was raised
- `#ter40` Invalid typed value — expected the error "invalid typed value" and none was raised
- `#ter43` Term definition with @id: @type — expected the error "invalid IRI mapping" and none was raised
- `#ter44` Redefine terms looking like compact IRIs — expected the error "invalid IRI mapping" and none was raised
- `#ter48` Invalid term as relative IRI — expected the error "invalid IRI mapping" and none was raised
- `#tin06` json.api example — output differs from the expected document
- `#tin07` Error if @included value is a string — expected the error "invalid @included value" and none was raised
- `#tin08` Error if @included value is a value object — expected the error "invalid @included value" and none was raised
- `#tin09` Error if @included value is a list object — expected the error "invalid @included value" and none was raised
- `#tm019` string value of type map expands to node reference with @type: @vocab — output differs from the expected document
- `#tm020` string value of type map must not be a literal — expected the error "invalid type mapping" and none was raised
- `#tn005` Nested nested containers — output differs from the expected document
- `#tpi05` error if attempting to add property to value object for property-valued index — expected the error "invalid value object" and none was raised
- `#tpr13` Override unprotected term. — threw: protected term redefinition: "unprotected" is protected by an earlier context and may not be redefined
- `#tpr17` Fail to override protected terms with type. — expected the error "invalid context nullification" and none was raised
- `#tpr18` Fail to override protected terms with type+null+ctx. — expected the error "invalid context nullification" and none was raised
- `#tpr20` Fail with mix of protected and unprotected terms with type+null+ctx. — expected the error "invalid context nullification" and none was raised
- `#tpr21` Fail with mix of protected and unprotected terms with type+null. — expected the error "invalid context nullification" and none was raised
- `#tso05` @propagate: true on type-scoped context with @import — threw: invalid scoped context: invalid remote context: https://w3c.github.io/json-ld-api/tests/expand/so05-context.jsonld has not been vendored. Run `ldm vendor` — no command other than the vendor refresh touches the network.
- `#tso06` @propagate: false on property-scoped context with @import — threw: invalid scoped context: invalid remote context: https://w3c.github.io/json-ld-api/tests/expand/so06-context.jsonld has not been vendored. Run `ldm vendor` — no command other than the vendor refresh touches the network.

## Skipped cases

- `#t0075` @vocab as blank node identifier — targets the JSON-LD 1.0 processing mode
- `#tc029` @propagate is invalid in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tep02` processingMode json-ld-1.0 conflicts with @version: 1.1 — targets the JSON-LD 1.0 processing mode
- `#ter21` Invalid container mapping — targets the JSON-LD 1.0 processing mode
- `#ter42` Keywords may not be redefined in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tes01` Using an array value for @context is illegal in JSON-LD 1.0 — targets the JSON-LD 1.0 processing mode
- `#tpi01` error if @version is json-ld-1.0 for property-valued index — targets the JSON-LD 1.0 processing mode
- `#tso01` @import is invalid in 1.0. — targets the JSON-LD 1.0 processing mode
- `#ttn01` @type: @none is illegal in 1.0. — targets the JSON-LD 1.0 processing mode
