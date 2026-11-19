---
title: "Method MOC"
type: moc
status: published
phase: 00_reference
tags: ["moc", "method", "navigation"]
related: []
created: 2026-11-05
updated: 2026-11-05
platinum_lock: soft
lock_approved_by: "29292945+j-menzies@users.noreply.github.com"
lock_approval_date: 2026-11-05
lock_reason: "Vault navigation root — structural changes need approval to avoid breaking links across notes."
export_visibility: internal
---

# Method MOC

A *Map of Content* for Providence Garden. This note is the vault's navigation root — every section, every register, and every status view links from here. If you don't know where to start, start here.

The vault implements the Platinum Method (numbered folders 00–10) on top of an Obsidian-native layer (front-matter, tags, MOC, graph). The numbered folders encode the Method workflow phase; the front-matter and tags encode cross-cutting concerns.

## How to navigate

- **By phase** — sections 00 → 10 below correspond to the numbered folders.
- **By type** — registers further down list every ADR, requirement, draft, and locked note.
- **By topic** — use Obsidian tags or full-text search to surface notes regardless of folder.
- **By relationship** — open any note and use the graph view or backlinks panel.

The schema for note front-matter is documented in [SCHEMA.md](SCHEMA.md). New notes should be created from the templates in [_templates/](_templates/).

## Section index

| Section | Phase | Purpose |
|---|---|---|
| [00_reference_documentation](00_reference_documentation/README.md) | Discovery | External materials, specs, vendor documentation. Read-only foundation. |
| [01_requirements](01_requirements/README.md) | Requirements | Canonical requirement specs. |
| [02_current_architecture](02_current_architecture/README.md) | As-is | Analysis and assessment of the existing system. |
| [03_gap_analysis](03_gap_analysis/README.md) | Analysis | Gap between current and proposed; technology evaluations. |
| [04_proposed_architecture](04_proposed_architecture/README.md) | Design | New system design, components, specs, sub-clusters per topic. |
| [05_implementation_plan](05_implementation_plan/README.md) | Planning | Phased delivery roadmap. |
| [06_api_index](06_api_index/README.md) | Spec | API catalogue and contracts. |
| [07_flows](07_flows/README.md) | Spec | Process flows and user journeys. |
| [08_decisions](08_decisions/README.md) | Decisions | ADRs (MADR 3.0). Continuous, not phase-bound. |

## Registers

Registers are static markdown tables, updated programmatically by the `pm-*` skill family. Each is wrapped in HTML-comment section fences (`<!-- PM-MOC-REGISTER: <id> -->`) so skills can target them without parsing the surrounding prose. This pattern survives both Obsidian and GitHub rendering.

### ADR Register

Sorted by `adr_id` descending (newest first).

<!-- PM-MOC-REGISTER: adr -->
| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-003](08_decisions/ADR-003-replace-aerial-imagery-with-a-vector-base-map-and-a-data-first-ui.md) | Replace aerial imagery with a vector base map and a data-first UI | accepted | 2026-11-04 |
| [ADR-002](08_decisions/ADR-002-keep-user-roles-in-firestore-member-documents.md) | Keep user roles in Firestore member documents | accepted | 2026-11-04 |
| [ADR-001](08_decisions/ADR-001-use-native-firebase-with-security-rules-as-the-enforcement-point.md) | Use native Firebase with security rules as the enforcement point | accepted | 2026-11-04 |
<!-- /PM-MOC-REGISTER: adr -->

### Requirements Register

Grouped by `surface`, then by `req_id`.

<!-- PM-MOC-REGISTER: requirements -->
| Req ID | Surface | Title | Status | Priority |
|---|---|---|---|---|
| _Empty — populate via `/pm-requirement` (interactive add) or `/pm-requirement --bulk-migrate` (from a canonical JSON source)._ |
<!-- /PM-MOC-REGISTER: requirements -->

### Drafts

Anything with `status: draft` or no inbound links.

<!-- PM-MOC-REGISTER: drafts -->
| Path | Type | Updated |
|---|---|---|
| _Empty — populated by `pm-audit` (deferred)._ |
<!-- /PM-MOC-REGISTER: drafts -->

### Locked Content

Anything with `platinum_lock != none`.

<!-- PM-MOC-REGISTER: locked -->
| Path | Type | Lock Level | Approved By | Approval Date |
|---|---|---|---|---|
| [Method MOC.md](Method%20MOC.md) | moc | soft | 29292945+j-menzies@users.noreply.github.com | 2026-11-05 |
<!-- /PM-MOC-REGISTER: locked -->

## Skill family

The `pm-*` skill family provides agent-invocable Method workflows:

- `/pm-init` — interview-driven seed of a fresh PM vault (this vault was created by it).
- `/pm-adr` — interactive ADR creation against the MADR template.
- `/pm-requirement` — interactive requirement creation; bulk-migrate mode applies front-matter to imported requirement files.

Reserved for later iterations (namespace held): `pm-patch`, `pm-analyze`, `pm-instructions`, `pm-convert-pdf`, `pm-standards`, `pm-scan-sources`, `pm-locks`, `pm-audit`, `pm-export`, `pm-traceability`, `pm-spec`.

## References

- Front-matter schema: [SCHEMA.md](SCHEMA.md)
- Templates: [_templates/](_templates/)
- Platinum Method (upstream): [Think-Platinum/platinum-method](https://github.com/Think-Platinum/platinum-method)
