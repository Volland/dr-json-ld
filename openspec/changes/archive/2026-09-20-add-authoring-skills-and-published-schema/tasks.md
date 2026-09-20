No processor work and no emitter work is in this change, so the conformance,
differential, golden-file and artifact-execution tasks those rules require do not
apply. The schema tightening does produce findings, so task 2.5 is its
negative-example task.

## 1. Schema co-constraints

- [x] 1.1 Add the accept/reject corpus directory under `packages/core/test/fixtures/schema/`, with the harness that runs every file against `packages/core/schema/model.schema.json` and asserts the expected verdict. Start it with the existing fixture models as must-accept cases, so the corpus fails before any constraint is written only if the harness itself is wrong.
- [x] 1.2 Add the `@container` co-constraint as a named `$defs` entry with a `title` and a one-sentence `description`, composed into `term` via `allOf`. Add must-reject cases for each illegal combination and must-accept cases for every legal one.
- [x] 1.3 Add the `@reverse` container co-constraint: no `@container` other than `@set` or `@index`. Add its corpus cases.
- [x] 1.4 Add the `@reverse` exclusion co-constraint: a reverse term carries neither `@id` nor `@nest`. Add its corpus cases.
- [x] 1.5 Add the must-accept cases for the two combinations the schema deliberately permits: a term with both `@language` and a `@type` coercion, and a `mode: "1.0"` model using a 1.1 facet. Both are legal models — the first because JSON-LD ignores the language, the second because it is a downgrade at warning severity per locked decision 5.
- [x] 1.6 Add the raw-escape-hatch exemption and a must-accept case proving a facet carried through raw is not refused by any of 1.2–1.4.
- [x] 1.7 Mirror the schema into `packages/vscode/schema/model.schema.json` and confirm the existing byte-identity test passes.

## 2. Schema and validation agree

- [x] 2.1 Add the agreement test: every must-reject corpus file is reported by `validateModel` with at least one finding at **error** severity, and every must-accept file reports no error. A warning-severity finding must not correspond to a schema rejection.
- [x] 2.2 Reconcile whichever direction fails in 2.1 — either the schema is stricter than the validator or the reverse. Fix whichever is wrong; do not loosen the schema to make the test green without saying why in the commit.
- [x] 2.3 Confirm `L1.invalid-container-mapping` and `L1.invalid-reverse-property` are each reached by at least one corpus file, and that each finding carries a line and column into the model file.
- [x] 2.4 Run every fixture model and every fixture project through `ldm check`; any fixture the new constraints reject is a wrong constraint, not a wrong fixture.
- [x] 2.5 Negative-case coverage for the new constraints. The `examples:` mechanism validates *documents* and these are model-level errors, so the reject corpus carries the negative cases instead: each file names the constraint it violates and the agreement test asserts the rule id and its line/column. CI additionally asserts every reject fixture makes `ldm check` exit non-zero and every accept fixture does not, so the corpus is self-testing against the real binary per locked decision 13.

## 3. Publishing the schema

- [x] 3.1 Create `site/schemas/model/1/` and `site/schemas/project/1/`, copy both schemas in, and retarget each `$id` to the URL it is served at. Land the copies and the `$id` change in one commit so the identity assertion is never momentarily false.
- [x] 3.2 Widen `packages/core/test/schema-copies.test.ts` to compare all three locations and name which disagree.
- [x] 3.3 Add the Pages workflow step asserting every `*.schema.json` under `site/schemas/` parses and its `$id` equals its served URL.
- [x] 3.4 Add the copy-identity assertion to the CI workflow as well, so a schema edited in `core` and not mirrored into `site/` fails before it is fetched stale.

## 4. Schema reference page

- [x] 4.1 Write the generator that renders the reference page from the schema document: every field, its type, whether it is required, and each named co-constraint's title and description.
- [x] 4.2 Generate `site/schemas/model/1/index.html` using the site's existing stylesheet and masthead, with the three legal-page links the Pages workflow requires and a link to the schema at its `$id`.
- [x] 4.3 Add the CI step that re-runs the generator and fails on any diff against the committed page.
- [x] 4.4 Confirm the page passes all three existing Pages assertions: internal links resolve, no third-party subresource, all three legal pages linked.
- [x] 4.5 Link the reference page from the site navigation or the landing page, and confirm the link checker still passes.

