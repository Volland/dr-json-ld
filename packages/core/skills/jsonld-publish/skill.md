---
summary: Publishing a context — versions, aliases, why nothing renames a version, and what a host requires.
commands: version, alias, publish, diff, clone, search
---

# Publishing a context

Publishing a context is publishing an interface. An interface that can be edited
in place is not one, so a version here is immutable and the tool refuses every
write into an existing one rather than trusting anybody not to try.

## A version is its content

`ldm version new [<model>]` makes an immutable snapshot: the model as written,
the lockfile, the examples, and the emitted artifacts, under a manifest that
hashes every file and then hashes itself.

Its identity is a hash over its **inputs** — the model, the lockfile, the
examples — not over the manifest. The artifacts name the version they belong to,
so a manifest-derived identity would not converge: writing the id would change
the bytes that determine it.

The manifest's self-hash is the difference between a checksum and a table of
contents. Without it, editing a file *and* its manifest entry would verify
cleanly.

A hash detects accident and casual tampering. **It is not a signature.** The
field is called `integrity` precisely so nobody reads it as provenance.

## There is no command that renames a version

Because there is no operation that could. A version's name *is* its content
hash. What people mean when they say "rename" is one of two different things:

- *"This release should be called v2."* You are naming a **alias** — a movable
  label in a separate file that no version references. `ldm alias set v2 <version>`,
  and `ldm alias rename <from> <to>` moves the label. Retargeting an alias
  changes no version.
- *"The published bytes were wrong."* You want a new version and a retargeted
  alias. That is two commands, and it is the honest shape of the operation.

`ldm alias list` shows what points where. `ldm clone <version-or-alias>` makes a
new version from an existing one's inputs — it gets its own identity, so its
artifacts are the origin's with the header line retargeted, never copied
verbatim.

## Name the change before you ship it

`ldm diff <a> <b>` classifies the difference against the lockfile as
`additive`, `compatible`, `breaking`, `semantic` or `illegal`. Removing a
protected term is illegal. An ambiguous direction classifies as `breaking`.

`ldm diff <a> <b> --fail-on breaking` is what gates a pull request. Use it —
"we did not think it was breaking" is not a review artifact, and the classifier
is.

The two kinds of break are genuinely different and worth keeping straight:
changing a **key** breaks the documents consumers have already written while
changing no RDF; changing an **IRI** alters what the data means while every one
of those documents still parses.

## Publishing writes a tree; it does not upload

`ldm publish` validates the whole tree against every host adapter the project
names, and only then writes anything. A tree that works nowhere is not worth
half-writing.

The tool does not upload. Uploading means credentials, retries and a permissions
model, and every host already has a mature tool for it. What you get is a tree
those tools can copy verbatim.

What the adapters know, because it is declared rather than assumed:

- **GitHub Pages** needs `.nojekyll` at the tree root. Jekyll silently drops any
  path segment beginning with `_` or `.`, and the failure is a 404 rather than
  an error.
- **S3** needs every key to carry an extension, because a bucket cannot infer an
  index document for an arbitrary prefix.

Every adapter copies an artifact to its alias path rather than writing a
redirect. A redirect a host does not honour fails silently, which is worse than
a few duplicated kilobytes.

## Versioned paths, no content negotiation

A version is reachable at a path carrying its identity, an alias at a path
carrying its name, and both return the same bytes. The tree must serve from a
dumb file host, so anything needing a rewrite rule or server-side negotiation is
refused at publish time rather than discovered in production.

`ldm search <query>` searches what a project has published.

## Before the first publish

Check the namespace. A placeholder IRI resolves, validates and emits exactly
like a real one, and publishing is the point after which changing it is a
change of meaning rather than a correction. See the `jsonld-design` skill.
