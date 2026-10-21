import type { Geometry } from './model';
import { shape } from './geo';

// Starting positions for register entries, so the map isn't empty before anyone has walked the
// garden. Estimated in October 2026 from Esri aerial imagery and OpenStreetMap (the two terrace
// flowerbeds in Riverside Gardens are OpenStreetMap's outlines). The moat and island are the
// outline traced in the app on 21/10/2026. All of them load as rough: check each on site and use
// Refine position. Which outline belongs to which bed is a best guess from the names and notes.

type Pt = [number, number];

const point = (coordinates: Pt): Geometry => ({ type: 'Point', coordinates });
const line = (coordinates: Pt[]): Geometry => ({ type: 'LineString', coordinates });

const MOAT_EDGE: Pt[] = [
  [-0.0704142, 51.5013935],
  [-0.0694459, 51.5012806],
  [-0.0693598, 51.5015988],
  [-0.0700432, 51.5016838],
];

const ISLAND: Pt[] = [
  [-0.0694735, 51.5015444],
  [-0.0695412, 51.501317],
  [-0.0701971, 51.5014057],
  [-0.0699846, 51.5016066],
];

export const START_POSITIONS: Record<string, Geometry> = {
  'water-moat': shape([[MOAT_EDGE, ISLAND]]),
  'bed-dingley-dell': shape([[ISLAND]]),
  'vent-island-1': shape([
    [
      [
        [-0.0697907, 51.5014808],
        [-0.0697049, 51.5014745],
        [-0.069709, 51.5014223],
        [-0.0697938, 51.5014273],
      ],
    ],
  ]),
  'vent-island-2': shape([
    [
      [
        [-0.069991, 51.5015018],
        [-0.0699215, 51.5014974],
        [-0.0699297, 51.5014592],
        [-0.0700012, 51.5014643],
      ],
    ],
  ]),
  'tree-silver-birch-island-1': point([-0.0699522, 51.5015763]),
  'tree-silver-birch-island-2': point([-0.0698296, 51.5015655]),
  'tree-silver-birch-island-3': point([-0.0696508, 51.5015591]),
  'tree-silver-birch-island-4': point([-0.0700594, 51.5014541]),
  'tree-silver-birch-island-5': point([-0.0698704, 51.5014223]),

  // The garden strip between the river walk and the moat (either side of the path to the island),
  // the planting at the west end of the terrace, and the two terrace flowerbeds.
  'bed-riverside': shape([
    [
      [
        [-0.0699871, 51.5017869],
        [-0.0696186, 51.5017414],
        [-0.0696299, 51.501638],
        [-0.069982, 51.5016772],
      ],
    ],
    [
      [
        [-0.0695846, 51.5017375],
        [-0.0693834, 51.5017124],
        [-0.0693683, 51.5016066],
        [-0.0695921, 51.5016333],
      ],
    ],
    [
      [
        [-0.0699015, 51.5019389],
        [-0.0697104, 51.5019076],
        [-0.0697305, 51.5018778],
        [-0.0698965, 51.5018809],
      ],
    ],
    [
      [
        [-0.0696161, 51.5018858],
        [-0.0696954, 51.5018755],
        [-0.0697003, 51.5018899],
        [-0.0696296, 51.5019262],
      ],
    ],
    [
      [
        [-0.0695694, 51.5018714],
        [-0.0695927, 51.5018239],
        [-0.0697413, 51.5018517],
      ],
    ],
  ]),
  // Planting at the east end of the terrace, beside Providence Tower.
  'bed-tower': shape([
    [
      [
        [-0.0695041, 51.5019123],
        [-0.0693985, 51.5019154],
        [-0.0693331, 51.5017947],
        [-0.0694261, 51.501783],
        [-0.0694915, 51.5018104],
      ],
    ],
  ]),
  // The straight path from the river walk to the moat.
  'path-topiary-alley': line([
    [-0.0696022, 51.5017383],
    [-0.0696047, 51.5016341],
  ]),
  'bed-car-park': shape([
    [
      [
        [-0.0694044, 51.5012451],
        [-0.0691322, 51.5012307],
        [-0.0690858, 51.5011769],
        [-0.0693978, 51.5011748],
      ],
    ],
    [
      [
        [-0.0691687, 51.5011541],
        [-0.0690924, 51.5011541],
        [-0.0691057, 51.5010424],
        [-0.0691687, 51.5010445],
      ],
    ],
  ]),
  'tree-scots-pine-car-park': point([-0.0691438, 51.5011996]),
  // Along the road in front of 48-110.
  'hedge-cotoneaster': line([
    [-0.0702972, 51.5011314],
    [-0.0699819, 51.5011107],
    [-0.0699454, 51.5011045],
    [-0.0694592, 51.5010755],
  ]),
};
