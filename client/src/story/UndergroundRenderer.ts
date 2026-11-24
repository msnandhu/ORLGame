import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { Terrain, Underground, UgChamber } from '@orl/shared';

/**
 * The underground: cave floor and ceiling built from the shared heightfield in 64 m blocks (streamed around the
 * camera, solid rock skipped), the underground river, Crowe's props and boulders, the challenge gates, strip lamps
 * along every tunnel and a ring of lamps in every hall. Two point lights follow the halls nearest the player.
 */
const SURF_RGB: Record<number, [number, number, number]> = {
  1: [0.42, 0.33, 0.24], 2: [0.27, 0.2, 0.14], 3: [0.34, 0.32, 0.3], 4: [0.44, 0.42, 0.39], 5: [0.2, 0.2, 0.21], 7: [0.7, 0.58, 0.4], 8: [0.72, 0.84, 0.92],
};
const PROP_RGB: Record<string, [number, number, number]> = {
  container: [0.55, 0.22, 0.14], tank: [0.5, 0.52, 0.5], console: [0.15, 0.17, 0.2], rack: [0.3, 0.32, 0.34], pillar: [0.42, 0.4, 0.37], lift: [0.62, 0.5, 0.12],
  pipe: [0.36, 0.36, 0.38], crate: [0.48, 0.36, 0.2], pylon: [0.7, 0.1, 0.08],
};
const B = 32;

export class UndergroundRenderer {
  readonly meshes: Mesh[] = [];
  private blocks = new Map<number, Mesh[] | null>();
  private floorMat: StandardMaterial; private ceilMat: StandardMaterial;
  private gateMeshes: Mesh[] = [];
  private lights: PointLight[] = [];
  private U: Underground;
  private built = false;
  enabled = false;

  constructor(private scene: Scene, private terrain: Terrain) {
    this.U = terrain.underground;
    const fm = this.floorMat = new StandardMaterial('ug-floor', scene);
    fm.diffuseColor = new Color3(1, 1, 1); fm.specularColor = new Color3(0.05, 0.05, 0.05);
    const cm = this.ceilMat = new StandardMaterial('ug-ceiling', scene);
    cm.diffuseColor = new Color3(0.24, 0.22, 0.21); cm.specularColor = new Color3(0, 0, 0); cm.backFaceCulling = true;
    for (let i = 0; i < 2; i++) {
      const l = new PointLight(`ug-light-${i}`, new Vector3(0, -1000, 0), scene);
      l.diffuse = new Color3(1, 0.86, 0.66); l.specular = new Color3(0.2, 0.18, 0.15); l.intensity = 0; l.range = 160;
      this.lights.push(l);
    }
  }

