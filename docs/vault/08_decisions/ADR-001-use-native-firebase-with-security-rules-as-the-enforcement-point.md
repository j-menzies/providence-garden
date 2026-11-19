---
title: "ADR-001: Use native Firebase with security rules as the enforcement point"
type: "adr"
status: "draft"
phase: "08_decisions"
tags: ["firebase", "security", "architecture"]
related: ["ADR-002-keep-user-roles-in-firestore-member-documents.md", "ADR-003-replace-aerial-imagery-with-a-vector-base-map-and-a-data-first-ui.md"]
adr_id: "ADR-001"
adr_status: "accepted"
deciders: ["29292945+j-menzies@users.noreply.github.com"]
decision_date: "2026-11-04"
affects: []
platinum_lock: "none"
export_visibility: "internal"
created: "2026-11-05"
updated: "2026-11-05"
---

# ADR-001: Use native Firebase with security rules as the enforcement point

## Context and Problem Statement

The Providence Garden prototype stores everything in one browser's IndexedDB, so only one person can use it and nothing is shared. The garden committee of Jacob's Island Residents Association (JIRA) has received it well and now needs it to work for several people: committee members who capture and edit, admins who manage users, and the public who view what is in the garden.

The app is mostly UI and storage with little business logic. It is run by volunteers, so it must be cheap and simple to keep going. We need a back end for shared data, sign-in and photos, and a single place where access is enforced.

The Think Platinum default is that "the API is the single enforcement point". This decision departs from that default, so it is recorded here.

## Decision Drivers

- A volunteer organisation: fewest moving parts, least ongoing maintenance.
- Little business logic: capture, edit, publish, view.
- Offline capture on phones in poor signal.
- Running cost at or near zero.
- A full local stack for development, and the option to run the front end locally against a deployed back end.
- Cost reporting through Think Platinum FinOps.

## Options Considered

### Option 1: Native Firebase, client SDK, security rules as the enforcement point

**Description:** The React PWA talks directly to Firebase Authentication, Firestore, Cloud Storage and Hosting. Firestore and Storage security rules decide who can read and write what. There is no server code.

**Advantages:**
- No servers or functions to build, deploy or patch.
- Firestore's offline cache gives offline capture and live updates for free.
- The Emulator Suite runs the whole stack locally.
- Free allowances cover the expected use; estimated under £2 a month.
- The prototype's data is already shaped as Firestore collections.

**Disadvantages:**
- Rules are the security boundary, so a mistake in them exposes data or allows writes.
- Rules work per document, not per field, which shapes the data model.
- Departs from the organisation default of an API as the enforcement point.

**Assessment:** The best fit for a small volunteer app, provided the rules are tested as seriously as an API would be.

### Option 2: Firebase behind an API (Cloud Run or Cloud Functions)

**Description:** The client calls our own API, which checks permissions and reads and writes Firestore and Storage with the Admin SDK.

**Advantages:**
- Follows the organisation default.
- Business rules live in ordinary code with ordinary tests.

**Disadvantages:**
- Server code to build, deploy, secure and upgrade as runtimes are retired.
- Loses Firestore's built-in offline cache and live updates, which would have to be rebuilt.
- More cost and more for volunteers to maintain, with little logic to justify it.

**Assessment:** Sound for a product with real business logic, but over-built for this one.

### Option 3: Another back end-as-a-service (for example Supabase)

**Description:** A hosted Postgres with row-level security, auth and storage.

**Advantages:**
- Relational data and SQL.
- Row-level security plays the same role as rules.

**Disadvantages:**
- Weaker offline story for a field-capture PWA.
- Sits outside GCP, so outside the Think Platinum project structure, Terraform patterns and FinOps reporting.

**Assessment:** Viable, but loses offline sync and the GCP alignment.

## Decision Outcome

**Chosen option:** Option 1, native Firebase with security rules as the enforcement point.

**Rationale:** It meets every driver with the least to build and maintain. The work is UI and storage, and Firebase provides storage, sign-in, offline sync and hosting as managed services. Treating the rules as the API keeps a single enforcement point, which is the intent of the organisation default, without server code.

### Implementation Details

- Services: Firebase Authentication (Google and email-link sign-in), Firestore, Cloud Storage, Hosting, and App Check on Prod.
- No Cloud Functions in the first release. Add one only when a real need appears, such as email notifications.
- Rules, indexes and Hosting releases live in the app repo and deploy with the Firebase CLI.
- Rules are versioned with the code, reviewed like code, and tested against the emulator for every role and collection in `make check`.
- Location `europe-west2` (London). Firestore's location cannot be changed after creation.
- Two projects, Dev and Prod, created with Terraform, on a new billing account that feeds the Think Platinum FinOps dashboard.

## Consequences

### Positive

- Nothing server-side to patch or upgrade.
- Offline capture and live updates come from Firestore itself.
- Local development runs entirely on the emulators.
- Running cost expected to stay within free allowances.

### Negative

- The rules carry all access control, so they need thorough tests.
- Private data must sit in separate documents, not hidden fields.
- Firestore cannot store nested arrays, so GeoJSON geometry is stored as a string.

### Risks and Mitigation

- A rules mistake exposes committee data or allows public writes: rules tests per role and collection in `make check`, and review of every rules change.
- A bug causes runaway reads and an unexpected bill: budget alerts on each project, and reads through listeners and the offline cache rather than repeated fetches.
- A future need for server-side logic: add a single Cloud Function at that point; the projects are already on the Blaze plan.

## Related Decisions

- [ADR-002: Keep user roles in Firestore member documents](ADR-002-keep-user-roles-in-firestore-member-documents.md)
- [ADR-003: Replace aerial imagery with a vector base map and a data-first UI](ADR-003-replace-aerial-imagery-with-a-vector-base-map-and-a-data-first-ui.md)

## References

### Internal Documentation

- Architecture proposal: https://claude.ai/artifact/HDKPv6WdkCtygWLjeii2xt

### External Resources

- Firebase pricing: https://firebase.google.com/pricing
