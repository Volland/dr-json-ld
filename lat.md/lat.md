This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

- [[architecture]] — source of truth, package boundary, the host adapter, the two panes, views, and the milestone cut lines.
- [[metamodel]] — what a model may say: terms and their facets, processing mode, identity, shapes, examples, namespaces.
- [[processing]] — expansion and compaction implemented here, source mapping, the trace, conformance, and how external contexts are resolved.
- [[validation]] — the five-level ladder, what a finding carries, expected outcomes on examples, and the rule catalog.
- [[emitters]] — capability matrix, the context target and its inlined variant, the deferred downstream targets, and how output is verified.
