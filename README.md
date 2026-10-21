# Providence Garden

Field capture prototype for the Providence Square gardens. A PWA for walking the garden with a phone: capture plants, services and wildlife features with photos and a rough GPS fix, then refine their positions on aerial imagery.

## What it does

- Aerial base map (Esri World Imagery) with layers for beds, plants, water, lighting, power, irrigation, wildlife and structures.
- Capture a point at your GPS position (accuracy shown live), or tap the map. Trace beds, planting groups, hedges and cable runs on the map.
- Rough GPS positions are marked with an amber ring until you drag them into place.
- Register seeded from the 2018 Garden Master Plan, plant schedule and tree list: beds, about 70 planting groups and the known trees, ready to place.
- Photo history and a log per feature (flowering, fruiting, condition, sightings, maintenance).
- Everything is stored on the device (IndexedDB). Back up to a zip (data.json shaped as Firestore collections, plus photos) and export GeoJSON.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173/providence-garden/
npm test           # Playwright end-to-end flow
```

Location and camera need HTTPS (or localhost).

## Data model

`src/model.ts`. Collections: `features`, `observations`, `photos`, `taxa`, `parties`. Geometry is GeoJSON. Plants are either specimens (points, individually tracked) or planting groups (polygons with species and quantity).

## Seed data

`scripts/extract_seed.py` turns the 2018 spreadsheets into `src/data/plantings2018.json`. `src/seed.ts` adds the beds, areas and trees named in the master plan.
