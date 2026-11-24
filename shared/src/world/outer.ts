import { Noise2D, clamp, lerp, smoothstep } from '../math/noise';
import { Island, SegIndex, segDist, type IslandRoad, type RegionId } from './island';

/**
 * The island beyond the detailed valley, generated on demand in 128 m tiles of 2 m samples (the same grid as the
 * valley). Every sample is a pure function of position: island elevation and water, graded roads with embankments,
 * bridges over water, fords on trails, small-scale roughness, land-cover surfaces and trees. Physics (client and
 * server) and the renderer read the same tiles, so what you see is what you drive on.
 */

/** Surface ids (kept numerically in step with terrain.ts's Surface enum). */
export const S_GRASS = 0, S_DIRT = 1, S_MUD = 2, S_ROCK = 3, S_GRAVEL = 4, S_ASPHALT = 5, S_SNOW = 6, S_SAND = 7, S_ICE = 8;

export interface OuterTree { x: number; z: number; y: number; r: number; h: number; kind: number }
export interface OuterTile {
  ti: number; tj: number;
  /** ground heights (65 x 65, row-major by z) */
  h: Float32Array;
  surface: Uint8Array;
  mud: Float32Array;
  trees: OuterTree[];
  used: number;
}

export interface OuterRoadClass { width: number; embankment: number; maxGrade: number; win: number }
export const OUTER_ROAD_CLASSES: Record<IslandRoad['kind'], OuterRoadClass> = {
  highway: { width: 15, embankment: 22, maxGrade: 0.09, win: 10 },
  road: { width: 9, embankment: 14, maxGrade: 0.13, win: 6 },
  trail: { width: 4.5, embankment: 6, maxGrade: 0.3, win: 3 },
};

export interface OuterRoad {
  src: IslandRoad; kind: IslandRoad['kind']; cls: OuterRoadClass;
  pts: [number, number][]; cum: number[];
  /** graded surface height at each point */
  profile: Float32Array;
  /** 1 where the road crosses water on a bridge */
  bridge: Uint8Array;
}

/** Map places that get a levelled building pad beside their road (the story's gang compounds and the underground entrance). */
export const PAD_PLACES = ['gang-1', 'gang-camp', 'gang-3', 'gang-4', 'underground'];
/** A levelled pad: flat to radius r, blended into the land over `blend` metres; `heading` faces the road. */
export interface OuterPad { poi: string; x: number; z: number; y: number; r: number; blend: number; heading: number }

export class OuterWorld {
  static readonly TILE = 128;
  static readonly CELL = 2;
  static readonly S = 65;
  readonly roads: OuterRoad[] = [];
  private roadIdx: SegIndex;
  /** coarse index for the wide valleys roads cut through the hills */
  private carveIdx: SegIndex;
  static readonly MAX_CARVE = 900;
  private nearD: Float32Array; private nearH: Float32Array; private nearB: Uint8Array; private touched: number[] = [];
  private bridgeIdx: SegIndex;
  private bridgeSegs: { road: number; i: number }[] = [];
  private tiles = new Map<number, OuterTile>();
  private clock = 0;
  maxTiles = 600;
  private noise = new Noise2D(31337);
  private rw: Record<RegionId, number> = { snow: 0, hill: 0, plain: 0, forest: 0 };
  private swamp: { x: number; z: number } | null;
  readonly pads: OuterPad[] = [];

  constructor(readonly island: Island, readonly coreHalf: number) {
    const order = { highway: 0, road: 1, trail: 2 };
    const src = [...island.roads].sort((a, b) => order[a.kind] - order[b.kind]);
    this.swamp = island.pois.find(p => p.id === 'swamp') ?? null;
    for (const r of src) this.roads.push(this.gradeRoad(r));
    this.roadIdx = new SegIndex(this.roads.map(r => r.pts), 128, 40);
    this.carveIdx = new SegIndex(this.roads.map(r => r.pts), 512, OuterWorld.MAX_CARVE);
    this.nearD = new Float32Array(this.roads.length).fill(Infinity); this.nearH = new Float32Array(this.roads.length); this.nearB = new Uint8Array(this.roads.length);
    const bl: [number, number][][] = [];
    this.roads.forEach((r, ri) => { for (let i = 0; i < r.pts.length - 1; i++) if (r.bridge[i] || r.bridge[i + 1]) { bl.push([r.pts[i], r.pts[i + 1]]); this.bridgeSegs.push({ road: ri, i }); } });
    this.bridgeIdx = new SegIndex(bl, 128, 16);
    for (const id of PAD_PLACES) { const p = island.pois.find(q => q.id === id); if (p) { const pad = this.placePad(p.id, p.x, p.z); if (pad) this.pads.push(pad); } }
  }

