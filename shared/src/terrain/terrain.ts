import { Noise2D, mulberry32, clamp, lerp, smoothstep } from '../math/noise';

export enum Surface { Grass = 0, Dirt = 1, Mud = 2, Rock = 3, Gravel = 4 }
export const SURFACE_NAMES = ['Grass', 'Dirt trail', 'Mud', 'Rock', 'Gravel'];

export interface Boulder { x: number; y: number; z: number; r: number }
export interface StaticBox { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; yaw: number; kind: string }
export interface Tree { x: number; z: number; y: number; r: number; h: number; kind: number }

/** Terrain data for the Phase 1 region: "Redstone Valley" (1.024 km x 1.024 km). Pure data, no rendering. */
export class Terrain {
  readonly size = 1024;          // metres per side
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
  readonly spawn = { x: 0, z: 0, heading: 0 };
  private grid = new Map<number, { b: number[]; t: number[] }>();
  private readonly gcell = 16;

  constructor(seed = 20261123) {
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

    const riverZ = (x: number) => 230 + 70 * Math.sin(x / 160) + 25 * Math.sin(x / 61 + 1.3);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i * this.cell - this.half, z = j * this.cell - this.half;
        const r = Math.hypot(x, z);
        // Rolling hills
        let h = 18 + noise.fbm(x / 320, z / 320, 5) * 28 + noise.fbm(x / 90, z / 90, 3) * 5;
        // Ridged rocky mountains rising toward the region edges and in the north-west massif
        const rim = smoothstep(330, 500, Math.max(Math.abs(x), Math.abs(z)));
        const massif = smoothstep(220, 60, Math.hypot(x + 260, z + 250));
        const mount = Math.max(rim, massif);
        h += mount * (noise.ridged(x / 210, z / 210, 5) * 95 + 15);
        // Rock-crawl ridge east of camp
        const crawl = smoothstep(90, 20, Math.hypot(x - 190, z + 60));
        h += crawl * (10 + n2.ridged(x / 30, z / 30, 3) * 6);
        // River valley carved to a common water level
        const dRiver = Math.abs(z - riverZ(x));
        const carve = 1 - smoothstep(14, 70, dRiver);
        const dt = this.trailDist(x, z);
        const ford = 1 - smoothstep(5, 16, dt); // shallow fords where trails cross water
        const depth = lerp(2.2, 0.55, ford);
        h = lerp(h, this.waterLevel - depth + smoothstep(0, 14, dRiver) * (depth + 0.8), carve * (1 - rim));
        // Base camp flattening
        const camp = 1 - smoothstep(35, 70, r);
        h = lerp(h, 16, camp);
        // Trails: gently flattened, crowned dirt tracks
        const onTrail = 1 - smoothstep(3, 9, dt);
        if (onTrail > 0) h = lerp(h, h - 0.25, onTrail);
        // Mud basins: low flat places + noise mask, slightly sunken
        const mudMask = smoothstep(0.25, 0.5, n2.fbm(x / 120 + 40, z / 120, 3)) * (1 - mount) * (1 - camp * 0.9);
        const nearRiver = 1 - smoothstep(20, 60, dRiver);
        const mudAmt = clamp(Math.max(mudMask, nearRiver * 0.8 * smoothstep(0.0, 0.3, n2.noise(x / 40, z / 40) + 0.3)), 0, 1);
        h -= mudAmt * 0.8;
        // trails never drop into deep water: build up a causeway / ford no deeper than ~0.5 m
        const ford2 = 1 - smoothstep(6, 18, dt);
        if (h < this.waterLevel - 0.5) h = lerp(h, this.waterLevel - 0.5, ford2);
        // Small-scale bumps (ruts / roughness)
        h += noise.noise(x / 6, z / 6) * (0.18 + mount * 0.6 + crawl * 0.15) * (1 - onTrail * 0.7);
        const k = j * N + i;
        this.heights[k] = h;
        this.mudDepth[k] = mudAmt;
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
        if (s !== Surface.Mud) this.mudDepth[k] = 0;
        this.surface[k] = s;
      }
    }
    this.scatter(seed);
    this.buildCamp();
  }

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

  /** Push-out of a point from static boxes. Returns penetration depth and writes the normal. */
  boxPenetration(x: number, y: number, z: number, pad: number, nOut: [number, number, number]): number {
    let best = 0;
    for (const b of this.boxes) {
      const dx = x - b.cx, dy = y - b.cy, dz = z - b.cz;
      if (Math.abs(dx) > b.hx + b.hz + pad + 1 || Math.abs(dz) > b.hx + b.hz + pad + 1) continue;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const px = b.hx + pad - Math.abs(lx), py = b.hy + pad - Math.abs(dy), pz = b.hz + pad - Math.abs(lz);
      if (px <= 0 || py <= 0 || pz <= 0) continue;
      let pen: number, nx = 0, ny = 0, nz = 0;
      if (px < py && px < pz) { pen = px; nx = Math.sign(lx); }
      else if (pz < py) { pen = pz; nz = Math.sign(lz); }
      else { pen = py; ny = Math.sign(dy); }
      if (pen > best) { best = pen; nOut[0] = nx * c + nz * s; nOut[1] = ny; nOut[2] = -nx * s + nz * c; }
    }
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
    for (let n = 0; n < 900; n++) {
      let x: number, z: number;
      if (n < 220) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 70; x = 190 + Math.cos(a) * d; z = -60 + Math.sin(a) * d; }
      else { x = (rnd() - 0.5) * (this.size - 40); z = (rnd() - 0.5) * (this.size - 40); }
      if (Math.hypot(x, z) < 60 || this.trailDist(x, z) < 7) continue;
      const surf = this.surfaceAt(x, z);
      if (n >= 220 && surf !== Surface.Rock && rnd() > 0.25) continue;
      const r = n < 220 ? 0.5 + rnd() * 1.4 : 0.6 + rnd() * rnd() * 3.5;
      const y = this.heightAt(x, z) + r * (0.1 + rnd() * 0.35);
      if (y - r * 0.2 < this.waterLevel) continue;
      this.add({ x, y, z, r }, 'b');
    }
    // Trees: avoid water, trails, rock and steep slopes
    for (let n = 0; n < 9000 && this.trees.length < 3200; n++) {
      const x = (rnd() - 0.5) * (this.size - 20), z = (rnd() - 0.5) * (this.size - 20);
      const h = this.heightAt(x, z);
      if (h < this.waterLevel + 1 || Math.hypot(x, z) < 55 || this.trailDist(x, z) < 6) continue;
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
    const c0x = Math.floor((x - r) / this.gcell), c1x = Math.floor((x + r) / this.gcell);
    const c0z = Math.floor((z - r) / this.gcell), c1z = Math.floor((z + r) / this.gcell);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const c = this.grid.get(this.key(cx, cz));
      if (!c) continue;
      for (const i of c.b) outB.add(i);
      for (const i of c.t) outT.add(i);
    }
  }

  inBounds(x: number, z: number) { return Math.abs(x) < this.half - 2 && Math.abs(z) < this.half - 2; }

  /** Height using the same triangle split as the rendered mesh. */
  heightAt(x: number, z: number): number {
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
  surfaceAt(x: number, z: number): Surface { return this.surface[this.idx(x, z)]; }
  mudAt(x: number, z: number): number { return this.mudDepth[this.idx(x, z)]; }
  waterDepthAt(x: number, z: number): number { return Math.max(0, this.waterLevel - this.heightAt(x, z)); }

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