  /** Static dressing (props, boulders, lamps, gates, water) is built the first time the player goes down. */
  private buildStatic() {
    if (this.built) return;
    this.built = true;
    const s = this.scene, U = this.U;
    // props: one merged mesh per colour
    const byKind = new Map<string, Mesh[]>();
    for (const p of U.props) {
      const m = MeshBuilder.CreateBox('ug-prop', { width: p.w, height: p.h, depth: p.d }, s);
      m.position.set(p.x, p.y + p.h / 2, p.z); m.rotation.y = p.yaw;
      (byKind.get(p.kind) ?? byKind.set(p.kind, []).get(p.kind)!).push(m);
    }
    for (const [kind, list] of byKind) {
      const merged = Mesh.MergeMeshes(list, true, true)!; merged.name = `ug-${kind}`;
      const mat = new StandardMaterial(`ug-${kind}`, s); mat.diffuseColor = new Color3(...(PROP_RGB[kind] ?? [0.4, 0.4, 0.4])); mat.specularColor = new Color3(0.15, 0.15, 0.15);
      if (kind === 'console') mat.emissiveColor = new Color3(0.05, 0.25, 0.3);
      merged.material = mat; this.add(merged);
    }
    // boulders: thin instances of one rock
    const rock = MeshBuilder.CreateIcoSphere('ug-boulder', { radius: 1, subdivisions: 2, flat: true }, s);
    const rm = new StandardMaterial('ug-rock', s); rm.diffuseColor = new Color3(0.36, 0.34, 0.31); rm.specularColor = new Color3(0.04, 0.04, 0.04); rock.material = rm;
    const bm: number[] = [];
    U.boulders.forEach((b, i) => { Matrix.Compose(new Vector3(b.r, b.r * 0.8, b.r * 1.1), Quaternion.FromEulerAngles(0, i * 1.7, 0), new Vector3(b.x, b.y, b.z)).copyToArray(bm, i * 16); });
    if (U.boulders.length) { rock.thinInstanceSetBuffer('matrix', new Float32Array(bm), 16); this.add(rock); } else rock.dispose();
    // lamps: strips along the tunnels' roofs and a ring in each hall
    const lamp = MeshBuilder.CreateBox('ug-lamp', { width: 0.5, height: 0.2, depth: 2.4 }, s);
    const lm = new StandardMaterial('ug-lamp', s); lm.emissiveColor = new Color3(1, 0.82, 0.55); lm.diffuseColor = new Color3(0, 0, 0); lm.disableLighting = true; lamp.material = lm;
    const lamps: number[] = [];
    const put = (x: number, z: number, y: number, yaw: number) => { Matrix.Compose(Vector3.One(), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(x, y, z)).copyToArray(lamps, lamps.length); };
    for (const t of U.tunnels) for (let k = 1; k < t.pts.length; k += 2) {
      const [x, z] = t.pts[k], [px, pz] = t.pts[k - 1];
      put(x, z, U.ceilingAt(x, z) - 0.4, Math.atan2(x - px, z - pz));
    }
    for (const c of U.chambers) for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, x = c.x + Math.cos(a) * c.r * 0.7, z = c.z + Math.sin(a) * c.r * 0.7;
      put(x, z, U.ceilingAt(x, z) - 0.4, -a);
    }
    lamp.thinInstanceSetBuffer('matrix', new Float32Array(lamps), 16); this.add(lamp);
    // river water
    const wm = new StandardMaterial('ug-water', s); wm.diffuseColor = new Color3(0.05, 0.12, 0.14); wm.specularColor = new Color3(0.6, 0.6, 0.6); wm.specularPower = 64; wm.alpha = 0.82;
    for (const c of U.chambers) if (c.theme === 'river') {
      const d = MeshBuilder.CreateDisc('ug-river', { radius: c.r + 4, tessellation: 48 }, s);
      d.rotation.x = Math.PI / 2; d.position.set(c.x, c.floor - 0.35, c.z); d.material = wm; this.add(d);
    }
    // gates: steel doors with hazard stripes
    const gm = new StandardMaterial('ug-gate', s); gm.diffuseColor = new Color3(0.32, 0.33, 0.35); gm.specularColor = new Color3(0.4, 0.4, 0.4);
    const sm = new StandardMaterial('ug-gate-stripe', s); sm.diffuseColor = new Color3(0.85, 0.62, 0.05); sm.emissiveColor = new Color3(0.2, 0.12, 0);
    for (const g of U.gates) {
      const door = MeshBuilder.CreateBox('ug-gate', { width: g.w, height: 11, depth: 1.2 }, s); door.material = gm;
      const stripe = MeshBuilder.CreateBox('ug-gate-stripe', { width: g.w, height: 0.8, depth: 1.3 }, s); stripe.material = sm; stripe.parent = door; stripe.position.y = -3.5;
      door.position.set(g.x, U.heightAt(g.x, g.z) + 5.5, g.z); door.rotation.y = g.yaw;
      this.gateMeshes.push(door); this.add(door); this.meshes.push(stripe);
    }
  }
  private add(m: Mesh) { m.isPickable = false; m.receiveShadows = false; this.meshes.push(m); m.setEnabled(this.enabled); }

  /** One 64 m block of floor and ceiling, or null for solid rock. */
  private buildBlock(bi: number, bj: number): Mesh[] | null {
    const U = this.U, i0 = bi * B, j0 = bj * B, nx = U.nx, nz = U.nz;
    const i1 = Math.min(nx - 1, i0 + B), j1 = Math.min(nz - 1, j0 + B);
    for (const [i, j] of [[i0, j0], [i1, j0], [i0, j1], [i1, j1]]) U.ensure(i, j);
    let open = false;
    for (let j = j0; j <= j1 && !open; j++) for (let i = i0; i <= i1; i++) { const k = j * nx + i; if (U.ceiling[k] - U.heights[k] > 0.5) { open = true; break; } }
    if (!open) return null;
    const w = i1 - i0 + 1, h = j1 - j0 + 1, R = U.rect, C = 2;
    const pos: number[] = [], col: number[] = [], cpos: number[] = [], idx: number[] = [], cidx: number[] = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i, x = R.x0 + i * C, z = R.z0 + j * C, y = U.heights[k];
      pos.push(x, y, z); cpos.push(x, Math.max(y, U.ceiling[k]), z);
      const [r, g, b] = SURF_RGB[U.surface[k]] ?? SURF_RGB[3];
      const n = 0.85 + 0.3 * (((i * 73856093) ^ (j * 19349663)) & 255) / 255;
      col.push(r * n, g * n, b * n, 1);
    }
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d); cidx.push(a, b, c, b, d, c);
    }
    const mk = (name: string, p: number[], ind: number[], mat: StandardMaterial, colors?: number[]) => {
      const m = new Mesh(name, this.scene), vd = new VertexData(), nrm: number[] = [];
      vd.positions = p; vd.indices = ind; VertexData.ComputeNormals(p, ind, nrm); vd.normals = nrm; if (colors) vd.colors = colors;
      vd.applyToMesh(m); m.material = mat; m.freezeWorldMatrix(); m.isPickable = false; m.setEnabled(this.enabled);
      return m;
    };
    return [mk('ug-floor', pos, idx, this.floorMat, col), mk('ug-ceiling', cpos, cidx, this.ceilMat)];
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.buildStatic();
    for (const m of this.meshes) m.setEnabled(on);
    for (const list of this.blocks.values()) if (list) for (const m of list) m.setEnabled(on);
    for (const l of this.lights) l.setEnabled(on);
  }

  /** Stream blocks around the camera, keep the gates in step with the story, move the hall lights. */
  update(cam: Vector3) {
    if (!this.enabled) return;
    const U = this.U, R = U.rect, size = B * 2;
    const ci = Math.floor((cam.x - R.x0) / size), cj = Math.floor((cam.z - R.z0) / size), rad = 7;
    let budget = 3;
    for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
      const bi = ci + di, bj = cj + dj;
      if (bi < 0 || bj < 0 || bi * B >= U.nx - 1 || bj * B >= U.nz - 1 || di * di + dj * dj > rad * rad) continue;
      const key = bj * 1000 + bi;
      if (this.blocks.has(key)) continue;
      if (budget-- <= 0) continue;
      this.blocks.set(key, this.buildBlock(bi, bj));
    }
    this.terrain.gateOpen.forEach((open, i) => {
      const m = this.gateMeshes[i]; if (!m) return;
      const g = U.gates[i], base = U.heightAt(g.x, g.z) + 5.5, target = open ? base + 12 : base;
      m.position.y += (target - m.position.y) * 0.06;
      m.setEnabled(this.enabled && m.position.y < base + 11.5);
    });
    // the two halls nearest the camera are lit
    const near = [...U.chambers].sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z)).slice(0, 2);
    near.forEach((c: UgChamber, i) => { const l = this.lights[i]; l.position.set(c.x, U.ceilingAt(c.x, c.z) - 3, c.z); l.range = c.r * 2.4; l.intensity = c.kind === 'final' ? 2.4 : 1.6; });
  }

  /** Build every block now (used before screenshots and for the first descent, so the halls don't pop in). */
  prime(cam: Vector3) { for (let k = 0; k < 60; k++) this.update(cam); }
}
