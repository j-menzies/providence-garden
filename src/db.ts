import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Feature, Observation, Party, PhotoRecord, Taxon } from './model';
import { SEED_PARTIES, SEED_TAXA, seedFeatures } from './seed';
import { START_POSITIONS } from './positions';

interface GardenDB extends DBSchema {
  features: { key: string; value: Feature };
  observations: { key: string; value: Observation; indexes: { byFeature: string } };
  photos: { key: string; value: PhotoRecord };
  taxa: { key: string; value: Taxon };
  parties: { key: string; value: Party };
  meta: { key: string; value: { key: string; value: string } };
}

let dbp: Promise<IDBPDatabase<GardenDB>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<GardenDB>('providence-garden', 1, {
      upgrade(d) {
        d.createObjectStore('features', { keyPath: 'id' });
        d.createObjectStore('observations', { keyPath: 'id' }).createIndex('byFeature', 'featureId');
        d.createObjectStore('photos', { keyPath: 'id' });
        d.createObjectStore('taxa', { keyPath: 'id' });
        d.createObjectStore('parties', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbp;
}

export async function getMeta(key: string) {
  return (await (await db()).get('meta', key))?.value;
}
export async function setMeta(key: string, value: string) {
  await (await db()).put('meta', { key, value });
}

/** Loads the 2018 reference data on first run. Never overwrites anything already captured. */
export async function ensureSeeded() {
  if (await getMeta('seededAt')) return;
  const d = await db();
  const now = new Date().toISOString();
  const tx = d.transaction(['features', 'taxa', 'parties', 'meta'], 'readwrite');
  for (const f of seedFeatures(now)) if (!(await tx.objectStore('features').get(f.id))) await tx.objectStore('features').put(f);
  for (const t of SEED_TAXA) await tx.objectStore('taxa').put(t);
  for (const p of SEED_PARTIES) await tx.objectStore('parties').put(p);
  await tx.objectStore('meta').put({ key: 'seededAt', value: now });
  await tx.done;
}

/** Puts register entries that are still off the map at their starting positions, once. Marked rough. */
export async function ensureStartPositions() {
  if (await getMeta('startPositionsAt')) return;
  const d = await db();
  const now = new Date().toISOString();
  const tx = d.transaction(['features', 'meta'], 'readwrite');
  for (const [id, geometry] of Object.entries(START_POSITIONS)) {
    const f = await tx.objectStore('features').get(id);
    if (f?.positionStatus === 'unplaced') await tx.objectStore('features').put({ ...f, geometry, positionStatus: 'rough', updatedAt: now });
  }
  await tx.objectStore('meta').put({ key: 'startPositionsAt', value: now });
  await tx.done;
}

export const loadAll = async () => {
  const d = await db();
  const [features, observations, taxa, parties] = await Promise.all([
    d.getAll('features'),
    d.getAll('observations'),
    d.getAll('taxa'),
    d.getAll('parties'),
  ]);
  return { features, observations, taxa: taxa.sort((a, b) => a.name.localeCompare(b.name)), parties };
};

export async function putFeature(f: Feature) {
  await (await db()).put('features', { ...f, updatedAt: new Date().toISOString() });
}
export async function deleteFeature(id: string) {
  const d = await db();
  const obs = await d.getAllFromIndex('observations', 'byFeature', id);
  const tx = d.transaction(['features', 'observations', 'photos'], 'readwrite');
  for (const o of obs) {
    for (const p of o.photoIds) await tx.objectStore('photos').delete(p);
    await tx.objectStore('observations').delete(o.id);
  }
  await tx.objectStore('features').delete(id);
  await tx.done;
}
export async function putObservation(o: Observation) {
  await (await db()).put('observations', o);
}
export async function putPhoto(p: PhotoRecord) {
  await (await db()).put('photos', p);
}
export async function getPhoto(id: string) {
  return (await db()).get('photos', id);
}
export async function putTaxon(t: Taxon) {
  await (await db()).put('taxa', t);
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
