import { Noise2D, clamp, lerp, smoothstep } from '../math/noise';

/**
 * The island: four regions laid out after the reference world map (Snow in the north, Deep Forest in the west,
 * Hill in the east, Plain in the south), sized to their stated areas, with their landmarks, roads, rivers and lakes.
 *
 * Everything is authored in the pixel space of the reference map (1672 x 941, north up) and mapped into world
 * metres (x east, z south) so that Plain City sits on the detailed 2.56 km valley around base camp. The map is drawn
 * in perspective, so the vertical axis is stretched by ASPECT to get a top-down shape. The overall scale and the
 * region weights are fitted (tools/fit-island.ts) so the land is 1,170 km² and each region has its stated area;
 * tests/gameplay/island.test.ts checks this by sampling.
 */

export type RegionId = 'snow' | 'hill' | 'plain' | 'forest';
export interface RegionInfo {
  id: RegionId; name: string;
  /** stated area in km² */
  area: number;
  lv: [number, number];
  terrain: string; habitat: string; difficulty: string;
  /** map colours: border glow and label */
  color: string;
}
export const REGIONS: RegionInfo[] = [
  { id: 'snow', name: 'Snow Region', area: 280, lv: [20, 40], terrain: 'Snow / Ice / Glacier', habitat: 'Glaciers / Outposts', difficulty: 'High – Extreme', color: '#7fd4ff' },
  { id: 'hill', name: 'Hill Region', area: 120, lv: [10, 20], terrain: 'Hills / Forest', habitat: 'Lakes / Hill towns', difficulty: 'Medium', color: '#ffb52e' },
  { id: 'plain', name: 'Plain Region', area: 450, lv: [1, 20], terrain: 'Open Plains', habitat: 'Villages / Farms', difficulty: 'Low – Medium', color: '#c8e84a' },
  { id: 'forest', name: 'Deep Forest Region', area: 320, lv: [15, 35], terrain: 'Dense Forest', habitat: 'Wildlife / Ruins', difficulty: 'Medium – High', color: '#3ee070' },
];
export const REGION_BY_ID = Object.fromEntries(REGIONS.map(r => [r.id, r])) as Record<RegionId, RegionInfo>;
export const ISLAND_AREA_KM2 = REGIONS.reduce((a, r) => a + r.area, 0);

export type PoiKind =
  | 'camp' | 'city' | 'village' | 'gang' | 'garage' | 'fuel' | 'race' | 'explorer' | 'lookout' | 'lab' | 'cave' | 'gate'
  | 'peak' | 'cablecar' | 'rescue' | 'hazard' | 'lake' | 'waterfall' | 'ruins' | 'wildlife' | 'resource' | 'collectible'
  | 'mission' | 'depot' | 'farm';
export interface Poi {
  id: string; name: string; sub?: string; kind: PoiKind; region: RegionId;
  x: number; z: number;
  /** gang size */
  members?: number;
  /** true when the place exists in the 3D world; false while it is only on the map */
  built: boolean;
}

/** Map pixel → world metres. The fitted scale lives in ISLAND_FIT. */
const HUB_PX: [number, number] = [825, 630];
const HUB_WORLD: [number, number] = [830, 120];
const ASPECT = 1.3;

/** Fitted by tools/fit-island.ts (scale in metres per map pixel, power-diagram weights in m²). */
export const ISLAND_FIT = { scale: 31.887, weights: { snow: -6942465, hill: -81927606, plain: 9083834, forest: 24038707 } as Record<RegionId, number> };

// ---------------------------------------------------------------- authored data (reference-map pixels)
const COAST_PX: [number, number][] = [
  [330, 200], [450, 168], [560, 120], [680, 80], [790, 62], [900, 85], [1020, 120], [1120, 168], [1200, 212], [1290, 250],
  [1370, 318], [1422, 410], [1442, 500], [1432, 592], [1402, 660], [1350, 722], [1334, 792], [1272, 850], [1150, 890],
  [1000, 906], [850, 902], [700, 896], [560, 880], [430, 850], [318, 800], [250, 730], [180, 664], [100, 612], [55, 530],
  [50, 440], [82, 360], [150, 290], [240, 236],
];
const SEEDS_PX: [RegionId, number, number][] = [
  ['snow', 790, 150], ['snow', 610, 245], ['snow', 960, 205], ['snow', 800, 330],
  ['hill', 1190, 340], ['hill', 1300, 470], ['hill', 1210, 580], ['hill', 1350, 610],
  ['forest', 200, 420], ['forest', 380, 330], ['forest', 480, 470], ['forest', 300, 560],
  ['plain', 825, 690], ['plain', 560, 760], ['plain', 1080, 760], ['plain', 400, 790], ['plain', 830, 830], ['plain', 680, 610],
];

