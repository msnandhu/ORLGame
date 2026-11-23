import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Material } from '@babylonjs/core/Materials/material';

/**
 * Lofted car bodies: smooth panels built from cross-sections along the car's length, the way real bodies are
 * surfaced (rounded shoulders, tumblehome, plan-view taper at the nose and tail, true wheel-arch cut-outs),
 * instead of flat-sided extrusions. All original geometry generated in code.
 */
export type Pt = [number, number];
export type Curve = (x: number) => number;

/** Monotone cubic (Fritsch–Carlson) through the points (sorted by x), clamped at the ends. No overshoot. */
export function curve(pts: Pt[]): Curve {
  const p = [...pts].sort((a, b) => a[0] - b[0]), n = p.length;
  if (n === 1) return () => p[0][1];
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0; while (x > p[i + 1][0]) i++;
    const h = p[i + 1][0] - p[i][0], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const spow = (x: number, e: number) => Math.pow(Math.max(0, x), e);

export interface Arch { z: number; yc: number; r: number }

export interface BodySpec {
  /** nose and tail z, maximum half width (over the wheels) */
  zf: number; zr: number; hw: number;
  /** plan-view squareness at the nose and the tail (2 = round, 12 = nearly square corners) */
  peF: number; peR: number;
  /** side profile: upper surface (bonnet, scuttle, deck) and the lower edge, as (z, y) points */
  top: Pt[]; sill: Pt[];
  /** widest point of the section as a fraction of sill -> top */
  shoulder: number;
  /** section squareness below / above the shoulder, and the narrowing of the top (0 = none) */
  nLo: number; nUp: number; tumble: number;
  arches: Arch[];
  /** body is (1 - flare) as wide between the wheels as over them: wheel-arch haunches */
  flare: number;
  /** open cabin well between these z (rear, front) down to wellY: doors with an interior between them */
  cabin?: [number, number]; wellY?: number;
}

export interface Section { hw: number; tw: number; yb: number; ys: number; yt: number; well: number }
export type RingKind = 'lower' | 'outer' | 'rim' | 'inner';
export interface RingPt { x: number; y: number; kind: RingKind; a: number }

const FWELL = 0.86; // the well's rim sits at this fraction of the top's half width

export class Body {
  readonly top: Curve; readonly sill: Curve;
  readonly zm: number; readonly half: number;
  constructor(readonly s: BodySpec) {
    this.top = curve(s.top); this.sill = curve(s.sill);
    this.zm = (s.zf + s.zr) / 2; this.half = (s.zf - s.zr) / 2;
  }

  plan(z: number) {
    const u = Math.max(-1, Math.min(1, (z - this.zm) / this.half)), pe = u > 0 ? this.s.peF : this.s.peR;
    return Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), pe)), 1 / pe);
  }

  section(z: number): Section {
    const s = this.s;
    let bump = 0;
    for (const a of s.arches) bump = Math.max(bump, Math.exp(-Math.pow((z - a.z) / (a.r * 1.45), 4)));
    const hw = s.hw * this.plan(z) * (1 - s.flare + s.flare * bump);
    const ybase = this.sill(z), yt = this.top(z);
    let yb = ybase;
    for (const a of s.arches) { const dz = z - a.z; if (Math.abs(dz) < a.r) yb = Math.max(yb, a.yc + Math.sqrt(a.r * a.r - dz * dz)); }
    yb = Math.min(yb, yt - 0.05);
    let ys = ybase + s.shoulder * (yt - ybase);
    ys = Math.min(Math.max(ys, yb + 0.025), yt - 0.02);
    let well = 0;
    if (s.cabin) well = clamp01((z - s.cabin[0]) / 0.06) * clamp01((s.cabin[1] - z) / 0.06);
    return { hw, tw: hw * (1 - s.tumble), yb, ys, yt, well };
  }

  /** Half width of the surface at height y in the section at z (negative outside the section). */
  xAt(z: number, y: number): number {
    const c = this.section(z), s = this.s;
    if (y > c.yt || y < c.yb) return -1;
    if (y >= c.ys) {
      const e = (y - c.ys) / Math.max(1e-6, c.yt - c.ys), sn = spow(e, s.nUp / 2), cs = Math.sqrt(Math.max(0, 1 - sn * sn));
      return spow(cs, 2 / s.nUp) * (c.hw - (c.hw - c.tw) * e);
    }
    const e = (c.ys - y) / Math.max(1e-6, c.ys - c.yb), sn = spow(e, s.nLo / 2), cs = Math.sqrt(Math.max(0, 1 - sn * sn));
    return c.hw * spow(cs, 2 / s.nLo);
  }

  /** z of the nose (dir 1) or tail (dir -1) surface at (x, y): the first point on the body coming in from the end. */
  endZ(x: number, y: number, dir: 1 | -1): number {
    const end = dir > 0 ? this.s.zf : this.s.zr, ax = Math.abs(x);
    const ok = (z: number) => this.xAt(z, y) >= ax;
    if (!ok(this.zm)) {
      // off the body (above the bonnet, beyond the flank): use the nearest point that is on it
      const c = this.section(this.zm); y = Math.max(c.yb + 0.002, Math.min(c.yt - 0.002, y));
      x = Math.min(ax, this.xAt(this.zm, y) * 0.995);
      return this.endZ(x, y, dir);
    }
    // march in from the end (arches make the inside non-convex), then refine
    const step = 0.02 * dir;
    let out = end, z = end;
    while ((z - this.zm) * dir > 0 && !ok(z)) { out = z; z -= step; }
    let lo = z, hi = out;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  /** Point and outward normal on the nose / tail surface. */
  endPoint(x: number, y: number, dir: 1 | -1): { p: [number, number, number]; n: [number, number, number] } {
    const d = 0.01, z0 = this.endZ(x, y, dir), sx = Math.sign(x) || 1;
    const zx = this.endZ(x + sx * d, y, dir), zy = this.endZ(x, y + d, dir);
    let nx = -(zx - z0) * sx * dir, ny = -(zy - z0) * dir, nz = d;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    return { p: [x, y, z0], n: [nx, ny, nz * dir] };
  }

  /** Point and outward normal on the side (sx = ±1) at (z, y). */
  sidePoint(sx: number, z: number, y: number): { p: [number, number, number]; n: [number, number, number] } {
    const d = 0.01, x0 = this.xAt(z, y), xz = this.xAt(z + d, y), xy = this.xAt(z, y + d);
    let nx = d, ny = -(xy - x0), nz = -(xz - x0);
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    return { p: [sx * x0, y, z], n: [sx * nx, ny, nz] };
  }

  /** Cross-section ring (closed loop), detail = points per quarter. */
  ring(z: number, detail: number): RingPt[] {
    const c = this.section(z), s = this.s, right: RingPt[] = [];
    const Ml = detail, Mo = detail, Mi = Math.max(3, Math.round(detail / 2));
    for (let i = 0; i <= Ml; i++) {
      const th = -Math.PI / 2 + (Math.PI / 2) * (i / Ml), cs = Math.cos(th), sn = -Math.sin(th);
      right.push({ x: c.hw * spow(cs, 2 / s.nLo), y: c.ys - (c.ys - c.yb) * spow(sn, 2 / s.nLo), kind: 'lower', a: 0 });
    }
    const up = (th: number) => { const cs = Math.cos(th), sn = Math.sin(th), e = spow(sn, 2 / s.nUp); return { x: spow(cs, 2 / s.nUp) * (c.hw - (c.hw - c.tw) * e), y: c.ys + (c.yt - c.ys) * e }; };
    const thw = Math.acos(Math.pow(FWELL, s.nUp / 2));
    for (let i = 1; i <= Mo; i++) { const q = up(thw * (i / Mo)); right.push({ ...q, kind: i === Mo ? 'rim' : 'outer', a: 0 }); }
    const rim = right[right.length - 1], depth = Math.max(0, rim.y - (s.wellY ?? rim.y)) * c.well;
    right.push({ x: rim.x - 0.012 * c.well, y: rim.y - depth, kind: 'inner', a: 0 });
    for (let i = 1; i <= Mi; i++) { const q = up(thw + (Math.PI / 2 - thw) * (i / Mi)); right.push({ x: q.x, y: q.y - depth, kind: 'inner', a: 0 }); }
    const n = right.length, out: RingPt[] = right.map((p, i) => ({ ...p, a: i / (n - 1) }));
    for (let i = n - 2; i >= 1; i--) out.push({ ...right[i], x: -right[i].x, a: -(i / (n - 1)) });
    return out;
  }
}

