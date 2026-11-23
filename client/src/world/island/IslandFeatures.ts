import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { OuterWorld, OuterRoad } from '@orl/shared';
import { roadTexture } from '../RoadRenderer';

const pbr = (scene: Scene, name: string, c: Color3, rough: number, metal = 0) => {
  const m = new PBRMaterial(name, scene); m.albedoColor = c; m.roughness = rough; m.metallic = metal; m.environmentIntensity = 0.4; return m;
};
interface Piece { mesh: Mesh; cx: number; cz: number; r: number }

/**
 * The island's water and built road network: the sea, lakes (frozen ones as ice), rivers with white water where
 * they fall, paved highway and road ribbons on their graded profiles, and bridges (deck, parapets, piers) where
 * roads cross water. Trails are not ribboned: their dirt is part of the terrain's surface.
 */
export class IslandFeatures {
  private pieces: Piece[] = [];
  readonly sea: Mesh;
  viewDistance = 9000;

  constructor(private scene: Scene, private o: OuterWorld, water: Material) {
    const I = o.island;
    // sea: one plane under everything (land and the valley sit above it)
    const seaMat = (water as PBRMaterial).clone('sea') as PBRMaterial;
    seaMat.alpha = 0.9; seaMat.albedoColor = new Color3(0.03, 0.1, 0.14);
    if (seaMat.bumpTexture) { const b = (seaMat.bumpTexture as Texture).clone(); b.uScale = b.vScale = 90000 / 14; seaMat.bumpTexture = b; }
    this.sea = MeshBuilder.CreateGround('sea', { width: 90000, height: 90000, subdivisions: 2 }, scene);
    this.sea.position.set((I.minX + I.maxX) / 2, 0, (I.minZ + I.maxZ) / 2);
    this.sea.material = seaMat; this.sea.isPickable = false; this.sea.receiveShadows = false; this.sea.freezeWorldMatrix();

    // lakes
    const ice = pbr(scene, 'lake-ice', new Color3(0.78, 0.88, 0.95), 0.18); ice.environmentIntensity = 0.9;
    for (const l of I.lakes) {
      const d = MeshBuilder.CreateDisc(`lake-${l.id}`, { radius: l.r * 1.3, tessellation: 64 }, scene);
      d.rotation.x = Math.PI / 2; d.position.set(l.x, l.level + (l.frozen ? 0.02 : 0), l.z);
      d.material = l.frozen ? ice : water; d.isPickable = false; d.receiveShadows = true; d.freezeWorldMatrix();
      this.add(d, l.x, l.z, l.r * 1.3);
    }

    // rivers: a ribbon on the water level, foam where the level drops fast (rapids and falls)
    const foam = pbr(scene, 'white-water', new Color3(0.92, 0.95, 0.97), 0.5); foam.alpha = 0.9; foam.emissiveColor = new Color3(0.12, 0.13, 0.14);
    for (const rv of I.rivers) {
      for (let a = 0; a < rv.pts.length - 1; a += 60) {
        const b = Math.min(rv.pts.length - 1, a + 60);
        const idx = Array.from({ length: b - a + 1 }, (_, k) => a + k);
        this.ribbon(`river-${rv.id}-${a}`, idx.map(i => rv.pts[i]), idx.map(i => rv.level[i] + 0.05), idx.map(i => rv.hw[i] + 4), water, 30);
      }
      for (let i = 0; i < rv.pts.length - 1; i++) {
        const drop = rv.level[i] - rv.level[i + 1], len = Math.hypot(rv.pts[i + 1][0] - rv.pts[i][0], rv.pts[i + 1][1] - rv.pts[i][1]) || 1;
        if (drop / len < 0.12) continue;
        let j = i; while (j < rv.pts.length - 1 && (rv.level[j] - rv.level[j + 1]) / (Math.hypot(rv.pts[j + 1][0] - rv.pts[j][0], rv.pts[j + 1][1] - rv.pts[j][1]) || 1) >= 0.12) j++;
        const lo = Math.max(0, i - 1), hi = Math.min(rv.pts.length - 1, j + 1), idx = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
        this.ribbon(`falls-${rv.id}-${i}`, idx.map(k => rv.pts[k]), idx.map(k => rv.level[k] + 0.12), idx.map(k => rv.hw[k] * 0.9), foam, 8);
        i = j;
      }
    }

    // roads and bridges
    const tex = (kind: 'highway' | 'road', width: number) => {
      const x = new RawTexture(roadTexture(kind, width), 256, 512, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      x.wrapU = Texture.CLAMP_ADDRESSMODE; x.wrapV = Texture.WRAP_ADDRESSMODE; x.anisotropicFilteringLevel = 8; return x;
    };
    const roadMat = (kind: 'highway' | 'road', w: number) => {
      const m = new PBRMaterial(`island-${kind}`, scene); m.albedoTexture = tex(kind, w); m.metallic = 0; m.roughness = 0.88; m.environmentIntensity = 0.35;
      m.zOffset = -2; return m;
    };
    const mats = { highway: roadMat('highway', 15), road: roadMat('road', 9) };
    const concrete = pbr(scene, 'bridge-concrete', new Color3(0.58, 0.57, 0.54), 0.85);
    const pier = MeshBuilder.CreateBox('bridge-pier', { width: 1, height: 1, depth: 1 }, scene); pier.material = concrete; pier.isPickable = false;
    pier.bakeTransformIntoVertices(Matrix.Translation(0, -0.5, 0)); pier.setEnabled(false);
    const piers: number[] = [];
    for (const r of o.roads) {
      if (r.kind === 'trail') continue;
      this.road(r, mats[r.kind]);
      this.bridges(r, concrete, piers);
    }
    if (piers.length) {
      const m = pier.clone('bridge-piers', null, true, false) as Mesh; m.makeGeometryUnique(); m.setEnabled(true);
      m.thinInstanceSetBuffer('matrix', new Float32Array(piers), 16, true); m.thinInstanceRefreshBoundingInfo(false);
      m.alwaysSelectAsActiveMesh = false;
    }
  }

  private add(mesh: Mesh, cx: number, cz: number, r: number) { this.pieces.push({ mesh, cx, cz, r }); }

  /** A flat strip along a polyline: heights and half widths per point, v running along it (metres / vScale). */
  private ribbon(name: string, pts: [number, number][], ys: number[], hws: number[], mat: Material, vScale: number, x0?: number[]): Mesh | null {
    if (pts.length < 2) return null;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let s = 0, cx = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)];
      let tx = q[0] - p[0], tz = q[1] - p[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const [x, z] = pts[i], hw = hws[i];
      pos.push(x - tz * hw, ys[i], z + tx * hw, x + tz * hw, ys[i], z - tx * hw);
      uv.push(0, (x0?.[i] ?? s) / vScale, 1, (x0?.[i] ?? s) / vScale);
      cx += x; cz += z;
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    cx /= pts.length; cz /= pts.length;
    const r = Math.max(...pts.map(([x, z]) => Math.hypot(x - cx, z - cz))) + 30;
    const m = new Mesh(name, this.scene), vd = new VertexData();
    vd.positions = pos; vd.uvs = uv; vd.indices = idx;
    const nrm: number[] = []; VertexData.ComputeNormals(pos, idx, nrm);
    // ribbons face up whichever way the polyline runs
    if (nrm[1] < 0) { for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; nrm.length = 0; VertexData.ComputeNormals(pos, idx, nrm); }
    vd.normals = nrm; vd.applyToMesh(m);
    m.material = mat; m.isPickable = false; m.receiveShadows = true; m.freezeWorldMatrix();
    this.add(m, cx, cz, r);
    return m;
  }

