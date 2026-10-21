import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapView, HOME, type MapMode } from './MapView';
import { LAYERS, TYPES, typeOf } from './catalogue';
import { deleteFeature, ensureSeeded, getMeta, loadAll, newId, putFeature, putObservation, putPhoto, putTaxon } from './db';
import { centre, inPolygon, measure, openRings, pointInPolygon, polygon, preparePhoto, watchFix, type Fix } from './geo';
import { buildBackup, deliverFile, restoreBackup, toGeoJSON } from './backup';
import type { Feature, Geometry, Observation, ObservationKind, Party, Taxon } from './model';
import { PhotoViewer, StatusChip, TaxonPicker, Thumb } from './components';

type Panel = null | 'layers' | 'register' | 'menu' | 'new' | 'capture' | 'feature';

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

const OBS_KINDS: { id: ObservationKind; label: string }[] = [
  { id: 'note', label: 'Note' },
  { id: 'condition', label: 'Condition' },
  { id: 'flowering', label: 'Flowering' },
  { id: 'fruiting', label: 'Fruiting or berries' },
  { id: 'sighting', label: 'Wildlife sighting' },
  { id: 'maintenance', label: 'Maintenance done' },
];

const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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
  /** Finished rings of a polygon being drawn: the outer edge, then any holes. */
  const [draftRings, setDraftRings] = useState<[number, number][][]>([]);
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
      if (b.id === exclude || b.geometry?.type !== 'Polygon') continue;
      const ring = b.geometry.coordinates[0];
      if (!inPolygon(pt, b.geometry.coordinates)) continue;
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
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

  /** Cut a hole, such as the island in the moat, out of a shape already on the map. */
  function beginHole(f: Feature) {
    if (f.geometry?.type !== 'Polygon') return;
    beginCapture(f.type, f);
    setDraftRings(openRings(f.geometry));
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

  /** Holes have to sit inside the outer edge. */
  function holeFits(ring: [number, number][]) {
    if (draftRings.length && !ring.every((pt) => pointInPolygon(pt, draftRings[0]))) {
      flash('A hole has to be inside the outer edge.');
      return false;
    }
    return true;
  }

  /** Close the ring being drawn and start tracing a hole inside the shape. */
  function addHole() {
    if (draft.length < 3 || !holeFits(draft)) return;
    setDraftRings((r) => [...r, draft]);
    setDraft([]);
  }

  function undoPoint() {
    // With nothing in the current ring, step back into the ring before it.
    if (!draft.length && draftRings.length) {
      setDraft(draftRings[draftRings.length - 1]);
      setDraftRings((r) => r.slice(0, -1));
    } else setDraft((d) => d.slice(0, -1));
  }

  function finishDrawing() {
    if (!capture) return;
    const kind = typeOf(capture.typeId).geometry;
    if (kind === 'polygon' && draft.length && !holeFits(draft)) return;
    const g: Geometry = kind === 'polygon' ? polygon(draft.length ? [...draftRings, draft] : draftRings) : { type: 'LineString', coordinates: draft };
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
    const geometry = editGeometry.type === 'Polygon' ? polygon(openRings(editGeometry)) : editGeometry;
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

  // ---------- render ----------

  const drawType = capture ? typeOf(capture.typeId) : null;
  const drawingHole = draftRings.length > 0;
  // A polygon is done once its current ring has three corners, or straight after Add a hole if no hole is wanted after all.
  const canFinish = drawType?.geometry === 'polygon' ? draft.length >= 3 || (drawingHole && !draft.length) : draft.length >= 2;

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
          <button type="button" className={`nav-btn ${panel === 'layers' ? 'on' : ''}`} onClick={() => setPanel(panel === 'layers' ? null : 'layers')}>
            Layers
          </button>
          <button type="button" className={`nav-btn ${panel === 'menu' ? 'on' : ''}`} onClick={() => setPanel(panel === 'menu' ? null : 'menu')}>
            Data
          </button>
        </nav>
      </header>

      <main className="stage">
        <MapView
          features={features}
          visibleLayers={visibleLayers}
          aerial={aerial}
          aerialOpacity={aerialOpacity}
          selectedId={selectedId}
          mode={mode}
          draft={draft}
          draftRings={draftRings}
          draftKind={drawType?.geometry ?? 'point'}
          editGeometry={editGeometry}
          userFix={fix}
          flyTo={flyTo}
          panelOpen={panel !== null}
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
                {drawingHole ? 'Hole in ' : capture?.featureId ? 'Place ' : 'New '}
                {capture?.featureId ? byId[capture.featureId]?.name : `${drawingHole ? 'the new ' : ''}${drawType.label.toLowerCase()}`}
              </strong>
              <span>
                {drawingHole ? 'Tap round the hole, such as an island' : drawType.hint ?? 'Tap each corner on the map'}. {draft.length} point{draft.length === 1 ? '' : 's'}.
              </span>
              <span className="muted small">{fix ? `GPS ±${Math.round(fix.accuracy)}m` : gpsError ?? 'Waiting for GPS…'}</span>
            </div>
            <div className="toolbar-btns">
              <button type="button" className="btn btn-quiet" onClick={cancelCapture}>
                Cancel
              </button>
              <button type="button" className="btn" disabled={!draft.length && !drawingHole} onClick={undoPoint}>
                Undo
              </button>
              <button type="button" className="btn" disabled={!fix} onClick={() => fix && setDraft((d) => [...d, [fix.lng, fix.lat]])}>
                Add my position
              </button>
              {drawType.geometry === 'polygon' ? (
                <button type="button" className="btn" disabled={draft.length < 3} onClick={addHole}>
                  Add a hole
                </button>
              ) : null}
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

        {panel ? (
          <aside className="sheet" aria-label="Panel" key={`${panel}-${panel === 'feature' ? selectedId : ''}`}>
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
                onAddHole={() => beginHole(selected)}
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

            {panel === 'register' ? <RegisterPanel features={features} byId={byId} taxa={taxonById} onOpen={openFeature} onClose={() => setPanel(null)} /> : null}

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
            <span>{c.geometry.type === 'Point' ? 'Placed on the map' : `Traced on the map, ${measure(c.geometry)}`}</span>
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
  const [obsKind, setObsKind] = useState<ObservationKind>('note');
  const [obsText, setObsText] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Feature>) => p.onChange({ ...f, ...patch, updatedAt: new Date().toISOString() });
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

      <div className="pos-actions">
        {f.positionStatus === 'unplaced' ? (
          <button type="button" className="btn btn-primary" onClick={p.onPlace}>
            Put it on the map
          </button>
        ) : (
          <>
            <button type="button" className={`btn ${f.positionStatus === 'rough' ? 'btn-primary' : ''}`} onClick={p.onRefine}>
              Refine position
            </button>
            {t.geometry !== 'point' ? (
              <button type="button" className="btn" onClick={p.onRedraw}>
                Redraw
              </button>
            ) : null}
            {t.geometry === 'polygon' ? (
              <button type="button" className="btn" onClick={p.onAddHole}>
                Add a hole
              </button>
            ) : null}
          </>
        )}
        <button type="button" className="btn" onClick={() => photoRef.current?.click()}>
          Add photo
        </button>
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
      </div>

      {photoIds.length ? (
        <div className="thumbs thumbs-strip">
          {photoIds.map((id) => (
            <Thumb key={id} id={id} onOpen={p.onPhoto} />
          ))}
        </div>
      ) : null}

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

      <section className="field">
        <span className="label">Log</span>
        <div className="obs-add">
          <select id="obs-kind" value={obsKind} onChange={(e) => setObsKind(e.target.value as ObservationKind)} aria-label="Kind of entry">
            {OBS_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <input id="obs-text" value={obsText} placeholder="What did you see?" onChange={(e) => setObsText(e.target.value)} />
          <button
            type="button"
            className="btn"
            disabled={!obsText.trim()}
            onClick={async () => {
              await p.onAddObservation({ id: newId('obs'), featureId: f.id, kind: obsKind, at: new Date().toISOString(), text: obsText.trim(), photoIds: [] });
              setObsText('');
            }}
          >
            Add
          </button>
        </div>
        {p.observations.length ? (
          <ol className="log">
            {p.observations.map((o) => (
              <li key={o.id}>
                <span className="log-date num">{fmtDate(o.at)}</span>
                <span className="log-kind">{o.kind === 'photo' ? `${o.photoIds.length} photo${o.photoIds.length > 1 ? 's' : ''}` : OBS_KINDS.find((k) => k.id === o.kind)?.label}</span>
                {o.text ? <span className="log-text">{o.text}</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">Nothing logged yet.</p>
        )}
      </section>

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

function RegisterPanel({ features, byId, taxa, onOpen, onClose }: { features: Feature[]; byId: Record<string, Feature>; taxa: Record<string, Taxon>; onOpen: (f: Feature) => void; onClose: () => void }) {
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
      <input id="register-search" type="search" placeholder="Search by name, species or type" value={q} onChange={(e) => setQ(e.target.value)} />
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
                    <StatusChip status={f.positionStatus} accuracy={f.gpsAccuracy} />
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
        <span className="label">Base map</span>
        <label className="check">
          <input id="aerial-on" type="checkbox" checked={p.aerial} onChange={(e) => p.setAerial(e.target.checked)} /> Aerial imagery
        </label>
        <label className="field">
          <span className="small muted">Imagery strength</span>
          <input id="aerial-opacity" type="range" min={0.2} max={1} step={0.05} value={p.opacity} onChange={(e) => p.setOpacity(Number(e.target.value))} disabled={!p.aerial} />
        </label>
        <p className="hint">Rough GPS positions have an amber ring. Tap one and choose Refine position to drag it into place.</p>
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
          <dt>Features</dt>
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
              p.flash(`Restored ${r.features} features, ${r.observations} log entries and ${r.photos} photos.`);
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