type PoiPx = Omit<Poi, 'x' | 'z' | 'built'> & { px: number; py: number; built?: boolean; at?: [number, number] };
const POIS_PX: PoiPx[] = [
  // Plain region (Plain City is the detailed valley around base camp)
  { id: 'plain-city', name: 'Plain City', sub: 'Main City Hub', kind: 'city', region: 'plain', px: 825, py: 630, at: [830, 120], built: true },
  { id: 'base-camp', name: 'Redstone Base Camp', sub: 'Spawn / Repair / Fuel', kind: 'camp', region: 'plain', px: 800, py: 630, at: [0, 0], built: true },
  { id: 'millbrook', name: 'Millbrook', sub: 'Town', kind: 'village', region: 'plain', px: 790, py: 615, at: [-770, -700], built: true },
  { id: 'ashby', name: 'Ashby Hollow', sub: 'Village', kind: 'village', region: 'plain', px: 800, py: 650, at: [-420, 860], built: true },
  { id: 'north-plains', name: 'North Plains Village', kind: 'village', region: 'plain', px: 700, py: 548 },
  { id: 'gang-camp', name: 'Gang Camp', kind: 'gang', region: 'plain', members: 12, px: 935, py: 570 },
  { id: 'hill-overlook', name: 'View Point', sub: 'Hill Overlook', kind: 'lookout', region: 'plain', px: 1080, py: 590 },
  { id: 'agro-farm', name: 'Agro Farm', kind: 'farm', region: 'plain', px: 470, py: 625 },
  { id: 'race-track', name: 'Off-Road Race Track', kind: 'race', region: 'plain', px: 585, py: 668 },
  { id: 'plain-fuel', name: 'Fuel Station', kind: 'fuel', region: 'plain', px: 1015, py: 652 },
  { id: 'east-plains', name: 'East Plains Village', kind: 'village', region: 'plain', px: 1110, py: 722 },
  { id: 'logistics', name: 'Logistics Depot', kind: 'depot', region: 'plain', px: 335, py: 695 },
  { id: 'west-plains', name: 'West Plains Village', kind: 'village', region: 'plain', px: 430, py: 732 },
  { id: 'service-garage', name: 'Service Garage', sub: 'Upgrade & Repair', kind: 'garage', region: 'plain', px: 915, py: 718 },
  { id: 'explorer-camp', name: 'Explorer Camp', sub: 'Save & Rest', kind: 'explorer', region: 'plain', px: 895, py: 808 },
  // Hill region
  { id: 'gang-1', name: 'Gang Leader 1', kind: 'gang', region: 'hill', members: 13, px: 1165, py: 318 },
  { id: 'watch-tower', name: 'Watch Tower', kind: 'lookout', region: 'hill', px: 1290, py: 350 },
  { id: 'mountain-garage', name: 'Mountain Garage', kind: 'garage', region: 'hill', px: 1093, py: 380 },
  { id: 'gang-hideout', name: 'Gang Hideout', kind: 'gang', region: 'hill', px: 1268, py: 418 },
  { id: 'rescue-mission', name: 'Rescue Mission', kind: 'mission', region: 'hill', px: 1180, py: 420 },
  { id: 'hill-racing', name: 'Hill Racing Challenge', kind: 'race', region: 'hill', px: 1060, py: 460 },
  { id: 'hill-town', name: 'Hill Town', kind: 'village', region: 'hill', px: 1195, py: 565 },
  { id: 'treasure', name: 'Treasure Spot', kind: 'collectible', region: 'hill', px: 1320, py: 575 },
  { id: 'hill-falls', name: 'Hill Falls', kind: 'waterfall', region: 'hill', px: 1330, py: 520 },
  // Snow region
  { id: 'glacier-peak', name: 'Glacier Peak', sub: '4,872 m', kind: 'peak', region: 'snow', px: 790, py: 110 },
  { id: 'north-ridge', name: 'North Ridge Challenge', kind: 'race', region: 'snow', px: 560, py: 205 },
  { id: 'gang-3', name: 'Gang Leader 3', kind: 'gang', region: 'snow', members: 6, px: 705, py: 215 },
  { id: 'ice-canyon', name: 'Ice Canyon', kind: 'lookout', region: 'snow', px: 625, py: 300 },
  { id: 'radar', name: 'Radar Station', sub: 'Outpost', kind: 'lab', region: 'snow', px: 990, py: 168 },
  { id: 'snow-village', name: 'Snow Village', sub: 'Safe Zone', kind: 'village', region: 'snow', px: 935, py: 238 },
  { id: 'cable-car', name: 'Cable Car Station', kind: 'cablecar', region: 'snow', px: 1035, py: 290 },
  { id: 'frozen-lake', name: 'Frozen Lake', kind: 'lake', region: 'snow', px: 790, py: 262 },
  { id: 'research-base', name: 'Research Base', sub: 'Abandoned', kind: 'lab', region: 'snow', px: 525, py: 262 },
  { id: 'ice-caves', name: 'Ice Caves', sub: 'Hidden Loot', kind: 'cave', region: 'snow', px: 690, py: 338 },
  { id: 'rescue-outpost', name: 'Rescue Outpost', kind: 'rescue', region: 'snow', px: 960, py: 318 },
  { id: 'avalanche', name: 'Avalanche Zone', sub: 'High Risk', kind: 'hazard', region: 'snow', px: 870, py: 300 },
  { id: 'underground', name: 'Underground Entrance', kind: 'cave', region: 'snow', px: 900, py: 368 },
  { id: 'snow-rally', name: 'Snow Rally Challenge', kind: 'race', region: 'snow', px: 600, py: 360 },
  // Deep Forest region
  { id: 'highland-lookout', name: 'Highland Lookout', sub: 'View Point', kind: 'lookout', region: 'forest', px: 292, py: 290 },
  { id: 'ancient-ruins', name: 'Ancient Ruins', sub: 'Mystery', kind: 'ruins', region: 'forest', px: 431, py: 318 },
  { id: 'gang-4', name: 'Gang Leader 4', kind: 'gang', region: 'forest', members: 17, px: 560, py: 395 },
  { id: 'treehouse', name: 'Treehouse Camp', sub: 'Trader', kind: 'village', region: 'forest', px: 245, py: 352 },
  { id: 'forest-lake', name: 'Forest Lake', sub: 'Camp & Rest', kind: 'lake', region: 'forest', px: 364, py: 385 },
  { id: 'wildlife', name: 'Wildlife Zone', sub: 'High Risk', kind: 'wildlife', region: 'forest', px: 141, py: 420 },
  { id: 'waterfall-basin', name: 'Waterfall Basin', sub: 'Scenic Spot', kind: 'waterfall', region: 'forest', px: 470, py: 410 },
  { id: 'logging-camp', name: 'Logging Camp', sub: 'Resource', kind: 'resource', region: 'forest', px: 590, py: 470 },
  { id: 'bio-lab', name: 'Research Outpost', sub: 'Forest Bio Lab', kind: 'lab', region: 'forest', px: 355, py: 470 },
  { id: 'bunker', name: 'Abandoned Bunker', sub: 'Loot', kind: 'cave', region: 'forest', px: 140, py: 492 },
  { id: 'river-crossing', name: 'River Crossing', sub: 'Off-Road', kind: 'mission', region: 'forest', px: 240, py: 540 },
  { id: 'hidden-cave', name: 'Hidden Cave', sub: 'Special Loot', kind: 'cave', region: 'forest', px: 330, py: 545 },
  { id: 'swamp', name: 'Swamp Trails', sub: 'Extreme', kind: 'hazard', region: 'forest', px: 455, py: 525 },
  { id: 'rare-herbs', name: 'Rare Herbs Zone', sub: 'Collectible', kind: 'collectible', region: 'forest', px: 545, py: 545 },
  { id: 'forest-gate', name: 'Forest Gate', sub: 'Exit / Next Region', kind: 'gate', region: 'forest', px: 612, py: 578 },
];

