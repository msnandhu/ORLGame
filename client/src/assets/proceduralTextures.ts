/** Procedurally generated texture data (original, no external art). Returned as raw RGBA so it works on WebGPU and WebGL. */
export interface RawImage { width: number; height: number; data: Uint8Array }

export function detailTextures(size = 512): { albedo: RawImage; normal: RawImage } {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const height = new Float32Array(size * size);
  const octaves: [number, number][] = [[8, 0.35], [16, 0.25], [32, 0.2], [64, 0.12], [128, 0.08]];
  for (const [P, amp] of octaves) {
    const lat = new Float32Array(P * P);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const cellPx = size / P;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / cellPx, fy = y / cellPx, ix = Math.floor(fx), iy = Math.floor(fy);
      let u = fx - ix, v = fy - iy; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
      const a = lat[(iy % P) * P + (ix % P)], b = lat[(iy % P) * P + ((ix + 1) % P)];
      const c = lat[((iy + 1) % P) * P + (ix % P)], d = lat[((iy + 1) % P) * P + ((ix + 1) % P)];
      height[y * size + x] += amp * ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v);
    }
  }
  for (let k = 0; k < 2500; k++) {
    const cx = Math.floor(rnd() * size), cy = Math.floor(rnd() * size), r = 1 + rnd() * 2.5, hgt = 0.15 + rnd() * 0.2;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const d = Math.hypot(dx, dy); if (d > r) continue;
      height[((cy + dy + size) % size) * size + ((cx + dx + size) % size)] += hgt * (1 - d / r);
    }
  }
  const alb = new Uint8Array(size * size * 4), nrm = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const g = Math.max(0, Math.min(255, (0.62 + (height[i] - 0.5) * 0.7) * 255));
    alb[i * 4] = alb[i * 4 + 1] = alb[i * 4 + 2] = g; alb[i * 4 + 3] = 255;
    const hx = height[y * size + ((x + 1) % size)] - height[y * size + ((x - 1 + size) % size)];
    const hy = height[((y + 1) % size) * size + x] - height[((y - 1 + size) % size) * size + x];
    const nx = -hx * 6, ny = -hy * 6, l = Math.hypot(nx, ny, 1);
    nrm[i * 4] = (nx / l * 0.5 + 0.5) * 255; nrm[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; nrm[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i * 4 + 3] = 255;
  }
  return { albedo: { width: size, height: size, data: alb }, normal: { width: size, height: size, data: nrm } };
}

export function treadTexture(): RawImage {
  const w = 256, h = 64, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, bx = x % 16;
    const lug = (y >= 4 && y < 28 && bx >= 2 && bx < 11) || (y >= 36 && y < 60 && bx >= 7 && bx < 16);
    const v = lug ? 44 : 27; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return { width: w, height: h, data: d };
}

/** Soft round sprite for particles. */
export function softDot(size = 64): RawImage {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const a = Math.max(0, 1 - r); const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * a * 255);
  }
  return { width: size, height: size, data: d };
}
