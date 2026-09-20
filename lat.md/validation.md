# Validation

Validating a document "against a context" is not one operation, because a context by itself validates almost nothing. It is a ladder of five levels, each answering a different question and each able to run without the ones above it.

Saying this plainly matters more than it would elsewhere. Users arrive expecting a context to behave like a schema, and it does not: [[processing#Expansion|expansion is total]] and succeeds on a document it has emptied. A tool that answered "valid" to that question would be technically correct and actively harmful. The ladder is how the tool gives a useful answer without pretending JSON-LD offers one.

## The Ladder

The levels run L0 to L4, from the question every JSON parser answers to the question only an opinionated tool can. A command names the highest level it runs, and findings always record which level produced them.

Levels are separable because their dependencies differ: L0 and L1 need only the document and the context, L2 needs [[processing#Source Mapping]], L3 needs the [[metamodel#Shapes|shapes layer]] and a SHACL engine, and L4 needs the [[validation#Rule Catalog]]. Milestone 1 ships L0 to L2, which is exactly the set that needs no shapes.

### L0 Well-formedness

Whether the document is JSON at all, and whether the model file is a valid model.

It is listed rather than assumed because its findings must carry positions in the same shape as every other level's, so a caller never has two kinds of error to handle.

### L1 Context Errors

Whether the context itself is legal: invalid term definitions, cyclic IRI mappings, an `@container` value that is not allowed, a redefinition that violates an upstream `@protected`, a facet that the model's declared [[metamodel#Processing Mode|processing mode]] does not permit.

These are the errors the specification actually defines, and a conformant processor raises them. The tool's contribution is not detecting them but locating them — in the model file, at the term responsible, rather than in a generated artifact the user did not write.

### L2 Lossiness

What the document lost. Keys that expanded to nothing and vanished, IRIs left relative, blank nodes where an identifier was expected, values whose coercion did not fire, and terms the context defines that nothing in the document uses.

This is the level that justifies the project. It is the most common real-world JSON-LD failure and it is silent at every other level: the processor succeeds, the output is well-formed, and most of the payload is gone. Reporting it requires knowing which input produced which output, which is why [[processing#Source Mapping]] is built rather than bought. A dropped key reported as "line 14 does not survive expansion" is actionable; the same fact reported as a missing triple is not.

The coverage direction — terms defined but unused — is the weaker half and is reported at a lower severity, since a context may legitimately define more than any single document uses.

### L3 Shape Conformance

Whether the document satisfies the structure the model declares: required properties, cardinality, value ranges, and closed classes.

A real SHACL engine is the authority, running over the expanded RDF, using the same shapes graph the tool emits. Writing a structural validator against the compacted JSON instead was rejected: it would create two definitions of conformance — the one checked here and the one shipped to consumers — which drift, and it could not see anything that exists only after expansion. The cost is that violations arrive in RDF terms and must be mapped back through the source map before they are shown.

Deferred to milestone 2 with the shapes layer.

### L4 Guidance

Whether the model and the document represent things well: advice rather than error, drawn from the [[validation#Rule Catalog]].

It is a level rather than a separate feature so that a finding from a lint carries the same shape, the same pointer and the same reporting path as a finding from the specification. What differs is severity and the fact that it is opinionated, which the finding says.

## Findings

A finding carries a rule id, the level that produced it, a severity, a message, a JSON Pointer into the document or the model, and a resolved line and column. Findings are stable under reordering of the input.

The rule id is what makes a finding referenceable: an [[metamodel#Examples|example]] can require it, a configuration can downgrade it, documentation can explain it, a [[architecture#Architecture#Editing Surface#Quick fixes|quick fix]] can be registered against it, and a change to its wording does not break any of those. Stability under reordering is what makes findings usable in continuous integration, since a diff of findings between two runs should reflect a change in the document rather than a change in iteration order.

### A finding may carry a repair

For a few rules there is exactly one legal repair, and the rule id is the key it is registered under. Most rules have none, and offer none.

The repair is not part of the finding: a finding is a report, and a report that carried an edit would have to be recomputed whenever the file changed under it. It is looked up from the rule id when the user asks, which is also why a finding stays comparable between runs. What the registry is and why it declines are at [[architecture#Architecture#Editing Surface#Quick fixes]].

## Expected Outcomes

Each declared example records the outcome validating it must produce. A positive example must produce no finding above a stated severity; a negative example must produce specific rule ids.

Requiring the ids rather than merely requiring failure is what makes negative examples worth having. A negative example that merely fails passes even when it fails for the wrong reason, which is how a validator quietly stops detecting the thing the example was written to pin down. It also makes the examples double as the validator's regression suite and as teaching material: a document that demonstrates a mistake, alongside the exact finding it should provoke.

## Rule Catalog

Every lint is an entry in a versioned catalog with a stable id, a severity, a one-line finding, a statement of why it matters, a bad and good pair, and a link into the explanation corpus.

The catalog is deterministic and hand-written, which is what allows it to be tested, gated in continuous integration, cited, and run offline. An optional LLM layer may explain a rule differently or comment on a model, and it is clearly labelled as such, but nothing it produces becomes a finding, an edit or a continuous-integration result. The boundary is not a hedge about quality: a tool whose value rests on being exact about a specification cannot have a component that improvises about that specification inside its diagnostics.

Rules the catalog is expected to open with are recorded here so the deferral does not lose them: `@vocab` in a published context converting dropped keys into invented IRIs, a relation left uncoerced by a missing `@type: @id`, a term that would benefit from `@container: @set` before it becomes multi-valued, a published term left unprotected, and a term that shadows one from a referenced context.

Deferred to milestone 3.
