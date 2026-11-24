/**
 * Small geometry kit for the skinned character: grids (lofts, shells, ellipsoids) accumulated per material,
 * each vertex carrying a baked colour (albedo tint, cavity shading, dirt) and up to four bone weights.
 * Everything is authored in the bind pose, in the character's scale space (reference figure 1.75 m).
 */
export type V3 = [number, number, number];
export type RGB = [number, number, number];
/** [bone index, weight] pairs; normalised and trimmed to four on write */
export type Weights = [number, number][];
export type WeightFn = (p: V3, row: number) => Weights;
export type ColorFn = (p: V3, row: number, col: number) => RGB;

export const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mulc = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** sRGB hex to linear RGB (vertex colours multiply the albedo in linear space) */
export function lin(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

/** Cheap smooth 3D value noise (deterministic), roughly -1..1. */
function hash(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
export const fbm = (p: V3, f: number, oct = 3) => { let s = 0, a = 0.5, k = f; for (let i = 0; i < oct; i++) { s += noise3(p[0] * k, p[1] * k, p[2] * k) * a; a *= 0.5; k *= 2.03; } return s; };

export class Geo {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = []; mi: number[] = []; mw: number[] = [];
  get count() { return this.pos.length / 3; }
  vertex(p: V3, n: V3, u: number, v: number, c: RGB, w: Weights) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(u, v); this.col.push(c[0], c[1], c[2], 1);
    const ws = w.filter(x => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = ws.reduce((s, x) => s + x[1], 0) || 1;
    for (let i = 0; i < 4; i++) { this.mi.push(ws[i] ? ws[i][0] : 0); this.mw.push(ws[i] ? ws[i][1] / tot : 0); }
    return this.count - 1;
  }
  append(o: Geo) {
    const base = this.count;
    this.pos.push(...o.pos); this.nrm.push(...o.nrm); this.uv.push(...o.uv); this.col.push(...o.col); this.mi.push(...o.mi); this.mw.push(...o.mw);
    for (const i of o.idx) this.idx.push(i + base);
  }
}

export interface GridOpts {
  /** columns wrap around (a closed loft) */
  closed?: boolean;
  weights: Weights | WeightFn;
  color: RGB | ColorFn;
  /** texture coordinates; default: metres around (u) and along (v) the surface */
  uv?: (row: number, col: number, p: V3) => [number, number];
  /** fan caps closing the first / last row (closed lofts only) */
  capStart?: boolean; capEnd?: boolean;
  /** keep the quad starting at (row, col)? (for surfaces with holes, like a beard) */
  keep?: (row: number, col: number) => boolean;
  /** a point inside the surface (the normals face away from it); default: the centroid of each row */
  inside?: V3 | ((row: number) => V3);
  /** flip the facing (for surfaces seen from the inside) */
  flip?: boolean;
}

/**
 * Collects the character's surfaces per material key. `q` is the tessellation quality (1 = full, 0.25 = far LOD).
 */
export class Builder {
  readonly groups = new Map<string, Geo>();
  constructor(readonly q: number, readonly lite = false) {}
  geo(key: string) { let g = this.groups.get(key); if (!g) { g = new Geo(); this.groups.set(key, g); } return g; }
  /** segment count scaled by quality */
  n(base: number, min = 3) { return Math.max(min, Math.round(base * this.q)); }

  grid(key: string, rows: V3[][], o: GridOpts) {
    const g = this.geo(key), R = rows.length, C = rows[0].length, closed = !!o.closed;
    if (R < 2 || C < 2) return;
    const P = (i: number, j: number) => rows[Math.max(0, Math.min(R - 1, i))][closed ? ((j % C) + C) % C : Math.max(0, Math.min(C - 1, j))];
    const centre = (i: number): V3 => {
      if (o.inside) return typeof o.inside === 'function' ? o.inside(i) : o.inside;
      let x = 0, y = 0, z = 0; for (const p of rows[i]) { x += p[0]; y += p[1]; z += p[2]; } return [x / C, y / C, z / C];
    };
    // arc-length v and average perimeter u for default texture coordinates
    const vAcc: number[] = [0];
    for (let i = 1; i < R; i++) { let s = 0; for (let j = 0; j < C; j++) s += len(sub(rows[i][j], rows[i - 1][j])); vAcc.push(vAcc[i - 1] + s / C); }
    let per = 0; for (let i = 0; i < R; i++) { let s = 0; for (let j = 0; j < C - (closed ? 0 : 1); j++) s += len(sub(P(i, j + 1), P(i, j))); per += s / R; }
    // normals: cross product of the finite differences; the orientation is fixed per row from the inside point
    const normals: V3[][] = [];
    let G: V3 = [0, 0, 0];
    for (const r of rows) for (const p of r) G = add(G, p);
    G = scl(G, 1 / (R * C));
    for (let i = 0; i < R; i++) {
      const row: V3[] = [], c = centre(i);
      let facing = 0;
      for (let j = 0; j < C; j++) {
        const du = sub(P(i, j + 1), P(i, j - 1)), dv = sub(P(i + 1, j), P(i - 1, j));
        let n = cross(du, dv);
        if (len(n) < 1e-12) n = sub(P(i, j), c);
        if (len(n) < 1e-9) n = sub(P(i, j), o.inside ? c : G);
        n = norm(n); row.push(n);
        facing += dot(n, sub(P(i, j), c));
      }
      const s = (facing < 0 ? -1 : 1) * (o.flip ? -1 : 1);
      if (s < 0) for (const n of row) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
      normals.push(row);
    }
    const cols = closed ? C + 1 : C, base = g.count;
    const wf = o.weights, cf = o.color;
    for (let i = 0; i < R; i++) for (let jj = 0; jj < cols; jj++) {
      const j = jj % C, p = rows[i][j];
      const [u, v] = o.uv ? o.uv(i, jj, p) : [(jj / (cols - 1)) * per, vAcc[i]];
      g.vertex(p, normals[i][j], u, v, typeof cf === 'function' ? cf(p, i, j) : cf, typeof wf === 'function' ? wf(p, i) : wf);
    }
    // winding: decided per quad against its normal, so every surface is front-facing from outside
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < cols - 1; j++) {
      if (o.keep && !o.keep(i, j % C)) continue;
      const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      const pa = rows[i][j % C], pb = rows[i][(j + 1) % C], pc = rows[i + 1][j % C];
      const fn = cross(sub(pb, pa), sub(pc, pa)), nn = normals[i][j % C];
      // Babylon's front faces wind clockwise about the outward normal
      if (dot(fn, nn) >= 0) g.idx.push(a, c, b, b, c, d); else g.idx.push(a, b, c, b, d, c);
    }
    if (closed && (o.capStart || o.capEnd)) {
      for (const [ri, on] of [[0, o.capStart], [R - 1, o.capEnd]] as [number, boolean | undefined][]) {
        if (!on) continue;
        const rc = (k: number): V3 => { let x = 0, y = 0, z = 0; for (const p of rows[k]) { x += p[0]; y += p[1]; z += p[2]; } return [x / C, y / C, z / C]; };
        const c = rc(ri), axis = norm(sub(rc(ri === 0 ? 0 : R - 1), rc(ri === 0 ? 1 : R - 2)));
        const w = typeof wf === 'function' ? wf(c, ri) : wf, col = typeof cf === 'function' ? cf(c, ri, 0) : cf;
        const ci = g.vertex(c, axis, 0, 0, col, w), ring: number[] = [];
        for (let j = 0; j < C; j++) ring.push(g.vertex(rows[ri][j], axis, Math.cos((j / C) * 6.283) * 0.05, Math.sin((j / C) * 6.283) * 0.05, col, typeof wf === 'function' ? wf(rows[ri][j], ri) : wf));
        for (let j = 0; j < C; j++) {
          const a = ring[j], b = ring[(j + 1) % C], pa = rows[ri][j], pb = rows[ri][(j + 1) % C];
          if (dot(cross(sub(pa, c), sub(pb, c)), axis) >= 0) g.idx.push(ci, b, a); else g.idx.push(ci, a, b);
        }
      }
    }
  }
}

/** A ring of `n` points around centre `c` in the plane of unit axes ax/ay: superellipse with separate +/- radii. */
export function ring(c: V3, ax: V3, ay: V3, n: number, r: { xp: number; xn?: number; yp: number; yn?: number; p?: number; a0?: number; a1?: number }, f?: (a: number) => number): V3[] {
  const out: V3[] = [], p = r.p ?? 2, a0 = r.a0 ?? 0, a1 = r.a1 ?? Math.PI * 2, open = r.a1 !== undefined;
  const e = 2 / p;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (open ? i / (n - 1) : i / n);
    const s = Math.sin(a), co = Math.cos(a);
    const x = Math.sign(s) * Math.pow(Math.abs(s), e) * (s >= 0 ? r.xp : r.xn ?? r.xp);
    const y = Math.sign(co) * Math.pow(Math.abs(co), e) * (co >= 0 ? r.yp : r.yn ?? r.yp);
    const k = f ? f(a) : 1;
    out.push([c[0] + (ax[0] * x + ay[0] * y) * k, c[1] + (ax[1] * x + ay[1] * y) * k, c[2] + (ax[2] * x + ay[2] * y) * k]);
  }
  return out;
}

