## Context

**The metamodel does not change.** No facet is added, no field on a model gains or loses meaning, and `[[lat.md/metamodel#Metamodel#Terms]]` is untouched. Everything here is about *where the existing rules are written down* and *who reads them* — the JSON Schema gets constraints the validator already enforces, and the guidance gets a distribution format. That is what makes this change reversible: delete the skills directory and retarget one `$id`, and the tool is exactly what it is today.

For motivation, see proposal.md — Why. The constraints that shape the approach:

- `[[lat.md/architecture#Architecture#Surface Syntax]]` says the schema lives once in `core` and is copied into the extension, with a test asserting the copies are identical. A third copy on the site is the same arrangement with one more destination.
- `[[lat.md/architecture#Architecture#Distribution#Documentation site]]` says `site/` has no generator and no build step: *the deployed bytes are the committed bytes*. A generated reference page has to be generated into the repository and verified in CI, never generated at deploy time.
- The Pages workflow already asserts three things about every page — that internal links resolve, that no subresource is third-party, and that all three legal pages are linked. A new page must satisfy all three.
- `[[lat.md/architecture#Architecture#Package Boundary]]`: `core` must never import `vscode`.

## Goals / Non-Goals

**Goals:**
- One source per skill, three rendered formats, with no path by which the formats can disagree.
- A schema that rejects a facet combination at the moment it is typed, and a validator that reports the same fact with a rule id — never two opinions.
- A published schema whose URL is its identity, versioned so a tightening cannot retroactively invalidate a model that already validated.

**Non-Goals:**
- No new *target*. `[[lat.md/emitters#Emitters#Capability Matrix]]` is not extended, no capability set is declared, and no downgrade is introduced: a skill is content the tool ships, not an artifact emitted from a model. The renderers are deliberately not called emitters and do not go through `emit`.
- **No IR change**, therefore no effect on the lockfile, on the stable key order, or on `ldm diff`'s change classification.
- **No processor change**, therefore no effect on the source map or the trace, and no W3C suite class is touched. Both ratchets stay where they are.
- **No effect on IRI stability or rename detection.** Element ids, term keys and namespaces are untouched.

## Decisions

### Skills live in `core`, rendered by `cli`

Source of truth is `packages/core/skills/<name>/`: one `skill.md` body plus a metadata header giving the name, the one-line summary, and the commands the skill routes to. `core` exports the parsed set; `cli` adds the `skill` verb and does the writing.

*Why core:* the extension is the obvious second consumer (an "Install authoring skills" command), and `[[lat.md/architecture#Architecture#Package Boundary]]` already puts shared content there. `core` gains no `vscode` import — the skill module reads files and returns strings, and the package-boundary scan test covers it unchanged.

*Alternative rejected:* putting them in `cli`. It works today and blocks the extension tomorrow, and moving them later would change the skill source paths for anyone who has vendored them.

*Packaging:* `packages/core/package.json` gains `skills` to its `files` array, beside `schema`. A skill is markdown read at runtime rather than a string baked into `dist`, so `tsc` stays the typechecker and nothing new enters the build.

### One source, three renderers, verified by round-trip

Agent Skill (`SKILL.md` + frontmatter), `AGENTS.md` bundle, and Copilot `*.chatmode.md` are three framings of the same body. Each renderer is a pure function from the parsed skill to a file set.

The guard against drift is not review: a test parses each rendered format back out and asserts the body text and the set of referenced commands and rule ids are identical across all three. Frontmatter differs; content cannot.

*Alternative rejected:* three hand-written files per skill. It is what every project that ships multi-agent guidance does, and it is why their formats disagree within two releases.

### A skill's claims are checked against the rule registry

A test extracts every `L0.*`/`L1.*`/`L2.*` token from every skill body and asserts it exists in `RULES`. A skill that names a rule that was renamed fails the build.

This is the mechanical half of locked decision 16. The other half — that a skill never produces a diagnostic — is structural: nothing in `check`, `emit`, `explain` or `diff` reads the skills directory, and a test asserts `ldm check` produces identical output with skills installed and absent.

### `ldm skill install` has no default target

`--project` or `--user` is required. This was the user's call and it is the right one for a command whose failure mode is writing files into a directory the caller did not mean: a wrong `--user` install is invisible and affects every repository they open afterwards.

Overwrite protection is by comparison, not by timestamp: a file identical to what would be written is *current*; a file that differs is *modified* and is left alone with a message. `--force` takes the new version. There is no merge — a skill is prose, and a three-way merge of prose is a worse outcome than a clear refusal.

### The schema encodes only what JSON-LD itself forbids

Three constraints, and no more: a legal `@container` combination, a `@reverse` term whose `@container` is `@set` or `@index` only, and a `@reverse` term carrying neither `@id` nor `@nest`. Each mirrors a check the processor already makes — `applyContainer` and step 13 of Create Term Definition in `packages/core/src/processor/active-context.ts`.

Two combinations that look like mistakes are deliberately **accepted**, because JSON-LD accepts them:

