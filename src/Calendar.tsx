import { useState } from 'react';
import { newId } from './db';
import { fmtDate } from './components';
import type { Feature, Job, Party } from './model';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Months from now until a job is next due (0 is this month), or null for a job done when needed. */
function dueIn(job: Job, month: number) {
  for (let k = 0; k < 12; k++) if (job.months.includes(((month - 1 + k) % 12) + 1)) return k;
  return null;
}

/** 'Dec to Feb' for a run of months that may wrap the year, otherwise a list such as 'Mar, Jun, Sep, Dec'. */
export function monthsLabel(months: number[]) {
  const set = new Set(months);
  if (!set.size) return '';
  if (set.size === 12) return 'All year';
  // A run starts at a month whose previous month isn't in the set; one run means a range.
  const starts = [...set].filter((m) => !set.has(((m + 10) % 12) + 1));
  if (starts.length === 1 && set.size > 1) {
    let end = starts[0];
    while (set.has((end % 12) + 1)) end = (end % 12) + 1;
    return `${MONTHS[starts[0] - 1]} to ${MONTHS[end - 1]}`;
  }
  return [...set]
    .sort((a, b) => a - b)
    .map((m) => MONTHS[m - 1])
    .join(', ');
}

const sameMonth = (iso: string, d: Date) => {
  const x = new Date(iso);
  return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
};

