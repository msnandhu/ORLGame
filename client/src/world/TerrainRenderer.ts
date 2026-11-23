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
import { log } from '../core/logger';
import { TerrainMaterialPlugin, SPLAT_KIND } from '../rendering/TerrainMaterialPlugin';

/** Splat weights per surface type: grass, dirt, rock, mud. */
const SPLAT: Record<Surface, [number, number, number, number]> = {
  [Surface.Grass]: [1, 0, 0, 0],
  [Surface.Dirt]: [0, 1, 0, 0],
  [Surface.Mud]: [0, 0.15, 0, 0.85],
  [Surface.Rock]: [0, 0.1, 0.9, 0],
  [Surface.Gravel]: [0, 0.55, 0.45, 0],
  // roads are drawn as their own meshes; the ground under them reads as packed dirt at the edges
  [Surface.Asphalt]: [0, 0.8, 0.2, 0],
  // the island's own surfaces (snow, sand and ice are tinted on top of these by the island renderer)
  [Surface.Snow]: [0, 0.3, 0.7, 0],
  [Surface.Sand]: [0, 1, 0, 0],
  [Surface.Ice]: [0, 0, 1, 0],
};

interface Chunk { hi: Mesh | null; lo: Mesh; center: Vector3; ci: number; cj: number }

/**
 * Chunked terrain renderer (128 m chunks) with two LOD levels and distance culling. The coarse level exists for
 * every chunk; full-detail meshes are streamed in around the camera (a few per frame) and dropped when far away.
 * The full-detail triangle split matches Terrain.heightAt exactly, so what you see is what the physics drives on.
 */
export class TerrainRenderer {
  readonly chunks: Chunk[] = [];
  readonly material: PBRMaterial;
  private cols!: { tint: Float32Array; splat: Float32Array };
  private static readonly C = 64;
  /** full-detail chunks built so far / currently alive (for the stats line and tests) */
  builtHi = 0;
  lodDistance = 300;
  viewDistance = 2500;

