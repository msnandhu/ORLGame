import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import earcut from 'earcut';
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
const COCKPIT_HIDDEN = new Set(['cab', 'rack', 'lightbar', 'lightbar-led', 'rear-glass', 'side-glass', 'jerrycan']);

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
    const steel = mat('steel', new Color3(0.42, 0.43, 0.45), 0.42, 0.7);
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
    // ---- body: side profiles extruded across the width (original design, built in code) ----
    const ext = (n: string, profile: [number, number][], width: number, m: PBRMaterial, x = 0) => {
      const shape = profile.map(([z, y]) => new Vector3(z, 0, y));
      const e = MeshBuilder.ExtrudePolygon(n, { shape, depth: width, sideOrientation: Mesh.DEFAULTSIDE }, scene, earcut);
      // polygon plane XZ -> vehicle ZY plane, extrusion (-Y) -> across X, centred
      e.bakeTransformIntoVertices(Matrix.FromValues(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, x + width / 2, 0, 0, 1));
      e.parent = this.root; e.material = m; this.meshes.push(e); return e;
    };
    const fz = v.spec.wheelFrontZ, rz = v.spec.wheelRearZ, archR = 0.56, archY = -0.45, bot = -0.3;
    const arch = (cz: number): [number, number][] => {
      const a0 = Math.asin((bot - archY) / archR), pts: [number, number][] = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI - a0 - (i / 12) * (Math.PI - 2 * a0); pts.push([cz + archR * Math.cos(a), archY + archR * Math.sin(a)]); }
      return pts;
    };
    const lower: [number, number][] = [[-2.22, bot], ...arch(rz), ...arch(fz), [2.16, bot], [2.22, 0.08], [2.14, 0.34], [1.9, 0.4], [0.5, 0.47], [-2.2, 0.4], [-2.26, 0.1]];
    ext('tub', lower, 1.8, body);
    ext('cab', [[0.52, 0.4], [-0.08, 1.1], [-1.96, 1.12], [-2.12, 0.38]], 1.68, body);
    // windows: thin glass panels just proud of the cab shell
    const sideWin: [number, number][] = [[0.36, 0.55], [-0.05, 1.02], [-0.9, 1.03], [-0.9, 0.58]];
    const sideWin2: [number, number][] = [[-1.0, 0.58], [-1.0, 1.03], [-1.88, 1.04], [-1.95, 0.6]].reverse() as [number, number][];
    for (const sx of [-1, 1]) {
      ext('side-glass', sideWin, 0.02, glass, sx * 0.85 - 0.01);
      ext('side-glass', sideWin2, 0.02, glass, sx * 0.85 - 0.01);
    }
    const ws = box('windshield', 1.5, 0.74, 0.02, glass, 0, 0.77, 0.23, -0.79);
    box('rear-glass', 1.42, 0.5, 0.02, glass, 0, 0.8, -2.11, 0.1);
    void ws;
    box('frame', 1.1, 0.16, 4.1, dark, 0, -0.42, 0);
    box('skid', 1.0, 0.05, 1.1, steel, 0, -0.5, 1.2);
    box('rocker', 1.84, 0.12, 2.0, dark, 0, -0.26, 0.02);
    box('beltline', 1.83, 0.035, 4.3, dark, 0, 0.36, -0.02);
    // wheel-arch flares as tubes following the arch
    for (const sx of [-1, 1]) for (const cz of [fz, rz]) {
      const path = arch(cz).map(([z, y]) => new Vector3(sx * 0.91, y + 0.01, z));
      const t = MeshBuilder.CreateTube('flare', { path, radius: 0.06, tessellation: 8, cap: Mesh.CAP_ALL }, scene);
      t.parent = this.root; t.material = dark; this.meshes.push(t);
    }
    for (const sx of [-1, 1]) {
      box('mirror-arm', 0.16, 0.03, 0.03, dark, sx * 0.92, 0.6, 0.3);
      box('mirror', 0.05, 0.16, 0.22, dark, sx * 1.0, 0.66, 0.28);
      box('step', 0.18, 0.05, 1.6, steel, sx * 0.97, -0.37, -0.05);
      box('door-line', 0.01, 0.6, 0.01, dark, sx * 0.902, 0.1, -0.95);
      box('handle', 0.02, 0.03, 0.14, steel, sx * 0.91, 0.28, -0.75);
    }
    box('grille', 1.24, 0.3, 0.05, dark, 0, 0.16, 2.2);
    for (let i = 0; i < 5; i++) box('grille-bar', 1.18, 0.025, 0.02, steel, 0, 0.06 + i * 0.05, 2.225);
    box('bumper-f', 1.94, 0.2, 0.26, steel, 0, -0.28, 2.26);
    cyl('bullbar', 0.045, 1.34, steel, 0, 0.36, 2.42, 'x');
    for (const sx of [-0.58, 0.58]) cyl('bullbar-post', 0.045, 0.66, steel, sx, 0.04, 2.42, 'y');
    cyl('winch', 0.1, 0.6, dark, 0, -0.2, 2.42, 'x');
    for (const sx of [-0.72, 0.72]) { cyl('headlight', 0.12, 0.05, this.head, sx, 0.18, 2.2, 'z'); cyl('bezel', 0.15, 0.04, steel, sx, 0.18, 2.18, 'z'); }
    box('bumper-r', 1.94, 0.2, 0.22, steel, 0, -0.28, -2.3);
    for (const sx of [-0.8, 0.8]) box('taillight', 0.14, 0.28, 0.04, this.brake, sx, 0.14, -2.24);
    cyl('spare', 0.4, 0.27, dark, 0, 0.45, -2.42, 'z'); cyl('spare-hub', 0.2, 0.28, steel, 0, 0.45, -2.42, 'z');
    box('rack', 1.5, 0.04, 1.8, dark, 0, 1.2, -1.0);
    for (const sx of [-0.74, 0.74]) box('rack', 0.04, 0.1, 1.8, dark, sx, 1.16, -1.0);
    box('lightbar', 1.2, 0.09, 0.09, dark, 0, 1.18, -0.04);
    for (let i = 0; i < 5; i++) box('lightbar-led', 0.16, 0.06, 0.02, this.head, -0.48 + i * 0.24, 1.18, 0.01);
    cyl('snorkel', 0.06, 0.95, dark, -0.95, 0.62, 0.5, 'y'); box('snorkel-head', 0.16, 0.12, 0.22, dark, -0.95, 1.12, 0.52);
    box('jerrycan', 0.2, 0.46, 0.34, mat('jerrycan', new Color3(0.24, 0.35, 0.16), 0.6), 0.6, 1.45, -1.6);
    box('hood-scoop', 0.6, 0.05, 0.5, dark, 0, 0.46, 1.25);

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
      const prof = [[R * 0.62, -W / 2], [R - 0.06, -W / 2], [R - 0.01, -W / 2 + 0.05], [R, 0], [R - 0.01, W / 2 - 0.05], [R - 0.06, W / 2], [R * 0.62, W / 2]].map(([r, y]) => new Vector3(r, y, 0));
      const tyre = MeshBuilder.CreateLathe('tyre', { shape: prof, tessellation: 36, closed: false }, scene); tyre.rotation.z = Math.PI / 2; tyre.parent = spin; tyre.material = tyreM;
      const outer = v.wheels[i].mount.x > 0 ? 1 : -1;
      const rim = MeshBuilder.CreateCylinder('rim', { diameter: R * 1.26, height: W * 0.8, tessellation: 24 }, scene); rim.rotation.z = Math.PI / 2; rim.parent = spin; rim.material = rimM;
      const hub = MeshBuilder.CreateCylinder('hub', { diameter: R * 0.32, height: W * 0.9, tessellation: 12 }, scene); hub.rotation.z = Math.PI / 2; hub.parent = spin; hub.material = steel; hub.position.x = outer * 0.02;
      for (let k = 0; k < 6; k++) { const sp = MeshBuilder.CreateBox('spoke', { width: 0.05, height: R * 1.18, depth: 0.07 }, scene); sp.rotation.x = (k / 6) * Math.PI; sp.position.x = outer * W * 0.38; sp.parent = spin; sp.material = steel; this.meshes.push(sp); }
      this.meshes.push(hub);
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