export type IslandRoadKind = 'highway' | 'road' | 'trail';
/** control points: reference-map pixels, a place id, or world metres ({ x, z }) */
type Ctl = [number, number] | string | { x: number; z: number };
interface RoadPx { id: string; name: string; kind: IslandRoadKind; px: Ctl[] }
/**
 * Roads outside the detailed valley. Those that leave the valley start on its edge, where a link road in the
 * valley's own network (layout.ts, VALLEY_EXITS) joins them to Highway 1.
 */
export const VALLEY_EXITS = { north: { x: 500, z: -1280 }, west: { x: -1280, z: -300 }, east: { x: 1280, z: 120 }, south: { x: 160, z: 1280 } };
const EX = (e: { x: number; z: number }, out = 8) => ({ x: e.x + Math.sign(Math.abs(e.x) === 1280 ? e.x : 0) * out, z: e.z + Math.sign(Math.abs(e.z) === 1280 ? e.z : 0) * out });
const ROADS_PX: RoadPx[] = [
  { id: 'hw-north', name: 'Glacier Highway', kind: 'highway', px: [EX(VALLEY_EXITS.north), [800, 560], [770, 505], [760, 455], [800, 410], [860, 380], [905, 330], [920, 280], 'snow-village'] },
  { id: 'hw-west', name: 'Forest Highway', kind: 'highway', px: [EX(VALLEY_EXITS.west), [720, 610], [660, 595], 'forest-gate', [540, 520], [440, 488], 'bio-lab', [290, 420], 'treehouse'] },
  { id: 'hw-east', name: 'Hill Highway', kind: 'highway', px: [EX(VALLEY_EXITS.east), [930, 640], 'plain-fuel', [1080, 630], [1150, 590], 'hill-town', [1180, 500], [1120, 440], 'mountain-garage'] },
  { id: 'r-southwest', name: 'West Plains Road', kind: 'road', px: [EX(VALLEY_EXITS.south), [740, 690], [640, 712], [530, 730], 'west-plains', 'logistics'] },
  { id: 'r-plains-loop', name: 'Plains Loop', kind: 'road', px: ['logistics', [400, 650], 'agro-farm', 'race-track', [640, 600], 'north-plains', [820, 545], 'gang-camp', [1015, 585], 'hill-overlook', 'plain-fuel'] },
  { id: 'r-southeast', name: 'East Plains Road', kind: 'road', px: [EX(VALLEY_EXITS.south), 'service-garage', [1010, 735], 'east-plains', 'hill-town'] },
  { id: 'r-explorer', name: 'Explorer Road', kind: 'road', px: ['service-garage', [905, 765], 'explorer-camp'] },
  { id: 'r-hill-north', name: 'Lakeside Road', kind: 'road', px: ['hill-town', [1260, 540], 'gang-hideout', 'watch-tower', [1230, 300], 'gang-1'] },
  { id: 'r-hill-inner', name: 'Rescue Road', kind: 'road', px: [[1120, 440], 'rescue-mission', 'gang-hideout'] },
  { id: 'r-snow-west', name: 'Ridge Road', kind: 'road', px: [[760, 455], [700, 400], 'ice-caves', 'ice-canyon', 'gang-3', [620, 235], 'research-base', 'north-ridge'] },
  { id: 'r-snow-east', name: 'Radar Road', kind: 'road', px: ['snow-village', 'radar'] },
  { id: 'r-cable', name: 'Cable Car Road', kind: 'road', px: ['snow-village', [990, 262], 'cable-car', 'mountain-garage'] },
  { id: 'r-forest-south', name: 'Bunker Road', kind: 'road', px: ['bio-lab', 'hidden-cave', 'river-crossing', 'bunker', 'wildlife', 'treehouse'] },
];

