import type { Feature, Party, Taxon } from './model';
import plantings from './data/plantings2018.json';

// Reference data taken from the 2018 Garden Master Plan, plant schedule and tree list.
// Everything starts unplaced: the field tool is how it gets onto the map.

const SCHEDULE = 'Plant schedule 29/10/2018';
const TREES = 'Tree list 10/10/2018';
const MASTER = 'Garden Master Plan 05/11/2018';

type Seed = Omit<Feature, 'createdAt' | 'updatedAt' | 'positionStatus' | 'geometry'>;

const AREAS: Seed[] = [
  { id: 'bed-dingley-dell', type: 'bed', name: 'Dingley Dell (the island)', source: MASTER, notes: 'Clay soil, pH 6. Only about 40cm of topsoil over the underground car park. Includes the Mimosa and Catalpa beds.' },
  { id: 'bed-mimosa', type: 'bed', name: 'Mimosa Bed', parentId: 'bed-dingley-dell', source: MASTER },
  { id: 'bed-catalpa', type: 'bed', name: 'Catalpa Bed', parentId: 'bed-dingley-dell', source: MASTER },
  { id: 'bed-roadside-east', type: 'bed', name: 'Roadside Bed East Side', source: MASTER, notes: 'Open, friable soil, pH 7 to 7.5.' },
  { id: 'bed-roadside-west', type: 'bed', name: 'Roadside Bed West Side', source: MASTER, notes: 'Open, friable soil, pH 7 to 7.5. Two air vents run through this bed on the planting plan.' },
  { id: 'bed-border-reception', type: 'bed', name: 'Border Behind Reception', source: MASTER, notes: 'Clay soil.' },
  { id: 'bed-tower', type: 'bed', name: 'Tower Bed', source: MASTER },
  { id: 'bed-mugho', type: 'bed', name: 'Mugho Bed', source: MASTER },
  { id: 'bed-elizabeth', type: 'bed', name: "Elizabeth's Bed", source: MASTER },
  { id: 'bed-riverside', type: 'bed', name: 'Riverside Gardens', source: MASTER, notes: 'Silver birch frame the view of the Thames and Tower Bridge.' },
  { id: 'bed-car-park', type: 'bed', name: 'Overground car park beds', source: MASTER, notes: 'Soil pH 7.5.' },
  { id: 'area-reception-plaza', type: 'bed', name: 'Reception Plaza', source: MASTER },
  { id: 'path-topiary-alley', type: 'path', name: 'Topiary Alley', source: MASTER, notes: 'Box lining both sides of the path. Keep the symmetry.' },
  { id: 'water-moat', type: 'water-body', name: 'The moat', source: MASTER, notes: 'Ornamental moat with carp. Fountain, aeration returns and floating duck houses.' },
  { id: 'vent-island-1', type: 'air-vent', name: 'Island air vent 1', parentId: 'bed-dingley-dell', source: MASTER, notes: 'Climbers on support wires, including Fallopia baldschuanica. Prune hard before the weight breaks the wires.' },
  { id: 'vent-island-2', type: 'air-vent', name: 'Island air vent 2', parentId: 'bed-dingley-dell', source: MASTER },
  { id: 'hedge-cotoneaster', type: 'hedge', name: 'Cotoneaster hedge (roadside)', source: MASTER, notes: 'Keep 30 to 40cm back from the railings. Prune late winter, outside nesting season.' },
];

const EXTRA_TREES: Seed[] = [
  { id: 'tree-betula-utilis-tower-1', type: 'tree', name: 'Himalayan birch 1', taxonId: 'taxon-betula-utilis-var-jacquemontii', parentId: 'bed-tower', source: 'Tree estimate 19/06/2018', notes: 'Replacement for silver birch T12, a condition of the Southwark consent. Check whether planted.' },
  { id: 'tree-betula-utilis-tower-2', type: 'tree', name: 'Himalayan birch 2', taxonId: 'taxon-betula-utilis-var-jacquemontii', parentId: 'bed-tower', source: 'Tree estimate 19/06/2018', notes: 'Replacement for silver birch T12. Check whether planted.' },
  { id: 'tree-scots-pine-car-park', type: 'tree', name: 'Scots pine (car park)', taxonId: 'taxon-pinus-sylvestris', parentId: 'bed-car-park', source: MASTER, notes: 'Over 20m. Southwark refused removal in 2018. Annual inspection by the tree surgeons. Roots lifting car park paving.', attrs: { tpo: true } },
  { id: 'tree-silver-birch-t12', type: 'tree', name: 'Silver birch T12', taxonId: 'taxon-betula-pendula', parentId: 'bed-tower', source: MASTER, notes: 'Approved for removal in 2018 if replaced by two Himalayan birch. Confirm whether it is still there.', attrs: { tpo: true, treeRef: 'T12' } },
  ...[1, 2, 3, 4, 5].map((n): Seed => ({ id: `tree-silver-birch-island-${n}`, type: 'tree', name: `Island silver birch ${n}`, taxonId: 'taxon-betula-pendula', parentId: 'bed-dingley-dell', source: MASTER, notes: 'One of five island birches due a light structural prune.', attrs: { tpo: true } })),
];

