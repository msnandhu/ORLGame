import { OuterWorld, Noise2D, clamp, smoothstep, S_GRASS, S_DIRT, S_MUD, S_ROCK, S_GRAVEL, S_ASPHALT, S_SNOW, S_SAND, S_ICE, type RegionId } from '@orl/shared';

/**
 * Geometry for one node of the island's terrain quadtree: 65 x 65 samples (128 m at 2 m spacing for the finest
 * level, doubling per level), a skirt that hides cracks between levels, normals, splat weights, snow and sand
 * cover and a macro tint, plus the node's trees for the near levels. Built by a worker (or on the main thread if
 * workers are unavailable) from the same OuterWorld the physics reads, so the finest level is exactly the
 * ground the vehicles drive on.
 */
export const NODE_N = 65;
export const BASE_SIZE = 128;
/** levels at or below this one carry trees */
export const TREE_LEVEL = 1;

export interface NodeRequest { id: number; level: number; ix: number; iz: number; trees: boolean }
export interface NodeData {
  id: number; level: number; ix: number; iz: number;
  /** local positions (x, z relative to the node origin), grid then skirt */
  pos: Float32Array; nrm: Float32Array; col: Float32Array; splat: Float32Array; extra: Float32Array;
  minY: number; maxY: number;
  /** trees: x, y, z, height, radius, kind (world coordinates) */
  trees: Float32Array;
}

/** Splat weights (grass, dirt, rock, mud) and extra cover (snow, sand) per surface. */
const SPLAT: Record<number, [number, number, number, number]> = {
  [S_GRASS]: [1, 0, 0, 0], [S_DIRT]: [0, 1, 0, 0], [S_MUD]: [0, 0.15, 0, 0.85], [S_ROCK]: [0, 0.1, 0.9, 0],
  [S_GRAVEL]: [0, 0.55, 0.45, 0], [S_ASPHALT]: [0, 0.8, 0.2, 0], [S_SNOW]: [0, 0.3, 0.7, 0], [S_SAND]: [0, 1, 0, 0], [S_ICE]: [0, 0, 1, 0],
};
/** Macro tint per region: lush jungle, golden plains, cool grey snowfields. */
const TINT: Record<RegionId, [number, number, number]> = {
  forest: [0.8, 0.96, 0.74], plain: [1.1, 1.05, 0.82], hill: [1, 0.99, 0.92], snow: [0.95, 0.97, 1.02],
};

export class NodeBuilder {
  private noise = new Noise2D(5);
  private rw: Record<RegionId, number> = { snow: 0, hill: 0, plain: 0, forest: 0 };
  constructor(readonly outer: OuterWorld) {}