interface RiverPx { id: string; name: string; px: [number, number][] }
/** Rivers run from source to mouth. */
const RIVERS_PX: RiverPx[] = [
  { id: 'glacier-river', name: 'Glacier River', px: [[790, 270], [800, 330], [790, 400], [770, 470], [745, 530], [700, 575], [640, 640], [655, 720], [700, 790], [720, 850], [735, 905]] },
  { id: 'forest-river', name: 'Jungle River', px: [[470, 405], [400, 400], [364, 385], [320, 440], [270, 500], [240, 540], [180, 590], [110, 620]] },
  { id: 'hill-river', name: 'Lake River', px: [[1180, 470], [1240, 500], [1300, 515], [1360, 540], [1438, 560]] },
];
interface LakePx { id: string; name: string; px: number; py: number; r: number; frozen?: boolean }
const LAKES_PX: LakePx[] = [
  { id: 'frozen-lake', name: 'Frozen Lake', px: 790, py: 270, r: 30, frozen: true },
  { id: 'forest-lake', name: 'Forest Lake', px: 364, py: 385, r: 20 },
  { id: 'hill-lake', name: 'Hill Lake', px: 1240, py: 500, r: 28 },
  { id: 'hill-tarn', name: 'Pine Tarn', px: 1130, py: 470, r: 12 },
];

// ---------------------------------------------------------------- runtime types
export interface IslandRoad { id: string; name: string; kind: IslandRoadKind; pts: [number, number][]; length: number }
export interface IslandRiver { id: string; name: string; pts: [number, number][]; /** water surface height at each point */ level: number[]; /** half width at each point */ hw: number[]; cum: number[] }
export interface IslandLake { id: string; name: string; x: number; z: number; r: number; level: number; frozen: boolean }
export interface Waterfall { x: number; z: number; top: number; bottom: number; river: string }

