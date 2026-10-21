import { useMemo, useState } from 'react';
import { LAYERS, TYPES, typeOf } from './catalogue';
import { deliverFile } from './backup';
import { StatusChip, fmtDate, obsLabel } from './components';
import type { Feature, Observation, PositionStatus, Taxon } from './model';

const STATUS_LABEL: Record<PositionStatus, string> = { refined: 'Placed', rough: 'Rough', unplaced: 'Not on map' };

interface Row {
  f: Feature;
  bed?: Feature;
  taxon?: Taxon;
  latest?: Observation;
  entries: number;
  photos: number;
}

/** True if a feature sits in an area, directly or inside one of its beds (a plant in the Mimosa Bed is on the island). */
function within(f: Feature, areaId: string, byId: Record<string, Feature>) {
  for (let p = f.parentId, depth = 0; p && depth < 5; p = byId[p]?.parentId, depth++) if (p === areaId) return true;
  return false;
}

function toCsv(rows: Row[]) {
  const cell = (v: string | number | undefined) => {
    let t = v === undefined ? '' : String(v);
    // Stop spreadsheets reading a note such as "=..." as a formula.
    if (/^[=+\-@]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const head = ['Name', 'Type', 'Layer', 'In', 'Species', 'Common name', 'Quantity', 'On the map', 'Latest log date', 'Latest log', 'Latest log note', 'Log entries', 'Photos', 'Notes', 'Source', 'ID'];
  const lines = rows.map((r) => {
    const t = typeOf(r.f.type);
    return [
      r.f.name,
      t.label,
      LAYERS.find((l) => l.id === t.layer)?.label,
      r.bed?.name,
      r.taxon?.name,
      r.taxon?.common,
      r.f.quantity,
      STATUS_LABEL[r.f.positionStatus],
      r.latest ? new Date(r.latest.at).toLocaleDateString('en-CA') : undefined,
      r.latest ? obsLabel(r.latest) : undefined,
      r.latest?.text,
      r.entries,
      r.photos,
      r.f.notes,
      r.f.source,
      r.f.id,
    ].map(cell);
  });
  // The byte order mark tells Excel the file is UTF-8, so names like 'Robin Hill' and m² survive.
  return '﻿' + [head.map(cell), ...lines].map((l) => l.join(',')).join('\r\n');
}

/** Every item in the register as one filterable list, each with its latest log entry. */
export function ItemsReport(p: { features: Feature[]; observations: Observation[]; taxa: Record<string, Taxon>; onOpen: (f: Feature) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<'name' | 'recent' | 'bed'>('name');

  const byId = useMemo(() => Object.fromEntries(p.features.map((f) => [f.id, f])), [p.features]);
  const rows = useMemo(() => {
    const logs = new Map<string, Observation[]>();
    for (const o of p.observations) logs.set(o.featureId, [...(logs.get(o.featureId) ?? []), o]);
    return p.features.map((f): Row => {
      const own = logs.get(f.id) ?? [];
      return {
        f,
        bed: f.parentId ? byId[f.parentId] : undefined,
        taxon: f.taxonId ? p.taxa[f.taxonId] : undefined,
        latest: own.reduce<Observation | undefined>((a, o) => (!a || o.at > a.at ? o : a), undefined),
        entries: own.length,
        photos: own.reduce((n, o) => n + o.photoIds.length, 0),
      };
    });
  }, [p.features, p.observations, p.taxa, byId]);

  const areas = p.features.filter((f) => f.type === 'bed' || f.type === 'water-body').sort((a, b) => a.name.localeCompare(b.name));
  const types = TYPES.filter((t) => rows.some((r) => r.f.type === t.id));
  const s = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (!type || r.f.type === type) && (!status || r.f.positionStatus === status))
    .filter((r) => !area || (area === 'none' ? !r.f.parentId : within(r.f, area, byId)))
    .filter((r) => !s || [r.f.name, typeOf(r.f.type).label, r.bed?.name, r.taxon?.name, r.taxon?.common, r.f.notes, r.latest?.text].some((v) => v?.toLowerCase().includes(s)))
    .sort((a, b) => {
      const byName = a.f.name.localeCompare(b.f.name);
      if (sort === 'recent') return (b.latest?.at ?? '').localeCompare(a.latest?.at ?? '') || byName;
      // Items not in a bed go last.
      if (sort === 'bed') return (a.bed?.name ?? '￿').localeCompare(b.bed?.name ?? '￿') || byName;
      return byName;
    });
  const filtered = Boolean(q || type || area || status);

  return (
    <section className="report" aria-label="Items report">
      <div className="report-head">
        <div>
          <h2>Items report</h2>
          <div className="panel-sub">
            <span className="num" id="report-count">
              {shown.length} of {rows.length} items
            </span>
          </div>
        </div>
        <button type="button" className="close" onClick={p.onClose} aria-label="Close report">
          ×
        </button>
      </div>

      <div className="report-filters">
        <input id="report-search" type="search" value={q} placeholder="Search names, species, notes" aria-label="Search" onChange={(e) => setQ(e.target.value)} />
        <select id="report-type" value={type} aria-label="Type" onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {LAYERS.map((l) => {
            const inLayer = types.filter((t) => t.layer === l.id);
            return inLayer.length ? (
              <optgroup key={l.id} label={l.label}>
                {inLayer.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
        <select id="report-area" value={area} aria-label="In" onChange={(e) => setArea(e.target.value)}>
          <option value="">All beds</option>
          <option value="none">Not in a bed</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select id="report-status" value={status} aria-label="On the map" onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any map status</option>
          <option value="refined">Placed</option>
          <option value="rough">Rough</option>
          <option value="unplaced">Not on map</option>
        </select>
        <select id="report-sort" value={sort} aria-label="Sort" onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="name">Sort: name</option>
          <option value="recent">Sort: latest log</option>
          <option value="bed">Sort: bed</option>
        </select>
        <div className="report-actions">
          {filtered ? (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setQ('');
                setType('');
                setArea('');
                setStatus('');
              }}
            >
              Clear filters
            </button>
          ) : null}
          <button type="button" className="btn" disabled={!shown.length} onClick={() => deliverFile(new Blob([toCsv(shown)], { type: 'text/csv' }), `providence-garden-items-${new Date().toLocaleDateString('en-CA')}.csv`)}>
            Download spreadsheet
          </button>
        </div>
      </div>

      <div className="report-body">
        {shown.length ? (
          <table className="report-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>In</th>
                <th>Species</th>
                <th className="c-qty">Qty</th>
                <th>Map</th>
                <th>Latest log</th>
                <th className="c-count">Entries</th>
                <th className="c-count">Photos</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const t = typeOf(r.f.type);
                return (
                  <tr key={r.f.id} onClick={() => p.onOpen(r.f)}>
                    <td className="c-name">
                      <button
                        type="button"
                        className="link"
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onOpen(r.f);
                        }}
                      >
                        {r.f.name}
                      </button>
                    </td>
                    <td className="c-type">
                      <span className="type-tag">
                        <span className={`swatch swatch-${t.geometry}`} style={{ ['--c' as string]: t.colour }} aria-hidden="true" />
                        {t.label}
                      </span>
                    </td>
                    <td className="c-bed">{r.bed?.name}</td>
                    {/* Planting groups are named after their species; phones don't repeat it. */}
                    <td className={`c-species ${r.taxon && r.f.name.startsWith(r.taxon.name) ? 'c-same' : ''}`}>{r.taxon ? <span className="taxon-name">{r.taxon.name}</span> : null}</td>
                    <td className="c-qty num">{r.f.quantity}</td>
                    <td className="c-map">
                      <StatusChip status={r.f.positionStatus} accuracy={r.f.gpsAccuracy} />
                    </td>
                    {r.latest ? (
                      <td className="c-log">
                        <span className="num muted">{fmtDate(r.latest.at)}</span> {obsLabel(r.latest)}
                        {r.latest.text ? `: ${r.latest.text}` : ''}
                      </td>
                    ) : (
                      <td className="c-log c-none muted">Nothing logged</td>
                    )}
                    <td className="c-count num" data-label="Entries">
                      {r.entries || ''}
                    </td>
                    <td className="c-count num" data-label="Photos">
                      {r.photos || ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted">Nothing matches these filters.</p>
        )}
      </div>
    </section>
  );
}
