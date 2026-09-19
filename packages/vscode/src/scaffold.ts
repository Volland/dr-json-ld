/**
 * The scaffold a new model starts from, shared with `ldm init`.
 *
 * Ids are written, not derived, so the first rename is a rename.
 *
 * @lat: [[metamodel#Metamodel#Stable Element IDs]]
 */
export const SCAFFOLD = "# A JSON-LD Modeler model. This file is *about* JSON-LD; it is not itself JSON-LD.\n# The @context is generated from it — see `ldm emit`.\n\njsonld: \"1\"\n\n# The prefix and base IRI that give this model's own terms their global identity.\n# Identity is the IRI, never the file path.\nnamespace:\n  prefix: ex\n  base: https://example.org/ns#\n\n# Which JSON-LD processing mode this model targets. A 1.0 processor does not\n# reject a 1.1 context; it reads it differently. Declaring the target is what\n# lets a 1.1-only facet become a downgrade at its own site.\nmode: \"1.1\"\n\n# Contexts this model builds on but does not own. Run `ldm vendor` to fetch each\n# one into the committed vendor directory and record its hash here.\nuses: []\n\n# Terms are a flat map from JSON key to definition. One entry for `name` governs\n# every occurrence of `name` anywhere in the document.\nterms:\n  name:\n    id: a1b2c3\n    \"@id\": ex:name\n    note: The display name of the thing.\n\nexamples: []\n"
