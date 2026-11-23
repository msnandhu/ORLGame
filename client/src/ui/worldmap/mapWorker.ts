/// <reference lib="webworker" />
import { Island, Noise2D, clamp, lerp, smoothstep, type RegionId } from '@orl/shared';

/**
 * Renders the island map off the main thread: shaded relief coloured by region and land cover, sampled from the
 * same elevation and water functions the world uses, plus region outlines and per-region statistics.
 */
const island = new Island();
const fieldNoise = new Noise2D(77);
const REG: RegionId[] = ['snow', 'hill', 'plain', 'forest'];

export interface MapMeta {
  /** region id per cell (-1 = sea), `cols` x `rows` cells of `cell` metres from (x0, z0) */
  grid: Int8Array; cols: number; rows: number; cell: number; x0: number; z0: number;
  stats: Record<RegionId, { area: number; minH: number; maxH: number; cells: number; x0: number; z0: number; x1: number; z1: number }>;
  /** outline segments per region (x0, z0, x1, z1 ...) in world metres */
  borders: Record<RegionId, Float32Array>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function hash(i: number, j: number) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

const FIELD = [[206, 178, 78], [152, 190, 70], [118, 164, 58], [170, 128, 74], [190, 196, 92], [96, 146, 56]];
const w: Record<RegionId, number> = { snow: 0, hill: 0, plain: 0, forest: 0 };

/** Ground colour at a point (before relief shading). */
let hedge = 1;
function ground(x: number, z: number, h: number, slope: number, out: number[]) {
  const cd = island.coastDist(x, z);
  const water = island.waterAt(x, z);
  if (cd <= 0 && h < 0.5) {
    const t = clamp(-cd / 2600, 0, 1);
    out[0] = lerp(46, 12, t); out[1] = lerp(150, 42, t); out[2] = lerp(168, 86, t); return;
  }
  if (water > h + 0.05) {
    const lake = island.lakes.find(l => Math.hypot(x - l.x, z - l.z) < l.r * 1.3);
    if (lake?.frozen) { out[0] = 176; out[1] = 220; out[2] = 238; return; }
    const d = clamp((water - h) / 6, 0, 1);
    out[0] = lerp(62, 26, d); out[1] = lerp(140, 92, d); out[2] = lerp(170, 150, d); return;
  }
  island.regionBlend(x, z, w);
  let r = 0, g = 0, b = 0;
  const n1 = fieldNoise.noise(x / 90, z / 90), n2 = fieldNoise.noise(x / 23, z / 23);
  if (w.plain > 0) {
    // patchwork of fields on a slightly rotated grid, with darker hedgerows
    const a = 0.35 + fieldNoise.noise(x / 6000, z / 6000) * 0.5, ca = Math.cos(a), sa = Math.sin(a);
    const u = (x * ca - z * sa) / 380, v = (x * sa + z * ca) / 280;
    const i = Math.floor(u), j = Math.floor(v), c = FIELD[Math.floor(hash(i, j) * FIELD.length)];
    const edge = Math.min(u - i, 1 - (u - i), v - j, 1 - (v - j));
    const k = edge < 0.04 ? lerp(1, 0.75, hedge) : 1;
    // farmland in patches, meadow and copses between
    const wild = smoothstep(-0.05, 0.35, fieldNoise.noise(x / 1800 + 3, z / 1800)) * 0.85;
    const copse = smoothstep(0.45, 0.7, fieldNoise.noise(x / 300 + 7, z / 300));
    r += w.plain * lerp(lerp(c[0] * k, 118, wild), 52, copse); g += w.plain * lerp(lerp(c[1] * k, 160, wild), 104, copse); b += w.plain * lerp(lerp(c[2] * k, 58, wild), 38, copse);
  }
  if (w.forest > 0) { const t = 0.5 + n1 * 0.3 + n2 * 0.2; r += w.forest * lerp(18, 52, t); g += w.forest * lerp(66, 118, t); b += w.forest * lerp(26, 44, t); }
  if (w.hill > 0) {
    const pine = smoothstep(-0.1, 0.25, fieldNoise.noise(x / 700 + 9, z / 700));
    const t = 0.5 + n2 * 0.25;
    r += w.hill * lerp(lerp(118, 40, pine), lerp(140, 60, pine), t); g += w.hill * lerp(lerp(140, 92, pine), lerp(160, 110, pine), t); b += w.hill * lerp(62, 44, pine);
  }
  if (w.snow > 0) { r += w.snow * 150; g += w.snow * 150; b += w.snow * 140; }
  // beaches
  if (cd < 160 && h < 6 && w.snow < 0.5) { const t = 1 - smoothstep(60, 160, cd); r = lerp(r, 218, t); g = lerp(g, 204, t); b = lerp(b, 156, t); }
  // bare rock on steep ground, snow up high (and everywhere in the snow region)
  const rock = smoothstep(0.55, 0.95, slope);
  r = lerp(r, 128, rock); g = lerp(g, 122, rock); b = lerp(b, 116, rock);
  // snow lies on all but the steepest faces in the snow region, and above ~1,100 m anywhere
  const snow = Math.max(smoothstep(950, 1250, h + n1 * 80), w.snow * smoothstep(300, 700, h)) * (1 - smoothstep(1.1 + w.snow * 0.5, 1.7 + w.snow * 0.6, slope));
  r = lerp(r, 236 + n2 * 10, snow); g = lerp(g, 242 + n2 * 8, snow); b = lerp(b, 252, snow);
  out[0] = r; out[1] = g; out[2] = b;
}

function render(x0: number, z0: number, x1: number, z1: number, W: number, H: number): Uint8ClampedArray {
  const mx = (x1 - x0) / W, mz = (z1 - z0) / H;
  const hs = new Float32Array((W + 2) * (H + 2));
  for (let j = 0; j < H + 2; j++) for (let i = 0; i < W + 2; i++) hs[j * (W + 2) + i] = island.heightAt(x0 + (i - 0.5) * mx, z0 + (j - 0.5) * mz);
  const px = new Uint8ClampedArray(W * H * 4), c = [0, 0, 0];
  // relief is exaggerated when zoomed out so small hills still read
  const ex = clamp(Math.sqrt(mx / 8), 1, 2.6);
  hedge = clamp(1 - mx / 14, 0, 1);
  const L = [-0.55, 0.62, -0.55], Ln = Math.hypot(...L);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = (j + 1) * (W + 2) + i + 1, h = hs[k];
    const gx = (hs[k + 1] - hs[k - 1]) / (2 * mx), gz = (hs[k + W + 2] - hs[k - W - 2]) / (2 * mz);
    const x = x0 + (i + 0.5) * mx, z = z0 + (j + 0.5) * mz;
    ground(x, z, h, Math.hypot(gx, gz), c);
    let shade = 1;
    if (h > 0.3) {
      const nx = -gx * ex, nz = -gz * ex, nl = Math.hypot(nx, 1, nz);
      const d = (nx * L[0] + L[1] + nz * L[2]) / (nl * Ln);
      shade = clamp(0.38 + d * 0.86, 0.3, 1.35);
    }
    const o = (j * W + i) * 4;
    px[o] = c[0] * shade; px[o + 1] = c[1] * shade; px[o + 2] = c[2] * shade; px[o + 3] = 255;
  }
  return px;
}

