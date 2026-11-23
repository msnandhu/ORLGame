import { mulberry32 } from '../math/noise';

/**
 * Hand-authored layout of the 2.56 km region around Redstone Valley: three settlements, a highway loop and
 * the roads that join them to base camp. Everything here is plain 2D data; Terrain grades it into the
 * heightfield and the client renders it.
 */
export type RoadKind = 'highway' | 'road' | 'street';
export interface RoadClass { width: number; lanesPerDir: number; laneWidth: number; speedLimit: number; embankment: number; maxGrade: number }
export const ROAD_CLASSES: Record<RoadKind, RoadClass> = {
  // speed limits in m/s: 110, 80 and 50 km/h
  highway: { width: 15, lanesPerDir: 2, laneWidth: 3.6, speedLimit: 110 / 3.6, embankment: 18, maxGrade: 0.06 },
  road: { width: 9, lanesPerDir: 1, laneWidth: 3.5, speedLimit: 80 / 3.6, embankment: 12, maxGrade: 0.09 },
  street: { width: 10, lanesPerDir: 1, laneWidth: 3.4, speedLimit: 50 / 3.6, embankment: 4, maxGrade: 0.1 },
};

export interface RoadDef { id: string; name: string; kind: RoadKind; ctrl: [number, number][]; closed?: boolean; curved?: boolean }
export interface Road extends RoadDef {
  cls: RoadClass;
  /** centreline points about every 5 m */
  pts: [number, number][];
  /** arc length at each point */
  cum: number[];
  length: number;
  /** graded road surface height at each point (filled in by Terrain) */
  profile: number[];
}

export type SettlementKind = 'city' | 'town' | 'village';
export interface Settlement {
  id: string; name: string; kind: SettlementKind;
  cx: number; cz: number; hx: number; hz: number;
  /** street centrelines: x positions of north-south streets, z positions of east-west streets */
  xs: number[]; zs: number[];
  /** plateau height (filled in by Terrain) */
  y: number;
}

export type BuildingKind = 'tower' | 'office' | 'apartment' | 'shop' | 'house' | 'barn' | 'station';
export interface Building {
  kind: BuildingKind; settlement: string;
  x: number; z: number; w: number; d: number; h: number; yaw: number;
  /** facade / paint variant */
  style: number;
  roof: 'flat' | 'gable';
  y: number;
}
export interface ParkingSpot { x: number; z: number; heading: number; settlement: string }

export const SETTLEMENTS: Settlement[] = [
  { id: 'halden', name: 'Halden City', kind: 'city', cx: 830, cz: 120, hx: 225, hz: 225, xs: [], zs: [], y: 0 },
  { id: 'millbrook', name: 'Millbrook', kind: 'town', cx: -770, cz: -700, hx: 150, hz: 140, xs: [], zs: [], y: 0 },
  { id: 'ashby', name: 'Ashby Hollow', kind: 'village', cx: -420, cz: 860, hx: 115, hz: 100, xs: [], zs: [], y: 0 },
];
// street grids (absolute coordinates)
{
  const grid = (s: Settlement, step: number) => {
    const nx = Math.floor((s.hx * 2) / step), nz = Math.floor((s.hz * 2) / step);
    for (let i = 0; i <= nx; i++) s.xs.push(s.cx - (nx * step) / 2 + i * step);
    for (let j = 0; j <= nz; j++) s.zs.push(s.cz - (nz * step) / 2 + j * step);
  };
  grid(SETTLEMENTS[0], 75);
  grid(SETTLEMENTS[1], 70);
  const v = SETTLEMENTS[2]; v.xs.push(v.cx); v.zs.push(v.cz - 35, v.cz + 45);
}

const city = SETTLEMENTS[0], town = SETTLEMENTS[1], village = SETTLEMENTS[2];