  /**
   * A pad beside the drivable road nearest a place: 70 to 100 m off the centreline on the side whose land is closer to the road's
   * level, at the road's height, so a short level drive leads in.
   */
  private placePad(poi: string, x: number, z: number): OuterPad | null {
    // the nearest stretch of road that is really at its graded level (a lesser road can be carved away where a
    // greater road's cutting crosses it, leaving its line in the air)
    const cands: { d: number; r: OuterRoad; i: number }[] = [];
    for (const r of this.roads) for (let i = 0; i < r.pts.length; i++) { const d = Math.hypot(r.pts[i][0] - x, r.pts[i][1] - z); if (d < 2500) cands.push({ d, r, i }); }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    const level = (r: OuterRoad, i: number) => Math.abs(this.groundAt(r.pts[i][0], r.pts[i][1]) - r.profile[i]) < 1.5;
    const best = cands.find(c => [-3, -1, 0, 1, 3].every(k => { const j = Math.max(0, Math.min(c.r.pts.length - 1, c.i + k)); return level(c.r, j); })) ?? cands[0];
    const { r, i } = best, a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
    const [rx, rz] = r.pts[i], ry = r.profile[i];
    let pick: OuterPad | null = null, score = Infinity;
    for (const side of [1, -1]) for (const off of [70, 85, 100]) {
      const px = rx + nx * side * off, pz = rz + nz * side * off;
      if (this.island.waterAt(px, pz) > -Infinity || this.island.coastDist(px, pz) < 120) continue;
      // the side whose ground (as the roads already shaped it) is nearest the road's level
      const hs = [[0, 0], [28, 0], [-28, 0], [0, 28], [0, -28]].map(([u, v]) => this.groundAt(px + u, pz + v));
      const y = ry + 0.1; // level with the road, so the drive in is flat (the land behind is cut back)
      const sc = hs.reduce((a, h) => a + Math.abs(h - y), 0) + off * 0.1;
      if (sc < score) { score = sc; pick = { poi, x: px, z: pz, y, r: 36, blend: 26, heading: Math.atan2(rx - px, rz - pz) }; }
    }
    return pick;
  }
  /** The pad's pull on a sample: 1 on the pad, falling to 0 at the edge of its blend. */
  private padAt(x: number, z: number): [number, number] {
    for (const p of this.pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + p.blend) return [1 - smoothstep(p.r, p.r + p.blend, d), p.y];
    }
    return [0, 0];
  }

  /** Inside the detailed valley (which has its own heightfield). */
  inCore(x: number, z: number) { return Math.abs(x) <= this.coreHalf && Math.abs(z) <= this.coreHalf; }

  /** Island land elevation plus the small-scale roughness the valley also has. */
  landHeight(x: number, z: number): number {
    return this.island.heightAt(x, z) + this.noise.noise(x / 6, z / 6) * 0.16 + this.noise.noise(x / 23 + 4, z / 23) * 0.3;
  }

  /** Longitudinal profile: smoothed, pinned where it joins a road graded earlier, then grade-limited. */
  private gradeRoad(r: IslandRoad): OuterRoad {
    const cls = OUTER_ROAD_CLASSES[r.kind], P = r.pts, n = P.length;
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const raw = P.map(([x, z]) => this.island.heightAt(x, z));
    const water = P.map(([x, z]) => this.island.waterAt(x, z));
    // over water the road is a bridge: its deck clears the water by 4 m
    const bridge = new Uint8Array(n);
    if (r.kind !== 'trail') for (let i = 0; i < n; i++) if (water[i] > raw[i] - 0.3) for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) bridge[k] = 1;
    const ground = raw.map((h, i) => bridge[i] ? Math.max(h, water[i] + 4.5) : h);
    let prof = ground.slice();
    for (let pass = 0; pass < 3; pass++) {
      const out = prof.slice();
      for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let k = -cls.win; k <= cls.win; k++) { a += prof[clamp(i + k, 0, n - 1)]; c++; } out[i] = a / c; }
      prof = out;
    }
    // pins: ends that join a road graded earlier meet its surface; ends at the valley edge meet the valley
    const pins = new Map<number, number>();
    for (const i of [0, n - 1]) {
      const [x, z] = P[i];
      let best = Infinity, ph = 0;
      for (const o of this.roads) for (let k = 0; k < o.pts.length; k++) { const d = Math.hypot(o.pts[k][0] - x, o.pts[k][1] - z); if (d < best) { best = d; ph = o.profile[k]; } }
      if (best < OUTER_ROAD_CLASSES.highway.width) pins.set(i, ph);
      else if (Math.max(Math.abs(x), Math.abs(z)) < this.coreHalf + 40) pins.set(i, this.landHeight(x, z));
      else if (r.kind === 'trail') pins.set(i, raw[i]);
    }
    for (let i = 0; i < n; i++) prof[i] = Math.max(prof[i], bridge[i] ? water[i] + 4 : -Infinity);
    const g = cls.maxGrade;
    for (let rep = 0; rep < 4; rep++) {
      for (const [i, h] of pins) prof[i] = h;
      for (let i = 1; i < n; i++) { const ds = cum[i] - cum[i - 1]; prof[i] = clamp(prof[i], prof[i - 1] - g * ds, prof[i - 1] + g * ds); }
      for (const [i, h] of pins) prof[i] = h;
      for (let i = n - 2; i >= 0; i--) { const ds = cum[i + 1] - cum[i]; prof[i] = clamp(prof[i], prof[i + 1] - g * ds, prof[i + 1] + g * ds); }
    }
    // never below the sea
    for (let i = 0; i < n; i++) prof[i] = Math.max(prof[i], 1.2);
    return { src: r, kind: r.kind, cls, pts: P, cum, profile: Float32Array.from(prof), bridge };
  }

  /** Nearest graded road at a point: distance from its centreline and its surface height there. */
  roadAt(x: number, z: number): { d: number; h: number; road: OuterRoad; bridge: boolean } | null {
    let best: { d: number; h: number; road: OuterRoad; bridge: boolean } | null = null, bestScore = Infinity;
    for (const s of this.roadIdx.near(x, z)) {
      const g = this.roadIdx.segs[s], r = this.roads[g.line];
      const [d, t] = segDist(x, z, g.ax, g.az, g.bx, g.bz);
      // a wider road wins where corridors overlap, so a highway's embankment is not dug out by a trail
      const score = d - r.cls.width / 2 - (r.kind === 'trail' ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { d, h: lerp(r.profile[g.i], r.profile[g.i + 1], t), road: r, bridge: !!(r.bridge[g.i] && r.bridge[g.i + 1]) };
      }
    }
    return best;
  }

  /** Bridge deck height at a point, or -Infinity. */
  deckAt(x: number, z: number): number {
    let h = -Infinity;
    for (const s of this.bridgeIdx.near(x, z)) {
      const g = this.bridgeIdx.segs[s], b = this.bridgeSegs[g.line], r = this.roads[b.road];
      const [d, t] = segDist(x, z, g.ax, g.az, g.bx, g.bz);
      if (d < r.cls.width / 2 + 0.6) h = Math.max(h, lerp(r.profile[b.i], r.profile[b.i + 1], t));
    }
    return h;
  }

  /**
   * Ground height at a sample (no bridge decks): land with every nearby road graded in. Each road pulls the land
   * to its surface over a band that widens with the height difference (a cutting or embankment of about 1 in 2.2,
   * so a road through hills runs in a pass). Lesser roads are applied first so greater roads win where they meet,
   * and every pull is continuous, so overlapping bands never make steps.
   */
  groundAt(x: number, z: number): number {
    const land = this.landHeight(x, z);
    let h = land;
    const idx = this.carveIdx, D = this.nearD, Hh = this.nearH, B = this.nearB, touched = this.touched;
    touched.length = 0;
    for (const s of idx.near(x, z)) {
      const g = idx.segs[s];
      if (Math.abs(x - g.ax) > OuterWorld.MAX_CARVE + 60 && Math.abs(x - g.bx) > OuterWorld.MAX_CARVE + 60) continue;
      const [d, t] = segDist(x, z, g.ax, g.az, g.bx, g.bz);
      if (d < D[g.line]) {
        if (D[g.line] === Infinity) touched.push(g.line);
        const r = this.roads[g.line];
        D[g.line] = d; Hh[g.line] = lerp(r.profile[g.i], r.profile[g.i + 1], t); B[g.line] = r.bridge[g.i] && r.bridge[g.i + 1] ? 1 : 0;
      }
    }
    // roads are stored highways first, so walking the list backwards applies trails, then roads, then highways
    touched.sort((a, b) => b - a);
    for (const li of touched) {
      const r = this.roads[li], d = D[li], rh = Hh[li];
      D[li] = Infinity;
      const hw = r.cls.width / 2, E = Math.min(OuterWorld.MAX_CARVE - hw - 2, r.cls.embankment + Math.abs(land - rh) * 2.2);
      const w = d <= hw + 1.5 ? 1 : 1 - smoothstep(hw + 1.5, hw + 1.5 + E, d);
      if (w <= 0) continue;
      // under a bridge the valley stays open; only banks that rise above the deck are cut back to it
      if (B[li]) { if (h > rh - 0.02) h = lerp(h, rh - 0.02, w); continue; }
      if (r.kind === 'trail') {
        let th = rh - 0.12;
        const water = this.island.waterAt(x, z);
        if (water > th - 0.4 && d < hw + 6) th = water - 0.4; // a ford, no deeper than 0.4 m
        h = lerp(h, th, w);
      } else h = lerp(h, rh - 0.02, w);
    }
    if (this.pads.length) { const [w, py] = this.padAt(x, z); if (w > 0) h = lerp(h, py, w); }
    return h;
  }

  /** Water surface at a point (sea, lake, river) or -Infinity; frozen lakes are solid ice, not water. */
  waterAt(x: number, z: number): number {
    const w = this.island.waterAt(x, z);
    if (w === -Infinity) return w;
    for (const l of this.island.lakes) if (l.frozen && Math.hypot(x - l.x, z - l.z) < l.r * 1.3 && w === l.level) return -Infinity;
    return w;
  }
  /** Solid ice on a frozen lake, or -Infinity. */
  iceAt(x: number, z: number): number {
    for (const l of this.island.lakes) if (l.frozen && Math.hypot(x - l.x, z - l.z) < l.r * 1.25) return l.level;
    return -Infinity;
  }

  private key(ti: number, tj: number) { return (ti + 1024) * 4096 + (tj + 1024); }

  /** The tile containing a point (generated on first use). */
  tileAt(x: number, z: number): OuterTile { return this.tile(Math.floor(x / OuterWorld.TILE), Math.floor(z / OuterWorld.TILE)); }
  tile(ti: number, tj: number): OuterTile {
    const k = this.key(ti, tj);
    let t = this.tiles.get(k);
    if (!t) {
      t = this.generate(ti, tj);
      this.tiles.set(k, t);
      if (this.tiles.size > this.maxTiles) this.evict();
    }
    t.used = ++this.clock;
    return t;
  }
  hasTile(ti: number, tj: number) { return this.tiles.has(this.key(ti, tj)); }
  private evict() {
    const all = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < all.length / 4; i++) this.tiles.delete(all[i][0]);
  }
  /** Tile by key (for stable tree ids). */
  tileByKey(k: number): OuterTile { return this.tile(Math.floor(k / 4096) - 1024, (k % 4096) - 1024); }
  tileKey(ti: number, tj: number) { return this.key(ti, tj); }

  /** Generate one tile: heights, surfaces, mud and trees. */
  generate(ti: number, tj: number): OuterTile {
    const S = OuterWorld.S, C = OuterWorld.CELL, x0 = ti * OuterWorld.TILE, z0 = tj * OuterWorld.TILE;
    const h = new Float32Array(S * S), surface = new Uint8Array(S * S), mud = new Float32Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) h[j * S + i] = this.groundAt(x0 + i * C, z0 + j * C);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const k = j * S + i, x = x0 + i * C, z = z0 + j * C;
      const gx = (h[j * S + Math.min(i + 1, S - 1)] - h[j * S + Math.max(i - 1, 0)]) / ((Math.min(i + 1, S - 1) - Math.max(i - 1, 0)) * C);
      const gz = (h[Math.min(j + 1, S - 1) * S + i] - h[Math.max(j - 1, 0) * S + i]) / ((Math.min(j + 1, S - 1) - Math.max(j - 1, 0)) * C);
      const [s, m] = this.classify(x, z, h[k], Math.hypot(gx, gz));
      // building pads are gravelled
      const pad = this.pads.length ? this.padAt(x, z)[0] : 0;
      surface[k] = pad > 0.7 ? S_GRAVEL : s; mud[k] = pad > 0.3 ? 0 : m;
    }
    return { ti, tj, h, surface, mud, trees: this.scatter(ti, tj, (i, j) => h[j * S + i]), used: 0 };
  }

  /** Snow cover fraction at a point (region, altitude and slope), shared with the renderer. */
  snowCover(x: number, z: number, h: number, slope: number): number {
    this.island.regionBlend(x, z, this.rw);
    const n = this.noise.noise(x / 90, z / 90);
    return Math.max(smoothstep(950, 1250, h + n * 80), this.rw.snow * smoothstep(300, 700, h)) * (1 - smoothstep(1.1 + this.rw.snow * 0.5, 1.7 + this.rw.snow * 0.6, slope));
  }

  /** Surface type and mud depth for a sample. */
  classify(x: number, z: number, h: number, slope: number): [number, number] {
    const r = this.roadAt(x, z);
    if (r && r.road.kind !== 'trail') { const e = r.d - r.road.cls.width / 2; if (e < 0.3) return [S_ASPHALT, 0]; if (e < 1.8) return [S_GRAVEL, 0]; }
    if (this.iceAt(x, z) > h) return [S_ICE, 0];
    const water = this.waterAt(x, z);
    const snow = this.snowCover(x, z, h, slope);
    const onTrail = !!r && r.road.kind === 'trail' && r.d < r.road.cls.width / 2 + 0.5;
    if (water > h) return [water - h > 0.6 ? S_GRAVEL : S_MUD, water - h > 0.6 ? 0 : 0.5];
    if (onTrail) return snow > 0.5 ? [S_SNOW, 0] : [S_DIRT, 0];
    if (snow > 0.5) return [S_SNOW, 0];
    if (slope > (this.rw.snow > 0.5 ? 1.0 : 0.78)) return [S_ROCK, 0];
    const cd = this.island.coastDist(x, z);
    if (cd < 140 && h < 4.5) return [S_SAND, 0];
    // the forest swamp and wet river banks
    if (this.swamp) {
      const ds = Math.hypot(x - this.swamp.x, z - this.swamp.z);
      if (ds < 1400) { const m = smoothstep(0.0, 0.4, this.noise.noise(x / 70 + 5, z / 70)) * (1 - smoothstep(700, 1400, ds)); if (m > 0.35) return [S_MUD, clamp(m, 0.45, 1)]; }
    }
    if (water > h - 1.2) return [S_MUD, 0.5];
    if (this.rw.forest > 0.5 && this.noise.noise(x / 18, z / 18) > 0.35) return [S_DIRT, 0];
    return [S_GRASS, 0];
  }

  /**
   * Fraction of the 8 m tree grid that carries a tree at a point (before roads, water, slopes and places thin it):
   * dense jungle, patchy pine woods in the hills, copses on the plains, a few pines below the snow line. Also sets
   * this.rw to the region weights there. The renderer uses it to colour distant forest as canopy.
   */
  treeDensity(x: number, z: number, y: number): number {
    this.island.regionBlend(x, z, this.rw);
    const w = this.rw, cop = smoothstep(0.45, 0.7, this.noise.noise(x / 300 + 7, z / 300));
    return w.forest * 0.62 + w.hill * (0.08 + 0.4 * smoothstep(-0.1, 0.25, this.noise.noise(x / 700 + 9, z / 700))) + w.plain * (0.012 + cop * 0.5) + w.snow * 0.07 * (1 - smoothstep(1500, 2000, y));
  }

  /**
   * Trees: a jittered 8 m grid thinned by land cover (dense jungle, pine hills, copses on the plains). `hs` gives
   * the ground height at a 2 m sample of the tile (the tile itself for physics; the renderer's coarser LOD grids
   * pass an interpolated sampler, which gives the same trees at very nearly the same heights).
   */
  scatter(ti: number, tj: number, hs: (i: number, j: number) => number): OuterTree[] {
    const out: OuterTree[] = [], S = OuterWorld.S, C = OuterWorld.CELL, x0 = ti * OuterWorld.TILE, z0 = tj * OuterWorld.TILE;
    const hash = (a: number, b: number, c: number) => { let q = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; q = (q ^ (q >>> 13)) * 1274126177; return ((q ^ (q >>> 16)) >>> 0) / 4294967296; };
    for (let gj = 0; gj < 16; gj++) for (let gi = 0; gi < 16; gi++) {
      const gx = ti * 16 + gi, gz = tj * 16 + gj;
      const x = x0 + gi * 8 + hash(gx, gz, 1) * 8, z = z0 + gj * 8 + hash(gx, gz, 2) * 8;
      if (this.inCore(x, z) || this.padAt(x, z)[0] > 0.02) continue;
      const i = Math.min(S - 1, Math.round((x - x0) / C)), j = Math.min(S - 1, Math.round((z - z0) / C)), y = hs(i, j);
      const dens = this.treeDensity(x, z, y), w = this.rw;
      if (y > 2300 || y < 2.5) continue;
      if (hash(gx, gz, 3) > dens) continue;
      const r = this.roadAt(x, z);
      if (r && r.d < r.road.cls.width / 2 + (r.road.kind === 'trail' ? 3 : 6)) continue;
      if (this.island.waterAt(x, z) > y - 0.5 || this.island.coastDist(x, z) < 60) continue;
      const gxh = (hs(Math.min(i + 1, S - 1), j) - hs(Math.max(i - 1, 0), j)) / 4, gzh = (hs(i, Math.min(j + 1, S - 1)) - hs(i, Math.max(j - 1, 0))) / 4;
      if (Math.hypot(gxh, gzh) > 0.85) continue;
      if (this.island.pois.some(p => Math.abs(p.x - x) < 70 && Math.abs(p.z - z) < 70)) continue;
      // kind: 0 pine, 1 broadleaf, 2 jungle
      const kind = w.forest > 0.5 ? (hash(gx, gz, 4) < 0.75 ? 2 : 1) : w.snow > 0.4 || w.hill > 0.5 || y > 700 ? 0 : (hash(gx, gz, 4) < 0.6 ? 1 : 0);
      const hh = (kind === 2 ? 14 : kind === 0 ? 11 : 9) * (0.7 + hash(gx, gz, 5) * 0.6);
      out.push({ x, z, y, r: 0.22 + hh * 0.018, h: hh, kind });
    }
    return out;
  }

  /** Height with the valley's triangle split, from tile samples. */
  heightAt(x: number, z: number): number {
    const t = this.tileAt(x, z), S = OuterWorld.S, C = OuterWorld.CELL;
    const fx = (x - t.ti * OuterWorld.TILE) / C, fz = (z - t.tj * OuterWorld.TILE) / C;
    const i = Math.min(S - 2, Math.floor(fx)), j = Math.min(S - 2, Math.floor(fz)), u = fx - i, v = fz - j, H = t.h;
    const h00 = H[j * S + i], h10 = H[j * S + i + 1], h01 = H[(j + 1) * S + i], h11 = H[(j + 1) * S + i + 1];
    const g = u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
    return Math.max(g, this.deckAt(x, z), this.iceAt(x, z));
  }
  normalAt(x: number, z: number): [number, number, number] {
    const t = this.tileAt(x, z), S = OuterWorld.S, C = OuterWorld.CELL;
    const deck = Math.max(this.deckAt(x, z), this.iceAt(x, z));
    const fx = (x - t.ti * OuterWorld.TILE) / C, fz = (z - t.tj * OuterWorld.TILE) / C;
    const i = Math.min(S - 2, Math.floor(fx)), j = Math.min(S - 2, Math.floor(fz)), u = fx - i, v = fz - j, H = t.h;
    const h00 = H[j * S + i], h10 = H[j * S + i + 1], h01 = H[(j + 1) * S + i], h11 = H[(j + 1) * S + i + 1];
    const g = u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
    if (deck > g) {
      // on a deck: its slope along the road
      const e = 1.5, a = this.heightAt(x + e, z), b = this.heightAt(x - e, z), c = this.heightAt(x, z + e), d = this.heightAt(x, z - e);
      const dx = (a - b) / (2 * e), dz = (c - d) / (2 * e), l = Math.hypot(dx, 1, dz); return [-dx / l, 1 / l, -dz / l];
    }
    let dx: number, dz: number;
    if (u + v <= 1) { dx = (h10 - h00) / C; dz = (h01 - h00) / C; } else { dx = (h11 - h01) / C; dz = (h11 - h10) / C; }
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  }
  private sampleIdx(x: number, z: number): [OuterTile, number] {
    const t = this.tileAt(x, z), S = OuterWorld.S, C = OuterWorld.CELL;
    const i = clamp(Math.round((x - t.ti * OuterWorld.TILE) / C), 0, S - 1), j = clamp(Math.round((z - t.tj * OuterWorld.TILE) / C), 0, S - 1);
    return [t, j * S + i];
  }
  surfaceAt(x: number, z: number): number { if (this.deckAt(x, z) > -Infinity) return S_ASPHALT; const [t, k] = this.sampleIdx(x, z); return t.surface[k]; }
  mudAt(x: number, z: number): number { const [t, k] = this.sampleIdx(x, z); return t.mud[k]; }
}