- `@language` beside a `@type` coercion. Step 22 reads `@language` only when `@type` is absent, so the language is ignored rather than refused. A schema that rejected it would refuse a legal context and would be the only voice saying so.
- A 1.1 facet in a `mode: "1.0"` model. Locked decision 5 makes this a *downgrade* — `L1.facet-not-in-mode` at warning severity — and `validateModel` reports `failed: hasErrors()`, so such a model passes `ldm check` today. Rejecting it in the schema would relitigate decision 5 and would break the agreement requirement, which forbids the schema having an opinion the validator does not.

This is the whole content of "never a second and different opinion": the schema's reach is bounded by what makes `ldm check` exit non-zero, not by what looks wrong.

### Co-constraints are named `$defs`, not inline `if`/`then`

Each co-constraint becomes one `$defs` entry with a `title` and a `description` written as the sentence the editor should show, composed into `term` through `allOf`.

*Why named:* JSON Schema 2020-12 validators report `if`/`then`/`not` failures poorly, and an anonymous inline branch produces "must not match schema" at the root. A named subschema with a title gives the editor something to print, and gives the reference generator something to document.

*Accepted cost:* the raw escape hatch is exempt from the co-constraints, per the spec scenario. A facet reached through raw is by definition one the metamodel has not named, so a schema that constrained it would be constraining a construct it does not model.

### Published at `/schemas/model/1/`, and the `$id` moves

The `$id` becomes `https://volland.github.io/dr-json-ld/schemas/model/1/model.schema.json`, matching where it is served. `https://pavlyshyn.dev/...` is abandoned rather than made to resolve — per the proposal's non-goals, a custom domain is a second thing that can go down for no gain here.

The version segment is `1`, matching the model format version the schema already requires (`jsonld: "1"`). A change that rejects a previously-accepted model goes to `/2/` *and bumps the format version*, because a model that must change to keep validating is a model-format change, not a schema-packaging one. A change that only loosens or re-describes is published in place.

This is a `$id` change to a URL that currently serves nothing, so nobody is depending on it. It is not breaking.

### The reference page is generated into the repository

A script renders `site/schemas/model/1/index.html` from the schema document. CI re-runs it and fails on any diff — the same regeneration-and-compare arrangement `[[lat.md/architecture#Architecture#Source of Truth]]` uses for the emitted `@context`, and for the same reason: the committed bytes are what deploys, so the check has to catch a stale file before the deploy, not during it.

The page is a normal site page: same stylesheet, same masthead, and the three legal links the Pages workflow requires on every page.

### Two new Pages assertions

1. Every `*.schema.json` under `site/schemas/` parses, and its `$id` equals the URL it will be served at. This is the check that makes the identity requirement real; nothing else would catch a moved directory.
2. The Pages workflow's trigger paths gain nothing — it already fires on `site/**`. But the *CI* workflow gains the copy-identity check across all three locations, because a schema edited in `core` and not mirrored into `site/` would otherwise only be noticed when someone fetched the stale URL.

## Risks / Trade-offs

- **Editor error messages for co-constraints are worse than the validator's** → The named-`$defs` decision above is the mitigation, and it is partial. The L1 rule remains the readable report; the schema's job is to be *early*, not to be the best-worded. The spec requires both to fire on the same file, so the user always has the good message available from `ldm check`.
- **A skill's prose goes stale against the tool's behaviour** → Mechanically checkable claims are checked: rule ids against the registry, command names against the CLI's command set. Prose that is merely out of date is not detectable and is accepted; it is why skills route to commands rather than answering.
- **A third schema copy is a third thing to forget** → The copy test covers all three and names which disagree. This is the arrangement that has already held for two copies.
- **`--user` install puts guidance outside the repository, where it cannot be reviewed** → The reason the target is required rather than defaulted. The output names every path written, so a wrong choice is visible immediately.
- **The `$id` change is a URL nobody has used, but somebody might have** → Searchable: the old URL appears only in the two committed schema copies. A stale reference resolves the same way it does today, which is a 404.
- **Rendering three formats invites a fourth request** → The renderer interface is one function per format over a parsed skill, so a fourth is a file rather than a redesign. That is the whole reason the source is not the rendered form.

## Migration Plan

No migration. Nothing existing changes shape:

1. Land the schema co-constraints with the accept/reject corpus. Every fixture model must still pass — if one does not, the constraint is wrong, not the fixture.
2. Land the `$id` retarget and `site/schemas/model/1/` together, in one commit, so the identity assertion is never momentarily false.
3. Land the reference page and its generator.
4. Land the skills and the `skill` verb last; they depend on the rule registry and the CLI command set being stable, not the other way around.

Rollback is per-step and independent. Reverting the skills leaves the schema work intact; reverting the schema tightening leaves a looser schema that still validates every model that validated before.

## Open Questions

- Whether the extension should contribute an "Install authoring skills" command. It changes nothing here — `core` exports the set either way — and is a `vscode` package change that can land whenever it is wanted.
- Whether the handbook at `site/book/` should link the schema reference. Editorial, resolvable after the page exists and can be read.
