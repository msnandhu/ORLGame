import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { GANGS, type Compound, type GangId } from '@orl/shared';

/**
 * The gang compounds (perimeter walls, sheds, containers, watchtowers, a flag in the gang's colours, the gate barrier)
 * and the underground entrance's rock-cut portal, from the shared compound layout. One merged mesh per material per
 * compound; compounds out of range are switched off.
 */
const hex = (h: string) => Color3.FromHexString(h);
export class CompoundRenderer {
  readonly meshes: Mesh[] = [];
  private sites: { c: Compound; meshes: Mesh[] }[] = [];
  viewDistance = 1600;

  constructor(scene: Scene, compounds: Compound[]) {
    const mat = (name: string, c: Color3, rough = 0.85, metal = 0) => { const m = new PBRMaterial(name, scene); m.albedoColor = c; m.roughness = rough; m.metallic = metal; return m; };
    const concrete = mat('cmp-concrete', new Color3(0.42, 0.4, 0.37)), steel = mat('cmp-steel', new Color3(0.3, 0.31, 0.32), 0.5, 0.7), rock = mat('cmp-rock', new Color3(0.33, 0.31, 0.29), 0.95);
    for (const c of compounds) {
      const groups = new Map<PBRMaterial | StandardMaterial, Mesh[]>();
      const push = (m: Mesh, mt: PBRMaterial | StandardMaterial) => { (groups.get(mt) ?? groups.set(mt, []).get(mt)!).push(m); };
      const gang = c.gang ? GANGS[c.gang as GangId] : null;
      const paint = gang ? mat(`cmp-paint-${c.id}`, hex(gang.paint), 0.6, 0.2) : steel;
      const accent = gang ? mat(`cmp-accent-${c.id}`, hex(gang.accent), 0.6, 0.1) : steel;
      for (const p of c.parts) {
        let m: Mesh, mt: PBRMaterial | StandardMaterial = concrete;
        switch (p.kind) {
          case 'pole': {
            m = MeshBuilder.CreateCylinder('cmp-pole', { height: p.h, diameter: 0.22, tessellation: 8 }, scene); mt = steel;
            m.position.set(p.x, p.y + p.h / 2, p.z);
            const flag = MeshBuilder.CreatePlane('cmp-flag', { width: 3.2, height: 2, sideOrientation: Mesh.DOUBLESIDE }, scene);
            flag.position.set(p.x + Math.cos(p.yaw) * 1.7, p.y + p.h - 1.2, p.z - Math.sin(p.yaw) * 1.7); flag.rotation.y = p.yaw + Math.PI / 2;
            push(flag, accent);
            break;
          }
          case 'barrier': {
            m = MeshBuilder.CreateBox('cmp-barrier', { width: 9, height: 0.25, depth: 0.25 }, scene); mt = accent;
            m.position.set(p.x, p.y + p.h, p.z); m.rotation.y = p.yaw;
            const post = MeshBuilder.CreateBox('cmp-post', { width: 0.4, height: p.h + 0.2, depth: 0.4 }, scene); post.position.set(p.x, p.y + (p.h + 0.2) / 2, p.z); push(post, steel);
            break;
          }
          case 'tower': {
            m = MeshBuilder.CreateBox('cmp-tower', { width: p.w, height: 0.5, depth: p.d }, scene); mt = paint;
            m.position.set(p.x, p.y + p.h, p.z); m.rotation.y = p.yaw;
            for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
              const leg = MeshBuilder.CreateBox('cmp-leg', { width: 0.25, height: p.h, depth: 0.25 }, scene);
              const lx = ox * (p.w / 2 - 0.2), lz = oz * (p.d / 2 - 0.2), cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
              leg.position.set(p.x + lx * cs + lz * sn, p.y + p.h / 2, p.z - lx * sn + lz * cs); push(leg, steel);
            }
            const roof = MeshBuilder.CreateBox('cmp-tower-roof', { width: p.w + 0.6, height: 0.3, depth: p.d + 0.6 }, scene); roof.position.set(p.x, p.y + p.h + 2.6, p.z); roof.rotation.y = p.yaw; push(roof, steel);
            break;
          }
          default: {
            m = MeshBuilder.CreateBox(`cmp-${p.kind}`, { width: p.w, height: p.h + 1, depth: p.d }, scene);
            m.position.set(p.x, p.y + (p.h - 1) / 2, p.z); m.rotation.y = p.yaw;
            mt = p.kind === 'wall' ? concrete : p.kind === 'shed' ? steel : p.kind === 'container' ? (p.color === 2 ? accent : paint) : p.kind === 'pillar' ? rock : steel;
            if (p.kind === 'lintel') { m.position.y = p.y + p.h / 2; }
          }
        }
        push(m, mt);
      }
      const out: Mesh[] = [];
      for (const [mt, list] of groups) { const mm = Mesh.MergeMeshes(list, true, true); if (!mm) continue; mm.material = mt; mm.isPickable = false; mm.receiveShadows = true; mm.freezeWorldMatrix(); out.push(mm); }
      this.sites.push({ c, meshes: out }); this.meshes.push(...out);
    }
  }

  update(cam: Vector3) {
    for (const s of this.sites) { const on = Math.hypot(s.c.x - cam.x, s.c.z - cam.z) < this.viewDistance; for (const m of s.meshes) if (m.isEnabled() !== on) m.setEnabled(on); }
  }
  setEnabled(on: boolean) { for (const m of this.meshes) m.setEnabled(on); }
}
