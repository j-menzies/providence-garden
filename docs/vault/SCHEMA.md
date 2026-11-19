---
title: "Front-matter Schema"
type: "reference"
status: "draft"
tags: ["auth", "firebase", "gcp", "gdpr", "migration", "mobile", "phase-1", "phase-2", "security", "stripe"]
platinum_lock: "none"
export_visibility: "internal"
created: "2026-04-28"
updated: "2026-04-28"
---

# Front-matter Schema

This document is the source of truth for note front-matter in this Platinum Method knowledge vault. Every note carries YAML front-matter at the top of the file. Skills (`pm:adr`, `pm:requirement`, `pm:init`) and any tooling that creates or updates notes MUST conform to this schema.

## Conventions

- **Dates** — ISO-8601 (`YYYY-MM-DD`).
- **Strings** — plain UTF-8. Quoting is normalised by the obsidian-mcp-pro server; do not rely on a specific quoting style.
- **Arrays** — YAML block style preferred for human-edited files; the obsidian-mcp-pro server may serialise nested-object arrays as inline-flow JSON (e.g. `evidence: [{"type":"md",...}]`). Both forms are valid YAML and round-trip safely.
- **Enums** — values are case-sensitive, lowercase except where noted.
- **Required vs optional** — required fields MUST be present and non-empty. Optional fields may be omitted entirely.

## Common fields (every note)

| Field | Type | Values | Required | Definition |
|---|---|---|---|---|
| `title` | string | free | Y | Display title — used by Obsidian where it differs from the H1 |
| `type` | enum | `requirement \| adr \| architecture \| flow \| reference \| analysis \| audit \| moc \| spec \| plan \| api` | Y | Drives template, dataview filter, tag colour, MOC register membership |
| `status` | enum | type-dependent (see per-type below) | Y | Note lifecycle |
| `phase` | enum | `00_reference \| 01_requirements \| 02_current \| 03_gap \| 04_proposed \| 05_plan \| 06_api \| 07_flows \| 08_decisions \| 09_* \| 10_*` | N | Mirrors the folder; useful as a tag-like dataview field for cross-folder queries. Auto-derived from path when omitted. |
| `tags` | string[] | lowercase, hyphenated | N | Cross-cutting topics (e.g. `auth`, `mobile`, `firebase`, `gcp`, `security`, `gdpr`, `uk-safety-act`, `migration`, `phase-1`) |
| `related` | string[] | relative-link strings (`requirements/UA-P02-004.md`) | N | Explicit cross-references; supplements the implicit graph from body links |
| `created` | date | YYYY-MM-DD | Y | Creation date |
| `updated` | date | YYYY-MM-DD | Y | Last meaningful update — bumped on content change, not metadata |
| `platinum_lock` | enum | `none \| soft \| hard` | N | Replaces the legacy HTML-comment lock markers. `pm:locks` validates. |
| `lock_approved_by` | string | email | Conditional | Required when `platinum_lock != none` |
| `lock_approval_date` | date | YYYY-MM-DD | Conditional | Required when `platinum_lock != none` |
| `lock_reason` | string | free text | Conditional | Required when `platinum_lock != none` |
| `export_visibility` | enum | `public \| internal \| private` | N | Drives `pm:export` filtering. Replaces the legacy `PM-DEFAULT` marker. `private` = never export, `internal` = team only, `public` = stakeholder export. Defaults to `internal`. |

## Type-specific extensions

### `type: requirement`

Mirrors the project's canonical requirements schema (`requirements.canonical.schema.json`, if present). Every requirement note represents one entry in the canonical requirements database.

| Field | Type | Values | Required | Definition |
|---|---|---|---|---|
| `req_id` | string | e.g. `UA-P02-004` | Y | Stable canonical ID. Must be unique across the vault. |
| `req_status` | enum | `canonical \| draft \| deprecated \| archived \| needs_review` | Y | Requirement lifecycle. **Distinct from common `status`** — set common `status: published` once `req_status` reaches `canonical`. |
| `req_priority` | enum | `must \| should \| could \| future \| unknown` | Y | MoSCoW priority |
| `surface` | enum | `user_app \| group_owners \| support \| otp \| api \| common_system \| compliance \| testing \| ops \| other` | Y | Which app surface owns the requirement |
| `release` | string | release ID e.g. `r2` | Y | Release alignment |
| `signoff_phase` | string | phase ID or null | N | Sign-off phase within the release |
| `task_ids` | string[] | task IDs from the delivery system (e.g. project portal, issue tracker) | N | Tasks tracked for delivery |
| `introduced_on` | date | YYYY-MM-DD | N | When first surfaced |
| `supersedes` | req_id[] | array of req_ids | N | Which requirements this replaces |
| `superseded_by` | req_id[] | array of req_ids | N | Which requirements replace this |
| `depends_on` | req_id[] | array of req_ids | N | Hard dependencies |
| `evidence` | object[] | `[{type: md\|json\|decision\|task\|test, ref: path, quote: text}]` | Y (≥1) | Source attestation per the canonical schema |
| `notes` | string[] | free | N | Free-form prose annotations |

