import * as THREE from 'three';

/** Procedurally generated tiling textures (original, no external assets). */
export function makeDetailTextures(size = 512) {
  // Tileable multi-octave value noise (periodic lattice), plus small pebble speckles.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const height = new Float32Array(size * size);
  const octaves: [number, number][] = [[8, 0.35], [16, 0.25], [32, 0.2], [64, 0.12], [128, 0.08]];
  for (const [P, amp] of octaves) {
    const lat = new Float32Array(P * P);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const cellPx = size / P;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / cellPx, fy = y / cellPx;
      const ix = Math.floor(fx), iy = Math.floor(fy);
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
      const i = ((cy + dy + size) % size) * size + ((cx + dx + size) % size);
      height[i] += hgt * (1 - d / r);
    }
  }
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const cn = document.createElement('canvas'); cn.width = cn.height = size;
  const ctxn = cn.getContext('2d')!;
  const imgn = ctxn.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const v = 0.62 + (height[i] - 0.5) * 0.7;
    const g = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
    const hx = height[y * size + ((x + 1) % size)] - height[y * size + ((x - 1 + size) % size)];
    const hy = height[((y + 1) % size) * size + x] - height[((y - 1 + size) % size) * size + x];
    const nx = -hx * 6, ny = -hy * 6, nz = 1, l = Math.hypot(nx, ny, nz);
    imgn.data[i * 4] = (nx / l * 0.5 + 0.5) * 255; imgn.data[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; imgn.data[i * 4 + 2] = (nz / l * 0.5 + 0.5) * 255; imgn.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); ctxn.putImageData(imgn, 0, 0);
  const map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const normal = new THREE.CanvasTexture(cn); normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.anisotropy = 8;
  return { map, normal };
}

export function makeTreadTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#2c2c2c';
  for (let i = 0; i < 16; i++) {
    const x = i * 16;
    ctx.fillRect(x + 2, 4, 9, 24);
    ctx.fillRect(x + 7, 36, 9, 24);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