/** Greenhouse (glass house): an open-bottomed section loft sitting on the body's waist. */
export interface GreenhouseSpec {
  /** base at the scuttle (z0), roof front (zr0), roof rear (zr1), base at the rear (z1) */
  z0: number; zr0: number; zr1: number; z1: number;
  roof: number;
  /** half widths: at the base and at the roof */
  w0: number; w1: number;
  /** section squareness and an optional extra profile point list (z, y) to shape the windscreen and backlight */
  n: number; profile?: Pt[];
}

export class Greenhouse {
  readonly topC: Curve;
  constructor(readonly g: GreenhouseSpec, readonly body: Body) {
    const g0 = g;
    const pts: Pt[] = g0.profile ?? [[g0.z1, body.top(g0.z1) - 0.01], [g0.zr1, g0.roof], [(g0.zr0 + g0.zr1) / 2, g0.roof + 0.015], [g0.zr0, g0.roof], [g0.z0, body.top(g0.z0) - 0.01]];
    this.topC = curve(pts);
  }
  base(z: number) { return this.body.top(z) - 0.02; }
  ring(z: number, detail: number): RingPt[] {
    const g = this.g, yb = this.base(z), yt = Math.max(yb, this.topC(z));
    const span = Math.max(1e-3, g.roof - yb), e0 = clamp01((yt - yb) / span);
    // follow the body's plan taper where the glass runs into the tail or the nose
    // glass flush with the body's waist (never wider than the design width), narrowing to the roof
    const xb = this.body.xAt(z, yb - 0.005), w0 = Math.max(0.05, Math.min(g.w0 * 1.08, xb > 0 ? xb - 0.012 : g.w0)), w1 = w0 - (g.w0 - g.w1);
    const right: RingPt[] = [];
    for (let i = 0; i <= detail * 2; i++) {
      const th = (Math.PI / 2) * (i / (detail * 2)), cs = Math.cos(th), sn = Math.sin(th);
      const e = spow(sn, 2 / g.n);
      right.push({ x: spow(cs, 2 / g.n) * (w0 - (w0 - w1) * e * e0), y: yb + (yt - yb) * e, kind: 'outer', a: i / (detail * 2) });
    }
    // left bottom -> top centre -> right bottom (open loop)
    return [...right.map(p => ({ ...p, x: -p.x, a: -p.a })), ...right.slice(0, -1).reverse()];
  }
}

