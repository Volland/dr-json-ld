<h1 align="center">
  <img src="https://raw.githubusercontent.com/Volland/dr-json-ld/main/packages/vscode/media/icon.png" width="96" height="96" alt="">
  <br>
  @json-ld-modeler/core
</h1>

<p align="center">
  <strong>A JSON-LD 1.1 processor that tells you what your documents are losing —<br>
  with a pointer from every result back to the line that produced it.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@json-ld-modeler/core"><img src="https://img.shields.io/npm/v/@json-ld-modeler/core?color=0B3D8F" alt="npm"></a>
  <a href="https://github.com/Volland/dr-json-ld/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-0B3D8F" alt="MIT"></a>
  <a href="https://volland.github.io/dr-json-ld/"><img src="https://img.shields.io/badge/handbook-read-0B3D8F" alt="Handbook"></a>
</p>

---

> **Looking for the tool rather than the library?**
> Install the CLI — [`@json-ld-modeler/ldm`](https://www.npmjs.com/package/@json-ld-modeler/ldm) —
> or the VS Code extension, [**JSON-LD Modeler**](https://marketplace.visualstudio.com/items?itemName=pavlyshyn.jsonld-modeler).
> This package is the engine both of them are built on.

## Why this exists

Expansion is *total*. It does not fail on a key it cannot resolve — it drops it.
A document can lose most of its content while every processor involved reports
success.

Every JSON-LD library will hand you the expanded document. None of them will
tell you what fell out on the way, or which line of your file it fell out of.
This one does, because that is the only reason it was written: **every value,
every node and every dropped key carries a JSON Pointer back to the input**, and
the pointer resolves to a line and column in the file a person edited.

## Install

```bash
npm install @json-ld-modeler/core
```

Node 20+, ESM, TypeScript types included, zero runtime dependencies beyond a
YAML parser. It never imports `vscode` — enforced by lint and by a test that
scans the source — so the conformance suite and every emitter run in plain Node.

## Expand a document and see what it lost

```ts
import { readFileSync } from 'node:fs'
import {
  activeContextForModel,
  bareExpanded,
  expandDocument,
  resolveModelText,
} from '@json-ld-modeler/core'

const path = 'vocabulary.jsonld.yaml'
const { ir } = resolveModelText(readFileSync(path, 'utf8'), path)

const active = activeContextForModel(ir!)
const document = JSON.parse(readFileSync('documents/order.json', 'utf8'))
const result = expandDocument(document, active)

for (const o of result.observations) {
  if (o.kind === 'key-dropped') {
    console.log(`"${o.key}" at ${o.pointer} expands to nothing`)
  }
}

// The plain JSON-LD a conformant processor returns, provenance stripped:
const expanded = bareExpanded(result)
```

`observations` is the interesting half. Beyond `key-dropped` it reports
`key-only-via-vocab` (the key matched no term and only became an IRI because
`@vocab` applied — not a drop, and worse, because nothing else reports it),
`relative-iri`, `blank-node-minted`, `coercion-did-not-fire` and `term-used`.

## Validate a model

```ts
import { validateModelText } from '@json-ld-modeler/core'

const report = validateModelText(readFileSync(path, 'utf8'), path)

for (const f of report.findings) {
  console.log(`${f.file}:${f.loc.line}:${f.loc.column}  ${f.severity}  ${f.ruleId}`)
  console.log(`  ${f.message}`)
}

process.exit(report.failed ? 1 : 0)
```

The ladder runs **L0** well-formedness, **L1** context errors located at the term
in your model rather than in a generated artifact, **L2** lossiness, and — for a
model with `shapes:` — **L3** conformance, decided by a SHACL engine running the
emitted shapes graph over each example and located at the key or value that broke
it. Each
`Finding` carries a stable `ruleId`, a `pointer`, a `file` and a `loc` — the
wording is not an interface, the rule id is.

## Trace an expansion

```ts
import { expandTraced, formatTrace } from '@json-ld-modeler/core'

const traced = expandTraced(document, active)
console.log(formatTrace(traced.trace).join('\n'))
```

Every term lookup, every IRI resolution, every change to the active context and
every key dropped, in order. A traced run and an untraced run produce identical
output — asserted, not assumed. It is the only honest way to explain a scoped
context, whose whole behaviour *is* a sequence of active-context changes.

## Emit a `@context`

```ts
import { emit, SourceIndex } from '@json-ld-modeler/core'

const source = SourceIndex.parse(readFileSync(path, 'utf8'), { path })
const { text, findings, downgrades } = emit(ir!, { target: 'context', source })
```

`context` references the contexts a model uses; `context-inline` flattens them
and *reports the fork* rather than performing it quietly. `shacl` writes the
shapes layer as a SHACL shapes graph in Turtle, with a comment wherever SHACL
cannot say what the model means. Generated artifacts
carry a header saying they are generated.

## What is in the box

| Area | Some of what it exports |
| --- | --- |
| **Processor** | `expand`, `compact`, `expandTraced`, `processContext`, `expandIri`, `activeContextForModel`, `toRdf` — every triple with its source pointers |
| **Provenance** | `SourceIndex`, `resolvePointer`, `pointersIn`, `strip`, `bareExpanded` |
| **Model** | `resolveModel`, `resolveModelText`, `serializeIr`, `backfillElementIds`, `type Ir` |
| **Validation** | `validateModel`, `validateModelText`, `RULES`, `type Finding`, `type Level` |
| **Emitters** | `emit`, `emitShacl`, `buildContextDocument`, `capabilitiesFor` |
| **Shapes** | `resolveShapeFields`, `prepareShapes`, `checkConformance`, `addShapeSplice`, `addFieldSplice`, `type IrShape` |
| **Import** | `importContext` — an existing `@context` becomes a model |
| **Vendoring** | `VendorStore`, `vendorCheck`, `vendorRefresh`, `integrityOf`, `resolverFor` |
| **Projects** | `loadProject`, `checkProject`, `projectScaffold`, `modelScaffold` |
| **Versions** | `VersionStore`, `createVersionFromModel`, `sealManifest`, `AliasStore` |
| **Diff** | `compareVersions`, `CHANGE_CLASSES` — additive, compatible, breaking, semantic, illegal |
| **Publishing** | `publish`, `verifyTree`, `adapterFor` — plain, GitHub Pages, S3 |
| **Search** | `buildIndex`, `search` — offline, across every model in a project |
| **Skills** | `loadSkills`, `render`, `FORMATS` — authoring guidance, in three agent formats |

Everything is a named export from the package root, and every public type ships
with it.

The JSON Schema for model files is exported as `@json-ld-modeler/core/schema`
and published at
[its own `$id`](https://volland.github.io/dr-json-ld/schemas/model/1/model.schema.json),
with [every field documented](https://volland.github.io/dr-json-ld/schemas/model/1/).

`loadSkills()` returns the authoring guidance the CLI installs. It is prose: it
produces no finding, no edit and no exit code, and nothing in validation,
emission or the processor reads it.

## Offline by design

There is **no network code in this package outside a single explicit resolver**
(`fetchContext`, used only by `vendorRefresh`). Everything else takes a
`resolveContext` callback that reads from the vendored, hash-checked copy on
disk.

That is a security boundary, not a preference: a model file names the URLs to
fetch, so a routine that fetches what a model tells it to — running in CI against
an outside pull request — is a request-forgery primitive.

## Conformance

Observed, not claimed. The W3C JSON-LD 1.1 test suite is vendored and run with
the network off, and every in-scope case is additionally run through `jsonld.js`
with the two outputs compared — every disagreement becomes a question with a
recorded answer. Cases that do not pass are listed with a reason; `frame`,
`toRdf`, `fromRdf`, `flatten` and `html` are out of scope for this release.

Framing, URDNA2015 canonicalization and N-Quads serialization are delegated to
existing libraries. The line is drawn at provenance: expansion and compaction sit
between what you wrote and what is reported, so they must carry pointers.
Canonicalization is a pure function over an already-expanded graph and gains
nothing from being reimplemented.

## Learn JSON-LD while you are here

- 📖 **[The JSON-LD handbook](https://volland.github.io/dr-json-ld/book/)** — nine chapters, from `@context` to canonicalization
- ✍️ **[Notes from the shop](https://volland.github.io/dr-json-ld/blog/)** — longer essays:
  - [What linked data is for, and what it costs](https://volland.github.io/dr-json-ld/blog/linked-data.html)
  - [The context you sign](https://volland.github.io/dr-json-ld/blog/verifiable-credentials.html) — why verifiable credentials are hard
  - [Two pictures of the same graph](https://volland.github.io/dr-json-ld/blog/graphs.html)
  - [The format an agent and a human can share](https://volland.github.io/dr-json-ld/blog/agents.html) — expansion, agents and merge-by-IRI

## Links

- 🌐 [Website](https://volland.github.io/dr-json-ld/)
- ⌨️ [`@json-ld-modeler/ldm`](https://www.npmjs.com/package/@json-ld-modeler/ldm) — the CLI, and what a pull request runs
- 🧩 [VS Code extension](https://marketplace.visualstudio.com/items?itemName=pavlyshyn.jsonld-modeler) — two coordinated panes, findings in the Problems panel
- 🛠 [Source](https://github.com/Volland/dr-json-ld) · [Issues](https://github.com/Volland/dr-json-ld/issues)

MIT licensed.
