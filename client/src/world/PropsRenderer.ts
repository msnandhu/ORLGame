import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Terrain, mulberry32 } from '@orl/shared';

interface PropChunk { center: Vector3; hi: Mesh[]; lo: Mesh[] }

/**
 * Trees and boulders as GPU thin instances, bucketed into 128 m chunks so whole chunks are frustum-culled,
 * swapped to low-poly versions at distance, and hidden beyond the view distance.
 */
export class PropsRenderer {
  readonly chunks = new Map<string, PropChunk>();
  readonly casters: Mesh[] = [];
  lodDistance = 220;
  viewDistance = 1200;
  density = 1;

  constructor(scene: Scene, t: Terrain) {
    const mat = (name: string, c: Color3, rough = 0.95) => { const m = new PBRMaterial(name, scene); m.albedoColor = c; m.metallic = 0; m.roughness = rough; m.environmentIntensity = 0.3; return m; };
    const trunkM = mat('trunk', new Color3(0.29, 0.21, 0.15));
    const leafM = mat('needles', new Color3(1, 1, 1)); // tinted per instance
    const rockM = mat('rock', new Color3(1, 1, 1), 0.9);

    // Template meshes (hi / lo)
    const trunk = MeshBuilder.CreateCylinder('t-trunk', { diameterTop: 1.2, diameterBottom: 2, height: 1, tessellation: 6 }, scene); trunk.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    const trunkLo = MeshBuilder.CreateCylinder('t-trunk-lo', { diameterTop: 1.2, diameterBottom: 2, height: 1, tessellation: 3 }, scene); trunkLo.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    // pine: five drooping, jagged tiers; broadleaf: a lumpy cluster of foliage blobs
    const cone = Mesh.MergeMeshes([0, 1, 2, 3, 4].map(k => {
      const c = MeshBuilder.CreateCylinder('c', { diameterTop: 0.05, diameterBottom: 2.1 * (1 - k * 0.17), height: 0.34 - k * 0.02, tessellation: 11 }, scene);
      jitter(c, 0.1, 20 + k); c.position.y = 0.2 + k * 0.17; c.rotation.y = k * 0.7; return c;
    }), true)!;
    const top = MeshBuilder.CreateCylinder('tip', { diameterTop: 0, diameterBottom: 0.5, height: 0.22, tessellation: 7 }, scene); top.position.y = 1.03;
    const pine = Mesh.MergeMeshes([cone, top], true)!;
    const coneLo = MeshBuilder.CreateCylinder('cone-lo', { diameterTop: 0, diameterBottom: 2, height: 1, tessellation: 4 }, scene); coneLo.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    const blob = Mesh.MergeMeshes(([[0, 0.62, 0, 0.8], [0.45, 0.5, 0.2, 0.55], [-0.4, 0.55, -0.15, 0.58], [0.1, 0.5, -0.45, 0.5], [-0.15, 0.95, 0.15, 0.55], [0.25, 0.85, 0.35, 0.45]] as number[][]).map(([x, y, z, r], k) => {
      const b = jitter(MeshBuilder.CreateIcoSphere('blob', { radius: r, subdivisions: 2, flat: true }, scene), 0.16, 7 + k); b.position.set(x, y, z); return b;
    }), true)!;
    const blobLo = MeshBuilder.CreateIcoSphere('blob-lo', { radius: 1, subdivisions: 1, flat: true }, scene); blobLo.bakeTransformIntoVertices(Matrix.Translation(0, 0.62, 0));
    const rock = jitter(MeshBuilder.CreateIcoSphere('rock', { radius: 1, subdivisions: 3, flat: true }, scene), 0.12, 3);
    const rockLo = MeshBuilder.CreateIcoSphere('rock-lo', { radius: 1, subdivisions: 1, flat: true }, scene);
    const templates: Record<string, [Mesh, Mesh, PBRMaterial]> = {
      trunk: [trunk, trunkLo, trunkM], cone: [pine, coneLo, leafM], blob: [blob, blobLo, leafM], rock: [rock, rockLo, rockM],
    };
    for (const [m, l, mm] of Object.values(templates)) { m.material = mm; l.material = mm; m.setEnabled(false); l.setEnabled(false); }

    // Bucket instance matrices by chunk
    type Bucket = Record<string, { mats: number[]; cols: number[] }>;
    const buckets = new Map<string, { center: Vector3; b: Bucket }>();
    const rnd = mulberry32(42);
    const put = (kind: string, x: number, z: number, m: Matrix, c: Color3) => {
      const key = `${Math.floor((x + t.half) / 128)},${Math.floor((z + t.half) / 128)}`;
      let e = buckets.get(key);
      if (!e) {
        const cx = Math.floor((x + t.half) / 128) * 128 - t.half + 64, cz = Math.floor((z + t.half) / 128) * 128 - t.half + 64;
        e = { center: new Vector3(cx, t.heightAt(cx, cz), cz), b: {} }; buckets.set(key, e);
      }
      const bk = (e.b[kind] ??= { mats: [], cols: [] });
      m.copyToArray(bk.mats, bk.mats.length); bk.cols.push(c.r, c.g, c.b, 1);
    };
    const q = new Quaternion(), up = Vector3.Up();
    for (const tr of t.trees) {
      const yaw = rnd() * 6.28;
      put('trunk', tr.x, tr.z, Matrix.Compose(new Vector3(tr.r, tr.h * 0.45, tr.r), Quaternion.Identity(), new Vector3(tr.x, tr.y - 0.3, tr.z)), Color3.White());
      if (tr.kind === 0) {
        const w = tr.h * 0.28;
        put('cone', tr.x, tr.z, Matrix.Compose(new Vector3(w, tr.h * 1.1, w), Quaternion.RotationAxisToRef(up, yaw, q).clone(), new Vector3(tr.x, tr.y + tr.h * 0.1, tr.z)), Color3.FromHSV(95 + rnd() * 18, 0.45 + rnd() * 0.15, 0.24 + rnd() * 0.1));
      } else {
        const w = tr.h * 0.33;
        put('blob', tr.x, tr.z, Matrix.Compose(new Vector3(w, tr.h * 0.42, w), Quaternion.RotationAxisToRef(up, yaw, q).clone(), new Vector3(tr.x, tr.y + tr.h * 0.38, tr.z)), Color3.FromHSV(75 + rnd() * 28, 0.5 + rnd() * 0.15, 0.3 + rnd() * 0.1));
      }
    }
    for (const b of t.boulders) {
      const rot = Quaternion.FromEulerAngles(rnd() * 6, rnd() * 6, rnd() * 6);
      put('rock', b.x, b.z, Matrix.Compose(new Vector3(b.r * (0.98 + rnd() * 0.04), b.r * 0.97, b.r * (0.98 + rnd() * 0.04)), rot, new Vector3(b.x, b.y, b.z)), Color3.FromHSV(25, 0.1 + rnd() * 0.08, 0.38 + rnd() * 0.14));
    }
    for (const [key, e] of buckets) {
      const ch: PropChunk = { center: e.center, hi: [], lo: [] };
      for (const [kind, data] of Object.entries(e.b)) {
        const [tHi, tLo] = templates[kind];
        for (const [tpl, list] of [[tHi, ch.hi], [tLo, ch.lo]] as const) {
          const m = tpl.clone(`${kind}-${key}-${tpl === tHi ? 'hi' : 'lo'}`, null, true, false) as Mesh;
          m.makeGeometryUnique();
          m.setEnabled(true);
          m.thinInstanceSetBuffer('matrix', new Float32Array(data.mats), 16, true);
          m.thinInstanceSetBuffer(VertexBuffer.ColorKind, new Float32Array(data.cols), 4, true);
          m.thinInstanceRefreshBoundingInfo(false);
          m.receiveShadows = true; m.isPickable = false;
          m.metadata = { count: data.mats.length / 16 };
          list.push(m);
          if (tpl === tHi) this.casters.push(m);
        }
      }
      this.chunks.set(key, ch);
    }
  }

  setDensity(d: number) {
    this.density = d;
    for (const ch of this.chunks.values()) for (const m of [...ch.hi, ...ch.lo]) {
      const n = m.metadata.count as number;
      m.thinInstanceCount = m.name.startsWith('rock') ? n : Math.max(0, Math.floor(n * d));
    }
  }

  update(cam: Vector3) {
    for (const ch of this.chunks.values()) {
      const d = Math.hypot(ch.center.x - cam.x, ch.center.z - cam.z) - 90;
      const vis = d < this.viewDistance, lo = d > this.lodDistance;
      for (const m of ch.hi) m.setEnabled(vis && !lo);
      for (const m of ch.lo) m.setEnabled(vis && lo);
    }
  }
}

function jitter(m: Mesh, amt: number, seed: number): Mesh {
  const r = mulberry32(seed);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.length; i += 3) {
    const k = `${pos[i].toFixed(3)},${pos[i + 1].toFixed(3)},${pos[i + 2].toFixed(3)}`;
    let d = seen.get(k); if (d === undefined) { d = 1 + (r() - 0.5) * 2 * amt; seen.set(k, d); }
    pos[i] *= d; pos[i + 1] *= d; pos[i + 2] *= d;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  m.createNormals(false);
  return m;
}
