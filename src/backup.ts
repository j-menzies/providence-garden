import JSZip from 'jszip';
import { db, setMeta } from './db';
import { typeOf } from './catalogue';
import type { Feature, Job, Observation, Party, PhotoRecord, Taxon } from './model';

const FORMAT = 'providence-garden-backup/1';

export function toGeoJSON(features: Feature[], taxa: Taxon[]) {
  const taxon = Object.fromEntries(taxa.map((t) => [t.id, t]));
  return {
    type: 'FeatureCollection',
    features: features
      .filter((f) => f.geometry)
      .map((f) => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: {
          type: f.type,
          layer: typeOf(f.type).layer,
          name: f.name,
          species: f.taxonId ? taxon[f.taxonId]?.name : null,
          quantity: f.quantity ?? null,
          parentId: f.parentId ?? null,
          positionStatus: f.positionStatus,
          gpsAccuracy: f.gpsAccuracy ?? null,
          notes: f.notes ?? null,
          ...f.attrs,
        },
      })),
  };
}

/** Full backup: one zip with data.json (Firestore-shaped collections) and the photos. */
export async function buildBackup(): Promise<Blob> {
  const d = await db();
  const [features, observations, photos, taxa, parties, jobs] = await Promise.all([
    d.getAll('features'),
    d.getAll('observations'),
    d.getAll('photos'),
    d.getAll('taxa'),
    d.getAll('parties'),
    d.getAll('jobs'),
  ]);
  const zip = new JSZip();
  zip.file(
    'data.json',
    JSON.stringify(
      {
        format: FORMAT,
        exportedAt: new Date().toISOString(),
        collections: {
          features,
          observations,
          photos: photos.map(({ blob: _b, thumb: _t, ...meta }) => ({ ...meta, path: `photos/${meta.id}.jpg`, thumbPath: `thumbs/${meta.id}.jpg` })),
          taxa,
          parties,
          jobs,
        },
      },
      null,
      1,
    ),
  );
  zip.file('features.geojson', JSON.stringify(toGeoJSON(features, taxa)));
  for (const p of photos) {
    zip.file(`photos/${p.id}.jpg`, p.blob);
    zip.file(`thumbs/${p.id}.jpg`, p.thumb);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  await setMeta('lastBackupAt', new Date().toISOString());
  return blob;
}

/** Restores a backup over the current data. Records with the same id are replaced. */
export async function restoreBackup(file: Blob) {
  const zip = await JSZip.loadAsync(file);
  const raw = await zip.file('data.json')?.async('string');
  if (!raw) throw new Error('This zip has no data.json, so it is not a garden backup.');
  const data = JSON.parse(raw);
  if (data.format !== FORMAT) throw new Error('This backup is from a different app or version.');
  const c = data.collections as {
    features: Feature[];
    observations: Observation[];
    photos: (Omit<PhotoRecord, 'blob' | 'thumb'> & { path: string; thumbPath: string })[];
    taxa: Taxon[];
    parties: Party[];
    // Backups from before the calendar have no jobs.
    jobs?: Job[];
  };
  const photoBlobs: PhotoRecord[] = [];
  for (const p of c.photos) {
    const blob = await zip.file(p.path)?.async('blob');
    const thumb = await zip.file(p.thumbPath)?.async('blob');
    if (blob && thumb) {
      const { path: _p, thumbPath: _t, ...meta } = p;
      photoBlobs.push({ ...meta, blob: new Blob([blob], { type: 'image/jpeg' }), thumb: new Blob([thumb], { type: 'image/jpeg' }) });
    }
  }
  const d = await db();
  const tx = d.transaction(['features', 'observations', 'photos', 'taxa', 'parties', 'jobs'], 'readwrite');
  for (const f of c.features) await tx.objectStore('features').put(f);
  for (const o of c.observations) await tx.objectStore('observations').put(o);
  for (const p of photoBlobs) await tx.objectStore('photos').put(p);
  for (const t of c.taxa) await tx.objectStore('taxa').put(t);
  for (const p of c.parties) await tx.objectStore('parties').put(p);
  for (const j of c.jobs ?? []) await tx.objectStore('jobs').put(j);
  await tx.done;
  return { features: c.features.length, observations: c.observations.length, photos: photoBlobs.length };
}

/** Hands a file to the user. The share sheet is the reliable route on iOS home-screen apps. */
export async function deliverFile(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
