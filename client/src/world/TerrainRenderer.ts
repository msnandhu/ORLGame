import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Terrain, Surface, Noise2D } from '@orl/shared';
import type { RawImage } from '../assets/proceduralTextures';

const COLORS: Record<Surface, [number, number, number]> = {
  [Surface.Grass]: [0.25, 0.34, 0.13],
  [Surface.Dirt]: [0.47, 0.37, 0.25],
  [Surface.Mud]: [0.23, 0.17, 0.11],
  [Surface.Rock]: [0.42, 0.40, 0.38],
  [Surface.Gravel]: [0.52, 0.49, 0.44],
};

interface Chunk { hi: Mesh; lo: Mesh; center: Vector3 }

/**
 * Chunked terrain renderer (128 m chunks) with two LOD levels and distance culling.
 * The full-detail triangle split matches Terrain.heightAt exactly, so what you see is what the physics drives on.
 */
export class TerrainRenderer {
  readonly chunks: Chunk[] = [];
  private material: PBRMaterial;
  lodDistance = 300;
  viewDistance = 2500;

  constructor(private scene: Scene, private t: Terrain, detail: { albedo: RawImage; normal: RawImage }) {
    const mk = (img: RawImage, srgb: boolean) => {
      const tex = new RawTexture(img.data, img.width, img.height, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE; tex.anisotropicFilteringLevel = 8; tex.gammaSpace = srgb;
      return tex;
    };
    const m = new PBRMaterial('terrain', scene);
    m.albedoColor = Color3.White(); m.albedoTexture = mk(detail.albedo, true);
    m.bumpTexture = mk(detail.normal, false); m.bumpTexture.level = 0.9;
    m.metallic = 0; m.roughness = 0.95; m.environmentIntensity = 0.35;
    m.maxSimultaneousLights = 4;
    this.material = m;
    this.build();
  }

  private colors(): Float32Array {
    const t = this.t, N = t.n, noise = new Noise2D(5);
    const out = new Float32Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = i * t.cell - t.half, z = j * t.cell - t.half;
      let r = 0, g = 0, b = 0, w = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = Math.min(N - 1, Math.max(0, i + di)), jj = Math.min(N - 1, Math.max(0, j + dj));
        const c = COLORS[t.surface[jj * N + ii] as Surface], ww = di === 0 && dj === 0 ? 2 : 1;
        r += c[0] * ww; g += c[1] * ww; b += c[2] * ww; w += ww;
      }
      r /= w; g /= w; b /= w;
      const v = 1 + noise.fbm(x / 40, z / 40, 3) * 0.25 + noise.noise(x / 7, z / 7) * 0.06;
      const n = t.normalAt(x, z), h = t.heights[k];
      const dry = Math.min(1, Math.max(0, (h - 30) / 60));
      r += dry * 0.08; g += dry * 0.03;
      const wet = h < t.waterLevel + 1 ? 0.7 : 1, slope = 0.8 + n[1] * 0.2;
      out[k * 4] = r * v * wet * slope; out[k * 4 + 1] = g * v * wet * slope; out[k * 4 + 2] = b * v * wet * slope; out[k * 4 + 3] = 1;
    }
    return out;
  }

  private build() {
    const t = this.t, N = t.n, C = 64, cols = this.colors();
    for (let cj = 0; cj < N - 1; cj += C) for (let ci = 0; ci < N - 1; ci += C) {
      const hi = this.chunkMesh(ci, cj, C, 1, cols, false);
      const lo = this.chunkMesh(ci, cj, C, 4, cols, true);
      const cx = (ci + C / 2) * t.cell - t.half, cz = (cj + C / 2) * t.cell - t.half;
      lo.setEnabled(false);
      this.chunks.push({ hi, lo, center: new Vector3(cx, t.heightAt(cx, cz), cz) });
    }
  }

  private chunkMesh(ci: number, cj: number, C: number, step: number, cols: Float32Array, skirt: boolean): Mesh {
    const t = this.t, N = t.n;
    const w = Math.min(C, N - 1 - ci), h = Math.min(C, N - 1 - cj);
    const vw = Math.floor(w / step) + 1, vh = Math.floor(h / step) + 1;
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const vert = (gi: number, gj: number, dy = 0) => {
      const k = gj * N + gi, x = gi * t.cell - t.half, z = gj * t.cell - t.half;
      pos.push(x, t.heights[k] + dy, z); col.push(cols[k * 4], cols[k * 4 + 1], cols[k * 4 + 2], 1); uv.push(x / 9, z / 9);
      return pos.length / 3 - 1;
    };
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) vert(ci + i * step, cj + j * step);
    for (let j = 0; j < vh - 1; j++) for (let i = 0; i < vw - 1; i++) {
      const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1; // a=00 b=10 c=01 d=11 (matches Terrain.heightAt split)
      idx.push(a, b, c, c, b, d); // front-facing (counter-clockwise from above) in the right-handed scene
    }
    if (skirt) {
      // skirts hide cracks between LOD levels
      const edges: [number, number][][] = [[], [], [], []];
      for (let i = 0; i < vw; i++) { edges[0].push([i, 0]); edges[1].push([i, vh - 1]); }
      for (let j = 0; j < vh; j++) { edges[2].push([0, j]); edges[3].push([vw - 1, j]); }
      for (const e of edges) for (let k = 0; k < e.length - 1; k++) {
        const [i0, j0] = e[k], [i1, j1] = e[k + 1];
        const a = j0 * vw + i0, b = j1 * vw + i1;
        const a2 = vert(ci + i0 * step, cj + j0 * step, -4), b2 = vert(ci + i1 * step, cj + j1 * step, -4);
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
      }
    }
    const vd = new VertexData();
    vd.positions = pos; vd.indices = idx; vd.colors = col; vd.uvs = uv;
    const normals: number[] = []; VertexData.ComputeNormals(pos, idx, normals);
    vd.normals = normals;
    const m = new Mesh(`terrain-${ci}-${cj}-${step}`, this.scene);
    vd.applyToMesh(m);
    m.material = this.material; m.receiveShadows = true; m.isPickable = false;
    m.freezeWorldMatrix();
    return m;
  }

  /** Distance-based LOD selection and culling. */
  update(cam: Vector3) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z) - 90;
      const visible = d < this.viewDistance;
      const useLo = d > this.lodDistance;
      c.hi.setEnabled(visible && !useLo);
      c.lo.setEnabled(visible && useLo);
    }
  }
}