/** Parallel-transport frames along a path: [point, tangent, normal, binormal][] */
export function frames(path: V3[], up: V3 = [0, 1, 0]): [V3, V3, V3, V3][] {
  const out: [V3, V3, V3, V3][] = [];
  let nPrev: V3 | null = null;
  for (let i = 0; i < path.length; i++) {
    const t = norm(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
    let n: V3;
    if (!nPrev) { n = cross(t, up); if (len(n) < 1e-6) n = cross(t, [1, 0, 0]); n = norm(n); }
    else { n = norm(sub(nPrev, scl(t, dot(nPrev, t)))); }
    const b = norm(cross(t, n));
    out.push([path[i], t, n, b]); nPrev = n;
  }
  return out;
}

/** Catmull-Rom through points, `n` samples. */
export function spline(pts: V3[], n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(t)), f = t - k;
    const p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(pts.length - 1, k + 2)];
    const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * f + (2 * a - 5 * b + 4 * cc - d) * f * f + (-a + 3 * b - 3 * cc + d) * f * f * f);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}

/** Interpolate a table of [key, ...values] rows (sorted by key) with smooth Catmull-Rom between rows. */
export function table(rows: number[][], x: number): number[] {
  const n = rows.length;
  if (x <= rows[0][0]) return rows[0].slice(1);
  if (x >= rows[n - 1][0]) return rows[n - 1].slice(1);
  let k = 0; while (k < n - 2 && rows[k + 1][0] < x) k++;
  const f = (x - rows[k][0]) / (rows[k + 1][0] - rows[k][0]);
  const r0 = rows[Math.max(0, k - 1)], r1 = rows[k], r2 = rows[k + 1], r3 = rows[Math.min(n - 1, k + 2)];
  const out: number[] = [];
  for (let c = 1; c < r1.length; c++) {
    const a = r0[c], b = r1[c], cc = r2[c], d = r3[c];
    const v = 0.5 * (2 * b + (-a + cc) * f + (2 * a - 5 * b + 4 * cc - d) * f * f + (-a + 3 * b - 3 * cc + d) * f * f * f);
    // stay within the neighbouring values (no overshoot bumps)
    out.push(Math.min(Math.max(v, Math.min(b, cc)), Math.max(b, cc)));
  }
  return out;
}

/** Latitude/longitude ellipsoid rows around centre c (axes ax, ay, az; radii r), poles nudged open; `f` scales the radius. */
export function ellipsoidRows(c: V3, r: V3, rows: number, cols: number, f?: (th: number, ph: number) => number, ax: V3 = [1, 0, 0], ay: V3 = [0, 1, 0], az: V3 = [0, 0, 1]): V3[][] {
  const out: V3[][] = [];
  for (let i = 0; i <= rows; i++) {
    const th = 0.02 + (Math.PI - 0.04) * (i / rows), row: V3[] = [];
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2, k = f ? f(th, ph) : 1;
      const x = Math.sin(th) * Math.sin(ph) * r[0] * k, y = Math.cos(th) * r[1] * k, z = Math.sin(th) * Math.cos(ph) * r[2] * k;
      row.push([c[0] + ax[0] * x + ay[0] * y + az[0] * z, c[1] + ax[1] * x + ay[1] * y + az[1] * z, c[2] + ax[2] * x + ay[2] * y + az[2] * z]);
    }
    out.push(row);
  }
  return out;
}
