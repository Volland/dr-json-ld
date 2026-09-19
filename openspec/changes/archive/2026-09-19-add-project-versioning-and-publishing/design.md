## Context

See proposal.md — Why. Requirements are in `specs/*/spec.md`; this document covers how.

**The metamodel does not change shape.** A term, its facets and its element id are
untouched, and `lat.md/metamodel#Metamodel#Terms` stands as written. What changes is
what sits *above* a model: a project that contains several, and a version that freezes
one. This is deliberate — the least reversible decision in the project was the
metamodel, and this change does not reopen it.

One metamodel addition is unavoidable and it is small: a model may name the project it
belongs to, and a project file is a new file kind with its own schema. Both are
additive and a model that names neither behaves exactly as it does today.

Constraints the design leans on:

- `lat.md/metamodel#Metamodel#Namespaces`: identity is the IRI, never the file path.
- `lat.md/metamodel#Metamodel#Stable Element IDs`: the id is identity; key and IRI are mutable attributes of it.
- `lat.md/emitters#Emitters#Change Management#Lockfile`: canonical IR, arrays sorted by element id, keys sorted.
- `lat.md/emitters#Emitters#Change Management#Change Classification`: the five classes and why three do not suffice.
- `lat.md/emitters#Emitters#Verification`: no artifact ships that is only snapshotted.
- `lat.md/processing#Processing#Context Resolution#Offline by default`: only an explicit refresh touches the network.
- `lat.md/architecture#Architecture#Source of Truth`: the `@context` is generated and says so.
- `lat.md/architecture#Architecture#Package Boundary`: `core` never imports `vscode`.

## Goals / Non-Goals

**Goals:**

- A published version is verifiable by a stranger holding only the tree.
- A stable URL can be corrected without rewriting history or breaking a consumer.
- The published tree works on the dumbest host available, so hosting is never the reason a vocabulary goes unpublished.
- Comparison names *what kind* of change happened, not merely that something did.

**Non-Goals:**

- Garbage-collecting or pruning old versions. Immutability is the point; disk is cheap.
- Signing or provenance beyond a checksum. A hash detects accident and casual tampering; it is not a signature and the design will not imply it is.
- Making the published tree browsable by humans. It is for machines; a docs site is a deferred target.

## Decisions

### D1. A version's identity is the hash of its inputs; the manifest hashes every file and itself

Two hashes, doing two jobs.

The **identity** is a hash over the version's *inputs* — the model as written, the
lockfile, and the example documents. These are the things a human authored.

The **manifest** lists every file in the version with its hash, including the generated
artifacts, plus a hash over the manifest's own canonical bytes.

- *Why the identity covers inputs rather than the whole manifest:* the artifacts name
  the version they belong to, so an identity derived from a manifest that hashes those
  artifacts is circular and does not converge — writing the id changes the bytes that
  determine the id. Implementation surfaced this; the first draft of this decision was
  wrong and this replaces it.
- *Why content-addressing still holds:* the artifacts are a pure function of the inputs
  and the emitter version. Identical inputs give an identical identity, and different
  inputs cannot collide, which is the property that matters.
- *Why the manifest still hashes the artifacts:* verification must cover every byte a
  consumer will fetch, not only the ones an author typed.
- *Why manifest-of-hashes rather than a hash of a concatenation:* a reader can verify one
  file without fetching the whole version, which is what makes a static host usable.
- *Why the manifest hashes itself:* without it, editing a file and updating its entry
  would verify cleanly. The self-hash is what makes the manifest evidence rather than a
  table of contents.
- *Rejected:* a monotonically increasing version number as identity. It makes two
  independent branches produce the same identity for different content, which is the
  one thing an immutable store must never allow.
- *Rejected:* leaving the version unnamed in the artifact so the identity could stay the
  manifest hash. It would mean a consumer holding a `@context` could not say which
  release it is reading, which is the thing the header exists for.

### D2. Aliases are a separate mutable file; versions never learn their own names

An alias file maps names to version identities. A version contains no reference to any
alias.

If a version recorded the aliases pointing at it, retargeting an alias would mutate the
version — immutability and human names are in direct tension, and this is where the
tension is resolved. It also means the answer to "what does `stable` mean" lives in
exactly one place, and that place is diffable.

The published tree therefore contains one copy of each artifact under its version path,
and each alias path resolves to the same bytes. Whether that is a copy, a symlink or a
redirect file is the host adapter's business (D4), because the hosts genuinely differ.

### D3. The lockfile is a file inside the version, not beside the model

`lat.md/emitters#Emitters#Change Management#Lockfile` describes a lockfile committed
alongside the model. This change puts it inside the version instead.

The reason is comparison: comparing two versions must work when neither model file is
present — from a published tree alone, or between two tags. A lockfile beside the model
only ever describes the working tree, so it can compare the present against one past,
never two pasts. Nothing about the lockfile's *content* changes: canonical IR, arrays
by element id, keys sorted, exactly as designed.

