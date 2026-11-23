import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Terrain, mulberry32 } from '@orl/shared';
import type { HavokWorld } from '../physics/HavokWorld';

const pbr = (scene: Scene, name: string, c: Color3, rough: number, metal = 0) => {
  const m = new PBRMaterial(name, scene); m.albedoColor = c; m.roughness = rough; m.metallic = metal; return m;
};

/** Water surface, base-camp structures (from the shared colliders) and Havok-simulated loose props. */
export class Scenery {
  readonly water: Mesh;
  readonly flag: Mesh;
  readonly casters: Mesh[] = [];
  readonly props: Mesh[] = [];

  constructor(scene: Scene, t: Terrain, physics: HavokWorld | null) {
    // Water
    this.water = MeshBuilder.CreateGround('water', { width: t.size, height: t.size, subdivisions: 1 }, scene);
    this.water.position.y = t.waterLevel;
    const wm = pbr(scene, 'water', new Color3(0.1, 0.2, 0.2), 0.05);
    wm.alpha = 0.82; wm.clearCoat.isEnabled = true; wm.clearCoat.intensity = 1; wm.environmentIntensity = 1.2;
    this.water.material = wm; this.water.receiveShadows = true; this.water.isPickable = false;

    // Camp structures straight from the shared static boxes (identical to what physics collides with)
    const mats: Record<string, PBRMaterial> = {
      wall: pbr(scene, 'wood', new Color3(0.42, 0.3, 0.2), 0.9),
      crate: pbr(scene, 'crate', new Color3(0.54, 0.42, 0.25), 0.9),
      roof: pbr(scene, 'roof', new Color3(0.36, 0.38, 0.41), 0.45, 0.6),
      pump: pbr(scene, 'pump', new Color3(0.7, 0.2, 0.16), 0.4),
      pole: pbr(scene, 'steel', new Color3(0.6, 0.62, 0.64), 0.35, 0.85),
    };
    for (const b of t.boxes) {
      const m = MeshBuilder.CreateBox(`camp-${b.kind}`, { width: b.hx * 2, height: b.hy * 2, depth: b.hz * 2 }, scene);
      m.position.set(b.cx, b.cy, b.cz); m.rotation.y = b.yaw; m.material = mats[b.kind]; m.receiveShadows = true;
      this.casters.push(m); m.freezeWorldMatrix();
    }
    const h = t.heightAt(0, 0);
    const pad = MeshBuilder.CreateBox('pump-pad', { width: 4, height: 0.12, depth: 3 }, scene); pad.position.set(t.fuelPump.x, h + 0.03, t.fuelPump.z); pad.material = mats.pole; pad.receiveShadows = true;
    const screen = MeshBuilder.CreatePlane('pump-screen', { width: 0.55, height: 0.3 }, scene);
    const sm = pbr(scene, 'pump-screen', new Color3(1, 0.83, 0.42), 0.5); sm.emissiveColor = new Color3(0.9, 0.6, 0.1);
    screen.material = sm; screen.position.set(t.fuelPump.x, h + 1.4, t.fuelPump.z + 0.31); screen.rotation.y = Math.PI;
    const floor = MeshBuilder.CreateBox('shed-floor', { width: 10, height: 0.1, depth: 8 }, scene); floor.position.set(-18, h + 0.02, 14); floor.material = mats.pole; floor.receiveShadows = true;
    this.flag = MeshBuilder.CreateGround('flag', { width: 2.2, height: 1.3, subdivisions: 8, updatable: true }, scene);
    this.flag.rotation.x = -Math.PI / 2; this.flag.position.set(5.15, h + 8.2, -8);
    const fm = pbr(scene, 'flag', new Color3(0.88, 0.47, 0.16), 0.8); fm.backFaceCulling = false; this.flag.material = fm;
    this.casters.push(this.flag);

    // Loose physics props near camp and along the first trail: crates, barrels, small rocks
    if (physics) {
      const rnd = mulberry32(77);
      const barrelM = pbr(scene, 'barrel', new Color3(0.2, 0.35, 0.55), 0.5, 0.6);
      const spots: [number, number][] = [[8, -2], [9.2, -2], [8.6, -0.9], [-8, 8], [-7, 9], [20, -18], [-25, -6], [30, 10], [62, -21], [64, -19], [-60, 8], [-61, 10]];
      spots.forEach(([x, z], i) => {
        const y = t.heightAt(x, z);
        if (i % 3 === 2) {
          const m = MeshBuilder.CreateCylinder(`barrel-${i}`, { diameter: 0.6, height: 0.9, tessellation: 14 }, scene);
          m.material = barrelM; m.position.set(x, y + 0.5, z); m.rotationQuaternion = Quaternion.Identity();
          physics.addDynamicCylinder(m.name, m, 0.3, 0.9, 45); this.props.push(m);
        } else {
          const s = 0.8 + rnd() * 0.4;
          const m = MeshBuilder.CreateBox(`crate-${i}`, { size: s }, scene);
          m.material = mats.crate; m.position.set(x, y + s / 2 + 0.05, z); m.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), rnd() * 3);
          physics.addDynamicBox(m.name, m, new Vector3(s, s, s), 25 * s * s * s); this.props.push(m);
        }
      });
      for (const m of this.props) { m.receiveShadows = true; this.casters.push(m); }
    }
  }

  animate(timeMs: number) {
    const pos = this.flag.getVerticesData('position');
    if (!pos) return;
    for (let i = 0; i < pos.length; i += 3) { const x = pos[i] + 1.1; pos[i + 1] = Math.sin(timeMs * 0.004 + x * 2.5) * 0.12 * x; }
    this.flag.updateVerticesData('position', pos);
  }
}
