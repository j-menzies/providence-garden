import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapView, HOME, type MapMode } from './MapView';
import { LAYERS, TYPES, typeOf } from './catalogue';
import { deleteFeature, ensureSeeded, ensureStartPositions, getMeta, loadAll, newId, putFeature, putObservation, putPhoto, putTaxon } from './db';
import { centre, inArea, isArea, measure, openParts, pointInPolygon, preparePhoto, shape, vertices, watchFix, type Fix } from './geo';
import { buildBackup, deliverFile, restoreBackup, toGeoJSON } from './backup';
import type { Feature, Geometry, Observation, ObservationKind, Party, Taxon } from './model';
import { MoreMenu, OBS_KINDS, PhotoViewer, StatusChip, TaxonPicker, Thumb, fmtDate, obsLabel, useMedia } from './components';
import { ItemsReport } from './Reports';

/** 'reports' fills the screen; the rest open in the side sheet. */
type Panel = null | 'layers' | 'register' | 'entry' | 'reports' | 'menu' | 'new' | 'capture' | 'feature';

/** What screen readers announce for each panel. */
const PANEL_LABEL: Record<Exclude<Panel, null>, string> = { layers: 'Layers', register: 'Register', entry: 'New register entry', reports: 'Items report', menu: 'Your data', new: 'What are you capturing?', capture: 'Capture', feature: 'Item' };

/** When panels sit at the side instead of the bottom. Keep in step with styles.css. */
const SIDE_SHEET = '(min-width: 900px), (orientation: landscape) and (max-height: 500px)';

interface Capture {
  /** Existing feature being placed, or undefined for a new one. */
  featureId?: string;
  typeId: string;
  name: string;
  taxonId?: string;
  quantity?: number;
  notes: string;
  photos: { blob: Blob; thumb: Blob; width: number; height: number; url: string }[];
  /** Geometry drawn or tapped on the map. Points without this use the GPS fix. */
  geometry: Geometry | null;
}

type Pt = [number, number];

/** A finished ring of an area being drawn: an outer edge, or a hole in the piece numbered `hole`. */
interface DraftRing {
  ring: Pt[];
  hole?: number;
}

/** Groups finished rings into pieces, each an outer edge followed by its holes. */
function toParts(rings: DraftRing[]): Pt[][][] {
  const parts: Pt[][][] = [];
  for (const r of rings) {
    if (r.hole === undefined) parts.push([r.ring]);
    else parts[r.hole].push(r.ring);
  }
  return parts;
}

/** Adds a ring as a new piece, or as a hole in whichever piece it sits inside. Null if a hole sits in none. */
function addRing(rings: DraftRing[], ring: Pt[], kind: 'part' | 'hole'): DraftRing[] | null {
  if (kind === 'part') return [...rings, { ring }];
  const hole = toParts(rings).findIndex((part) => ring.every((pt) => pointInPolygon(pt, part[0])));
  return hole < 0 ? null : [...rings, { ring, hole }];
}


