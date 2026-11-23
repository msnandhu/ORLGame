import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Material } from '@babylonjs/core/Materials/material';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Terrain, Surface, mulberry32 } from '@orl/shared';

const CELL = 24;

/** Procedural blade sprite: several tapered blades, alpha-tested. */
function bladeTexture(size = 128): Uint8Array {
  const d = new Uint8Array(size * size * 4), r = mulberry32(5);
  for (let b = 0; b < 9; b++) {
    const x0 = size * (0.12 + r() * 0.76), lean = (r() - 0.5) * 0.5, h = 0.55 + r() * 0.45, w = 2.2 + r() * 2.5, shade = 0.75 + r() * 0.35;
    for (let y = 0; y < size; y++) {
      const t = y / size; if (t > h) break;
      const cx = x0 + lean * t * t * size, hw = w * (1 - t / h);
      for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
        if (x < 0 || x >= size) continue;
        const i = ((size - 1 - y) * size + x) * 4, g = (0.55 + t * 0.45) * shade;
        d[i] = 255 * 0.55 * g; d[i + 1] = 255 * 0.78 * g; d[i + 2] = 255 * 0.28 * g; d[i + 3] = 255;
      }
    }
  }
  return d;
}

/**
 * Grass clumps (three crossed, alpha-tested cards) as thin instances in 24 m cells around the camera, in the valley
 * and anywhere on the island.
 * Instances are generated deterministically per cell on grassy, gentle, dry ground away from trails,
 * and their normals point up so they light like the ground they grow from.
 */
export class GrassField {
  private template: Mesh;
  private cells = new Map<string, Mesh>();
  radius = 70;
  density = 1;

  constructor(scene: Scene, private t: Terrain) {
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, base = pos.length / 3;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
      for (let i = 0; i < 4; i++) nrm.push(0, 1, 0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const vd = new VertexData(); vd.positions = pos; vd.normals = nrm; vd.uvs = uv; vd.indices = idx;
    this.template = new Mesh('grass-template', scene); vd.applyToMesh(this.template); this.template.setEnabled(false);
    const tex = new RawTexture(bladeTexture(), 128, 128, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    tex.hasAlpha = true; tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const m = new PBRMaterial('grass', scene);
    m.albedoTexture = tex; m.albedoColor = Color3.White(); m.useAlphaFromAlbedoTexture = true;
    m.transparencyMode = Material.MATERIAL_ALPHATEST; m.alphaCutOff = 0.4;
    m.backFaceCulling = false; m.metallic = 0; m.roughness = 0.9; m.environmentIntensity = 0.4;
    this.template.material = m;
  }

  private build(ci: number, cj: number): Mesh | null {
    const t = this.t, rnd = mulberry32(ci * 7919 + cj * 104729 + 13), mats: number[] = [], cols: number[] = [];
    const n = Math.floor(CELL * CELL * 0.55 * this.density), q = new Quaternion();
    for (let i = 0; i < n; i++) {
      const x = (ci + rnd()) * CELL, z = (cj + rnd()) * CELL, s = 0.45 + rnd() * 0.55, yaw = rnd() * 6.283, hue = rnd();
      if (!t.inBounds(x, z)) continue;
      if (t.inCore(x, z)) {
        const gi = Math.round((x + t.half) / t.cell), gj = Math.round((z + t.half) / t.cell);
        if (t.surface[gj * t.n + gi] !== Surface.Grass) continue;
      } else if (t.surfaceAt(x, z) !== Surface.Grass) continue; // the island: roads, trails, snow and sand are not grass
      const y = t.heightAt(x, z);
      if (t.waterAt(x, z) > y - 0.4 || t.normalAt(x, z)[1] < 0.85) continue;
      if (t.inCore(x, z) && (t.trailDist(x, z) < 4 || t.boxPenetration(x, y + 0.3, z, 0.8, NOUT) > 0)) continue;
      Matrix.ComposeToRef(new Vector3(s * (0.9 + hue * 0.4), s * (0.7 + rnd() * 0.6), s), Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, q), new Vector3(x, y - 0.04, z), TMP);
      TMP.copyToArray(mats, mats.length);
      cols.push(0.85 + hue * 0.35, 0.9 + hue * 0.15, 0.7 + hue * 0.2, 1);
    }
    if (!mats.length) return null;
    const m = this.template.clone(`grass-${ci},${cj}`, null, true, false) as Mesh;
    m.makeGeometryUnique(); m.setEnabled(true); m.isPickable = false; m.receiveShadows = true;
    m.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true);
    m.thinInstanceSetBuffer(VertexBuffer.ColorKind, new Float32Array(cols), 4, true);
    m.thinInstanceRefreshBoundingInfo(false);
    return m;
  }

  setDensity(d: number) {
    if (d === this.density) return;
    this.density = d;
    for (const m of this.cells.values()) m.dispose();
    this.cells.clear();
  }

  /** Create cells entering the radius (a few per frame) and drop the ones far behind. */
  update(cam: Vector3) {
    if (this.density <= 0) return;
    const r = this.radius, c0 = Math.floor((cam.x - r) / CELL), c1 = Math.floor((cam.x + r) / CELL), r0 = Math.floor((cam.z - r) / CELL), r1 = Math.floor((cam.z + r) / CELL);
    let built = 0;
    for (let ci = c0; ci <= c1; ci++) for (let cj = r0; cj <= r1; cj++) {
      const key = `${ci},${cj}`;
      if (this.cells.has(key) || built > 2) continue;
      const cx = (ci + 0.5) * CELL - cam.x, cz = (cj + 0.5) * CELL - cam.z;
      if (cx * cx + cz * cz > (r + CELL) * (r + CELL)) continue;
      const m = this.build(ci, cj); this.cells.set(key, m ?? (null as unknown as Mesh)); built++;
    }
    for (const [key, m] of this.cells) {
      const [ci, cj] = key.split(',').map(Number), cx = (ci + 0.5) * CELL - cam.x, cz = (cj + 0.5) * CELL - cam.z;
      if (cx * cx + cz * cz > (r + CELL * 2.5) ** 2) { m?.dispose(); this.cells.delete(key); }
    }
  }
}
const TMP = new Matrix();
const NOUT: [number, number, number] = [0, 0, 0];
