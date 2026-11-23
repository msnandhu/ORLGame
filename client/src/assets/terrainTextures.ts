import type { RawImage } from './proceduralTextures';

/**
 * Procedural, seamlessly tiling terrain layer textures (original, generated at load).
 * RGB = albedo (sRGB), A = height used for height-based layer blending.
 * Layers: 0 grass, 1 dirt, 2 rock, 3 mud.
 */
export function terrainLayers(size = 512): RawImage[] {
  return [grass(size), dirt(size), rock(size), mud(size)];
}

// ---------- tileable noise helpers ----------
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

/** Periodic value-noise fBm over [0,size)², period P cells per octave. */
function fbm(size: number, seed: number, base: number, octaves: number, gain = 0.5): Float32Array {
  const r = rng(seed), out = new Float32Array(size * size);
  let amp = 1, P = base, norm = 0;
  for (let o = 0; o < octaves; o++, P *= 2, amp *= gain) {
    const lat = new Float32Array(P * P); for (let i = 0; i < lat.length; i++) lat[i] = r();
    const cell = size / P; norm += amp;
    for (let y = 0; y < size; y++) {
      const fy = y / cell, iy = Math.floor(fy); let v = fy - iy; v = v * v * (3 - 2 * v);
      const y0 = (iy % P) * P, y1 = ((iy + 1) % P) * P;
      for (let x = 0; x < size; x++) {
        const fx = x / cell, ix = Math.floor(fx); let u = fx - ix; u = u * u * (3 - 2 * u);
        const x0 = ix % P, x1 = (ix + 1) % P;
        out[y * size + x] += amp * ((lat[y0 + x0] * (1 - u) + lat[y0 + x1] * u) * (1 - v) + (lat[y1 + x0] * (1 - u) + lat[y1 + x1] * u) * v);
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Periodic Worley noise: returns F1 distance and F2-F1 (edge) per pixel, in cell units. */
function worley(size: number, seed: number, cells: number): { f1: Float32Array; edge: Float32Array; id: Float32Array } {
  const r = rng(seed), pts: [number, number][] = [];
  for (let i = 0; i < cells * cells; i++) pts.push([r(), r()]);
  const f1 = new Float32Array(size * size), edge = new Float32Array(size * size), id = new Float32Array(size * size), cell = size / cells;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = x / cell, gy = y / cell, cx = Math.floor(gx), cy = Math.floor(gy);
    let d1 = 9, d2 = 9, best = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const ox = cx + i, oy = cy + j, wx = ((ox % cells) + cells) % cells, wy = ((oy % cells) + cells) % cells;
      const p = pts[wy * cells + wx], dx = ox + p[0] - gx, dy = oy + p[1] - gy, d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; best = wy * cells + wx; } else if (d < d2) d2 = d;
    }
    const k = y * size + x; f1[k] = d1; edge[k] = d2 - d1; id[k] = (best * 0.6180339) % 1;
  }
  return { f1, edge, id };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ss = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function pack(size: number, fn: (k: number, x: number, y: number) => [number, number, number, number]): RawImage {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = y * size + x, [r, g, b, h] = fn(k, x, y);
    d[k * 4] = clamp01(r) * 255; d[k * 4 + 1] = clamp01(g) * 255; d[k * 4 + 2] = clamp01(b) * 255; d[k * 4 + 3] = clamp01(h) * 255;
  }
  return { width: size, height: size, data: d };
}

// ---------- layers ----------
function grass(S: number): RawImage {
  const base = fbm(S, 11, 4, 5), fine = fbm(S, 12, 32, 3);
  // grass blades: short strokes painted into a height/colour buffer
  const blade = new Float32Array(S * S), hue = new Float32Array(S * S), r = rng(13);
  for (let n = 0; n < S * S * 0.09; n++) {
    let x = r() * S, y = r() * S; const ang = -Math.PI / 2 + (r() - 0.5) * 1.6, len = 3 + r() * 7, h = 0.4 + r() * 0.6, c = r();
    for (let s = 0; s < len; s++) {
      const k = (((y | 0) % S + S) % S) * S + (((x | 0) % S + S) % S), v = h * (0.5 + 0.5 * s / len);
      if (v > blade[k]) { blade[k] = v; hue[k] = c; }
      x += Math.cos(ang) * 0.9; y += Math.sin(ang) * 0.9;
    }
  }
  return pack(S, k => {
    const b = blade[k], m = base[k], dry = ss(0.55, 0.8, m);
    let rr = 0.30 + hue[k] * 0.1, gg = 0.44 + hue[k] * 0.1, bb = 0.13 + hue[k] * 0.04;
    rr += dry * 0.2; gg += dry * 0.08; bb += dry * 0.03;
    const shade = 0.72 + b * 0.38 + (fine[k] - 0.5) * 0.15;
    const soil = (1 - ss(0.0, 0.2, b)) * 0.7; // gaps between blades show soil
    rr = rr * shade * (1 - soil) + 0.3 * soil; gg = gg * shade * (1 - soil) + 0.26 * soil; bb = bb * shade * (1 - soil) + 0.14 * soil;
    return [rr, gg, bb, 0.35 + b * 0.45];
  });
}

function dirt(S: number): RawImage {
  const base = fbm(S, 21, 4, 6), fine = fbm(S, 22, 64, 2), peb = worley(S, 23, 40), big = worley(S, 24, 9);
  return pack(S, k => {
    const m = base[k];
    let rr = 0.38 + (m - 0.5) * 0.22, gg = 0.29 + (m - 0.5) * 0.18, bb = 0.2 + (m - 0.5) * 0.12;
    const grain = (fine[k] - 0.5) * 0.12; rr += grain; gg += grain; bb += grain;
    // pebbles: rounded cells of varying grey-brown, only some cells are stones
    const isStone = peb.id[k] > 0.82, stone = isStone ? ss(0.34, 0.12, peb.f1[k]) * 0.85 : 0;
    const sc = 0.3 + peb.id[k] * 0.14;
    rr = rr * (1 - stone) + sc * 1.12 * stone; gg = gg * (1 - stone) + sc * 0.98 * stone; bb = bb * (1 - stone) + sc * 0.82 * stone;
    // faint dry cracks on the driest patches only
    const crack = ss(0.04, 0.0, big.edge[k]) * ss(0.6, 0.78, m);
    rr *= 1 - crack * 0.25; gg *= 1 - crack * 0.25; bb *= 1 - crack * 0.25;
    const h = 0.4 + (m - 0.5) * 0.3 + stone * 0.45 - crack * 0.3;
    return [rr, gg, bb, h];
  });
}

function rock(S: number): RawImage {
  const base = fbm(S, 31, 4, 6), fine = fbm(S, 32, 32, 3), cells = worley(S, 33, 7), lich = fbm(S, 34, 8, 4);
  return pack(S, (k, _x, y) => {
    const m = base[k], strata = Math.sin((y / S) * Math.PI * 2 * 9 + m * 6) * 0.5 + 0.5;
    let v = 0.4 + (m - 0.5) * 0.35 + (strata - 0.5) * 0.06 + (fine[k] - 0.5) * 0.14 + (cells.id[k] - 0.5) * 0.08;
    const crack = ss(0.05, 0.0, cells.edge[k]); v *= 1 - crack * 0.6;
    let rr = v * 1.04, gg = v, bb = v * 0.95;
    const l = ss(0.62, 0.72, lich[k]) * (1 - crack); // lichen patches
    rr = rr * (1 - l) + 0.42 * l; gg = gg * (1 - l) + 0.44 * l; bb = bb * (1 - l) + 0.22 * l;
    return [rr, gg, bb, 0.45 + (m - 0.5) * 0.5 + cells.f1[k] * 0.2 - crack * 0.4];
  });
}

function mud(S: number): RawImage {
  const base = fbm(S, 41, 3, 6), fine = fbm(S, 42, 48, 2), ruts = fbm(S, 43, 6, 3);
  return pack(S, k => {
    const m = base[k], wet = ss(0.45, 0.6, ruts[k]);
    const v = 0.85 + (m - 0.5) * 0.4 + (fine[k] - 0.5) * 0.1;
    const rr = 0.22 * v * (1 - wet * 0.35), gg = 0.16 * v * (1 - wet * 0.38), bb = 0.1 * v * (1 - wet * 0.3);
    return [rr, gg, bb, 0.25 + (m - 0.5) * 0.4 - wet * 0.15];
  });
}