/** Catmull-Rom through control points, resampled about every `step` metres. */
function smoothLine(ctrl: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  const P = (i: number) => ctrl[clamp(i, 0, ctrl.length - 1)];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([...ctrl[ctrl.length - 1]]);
  return out;
}
const polyLength = (p: [number, number][]) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };

/** Distance from (x,z) to segment a-b, and the parameter along it. */
export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
  return [Math.hypot(x - ax - dx * t, z - az - dz * t), t];
}

export interface Fit { scale: number; weights: Record<RegionId, number> }

/** Spatial hash of polyline segments for nearest-segment queries. */
export class SegIndex {
  private cells = new Map<number, number[]>();
  readonly segs: { line: number; i: number; ax: number; az: number; bx: number; bz: number }[] = [];
  constructor(lines: [number, number][][], private cell: number, pad: number) {
    lines.forEach((pts, line) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], s = this.segs.length;
        this.segs.push({ line, i, ax, az, bx, bz });
        for (let cx = Math.floor((Math.min(ax, bx) - pad) / cell); cx <= Math.floor((Math.max(ax, bx) + pad) / cell); cx++)
          for (let cz = Math.floor((Math.min(az, bz) - pad) / cell); cz <= Math.floor((Math.max(az, bz) + pad) / cell); cz++) {
            const k = cx * 65536 + cz; let l = this.cells.get(k); if (!l) { l = []; this.cells.set(k, l); } l.push(s);
          }
      }
    });
  }
  near(x: number, z: number): readonly number[] { return this.cells.get(Math.floor(x / this.cell) * 65536 + Math.floor(z / this.cell)) ?? []; }
}

/**
 * The island model: coastline, regions, elevation, water and the road network. Pure functions of position, so any
 * part of the island can be generated on demand (terrain chunks, the world map) and client and server agree.
 */
export class Island {
  readonly fit: Fit;
  readonly coast: [number, number][];
  readonly seeds: { region: RegionId; x: number; z: number }[];
  readonly pois: Poi[];
  readonly roads: IslandRoad[] = [];
  readonly rivers: IslandRiver[] = [];
  readonly lakes: IslandLake[] = [];
  readonly waterfalls: Waterfall[] = [];
  /** world bounds of the island (with a sea margin) */
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;
  private noise = new Noise2D(9137);
  private n2 = new Noise2D(5521);
  private sdf: Float32Array;
  private sdfN: number; private sdfX: number; private sdfZ: number;
  private readonly sdfCell = 160;
  private riverIdx: SegIndex;
  private peak: Poi;
  private hillPeak: Poi;

