import type { GeometryKind } from './model';

export interface LayerDef {
  id: string;
  label: string;
}

export interface TypeDef {
  id: string;
  label: string;
  layer: string;
  geometry: GeometryKind;
  /** Colour token used on the map (works on aerial imagery in both themes). */
  colour: string;
  /** Plant types take a species. */
  plant?: boolean;
  /** Short hint shown while capturing. */
  hint?: string;
}

export const LAYERS: LayerDef[] = [
  { id: 'areas', label: 'Beds and areas' },
  { id: 'vegetation', label: 'Plants' },
  { id: 'water', label: 'Moat and water' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'power', label: 'Power' },
  { id: 'irrigation', label: 'Taps and irrigation' },
  { id: 'wildlife', label: 'Birds and wildlife' },
  { id: 'structures', label: 'Structures' },
];

export const TYPES: TypeDef[] = [
  { id: 'bed', label: 'Bed', layer: 'areas', geometry: 'polygon', colour: '#e8c547', hint: 'Trace the bed edge' },
  { id: 'lawn', label: 'Lawn', layer: 'areas', geometry: 'polygon', colour: '#b8e07a' },
  { id: 'path', label: 'Path', layer: 'areas', geometry: 'line', colour: '#d9d2c3' },

  { id: 'tree', label: 'Tree', layer: 'vegetation', geometry: 'point', colour: '#3fbf6f', plant: true, hint: 'Stand at the trunk' },
  { id: 'specimen', label: 'Specimen plant', layer: 'vegetation', geometry: 'point', colour: '#7be0a0', plant: true, hint: 'Stand next to the plant' },
  { id: 'drift', label: 'Planting group', layer: 'vegetation', geometry: 'polygon', colour: '#5fd38d', plant: true, hint: 'Outline the group of plants' },
  { id: 'hedge', label: 'Hedge', layer: 'vegetation', geometry: 'line', colour: '#2e9e5b', plant: true },
  { id: 'climber', label: 'Climber', layer: 'vegetation', geometry: 'point', colour: '#a6e3b8', plant: true },

  { id: 'water-body', label: 'Moat or pond', layer: 'water', geometry: 'polygon', colour: '#4fb3e8' },
  { id: 'fountain', label: 'Fountain', layer: 'water', geometry: 'point', colour: '#7fd4ff' },
  { id: 'aerator-return', label: 'Aeration return', layer: 'water', geometry: 'point', colour: '#3c9fd6' },
  { id: 'pump', label: 'Pump or filter', layer: 'water', geometry: 'point', colour: '#2a7fb8' },
  { id: 'duck-house', label: 'Duck house', layer: 'water', geometry: 'point', colour: '#c9e9ff' },

  { id: 'light-post', label: 'Path light', layer: 'lighting', geometry: 'point', colour: '#ffd84d' },
  { id: 'uplighter', label: 'Uplighter', layer: 'lighting', geometry: 'point', colour: '#ffb23e' },

  { id: 'power-outlet', label: 'Power outlet', layer: 'power', geometry: 'point', colour: '#ff6b6b' },
  { id: 'power-box', label: 'Distribution box', layer: 'power', geometry: 'point', colour: '#e04848' },
  { id: 'cable-run', label: 'Cable run', layer: 'power', geometry: 'line', colour: '#ff8a8a', hint: 'Trace the known route' },

  { id: 'tap', label: 'Tap', layer: 'irrigation', geometry: 'point', colour: '#5ad1c9' },
  { id: 'sprinkler', label: 'Sprinkler', layer: 'irrigation', geometry: 'point', colour: '#8ae8e1' },
  { id: 'water-butt', label: 'Water butt', layer: 'irrigation', geometry: 'point', colour: '#39a89f' },
  { id: 'irrigation-line', label: 'Irrigation pipe', layer: 'irrigation', geometry: 'line', colour: '#5ad1c9' },

  { id: 'bird-feeder', label: 'Bird feeder', layer: 'wildlife', geometry: 'point', colour: '#d18cff' },
  { id: 'nest-box', label: 'Nest box', layer: 'wildlife', geometry: 'point', colour: '#b066f0' },
  { id: 'bee-hotel', label: 'Bee hotel', layer: 'wildlife', geometry: 'point', colour: '#e9b8ff' },

  { id: 'air-vent', label: 'Air vent', layer: 'structures', geometry: 'polygon', colour: '#b0b8c0' },
  { id: 'planter', label: 'Planter', layer: 'structures', geometry: 'point', colour: '#c8a27a' },
  { id: 'bench', label: 'Bench', layer: 'structures', geometry: 'point', colour: '#a08a70' },
  { id: 'store', label: 'Store or shed', layer: 'structures', geometry: 'point', colour: '#8c7a66' },
];

export const TYPE_BY_ID: Record<string, TypeDef> = Object.fromEntries(TYPES.map((t) => [t.id, t]));

export function typeOf(id: string): TypeDef {
  return TYPE_BY_ID[id] ?? { id, label: id, layer: 'structures', geometry: 'point', colour: '#cccccc' };
}
