---
title: "ADR-003: Replace aerial imagery with a vector base map and a data-first UI"
type: "adr"
status: "draft"
phase: "08_decisions"
tags: ["maps", "ui", "maplibre"]
related: ["ADR-001-use-native-firebase-with-security-rules-as-the-enforcement-point.md"]
adr_id: "ADR-003"
adr_status: "accepted"
deciders: ["29292945+j-menzies@users.noreply.github.com"]
decision_date: "2026-11-04"
affects: []
platinum_lock: "none"
export_visibility: "internal"
created: "2026-11-05"
updated: "2026-11-05"
---

# ADR-003: Replace aerial imagery with a vector base map and a data-first UI

## Context and Problem Statement

The prototype is driven by a map built on Esri World Imagery. The imagery leans: it is a standard orthophoto, corrected to ground level only, so the tall buildings around the courtyard garden lean over its edges. A straight-down view would be far more useful.

The Esri tiles are also loaded with no API key. Esri's guidance is that the service needs an ArcGIS licence, which matters once the app is shared.

Separately, the app needs to pivot from map-first to data-first: records, lists and what is happening in the garden, with the map as one view.

## Decision Drivers

- A view of the garden that is useful for placing and finding things.
- No licence or cost exposure from imagery.
- Works offline once used.
- Simple for volunteers to maintain.
- Records, not the map, are what most users come for.

## Options Considered

### Option 1: Vector base map plus the garden's own drawn plan

**Description:** OpenFreeMap vector tiles (OpenStreetMap data) as a plain base map, rendered by MapLibre GL. The garden's own records (beds, lawns, paths, water, trees) are drawn on top as a styled plan.

**Advantages:**
- Free, with no key or licence.
- The garden plan is our own data, so it is accurate, current and already offline through Firestore.
- MapLibre is already in the prototype, and OpenFreeMap is a style URL change.

**Disadvantages:**
- No photographic view.
- Paths and hard landscaping need tracing once.
- OpenFreeMap is donation-funded, with no service guarantee.

**Assessment:** Gives a clearer, more useful map than the imagery, at no cost.

### Option 2: A different satellite or aerial provider (Mapbox, Google)

**Description:** Swap Esri for another commercial imagery service.

**Advantages:**
- Photographic view kept.

**Disadvantages:**
- These are also standard orthophotos, so the lean remains.
- Adds an account, a key and metered pricing.

**Assessment:** Costs money and adds a licence without fixing the problem.

### Option 3: Commercial true orthophotos

**Description:** Imagery corrected for building height, so it is genuinely top-down.

**Advantages:**
- Solves the lean.

**Disadvantages:**
- Priced for councils and enterprises, not volunteer groups.

**Assessment:** Out of reach for this project.

## Decision Outcome

**Chosen option:** Option 1, an OpenFreeMap vector base map via MapLibre GL, with the garden's own records drawn as the main map, inside a data-first UI.

**Rationale:** The lean cannot be fixed by changing provider, and the garden's own plan is the more useful map anyway. It is free, offline-friendly and keeps the existing MapLibre code.

### Implementation Details

Map layers, bottom to top:

1. **Base map:** OpenFreeMap vector style.
2. **Garden plan:** beds, lawns, paths, water and trees from the app's records, drawn as a styled plan.
3. **Drone photo (optional, later):** see below.
4. **Records:** plants, services, wildlife features and rough positions.

Offline and fallback:

- The service worker caches OpenFreeMap tiles that have been viewed, as the prototype does today for Esri tiles.
- If OpenFreeMap proves unreliable, or the map must work offline on first use, switch to a small self-hosted PMTiles extract of the local area on Firebase Hosting. The base map style is one config value.

Drone photo:

- An orthomosaic of the garden can be added later as an image overlay stored in Cloud Storage, possibly as an admin upload.
- A survey may already exist, but the work does not wait on it.

Data-first UI:

- **What's happening now:** the public home page, covering flowering, jobs due and recent log entries.
- **Garden:** areas and beds, drilling down to what grows in each.
- **Register:** every item, searchable and filterable.
- **Item page:** details, photos, log and a small map.
- **Calendar and log.**
- **Map:** the plan view, for placing and finding things on site.

## Consequences

### Positive

- No imagery cost or licence exposure.
- The map shows the garden as recorded, without building lean.
- The garden plan works offline through Firestore.

### Negative

- No photographic context until a drone photo is added.
- Paths and hard landscaping need tracing once.
- Navigation and screens need significant rework for the data-first UI.

### Risks and Mitigation

- OpenFreeMap changes or stops: fall back to a self-hosted extract.
- Committee members miss the aerial view for orientation: the drone overlay is the planned answer.

## Related Decisions

- [ADR-001: Use native Firebase with security rules as the enforcement point](ADR-001-use-native-firebase-with-security-rules-as-the-enforcement-point.md)

## References

### Internal Documentation

- Architecture proposal, "Maps and the data-first UI": https://claude.ai/artifact/HDKPv6WdkCtygWLjeii2xt

### External Resources

- OpenFreeMap: https://github.com/hyperknot/openfreemap
- MapLibre GL JS: https://maplibre.org/
- True versus traditional orthophotos (Esri): https://www.esri.com/arcgis-blog/products/arcgisrealitystudio/mapping/true-orthophotos-vs-traditional-orthophotos-why-do-pixels-matter-in-the-age-of-ai
- Esri community, World Imagery licensing: https://community.esri.com/t5/arcgis-location-platform-developers-ques/inquiry-about-world-imagery/m-p/1569441