function meta(): MapMeta {
  const cell = 250, x0 = island.minX, z0 = island.minZ;
  const cols = Math.ceil((island.maxX - x0) / cell), rows = Math.ceil((island.maxZ - z0) / cell);
  const grid = new Int8Array(cols * rows);
  const stats = Object.fromEntries(REG.map(r => [r, { area: 0, minH: Infinity, maxH: -Infinity, cells: 0, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }])) as MapMeta['stats'];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
    const r = island.regionAt(x, z);
    grid[j * cols + i] = r ? REG.indexOf(r) : -1;
    // area from a finer 2 x 2 sampling of each cell
    for (const [du, dv] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const q = island.regionAt(x + du * cell, z + dv * cell); if (q) stats[q].area += cell * cell / 4e6;
    }
    if (!r) continue;
    const s = stats[r], h = island.heightAt(x, z);
    s.cells++;
    s.minH = Math.min(s.minH, h); s.maxH = Math.max(s.maxH, h);
    s.x0 = Math.min(s.x0, x - cell / 2); s.z0 = Math.min(s.z0, z - cell / 2); s.x1 = Math.max(s.x1, x + cell / 2); s.z1 = Math.max(s.z1, z + cell / 2);
  }
  // summits are narrower than a cell: include the named peaks exactly
  for (const p of island.pois) if (p.kind === 'peak' || p.kind === 'gang') { const s = stats[p.region]; s.maxH = Math.max(s.maxH, island.heightAt(p.x, p.z)); }
  for (const r of REG) stats[r].minH = Math.max(0, stats[r].minH);
  // outlines: marching squares on "inside this region and on land"
  const bc = 160, bcols = Math.ceil((island.maxX - x0) / bc) + 1, brows = Math.ceil((island.maxZ - z0) / bc) + 1;
  const f: Record<RegionId, Float32Array> = Object.fromEntries(REG.map(r => [r, new Float32Array(bcols * brows)])) as Record<RegionId, Float32Array>;
  const sc: Record<RegionId, number> = { snow: 0, hill: 0, plain: 0, forest: 0 };
  for (let j = 0; j < brows; j++) for (let i = 0; i < bcols; i++) {
    const x = x0 + i * bc, z = z0 + j * bc, cd = island.coastDist(x, z);
    island.regionScores(x, z, sc);
    for (const r of REG) {
      let other = Infinity; for (const q of REG) if (q !== r) other = Math.min(other, sc[q]);
      f[r][j * bcols + i] = Math.min((other - sc[r]) / 24000, cd);
    }
  }
  const borders = {} as Record<RegionId, Float32Array>;
  for (const r of REG) {
    const F = f[r], seg: number[] = [];
    const P = (i: number, j: number, a: number, b: number, ia: number, ja: number, ib: number, jb: number) => {
      const t = a / (a - b); return [x0 + lerp(ia, ib, t) * bc, z0 + lerp(ja, jb, t) * bc];
    };
    for (let j = 0; j < brows - 1; j++) for (let i = 0; i < bcols - 1; i++) {
      const v = [F[j * bcols + i], F[j * bcols + i + 1], F[(j + 1) * bcols + i + 1], F[(j + 1) * bcols + i]];
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const pts: number[][] = [];
      for (let e = 0; e < 4; e++) {
        const a = v[e], b = v[(e + 1) % 4];
        if ((a > 0) !== (b > 0)) pts.push(P(i, j, a, b, c[e][0], c[e][1], c[(e + 1) % 4][0], c[(e + 1) % 4][1]));
      }
      if (pts.length === 2) seg.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
      else if (pts.length === 4) seg.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
    }
    borders[r] = new Float32Array(seg);
  }
  return { grid, cols, rows, cell, x0, z0, stats, borders, bounds: { minX: island.minX, maxX: island.maxX, minZ: island.minZ, maxZ: island.maxZ } };
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'meta') {
    const out = meta();
    (self as unknown as Worker).postMessage({ type: 'meta', meta: out }, [out.grid.buffer, ...Object.values(out.borders).map(b => b.buffer)]);
  } else if (m.type === 'render') {
    const px = render(m.x0, m.z0, m.x1, m.z1, m.w, m.h);
    (self as unknown as Worker).postMessage({ type: 'render', id: m.id, w: m.w, h: m.h, x0: m.x0, z0: m.z0, x1: m.x1, z1: m.z1, px }, [px.buffer]);
  }
};
