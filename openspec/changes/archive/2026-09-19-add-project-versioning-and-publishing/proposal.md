## Why

A model is currently a loose file. Nothing says which models belong together, nothing records what was published, and nothing tells a consumer which revision they are reading. Publishing a context is publishing an interface, and the tool cannot yet help anyone keep one.

## What Changes

- **Projects.** A project file declares the models it contains and where published output goes. A model gains a home; a repository gains one place to look.
- **Versions.** Publishing a model freezes it as an immutable, content-addressed version carrying a manifest with a checksum over every file in it. A version is never edited, only superseded.
- **Aliases.** Human names — `v2`, `stable`, `latest` — are movable labels over immutable versions. `rename` retargets a label; it never mutates a version. This is how a stable published URL survives a correction.
- **Host-friendly output.** Published versions land in a static tree that serves correctly from GitHub Pages, an S3 bucket, or any plain file host: no server-side content negotiation, no rewrite rules required, and a per-host adapter that emits whatever side files that host needs.
- **Commands.** `ldm publish`, `ldm clone`, `ldm alias`, `ldm version new`, `ldm diff`, `ldm search`.
- **The lockfile and the change classifier**, pulled forward — see below.
- **Search.** An offline index over every version published in the project and over the vendored contexts, so an author can find an existing term before minting one.

## Non-goals

- Fetching from, or publishing to, a remote registry. Search stays offline.
- Server-side content negotiation. The tree must work on a dumb file host; anything richer is the host's business.
- The shapes layer, SHACL, frame, JSON Schema, the vocabulary document, types and the docs site. Versioning applies to the targets that exist.
- Deciding the *IRI* versioning policy for a vocabulary. This change versions published artifacts, not the meaning of terms.

## Locked decisions

Touches **9**, **10**, **11** and **12**, and reworks none of them.

- **12** is implemented rather than amended: the lockfile and the five change classes are exactly what a version comparison needs, so this change builds them.
- **11** is the reason comparison works at all — versions are matched by element id, so a rename is a rename across a version boundary too.
- **10** holds: `ldm vendor` remains the only command that touches the network. Publishing writes locally; search reads locally.
- **9** extends to the new artifacts: a published version is verified by re-emitting and comparing, never snapshotted alone.

**Pulled forward from M1 OUT / M3:** the lockfile and the change classifier. They are pulled forward because an immutable version whose difference from its predecessor cannot be named is a filing system, not a release process — the comparison tool the request asks for *is* the classifier.

**Settles the open question** "the publishing strategy for an emitted context: stable dereferenceable URLs, versioned paths, content negotiation" — answered as versioned static paths plus movable aliases, with no content negotiation required.

## Capabilities

### New Capabilities

- `project-structure`: what a project declares, which models it contains, and how one resolves.
- `schema-versioning`: immutable content-addressed versions, the checksummed manifest, and movable aliases.
- `version-publishing`: the published tree, its host adapters, and `publish`, `clone` and `version new`.
- `version-comparison`: the lockfile, the five change classes, and `ldm diff --fail-on`.
- `published-search`: the offline index over published versions and vendored contexts.

### Modified Capabilities

- `context-generation`: emitted artifacts gain a version identity and are written into the published tree, and the generated header names the version.
- `model-format`: a model may declare the project it belongs to and the version policy it follows.
- `context-resolution`: a model may reference a version published by this same project, resolved from the published tree rather than the vendor directory.

## Impact

- `core`: a project loader, the version store and its manifest, the lockfile serializer and classifier, the search index, and the publish tree writer. No `vscode` import.
- `cli`: six new verbs, and `emit` gains a version-aware output path.
- `vscode`: the canvas gains a project-level model picker; the metamodel itself does not change shape.
- Targets affected: `context` and `context-inline`. No other target exists yet.
- `lat.md/`: `architecture`, `metamodel` and `emitters` all gain sections; the open question above is struck.