/** Roads, highway first. Settlement streets are generated from the grids. */
export const ROAD_DEFS: RoadDef[] = [
  { id: 'hw1', name: 'Highway 1', kind: 'highway', curved: true, closed: true, ctrl: [
    [1150, -220], [720, -700], [120, -1010], [-520, -980], [-860, -1010], [-1100, -640], [-1120, 80], [-880, 720], [-420, 1090], [160, 1030], [720, 780], [1150, 430],
  ] },
  { id: 'r-city', name: 'Valley Road East', kind: 'road', curved: true, ctrl: [[40, 8], [170, 70], [330, 110], [480, 125], [city.cx - city.hx, 120]] },
  { id: 'r-town', name: 'Millbrook Road', kind: 'road', curved: true, ctrl: [[-12, -48], [55, -280], [-90, -520], [-380, -650], [town.cx + town.hx, -700]] },
  { id: 'r-village', name: 'Ashby Lane', kind: 'road', curved: true, ctrl: [[-36, 30], [-70, 210], [-160, 430], [-300, 660], [village.cx, village.cz - village.hz]] },
  // highway links
  { id: 'l-city', name: 'Halden Link', kind: 'road', ctrl: [[city.cx + city.hx, 120], [1135, 120]] },
  { id: 'l-town', name: 'Millbrook Link', kind: 'road', ctrl: [[town.cx, town.cz - town.hz], [town.cx, -1000]] },
  { id: 'l-village', name: 'Ashby Link', kind: 'road', ctrl: [[village.cx, village.cz + village.hz], [-420, 1085]] },
];
// links end exactly on the highway (its spline bulges away from the control polygon)
{
  const hw = buildRoad(ROAD_DEFS[0]);
  for (const d of ROAD_DEFS) if (d.id.startsWith('l-')) {
    const [a, b] = d.ctrl; let best = 1e9, bp = b;
    for (const p of hw.pts) { const dd = Math.hypot(p[0] - b[0], p[1] - b[1]); if (dd < best) { best = dd; bp = p; } }
    // keep the link straight along its own axis: slide the end to where the highway crosses that line
    const ux = Math.sign(b[0] - a[0]);
    let end: [number, number] = [bp[0], bp[1]];
    for (const p of hw.pts) if ((ux === 0 ? Math.abs(p[0] - a[0]) : Math.abs(p[1] - a[1])) < 3 && Math.hypot(p[0] - b[0], p[1] - b[1]) < 160) { end = ux === 0 ? [a[0], p[1]] : [p[0], a[1]]; break; }
    d.ctrl = [a, end];
  }
}
for (const s of SETTLEMENTS) {
  const x0 = s.cx - s.hx, x1 = s.cx + s.hx, z0 = s.cz - s.hz, z1 = s.cz + s.hz;
  s.xs.forEach((x, i) => ROAD_DEFS.push({ id: `${s.id}-ns${i}`, name: `${s.name} street`, kind: 'street', ctrl: [[x, z0], [x, z1]] }));
  s.zs.forEach((z, i) => ROAD_DEFS.push({ id: `${s.id}-ew${i}`, name: `${s.name} avenue`, kind: 'street', ctrl: [[x0, z], [x1, z]] }));
}

/** Densify a road's control points (Catmull-Rom when curved) into points about `step` metres apart. */
export function buildRoad(def: RoadDef, step = 5): Road {
  const c = def.ctrl, raw: [number, number][] = [];
  if (def.curved) {
    const n = c.length, segs = def.closed ? n : n - 1;
    const at = (i: number) => def.closed ? c[((i % n) + n) % n] : c[Math.max(0, Math.min(n - 1, i))];
    for (let s = 0; s < segs; s++) {
      const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), k = Math.max(2, Math.ceil(len / step));
      for (let q = 0; q < k; q++) {
        const t = q / k, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
        raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    if (!def.closed) raw.push(c[c.length - 1]);
  } else {
    for (let s = 0; s < c.length - 1; s++) {
      const len = Math.hypot(c[s + 1][0] - c[s][0], c[s + 1][1] - c[s][1]), k = Math.max(1, Math.ceil(len / step));
      for (let q = 0; q < k; q++) raw.push([c[s][0] + (c[s + 1][0] - c[s][0]) * q / k, c[s][1] + (c[s + 1][1] - c[s][1]) * q / k]);
    }
    raw.push(c[c.length - 1]);
  }
  if (def.closed) raw.push([raw[0][0], raw[0][1]]);
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  return { ...def, cls: ROAD_CLASSES[def.kind], pts: raw, cum, length: cum[cum.length - 1], profile: new Array(raw.length).fill(0) };
}

/** Point on a road at arc length s: position, unit tangent and graded height. Closed roads wrap. */
export function roadPointAt(r: Road, s: number): { x: number; z: number; tx: number; tz: number; y: number } {
  if (r.closed) s = ((s % r.length) + r.length) % r.length; else s = Math.max(0, Math.min(r.length, s));
  let lo = 0, hi = r.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
  const a = r.pts[lo], b = r.pts[hi], seg = r.cum[hi] - r.cum[lo] || 1, t = (s - r.cum[lo]) / seg;
  const tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx, tz, y: r.profile[lo] + (r.profile[hi] - r.profile[lo]) * t };
}

