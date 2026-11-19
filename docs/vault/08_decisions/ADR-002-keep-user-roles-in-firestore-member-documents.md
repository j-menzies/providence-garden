---
title: "ADR-002: Keep user roles in Firestore member documents"
type: "adr"
status: "draft"
phase: "08_decisions"
tags: ["firebase", "auth", "roles", "security"]
related: ["ADR-001-use-native-firebase-with-security-rules-as-the-enforcement-point.md"]
adr_id: "ADR-002"
adr_status: "accepted"
deciders: ["29292945+j-menzies@users.noreply.github.com"]
decision_date: "2026-11-04"
affects: []
platinum_lock: "none"
export_visibility: "internal"
created: "2026-11-05"
updated: "2026-11-05"
---

# ADR-002: Keep user roles in Firestore member documents

## Context and Problem Statement

The app has three roles:

- **Admin:** manages users and permissions, with full access.
- **Committee member:** captures and edits records, and reads committee-only data.
- **Observer:** anyone, with no account, reading only what has been published.

The security rules ([ADR-001](ADR-001-use-native-firebase-with-security-rules-as-the-enforcement-point.md)) need to know each signed-in user's role. The role can be held as a Firebase Auth custom claim on the user's token, or in a Firestore document the rules look up. Admins must be able to invite, change and remove users from within the app.

## Decision Drivers

- No server code (ADR-001).
- Removing someone's access should take effect at once.
- Admins need a list of members in the app.
- Both Firestore and Cloud Storage rules need the role.
- Low maintenance for a volunteer project.

## Options Considered

### Option 1: Role in a Firestore `members/{uid}` document

**Description:** Each user with a role has a `members/{uid}` document holding `role: admin | committee`. Firestore rules read it with `get()`; Storage rules read it with a cross-service Firestore lookup.

**Advantages:**
- No server code: admins edit member documents through the app, under the rules.
- Changes take effect on the next request.
- Listing members is an ordinary query.

**Disadvantages:**
- One extra document read each time the rules check a role, including one per photo upload.
- Rules must guard the `members` collection carefully, as it grants access.

**Assessment:** Simplest option that meets every driver; the extra reads are well within the free allowance.

### Option 2: Role in Auth custom claims

**Description:** The role is a custom claim on the user's ID token, set with the Admin SDK by a callable Cloud Function.

**Advantages:**
- Rules read the role straight from the token, with no extra read.
- Storage rules need no cross-service lookup.

**Disadvantages:**
- Needs a Cloud Function, the only server code in the system, with its own deploys, tests and runtime upgrades.
- Changes only reach a user when their token refreshes, up to an hour, unless sessions are also revoked with more server code.
- Listing members needs the Admin SDK, so another function or a mirror document anyway.

**Assessment:** Fine for larger systems, but adds server code and slower revocation for a saving of pennies.

### Option 3: Hybrid, member documents mirrored into claims

**Description:** Admins edit `members` documents; a Firestore-triggered function copies the role into custom claims.

**Advantages:**
- Listing from documents, fast checks from claims.

**Disadvantages:**
- All the cost of Option 2's function, plus two copies of the truth that can disagree.

**Assessment:** Worth revisiting only if server code arrives for another reason.

## Decision Outcome

**Chosen option:** Option 1, roles in Firestore `members/{uid}` documents.

**Rationale:** It needs no server code, revocation is instant, and the admin screen is a normal query. The extra reads cost nothing at this scale.

### Implementation Details

- `members/{uid}`: `role` (`admin` or `committee`), plus email and display name for the admin screen.
- `invites/{email}`: `role`, created by an admin.
- Invitation flow:
  1. An admin creates the invite.
  2. The person signs in with Google or an email link, using that address.
  3. The app creates their `members/{uid}` document. The rules allow this only when the signed-in email is verified, an invite exists for it, and the role matches the invite.
  4. The app deletes the invite.
- Removal: an admin deletes the `members` document, after which the person sees only public data. Disabling the account is done in the Firebase console if needed.
- The first admin is created by hand in the console when Prod is set up. Keep at least two admins.
- Observers have no account and no member document.

## Consequences

### Positive

- No Cloud Functions needed.
- Removing access is immediate.
- Admins manage users entirely within the app.

### Negative

- One extra read per rules check that needs the role.
- Storage rules depend on a cross-service Firestore lookup.

### Risks and Mitigation

- A rules gap lets a user create or raise their own role: rules tests covering self-promotion, invite mismatch and unverified email.
- The committee is locked out if the only admin leaves: keep at least two admins, and document how to add one in the console.

## Related Decisions

- [ADR-001: Use native Firebase with security rules as the enforcement point](ADR-001-use-native-firebase-with-security-rules-as-the-enforcement-point.md)

## References

### Internal Documentation

- Architecture proposal, "Users, roles and authentication": https://claude.ai/artifact/HDKPv6WdkCtygWLjeii2xt

### External Resources

- Firebase custom claims: https://firebase.google.com/docs/auth/admin/custom-claims
- Firestore rules conditions: https://firebase.google.com/docs/firestore/security/rules-conditions