  /** Paved carriageway outside the valley (the valley paves its own stretch). */
  private road(r: OuterRoad, mat: Material) {
    const core = this.o.coreHalf - 4, inCore = (p: [number, number]) => Math.abs(p[0]) < core && Math.abs(p[1]) < core;
    let i = 0;
    while (i < r.pts.length) {
      if (inCore(r.pts[i])) { i++; continue; }
      let j = i; while (j < r.pts.length - 1 && !inCore(r.pts[j + 1]) && j - i < 60) j++;
      const a = Math.max(0, i - 1), idx = Array.from({ length: j - a + 1 }, (_, k) => a + k);
      if (idx.length >= 2) {
        const pts = idx.map(k => r.pts[k]), ys = idx.map(k => r.profile[k] + 0.06), cum = idx.map(k => r.cum[k]);
        // roads that leave the valley start a few metres outside it: run the carriageway back to the valley's own
        // road end, so there is no strip of bare ground across the road at the valley edge
        const reach = (e: 0 | 1) => {
          const k = e ? pts.length - 1 : 0, [x, z] = pts[k], [px, pz] = pts[e ? k - 1 : 1];
          const edge = this.o.coreHalf - Math.max(Math.abs(x), Math.abs(z));
          if ((e ? j !== r.pts.length - 1 : a !== 0) || edge > 0 || edge < -24) return;
          const dx = x - px, dz = z - pz, l = Math.hypot(dx, dz) || 1, back = -edge + 2.5;
          const q: [number, number] = [x + dx / l * back, z + dz / l * back];
          if (e) { pts.push(q); ys.push(ys[k]); cum.push(cum[k] + back); } else { pts.unshift(q); ys.unshift(ys[0]); cum.unshift(cum[0] - back); }
        };
        reach(0); reach(1);
        this.ribbon(`iroad-${r.src.id}-${a}`, pts, ys, pts.map(() => r.cls.width / 2), mat, 20, cum);
      }
      i = j === i ? i + 1 : j;
    }
  }

