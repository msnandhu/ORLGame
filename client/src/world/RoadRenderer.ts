import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix, Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Terrain, roadPointAt, mulberry32, type Road, type RoadKind } from '@orl/shared';

const PRIO: Record<RoadKind, number> = { highway: 3, road: 2, street: 1 };
/** Height above the graded ground, by class, so crossing ribbons never fight for the same depth. */
const LIFT: Record<RoadKind, number> = { highway: 0.07, road: 0.06, street: 0.05 };
const PATCH_LIFT = 0.075, SIDEWALK = 2.5, CURB = 0.15, STEP = 2.5, TEX_LEN = 20;

/** Asphalt with painted lines, one texture per road class: u runs across the road, v along 20 m of it. */
function roadTexture(kind: RoadKind | 'plain', width: number): Uint8Array {
  const W = 256, H = 512, d = new Uint8Array(W * H * 4), rnd = mulberry32(kind.length * 31 + 7);
  const lines: { at: number; w: number; dash: boolean; c: [number, number, number] }[] = [];
  const white: [number, number, number] = [228, 228, 220], yellow: [number, number, number] = [226, 180, 40];
  if (kind === 'highway') {
    lines.push({ at: -7.2, w: 0.18, dash: false, c: white }, { at: 7.2, w: 0.18, dash: false, c: white });
    lines.push({ at: -0.16, w: 0.12, dash: false, c: yellow }, { at: 0.16, w: 0.12, dash: false, c: yellow });
    lines.push({ at: -3.6, w: 0.15, dash: true, c: white }, { at: 3.6, w: 0.15, dash: true, c: white });
  } else if (kind === 'road') {
    lines.push({ at: -3.5, w: 0.15, dash: false, c: white }, { at: 3.5, w: 0.15, dash: false, c: white }, { at: 0, w: 0.13, dash: true, c: white });
  } else if (kind === 'street') {
    lines.push({ at: 0, w: 0.12, dash: true, c: white });
  }
  for (let y = 0; y < H; y++) {
    const vm = (y / H) * TEX_LEN;
    for (let x = 0; x < W; x++) {
      const um = (x / W - 0.5) * width;
      // fine aggregate speckle and slight tyre polish in the wheel tracks
      let g = 46 + rnd() * 16 + (rnd() < 0.03 ? 22 : 0);
      const lane = ((um % 3.5) + 3.5) % 3.5; if (Math.abs(lane - 0.9) < 0.35 || Math.abs(lane - 2.6) < 0.35) g -= 5;
      let r = g, gg = g, b = g + 2;
      for (const l of lines) {
        if (Math.abs(um - l.at) > l.w / 2) continue;
        if (l.dash && (vm % 10) > 4) continue;
        const wear = 0.82 + rnd() * 0.18;
        r = l.c[0] * wear; gg = l.c[1] * wear; b = l.c[2] * wear;
      }
      const i = (y * W + x) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  return d;
}

/** Concrete paving slabs (1.25 m) for the sidewalks. */
function slabTexture(): Uint8Array {
  const W = 128, d = new Uint8Array(W * W * 4), rnd = mulberry32(99);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const joint = x % 64 < 2 || y % 64 < 2;
    const g = joint ? 120 : 168 + rnd() * 18;
    const i = (y * W + x) * 4; d[i] = g; d[i + 1] = g - 2; d[i + 2] = g - 6; d[i + 3] = 255;
  }
  return d;
}

interface RoadChunk { mesh: Mesh; center: Vector3 }

/**
 * Road ribbons draped on the graded terrain: painted asphalt per class, plain junction patches where streets
 * cross, raised sidewalks with curbs along town streets, and street lamps. Lesser roads stop at the edge of the
 * road they join, so markings never overlap.
 */
export class RoadRenderer {
  readonly chunks: RoadChunk[] = [];
  viewDistance = 2500;

  constructor(private scene: Scene, private t: Terrain) {
    const tex = (data: Uint8Array, w: number, h: number) => {
      const x = new RawTexture(data, w, h, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      x.wrapU = Texture.CLAMP_ADDRESSMODE; x.wrapV = Texture.WRAP_ADDRESSMODE; x.anisotropicFilteringLevel = 8; return x;
    };
    const mat = (name: string, kind: RoadKind | 'plain', width: number) => {
      const m = new PBRMaterial(name, scene); m.albedoTexture = tex(roadTexture(kind, width), 256, 512);
      m.metallic = 0; m.roughness = 0.88; m.environmentIntensity = 0.35; m.maxSimultaneousLights = 4; return m;
    };
    const mats: Record<RoadKind | 'plain', PBRMaterial> = {
      highway: mat('road-highway', 'highway', t.roads.find(r => r.kind === 'highway')?.cls.width ?? 15),
      road: mat('road-road', 'road', 9), street: mat('road-street', 'street', 10), plain: mat('road-plain', 'plain', 10),
    };
    const slab = new PBRMaterial('sidewalk', scene);
    const st = new RawTexture(slabTexture(), 128, 128, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    st.wrapU = st.wrapV = Texture.WRAP_ADDRESSMODE; slab.albedoTexture = st; slab.metallic = 0; slab.roughness = 0.9; slab.environmentIntensity = 0.35;

    const cover = this.coverage();
    t.roads.forEach((r, ri) => this.buildRoad(r, ri, cover, mats[r.kind], slab));
    this.buildPatches(mats.plain, slab);
    this.buildLamps();
  }

  /** Which roads' carriageways cover each 2 m cell (for trimming lesser roads at junctions). */
  private coverage() {
    const t = this.t, cover = new Map<number, number[]>();
    t.roads.forEach((r, ri) => {
      const hw = r.cls.width / 2;
      for (let s = 0; s <= r.length; s += 1) {
        const p = roadPointAt(r, s);
        for (let o = -hw; o <= hw; o += 1) {
          const x = p.x - p.tz * o, z = p.z + p.tx * o, k = Math.round((z + t.half) / t.cell) * t.n + Math.round((x + t.half) / t.cell);
          const l = cover.get(k); if (!l) cover.set(k, [ri]); else if (!l.includes(ri)) l.push(ri);
        }
      }
    });
    return cover;
  }
  private covered(cover: Map<number, number[]>, ri: number, x: number, z: number) {
    const t = this.t, r = t.roads[ri], l = cover.get(Math.round((z + t.half) / t.cell) * t.n + Math.round((x + t.half) / t.cell));
    return !!l && l.some(o => o !== ri && PRIO[t.roads[o].kind] >= PRIO[r.kind]);
  }

  private buildRoad(r: Road, ri: number, cover: Map<number, number[]>, mat: PBRMaterial, slab: PBRMaterial) {
    const n = Math.max(2, Math.round(r.length / STEP)), ds = r.length / n;
    const samples: { s: number; free: boolean }[] = [];
    for (let i = 0; i <= n; i++) { const s = i * ds, p = roadPointAt(r, s); samples.push({ s, free: !this.covered(cover, ri, p.x, p.z) }); }
    // runs of uncovered samples, extended one sample into the junction so they tuck under the other road
    let i = 0;
    while (i <= n) {
      if (!samples[i].free) { i++; continue; }
      let j = i; while (j < n && samples[j + 1].free) j++;
      const a = Math.max(0, i - 1), b = Math.min(n, j + 1);
      for (let c = a; c < b; c += 80) this.ribbon(r, samples.slice(c, Math.min(b, c + 80) + 1).map(q => q.s), mat, slab);
      i = j + 1;
    }
  }

  /** Carriageway (and sidewalks for streets) along the given arc-length samples. */
  private ribbon(r: Road, ss: number[], mat: PBRMaterial, slab: PBRMaterial) {
    if (ss.length < 2) return;
    const t = this.t, hw = r.cls.width / 2, lift = LIFT[r.kind];
    const across = [-1, -0.5, 0, 0.5, 1];
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const swPos: number[] = [], swUv: number[] = [], swIdx: number[] = [];
    let cx = 0, cz = 0, cy = 0;
    for (const s of ss) {
      const p = roadPointAt(r, s), rx = -p.tz, rz = p.tx;
      for (const a of across) {
        const x = p.x + rx * a * hw, z = p.z + rz * a * hw;
        pos.push(x, t.heightAt(x, z) + lift, z); uv.push((a + 1) / 2, s / TEX_LEN);
      }
      cx += p.x; cz += p.z; cy += p.y;
      if (r.kind === 'street') for (const side of [-1, 1]) {
        // curb face, sidewalk top, outer edge tucked into the ground
        const prof: [number, number][] = [[hw, 0], [hw + 0.03, CURB], [hw + SIDEWALK, CURB], [hw + SIDEWALK + 0.05, -0.15]];
        const list = side < 0 ? prof.slice().reverse() : prof;
        for (const [o, h] of list) {
          const x = p.x + rx * o * side, z = p.z + rz * o * side;
          swPos.push(x, t.heightAt(x, z) + lift + h, z); swUv.push((o * side) / 1.25 / 2, s / 2.5);
        }
      }
    }
    const grid = (cols: number, rows: number, out: number[], base = 0) => {
      for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
        const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
        out.push(a, c, b, b, c, d);
      }
    };
    grid(across.length, ss.length, idx);
    const mk = (name: string, P: number[], U: number[], I: number[], m: PBRMaterial) => {
      const vd = new VertexData(); vd.positions = P; vd.uvs = U; vd.indices = I;
      const nrm: number[] = []; VertexData.ComputeNormals(P, I, nrm); vd.normals = nrm;
      const mesh = new Mesh(name, this.scene); vd.applyToMesh(mesh); mesh.material = m;
      mesh.receiveShadows = true; mesh.isPickable = false; mesh.freezeWorldMatrix();
      this.chunks.push({ mesh, center: new Vector3(cx / ss.length, cy / ss.length, cz / ss.length) });
      return mesh;
    };
    mk(`road-${r.id}`, pos, uv, idx, mat);
    if (swPos.length) {
      // two sidewalks interleaved per sample: 4 vertices each
      for (let side = 0; side < 2; side++) for (let i = 0; i < ss.length - 1; i++) for (let j = 0; j < 3; j++) {
        const a = i * 8 + side * 4 + j, b = a + 1, c = a + 8, d = c + 1;
        swIdx.push(a, c, b, b, c, d);
      }
      mk(`sidewalk-${r.id}`, swPos, swUv, swIdx, slab);
    }
  }

  /** Plain asphalt squares where settlement streets cross, above both ribbons, with the corner curbs (one mesh each per settlement). */
  private buildPatches(plain: PBRMaterial, slab: PBRMaterial) {
    const t = this.t, w = 10 + 0.4, K = 5;
    for (const s of t.settlements) {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [], corners: Mesh[] = [];
      for (const x of s.xs) for (const z of s.zs) {
        const base = pos.length / 3;
        for (let j = 0; j <= K; j++) for (let i = 0; i <= K; i++) {
          const px = x - w / 2 + (w * i) / K, pz = z - w / 2 + (w * j) / K;
          pos.push(px, t.heightAt(px, pz) + PATCH_LIFT, pz); uv.push(0.02 + 0.06 * (i / K), (pz - z) / TEX_LEN);
        }
        for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) { const a = base + j * (K + 1) + i, b = a + 1, c = a + K + 1, d = c + 1; idx.push(a, b, c, c, b, d); }
        // corner squares of sidewalk so the curbs wrap around the junction
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const c = MeshBuilder.CreateBox('sidewalk-corner', { width: SIDEWALK, depth: SIDEWALK, height: CURB + 0.3 }, this.scene);
          const px = x + sx * (5 + SIDEWALK / 2), pz = z + sz * (5 + SIDEWALK / 2);
          c.position.set(px, t.heightAt(px, pz) + LIFT.street + CURB - (CURB + 0.3) / 2, pz);
          corners.push(c);
        }
      }
      const vd = new VertexData(); vd.positions = pos; vd.uvs = uv; vd.indices = idx;
      const nrm: number[] = []; VertexData.ComputeNormals(pos, idx, nrm); vd.normals = nrm;
      const m = new Mesh(`junctions-${s.id}`, this.scene); vd.applyToMesh(m); m.material = plain; m.receiveShadows = true; m.isPickable = false; m.freezeWorldMatrix();
      this.chunks.push({ mesh: m, center: new Vector3(s.cx, s.y, s.cz) });
      const cm = Mesh.MergeMeshes(corners, true, true);
      if (cm) { cm.name = `sidewalk-corners-${s.id}`; cm.material = slab; cm.receiveShadows = true; cm.isPickable = false; cm.freezeWorldMatrix(); this.chunks.push({ mesh: cm, center: new Vector3(s.cx, s.y, s.cz) }); }
    }
  }

  /** Street lamps along settlement streets (emissive heads; no real lights, to keep the light count low). */
  private buildLamps() {
    const t = this.t, scene = this.scene;
    const metal = new PBRMaterial('lamp-pole', scene); metal.albedoColor = new Color3(0.22, 0.23, 0.24); metal.metallic = 0.7; metal.roughness = 0.45;
    const glow = new PBRMaterial('lamp-head', scene); glow.albedoColor = new Color3(1, 0.95, 0.8); glow.emissiveColor = new Color3(1, 0.86, 0.6); glow.emissiveIntensity = 0.5;
    const pole = MeshBuilder.CreateCylinder('lamp', { diameterTop: 0.1, diameterBottom: 0.16, height: 7, tessellation: 8 }, scene);
    pole.bakeTransformIntoVertices(Matrix.Translation(0, 3.5, 0));
    const arm = MeshBuilder.CreateBox('lamp-arm', { width: 0.08, height: 0.08, depth: 1.6 }, scene); arm.bakeTransformIntoVertices(Matrix.Translation(0, 6.9, 0.75));
    const poleM = Mesh.MergeMeshes([pole, arm], true)!; poleM.material = metal;
    const head = MeshBuilder.CreateBox('lamp-head', { width: 0.32, height: 0.1, depth: 0.6 }, scene); head.bakeTransformIntoVertices(Matrix.Translation(0, 6.83, 1.45)); head.material = glow;
    const mats: number[] = [];
    for (const r of t.roads) {
      if (r.kind !== 'street') continue;
      const hw = r.cls.width / 2;
      for (let s = 12, k = 0; s < r.length - 8; s += 32, k++) {
        const p = roadPointAt(r, s), side = k % 2 ? 1 : -1, o = hw + 0.6;
        const x = p.x - p.tz * o * side, z = p.z + p.tx * o * side;
        // skip lamps that would stand in a crossing street
        if (t.roads.some(q => q !== r && q.kind === 'street' && q.pts.some(([qx, qz]) => Math.abs(qx - x) < 7 && Math.abs(qz - z) < 7))) continue;
        const yaw = Math.atan2(p.tz * side, -p.tx * side); // arm reaches over the road
        Matrix.Compose(new Vector3(1, 1, 1), Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(x, t.heightAt(x, z) + LIFT.street + CURB, z)).copyToArray(mats, mats.length);
      }
    }
    const arr = new Float32Array(mats);
    for (const m of [poleM, head]) { m.thinInstanceSetBuffer('matrix', arr, 16, true); m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    this.lampMeshes = [poleM, head];
    log(`${arr.length / 16} street lamps`);
  }
  lampMeshes: Mesh[] = [];

  update(cam: Vector3) {
    for (const c of this.chunks) c.mesh.setEnabled(Math.hypot(c.center.x - cam.x, c.center.z - cam.z) < this.viewDistance + 250);
  }
}
const log = (m: string) => console.info(`[roads] ${m}`);