/** Recurring jobs by when they're next due: this month, next month, then month by month, then when needed. */
export function CalendarPanel(p: {
  jobs: Job[];
  features: Feature[];
  parties: Party[];
  onSave: (j: Job) => void;
  onDelete: (id: string) => void;
  onDone: (j: Job) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Job | 'new' | null>(null);
  const now = new Date();
  const month = now.getMonth() + 1;
  const byId = Object.fromEntries(p.features.map((f) => [f.id, f]));
  const party = Object.fromEntries(p.parties.map((x) => [x.id, x]));

  if (editing)
    return (
      <JobForm
        job={editing === 'new' ? undefined : editing}
        features={p.features}
        parties={p.parties}
        onSave={(j) => {
          p.onSave(j);
          setEditing(null);
        }}
        onDelete={(id) => {
          p.onDelete(id);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );

  const groups = new Map<number, Job[]>();
  const whenNeeded: Job[] = [];
  for (const j of [...p.jobs].sort((a, b) => a.what.localeCompare(b.what))) {
    const k = dueIn(j, month);
    if (k === null) whenNeeded.push(j);
    else groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  const heading = (k: number) =>
    k === 0 ? `Due now, ${now.toLocaleDateString('en-GB', { month: 'long' })}` : k === 1 ? 'Next month' : new Date(now.getFullYear(), now.getMonth() + k, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const row = (j: Job) => {
    const done = j.lastDone && sameMonth(j.lastDone, now);
    const names = j.featureIds.map((id) => byId[id]?.name).filter(Boolean);
    return (
      <li key={j.id} className="job">
        <button type="button" className="job-main" onClick={() => setEditing(j)}>
          <span className="job-what">{j.what}</span>
          <span className="muted small">{[j.when, j.partyId ? party[j.partyId]?.name : null, names.join(', ') || null].filter(Boolean).join(' · ')}</span>
          {j.lastDone ? <span className="muted small">Last done {fmtDate(j.lastDone)}</span> : null}
        </button>
        {done ? (
          <span className="chip chip-refined">Done</span>
        ) : (
          <button type="button" className="btn" onClick={() => p.onDone(j)}>
            Mark done
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Calendar</h2>
          <div className="panel-sub">Recurring garden jobs. Tap one to change it.</div>
        </div>
        <button type="button" className="close" onClick={p.onClose} aria-label="Close panel">
          ×
        </button>
      </div>
      <button type="button" className="btn" onClick={() => setEditing('new')}>
        Add a job
      </button>
      {groups.has(0) ? null : (
        <section className="field">
          <span className="label">{heading(0)}</span>
          <p className="muted small">Nothing due in {now.toLocaleDateString('en-GB', { month: 'long' })}.</p>
        </section>
      )}
      {[...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([k, jobs]) => (
          <section key={k} className="field" aria-label={heading(k)}>
            <span className="label">{heading(k)}</span>
            <ul className="job-list">{jobs.map(row)}</ul>
          </section>
        ))}
      {whenNeeded.length ? (
        <section className="field" aria-label="When needed">
          <span className="label">When needed</span>
          <ul className="job-list">{whenNeeded.map(row)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function JobForm(p: { job?: Job; features: Feature[]; parties: Party[]; onSave: (j: Job) => void; onDelete: (id: string) => void; onCancel: () => void }) {
  const [what, setWhat] = useState(p.job?.what ?? '');
  // Wording made from the months (e.g. 'Oct') is left blank here so it follows the months when they change.
  const generated = p.job && p.job.when === (monthsLabel(p.job.months) || 'When needed');
  const [when, setWhen] = useState(p.job && !generated ? p.job.when : '');
  const [months, setMonths] = useState<number[]>(p.job?.months ?? []);
  const [partyId, setPartyId] = useState(p.job?.partyId ?? '');
  const [featureIds, setFeatureIds] = useState<string[]>(p.job?.featureIds ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const byId = Object.fromEntries(p.features.map((f) => [f.id, f]));
  const sorted = [...months].sort((a, b) => a - b);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{p.job ? 'Change job' : 'New job'}</h2>
        <button type="button" className="close" onClick={p.onCancel} aria-label="Close panel">
          ×
        </button>
      </div>
      <label className="field">
        <span className="label">Job</span>
        <input id="job-what" value={what} placeholder="e.g. Clean the pond pump filter" onChange={(e) => setWhat(e.target.value)} />
      </label>
      <section className="field">
        <span className="label">Months</span>
        <div className="month-picks" role="group" aria-label="Months">
          {MONTHS.map((m, i) => (
            <button type="button" key={m} className="month-pick" aria-pressed={months.includes(i + 1)} onClick={() => setMonths(months.includes(i + 1) ? months.filter((x) => x !== i + 1) : [...months, i + 1])}>
              {m}
            </button>
          ))}
        </div>
        <p className="hint">Leave them all off for a job done when needed.</p>
      </section>
      <label className="field">
        <span className="label">When, in words</span>
        <input id="job-when" value={when} placeholder={monthsLabel(sorted) || 'e.g. Late winter, before nesting season'} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Who does it</span>
        <select id="job-party" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
          <option value="">Not set</option>
          {p.parties.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <section className="field">
        <span className="label">For</span>
        {featureIds.length ? (
          <div className="filter-chips">
            {featureIds.map((id) => (
              <button type="button" key={id} className="filter-chip" aria-label={`Remove ${byId[id]?.name ?? id}`} onClick={() => setFeatureIds(featureIds.filter((x) => x !== id))}>
                {byId[id]?.name ?? id} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : null}
        <select id="job-feature" value="" aria-label="Add a bed, tree or hedge" onChange={(e) => e.target.value && setFeatureIds([...featureIds, e.target.value])}>
          <option value="">Add a bed, tree or hedge…</option>
          {p.features
            .filter((f) => !featureIds.includes(f.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
        <p className="hint">Marking the job done logs it on each of these.</p>
      </section>
      <div className="panel-actions">
        {p.job ? (
          confirmDelete ? (
            <button type="button" className="btn btn-danger" onClick={() => p.onDelete(p.job!.id)}>
              Delete this job
            </button>
          ) : (
            <button type="button" className="btn btn-quiet job-delete" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )
        ) : null}
        <button type="button" className="btn btn-quiet" onClick={p.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!what.trim()}
          onClick={() =>
            p.onSave({
              id: p.job?.id ?? newId('job'),
              what: what.trim(),
              when: when.trim() || monthsLabel(sorted) || 'When needed',
              months: sorted,
              partyId: partyId || undefined,
              featureIds,
              lastDone: p.job?.lastDone,
              source: p.job?.source ?? 'Added in the app',
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
