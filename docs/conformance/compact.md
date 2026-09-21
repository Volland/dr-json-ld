# W3C JSON-LD 1.1 conformance — compact

Cases: 246. Passed: 166. Failed: 69. Skipped: 11.

## Out of scope for this change

- `frame` — not implemented by this milestone; reported rather than skipped silently.
- `fromRdf` — not implemented by this milestone; reported rather than skipped silently.
- `flatten` — not implemented by this milestone; reported rather than skipped silently.
- `html` — not implemented by this milestone; reported rather than skipped silently.

## Failing cases

- `#t0032` Compact keys in reverse-maps — output differs from the expected document
- `#t0036` Compact reverse properties using index containers — output differs from the expected document
- `#t0037` Compact keys in @reverse using @vocab — output differs from the expected document
- `#ta038` Index map round-tripping — output differs from the expected document
- `#t0044` @type: @vocab in reverse-map — output differs from the expected document
- `#t0065` Language-tagged and indexed strings with language-map — output differs from the expected document
- `#t0073` Mapped @id and @type — output differs from the expected document
- `#t0079` Compact a @graph container having @index — output differs from the expected document
- `#t0080` Do not compact a graph having @id with a term having an @graph container — output differs from the expected document
- `#t0083` [@graph, @index] does not compact graph with @id — output differs from the expected document
- `#t0090` Compact input with @graph container to output without @graph container — output differs from the expected document
- `#t0092` Compact input with [@graph, @set] container to output without [@graph, @set] container — output differs from the expected document
- `#t0094` Compact input with [@graph, @set] container to output without [@graph, @set] container — output differs from the expected document
- `#t0108` context with JavaScript Object property names — output differs from the expected document
- `#t0109` Compact @graph container (multiple objects) — output differs from the expected document
- `#t0110` Compact [@graph, @set] container (multiple objects) — output differs from the expected document
- `#t0111` Keyword-like relative IRIs — output differs from the expected document
- `#t0112` Compact property index using Compact IRI index — output differs from the expected document
- `#t0113` Compact property index using Absolute IRI index — output differs from the expected document
- `#t0114` Reverse term with property based indexed container — output differs from the expected document
- `#tc009` deep @type-scoped @context does NOT affect nested nodes — output differs from the expected document
- `#tc014` type-scoped context nullification — output differs from the expected document
- `#tc015` type-scoped base — output differs from the expected document
- `#tc016` type-scoped vocab — output differs from the expected document
- `#tc017` multiple type-scoped contexts are properly reverted — output differs from the expected document
- `#tc018` multiple type-scoped types resolved against previous context — output differs from the expected document
- `#tc021` type-scoped value mix — output differs from the expected document
- `#tc025` type-scoped + graph container — output differs from the expected document
- `#tc027` @propagate: false on property-scoped context — output differs from the expected document
- `#tdi03` term selection with lists and direction — output differs from the expected document
- `#tdi04` simple language map with term direction — output differs from the expected document
- `#tdi05` simple language map with overriding term direction — output differs from the expected document
- `#tdi07` simple language map with mismatching term direction — output differs from the expected document
- `#te001` Compaction to list of lists — expected the error "compaction to list of lists" and none was raised
- `#te002` Absolute IRI confused with Compact IRI — expected the error "IRI confused with prefix" and none was raised
- `#ten01` Nest term not defined — expected the error "invalid @nest value" and none was raised
- `#tin02` Basic Included object — output differs from the expected document
- `#tin04` Included containing @included — output differs from the expected document
- `#tin05` Property value with @included — output differs from the expected document
- `#tla01` most specific term matching in @list. — output differs from the expected document
- `#tm007` When type is in a type map — output differs from the expected document
- `#tm010` @index map with @none value using alias of @none — output differs from the expected document
- `#tm012` language map with no @language using alias of @none — output differs from the expected document
- `#tm014` id map using @none with alias — output differs from the expected document
- `#tm016` type map using @none with alias — output differs from the expected document
- `#tm020` node reference compacts to string value of type map — output differs from the expected document
- `#tn001` Indexes to @nest for property with @nest — output differs from the expected document
- `#tn002` Indexes to @nest for all properties with @nest — output differs from the expected document
- `#tn003` Nests using alias of @nest — output differs from the expected document
- `#tn004` Arrays of nested values — output differs from the expected document
- `#tn005` Nested @container: @list — output differs from the expected document
- `#tn006` Nested @container: @index — output differs from the expected document
- `#tn007` Nested @container: @language — output differs from the expected document
- `#tn008` Nested @container: @type — output differs from the expected document
- `#tn009` Nested @container: @id — output differs from the expected document
- `#tn010` Multiple nest aliases — output differs from the expected document
- `#tn011` Nests using alias of @nest (defined with @id) — output differs from the expected document
- `#tp002` Compact IRI does not use expanded term definition in 1.1 — output differs from the expected document
- `#tp008` Compact IRI does not use term with definition including @prefix: false — output differs from the expected document
- `#tpi01` property-valued index indexes property value, instead of property (value) — output differs from the expected document
- `#tpi02` property-valued index indexes property value, instead of property (multiple values) — output differs from the expected document
- `#tpi03` property-valued index indexes property value, instead of property (node) — output differs from the expected document
- `#tpi04` property-valued index indexes property value, instead of property (multiple nodes) — output differs from the expected document
- `#tpr03` Check illegal overriding of protected term from type-scoped context — expected the error "protected term redefinition" and none was raised
- `#ts001` @context with single array values — output differs from the expected document
- `#ts002` @context with array including @set uses array values — output differs from the expected document
- `#ttn01` @type: @none does not compact values — output differs from the expected document
- `#ttn02` @type: @none does not use arrays by default — output differs from the expected document
- `#ttn03` @type: @none uses arrays with @container: @set — output differs from the expected document

## Skipped cases

- `#t0075` Compact using relative fragment identifier — targets the JSON-LD 1.0 processing mode
- `#t0106` Do not compact @type with @container: @set to an array using an alias of @type — targets the JSON-LD 1.0 processing mode
- `#tep05` processingMode json-ld-1.0 conflicts with @version: 1.1 — targets the JSON-LD 1.0 processing mode
- `#tep07` @prefix is not allowed in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tep10` @nest is not allowed in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tep11` @context is not allowed in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tep12` @container may not be an array in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tep13` @container may not be @id in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tep14` @container may not be @type in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tep15` @container may not be @graph in 1.0 — targets the JSON-LD 1.0 processing mode
- `#tp001` Compact IRI will not use an expanded term definition in 1.0 — targets the JSON-LD 1.0 processing mode
