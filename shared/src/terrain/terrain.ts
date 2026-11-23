import { OuterWorld } from '../world/outer';
import { Island } from '../world/island';
import { Noise2D, mulberry32, clamp, lerp, smoothstep } from '../math/noise';
import { ROAD_DEFS, SETTLEMENTS, buildRoad, planSettlements, type Road, type Settlement, type Building, type Lot, type ParkingSpot } from '../world/layout';

export enum Surface { Grass = 0, Dirt = 1, Mud = 2, Rock = 3, Gravel = 4, Asphalt = 5, Snow = 6, Sand = 7, Ice = 8 }
export const SURFACE_NAMES = ['Grass', 'Dirt trail', 'Mud', 'Rock', 'Gravel', 'Asphalt', 'Snow', 'Sand', 'Ice'];

export interface Boulder { x: number; y: number; z: number; r: number }
export interface StaticBox { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; yaw: number; kind: string; /** index into Terrain.buildings for buildings */ ref?: number }
/** Which face of which box a contact point entered through (see Terrain.boxPenetration). */
export interface BoxContactMemory { box: number; axis: number; sign: number }
export interface Tree { x: number; z: number; y: number; r: number; h: number; kind: number }

/**
 * Terrain data for the region: Redstone Valley (the off-road country around base camp) inside a 2.56 km
 * square with Plain City, Millbrook town and Ashby Hollow village, a highway loop and connecting roads.
 * Pure data, no rendering.
 */
let _outer: OuterWorld | null = null;
/** One island model per process: building it takes a few hundred milliseconds and it never changes. */
export function sharedOuterWorld(coreHalf = 1280): OuterWorld {
  if (!_outer || _outer.coreHalf !== coreHalf) _outer = new OuterWorld(new Island(), coreHalf);
  return _outer;
}

export class Terrain {
  readonly size = 2560;          // metres per side
  readonly cell = 2;             // metres between height samples
  readonly n: number;            // samples per side
  readonly half: number;
  readonly heights: Float32Array;
  readonly surface: Uint8Array;
  readonly mudDepth: Float32Array; // 0..1 how deep/soft mud is
  readonly waterLevel = 4;
  readonly boulders: Boulder[] = [];
  readonly trees: Tree[] = [];
  readonly trails: [number, number][][] = [];
  readonly boxes: StaticBox[] = [];
  readonly fuelPump = { x: 12, z: 6 };
  /** every fuel pump: camp first, then the settlement fuel stations */
  readonly fuelPumps: { x: number; z: number }[] = [{ x: 12, z: 6 }];
  readonly roads: Road[] = [];
  readonly settlements: Settlement[] = SETTLEMENTS.map(s => ({ ...s, xs: [...s.xs], zs: [...s.zs] }));
  readonly buildings: Building[] = [];
  readonly lots: Lot[] = [];
  readonly parking: ParkingSpot[] = [];
  /** moving obstacles (traffic) that vehicles and people collide with; replaced every frame by the owner */
  dynamicBoxes: StaticBox[] = [];
  private roadEdge!: Float32Array;   // metres from the nearest road edge (negative on the road)
  private boxGrid = new Map<number, number[]>();
  private readonly bcell = 32;
  readonly spawn = { x: 0, z: 0, heading: 0 };
  private grid = new Map<number, { b: number[]; t: number[] }>();
  private readonly gcell = 16;

  /** The island beyond the valley (shared by every Terrain: it is a pure function of position). */
  readonly outer: OuterWorld;

