import * as THREE from 'three';
import { Terrain, Surface } from '../world/terrain';
import { Noise2D } from '../core/noise';
import { makeDetailTextures } from './textures';

const COLORS: Record<Surface, [number, number, number]> = {
  [Surface.Grass]: [0.25, 0.34, 0.13],
  [Surface.Dirt]: [0.47, 0.37, 0.25],
  [Surface.Mud]: [0.23, 0.17, 0.11],
  [Surface.Rock]: [0.42, 0.40, 0.38],
  [Surface.Gravel]: [0.52, 0.49, 0.44],
};

/** Builds terrain in 128 m chunks (frustum-culled); triangle split matches Terrain.heightAt. */
export function buildTerrainMeshes(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  const { map, normal } = makeDetailTextures();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map, normalMap: normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    // world-space UVs so detail tiles continuously across chunks, two scales mixed to hide repetition
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vMapUv = (modelMatrix * vec4(position,1.0)).xz / 9.0; vNormalMapUv = vMapUv;');
  };
  const noise = new Noise2D(5);
  const N = t.n, chunk = 64; // 64 cells * 2 m = 128 m
  const colors = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = i * t.cell - t.half, z = j * t.cell - t.half;
    // blend neighbours for soft transitions
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = Math.min(N - 1, Math.max(0, i + di)), jj = Math.min(N - 1, Math.max(0, j + dj));
      const c = COLORS[t.surface[jj * N + ii] as Surface];
      const w = di === 0 && dj === 0 ? 2 : 1;
      r += c[0] * w; g += c[1] * w; b += c[2] * w; wsum += w;
    }
    r /= wsum; g /= wsum; b /= wsum;
    const v = 1 + noise.fbm(x / 40, z / 40, 3) * 0.25 + noise.noise(x / 7, z / 7) * 0.06;
    const nrm = t.normalAt(x, z);
    const h = t.heights[k];
    // dry grass tint on higher ground, wet darkening near water
    const dry = Math.min(1, Math.max(0, (h - 30) / 60));
    r += dry * 0.08; g += dry * 0.03;
    const wet = h < t.waterLevel + 1 ? 0.7 : 1;
    const slopeDark = 0.8 + nrm[1] * 0.2;
    colors[k * 3] = r * v * wet * slopeDark; colors[k * 3 + 1] = g * v * wet * slopeDark; colors[k * 3 + 2] = b * v * wet * slopeDark;
  }
  for (let cj = 0; cj < N - 1; cj += chunk) for (let ci = 0; ci < N - 1; ci += chunk) {
    const w = Math.min(chunk, N - 1 - ci), hgt = Math.min(chunk, N - 1 - cj);
    const vw = w + 1, vh = hgt + 1;
    const pos = new Float32Array(vw * vh * 3), col = new Float32Array(vw * vh * 3), uv = new Float32Array(vw * vh * 2);
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
      const gi = ci + i, gj = cj + j, k = gj * N + gi, o = j * vw + i;
      pos[o * 3] = gi * t.cell - t.half; pos[o * 3 + 1] = t.heights[k]; pos[o * 3 + 2] = gj * t.cell - t.half;
      col[o * 3] = colors[k * 3]; col[o * 3 + 1] = colors[k * 3 + 1]; col[o * 3 + 2] = colors[k * 3 + 2];
    }
    const idx: number[] = [];
    for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
      const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1; // a=00 b=10 c=01 d=11
      idx.push(a, c, b, c, d, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

export function buildWater(t: Terrain): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(t.size, t.size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x2a4a48, roughness: 0.08, metalness: 0.0, transmission: 0, transparent: true, opacity: 0.82, clearcoat: 1, clearcoatRoughness: 0.05 });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = t.waterLevel;
  m.receiveShadow = true;
  return m;
}