/** Rectangle inside a settlement kept clear for the fuel station and car lot (absolute coords). */
export interface Lot { settlement: string; kind: 'fuel' | 'cars'; x0: number; z0: number; x1: number; z1: number }

/**
 * Buildings for every settlement, placed in the blocks between streets with sidewalks kept clear.
 * Deterministic from the seed. Returns buildings, the reserved lots, fuel pumps and parking spots.
 */
export function planSettlements(seed: number) {
  const rnd = mulberry32(seed ^ 0xc17e);
  const buildings: Building[] = [], lots: Lot[] = [], pumps: { x: number; z: number }[] = [], parking: ParkingSpot[] = [];
  for (const s of SETTLEMENTS) {
    const street = ROAD_CLASSES.street.width / 2 + 3.5; // half street + sidewalk
    const xs = [s.cx - s.hx, ...s.xs, s.cx + s.hx].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const zs = [s.cz - s.hz, ...s.zs, s.cz + s.hz].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const blocks: { x0: number; x1: number; z0: number; z1: number; bi: number; bj: number }[] = [];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i] + (s.xs.includes(xs[i]) ? street : 2), x1 = xs[i + 1] - (s.xs.includes(xs[i + 1]) ? street : 2);
      const z0 = zs[j] + (s.zs.includes(zs[j]) ? street : 2), z1 = zs[j + 1] - (s.zs.includes(zs[j + 1]) ? street : 2);
      if (x1 - x0 > 12 && z1 - z0 > 12) blocks.push({ x0, x1, z0, z1, bi: i, bj: j });
    }
    // reserve the fuel station and car lot in blocks next to the main road in (west side for the city, east for the town, south for the village)
    const pick = (score: (b: typeof blocks[number]) => number) => blocks.reduce((a, b) => (score(b) < score(a) ? b : a));
    const entry = s.kind === 'city' ? [s.cx - s.hx, s.cz] : s.kind === 'town' ? [s.cx + s.hx, s.cz] : [s.cx, s.cz - s.hz];
    const fuelB = pick(b => Math.hypot((b.x0 + b.x1) / 2 - entry[0], (b.z0 + b.z1) / 2 - entry[1]));
    const carB = pick(b => b === fuelB ? 1e9 : Math.hypot((b.x0 + b.x1) / 2 - entry[0], (b.z0 + b.z1) / 2 - entry[1]));
    for (const [b, kind] of [[fuelB, 'fuel'], [carB, 'cars']] as const) {
      // the paved area opens onto the street on the block's low-z side; the rest of a big block stays green
      const cx = (b.x0 + b.x1) / 2, cz = Math.min((b.z0 + b.z1) / 2, b.z0 + 16);
      if (kind === 'fuel') {
        for (const dx of [-5, 5]) pumps.push({ x: cx + dx, z: cz });
        const sz = Math.min(b.z1 - 6, cz + 13), w = Math.min(18, b.x1 - b.x0 - 4);
        buildings.push({ kind: 'station', settlement: s.id, x: cx, z: sz, w, d: 8, h: 4.5, yaw: 0, style: 0, roof: 'flat', y: 0 });
        lots.push({ settlement: s.id, kind, x0: Math.max(b.x0, cx - 14), z0: b.z0, x1: Math.min(b.x1, cx + 14), z1: sz - 4 });
      } else {
        // a row of bays facing the street on the block's low-z side
        const n = Math.max(2, Math.min(6, Math.floor((b.x1 - b.x0 - 4) / 5))), step = Math.min(6, (b.x1 - b.x0 - 8) / Math.max(1, n - 1));
        const x0 = cx - (step * (n - 1)) / 2;
        for (let k = 0; k < n; k++) parking.push({ x: x0 + k * step, z: cz, heading: Math.PI, settlement: s.id });
        lots.push({ settlement: s.id, kind, x0: Math.max(b.x0, x0 - 5), z0: b.z0, x1: Math.min(b.x1, x0 + step * (n - 1) + 5), z1: Math.min(b.z1, cz + 5) });
      }
    }
    for (const b of blocks) {
      if (b === fuelB || b === carB) continue;
      const bw = b.x1 - b.x0, bd = b.z1 - b.z0;
      const dc = Math.hypot(((b.x0 + b.x1) / 2 - s.cx) / s.hx, ((b.z0 + b.z1) / 2 - s.cz) / s.hz); // 0 centre .. ~1.4 corner
      if (s.kind === 'city') {
        // downtown towers, offices and apartments further out; 1-4 buildings per block
        const split = bw > 45 && rnd() < 0.7 ? 2 : 1, splitZ = bd > 45 && rnd() < 0.6 ? 2 : 1;
        for (let i = 0; i < split; i++) for (let j = 0; j < splitZ; j++) {
          const cw = bw / split, cd = bd / splitZ, w = cw - 4 - rnd() * 6, d = cd - 4 - rnd() * 6;
          if (w < 10 || d < 10) continue;
          const core = Math.max(0, 1 - dc);
          const kind: BuildingKind = core > 0.55 && rnd() < 0.8 ? 'tower' : core > 0.25 ? 'office' : 'apartment';
          const h = kind === 'tower' ? 45 + core * 70 + rnd() * 35 : kind === 'office' ? 18 + rnd() * 22 : 10 + Math.floor(rnd() * 5) * 3.2;
          buildings.push({ kind, settlement: s.id, x: b.x0 + cw * (i + 0.5), z: b.z0 + cd * (j + 0.5), w, d, h, yaw: 0, style: Math.floor(rnd() * 4), roof: 'flat', y: 0 });
        }
      } else if (s.kind === 'town') {
        // shops along the street fronts, apartments behind
        const n = Math.max(1, Math.floor(bw / 18));
        for (let k = 0; k < n; k++) {
          const cw = bw / n, w = cw - 2 - rnd() * 3;
          for (const side of [0, 1]) {
            const d = Math.min(bd / 2 - 3, 12 + rnd() * 8);
            if (d < 8) continue;
            const z = side === 0 ? b.z0 + d / 2 + 1 : b.z1 - d / 2 - 1;
            const kind: BuildingKind = rnd() < 0.6 ? 'shop' : 'apartment';
            buildings.push({ kind, settlement: s.id, x: b.x0 + cw * (k + 0.5), z, w, d, h: kind === 'shop' ? 6 + rnd() * 4 : 9.6 + Math.floor(rnd() * 3) * 3.2, yaw: 0, style: Math.floor(rnd() * 4), roof: rnd() < 0.3 ? 'gable' : 'flat', y: 0 });
          }
        }
      } else {
        // village houses with gardens, a barn on the edge
        const n = Math.max(1, Math.floor(bw / 22)), m = Math.max(1, Math.floor(bd / 24));
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
          if (rnd() < 0.15) continue;
          const cw = bw / n, cd = bd / m, barn = dc > 0.9 && rnd() < 0.25;
          const w = barn ? 14 : 8 + rnd() * 3, d = barn ? 10 : 7 + rnd() * 3;
          if (w > cw - 4 || d > cd - 4) continue;
          buildings.push({ kind: barn ? 'barn' : 'house', settlement: s.id, x: b.x0 + cw * (i + 0.5) + (rnd() - 0.5) * (cw - w - 4) * 0.5, z: b.z0 + cd * (j + 0.5) + (rnd() - 0.5) * (cd - d - 4) * 0.5, w, d, h: barn ? 6 : rnd() < 0.5 ? 3.2 : 6, yaw: 0, style: Math.floor(rnd() * 6), roof: 'gable', y: 0 });
        }
      }
    }
  }
  return { buildings, lots, pumps, parking };
}