### `type: adr`

MADR 3.0 derived. See `08_decisions/ADR-001-tailwindcss-adoption.md` through `ADR-005-age-verification-uk-online-safety-act.md` for the in-flight format.

| Field | Type | Values | Required | Definition |
|---|---|---|---|---|
| `adr_id` | string | `ADR-NNN` | Y | Stable ID, sequential. e.g. `ADR-005`. |
| `adr_status` | enum | `proposed \| accepted \| rejected \| superseded \| deprecated` | Y | MADR lifecycle. **Distinct from common `status`**. |
| `deciders` | string[] | logins or emails | Y | Who decided |
| `decision_date` | date | YYYY-MM-DD | Y | When decided (or proposed) |
| `supersedes` | string[] | ADR IDs | N | Which decisions this replaces |
| `superseded_by` | string[] | ADR IDs | N | Which decisions replace this |
| `affects` | req_id[] | array of req_ids | N | Requirements impacted by this decision |

### `type: architecture | spec | plan | flow | analysis | audit | reference | api | moc`

Common fields only, with the following `status` enum: `draft | proposed | accepted | superseded | archived`.

Per-type extensions:

- **`architecture`** — `subtype` (`current | proposed`), `components: string[]`
- **`flow`** — `flow_type` (`user-journey | process | system-interaction`), `diagram` (`mermaid | plantuml | d2 | image`)
- **`audit`** — `audit_date` (YYYY-MM-DD), `auditor` (login or email), `findings_count` (number)
- **`spec | plan | reference | api | moc`** — common fields only

## Examples

### Minimal ADR

```yaml
---
title: "ADR-006: Adopt Obsidian-native vault"
type: adr
status: draft
adr_id: "ADR-006"
adr_status: proposed
deciders: ["alice-dev"]
decision_date: 2026-04-28
affects: []
phase: 08_decisions
tags: ["tooling", "method"]
related: []
created: 2026-04-28
updated: 2026-04-28
platinum_lock: none
export_visibility: internal
---
```

### Requirement with evidence

```yaml
---
title: "User app age verification"
type: requirement
status: published
req_id: "UA-P02-004"
req_status: canonical
req_priority: must
surface: user_app
release: r2
signoff_phase: phase-2
task_ids: ["TASK-001"]
introduced_on: 2026-02-15
supersedes: []
superseded_by: []
depends_on: ["GOV-FLAG-002"]
evidence:
  - type: decision
    ref: "08_decisions/ADR-005-age-verification-uk-online-safety-act.md"
    quote: "Stripe Identity selected for IDV per ADR-005"
  - type: md
    ref: "04_proposed_architecture/age-verification-design.md"
    quote: "Age gate triggers on first login when surface=user_app"
notes: ["Originally raised under PORTAL-GOV-003 audit"]
phase: 01_requirements
tags: ["auth", "uk-safety-act", "compliance"]
related: ["08_decisions/ADR-005-age-verification-uk-online-safety-act.md"]
created: 2026-02-15
updated: 2026-04-27
platinum_lock: none
export_visibility: internal
---
```

## Section-fence convention (Method MOC)

The `Method MOC.md` at the vault root contains static markdown registers. Skills update these registers programmatically by targeting HTML-comment section fences:

```markdown
## ADR Register
<!-- PM-MOC-REGISTER: adr -->
| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-001](08_decisions/ADR-001-tailwindcss-adoption.md) | TailwindCSS adoption | accepted | 2026-01-12 |
…
<!-- /PM-MOC-REGISTER: adr -->
```

Skills implementing register updates use a shared `_lib/moc` helper:

```
update_moc_register(register_id, rows)
```

The helper reads `Method MOC.md`, locates the matching `<!-- PM-MOC-REGISTER: <id> -->` fence pair, replaces the contents with the supplied rows (sorted per the register's convention), and writes back.

This pattern is GitHub-friendly (HTML comments are invisible in rendered markdown) and Obsidian-friendly (renders as a normal table). When a Dataview-style plugin is later admitted, registers can become queries; the section-fence stays so non-Dataview viewers still see the rendered table.

## Smoke test

The schema's nested-object fields (`evidence`, `task_ids`, `depends_on`) round-trip correctly through `obsidian-mcp-pro create_note` → `update_frontmatter` → `get_note`. Note: nested-object arrays serialise as inline-flow JSON rather than YAML block style — both are valid YAML; do not rely on a specific representation when reading.
