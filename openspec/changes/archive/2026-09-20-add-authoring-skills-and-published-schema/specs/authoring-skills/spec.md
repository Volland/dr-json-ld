## Purpose

Defines the guidance documents the tool ships for a coding agent working on a model: what each skill covers, the formats they are emitted in, and how `ldm skill list` and `ldm skill install` place them into a project or a user's home without ever becoming a second authority beside the rule ids.

## ADDED Requirements

### Requirement: The build ships a named set of skills

The system SHALL carry a fixed set of skills, each identified by a stable name and
each covering one part of authoring. The set SHALL cover: designing a namespace and
its terms; writing the model file surface; reading a finding; and publishing a
version. A skill's name SHALL be stable across releases and SHALL NOT be reused for
different guidance.

#### Scenario: Listing what the build carries

- **WHEN** `ldm skill list` is run
- **THEN** every skill this build carries is printed with its name and a one-line summary
- **AND** the list is the same whether or not a project encloses the working directory

#### Scenario: A skill name is stable

- **WHEN** a skill's guidance is rewritten between releases
- **THEN** its name is unchanged
- **AND** an installed copy of the old skill is recognised as the same skill

### Requirement: A skill defers every model-specific claim to a command

A skill SHALL NOT state what a particular model, term or document does. Where a skill
would need such a fact, it SHALL name the command that produces it — `ldm check`,
`ldm emit`, `ldm explain` or `ldm diff` — and SHALL identify findings by rule id
rather than by paraphrase. A skill SHALL NOT be an input to validation, emission or
any exit code.

#### Scenario: Guidance about a specific model

- **WHEN** a skill discusses whether a term's coercion fired
- **THEN** it directs the reader to `ldm explain` rather than asserting an answer

#### Scenario: A skill names a finding

- **WHEN** a skill refers to a validation result
- **THEN** it names the rule id, and that rule id exists in the rule registry

#### Scenario: Skills do not affect a command's result

- **WHEN** `ldm check` is run in a project with skills installed and again with them removed
- **THEN** the findings, their rule ids and the exit code are identical

### Requirement: One skill source is emitted in three formats

Each skill SHALL be emitted as an Agent Skill directory containing `SKILL.md` with a
name and description, as a vendor-neutral `AGENTS.md` bundle, and as a Copilot
`*.chatmode.md` file. All three SHALL be derived from one source, so guidance cannot
differ between formats.

#### Scenario: The same skill in two formats

- **WHEN** one skill is installed as an Agent Skill and as a chatmode
- **THEN** the guidance in both carries the same claims and names the same commands and rule ids

#### Scenario: Selecting a format

- **WHEN** `ldm skill install --format agents` is run
- **THEN** only the vendor-neutral bundle is written
- **AND** no Agent Skill directory and no chatmode file is created

### Requirement: Installing requires an explicit target

`ldm skill install` SHALL require the caller to state where skills are written.
`--project` SHALL write beneath the current project, and `--user` SHALL write beneath
the user's home. Running the command with neither SHALL be a usage error naming both
flags, and SHALL write nothing.

#### Scenario: No target given

- **WHEN** `ldm skill install` is run with no target flag
- **THEN** the command exits with the usage code
- **AND** the message names `--project` and `--user`
- **AND** no file is created anywhere

#### Scenario: Installing into a project

- **WHEN** `ldm skill install --project` is run
- **THEN** the skills are written beneath the current directory
- **AND** the path of every file written is printed

#### Scenario: Installing named skills only

- **WHEN** `ldm skill install --project` is given one or more skill names
- **THEN** only those skills are written
- **AND** a name this build does not carry is a usage error listing the names it does

### Requirement: Installing never destroys an edited skill

`ldm skill install` SHALL NOT overwrite an installed skill whose content differs from
what this build would write. It SHALL report the file, leave it unchanged, and
continue with the remaining skills. An installed file byte-identical to what would be
written SHALL be reported as already current.

#### Scenario: A skill the user has edited

- **WHEN** an installed skill has been modified and `ldm skill install` is run again
- **THEN** the file is left exactly as it was
- **AND** the command names it as modified and says how to take the new version

#### Scenario: A skill already current

- **WHEN** an installed skill is byte-identical to this build's version
- **THEN** it is reported as current and not rewritten

#### Scenario: Taking the new version deliberately

- **WHEN** `ldm skill install --project --force` is run over a modified skill
- **THEN** the file is replaced with this build's version
- **AND** the replacement is named in the output

### Requirement: The skill verb reaches no network

`ldm skill list` and `ldm skill install` SHALL read only from the installed package
and the local filesystem. Neither SHALL open a network connection under any flag.

#### Scenario: Installing with the network off

- **WHEN** `ldm skill install --user` is run with outbound network disabled
- **THEN** the skills are written and the command exits cleanly