## 5. Skill source and renderers

- [x] 5.1 Add `packages/core/skills/` with the parsed-skill type and the loader, and add `skills` to `packages/core/package.json`'s `files` array. Export the set from `core`; confirm the package-boundary scan still reports no `vscode` import.
- [x] 5.2 Write the `jsonld-design` skill: namespaces, minting versus reusing an IRI, when a key deserves a term. Routes to `ldm check` and `ldm emit`.
- [x] 5.3 Write the `jsonld-model-yaml` skill: the model file surface, the published schema URL, the facet co-constraints from section 1, and that the emitted `@context` is never hand-edited.
- [x] 5.4 Write the `jsonld-findings` skill: reading a finding, what a level means, and what each commonly-hit rule id is asking for. Routes to `ldm check --json` and `ldm explain --trace`.
- [x] 5.5 Write the `jsonld-publish` skill: versions, aliases, why there is no rename, and hosts. Routes to `ldm version new`, `ldm alias` and `ldm publish`.
- [x] 5.6 Implement the Agent Skill renderer (`SKILL.md` with name and description frontmatter).
- [x] 5.7 Implement the `AGENTS.md` bundle renderer and the Copilot `*.chatmode.md` renderer.
- [x] 5.8 Add the round-trip test: parse each rendered format back out and assert the body text, the referenced commands and the referenced rule ids are identical across all three.
- [x] 5.9 Add the registry test: every rule id token appearing in any skill body exists in `RULES`, and every command name a skill names exists in the CLI's command set.

## 6. The `skill` verb

- [x] 6.1 Add `skill` to the CLI command set and to `USAGE`, with `list` and `install` verbs and the `--project`, `--user`, `--format` and `--force` flags registered in `TAKES_VALUE` where they take a value.
- [x] 6.2 Implement `ldm skill list`: name and one-line summary for every skill, identical whether or not a project encloses the working directory.
- [x] 6.3 Implement `ldm skill install` target resolution: refuse with the usage exit code and a message naming both flags when neither `--project` nor `--user` is given, writing nothing.
- [x] 6.4 Implement writing: named skills only when names are given, a usage error listing known names when one is unknown, and the path of every file written printed.
- [x] 6.5 Implement overwrite protection by byte comparison — current, modified, or replaced under `--force` — with each outcome named in the output.
- [x] 6.6 Add the CLI tests against the injected `Io` for every scenario in `specs/authoring-skills/spec.md`, including the no-target refusal writing nothing.
- [x] 6.7 Add the isolation test: `ldm check` produces identical findings, rule ids and exit code with skills installed and with them absent.
- [x] 6.8 Add the offline test asserting `skill list` and `skill install` open no network connection under any flag, and add `ldm skill install --user` to the CI job that runs with outbound traffic dropped.

## 7. Documentation and close-out

- [x] 7.1 Update `lat.md/architecture.md#Architecture#Surface Syntax` for the three schema copies, the published versioned URL, and the co-constraints the schema now carries.
- [x] 7.2 Update `lat.md/architecture.md#Architecture#Distribution#Documentation site` for `site/schemas/`, the generated reference page, and the two new Pages assertions.
- [x] 7.3 Add a section to `lat.md/architecture.md` for the skills: what they are, why they live in `core`, the three formats, and why a skill never produces a diagnostic — citing locked decision 16.
- [x] 7.4 Add `// @lat:` code refs from the new schema corpus harness, the skill loader, the renderers and the `skill` verb to the sections they implement.
- [x] 7.5 Update the CLI and core READMEs with `ldm skill list` / `ldm skill install` and the published schema URL, and confirm no install line names the unscoped `ldm` package.
- [x] 7.6 Run `lat check`.
