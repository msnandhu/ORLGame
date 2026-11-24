import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Terrain, Marker, MarkerKind } from '@orl/shared';

/**
 * World markers for missions: light beams for goals and mission starts, ground rings for checkpoints and zones,
 * glowing journal pages, red tracking pylons, searchlight cones and the dust wall of a collapsing tunnel.
 * Meshes are pooled per kind and re-placed each frame.
 */
export type WorldMarker = Marker | { kind: 'start'; x: number; z: number; r: number };
type Kind = MarkerKind | 'start';
const COLORS: Record<Kind, [number, number, number, number]> = {
  goal: [1, 0.75, 0.2, 0.35], start: [1, 0.85, 0.25, 0.32], checkpoint: [0.2, 0.85, 1, 0.45], next: [0.2, 0.85, 1, 0.16], page: [1, 0.95, 0.75, 0.9],
  pickup: [0.35, 1, 0.5, 0.85], zone: [1, 0.4, 0.15, 0.25], light: [1, 0.97, 0.8, 0.13], pylon: [1, 0.12, 0.08, 0.95], collapse: [0.45, 0.38, 0.3, 0.7], exit: [0.4, 1, 0.5, 0.35],
};

export class MarkerRenderer {
  private pools = new Map<Kind, Mesh[]>();
  private mats = new Map<Kind, StandardMaterial>();
  private t = 0;
  constructor(private scene: Scene, private terrain: Terrain) {
    for (const [k, [r, g, b, a]] of Object.entries(COLORS) as [Kind, [number, number, number, number]][]) {
      const m = new StandardMaterial(`marker-${k}`, scene);
      m.emissiveColor = new Color3(r, g, b); m.diffuseColor = new Color3(0, 0, 0); m.specularColor = new Color3(0, 0, 0);
      m.alpha = a; m.disableLighting = true; m.backFaceCulling = false;
      this.mats.set(k, m);
    }
  }
  private make(kind: Kind): Mesh {
    const s = this.scene;
    let m: Mesh;
    switch (kind) {
      case 'goal': case 'start': case 'exit': m = MeshBuilder.CreateCylinder(kind, { height: 60, diameterTop: 2.2, diameterBottom: 3.4, tessellation: 16, cap: Mesh.NO_CAP }, s); break;
      case 'checkpoint': case 'next': case 'zone': m = MeshBuilder.CreateTorus(kind, { diameter: 2, thickness: 0.04, tessellation: 48 }, s); break;
      case 'page': m = MeshBuilder.CreateBox(kind, { width: 0.6, height: 0.04, depth: 0.85 }, s); break;
      case 'pickup': m = MeshBuilder.CreateBox(kind, { width: 0.8, height: 0.5, depth: 1.2 }, s); break;
      case 'pylon': m = MeshBuilder.CreateCylinder(kind, { height: 7, diameterTop: 0.3, diameterBottom: 1.4, tessellation: 6 }, s); break;
      case 'light': m = MeshBuilder.CreateCylinder(kind, { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 18, cap: Mesh.NO_CAP }, s); break;
      case 'collapse': m = MeshBuilder.CreateBox(kind, { width: 22, height: 14, depth: 3 }, s); break;
    }
    m.material = this.mats.get(kind)!; m.isPickable = false;
    return m;
  }

  /** cam: beams fade out as the camera comes close, so driving into one doesn't tint the screen */
  update(list: WorldMarker[], dt: number, cam?: { x: number; z: number }) {
    this.t += dt;
    const used = new Map<Kind, number>();
    const T = this.terrain;
    for (const mk of list) {
      const k = mk.kind as Kind, n = used.get(k) ?? 0; used.set(k, n + 1);
      const pool = this.pools.get(k) ?? this.pools.set(k, []).get(k)!;
      const m = pool[n] ?? (pool[n] = this.make(k));
      m.setEnabled(true);
      const y = T.heightAt(mk.x, mk.z);
      m.rotation.set(0, 0, 0); m.scaling.set(1, 1, 1);
      switch (k) {
        case 'goal': case 'start': case 'exit': {
          m.position.set(mk.x, y + 30, mk.z); m.scaling.set(mk.r / 3, 1, mk.r / 3);
          const d = cam ? Math.hypot(cam.x - mk.x, cam.z - mk.z) : 1e9;
          m.visibility = Math.max(0, Math.min(1, (d - mk.r * 0.8) / 30));
          break;
        }
        case 'checkpoint': case 'next': case 'zone': {
          // a ring standing across the course for checkpoints; a ring on the ground for zones
          const d = k === 'zone' ? mk.r : Math.min(mk.r, 12);
          m.scaling.set(d, d * (k === 'zone' ? 1 : 1), d);
          if (k === 'zone') m.position.set(mk.x, y + 0.4, mk.z);
          else { m.position.set(mk.x, y + d * 0.6, mk.z); m.rotation.x = Math.PI / 2; m.rotation.y = this.t * 0.6; }
          break;
        }
        case 'page': m.position.set(mk.x, y + 1.3 + Math.sin(this.t * 2) * 0.2, mk.z); m.rotation.y = this.t; break;
        case 'pickup': m.position.set(mk.x, y + 1 + Math.sin(this.t * 2) * 0.2, mk.z); m.rotation.y = this.t; break;
        case 'pylon': m.position.set(mk.x, y + 3.5, mk.z); break;
        case 'light': {
          // a cone lying along the beam, apex at the lamp
          const range = 'range' in mk && mk.range ? mk.range : 40, half = 'half' in mk && mk.half ? mk.half : 0.24, ang = 'ang' in mk && mk.ang !== undefined ? mk.ang : 0;
          const w = Math.tan(half) * range * 2;
          m.scaling.set(w, range, w);
          m.rotation.set(-Math.PI / 2, ang, 0);
          m.position.set(mk.x + Math.sin(ang) * range / 2, y + 1.2, mk.z + Math.cos(ang) * range / 2);
          break;
        }
        case 'collapse': { const ang = 'ang' in mk && mk.ang !== undefined ? mk.ang : 0; m.position.set(mk.x, y + 7, mk.z); m.rotation.y = ang; break; }
      }
    }
    for (const [k, pool] of this.pools) for (let i = used.get(k) ?? 0; i < pool.length; i++) pool[i].setEnabled(false);
  }
}
