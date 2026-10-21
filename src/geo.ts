import type { Geometry } from './model';

export interface Fix {
  lng: number;
  lat: number;
  accuracy: number;
}

/**
 * Watches the GPS and reports each improving fix. Phones usually start at 30-60m and settle
 * over 10-20 seconds; between tall buildings 5-15m is about as good as it gets.
 */
export function watchFix(onFix: (f: Fix) => void, onError: (msg: string) => void): () => void {
  if (!('geolocation' in navigator)) {
    onError('This browser has no location access.');
    return () => {};
  }
  let best: Fix | null = null;
  const id = navigator.geolocation.watchPosition(
    (p) => {
      const f = { lng: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy };
      if (!best || f.accuracy <= best.accuracy) {
        best = f;
        onFix(f);
      }
    },
    (e) => onError(e.code === e.PERMISSION_DENIED ? 'Location permission is off. Allow it in your browser settings, or place by hand.' : 'No GPS fix yet. You can place by hand.'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

async function resize(file: Blob, max: number, quality: number) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode photo'))), 'image/jpeg', quality));
  return { blob, w, h };
}

/** Phone photos are 3-6MB; 1600px JPEG is plenty for ID and keeps the store small. */
export async function preparePhoto(file: Blob) {
  const full = await resize(file, 1600, 0.82);
  const thumb = await resize(file, 360, 0.7);
  return { blob: full.blob, thumb: thumb.blob, width: full.w, height: full.h };
}

type Pt = [number, number];

export function pointInPolygon([x, y]: Pt, ring: Pt[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer edge of a polygon and not in any of its holes. */
export function inPolygon(pt: Pt, rings: Pt[][]) {
  return pointInPolygon(pt, rings[0]) && !rings.slice(1).some((hole) => pointInPolygon(pt, hole));
}

/** Rings without the closing point repeated. */
export function openRings(g: Extract<Geometry, { type: 'Polygon' }>): Pt[][] {
  return g.coordinates.map((r) => r.slice(0, -1));
}

/** Positive when the ring runs anticlockwise. */
function signedArea(ring: Pt[]) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
}

/**
 * A polygon from open rings: the outer edge first, then any holes (an island in the moat).
 * Wound as RFC 7946 asks, outer anticlockwise and holes clockwise, because MapLibre fills a
 * hole that runs the same way as the outer edge.
 */
export function polygon(rings: Pt[][]): Geometry {
  return {
    type: 'Polygon',
    coordinates: rings.map((r, i) => {
      const wound = signedArea(r) > 0 === (i === 0) ? r : [...r].reverse();
      return [...wound, wound[0]];
    }),
  };
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points; fine at garden scale. */
export function distance(a: Pt, b: Pt) {
  const x = rad(b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  const y = rad(b[1] - a[1]);
  return Math.sqrt(x * x + y * y) * R;
}

export function ringArea(ring: Pt[]) {
  const lat0 = rad(ring[0][1]);
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    s += rad(x1) * Math.cos(lat0) * rad(y2) - rad(x2) * Math.cos(lat0) * rad(y1);
  }
  return Math.abs((s * R * R) / 2);
}

export function measure(g: Geometry | null): string | null {
  if (!g) return null;
  if (g.type === 'Polygon') return `${g.coordinates.reduce((s, r, i) => s + (i ? -1 : 1) * ringArea(r), 0).toFixed(0)} m²`;
  if (g.type === 'LineString') {
    let d = 0;
    for (let i = 1; i < g.coordinates.length; i++) d += distance(g.coordinates[i - 1], g.coordinates[i]);
    return `${d.toFixed(1)} m`;
  }
  return null;
}

export function centre(g: Geometry): Pt {
  if (g.type === 'Point') return g.coordinates;
  const pts = g.type === 'Polygon' ? g.coordinates[0].slice(0, -1) : g.coordinates;
  const n = pts.length;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

/** Every corner, holes included, so each one gets a drag handle. */
export function vertices(g: Geometry): Pt[] {
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'Polygon') return openRings(g).flat();
  return g.coordinates;
}

export function withVertices(g: Geometry, pts: Pt[]): Geometry {
  if (g.type === 'Point') return { type: 'Point', coordinates: pts[0] };
  if (g.type === 'Polygon') {
    // Keeps the corner order so drag handles stay on their corners; polygon() fixes the winding on save.
    let at = 0;
    return { type: 'Polygon', coordinates: openRings(g).map((r) => pts.slice(at, (at += r.length))).map((r) => [...r, r[0]]) };
  }
  return { type: 'LineString', coordinates: pts };
}

/** A circle polygon for drawing GPS accuracy on the map. */
export function circle([lng, lat]: Pt, metres: number, steps = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lng + ((metres * Math.cos(a)) / (R * Math.cos(rad(lat)))) * (180 / Math.PI), lat + ((metres * Math.sin(a)) / R) * (180 / Math.PI)]);
  }
  return out;
}
