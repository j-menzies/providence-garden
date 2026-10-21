import { useEffect, useMemo, useRef, useState } from 'react';
import { getPhoto } from './db';
import type { Observation, ObservationKind, Taxon } from './model';

export const OBS_KINDS: { id: ObservationKind; label: string }[] = [
  { id: 'note', label: 'Note' },
  { id: 'condition', label: 'Condition' },
  { id: 'flowering', label: 'Flowering' },
  { id: 'fruiting', label: 'Fruiting or berries' },
  { id: 'sighting', label: 'Wildlife sighting' },
  { id: 'maintenance', label: 'Maintenance done' },
];

export const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const q = window.matchMedia(query);
    const on = () => setMatches(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** A "More" button opening a short list of less-used actions above it, so toolbars stay to one row. */
export function MoreMenu({ label, items }: { label: string; items: { label: string; disabled?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div className="more" ref={ref}>
      <button type="button" className="btn" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        More
      </button>
      {open ? (
        <div className="more-menu" role="group" aria-label={label}>
          {items.map((i) => (
            <button
              type="button"
              key={i.label}
              disabled={i.disabled}
              onClick={() => {
                setOpen(false);
                i.onSelect();
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** What a log entry was, e.g. 'Flowering' or '2 photos'. */
export function obsLabel(o: Observation) {
  return o.kind === 'photo' ? `${o.photoIds.length} photo${o.photoIds.length > 1 ? 's' : ''}` : OBS_KINDS.find((k) => k.id === o.kind)?.label;
}

export function Thumb({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    getPhoto(id).then((p) => {
      if (p) {
        u = URL.createObjectURL(p.thumb);
        setUrl(u);
      }
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return (
    <button type="button" className="thumb" onClick={() => onOpen?.(id)} aria-label="Open photo">
      {url ? <img src={url} alt="" /> : null}
    </button>
  );
}

export function PhotoViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [taken, setTaken] = useState('');
  useEffect(() => {
    let u: string | null = null;
    getPhoto(id).then((p) => {
      if (p) {
        u = URL.createObjectURL(p.blob);
        setUrl(u);
        setTaken(new Date(p.takenAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }));
      }
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return (
    <div className="viewer" role="dialog" aria-label="Photo" onClick={onClose}>
      {url ? <img src={url} alt="" /> : null}
      <div className="viewer-bar">
        <span>{taken}</span>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function TaxonPicker({ taxa, value, onChange, onCreate }: { taxa: Taxon[]; value?: string; onChange: (id: string | undefined) => void; onCreate: (name: string) => void }) {
  const current = taxa.find((t) => t.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return taxa.slice(0, 8);
    return taxa.filter((t) => t.name.toLowerCase().includes(s) || t.common?.toLowerCase().includes(s)).slice(0, 8);
  }, [q, taxa]);
  if (current && !open)
    return (
      <div className="taxon-current">
        <div>
          <div className="taxon-name">{current.name}</div>
          {current.common ? <div className="muted small">{current.common}</div> : null}
        </div>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
    );
  return (
    <div className="taxon-picker">
      <input id="taxon-search" type="search" placeholder="Search species or common name" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <ul className="taxon-list">
        {matches.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => {
                onChange(t.id);
                setOpen(false);
                setQ('');
              }}
            >
              <span className="taxon-name">{t.name}</span>
              {t.common ? <span className="muted small"> {t.common}</span> : null}
            </button>
          </li>
        ))}
        {q.trim() && !taxa.some((t) => t.name.toLowerCase() === q.trim().toLowerCase()) ? (
          <li>
            <button
              type="button"
              className="add-taxon"
              onClick={() => {
                onCreate(q.trim());
                setOpen(false);
                setQ('');
              }}
            >
              Add “{q.trim()}” as a new species
            </button>
          </li>
        ) : null}
      </ul>
      {current ? (
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          Keep {current.name}
        </button>
      ) : (
        <button type="button" className="btn btn-quiet" onClick={() => onChange(undefined)} hidden={!value}>
          Clear
        </button>
      )}
    </div>
  );
}

export function StatusChip({ status, accuracy }: { status: string; accuracy?: number }) {
  const label = status === 'unplaced' ? 'Not on map' : status === 'rough' ? (accuracy ? `Rough ±${Math.round(accuracy)}m` : 'Rough') : 'Placed';
  return <span className={`chip chip-${status}`}>{label}</span>;
}