  constructor(seed = 20261123) {
    this.outer = sharedOuterWorld(this.size / 2);
    this.n = this.size / this.cell + 1;
    this.half = this.size / 2;
    const N = this.n;
    this.heights = new Float32Array(N * N);
    this.surface = new Uint8Array(N * N);
    this.mudDepth = new Float32Array(N * N);
    const noise = new Noise2D(seed);
    const n2 = new Noise2D(seed + 7);
    this.buildTrails();
    this.buildTrailField();
    for (const d of ROAD_DEFS) this.roads.push(buildRoad(d));
    this.buildRoadField();
    // settlement plateaus sit at the average height of the rolling hills under them
    // rolling hills; the plains outside the valley ring sit a little higher, so they drain instead of pooling
    const plainsAt = (x: number, z: number) => smoothstep(600, 820, Math.max(Math.abs(x), Math.abs(z)));
    const hills = (x: number, z: number) => 18 + noise.fbm(x / 320, z / 320, 5) * 28 + noise.fbm(x / 90, z / 90, 3) * 5 + plainsAt(x, z) * 7;
    for (const st of this.settlements) {
      let a = 0, c = 0;
      for (let u = -1; u <= 1; u += 0.25) for (let v = -1; v <= 1; v += 0.25) { a += hills(st.cx + u * st.hx, st.cz + v * st.hz); c++; }
      st.y = Math.max(this.waterLevel + 6, a / c);
    }
    const plateau = (x: number, z: number): [number, number] => {
      let w = 0, y = 0;
      for (const st of this.settlements) {
        const dd = Math.hypot(Math.max(0, Math.abs(x - st.cx) - st.hx - 12), Math.max(0, Math.abs(z - st.cz) - st.hz - 12));
        const k = 1 - smoothstep(0, 120, dd);
        if (k > w) { w = k; y = st.y; }
      }
      return [w, y];
    };

    const riverZ = (x: number) => 230 + 70 * Math.sin(x / 160) + 25 * Math.sin(x / 61 + 1.3);
    // the island's ground near the valley edge, sampled every 8 m (the stitch below makes the edge exact)
    const BC = 8, BN = this.size / BC + 1, band = new Float32Array(BN * BN).fill(NaN);
    const bandHeight = (x: number, z: number) => {
      const fx = (x + this.half) / BC, fz = (z + this.half) / BC, i = Math.min(BN - 2, Math.floor(fx)), j = Math.min(BN - 2, Math.floor(fz)), u = fx - i, v = fz - j;
      const g = (a: number, b: number) => { const k = b * BN + a; if (Number.isNaN(band[k])) band[k] = this.outer.groundAt(a * BC - this.half, b * BC - this.half); return band[k]; };
      return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i * this.cell - this.half, z = j * this.cell - this.half;
        const r = Math.hypot(x, z);
        // Rolling hills
        let h = hills(x, z);
        const plains = plainsAt(x, z);
        // Ridged mountains: a ring around Redstone Valley, the region's outer edge and the north-west massif.
        // Roads cut passes through them.
        const cheb = Math.max(Math.abs(x), Math.abs(z));
        const ring = smoothstep(330, 470, cheb) * (1 - smoothstep(560, 720, cheb));
        const rim = ring;
        const massif = smoothstep(220, 60, Math.hypot(x + 260, z + 250));
        const roadE = this.roadEdge[j * N + i];
        const pass = smoothstep(15, 170, roadE);
        const [plat, platY] = plateau(x, z);
        const mount = Math.max(rim, massif) * pass * (1 - plat);
        h += mount * (noise.ridged(x / 210, z / 210, 5) * 95 + 15);
        // Rock-crawl ridge east of camp
        const crawl = smoothstep(90, 20, Math.hypot(x - 190, z + 60));
        h += crawl * (10 + n2.ridged(x / 30, z / 30, 3) * 6);
        // River valley carved to a common water level
        const dRiver = Math.abs(z - riverZ(x));
        // the river runs through the valley only, fading out beyond the mountain ring
        const carve = (1 - smoothstep(14, 70, dRiver)) * (1 - smoothstep(600, 760, Math.abs(x)));
        const dt = this.trailDist(x, z);
        const ford = 1 - smoothstep(5, 16, dt); // shallow fords where trails cross water
        const depth = lerp(2.2, 0.55, ford);
        h = lerp(h, this.waterLevel - depth + smoothstep(0, 14, dRiver) * (depth + 0.8), carve * (1 - rim));
        // Base camp flattening
        const camp = 1 - smoothstep(35, 70, r);
        h = lerp(h, 16, camp);
        h = lerp(h, platY, plat);
        // Trails: gently flattened, crowned dirt tracks
        const onTrail = 1 - smoothstep(3, 9, dt);
        if (onTrail > 0) h = lerp(h, h - 0.25, onTrail);
        // Mud basins: low flat places + noise mask, slightly sunken
        const mudMask = smoothstep(0.25, 0.5, n2.fbm(x / 120 + 40, z / 120, 3)) * (1 - mount) * (1 - camp * 0.9) * (1 - plat) * smoothstep(4, 30, roadE) * (1 - plains * 0.8);
        const nearRiver = 1 - smoothstep(20, 60, dRiver);
        const mudAmt = clamp(Math.max(mudMask, nearRiver * carve * 0.8 * smoothstep(0.0, 0.3, n2.noise(x / 40, z / 40) + 0.3) * (1 - plat)), 0, 1);
        h -= mudAmt * 0.8;
        // trails never drop into deep water: build up a causeway / ford no deeper than ~0.5 m
        const ford2 = 1 - smoothstep(6, 18, dt);
        if (h < this.waterLevel - 0.5) h = lerp(h, this.waterLevel - 0.5, ford2);
        // Small-scale bumps (ruts / roughness)
        h += noise.noise(x / 6, z / 6) * (0.18 + mount * 0.6 + crawl * 0.15) * (1 - onTrail * 0.7) * (1 - plat * 0.85);
        // the valley's edge blends into the island beyond it, meeting it exactly at the border
        const toIsland = smoothstep(1040, 1272, cheb);
        if (toIsland > 0) h = lerp(h, bandHeight(x, z), toIsland);
        const k = j * N + i;
        this.heights[k] = h;
        this.mudDepth[k] = mudAmt * (1 - toIsland);
      }
    }
    // Ease trail gradients: blend trail corridors toward a heavily blurred height field
    {
      const blur = (src: Float32Array, r: number) => {
        const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
        for (let j = 0; j < N; j++) { let acc = 0; for (let i = -r; i <= r; i++) acc += src[j * N + clamp(i, 0, N - 1)];
          for (let i = 0; i < N; i++) { tmp[j * N + i] = acc / (2 * r + 1); acc += src[j * N + Math.min(i + r + 1, N - 1)] - src[j * N + Math.max(i - r, 0)]; } }
        for (let i = 0; i < N; i++) { let acc = 0; for (let j = -r; j <= r; j++) acc += tmp[clamp(j, 0, N - 1) * N + i];
          for (let j = 0; j < N; j++) { out[j * N + i] = acc / (2 * r + 1); acc += tmp[Math.min(j + r + 1, N - 1) * N + i] - tmp[Math.max(j - r, 0) * N + i]; } }
        return out;
      };
      let b = blur(this.heights, 7); b = blur(b, 7);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const w = 1 - smoothstep(5, 16, this.trailField[k]);
        if (w <= 0) continue;
        let target = b[k];
        if (target < this.waterLevel - 0.5) target = this.waterLevel - 0.5;
        this.heights[k] += (target - this.heights[k]) * w * 0.9;
      }
    }
    const carriageway = this.gradeRoads();
    // stitch: the last 20 m meet the island's tiles exactly at the border. Carriageways are left alone: their
    // profiles already end on the island's height at the exit, and blending them would put a step in the road.
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i * this.cell - this.half, z = j * this.cell - this.half, cheb = Math.max(Math.abs(x), Math.abs(z));
      if (cheb < 1258) { if (i > 12 && i < N - 13 && j > 12) i = N - 13; continue; }
      const k = j * N + i;
      if (carriageway[k] && cheb < 1279) continue;
      this.heights[k] = lerp(this.heights[k], this.outer.groundAt(x, z), smoothstep(1258, 1280, cheb));
    }
    // Classify surfaces from slope and masks
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = i * this.cell - this.half, z = j * this.cell - this.half;
        const h = this.heights[k];
        const hx = this.heights[j * N + Math.min(i + 1, N - 1)] - this.heights[j * N + Math.max(i - 1, 0)];
        const hz = this.heights[Math.min(j + 1, N - 1) * N + i] - this.heights[Math.max(j - 1, 0) * N + i];
        const slope = Math.hypot(hx, hz) / (2 * this.cell);
        let s = Surface.Grass;
        const dt = this.trailDist(x, z);
        if (this.mudDepth[k] > 0.45) s = Surface.Mud;
        if (dt < 4.5) s = this.mudDepth[k] > 0.6 ? Surface.Mud : Surface.Dirt;
        if (h < this.waterLevel + 0.6 && s !== Surface.Mud) s = Surface.Gravel;
        if (slope > 0.75 || (h > 75 && slope > 0.35)) s = Surface.Rock;
        if (Math.hypot(x - 190, z + 60) < 70 && slope > 0.3) s = Surface.Rock;
        const re = this.roadEdge[k];
        if (re < 0.3) s = Surface.Asphalt; else if (re < 1.8 && s !== Surface.Rock) s = Surface.Gravel;
        else if (this.inSettlement(x, z, 6)) s = Surface.Grass;
        if (s !== Surface.Mud) this.mudDepth[k] = 0;
        this.surface[k] = s;
      }
    }
    this.scatter(seed);
    this.buildCamp();
    this.buildSettlements(seed);
    this.boxes.forEach((_, i) => this.indexBox(i));
  }

  /** Inside a settlement's footprint (plus a margin). */
  inSettlement(x: number, z: number, margin = 0): Settlement | null {
    for (const s of this.settlements) if (Math.abs(x - s.cx) < s.hx + margin && Math.abs(z - s.cz) < s.hz + margin) return s;
    return null;
  }
  /** Metres from the nearest road edge (negative on the carriageway). */
  roadEdgeDist(x: number, z: number): number {
    const N = this.n;
    const fx = clamp((x + this.half) / this.cell, 0, N - 1.0001), fz = clamp((z + this.half) / this.cell, 0, N - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, F = this.roadEdge;
    return (F[j * N + i] * (1 - u) + F[j * N + i + 1] * u) * (1 - v) + (F[(j + 1) * N + i] * (1 - u) + F[(j + 1) * N + i + 1] * u) * v;
  }

  /** 2D distance-to-road-edge field (capped), used for mountain passes, surfaces and keeping props off roads. */
  private buildRoadField() {
    const N = this.n, f = new Float32Array(N * N).fill(200);
    for (const r of this.roads) {
      const R = (r.kind === 'street' ? 30 : 175) + r.cls.width / 2, hw = r.cls.width / 2;
      this.rasterRoad(r, R, (k, d) => { const e = d - hw; if (e < f[k]) f[k] = e; });
    }
    this.roadEdge = f;
  }
  /** Visit every grid sample within R of the road's centreline: cb(index, distance, segment, t). */
  private rasterRoad(r: Road, R: number, cb: (k: number, d: number, seg: number, t: number) => void) {
    const N = this.n, P = r.pts;
    for (let sgi = 0; sgi < P.length - 1; sgi++) {
      const [ax, az] = P[sgi], [bx, bz] = P[sgi + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + this.half) / this.cell)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + R + this.half) / this.cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + this.half) / this.cell)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + R + this.half) / this.cell));
      for (let j = j0; j <= j1; j++) {
        const z = j * this.cell - this.half;
        for (let i = i0; i <= i1; i++) {
          const x = i * this.cell - this.half;
          const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (d <= R) cb(j * N + i, d, sgi, t);
        }
      }
    }
  }

  /**
   * Grade every road into the heightfield: a smoothed, grade-limited longitudinal profile, a flat carriageway
   * with shoulders, and embankments or cuttings blending back to the land. Highways go first so the roads that
   * join them meet their surface.
   */
  private gradeRoads(): Uint8Array {
    const order = [...this.roads].sort((a, b) => ['highway', 'road', 'street'].indexOf(a.kind) - ['highway', 'road', 'street'].indexOf(b.kind));
    const N = this.n, bestD = new Float32Array(N * N).fill(1e9), bestH = new Float32Array(N * N);
    // carriageways already graded: later (lesser) roads join them without reshaping them
    const locked = new Uint8Array(N * N);
    for (const r of order) {
      const P = r.pts, raw = P.map(([x, z]) => this.heightAt(x, z));
      // points in the stitch band take the island road's height, so the carriageway meets it level at the exit
      const atEdge = P.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) >= 1250);
      P.forEach(([x, z], i) => { if (atEdge[i]) raw[i] = this.outer.groundAt(x, z); });
      let prof = raw.slice();
      const win = r.kind === 'highway' ? 14 : r.kind === 'road' ? 8 : 0;
      for (let pass = 0; pass < 3 && win > 0; pass++) {
        const out = prof.slice();
        for (let i = 0; i < prof.length; i++) {
          let a = 0, c = 0;
          for (let k = -win; k <= win; k++) {
            let q = i + k;
            if (r.closed) q = ((q % (prof.length - 1)) + (prof.length - 1)) % (prof.length - 1); else q = clamp(q, 0, prof.length - 1);
            a += prof[q]; c++;
          }
          out[i] = a / c;
        }
        prof = out;
      }
      // open roads keep their end heights so they meet whatever they join
      if (!r.closed && win > 0) for (const [i, w] of [[0, 1], [prof.length - 1, 1]] as const) {
        for (let k = 0; k < 8; k++) { const q = i === 0 ? k : i - k; if (q < 0 || q >= prof.length) continue; const b = (1 - k / 8) * w; prof[q] = lerp(prof[q], raw[q], b); }
      }
      for (let i = 0; i < prof.length; i++) prof[i] = Math.max(prof[i], this.waterLevel + 1.6);
      // grade limit, forwards then backwards
      const g = r.cls.maxGrade;
      // pinned: open ends, and any point on a carriageway graded earlier (a junction meets it level)
      const pinned: number[] = [];
      for (let i = 0; i < P.length; i++) {
        const ci = Math.round((P[i][0] + this.half) / this.cell), cj = Math.round((P[i][1] + this.half) / this.cell);
        if ((!r.closed && (i === 0 || i === P.length - 1)) || atEdge[i] || locked[clamp(cj, 0, N - 1) * N + clamp(ci, 0, N - 1)]) pinned.push(i);
      }
      const pin = () => { for (const i of pinned) prof[i] = Math.max(raw[i], this.waterLevel + 1.6); };
      for (let rep = 0; rep < 4; rep++) {
        pin();
        for (let i = 1; i < prof.length; i++) { const ds = r.cum[i] - r.cum[i - 1]; prof[i] = clamp(prof[i], prof[i - 1] - g * ds, prof[i - 1] + g * ds); }
        pin();
        for (let i = prof.length - 2; i >= 0; i--) { const ds = r.cum[i + 1] - r.cum[i]; prof[i] = clamp(prof[i], prof[i + 1] - g * ds, prof[i + 1] + g * ds); }
      }
      if (r.closed) prof[prof.length - 1] = prof[0];
      r.profile = prof;
      // blend the land to the road
      const hw = r.cls.width / 2 + 1.5, E = r.cls.embankment, touched: number[] = [];
      this.rasterRoad(r, hw + E, (k, d, sg, t) => {
        if (bestD[k] === 1e9) touched.push(k);
        if (d < bestD[k]) { bestD[k] = d; bestH[k] = prof[sg] + (prof[sg + 1] - prof[sg]) * t; }
      });
      for (const k of touched) {
        const d = bestD[k], w = d <= hw ? 1 : 1 - smoothstep(hw, hw + E, d);
        if (!locked[k]) this.heights[k] = lerp(this.heights[k], bestH[k] - 0.02, w);
        bestD[k] = d <= hw ? -1 : 1e9;
      }
      for (const k of touched) if (bestD[k] === -1) { locked[k] = 1; bestD[k] = 1e9; }
    }
    return locked;
  }

  /** Buildings, fuel stations and car lots of the three settlements, as static colliders. */
  private buildSettlements(seed: number) {
    const plan = planSettlements(seed);
    for (const b of plan.buildings) {
      b.y = this.heightAt(b.x, b.z);
      const ref = this.buildings.length;
      this.buildings.push(b);
      this.boxes.push({ kind: b.kind, cx: b.x, cy: b.y + b.h / 2 - 0.5, cz: b.z, hx: b.w / 2, hy: b.h / 2 + 0.5, hz: b.d / 2, yaw: b.yaw, ref });
    }
    for (const p of plan.pumps) {
      this.fuelPumps.push(p);
      this.boxes.push({ kind: 'pump', cx: p.x, cy: this.heightAt(p.x, p.z) + 0.9, cz: p.z, hx: 0.4, hy: 0.9, hz: 0.3, yaw: 0 });
    }
    this.lots.push(...plan.lots);
    this.parking.push(...plan.parking);
    // fuel forecourts and car parks are paved
    const N = this.n;
    for (const l of plan.lots) for (let z = l.z0; z <= l.z1; z += this.cell) for (let x = l.x0; x <= l.x1; x += this.cell) {
      const i = Math.round((x + this.half) / this.cell), j = Math.round((z + this.half) / this.cell);
      if (i >= 0 && j >= 0 && i < N && j < N) this.surface[j * N + i] = Surface.Asphalt;
    }
  }

  private bkey(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }
  private indexBox(i: number) {
    const b = this.boxes[i], r = Math.hypot(b.hx, b.hz) + 3;
    for (let cx = Math.floor((b.cx - r) / this.bcell); cx <= Math.floor((b.cx + r) / this.bcell); cx++)
      for (let cz = Math.floor((b.cz - r) / this.bcell); cz <= Math.floor((b.cz + r) / this.bcell); cz++) {
        const k = this.bkey(cx, cz); let l = this.boxGrid.get(k); if (!l) { l = []; this.boxGrid.set(k, l); } l.push(i);
      }
  }
  /** Rebuild the static box index after `boxes` was edited (tests, editors). */
  reindexBoxes() { this.boxGrid.clear(); this.boxes.forEach((_, i) => this.indexBox(i)); }
  private static readonly NONE: number[] = [];
  /** Static boxes that can touch a point (bounding circle + 3 m); dynamic boxes are separate. */
  boxesNear(x: number, z: number): readonly number[] {
    return this.boxGrid.get(this.bkey(Math.floor(x / this.bcell), Math.floor(z / this.bcell))) ?? Terrain.NONE;
  }
  /** Static box by index, then dynamic boxes after them. */
  boxAt(i: number): StaticBox { return i < this.boxes.length ? this.boxes[i] : this.dynamicBoxes[i - this.boxes.length]; }

  /** Base camp structures as static colliders (shared by physics and rendering). */
  private buildCamp() {
    const h = this.heightAt(0, 0);
    const add = (kind: string, cx: number, cz: number, w: number, hh: number, d: number, y0 = 0, yaw = 0) =>
      this.boxes.push({ kind, cx, cy: h + y0 + hh / 2, cz, hx: w / 2, hy: hh / 2, hz: d / 2, yaw });
    add('wall', -23, 14, 0.3, 4, 8); add('wall', -13, 14, 0.3, 4, 8); add('wall', -18, 18, 10, 4, 0.3);
    add('roof', -18, 14, 11, 0.25, 9, 4.1);
    add('pump', 12, 6, 0.8, 1.8, 0.6);
    add('pole', 4, -8, 0.12, 9, 0.12);
    for (let i = 0; i < 5; i++) add('crate', -10 + (i % 3) * 1.2, -14, 1.1, 1.1, 1.1, Math.floor(i / 3) * 1.1, 0);
  }

  /**
   * Push-out of a point from static boxes. Returns penetration depth and writes the normal.
   * Pass a per-point `mem` to keep pushing out through the face the point entered by: without it a fast point
   * that crosses the middle of a thin wall would be pushed out of the far side (tunnelling).
   */
  boxPenetration(x: number, y: number, z: number, pad: number, nOut: [number, number, number], mem?: BoxContactMemory): number {
    let best = 0, hitBox = -1, hitAxis = 0, hitSign = 0;
    const near = this.boxesNear(x, z), nStatic = near.length, nAll = nStatic + this.dynamicBoxes.length;
    for (let q = 0; q < nAll; q++) {
      const bi = q < nStatic ? near[q] : this.boxes.length + (q - nStatic);
      const b = this.boxAt(bi);
      const dx = x - b.cx, dy = y - b.cy, dz = z - b.cz;
      if (Math.abs(dx) > b.hx + b.hz + pad + 1 || Math.abs(dz) > b.hx + b.hz + pad + 1) continue;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const l = [lx, dy, lz], h = [b.hx + pad, b.hy + pad, b.hz + pad];
      const remembered = !!mem && mem.box === bi;
      // a remembered contact stays live past the far face (up to 2 m) so it keeps pushing back the way it came in
      let outside = false;
      for (let a = 0; a < 3; a++) if (Math.abs(l[a]) >= h[a] && !(remembered && a === mem!.axis && -mem!.sign * l[a] < h[a] + 2)) outside = true;
      if (outside) continue;
      let axis: number, sign: number, pen: number;
      if (remembered) { axis = mem!.axis; sign = mem!.sign; pen = h[axis] - sign * l[axis]; if (pen <= 0) continue; }
      else {
        const px = h[0] - Math.abs(lx), py = h[1] - Math.abs(dy), pz = h[2] - Math.abs(lz);
        if (px < py && px < pz) { axis = 0; pen = px; } else if (pz < py) { axis = 2; pen = pz; } else { axis = 1; pen = py; }
        sign = Math.sign(l[axis]) || 1;
      }
      if (pen > best) { best = pen; hitBox = bi; hitAxis = axis; hitSign = sign; const nx = axis === 0 ? sign : 0, ny = axis === 1 ? sign : 0, nz = axis === 2 ? sign : 0; nOut[0] = nx * c + nz * s; nOut[1] = ny; nOut[2] = -nx * s + nz * c; }
    }
    if (mem) { if (hitBox < 0) mem.box = -1; else if (mem.box !== hitBox) { mem.box = hitBox; mem.axis = hitAxis; mem.sign = hitSign; } }
    return best;
  }

  private buildTrails() {
    // Hand-authored trail network (control points) through camp, valley, ford, mud flats and the crawl ridge.
    const loops: [number, number][][] = [
      [[0, 0], [60, -20], [130, -50], [190, -60], [240, -20], [260, 60], [220, 140], [150, 200], [60, 235], [-40, 230], [-120, 200], [-180, 140], [-200, 60], [-150, -10], [-80, 10], [0, 0]],
      [[0, 0], [-20, -80], [-60, -160], [-130, -210], [-200, -230]],
      [[0, 0], [40, 90], [80, 170], [100, 260], [120, 340]],
      [[-120, 200], [-160, 280], [-120, 360], [-30, 380]],
    ];
    for (const ctrl of loops) {
      const pts: [number, number][] = [];
      for (let s = 0; s < ctrl.length - 1; s++) {
        const p0 = ctrl[Math.max(s - 1, 0)], p1 = ctrl[s], p2 = ctrl[s + 1], p3 = ctrl[Math.min(s + 2, ctrl.length - 1)];
        for (let t = 0; t < 1; t += 0.125) {
          const t2 = t * t, t3 = t2 * t;
          const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
          pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
        }
      }
      pts.push(ctrl[ctrl.length - 1]);
      this.trails.push(pts);
    }
  }

  private trailField!: Float32Array;
  /** Distance-to-trail field on the height grid (capped at 30 m), rasterised per segment. */
  private buildTrailField() {
    const N = this.n, f = new Float32Array(N * N).fill(30), R = 30;
    for (const pts of this.trails) for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + this.half) / this.cell)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + R + this.half) / this.cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + this.half) / this.cell)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + R + this.half) / this.cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * this.cell - this.half, z = j * this.cell - this.half;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        const k = j * N + i;
        if (d < f[k]) f[k] = d;
      }
    }
    this.trailField = f;
  }

  trailDist(x: number, z: number): number {
    const N = this.n;
    const fx = clamp((x + this.half) / this.cell, 0, N - 1.0001), fz = clamp((z + this.half) / this.cell, 0, N - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, F = this.trailField;
    return (F[j * N + i] * (1 - u) + F[j * N + i + 1] * u) * (1 - v) + (F[(j + 1) * N + i] * (1 - u) + F[(j + 1) * N + i + 1] * u) * v;
  }

  trailDistExact(x: number, z: number): number {
    let best = 1e9;
    for (const pts of this.trails) {
      for (let s = 0; s < pts.length - 1; s++) {
        const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
        if (Math.abs(x - ax) > best + 40 && Math.abs(x - bx) > best + 40) continue;
        const dx = bx - ax, dz = bz - az;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < best) best = d;
      }
    }
    return best;
  }

  private scatter(seed: number) {
    const rnd = mulberry32(seed ^ 0x5eed);
    // Boulders: dense in the crawl zone and massif, sparse elsewhere
    const clear = (x: number, z: number, m: number) => this.roadEdgeDist(x, z) < m || !!this.inSettlement(x, z, m + 10);
    for (let n = 0; n < 2400; n++) {
      let x: number, z: number;
      if (n < 220) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 70; x = 190 + Math.cos(a) * d; z = -60 + Math.sin(a) * d; }
      else { x = (rnd() - 0.5) * (this.size - 40); z = (rnd() - 0.5) * (this.size - 40); }
      if (Math.hypot(x, z) < 60 || this.trailDist(x, z) < 7 || clear(x, z, 8)) continue;
      const surf = this.surfaceAt(x, z);
      if (n >= 220 && surf !== Surface.Rock && rnd() > 0.25) continue;
      const r = n < 220 ? 0.5 + rnd() * 1.4 : 0.6 + rnd() * rnd() * 3.5;
      const y = this.heightAt(x, z) + r * (0.1 + rnd() * 0.35);
      if (y - r * 0.2 < this.waterLevel) continue;
      this.add({ x, y, z, r }, 'b');
    }
    // Trees: avoid water, trails, rock and steep slopes
    for (let n = 0; n < 40000 && this.trees.length < 12000; n++) {
      const x = (rnd() - 0.5) * (this.size - 20), z = (rnd() - 0.5) * (this.size - 20);
      const h = this.heightAt(x, z);
      if (h < this.waterLevel + 1 || Math.hypot(x, z) < 55 || this.trailDist(x, z) < 6 || clear(x, z, 7)) continue;
      const s = this.surfaceAt(x, z);
      if (s === Surface.Rock || s === Surface.Mud || s === Surface.Gravel) continue;
      const nrm = this.normalAt(x, z);
      if (nrm[1] < 0.85) continue;
      const cluster = 0.5 + 0.5 * Math.sin(x / 47) * Math.cos(z / 53);
      if (rnd() > cluster * 0.9 + 0.08) continue;
      const tall = 7 + rnd() * 9;
      this.add({ x, z, y: h, r: 0.35 + tall * 0.02, h: tall, kind: rnd() < 0.75 ? 0 : 1 }, 't');
    }
  }

  private key(cx: number, cz: number) { return (cx + 512) * 4096 + (cz + 512); }
  private add(o: Boulder | Tree, kind: 'b' | 't') {
    const list = kind === 'b' ? this.boulders : this.trees;
    const idx = list.length;
    list.push(o as never);
    const r = kind === 'b' ? (o as Boulder).r : (o as Tree).r;
    const c0x = Math.floor((o.x - r) / this.gcell), c1x = Math.floor((o.x + r) / this.gcell);
    const c0z = Math.floor((o.z - r) / this.gcell), c1z = Math.floor((o.z + r) / this.gcell);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const k = this.key(cx, cz);
      let c = this.grid.get(k);
      if (!c) { c = { b: [], t: [] }; this.grid.set(k, c); }
      c[kind].push(idx);
    }
  }
  /** Obstacles whose bounds overlap the circle (x,z,r). */
  query(x: number, z: number, r: number, outB: Set<number>, outT: Set<number>) {
    outB.clear(); outT.clear();
    if (Math.abs(x) + r > this.half || Math.abs(z) + r > this.half) {
      const T = OuterWorld.TILE;
      for (let ti = Math.floor((x - r) / T); ti <= Math.floor((x + r) / T); ti++) for (let tj = Math.floor((z - r) / T); tj <= Math.floor((z + r) / T); tj++) {
        if (Math.abs((ti + 0.5) * T) < this.half && Math.abs((tj + 0.5) * T) < this.half) continue;
        const tile = this.outer.tile(ti, tj), key = this.outer.tileKey(ti, tj);
        tile.trees.forEach((t, k) => { if (Math.abs(t.x - x) < r + 2 && Math.abs(t.z - z) < r + 2) outT.add(Terrain.OUTER_TREE + key * 1024 + k); });
      }
    }
    const c0x = Math.floor((x - r) / this.gcell), c1x = Math.floor((x + r) / this.gcell);
    const c0z = Math.floor((z - r) / this.gcell), c1z = Math.floor((z + r) / this.gcell);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const c = this.grid.get(this.key(cx, cz));
      if (!c) continue;
      for (const i of c.b) outB.add(i);
      for (const i of c.t) outT.add(i);
    }
  }

  /** Keep a point inside the playable world (the island and its sea margin), with a pad in metres. */
  clampToWorld(p: { x: number; z: number }, pad = 0) {
    const I = this.outer.island;
    p.x = clamp(p.x, I.minX + 200 + pad, I.maxX - 200 - pad); p.z = clamp(p.z, I.minZ + 200 + pad, I.maxZ - 200 - pad);
  }
  /** Inside the island's bounds (the sea around it included). */
  inBounds(x: number, z: number) { const I = this.outer.island; return x > I.minX + 200 && x < I.maxX - 200 && z > I.minZ + 200 && z < I.maxZ - 200; }
  /** Inside the detailed valley (its own heightfield); outside it, samples come from the island's tiles. */
  inCore(x: number, z: number) { return Math.abs(x) < this.half && Math.abs(z) < this.half; }

  /** Height using the same triangle split as the rendered mesh. */
  heightAt(x: number, z: number): number {
    if (!this.inCore(x, z)) return this.outer.heightAt(x, z);
    const N = this.n;
    const fx = clamp((x + this.half) / this.cell, 0, N - 1.0001);
    const fz = clamp((z + this.half) / this.cell, 0, N - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const h00 = this.heights[j * N + i], h10 = this.heights[j * N + i + 1];
    const h01 = this.heights[(j + 1) * N + i], h11 = this.heights[(j + 1) * N + i + 1];
    // Triangles: (00,01,10) when u+v<=1, else (01,11,10)
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  normalAt(x: number, z: number): [number, number, number] {
    if (!this.inCore(x, z)) return this.outer.normalAt(x, z);
    const N = this.n;
    const fx = clamp((x + this.half) / this.cell, 0, N - 1.0001);
    const fz = clamp((z + this.half) / this.cell, 0, N - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const c = this.cell;
    const h00 = this.heights[j * N + i], h10 = this.heights[j * N + i + 1];
    const h01 = this.heights[(j + 1) * N + i], h11 = this.heights[(j + 1) * N + i + 1];
    let dx: number, dz: number;
    if (u + v <= 1) { dx = (h10 - h00) / c; dz = (h01 - h00) / c; }
    else { dx = (h11 - h01) / c; dz = (h11 - h10) / c; }
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  }

  private idx(x: number, z: number) {
    const N = this.n;
    const i = clamp(Math.round((x + this.half) / this.cell), 0, N - 1);
    const j = clamp(Math.round((z + this.half) / this.cell), 0, N - 1);
    return j * N + i;
  }
  surfaceAt(x: number, z: number): Surface { return this.inCore(x, z) ? this.surface[this.idx(x, z)] : this.outer.surfaceAt(x, z) as Surface; }
  mudAt(x: number, z: number): number { return this.inCore(x, z) ? this.mudDepth[this.idx(x, z)] : this.outer.mudAt(x, z); }
  /** Water surface height here: the valley's river level, or the island's sea, lakes and rivers (-Infinity where dry). */
  waterAt(x: number, z: number): number { return this.inCore(x, z) ? this.waterLevel : this.outer.waterAt(x, z); }
  waterDepthAt(x: number, z: number): number { return Math.max(0, this.waterAt(x, z) - this.heightAt(x, z)); }
  /** Tree by index from `query`: the valley's trees, then trees of the island tiles (stable ids per tile). */
  treeAt(i: number): Tree {
    if (i < Terrain.OUTER_TREE) return this.trees[i];
    const k = i - Terrain.OUTER_TREE;
    return this.outer.tileByKey(Math.floor(k / 1024)).trees[k % 1024];
  }
  static readonly OUTER_TREE = 1 << 30;

  /**
   * Ray vs terrain + boulders. Returns distance along the (unit) direction, or -1.
   * nOut receives the surface normal; isRock reports whether a boulder was hit.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number,
          nOut: [number, number, number], hit: { boulder: boolean }): number {
    let best = -1;
    hit.boulder = false;
    // Heightfield: march then bisect
    const step = 0.2;
    let prevT = 0;
    let prevD = oy - this.heightAt(ox, oz);
    if (prevD <= 0) { best = 0; }
    else {
      for (let t = step; t <= maxT + step; t += step) {
        const tt = Math.min(t, maxT);
        const px = ox + dx * tt, py = oy + dy * tt, pz = oz + dz * tt;
        const d = py - this.heightAt(px, pz);
        if (d <= 0) {
          let a = prevT, b = tt;
          for (let k = 0; k < 10; k++) {
            const m = (a + b) * 0.5;
            const dm = oy + dy * m - this.heightAt(ox + dx * m, oz + dz * m);
            if (dm > 0) a = m; else b = m;
          }
          best = (a + b) * 0.5;
          break;
        }
        prevT = tt; prevD = d;
        if (tt >= maxT) break;
      }
    }
    if (best >= 0) {
      const nn = this.normalAt(ox + dx * best, oz + dz * best);
      nOut[0] = nn[0]; nOut[1] = nn[1]; nOut[2] = nn[2];
    }
    // Boulders (spheres)
    const cx = ox + dx * maxT * 0.5, cz = oz + dz * maxT * 0.5;
    this.query(cx, cz, maxT * 0.5 + 0.1, this._qb, this._qt);
    for (const bi of this._qb) {
      const b = this.boulders[bi];
      const lx = ox - b.x, ly = oy - b.y, lz = oz - b.z;
      const bq = lx * dx + ly * dy + lz * dz;
      const c = lx * lx + ly * ly + lz * lz - b.r * b.r;
      const disc = bq * bq - c;
      if (disc < 0) continue;
      let t = -bq - Math.sqrt(disc);
      if (t < 0) { if (c < 0) t = 0; else continue; }
      if (t > maxT) continue;
      if (best < 0 || t < best) {
        best = t;
        const px = ox + dx * t - b.x, py = oy + dy * t - b.y, pz = oz + dz * t - b.z;
        const l = Math.hypot(px, py, pz) || 1;
        nOut[0] = px / l; nOut[1] = py / l; nOut[2] = pz / l;
        hit.boulder = true;
      }
    }
    return best;
  }
  private _qb = new Set<number>();
  private _qt = new Set<number>();
}