const EXTRA_TAXA: Taxon[] = [
  { id: 'taxon-betula-utilis-var-jacquemontii', name: 'Betula utilis var. jacquemontii', genus: 'Betula', common: 'West Himalayan birch' },
  { id: 'taxon-betula-pendula', name: 'Betula pendula', genus: 'Betula', common: 'Silver birch' },
  { id: 'taxon-pinus-sylvestris', name: 'Pinus sylvestris', genus: 'Pinus', common: 'Scots pine' },
  { id: 'taxon-buxus-sempervirens', name: 'Buxus sempervirens', genus: 'Buxus', common: 'Box' },
  { id: 'taxon-fallopia-baldschuanica', name: 'Fallopia baldschuanica', genus: 'Fallopia', common: 'Russian vine' },
  { id: 'taxon-cotoneaster', name: 'Cotoneaster', genus: 'Cotoneaster' },
  { id: 'taxon-photinia', name: 'Photinia', genus: 'Photinia' },
];

const BED_FOR_LOCATION: Record<string, string> = {
  'Roadside Bed West Side': 'bed-roadside-west',
  'Reception Plaza': 'area-reception-plaza',
  'Mugho bed': 'bed-mugho',
  "Elizabeth's Bed": 'bed-elizabeth',
  'Roadside Bed West & East Sides': 'bed-roadside-west',
};

export const SEED_TAXA: Taxon[] = [...(plantings.taxa as Taxon[]), ...EXTRA_TAXA].sort((a, b) => a.name.localeCompare(b.name));
const TAXON_NAME = Object.fromEntries(SEED_TAXA.map((t) => [t.id, t.name]));

export function seedFeatures(now: string): Feature[] {
  const drifts: Seed[] = plantings.drifts.map((d) => ({
    id: d.id,
    type: d.quantity === 1 ? 'specimen' : 'drift',
    name: TAXON_NAME[d.taxonId],
    taxonId: d.taxonId,
    parentId: d.bedId,
    quantity: d.quantity,
    source: SCHEDULE,
    notes: d.note ?? undefined,
    attrs: { potSize: d.potSize },
  }));
  const trees: Seed[] = plantings.trees2018.map((t, _i, all) => {
    const same = all.filter((x) => x.taxonId === t.taxonId && x.location === t.location);
    const n = same.indexOf(t) + 1;
    const split = t.location.includes('&');
    return {
      id: t.id,
      type: 'tree',
      name: `${TAXON_NAME[t.taxonId]}${same.length > 1 ? ` ${n}` : ''}`,
      taxonId: t.taxonId,
      parentId: split ? (n === 1 ? 'bed-roadside-west' : 'bed-roadside-east') : BED_FOR_LOCATION[t.location],
      source: TREES,
      notes: `Planned for ${t.location}. Supplied as ${t.size}. Check on site.`,
    };
  });
  return [...AREAS, ...EXTRA_TREES, ...trees, ...drifts].map((s) => ({
    ...s,
    geometry: null,
    positionStatus: 'unplaced',
    createdAt: now,
    updatedAt: now,
  }));
}

export const SEED_PARTIES: Party[] = [
  { id: 'party-jira-gsc', name: 'JIRA Garden Sub-Committee', role: 'Oversight of garden services on behalf of residents' },
  { id: 'party-rtm', name: 'RTM company directors', role: 'Named as a stakeholder in the 2018 master plan' },
  { id: 'party-firstport', name: 'FirstPort', role: 'Managing agent. Holds the approved supplier list' },
  { id: 'party-gardening-team', name: 'Gardening team', role: 'Day-to-day garden maintenance' },
  { id: 'party-bartlett', name: 'Bartlett Tree Experts', role: 'Tree surgeons. Prepare and submit TPO applications' },
  { id: 'party-southwark', name: 'Southwark Council planning', role: 'Conservation area and TPO consents (8 week lead time, valid 2 years)' },
  { id: 'party-crosfield', name: 'Sam Crosfield Garden Design', role: 'Author of the 2018 master plan and planting plans' },
  { id: 'party-provender', name: 'Provender Nurseries', role: 'Wholesale trees and plants, Kent' },
];

/** Recurring work named in the 2018 documents. Kept as data for the calendar that comes later. */
export const SEED_RULES = [
  { id: 'rule-water-new', what: 'Water new planting', when: 'Weekly during dry periods', source: 'Implementation plan' },
  { id: 'rule-stakes', what: 'Check tree ties and stakes; remove after two years', when: 'Quarterly', source: 'Implementation plan' },
  { id: 'rule-malus-edges', what: 'Recut tree circle edges for the two Malus', when: 'Annually', source: 'Implementation plan' },
  { id: 'rule-divide', what: 'Split and divide herbaceous perennials', when: 'Every three years', source: 'Implementation plan' },
  { id: 'rule-mulch', what: 'Mulch tree bases, shrubs and herbaceous', when: 'January to February', source: 'Implementation plan' },
  { id: 'rule-tree-survey', what: 'Winter tree survey with the tree surgeons', when: 'December to February', source: MASTER },
  { id: 'rule-tree-visit', what: 'Tree surgeon site visit to plan the year', when: 'April to May', source: MASTER },
  { id: 'rule-tpo-deadline', what: 'Submit TPO applications', when: 'By end of June', source: MASTER },
  { id: 'rule-tree-work', what: 'Tree work', when: 'Late summer', source: MASTER },
  { id: 'rule-hedge', what: 'Prune Cotoneaster hedge back from railings', when: 'Late winter, before nesting season', source: MASTER },
  { id: 'rule-pine', what: 'Inspect the Scots pine', when: 'Annually', source: MASTER },
  { id: 'rule-vents', what: 'Prune climbers on the island air vents', when: 'Before the wires are overloaded', source: MASTER },
];