  build(req: NodeRequest): NodeData {
    const o = this.outer, N = NODE_N, G = N + 2, step = 2 << req.level, size = BASE_SIZE << req.level;
    const x0 = req.ix * size, z0 = req.iz * size, core = o.coreHalf - 0.5;
    // heights with a one-sample ring for normals
    const gh = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) gh[j * G + i] = o.groundAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
    const V = N * N + 4 * N;
    const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3), col = new Float32Array(V * 4), splat = new Float32Array(V * 4), extra = new Float32Array(V * 2);
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = x0 + i * step, z = z0 + j * step, g = (j + 1) * G + i + 1;
      let h = gh[g];
      const gx = (gh[g + 1] - gh[g - 1]) / (2 * step), gz = (gh[g + G] - gh[g - G]) / (2 * step), slope = Math.hypot(gx, gz);
      const l = Math.hypot(gx, 1, gz), ny = 1 / l;
      nrm[k * 3] = -gx / l; nrm[k * 3 + 1] = ny; nrm[k * 3 + 2] = -gz / l;
      // the detailed valley draws itself: anything inside it is tucked out of sight under its terrain
      if (Math.abs(x) < core && Math.abs(z) < core) h -= 400;
      pos[k * 3] = x - x0; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z - z0;
      minY = Math.min(minY, h); maxY = Math.max(maxY, h);
      const [s] = o.classify(x, z, gh[g], slope);
      const sp = SPLAT[s] ?? SPLAT[S_GRASS];
      let a = sp[0], b = sp[1], c = sp[2], d = sp[3];
      const steep = clamp((0.86 - ny) / 0.16, 0, 1);
      a *= 1 - steep; b *= 1 - steep * 0.7; d *= 1 - steep; c += steep;
      const sum = a + b + c + d || 1;
      splat.set([a / sum, b / sum, c / sum, d / sum], k * 4);
      // snow and sand blend smoothly (the physics surface switches at 50 % cover)
      const water = o.waterAt(x, z);
      let snow = o.snowCover(x, z, gh[g], slope);
      if (s === S_ICE) snow = Math.max(snow, 0.6);
      const cd = o.island.coastDist(x, z);
      const sand = s === S_ASPHALT ? 0 : (1 - smoothstep(110, 170, cd)) * (1 - smoothstep(3.5, 7, gh[g]));
      extra[k * 2] = s === S_ASPHALT ? 0 : snow; extra[k * 2 + 1] = water > gh[g] && cd > 400 ? 0 : sand;
      o.island.regionBlend(x, z, this.rw);
      const w = this.rw;
      let tr = 0, tg = 0, tb = 0;
      for (const r of ['forest', 'plain', 'hill', 'snow'] as RegionId[]) { tr += TINT[r][0] * w[r]; tg += TINT[r][1] * w[r]; tb += TINT[r][2] * w[r]; }
      const tw = w.forest + w.plain + w.hill + w.snow || 1;
      const v = 1 + this.noise.fbm(x / 180, z / 180, 3) * 0.26 + this.noise.noise(x / 31, z / 31) * 0.06;
      const wet = water > gh[g] - 0.5 ? 0.7 : 1;
      col.set([v * wet * tr / tw, v * wet * tg / tw, v * wet * tb / tw, 1], k * 4);
    }
    // skirts: a copy of each edge row dropped below it
    const drop = step * 1.5 + 3;
    const edge = (e: number, t: number) => e === 0 ? t : e === 1 ? (N - 1) * N + t : e === 2 ? t * N : t * N + N - 1;
    for (let e = 0; e < 4; e++) for (let t = 0; t < N; t++) {
      const src = edge(e, t), k = N * N + e * N + t;
      pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - drop; pos[k * 3 + 2] = pos[src * 3 + 2];
      nrm.copyWithin(k * 3, src * 3, src * 3 + 3); col.copyWithin(k * 4, src * 4, src * 4 + 4);
      splat.copyWithin(k * 4, src * 4, src * 4 + 4); extra.copyWithin(k * 2, src * 2, src * 2 + 2);
    }
    let trees = new Float32Array(0);
    if (req.trees) {
      const out: number[] = [];
      const tiles = size / OuterWorld.TILE;
      // a tile sample (2 m) read from this node's grid, bilinearly
      for (let tj = 0; tj < tiles; tj++) for (let ti = 0; ti < tiles; ti++) {
        const TI = req.ix * tiles + ti, TJ = req.iz * tiles + tj;
        const hs = (i: number, j: number) => {
          const fx = (TI * OuterWorld.TILE + i * OuterWorld.CELL - x0) / step, fz = (TJ * OuterWorld.TILE + j * OuterWorld.CELL - z0) / step;
          const a = Math.min(N - 2, Math.floor(fx)), b = Math.min(N - 2, Math.floor(fz)), u = fx - a, w = fz - b;
          const g = (b + 1) * G + a + 1;
          return (gh[g] * (1 - u) + gh[g + 1] * u) * (1 - w) + (gh[g + G] * (1 - u) + gh[g + G + 1] * u) * w;
        };
        for (const t of o.scatter(TI, TJ, hs)) out.push(t.x, t.y, t.z, t.h, t.r, t.kind);
      }
      trees = new Float32Array(out);
    }
    return { id: req.id, level: req.level, ix: req.ix, iz: req.iz, pos, nrm, col, splat, extra, minY, maxY, trees };
  }
}

/** Triangle indices shared by every node: the grid (split like Terrain.heightAt) and the four skirts. */
export function nodeIndices(): Uint32Array {
  const N = NODE_N, idx: number[] = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx.push(a, b, c, c, b, d);
  }
  const edge = (e: number, t: number) => e === 0 ? t : e === 1 ? (N - 1) * N + t : e === 2 ? t * N : t * N + N - 1;
  for (let e = 0; e < 4; e++) for (let t = 0; t < N - 1; t++) {
    const a = edge(e, t), b = edge(e, t + 1), a2 = N * N + e * N + t, b2 = a2 + 1;
    // both windings, so the skirt shows from either side
    idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
  }
  return new Uint32Array(idx);
}