  /** Decks, parapets and piers where a road is on a bridge. */
  private bridges(r: OuterRoad, concrete: Material, piers: number[]) {
    const hw = r.cls.width / 2 + 0.6;
    let i = 0;
    while (i < r.pts.length) {
      if (!r.bridge[i]) { i++; continue; }
      let j = i; while (j < r.pts.length - 1 && r.bridge[j + 1]) j++;
      const a = Math.max(0, i - 1), b = Math.min(r.pts.length - 1, j + 1), idx = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      const pts = idx.map(k => r.pts[k]), ys = idx.map(k => r.profile[k]);
      // deck underside and the two parapets, as strips of the same polyline
      this.ribbon(`deck-under-${r.src.id}-${a}`, pts, ys.map(y => y - 1.3), idx.map(() => hw), concrete, 10);
      for (const side of [-1, 1]) {
        const off = (k: number): [number, number] => {
          const p = r.pts[Math.max(0, k - 1)], q = r.pts[Math.min(r.pts.length - 1, k + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          return [r.pts[k][0] - ((q[1] - p[1]) / l) * hw * side, r.pts[k][1] + ((q[0] - p[0]) / l) * hw * side];
        };
        this.wall(`parapet-${r.src.id}-${a}-${side}`, idx.map(off), ys.map(y => y - 1.3), ys.map(y => y + 0.9), concrete);
      }
      // piers about every 24 m, down to the bed
      let acc = 0;
      for (let k = a; k <= b; k++) {
        if (k > a) acc += r.cum[k] - r.cum[k - 1];
        if (acc < 24 && k !== a + 1) continue;
        acc = 0;
        const [x, z] = r.pts[k], top = r.profile[k] - 1.3, bed = this.o.groundAt(x, z) - 1, h = top - bed;
        if (h < 1) continue;
        const p = r.pts[Math.min(r.pts.length - 1, k + 1)], q = r.pts[Math.max(0, k - 1)], yaw = Math.atan2(p[0] - q[0], p[1] - q[1]);
        Matrix.ComposeToRef(new Vector3(hw * 1.6, h, 2.2), Quaternion.RotationYawPitchRoll(yaw, 0, 0), new Vector3(x, top, z), M).copyToArray(piers, piers.length);
      }
      i = b + 1;
    }
  }
  /** A vertical strip between two heights along a polyline (two-sided). */
  private wall(name: string, pts: [number, number][], lo: number[], hi: number[], mat: Material) {
    const pos: number[] = [], idx: number[] = [];
    let cx = 0, cz = 0;
    pts.forEach(([x, z], i) => {
      pos.push(x, lo[i], z, x, hi[i], z); cx += x; cz += z;
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const m = new Mesh(name, this.scene), vd = new VertexData();
    vd.positions = pos; vd.indices = idx; const nrm: number[] = []; VertexData.ComputeNormals(pos, idx, nrm); vd.normals = nrm; vd.applyToMesh(m);
    m.material = mat; m.isPickable = false; m.freezeWorldMatrix();
    cx /= pts.length; cz /= pts.length;
    this.add(m, cx, cz, Math.max(...pts.map(([x, z]) => Math.hypot(x - cx, z - cz))) + 10);
  }

  /** Hide what is far away (the terrain's fog hides the rest). */
  update(cam: Vector3) {
    for (const p of this.pieces) p.mesh.setEnabled(Math.hypot(p.cx - cam.x, p.cz - cam.z) - p.r < this.viewDistance);
  }
}
const M = new Matrix();
