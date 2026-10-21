// Data model. Shaped as Firestore collections so a backup imports straight in later:
//   features/{id}, observations/{id}, photos/{id} (binary goes to Cloud Storage), taxa/{id}, parties/{id}

export type GeometryKind = 'point' | 'line' | 'polygon';

export type Geometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }
  /** An area in separate pieces, such as Riverside Gardens. */
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] };

/** How much we trust a feature's position. */
export type PositionStatus = 'unplaced' | 'rough' | 'refined';

export interface Feature {
  id: string;
  /** Key into the catalogue, e.g. 'specimen', 'drift', 'bird-feeder'. */
  type: string;
  name: string;
  geometry: Geometry | null;
  positionStatus: PositionStatus;
  /** Horizontal accuracy in metres of the GPS fix used for a rough position. */
  gpsAccuracy?: number;
  taxonId?: string;
  /** Bed or area this feature sits in. */
  parentId?: string;
  quantity?: number;
  notes?: string;
  /** Where the record came from, e.g. 'Plant schedule 29/10/2018'. */
  source?: string;
  /** Free-form attributes specific to a type (pot size, girth, feed type...). */
  attrs?: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}

export type ObservationKind = 'photo' | 'note' | 'flowering' | 'fruiting' | 'condition' | 'sighting' | 'maintenance';

export interface Observation {
  id: string;
  featureId: string;
  kind: ObservationKind;
  at: string;
  text?: string;
  photoIds: string[];
  /** Where the observer stood, if known. */
  location?: { lng: number; lat: number; accuracy: number };
}

export interface PhotoRecord {
  id: string;
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  takenAt: string;
}

export interface Taxon {
  id: string;
  name: string;
  genus: string;
  common?: string;
}

export interface Party {
  id: string;
  name: string;
  role: string;
  notes?: string;
}