export default function App() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [taxa, setTaxa] = useState<Taxon[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [panel, setPanel] = useState<Panel>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<MapMode>('browse');
  const [draft, setDraft] = useState<[number, number][]>([]);
  /** Finished rings of an area being drawn, in the order they were traced. */
  const [draftRings, setDraftRings] = useState<DraftRing[]>([]);
  /** Whether the ring being traced starts another piece of the area or is a hole in one. */
  const [nextRing, setNextRing] = useState<'part' | 'hole'>('part');
  const draftParts = useMemo(() => toParts((draft.length >= 3 && addRing(draftRings, draft, nextRing)) || draftRings), [draftRings, draft, nextRing]);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [editGeometry, setEditGeometry] = useState<Geometry | null>(null);

  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(() => new Set(LAYERS.map((l) => l.id)));
  const [aerial, setAerial] = useState(true);
  const [aerialOpacity, setAerialOpacity] = useState(1);
  const [flyTo, setFlyTo] = useState<{ centre: [number, number]; zoom?: number; seq: number } | null>(null);

  const [gpsWanted, setGpsWanted] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  // On phones panels are a bottom sheet the grip drags between three heights. The height is kept
  // while tapping from item to item, so a sheet pulled down to peek stays out of the map's way.
  const stageRef = useRef<HTMLElement>(null);
  const [stageH, setStageH] = useState(0);
  useEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => setStageH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const side = useMedia(SIDE_SHEET);
  const [sheetSnap, setSheetSnap] = useState<'peek' | 'half' | 'full'>('half');
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const skipGripClick = useRef(false);
  useEffect(() => {
    if (!panel) setSheetSnap('half');
  }, [panel]);
  const snaps = { peek: Math.min(150, stageH * 0.3), half: Math.round(stageH * 0.6), full: stageH - 12 };
  const sheetOpen = panel !== null && panel !== 'reports';
  const sheetH = dragH ?? snaps[sheetSnap];
  const panelInset = useMemo(
    () => ({ bottom: sheetOpen && !side ? Math.round(Math.min(snaps[sheetSnap], stageH * 0.7)) : 0, right: sheetOpen && side ? Math.round(Math.min(400, window.innerWidth * 0.45)) : 0 }),
    [sheetOpen, side, sheetSnap, stageH],
  );

  const reload = useCallback(async () => {
    const d = await loadAll();
    setFeatures(d.features);
    setObservations(d.observations);
    setTaxa(d.taxa);
    setParties(d.parties);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await navigator.storage?.persist?.();
      } catch {
        /* not supported */
      }
      await ensureSeeded();
      await ensureStartPositions();
      await reload();
      setLoaded(true);
    })();
  }, [reload]);

  // GPS runs while capturing or when the user asks to see their position.
  const gpsActive = gpsWanted || panel === 'capture' || mode === 'draw' || mode === 'place';
  useEffect(() => {
    if (!gpsActive) {
      setFix(null);
      return;
    }
    setGpsError(null);
    return watchFix(
      (f) => {
        setFix(f);
        setGpsError(null);
      },
      setGpsError,
    );
  }, [gpsActive]);

  // Capturing a point by GPS: centre the map on you once, so you can see where it will be saved.
  const centredOnFix = useRef(false);
  useEffect(() => {
    const byGps = panel === 'capture' && capture && !capture.geometry && typeOf(capture.typeId).geometry === 'point';
    if (!byGps) centredOnFix.current = false;
    else if (fix && !centredOnFix.current) {
      centredOnFix.current = true;
      fly([fix.lng, fix.lat]);
    }
  }, [panel, capture, fix]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  };
  const fly = (c: [number, number], zoom?: number) => setFlyTo({ centre: c, zoom, seq: Date.now() });

  const byId = useMemo(() => Object.fromEntries(features.map((f) => [f.id, f])), [features]);
  const taxonById = useMemo(() => Object.fromEntries(taxa.map((t) => [t.id, t])), [taxa]);
  const selected = selectedId ? byId[selectedId] : undefined;
  const beds = useMemo(() => features.filter((f) => f.type === 'bed' || f.type === 'water-body').sort((a, b) => a.name.localeCompare(b.name)), [features]);
  const unplaced = features.filter((f) => f.positionStatus === 'unplaced');

  async function saveFeature(f: Feature) {
    await putFeature(f);
    setFeatures((all) => {
      const i = all.findIndex((x) => x.id === f.id);
      const next = [...all];
      if (i >= 0) next[i] = f;
      else next.push(f);
      return next;
    });
  }

  async function createTaxon(name: string) {
    const t: Taxon = { id: `taxon-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, genus: name.split(' ')[0] };
    await putTaxon(t);
    setTaxa((all) => [...all.filter((x) => x.id !== t.id), t].sort((a, b) => a.name.localeCompare(b.name)));
    return t.id;
  }

  /** Smallest bed or water body that contains a point. */
  function containingArea(pt: [number, number], exclude?: string) {
    let best: Feature | undefined;
    let bestSize = Infinity;
    for (const b of beds) {
      if (b.id === exclude || !isArea(b.geometry) || !inArea(pt, b.geometry)) continue;
      const pts = vertices(b.geometry);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const size = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      if (size < bestSize) {
        best = b;
        bestSize = size;
      }
    }
    return best?.id;
  }

  // ---------- capture flows ----------

  function beginCapture(typeId: string, existing?: Feature) {
    const t = typeOf(typeId);
    setSelectedId(existing?.id ?? null);
    setCapture({ featureId: existing?.id, typeId, name: existing?.name ?? '', taxonId: existing?.taxonId, quantity: existing?.quantity, notes: '', photos: [], geometry: null });
    setDraft([]);
    setDraftRings([]);
    setNextRing('part');
    if (t.geometry === 'point') {
      setMode('browse');
      setPanel('capture');
    } else {
      setMode('draw');
      setPanel(null);
    }
    if (existing?.parentId) {
      const parent = byId[existing.parentId];
      if (parent?.geometry) fly(centre(parent.geometry));
    }
  }

  /** Add to an area already on the map: a hole, such as the island in the moat, or another separate piece. */
  function extendArea(f: Feature, kind: 'part' | 'hole') {
    if (!isArea(f.geometry)) return;
    beginCapture(f.type, f);
    setDraftRings(openParts(f.geometry).flatMap((rings, i) => rings.map((ring, j) => (j ? { ring, hole: i } : { ring }))));
    setNextRing(kind);
    fly(centre(f.geometry));
  }

  function cancelCapture() {
    capture?.photos.forEach((p) => URL.revokeObjectURL(p.url));
    const back = capture?.featureId;
    setCapture(null);
    setDraft([]);
    setDraftRings([]);
    setMode('browse');
    setPanel(back ? 'feature' : null);
  }

  function onMapTap(pt: [number, number]) {
    if (mode === 'draw') setDraft((d) => [...d, pt]);
    if (mode === 'place' && capture) {
      setDraft([pt]);
      setCapture({ ...capture, geometry: { type: 'Point', coordinates: pt } });
      setMode('browse');
      setPanel('capture');
    }
  }

  /** The finished rings plus the one being traced, or null (with a message) for a hole outside the area. */
  function ringsWithDraft() {
    if (draft.length < 3) return draftRings;
    const rings = addRing(draftRings, draft, nextRing);
    if (!rings) flash('A hole has to be inside the outer edge.');
    return rings;
  }

  /** Close the ring being traced and start the next one: a hole, or another separate piece. */
  function startRing(kind: 'part' | 'hole') {
    const rings = ringsWithDraft();
    if (!rings) return;
    setDraftRings(rings);
    setDraft([]);
    setNextRing(kind);
  }

  function undoPoint() {
    const last = draftRings[draftRings.length - 1];
    if (draft.length || !last) return setDraft((d) => d.slice(0, -1));
    // With nothing in the current ring, step back into the last finished one.
    setDraft(last.ring);
    setNextRing(last.hole === undefined ? 'part' : 'hole');
    setDraftRings(draftRings.slice(0, -1));
  }

  function finishDrawing() {
    if (!capture) return;
    const kind = typeOf(capture.typeId).geometry;
    const rings = kind === 'polygon' ? ringsWithDraft() : null;
    if (kind === 'polygon' && !rings) return;
    const g: Geometry = rings ? shape(toParts(rings)) : { type: 'LineString', coordinates: draft };
    setCapture({ ...capture, geometry: g });
    setMode('browse');
    setPanel('capture');
  }

  async function addCapturePhotos(files: FileList | null) {
    if (!files || !capture) return;
    const added: Capture['photos'] = [];
    for (const f of Array.from(files)) {
      try {
        const p = await preparePhoto(f);
        added.push({ ...p, url: URL.createObjectURL(p.thumb) });
      } catch {
        flash('That file could not be read as a photo.');
      }
    }
    setCapture((c) => (c ? { ...c, photos: [...c.photos, ...added] } : c));
  }

  async function saveCapture() {
    if (!capture) return;
    const t = typeOf(capture.typeId);
    let geometry = capture.geometry;
    let status: Feature['positionStatus'] = 'refined';
    let gpsAccuracy: number | undefined;
    if (!geometry) {
      if (!fix) return;
      geometry = { type: 'Point', coordinates: [fix.lng, fix.lat] };
      status = 'rough';
      gpsAccuracy = fix.accuracy;
    }
    const now = new Date().toISOString();
    const existing = capture.featureId ? byId[capture.featureId] : undefined;
    const taxonName = capture.taxonId ? taxonById[capture.taxonId]?.name : undefined;
    const f: Feature = {
      ...(existing ?? { id: newId(t.id), createdAt: now, source: 'Field capture' }),
      type: capture.typeId,
      name: capture.name.trim() || existing?.name || taxonName || t.label,
      taxonId: capture.taxonId,
      quantity: capture.quantity,
      geometry,
      positionStatus: status,
      gpsAccuracy,
      updatedAt: now,
    } as Feature;
    if (!f.parentId && f.type !== 'bed' && f.type !== 'water-body') f.parentId = containingArea(centre(geometry), f.id);
    if (capture.notes.trim()) f.notes = [existing?.notes, capture.notes.trim()].filter(Boolean).join('\n');
    await saveFeature(f);
    if (capture.photos.length) {
      const ids: string[] = [];
      for (const p of capture.photos) {
        const id = newId('photo');
        await putPhoto({ id, blob: p.blob, thumb: p.thumb, width: p.width, height: p.height, takenAt: now });
        ids.push(id);
        URL.revokeObjectURL(p.url);
      }
      const o: Observation = { id: newId('obs'), featureId: f.id, kind: 'photo', at: now, photoIds: ids, location: fix ? { lng: fix.lng, lat: fix.lat, accuracy: fix.accuracy } : undefined };
      await putObservation(o);
      setObservations((all) => [...all, o]);
    }
    setCapture(null);
    setDraft([]);
    setDraftRings([]);
    setMode('browse');
    setSelectedId(f.id);
    setPanel('feature');
    fly(centre(geometry));
    flash(status === 'rough' ? `Saved at a rough position (±${Math.round(gpsAccuracy!)}m). Refine it on the map when you can.` : 'Saved.');
  }

  /** Adds an entry to the register without placing it, then opens it. */
  async function addEntry(f: Feature) {
    await saveFeature(f);
    setSelectedId(f.id);
    setPanel('feature');
    flash('Added to the register.');
  }

  // ---------- refine ----------

  function beginRefine(f: Feature) {
    if (!f.geometry) return;
    setSelectedId(f.id);
    setEditGeometry(f.geometry);
    setMode('edit');
    setPanel(null);
    fly(centre(f.geometry), 20);
  }

  async function finishRefine() {
    if (!selected || !editGeometry) return;
    const geometry = isArea(editGeometry) ? shape(openParts(editGeometry)) : editGeometry;
    const f: Feature = { ...selected, geometry, positionStatus: 'refined', gpsAccuracy: undefined };
    if (f.type !== 'bed' && f.type !== 'water-body') f.parentId = containingArea(centre(geometry), f.id) ?? f.parentId;
    await saveFeature(f);
    setEditGeometry(null);
    setMode('browse');
    setPanel('feature');
    flash('Position updated.');
  }

  // ---------- selection ----------

  function select(id: string | null) {
    setSelectedId(id);
    setPanel(id ? 'feature' : panel === 'feature' ? null : panel);
  }

  function openFeature(f: Feature) {
    setSelectedId(f.id);
    setPanel('feature');
    if (f.geometry) fly(centre(f.geometry), f.geometry.type === 'Point' ? 20 : undefined);
  }

  // ---------- panel sheet ----------

  function closePanel() {
    if (panel === 'capture') return cancelCapture();
    if (panel === 'feature') setSelectedId(null);
    setPanel(null);
  }

  function gripDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: sheetH, moved: false };
  }

  function gripMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.y) > 6) d.moved = true;
    if (d.moved) setDragH(Math.max(48, Math.min(snaps.full, d.h + d.y - e.clientY)));
  }

  function gripUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    skipGripClick.current = true;
    const h = Math.max(48, Math.min(snaps.full, d.h + d.y - e.clientY));
    setDragH(null);
    // Pulled well below the peek height: close, except mid-capture, where that would lose the entry.
    if (h < snaps.peek * 0.6 && panel !== 'capture') return closePanel();
    setSheetSnap((['peek', 'half', 'full'] as const).reduce((a, b) => (Math.abs(snaps[b] - h) < Math.abs(snaps[a] - h) ? b : a)));
  }

  useEffect(() => {
    // Escape closes the open panel. Not mid-capture, where it would throw away the entry.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !viewPhoto && panel && panel !== 'capture' && closePanel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- render ----------

  const drawType = capture ? typeOf(capture.typeId) : null;
  const drawingHole = nextRing === 'hole';
  const nextPiece = nextRing === 'part' && draftRings.length > 0;
  // An area's ring is done at three corners. An empty ring after Add a hole or Add a part can be dropped.
  const ringDone = draft.length >= 3 || (!draft.length && draftRings.length > 0);
  const canFinish = drawType?.geometry === 'polygon' ? ringDone : draft.length >= 2;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Providence Garden</span>
          <span className="brand-sub">Field register</span>
        </div>
        <nav className="topnav" aria-label="Main">
          <button type="button" className={`nav-btn ${panel === 'register' ? 'on' : ''}`} onClick={() => setPanel(panel === 'register' ? null : 'register')}>
            Register
            {unplaced.length ? <span className="badge" aria-label={`${unplaced.length} not yet on the map`}>{unplaced.length}</span> : null}
          </button>
          <button type="button" className={`nav-btn ${panel === 'reports' ? 'on' : ''}`} onClick={() => setPanel(panel === 'reports' ? null : 'reports')}>
            Reports
          </button>
          <button type="button" className={`nav-btn ${panel === 'layers' ? 'on' : ''}`} onClick={() => setPanel(panel === 'layers' ? null : 'layers')}>
            Layers
          </button>
          <button type="button" className={`nav-btn ${panel === 'menu' ? 'on' : ''}`} onClick={() => setPanel(panel === 'menu' ? null : 'menu')}>
            Data
          </button>
        </nav>
      </header>

      <main className="stage" ref={stageRef}>
        <MapView
          features={features}
          visibleLayers={visibleLayers}
          aerial={aerial}
          aerialOpacity={aerialOpacity}
          selectedId={selectedId}
          mode={mode}
          draft={draft}
          draftParts={draftParts}
          draftKind={drawType?.geometry ?? 'point'}
          editGeometry={editGeometry}
          userFix={fix}
          flyTo={flyTo}
          panelInset={panelInset}
          onSelect={select}
          onMapTap={onMapTap}
          onEditChange={setEditGeometry}
        />

        {mode === 'browse' && !panel ? (
          <div className="map-actions">
            <button
              type="button"
              className="round-btn"
              aria-label={gpsWanted ? 'Stop showing my position' : 'Show my position'}
              aria-pressed={gpsWanted}
              onClick={() => {
                if (!gpsWanted && fix) fly([fix.lng, fix.lat]);
                setGpsWanted(!gpsWanted);
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <circle cx="12" cy="12" r="4" fill="currentColor" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button type="button" className="round-btn" aria-label="Back to the garden" onClick={() => fly(HOME, 17.6)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" fill="currentColor" />
              </svg>
            </button>
            <button type="button" className="fab" onClick={() => setPanel('new')}>
              <span aria-hidden="true">+</span> Capture
            </button>
          </div>
        ) : null}

        {gpsWanted && mode === 'browse' && !panel ? <div className="gps-pill">{gpsError ?? (fix ? `GPS ±${Math.round(fix.accuracy)}m` : 'Finding you…')}</div> : null}

        {mode === 'draw' && drawType ? (
          <div className="toolbar" role="toolbar" aria-label="Drawing">
            <div className="toolbar-text">
              <strong>
                {drawingHole ? 'Hole in ' : nextPiece ? 'Another part of ' : capture?.featureId ? 'Place ' : 'New '}
                {capture?.featureId ? byId[capture.featureId]?.name : `${drawingHole || nextPiece ? 'the new ' : ''}${drawType.label.toLowerCase()}`}
              </strong>
              <span>
                {drawingHole ? 'Tap round the hole, such as an island' : nextPiece ? 'Tap round the next part' : drawType.hint ?? 'Tap each corner on the map'}. {draft.length} point{draft.length === 1 ? '' : 's'}.
              </span>
            </div>
            <div className="toolbar-btns">
              <button type="button" className="btn btn-quiet" onClick={cancelCapture}>
                Cancel
              </button>
              <button type="button" className="btn" disabled={!draft.length && !draftRings.length} onClick={undoPoint}>
                Undo
              </button>
              <MoreMenu
                label="More drawing options"
                items={[
                  {
                    label: fix ? `Add my position (GPS ±${Math.round(fix.accuracy)}m)` : `Add my position (${gpsError ? 'no GPS' : 'waiting for GPS'})`,
                    disabled: !fix,
                    onSelect: () => fix && setDraft((d) => [...d, [fix.lng, fix.lat]]),
                  },
                  ...(drawType.geometry === 'polygon'
                    ? [
                        { label: 'Add a hole', disabled: !ringDone, onSelect: () => startRing('hole') },
                        { label: 'Add a part', disabled: !ringDone, onSelect: () => startRing('part') },
                      ]
                    : []),
                ]}
              />
              <button type="button" className="btn btn-primary" disabled={!canFinish} onClick={finishDrawing}>
                Done
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'place' ? (
          <div className="toolbar" role="toolbar" aria-label="Placing">
            <div className="toolbar-text">
              <strong>Tap where it is on the map</strong>
              <span className="muted small">Zoom in on the aerial for a precise spot.</span>
            </div>
            <div className="toolbar-btns">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setMode('browse');
                  setPanel('capture');
                }}
              >
                Back
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'edit' && selected ? (
          <div className="toolbar" role="toolbar" aria-label="Refining">
            <div className="toolbar-text">
              <strong>Refine {selected.name}</strong>
              <span>{selected.geometry?.type === 'Point' ? 'Drag the marker to where it really is.' : 'Drag the corners to fit the edge.'}</span>
            </div>
            <div className="toolbar-btns">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setEditGeometry(null);
                  setMode('browse');
                  setPanel('feature');
                }}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={finishRefine}>
                Save position
              </button>
            </div>
          </div>
        ) : null}

        {panel === 'reports' ? <ItemsReport features={features} observations={observations} taxa={taxonById} onOpen={openFeature} onClose={() => setPanel(null)} /> : null}

        {panel && panel !== 'reports' ? (
          <aside
            className={`sheet ${dragH !== null ? 'dragging' : ''}`}
            aria-label={panel === 'feature' ? selected?.name ?? PANEL_LABEL.feature : PANEL_LABEL[panel]}
            style={side || !stageH ? undefined : { ['--sheet-h' as string]: `${sheetH}px` }}
            key={`${panel}-${panel === 'feature' ? selectedId : ''}`}
          >
            <button
              type="button"
              className="sheet-grip"
              aria-label={sheetSnap === 'full' ? 'Make the panel smaller' : 'Make the panel bigger'}
              onPointerDown={gripDown}
              onPointerMove={gripMove}
              onPointerUp={gripUp}
              onPointerCancel={() => {
                drag.current = null;
                setDragH(null);
              }}
              onClick={() => {
                if (skipGripClick.current) skipGripClick.current = false;
                else setSheetSnap((s) => (s === 'half' ? 'full' : 'half'));
              }}
            />
            <div className="sheet-body">
            {panel === 'new' ? <NewPanel onPick={(id) => beginCapture(id)} onClose={() => setPanel(null)} /> : null}

            {panel === 'capture' && capture ? (
              <CapturePanel
                capture={capture}
                setCapture={setCapture}
                existing={capture.featureId ? byId[capture.featureId] : undefined}
                fix={fix}
                gpsError={gpsError}
                taxa={taxa}
                onCreateTaxon={async (n) => {
                  const id = await createTaxon(n);
                  setCapture((c) => (c ? { ...c, taxonId: id } : c));
                }}
                onPhotos={addCapturePhotos}
                onTapMap={() => {
                  setMode('place');
                  setPanel(null);
                }}
                onRedraw={() => {
                  setCapture({ ...capture, geometry: null });
                  setMode('draw');
                  setPanel(null);
                }}
                onCancel={cancelCapture}
                onSave={saveCapture}
              />
            ) : null}

            {panel === 'feature' && selected ? (
              <FeaturePanel
                key={selected.id}
                feature={selected}
                parent={selected.parentId ? byId[selected.parentId] : undefined}
                children={features.filter((f) => f.parentId === selected.id)}
                beds={beds}
                taxa={taxa}
                observations={observations.filter((o) => o.featureId === selected.id).sort((a, b) => b.at.localeCompare(a.at))}
                fix={fix}
                onChange={saveFeature}
                onCreateTaxon={createTaxon}
                onPlace={() => beginCapture(selected.type, selected)}
                onRefine={() => beginRefine(selected)}
                onRedraw={() => beginCapture(selected.type, selected)}
                onAddHole={() => extendArea(selected, 'hole')}
                onAddPart={() => extendArea(selected, 'part')}
                onOpenFeature={openFeature}
                onAddObservation={async (o) => {
                  await putObservation(o);
                  setObservations((all) => [...all, o]);
                }}
                onPhoto={setViewPhoto}
                onDelete={async () => {
                  await deleteFeature(selected.id);
                  setFeatures((all) => all.filter((f) => f.id !== selected.id));
                  setObservations((all) => all.filter((o) => o.featureId !== selected.id));
                  setSelectedId(null);
                  setPanel(null);
                  flash('Deleted.');
                }}
                onClose={() => {
                  setSelectedId(null);
                  setPanel(null);
                }}
                flash={flash}
              />
            ) : null}

            {panel === 'register' ? <RegisterPanel features={features} byId={byId} taxa={taxonById} onOpen={openFeature} onNew={() => setPanel('entry')} onClose={() => setPanel(null)} /> : null}
            {panel === 'entry' ? <EntryPanel taxa={taxa} beds={beds} onCreateTaxon={createTaxon} onSave={addEntry} onCancel={() => setPanel('register')} /> : null}

            {panel === 'layers' ? (
              <LayersPanel
                features={features}
                visible={visibleLayers}
                setVisible={setVisibleLayers}
                aerial={aerial}
                setAerial={setAerial}
                opacity={aerialOpacity}
                setOpacity={setAerialOpacity}
                onClose={() => setPanel(null)}
              />
            ) : null}

            {panel === 'menu' ? <DataPanel features={features} observations={observations} taxa={taxa} parties={parties} onRestored={reload} flash={flash} onClose={() => setPanel(null)} /> : null}
            </div>
          </aside>
        ) : null}

        {!loaded ? <div className="loading">Loading the garden…</div> : null}
        {toast ? (
          <div className="toast" role="status">
            {toast}
          </div>
        ) : null}
        {viewPhoto ? <PhotoViewer id={viewPhoto} onClose={() => setViewPhoto(null)} /> : null}
      </main>
    </div>
  );
}

// ---------------- panels ----------------

function PanelHead({ title, sub, onClose }: { title: string; sub?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        {sub ? <div className="panel-sub">{sub}</div> : null}
      </div>
      <button type="button" className="close" onClick={onClose} aria-label="Close panel">
        ×
      </button>
    </div>
  );
}

function NewPanel({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="panel">
      <PanelHead title="What are you capturing?" sub="Points use your GPS. Areas and lines are traced on the map." onClose={onClose} />
      {LAYERS.map((l) => (
        <section key={l.id} className="type-group">
          <h3>{l.label}</h3>
          <div className="type-grid">
            {TYPES.filter((t) => t.layer === l.id).map((t) => (
              <button type="button" key={t.id} className="type-btn" onClick={() => onPick(t.id)}>
                <span className={`swatch swatch-${t.geometry}`} style={{ ['--c' as string]: t.colour }} aria-hidden="true" />
                {t.label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CapturePanel(p: {
  capture: Capture;
  setCapture: React.Dispatch<React.SetStateAction<Capture | null>>;
  existing?: Feature;
  fix: Fix | null;
  gpsError: string | null;
  taxa: Taxon[];
  onCreateTaxon: (name: string) => void;
  onPhotos: (f: FileList | null) => void;
  onTapMap: () => void;
  onRedraw: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { capture: c, fix } = p;
  const t = typeOf(c.typeId);
  const set = (patch: Partial<Capture>) => p.setCapture((cur) => (cur ? { ...cur, ...patch } : cur));
  const fileRef = useRef<HTMLInputElement>(null);
  const isPoint = t.geometry === 'point';
  const canSave = c.geometry || (isPoint && fix);
  return (
    <div className="panel">
      <PanelHead title={p.existing ? `Place ${p.existing.name}` : `New ${t.label.toLowerCase()}`} sub={p.existing?.source} onClose={p.onCancel} />

      <section className="field">
        <span className="label">Position</span>
        {c.geometry ? (
          <div className="pos-box">
            <span>
              {c.geometry.type === 'Point' ? 'Placed on the map' : `Traced on the map, ${measure(c.geometry)}`}
              {c.geometry.type === 'MultiPolygon' ? ` in ${c.geometry.coordinates.length} parts` : ''}
            </span>
            <button type="button" className="btn btn-quiet" onClick={isPoint ? p.onTapMap : p.onRedraw}>
              {isPoint ? 'Move' : 'Redraw'}
            </button>
          </div>
        ) : (
          <div className="pos-box">
            <span className={`gps ${fix ? (fix.accuracy <= 8 ? 'good' : fix.accuracy <= 20 ? 'ok' : 'poor') : ''}`}>
              {fix ? `GPS ±${Math.round(fix.accuracy)}m` : p.gpsError ?? 'Waiting for GPS…'}
            </span>
            <button type="button" className="btn btn-quiet" onClick={p.onTapMap}>
              Tap the map instead
            </button>
          </div>
        )}
        {!c.geometry && isPoint ? <p className="hint">{t.hint ?? 'Stand next to it'}. The fix improves for about 20 seconds; save when the number stops falling.</p> : null}
      </section>

      <section className="field">
        <span className="label">Photos</span>
        <div className="thumbs">
          {c.photos.map((ph, i) => (
            <span className="thumb" key={i}>
              <img src={ph.url} alt="" />
            </span>
          ))}
          <button type="button" className="thumb thumb-add" onClick={() => fileRef.current?.click()}>
            + Photo
          </button>
        </div>
        <input
          ref={fileRef}
          id="capture-photo"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            p.onPhotos(e.target.files);
            e.target.value = '';
          }}
        />
      </section>

      {t.plant ? (
        <section className="field">
          <span className="label">Species</span>
          <TaxonPicker taxa={p.taxa} value={c.taxonId} onChange={(id) => set({ taxonId: id })} onCreate={p.onCreateTaxon} />
        </section>
      ) : null}

      <div className="field-row">
        <label className="field grow">
          <span className="label">Name</span>
          <input id="capture-name" value={c.name} placeholder={p.existing?.name ?? (t.plant ? 'Defaults to the species' : t.label)} onChange={(e) => set({ name: e.target.value })} />
        </label>
        {t.geometry === 'polygon' && t.plant ? (
          <label className="field qty">
            <span className="label">How many</span>
            <input id="capture-qty" type="number" inputMode="numeric" min={1} value={c.quantity ?? ''} onChange={(e) => set({ quantity: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
        ) : null}
      </div>

      <label className="field">
        <span className="label">Notes</span>
        <textarea id="capture-notes" rows={2} value={c.notes} placeholder="Condition, label details, anything useful" onChange={(e) => set({ notes: e.target.value })} />
      </label>

      <div className="panel-actions">
        <button type="button" className="btn btn-quiet" onClick={p.onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={p.onSave}>
          {c.geometry ? 'Save' : fix ? `Save here (±${Math.round(fix.accuracy)}m)` : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** A register entry that isn't on the map yet, such as a plant bought but not planted, or a bed from a plan. */
function EntryPanel(p: { taxa: Taxon[]; beds: Feature[]; onCreateTaxon: (name: string) => Promise<string>; onSave: (f: Feature) => void; onCancel: () => void }) {
  const [typeId, setTypeId] = useState('specimen');
  const [name, setName] = useState('');
  const [taxonId, setTaxonId] = useState<string | undefined>();
  const [quantity, setQuantity] = useState<number | undefined>();
  const [parentId, setParentId] = useState('');
  const [notes, setNotes] = useState('');
  const t = typeOf(typeId);
  const isArea = typeId === 'bed' || typeId === 'water-body';

  function save() {
    const now = new Date().toISOString();
    const taxonName = t.plant && taxonId ? p.taxa.find((x) => x.id === taxonId)?.name : undefined;
    p.onSave({
      id: newId(typeId),
      type: typeId,
      name: name.trim() || taxonName || t.label,
      taxonId: t.plant ? taxonId : undefined,
      quantity: t.plant && t.geometry === 'polygon' ? quantity : undefined,
      parentId: isArea ? undefined : parentId || undefined,
      notes: notes.trim() || undefined,
      geometry: null,
      positionStatus: 'unplaced',
      source: 'Added in the app',
      createdAt: now,
      updatedAt: now,
    });
  }

  return (
    <div className="panel">
      <PanelHead title="New register entry" sub="It goes in the register now; put it on the map whenever you're ready." onClose={p.onCancel} />
      <label className="field">
        <span className="label">What is it?</span>
        <select id="entry-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {LAYERS.map((l) => (
            <optgroup key={l.id} label={l.label}>
              {TYPES.filter((x) => x.layer === l.id).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {t.plant ? (
        <section className="field">
          <span className="label">Species</span>
          <TaxonPicker taxa={p.taxa} value={taxonId} onChange={setTaxonId} onCreate={async (n) => setTaxonId(await p.onCreateTaxon(n))} />
        </section>
      ) : null}
      <div className="field-row">
        <label className="field grow">
          <span className="label">Name</span>
          <input id="entry-name" value={name} placeholder={t.plant ? 'Defaults to the species' : t.label} onChange={(e) => setName(e.target.value)} />
        </label>
        {t.plant && t.geometry === 'polygon' ? (
          <label className="field qty">
            <span className="label">How many</span>
            <input id="entry-qty" type="number" inputMode="numeric" min={1} value={quantity ?? ''} onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : undefined)} />
          </label>
        ) : null}
      </div>
      {isArea ? null : (
        <label className="field">
          <span className="label">In</span>
          <select id="entry-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Not set</option>
            {p.beds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="label">Notes</span>
        <textarea id="entry-notes" rows={2} value={notes} placeholder="Where it is, supplier, anything useful" onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="panel-actions">
        <button type="button" className="btn btn-quiet" onClick={p.onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={save}>
          Add to register
        </button>
      </div>
    </div>
  );
}

function LogSection({ feature, observations, onAdd }: { feature: Feature; observations: Observation[]; onAdd: (o: Observation) => Promise<void> }) {
  const [kind, setKind] = useState<ObservationKind>('note');
  const [text, setText] = useState('');
  return (
    <section className="field">
      <span className="label">Log</span>
      <div className="obs-add">
        <select id="obs-kind" value={kind} onChange={(e) => setKind(e.target.value as ObservationKind)} aria-label="Kind of entry">
          {OBS_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <input id="obs-text" value={text} placeholder="What did you see?" onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          className="btn"
          disabled={!text.trim()}
          onClick={async () => {
            await onAdd({ id: newId('obs'), featureId: feature.id, kind, at: new Date().toISOString(), text: text.trim(), photoIds: [] });
            setText('');
          }}
        >
          Add
        </button>
      </div>
      {observations.length ? (
        <ol className="log">
          {observations.map((o) => (
            <li key={o.id}>
              <span className="log-date num">{fmtDate(o.at)}</span>
              <span className="log-kind">{obsLabel(o)}</span>
              {o.text ? <span className="log-text">{o.text}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">Nothing logged yet.</p>
      )}
    </section>
  );
}

function FeaturePanel(p: {
  feature: Feature;
  parent?: Feature;
  children: Feature[];
  beds: Feature[];
  taxa: Taxon[];
  observations: Observation[];
  fix: Fix | null;
  onChange: (f: Feature) => void;
  onCreateTaxon: (name: string) => Promise<string>;
  onPlace: () => void;
  onRefine: () => void;
  onRedraw: () => void;
  onAddHole: () => void;
  onAddPart: () => void;
  onOpenFeature: (f: Feature) => void;
  onAddObservation: (o: Observation) => Promise<void>;
  onPhoto: (id: string) => void;
  onDelete: () => void;
  onClose: () => void;
  flash: (m: string) => void;
}) {
  const f = p.feature;
  const t = typeOf(f.type);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Feature>) => {
    p.onChange({ ...f, ...patch, updatedAt: new Date().toISOString() });
    p.flash('Saved.');
  };
  const taxon = p.taxa.find((x) => x.id === f.taxonId);
  const photoIds = p.observations.flatMap((o) => o.photoIds);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const now = new Date().toISOString();
    const ids: string[] = [];
    for (const file of Array.from(files)) {
      const ph = await preparePhoto(file);
      const id = newId('photo');
      await putPhoto({ id, ...ph, takenAt: now });
      ids.push(id);
    }
    await p.onAddObservation({ id: newId('obs'), featureId: f.id, kind: 'photo', at: now, photoIds: ids, location: p.fix ? { lng: p.fix.lng, lat: p.fix.lat, accuracy: p.fix.accuracy } : undefined });
    p.flash(`${ids.length} photo${ids.length > 1 ? 's' : ''} added.`);
  }

  return (
    <div className="panel">
      <PanelHead
        title={f.name}
        sub={
          <>
            <span className="type-tag">
              <span className={`swatch swatch-${t.geometry}`} style={{ ['--c' as string]: t.colour }} aria-hidden="true" />
              {t.label}
            </span>
            <StatusChip status={f.positionStatus} accuracy={f.gpsAccuracy} />
            {measure(f.geometry) ? <span className="muted small num">{measure(f.geometry)}</span> : null}
          </>
        }
        onClose={p.onClose}
      />

      {/* The action the position needs next leads; occasional map edits sit quietly underneath. */}
      <section className="field">
        <span className="label">Position</span>
        <div className="pos-box">
          <span>{f.positionStatus === 'unplaced' ? 'Not on the map yet' : f.positionStatus === 'rough' ? 'Rough: check it on site' : 'Placed on the map'}</span>
          {f.positionStatus === 'unplaced' ? (
            <button type="button" className="btn btn-primary" onClick={p.onPlace}>
              Put it on the map
            </button>
          ) : (
            <button type="button" className={`btn ${f.positionStatus === 'rough' ? 'btn-primary' : ''}`} onClick={p.onRefine}>
              Refine position
            </button>
          )}
        </div>
        {f.positionStatus !== 'unplaced' && t.geometry !== 'point' ? (
          <div className="pos-more">
            <button type="button" className="btn btn-quiet" onClick={p.onRedraw}>
              Redraw
            </button>
            {t.geometry === 'polygon' ? (
              <>
                <button type="button" className="btn btn-quiet" onClick={p.onAddHole}>
                  Add a hole
                </button>
                <button type="button" className="btn btn-quiet" onClick={p.onAddPart}>
                  Add a part
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="field">
        <span className="label">Photos</span>
        <div className="photo-row">
          <button type="button" className="thumb thumb-add" onClick={() => photoRef.current?.click()}>
            + Photo
          </button>
          {photoIds.length ? (
            <div className="thumbs thumbs-strip">
              {photoIds.map((id) => (
                <Thumb key={id} id={id} onOpen={p.onPhoto} />
              ))}
            </div>
          ) : null}
        </div>
        <input
          ref={photoRef}
          id="feature-photo"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = '';
          }}
        />
      </section>

      <LogSection feature={f} observations={p.observations} onAdd={p.onAddObservation} />

      <label className="field">
        <span className="label">Name</span>
        <input id="feature-name" defaultValue={f.name} onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && set({ name: e.target.value.trim() })} />
      </label>

      {t.plant ? (
        <section className="field">
          <span className="label">Species</span>
          <TaxonPicker taxa={p.taxa} value={f.taxonId} onChange={(id) => set({ taxonId: id })} onCreate={async (n) => set({ taxonId: await p.onCreateTaxon(n) })} />
          {taxon ? (
            <a className="small" href={`https://www.rhs.org.uk/search?query=${encodeURIComponent(taxon.name.replace(/'.*'/, '').trim())}`} target="_blank" rel="noreferrer">
              Care advice on the RHS site
            </a>
          ) : null}
        </section>
      ) : null}

      <div className="field-row">
        {f.type !== 'bed' && f.type !== 'water-body' ? (
          <label className="field grow">
            <span className="label">In</span>
            <select id="feature-parent" value={f.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value || undefined })}>
              <option value="">Not set</option>
              {p.beds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {t.plant && t.geometry !== 'point' ? (
          <label className="field qty">
            <span className="label">How many</span>
            <input id="feature-qty" type="number" inputMode="numeric" min={1} defaultValue={f.quantity ?? ''} onBlur={(e) => set({ quantity: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
        ) : null}
      </div>

      <label className="field">
        <span className="label">Notes</span>
        <textarea id="feature-notes" rows={3} defaultValue={f.notes ?? ''} onBlur={(e) => e.target.value !== (f.notes ?? '') && set({ notes: e.target.value || undefined })} />
      </label>

      {f.attrs && Object.values(f.attrs).some((v) => v !== null && v !== undefined) ? (
        <dl className="attrs">
          {Object.entries(f.attrs)
            .filter(([, v]) => v !== null && v !== undefined)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k === 'potSize' ? 'Pot size' : k === 'tpo' ? 'TPO / conservation area' : k === 'treeRef' ? 'Tree ref' : k}</dt>
                <dd>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd>
              </div>
            ))}
        </dl>
      ) : null}

      {p.children.length ? (
        <section className="field">
          <span className="label">
            Contains {p.children.length} item{p.children.length > 1 ? 's' : ''} ({p.children.filter((c) => c.positionStatus !== 'unplaced').length} on the map)
          </span>
          <ul className="mini-list">
            {p.children
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => p.onOpenFeature(c)}>
                    <span>
                      {c.name}
                      {c.quantity && c.quantity > 1 ? <span className="muted num"> ×{c.quantity}</span> : null}
                    </span>
                    <StatusChip status={c.positionStatus} accuracy={c.gpsAccuracy} />
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <p className="muted small">
        {f.source ? `Source: ${f.source}. ` : ''}Updated {fmtDate(f.updatedAt)}.
      </p>

      <div className="danger">
        {confirmDelete ? (
          <>
            <span>Delete {f.name} and its photos?</span>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
            <button type="button" className="btn btn-danger" onClick={p.onDelete}>
              Delete
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function RegisterPanel({ features, byId, taxa, onOpen, onNew, onClose }: { features: Feature[]; byId: Record<string, Feature>; taxa: Record<string, Taxon>; onOpen: (f: Feature) => void; onNew: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<'unplaced' | 'rough' | 'all'>('unplaced');
  const [q, setQ] = useState('');
  const placed = features.filter((f) => f.positionStatus !== 'unplaced').length;
  const rough = features.filter((f) => f.positionStatus === 'rough').length;
  const list = features.filter((f) => {
    if (tab === 'unplaced' && f.positionStatus !== 'unplaced') return false;
    if (tab === 'rough' && f.positionStatus !== 'rough') return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return f.name.toLowerCase().includes(s) || (f.taxonId && taxa[f.taxonId]?.common?.toLowerCase().includes(s)) || typeOf(f.type).label.toLowerCase().includes(s);
  });
  const groups = new Map<string, Feature[]>();
  for (const f of list) {
    const key = f.type === 'bed' || f.type === 'water-body' || f.type === 'path' ? 'Beds, areas and water' : f.parentId ? byId[f.parentId]?.name ?? 'Elsewhere' : 'Not in a bed yet';
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a.startsWith('Beds') ? -1 : b.startsWith('Beds') ? 1 : a.localeCompare(b)));
  return (
    <div className="panel">
      <PanelHead
        title="Register"
        sub={
          <span className="num">
            {placed} of {features.length} on the map
          </span>
        }
        onClose={onClose}
      />
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${(placed / Math.max(1, features.length)) * 100}%` }} />
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ['unplaced', `To place (${features.length - placed})`],
            ['rough', `Rough (${rough})`],
            ['all', 'Everything'],
          ] as const
        ).map(([id, label]) => (
          <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="search-row">
        <input id="register-search" type="search" placeholder="Search by name, species or type" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn" onClick={onNew}>
          New entry
        </button>
      </div>
      {ordered.length === 0 ? <p className="muted">{tab === 'rough' ? 'No rough positions waiting for refinement.' : 'Nothing matches.'}</p> : null}
      {ordered.map(([g, items]) => (
        <section key={g} className="reg-group">
          <h3>
            {g} <span className="muted num">{items.length}</span>
          </h3>
          <ul className="mini-list">
            {items
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => onOpen(f)}>
                    <span className={`swatch swatch-${typeOf(f.type).geometry}`} style={{ ['--c' as string]: typeOf(f.type).colour }} aria-hidden="true" />
                    <span className="grow">
                      {f.name}
                      {f.quantity && f.quantity > 1 ? <span className="muted num"> ×{f.quantity}</span> : null}
                    </span>
                    {/* Everything in "To place" is off the map, so the type says more there. */}
                    {tab === 'unplaced' ? <span className="muted small">{typeOf(f.type).label}</span> : <StatusChip status={f.positionStatus} accuracy={f.gpsAccuracy} />}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LayersPanel(p: {
  features: Feature[];
  visible: Set<string>;
  setVisible: (s: Set<string>) => void;
  aerial: boolean;
  setAerial: (b: boolean) => void;
  opacity: number;
  setOpacity: (n: number) => void;
  onClose: () => void;
}) {
  const counts = (layer: string) => p.features.filter((f) => f.geometry && typeOf(f.type).layer === layer).length;
  return (
    <div className="panel">
      <PanelHead title="Layers" onClose={p.onClose} />
      <ul className="layer-list">
        {LAYERS.map((l) => (
          <li key={l.id}>
            <label>
              <input
                id={`layer-${l.id}`}
                type="checkbox"
                checked={p.visible.has(l.id)}
                onChange={(e) => {
                  const next = new Set(p.visible);
                  if (e.target.checked) next.add(l.id);
                  else next.delete(l.id);
                  p.setVisible(next);
                }}
              />
              <span className="layer-swatches" aria-hidden="true">
                {TYPES.filter((t) => t.layer === l.id)
                  .slice(0, 4)
                  .map((t) => (
                    <span key={t.id} className="dot" style={{ background: t.colour }} />
                  ))}
              </span>
              <span className="grow">{l.label}</span>
              <span className="muted num">{counts(l.id)}</span>
            </label>
          </li>
        ))}
      </ul>
      <section className="field">
        <span className="label">Key</span>
        <ul className="map-key">
          <li>
            <svg viewBox="0 0 28 16" aria-hidden="true">
              <rect x="2" y="2" width="24" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            Placed
          </li>
          <li>
            <svg viewBox="0 0 28 16" aria-hidden="true">
              <rect x="2" y="2" width="24" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            Rough outline or line: an estimate to check on site
          </li>
          <li>
            <svg viewBox="0 0 28 16" aria-hidden="true">
              <circle cx="14" cy="8" r="5" fill="#7be0a0" stroke="#f2b84b" strokeWidth="2.5" />
            </svg>
            Rough point: a GPS fix or an estimate to check
          </li>
          <li>
            <svg viewBox="0 0 28 16" aria-hidden="true">
              <line x1="2" y1="8" x2="26" y2="8" stroke="#ff8a8a" strokeWidth="3" strokeDasharray="6 4" />
            </svg>
            Cable runs are always dashed
          </li>
        </ul>
        <p className="hint">Tap anything rough and choose Refine position to drag it into place.</p>
      </section>
      <section className="field">
        <span className="label">Base map</span>
        <label className="check">
          <input id="aerial-on" type="checkbox" checked={p.aerial} onChange={(e) => p.setAerial(e.target.checked)} /> Aerial imagery
        </label>
        <label className="field">
          <span className="small muted">Imagery strength</span>
          <input id="aerial-opacity" type="range" min={0.2} max={1} step={0.05} value={p.opacity} onChange={(e) => p.setOpacity(Number(e.target.value))} disabled={!p.aerial} />
        </label>
      </section>
    </div>
  );
}

function DataPanel(p: { features: Feature[]; observations: Observation[]; taxa: Taxon[]; parties: Party[]; onRestored: () => Promise<void>; flash: (m: string) => void; onClose: () => void }) {
  const [lastBackup, setLastBackup] = useState<string | undefined>();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    getMeta('lastBackupAt').then(setLastBackup);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(`${((e.usage ?? 0) / 1048576).toFixed(1)} MB used`))
      .catch(() => {});
  }, []);
  const photos = p.observations.reduce((n, o) => n + o.photoIds.length, 0);
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div className="panel">
      <PanelHead title="Your data" onClose={p.onClose} />
      <dl className="stats">
        <div>
          <dt>Items</dt>
          <dd className="num">{p.features.length}</dd>
        </div>
        <div>
          <dt>On the map</dt>
          <dd className="num">{p.features.filter((f) => f.geometry).length}</dd>
        </div>
        <div>
          <dt>Photos</dt>
          <dd className="num">{photos}</dd>
        </div>
        <div>
          <dt>Log entries</dt>
          <dd className="num">{p.observations.length}</dd>
        </div>
      </dl>
      <p className="notice">
        Everything is stored on this device only. Back up regularly, and add the app to your home screen so the browser keeps the data.
        {persisted === false ? ' This browser has not yet granted permanent storage.' : ''}
      </p>
      <p className="muted small">
        Last backup: {lastBackup ? fmtDate(lastBackup) : 'never'}. {usage}
      </p>
      <div className="stack">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const blob = await buildBackup();
              await deliverFile(blob, `providence-garden-${stamp}.zip`);
              setLastBackup(new Date().toISOString());
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Preparing…' : 'Back up everything (zip with photos)'}
        </button>
        <button type="button" className="btn" onClick={() => deliverFile(new Blob([JSON.stringify(toGeoJSON(p.features, p.taxa), null, 1)], { type: 'application/geo+json' }), `providence-garden-${stamp}.geojson`)}>
          Export map as GeoJSON
        </button>
        <button type="button" className="btn" onClick={() => restoreRef.current?.click()}>
          Restore from a backup
        </button>
        <input
          ref={restoreRef}
          id="restore-file"
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setErr(null);
            try {
              const r = await restoreBackup(file);
              await p.onRestored();
              p.flash(`Restored ${r.features} items, ${r.observations} log entries and ${r.photos} photos.`);
            } catch (x) {
              setErr((x as Error).message);
            }
          }}
        />
        {err ? <p className="error">{err}</p> : null}
      </div>
      <section className="field">
        <span className="label">Organisations from the 2018 documents</span>
        <ul className="plain-list">
          {p.parties.map((x) => (
            <li key={x.id}>
              <strong>{x.name}</strong>
              <span className="muted small">{x.role}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="muted small">Prototype. Seeded from the 2018 Garden Master Plan, plant schedule and tree list. Aerial imagery from Esri World Imagery.</p>
    </div>
  );
}