**Effect on the IR:** none. The serializer already produces this form and already
excludes the source path, which matters more now — a version must not record where the
model happened to sit. **Effect on diffing:** this is what makes diffing possible at
all; there is no prior behaviour to preserve.

### D4. A host adapter declares constraints, not a deployment procedure

An adapter states what a host requires — path characters it cannot serve, a side file
it needs, whether it can serve a path without an extension — and publishing validates
the tree against every adapter the project names.

The tool does not upload. Uploading means credentials, retries and a permissions model,
and every host already has a mature tool for it. What the tool owes is a tree those
tools can copy verbatim, and a refusal when a name would produce a path the target host
silently mangles. The alias-path mechanism differs per host precisely because this is
where hosts diverge, so it belongs behind the adapter.

*Rejected:* one lowest-common-denominator layout. It would have meant no alias paths at
all, which removes the feature the request is actually about.

### D5. Rename retargets an alias and is refused on a version identity

`ldm alias` creates, retargets and deletes. There is no command that renames a version,
because there is no operation that could: the name *is* the content hash.

This is the design's answer to the request's apparent contradiction between "versions
are immutable" and "rename a version". A user who means "this release should be called
v2" is renaming a label. A user who means "the published bytes were wrong" wants a new
version and a retargeted label, which is two commands and is the honest shape of the
operation.

### D6. Comparison reuses the classifier's rules verbatim from the locked decision

The five classes, and the rule that ambiguity classifies as `breaking`, come from
locked decision 12 and `lat.md/emitters#Emitters#Change Management#Change Classification`.
This change implements them; it does not re-derive them.

**Effect on IRI stability and rename detection:** none, and that is load-bearing.
Matching is by element id, so a key change is `breaking` and an IRI change is
`semantic`, across a version boundary exactly as within one. A version created from a
model with derived ids is refused (see the spec), because that is the one situation in
which the distinction collapses.

### D7. Search is an index built from what is on disk, and is never a cache

The index is derived from the published versions and the vendored contexts each time it
is out of date, and a version failing verification contributes nothing.

Treating it as a cache would let a stale entry answer for content that has changed,
which in a tool whose credibility rests on exactness is worse than being slow. A
version that does not verify is excluded rather than reported as a result, because
returning a term from a file that fails its own checksum would be asserting something
the tool cannot stand behind.

### D8. The processor is untouched

No change to expansion, compaction, the source map or the trace. No W3C suite class is
affected. Emitted artifacts gain a header line naming their version, which is text in a
comment block and changes no algorithm.

The `context` and `context-inline` capability sets are unchanged. Publishing adds no
target, so it adds no capability entry and implies no new downgrade.

### D9. Packages

Everything lands in `core` except the CLI verbs and a project-level model picker in the
extension. **No `vscode` import is introduced into `core`**; the project loader, version
store, lockfile, classifier, search index and tree writer are all plain Node, which
keeps them runnable in the conformance harness and in continuous integration.

## Risks / Trade-offs

- [A content-addressed identity is unreadable, and people will want to type `v2` everywhere] → Aliases exist for exactly this, and every command that takes a version takes an alias. The identity is what the manifest and the tree use; the alias is what a human uses.
- [Immutable versions accumulate and the repository grows] → Accepted rather than mitigated. A published interface that can be quietly deleted is not a published interface. Pruning is a non-goal and is left to whoever owns the host.
- [A checksum is not a signature, and someone will treat it as one] → The design says so here, the manifest format names it `integrity` rather than `signature`, and the documentation must repeat it. Signing is a separate change with a key-management story.
- [Pulling the classifier forward means shipping it without the shapes layer it was designed alongside] → The classifier operates on the terms layer only, which is complete. When the shapes layer lands it adds classes of difference, not a redesign — the five classes were chosen for JSON-LD's failure modes, not for shapes.
- [Two hosts with contradictory path constraints make a tree that satisfies neither] → Publishing validates against every named adapter and fails naming the conflict, rather than writing a tree that works nowhere. A project naming contradictory hosts must publish twice.
- [The published tree duplicates every artifact once per alias] → Accepted for the default adapter. Artifacts are small, and the alternative — a redirect the host may not honour — fails silently, which is worse than being large.

## Migration Plan

Additive throughout. A model with no project and no version resolves, emits, validates
and is edited exactly as it is today, and the existing fixture models are left that way
deliberately so the no-project path stays covered.

Adopting the feature is three steps: write a project file naming the models, run
`ldm ids` if any model still carries derived ids, then `ldm publish`. Nothing rewrites
an existing model. Rollback is deleting the project file and the published tree; no
model file is touched by adoption.

## Open Questions

- Whether a project should be able to declare a default host adapter set that individual models can override. Deferrable: it changes a configuration default, not the tree format, the specs or the task breakdown.
- Whether the search index should be committed or regenerated. Deferrable for the same reason — it is a performance and repository-hygiene question, and both answers produce identical results.