  constructor(fit: Fit = ISLAND_FIT) {
    this.fit = fit;
    const W = (px: number, py: number): [number, number] => [HUB_WORLD[0] + (px - HUB_PX[0]) * fit.scale, HUB_WORLD[1] + (py - HUB_PX[1]) * fit.scale * ASPECT];
    this.coast = COAST_PX.map(([a, b]) => W(a, b));
    this.seeds = SEEDS_PX.map(([region, a, b]) => { const [x, z] = W(a, b); return { region, x, z }; });
    const xs = this.coast.map(p => p[0]), zs = this.coast.map(p => p[1]);
    this.minX = Math.min(...xs) - 3000; this.maxX = Math.max(...xs) + 3000;
    this.minZ = Math.min(...zs) - 3000; this.maxZ = Math.max(...zs) + 3000;
    // coarse signed distance to the authored coast polygon (positive inland)
    this.sdfX = this.minX; this.sdfZ = this.minZ;
    this.sdfN = Math.ceil(Math.max(this.maxX - this.minX, this.maxZ - this.minZ) / this.sdfCell) + 1;
    this.sdf = new Float32Array(this.sdfN * this.sdfN);
    for (let j = 0; j < this.sdfN; j++) for (let i = 0; i < this.sdfN; i++) {
      const x = this.sdfX + i * this.sdfCell, z = this.sdfZ + j * this.sdfCell;
      this.sdf[j * this.sdfN + i] = this.polyDist(x, z);
    }
    this.pois = POIS_PX.map(p => { const [x, z] = p.at ?? W(p.px, p.py); const { px: _a, py: _b, at: _c, ...rest } = p; return { ...rest, x, z, built: !!p.built }; });
    // the fitted borders move a little with the areas: walk any place that ended up over a border into its region
    for (const p of this.pois) {
      const own = this.seeds.filter(s => s.region === p.region);
      const cx = own.reduce((a, s) => a + s.x, 0) / own.length, cz = own.reduce((a, s) => a + s.z, 0) / own.length;
      for (let k = 0; k < 80 && this.regionAt(p.x, p.z) !== p.region; k++) { p.x += (cx - p.x) * 0.04; p.z += (cz - p.z) * 0.04; }
      // and a little further, so it is not right on the line
      for (let k = 0; k < 8 && !p.built && this.borderDist(p.x, p.z) < 600; k++) { p.x += (cx - p.x) * 0.03; p.z += (cz - p.z) * 0.03; }
    }
    const poiPos = new Map(this.pois.map(p => [p.id, [p.x, p.z] as [number, number]]));
    const ctl = (c: Ctl): [number, number] => typeof c === 'string' ? poiPos.get(c)! : Array.isArray(c) ? W(c[0], c[1]) : [c.x, c.z];
    this.peak = this.pois.find(p => p.id === 'glacier-peak')!;
    this.hillPeak = this.pois.find(p => p.id === 'gang-1')!;
    for (const r of ROADS_PX) { const pts = smoothLine(r.px.map(ctl), 25); this.roads.push({ id: r.id, name: r.name, kind: r.kind, pts, length: polyLength(pts) }); }
    this.buildTrails();
    for (const l of LAKES_PX) {
      const at = this.pois.find(p => p.id === l.id), [x, z] = at ? [at.x, at.z] : W(l.px, l.py);
      this.lakes.push({ id: l.id, name: l.name, x, z, r: l.r * fit.scale, level: 0, frozen: !!l.frozen });
    }
    // lakes sit in the land: their level is just under the lowest point of their shore
    for (const lk of this.lakes) {
      let lo = Infinity;
      for (let a = 0; a < 24; a++) { const ang = a / 24 * Math.PI * 2; lo = Math.min(lo, this.landHeight(lk.x + Math.cos(ang) * lk.r * 1.15, lk.z + Math.sin(ang) * lk.r * 1.15)); }
      lk.level = Math.max(1, lo - 2);
    }
    // rivers: surface level never rises downstream; steep drops become waterfalls
    for (const rv of RIVERS_PX) {
      const pts = smoothLine(rv.px.map(([a, b]) => W(a, b)), 40);
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = cum[cum.length - 1];
      const raw = pts.map(([x, z]) => this.lakeOrLand(x, z));
      // smooth along the river then make it monotone
      const sm = raw.map((_, i) => { let a = 0, c = 0; for (let k = -4; k <= 4; k++) { const q = clamp(i + k, 0, raw.length - 1); a += raw[q]; c++; } return a / c; });
      const level: number[] = [];
      let cur = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const t = cum[i] / L;
        const target = Math.min(sm[i], raw[i]) - 2.5 - 4 * t;
        cur = Math.min(cur, target);
        level.push(Math.max(cur, i === pts.length - 1 ? -0.5 : 0.4));
      }
      const hw = cum.map(c => lerp(6, 26, c / L));
      const river: IslandRiver = { id: rv.id, name: rv.name, pts, level, hw, cum };
      this.rivers.push(river);
      // a waterfall is a stretch where the river drops more than 1 in 3; neighbouring steps merge into one fall
      for (let i = 1; i < pts.length; i++) {
        if ((level[i - 1] - level[i]) / (cum[i] - cum[i - 1]) < 0.33) continue;
        let j = i; while (j + 1 < pts.length && (level[j] - level[j + 1]) / (cum[j + 1] - cum[j]) >= 0.33) j++;
        if (level[i - 1] - level[j] >= 12) this.waterfalls.push({ x: pts[i][0], z: pts[i][1], top: level[i - 1], bottom: level[j], river: rv.id });
        i = j;
      }
    }
    this.riverIdx = new SegIndex(this.rivers.map(r => r.pts), 400, 260);
  }

  /** Approximate metres to the nearest region border. */
  borderDist(x: number, z: number): number {
    const s = this.regionScores(x, z, this.sc); const v = [s.snow, s.hill, s.plain, s.forest].sort((a, b) => a - b);
    return (v[1] - v[0]) / 24000;
  }

  /** Off-road trails: every place not on a road gets a winding track to the nearest road. */
  private buildTrails() {
    const rng = new Noise2D(404);
    for (const p of this.pois) {
      if (p.built) continue;
      let best = Infinity, bx = 0, bz = 0;
      for (const r of this.roads) for (const [x, z] of r.pts) { const d = Math.hypot(x - p.x, z - p.z); if (d < best) { best = d; bx = x; bz = z; } }
      if (best < 120) continue;
      const n = Math.max(2, Math.ceil(best / 350)), ctrl: [number, number][] = [];
      const nx = -(bz - p.z) / best, nz = (bx - p.x) / best;
      for (let k = 0; k <= n; k++) {
        const t = k / n, wob = k === 0 || k === n ? 0 : rng.noise(p.x / 900 + k * 0.7, p.z / 900) * Math.min(400, best * 0.18);
        ctrl.push([lerp(bx, p.x, t) + nx * wob, lerp(bz, p.z, t) + nz * wob]);
      }
      const pts = smoothLine(ctrl, 25);
      this.roads.push({ id: `t-${p.id}`, name: `${p.name} Trail`, kind: 'trail', pts, length: polyLength(pts) });
    }
  }

  /** Exact signed distance to the authored polygon (positive inside). */
  private polyDist(x: number, z: number): number {
    const P = this.coast; let best = Infinity, inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, zi] = P[i], [xj, zj] = P[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      best = Math.min(best, segDist(x, z, xi, zi, xj, zj)[0]);
    }
    return inside ? best : -best;
  }

  /** Signed distance to the coastline in metres (positive on land), with a fractal shoreline. */
  coastDist(x: number, z: number): number {
    const fx = clamp((x - this.sdfX) / this.sdfCell, 0, this.sdfN - 1.001), fz = clamp((z - this.sdfZ) / this.sdfCell, 0, this.sdfN - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, N = this.sdfN, F = this.sdf;
    const d = (F[j * N + i] * (1 - u) + F[j * N + i + 1] * u) * (1 - v) + (F[(j + 1) * N + i] * (1 - u) + F[(j + 1) * N + i + 1] * u) * v;
    if (d > 2500 || d < -2500) return d;
    return d + this.noise.fbm(x / 2600, z / 2600, 4) * 900 + this.n2.fbm(x / 420, z / 420, 3) * 130;
  }

  /** Power distance to each region (lower wins); borders are warped so they read as natural. */
  regionScores(x: number, z: number, out: Record<RegionId, number>) {
    const wx = x + this.noise.fbm(x / 3800 + 11, z / 3800, 3) * 1400, wz = z + this.noise.fbm(x / 3800, z / 3800 + 17, 3) * 1400;
    out.snow = out.hill = out.plain = out.forest = Infinity;
    for (const s of this.seeds) { const d = (wx - s.x) ** 2 + (wz - s.z) ** 2 - this.fit.weights[s.region]; if (d < out[s.region]) out[s.region] = d; }
    return out;
  }
  private sc: Record<RegionId, number> = { snow: 0, hill: 0, plain: 0, forest: 0 };
  /** Region at a point, or null at sea. */
  regionAt(x: number, z: number): RegionId | null {
    if (this.coastDist(x, z) <= 0) return null;
    return this.nearestRegion(x, z);
  }
  nearestRegion(x: number, z: number): RegionId {
    const s = this.regionScores(x, z, this.sc);
    let best: RegionId = 'plain';
    for (const r of ['snow', 'hill', 'forest'] as RegionId[]) if (s[r] < s[best]) best = r;
    return best;
  }

  /**
   * Blend weights of the four regions' landforms (sum 1) and how deep inside the winning region the point is
   * (approximate metres from its border).
   */
  regionBlend(x: number, z: number, w: Record<RegionId, number>): number {
    const s = this.regionScores(x, z, this.sc);
    const ids: RegionId[] = ['snow', 'hill', 'plain', 'forest'];
    let m = Infinity, m2 = Infinity;
    for (const r of ids) { if (s[r] < m) { m2 = m; m = s[r]; } else if (s[r] < m2) m2 = s[r]; }
    let tot = 0;
    for (const r of ids) { const d = (s[r] - m) / 24000; const k = 1 - smoothstep(0, 1600, d); w[r] = k; tot += k; }
    for (const r of ids) w[r] /= tot;
    this.snowDepth = Math.max(0, (Math.min(s.hill, s.plain, s.forest) - s.snow) / 24000);
    return (m2 - m) / 24000;
  }

  private bw: Record<RegionId, number> = { snow: 0, hill: 0, plain: 0, forest: 0 };
  private snowDepth = 0;
  /** Land elevation before rivers and lakes are cut in. */
  landHeight(x: number, z: number): number {
    const cd = this.coastDist(x, z);
    if (cd < -1500) return -60;
    const w = this.bw; this.regionBlend(x, z, w);
    const N = this.noise, M = this.n2;
    let h = 0;
    if (w.plain > 0) h += w.plain * (14 + Math.min(cd, 5000) / 5000 * 22 + N.fbm(x / 2600, z / 2600, 4) * 16 + N.fbm(x / 520, z / 520, 3) * 5);
    if (w.forest > 0) h += w.forest * (70 + N.fbm(x / 3200 + 5, z / 3200, 4) * 120 + M.ridged(x / 1500, z / 1500, 4) * 220 + N.fbm(x / 300, z / 300, 3) * 10);
    if (w.hill > 0) {
      const dp = Math.hypot(x - this.hillPeak.x, z - this.hillPeak.z);
      const cone = 1380 * Math.pow(1 - smoothstep(0, 3200, dp), 1.6);
      h += w.hill * Math.max(cone, 140 + M.ridged(x / 1900 + 3, z / 1900, 5) * 460 + N.fbm(x / 600, z / 600, 3) * 50);
    }
    if (w.snow > 0) {
      const base = 1100 + Math.min(this.snowDepth, 6000) * 0.22;
      h += w.snow * (base + M.ridged(x / 2300 + 9, z / 2300, 5) * 1150 + N.fbm(x / 650, z / 650, 3) * 140);
    }
    // Glacier Peak: summit pinned at 4,872 m
    const dpk = Math.hypot(x - this.peak.x, z - this.peak.z);
    if (dpk < 7000) {
      // a ridged massif whose summit is exactly 4,872 m: ridges cut in more the further from the top
      const f = Math.pow(1 - smoothstep(0, 7000, dpk), 1.35);
      h = Math.max(h, 4872 * f - Math.sqrt(dpk / 7000) * (1 - M.ridged(x / 900 + 2, z / 900, 4)) * 900 * f);
    }
    // coast: beaches on the plains and forest, cliffs in the snow
    const ramp = lerp(900, 350, w.snow + w.hill * 0.5);
    if (cd <= 0) return Math.max(-60, -2 + cd * 0.04);
    const k = smoothstep(0, ramp, cd);
    return lerp(1.2, h, k) + (1 - k) * cd * 0.002;
  }

  /** Land height, with lakes cut in (rivers are sourced from this). */
  private lakeOrLand(x: number, z: number): number {
    let h = this.landHeight(x, z);
    for (const lk of this.lakes) {
      const d = Math.hypot(x - lk.x, z - lk.z) / lk.r;
      if (d < 1.4) h = lerp(lk.level - 6 * (1 - Math.min(1, d) ** 2), h, smoothstep(0.85, 1.4, d));
    }
    return h;
  }

  /** Nearest river: distance from its centreline, its level and half width there. */
  riverAt(x: number, z: number): { d: number; level: number; hw: number; river: number } | null {
    let best: { d: number; level: number; hw: number; river: number } | null = null;
    for (const s of this.riverIdx.near(x, z)) {
      const g = this.riverIdx.segs[s]; const [d, t] = segDist(x, z, g.ax, g.az, g.bx, g.bz);
      if (!best || d < best.d) {
        const rv = this.rivers[g.line];
        best = { d, level: lerp(rv.level[g.i], rv.level[g.i + 1], t), hw: lerp(rv.hw[g.i], rv.hw[g.i + 1], t), river: g.line };
      }
    }
    return best;
  }

  /** Terrain elevation: land, lakes and river channels. */
  heightAt(x: number, z: number): number {
    let h = this.lakeOrLand(x, z);
    const r = this.riverAt(x, z);
    if (r) {
      const bed = r.level - lerp(1.2, 3, r.hw / 26);
      const cut = Math.max(0, h - r.level);
      const bank = r.hw + 25 + Math.min(220, cut * 0.9);
      if (r.d < bank) h = lerp(lerp(bed, r.level + 0.6, smoothstep(r.hw * 0.55, r.hw, r.d)), h, smoothstep(r.hw, bank, r.d));
    }
    return h;
  }

  /** Water surface height at a point (sea, lake or river), or -Infinity where there is none. */
  waterAt(x: number, z: number): number {
    let w = this.coastDist(x, z) < 400 ? 0 : -Infinity;
    for (const lk of this.lakes) if (Math.hypot(x - lk.x, z - lk.z) < lk.r * 1.3) w = Math.max(w, lk.level);
    const r = this.riverAt(x, z);
    if (r && r.d < r.hw + 4) w = Math.max(w, r.level);
    return w;
  }

  /** Approximate area of each region and the whole island, in km², by sampling every `cell` metres. */
  measureAreas(cell = 200): { land: number; regions: Record<RegionId, number> } {
    const regions: Record<RegionId, number> = { snow: 0, hill: 0, plain: 0, forest: 0 };
    let land = 0; const a = cell * cell / 1e6;
    for (let z = this.minZ; z < this.maxZ; z += cell) for (let x = this.minX; x < this.maxX; x += cell) {
      const r = this.regionAt(x + cell / 2, z + cell / 2);
      if (r) { regions[r] += a; land += a; }
    }
    return { land, regions };
  }

  poisIn(region: RegionId) { return this.pois.filter(p => p.region === region); }
}