export interface Cell { z: number; y: number; x: number; a: number; kind: RingKind; j: number }

/**
 * Build a loft mesh over the stations (ascending z), split into one mesh per material class. classify() returns the
 * material key for each quad (or null to leave a hole). Each mesh keeps its own vertices so it can be dented.
 */
export function buildLoft(scene: Scene, name: string, zs: number[], rings: RingPt[][], closed: boolean,
  classify: (c: Cell) => string | null, mats: Record<string, Material>, names: Record<string, string>, updatable: boolean, flip = false): Mesh[] {
  const R = rings[0].length, S = zs.length;
  const pos = new Float32Array(S * R * 3), uv = new Float32Array(S * R * 2);
  const z0 = zs[0], zl = zs[S - 1] - z0 || 1;
  for (let j = 0; j < S; j++) for (let i = 0; i < R; i++) {
    const p = rings[j][i], k = j * R + i;
    pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = zs[j];
    uv[k * 2] = (zs[j] - z0) / zl; uv[k * 2 + 1] = i / R;
  }
  const groups = new Map<string, number[]>();
  const cols = closed ? R : R - 1;
  for (let j = 0; j < S - 1; j++) for (let i = 0; i < cols; i++) {
    const i1 = (i + 1) % R, a = j * R + i, b = j * R + i1, c = (j + 1) * R + i, d = (j + 1) * R + i1;
    const p = rings[j][i], q = rings[j][i1];
    const key = classify({ z: (zs[j] + zs[j + 1]) / 2, y: (p.y + q.y) / 2, x: (p.x + q.x) / 2, a: (p.a + q.a) / 2, kind: p.kind === q.kind ? p.kind : q.kind, j });
    if (!key) continue;
    let g = groups.get(key); if (!g) { g = []; groups.set(key, g); }
    if (flip) g.push(a, b, c, b, d, c); else g.push(a, c, b, b, c, d);
  }
  const out: Mesh[] = [];
  for (const [key, idx] of groups) {
    const m = new Mesh(names[key] ?? `${name}-${key}`, scene);
    const vd = new VertexData();
    vd.positions = Array.from(pos); vd.indices = idx; vd.uvs = Array.from(uv);
    const nrm: number[] = []; VertexData.ComputeNormals(vd.positions, idx, nrm); vd.normals = nrm;
    vd.applyToMesh(m, updatable);
    m.material = mats[key] ?? null;
    out.push(m);
  }
  return out;
}

/** Station list from z0 to z1 with roughly `step` spacing, plus extra stations hugging each wheel-arch edge. */
export function stations(z0: number, z1: number, step: number, extra: number[] = []): number[] {
  const n = Math.max(2, Math.ceil((z1 - z0) / step));
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) zs.push(z0 + (z1 - z0) * (i / n));
  for (const e of extra) if (e > z0 && e < z1) zs.push(e);
  zs.sort((a, b) => a - b);
  return zs.filter((z, i) => i === 0 || z - zs[i - 1] > 1e-4);
}