  constructor(private scene: Scene, private t: Terrain, detail: { albedo: RawImage; normal: RawImage }, layers: RawImage[]) {
    const mk = (img: RawImage, srgb: boolean) => {
      const tex = new RawTexture(img.data, img.width, img.height, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE; tex.anisotropicFilteringLevel = 8; tex.gammaSpace = srgb;
      return tex;
    };
    const m = new PBRMaterial('terrain', scene);
    m.albedoColor = Color3.White();
    m.bumpTexture = mk(detail.normal, false); m.bumpTexture.level = 0.45;
    m.metallic = 0; m.roughness = 0.92; m.environmentIntensity = 0.45;
    try {
      new TerrainMaterialPlugin(m, layers.map(l => mk(l, true)));
    } catch (e) {
      // never let a shader-language mismatch stop the game: fall back to the tinted detail material
      log.warn('terrain', 'Splat shading unavailable on this backend; using the plain terrain material', e);
      m.albedoTexture = mk(detail.albedo, true);
    }
    m.maxSimultaneousLights = 4;
    this.material = m;
    this.build();
  }

  /** Per-vertex macro tint (RGBA) and splat weights (grass, dirt, rock, mud). */
  private vertexData(): { tint: Float32Array; splat: Float32Array } {
    const t = this.t, N = t.n, noise = new Noise2D(5);
    const tint = new Float32Array(N * N * 4), splat = new Float32Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = i * t.cell - t.half, z = j * t.cell - t.half;
      let a = 0, b = 0, c = 0, d = 0, w = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = Math.min(N - 1, Math.max(0, i + di)), jj = Math.min(N - 1, Math.max(0, j + dj));
        const s = SPLAT[t.surface[jj * N + ii] as Surface], ww = di === 0 && dj === 0 ? 2 : 1;
        a += s[0] * ww; b += s[1] * ww; c += s[2] * ww; d += s[3] * ww; w += ww;
      }
      a /= w; b /= w; c /= w; d /= w;
      // steep ground shows bare rock, wherever its surface type
      const n = t.normalAt(x, z), steep = Math.min(1, Math.max(0, (0.86 - n[1]) / 0.16));
      a *= 1 - steep; b *= 1 - steep * 0.7; d *= 1 - steep; c += steep;
      const h = t.heights[k], shore = Math.min(1, Math.max(0, 1 - (h - t.waterLevel) / 1.5));
      b += shore * 0.6; a *= 1 - shore; d += shore * 0.4 * (h < t.waterLevel ? 1 : 0.5);
      const sum = a + b + c + d || 1;
      splat[k * 4] = a / sum; splat[k * 4 + 1] = b / sum; splat[k * 4 + 2] = c / sum; splat[k * 4 + 3] = d / sum;
      // macro variation breaks up large areas; wet banks darker, high ground slightly warmer
      const v = 1 + noise.fbm(x / 60, z / 60, 3) * 0.28 + noise.noise(x / 13, z / 13) * 0.07;
      const dry = Math.min(1, Math.max(0, (h - 30) / 60)), wet = h < t.waterLevel + 1.2 ? 0.6 : 1;
      tint[k * 4] = v * wet * (1 + dry * 0.12); tint[k * 4 + 1] = v * wet * (1 + dry * 0.03); tint[k * 4 + 2] = v * wet * (1 - dry * 0.05); tint[k * 4 + 3] = 1;
    }
    return { tint, splat };
  }

  private build() {
    const t = this.t, N = t.n, C = TerrainRenderer.C;
    this.cols = this.vertexData();
    for (let cj = 0; cj < N - 1; cj += C) for (let ci = 0; ci < N - 1; ci += C) {
      const lo = this.chunkMesh(ci, cj, C, 4, this.cols, true);
      const cx = (ci + C / 2) * t.cell - t.half, cz = (cj + C / 2) * t.cell - t.half;
      lo.setEnabled(false);
      this.chunks.push({ hi: null, lo, center: new Vector3(cx, t.heightAt(cx, cz), cz), ci, cj });
    }
  }

  private chunkMesh(ci: number, cj: number, C: number, step: number, cols: { tint: Float32Array; splat: Float32Array }, skirt: boolean): Mesh {
    const t = this.t, N = t.n;
    const w = Math.min(C, N - 1 - ci), h = Math.min(C, N - 1 - cj);
    const vw = Math.floor(w / step) + 1, vh = Math.floor(h / step) + 1;
    const pos: number[] = [], col: number[] = [], spl: number[] = [], uv: number[] = [], idx: number[] = [];
    const vert = (gi: number, gj: number, dy = 0) => {
      const k = gj * N + gi, x = gi * t.cell - t.half, z = gj * t.cell - t.half;
      pos.push(x, t.heights[k] + dy, z); uv.push(x / 9, z / 9);
      for (let q = 0; q < 4; q++) { col.push(cols.tint[k * 4 + q]); spl.push(cols.splat[k * 4 + q]); }
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
    m.setVerticesData(SPLAT_KIND, spl, false, 4);
    m.material = this.material; m.receiveShadows = true; m.isPickable = false;
    m.freezeWorldMatrix();
    return m;
  }

  /** Build the full-detail chunks around a point right away (spawn, teleport). */
  prime(at: Vector3) { this.update(at, 1000); }

  /** Distance-based LOD selection, culling and streaming of the full-detail meshes. */
  update(cam: Vector3, budget = 2) {
    const want: Chunk[] = [];
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z) - 90;
      const visible = d < this.viewDistance;
      let useLo = d > this.lodDistance;
      if (!useLo && !c.hi) { want.push(c); useLo = true; }
      // drop detail well outside the LOD ring (hysteresis keeps it from rebuilding at the boundary)
      if (c.hi && d > this.lodDistance + 220) { c.hi.dispose(); c.hi = null; }
      c.hi?.setEnabled(visible && !useLo);
      c.lo.setEnabled(visible && useLo);
    }
    // nearest first
    want.sort((a, b) => Math.hypot(a.center.x - cam.x, a.center.z - cam.z) - Math.hypot(b.center.x - cam.x, b.center.z - cam.z));
    for (const c of want.slice(0, budget)) {
      c.hi = this.chunkMesh(c.ci, c.cj, TerrainRenderer.C, 1, this.cols, false); this.builtHi++;
      c.hi.setEnabled(true); c.lo.setEnabled(false);
    }
  }
}
