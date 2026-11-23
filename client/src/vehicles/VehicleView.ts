import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import type { Vehicle } from '@orl/shared';
import { treadTexture } from '../assets/proceduralTextures';

/**
 * Original model of the fictional "Ranger TX4", assembled from primitives (placeholder art, clearly
 * marked as such in the docs) and driven entirely by the shared vehicle simulation.
 */
const COCKPIT_HIDDEN = new Set(['cab', 'a-pillar', 'rack', 'lightbar', 'lightbar-led', 'rear-glass', 'side-glass', 'jerrycan']);

export class VehicleView {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private wheels: { steer: TransformNode; spin: TransformNode }[] = [];
  private brake: PBRMaterial; private head: PBRMaterial;
  private lamps: SpotLight[] = [];
  headlightsOn = false;

  constructor(scene: Scene, private v: Vehicle, paint = new Color3(0.76, 0.38, 0.17)) {
    this.root = new TransformNode('vehicle', scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    const mat = (n: string, c: Color3, r: number, m = 0) => { const x = new PBRMaterial(n, scene); x.albedoColor = c; x.roughness = r; x.metallic = m; return x; };
    const body = mat('paint', paint, 0.35, 0.3); body.clearCoat.isEnabled = true; body.clearCoat.intensity = 0.8; body.clearCoat.roughness = 0.12;
    const dark = mat('trim', new Color3(0.11, 0.12, 0.13), 0.7, 0.1);
    const steel = mat('steel', new Color3(0.38, 0.4, 0.42), 0.3, 0.9);
    const glass = mat('glass', new Color3(0.05, 0.08, 0.1), 0.05, 0.1); glass.alpha = 0.85;
    this.head = mat('headlamp', new Color3(1, 1, 1), 0.2); this.head.emissiveColor = new Color3(1, 0.95, 0.82); this.head.emissiveIntensity = 0.6;
    this.brake = mat('brakelamp', new Color3(0.35, 0, 0), 0.3); this.brake.emissiveColor = new Color3(1, 0.1, 0); this.brake.emissiveIntensity = 0.3;

    const box = (n: string, w: number, h: number, d: number, m: PBRMaterial, x: number, y: number, z: number, rx = 0) => {
      const b = MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
      b.parent = this.root; b.position.set(x, y, z); b.rotation.x = rx; b.material = m; this.meshes.push(b); return b;
    };
    const cyl = (n: string, r: number, len: number, m: PBRMaterial, x: number, y: number, z: number, axis: 'x' | 'y' | 'z') => {
      const c = MeshBuilder.CreateCylinder(n, { diameter: r * 2, height: len, tessellation: 12 }, scene);
      c.parent = this.root; c.position.set(x, y, z); if (axis === 'x') c.rotation.z = Math.PI / 2; if (axis === 'z') c.rotation.x = Math.PI / 2;
      c.material = m; this.meshes.push(c); return c;
    };
    box('frame', 1.1, 0.18, 4.2, dark, 0, -0.42, 0);
    box('skid', 1.0, 0.06, 1.2, steel, 0, -0.53, 1.0);
    box('tub', 1.78, 0.62, 4.3, body, 0, -0.02, -0.05);
    box('hood', 1.72, 0.14, 1.55, body, 0, 0.33, 1.38, -0.05);
    box('cab', 1.66, 0.8, 2.05, body, 0, 0.69, -0.9);
    box('a-pillar', 1.66, 0.85, 0.12, body, 0, 0.66, 0.33, -0.47);
    box('windshield', 1.5, 0.72, 0.03, glass, 0, 0.68, 0.4, -0.47);
    for (const sx of [-1, 1]) {
      box('side-glass', 0.03, 0.46, 1.8, glass, sx * 0.84, 0.77, -0.85);
      for (const z of [v.spec.wheelFrontZ, v.spec.wheelRearZ]) box('flare', 0.18, 0.16, 1.15, dark, sx * 0.93, 0.18, z);
      box('mirror', 0.22, 0.14, 0.06, dark, sx * 1.0, 0.68, 0.25);
      box('step', 0.2, 0.06, 1.7, steel, sx * 0.95, -0.36, 0);
    }
    box('rear-glass', 1.4, 0.42, 0.03, glass, 0, 0.82, -1.94);
    box('grille', 1.2, 0.36, 0.06, dark, 0, 0.12, 2.16);
    box('bumper-f', 1.9, 0.22, 0.28, steel, 0, -0.3, 2.22);
    cyl('bullbar', 0.04, 1.3, steel, 0, 0.32, 2.36, 'x');
    for (const sx of [-0.55, 0.55]) cyl('bullbar-post', 0.04, 0.7, steel, sx, 0, 2.36, 'y');
    for (const sx of [-0.68, 0.68]) cyl('headlight', 0.11, 0.06, this.head, sx, 0.15, 2.17, 'z');
    box('bumper-r', 1.9, 0.22, 0.22, steel, 0, -0.3, -2.25);
    for (const sx of [-0.78, 0.78]) box('taillight', 0.16, 0.26, 0.04, this.brake, sx, 0.08, -2.2);
    cyl('spare', 0.38, 0.26, dark, 0, 0.25, -2.36, 'z');
    box('rack', 1.5, 0.05, 1.8, dark, 0, 1.12, -0.9);
    box('lightbar', 1.2, 0.1, 0.1, dark, 0, 1.18, 0.05);
    for (let i = 0; i < 5; i++) box('lightbar-led', 0.16, 0.07, 0.02, this.head, -0.48 + i * 0.24, 1.18, 0.11);
    cyl('snorkel', 0.06, 1.0, dark, -0.95, 0.65, 0.45, 'y'); box('snorkel-head', 0.16, 0.12, 0.2, dark, -0.95, 1.18, 0.5);
    box('jerrycan', 0.2, 0.5, 0.35, mat('jerrycan', new Color3(0.24, 0.35, 0.16), 0.6), 0.92, 0.35, -1.7);

    for (const sx of [-0.68, 0.68]) {
      const l = new SpotLight('headlamp-beam', new Vector3(sx, 0.15, 2.2), new Vector3(0, -0.08, 1), Math.PI / 3.2, 2, scene);
      l.parent = this.root; l.intensity = 0; l.range = 70; l.diffuse = new Color3(1, 0.95, 0.82);
      this.lamps.push(l);
    }

    // Wheels: steer node -> spin node -> tyre + rim + spokes
    const tt = treadTexture();
    const tex = new RawTexture(tt.data, tt.width, tt.height, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    tex.uScale = 2; tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    const tyreM = mat('tyre', Color3.White(), 0.95); tyreM.albedoTexture = tex;
    const rimM = mat('rim', new Color3(0.17, 0.18, 0.19), 0.3, 0.85);
    const R = v.spec.wheelRadius, W = v.spec.wheelWidth;
    for (let i = 0; i < v.wheels.length; i++) {
      const steer = new TransformNode(`wheel-${i}`, scene); steer.parent = this.root;
      const spin = new TransformNode(`wheel-spin-${i}`, scene); spin.parent = steer;
      const tyre = MeshBuilder.CreateCylinder('tyre', { diameter: R * 2, height: W, tessellation: 28 }, scene); tyre.rotation.z = Math.PI / 2; tyre.parent = spin; tyre.material = tyreM;
      const rim = MeshBuilder.CreateCylinder('rim', { diameter: R * 1.24, height: W * 1.02, tessellation: 16 }, scene); rim.rotation.z = Math.PI / 2; rim.parent = spin; rim.material = rimM;
      for (let k = 0; k < 3; k++) { const sp = MeshBuilder.CreateBox('spoke', { width: W * 1.06, height: R * 1.15, depth: 0.07 }, scene); sp.rotation.x = (k / 3) * Math.PI; sp.parent = spin; sp.material = dark; this.meshes.push(sp); }
      this.meshes.push(tyre, rim);
      this.wheels.push({ steer, spin });
    }
  }

  setHeadlights(on: boolean) {
    this.headlightsOn = on;
    for (const l of this.lamps) l.intensity = on ? 60 : 0;
    this.head.emissiveIntensity = on ? 3 : 0.6;
  }

  /** In the driver's-seat camera, hide the cab shell and roof parts so the view looks out over the bonnet. */
  setCockpit(on: boolean) {
    if (on === this.cockpit) return;
    this.cockpit = on;
    for (const m of this.meshes) if (COCKPIT_HIDDEN.has(m.name)) m.isVisible = !on;
  }
  private cockpit = false;

  sync() {
    const v = this.v, b = v.body, s = v.spec;
    this.root.position.set(b.pos.x, b.pos.y, b.pos.z);
    this.root.rotationQuaternion!.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    v.wheels.forEach((w, i) => {
      const n = this.wheels[i];
      n.steer.position.set(w.mount.x, w.mount.y - (s.restLength - w.compression) + w.mudSink, w.mount.z);
      n.steer.rotation.y = -w.steer;
      n.spin.rotation.x = w.rotation;
    });
    const braking = (v.lastInput.brake > 0.1 && v.gear > 0) || (v.lastInput.throttle > 0.1 && v.gear < 0);
    this.brake.emissiveIntensity = braking ? 3 : 0.3;
  }
}
