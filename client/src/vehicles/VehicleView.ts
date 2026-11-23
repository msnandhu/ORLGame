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
import type { Vehicle, ImpactEvent } from '@orl/shared';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { treadTexture } from '../assets/proceduralTextures';

/**
 * Original procedural models of the fictional vehicles ("wagon" = Ranger TX4, "crawler" = Bramble RC2), assembled
 * from primitives in code and driven entirely by the shared vehicle simulation. The style, paint and options come
 * from the vehicle's data spec. Body panels dent where the simulation reports impacts.
 */
const COCKPIT_HIDDEN = new Set(['cab', 'rack', 'lightbar', 'lightbar-led', 'rear-glass', 'side-glass', 'jerrycan', 'cage']);
/** Meshes whose vertices are pushed in by impacts. */
const DENTABLE = new Set(['tub', 'cab', 'hood']);

export class VehicleView {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private wheels: { steer: TransformNode; spin: TransformNode }[] = [];
  private brake: PBRMaterial; private head: PBRMaterial;
  private lamps: SpotLight[] = [];
  headlightsOn = false;
  private tyreScale: TransformNode[] = [];
  private loose: { mesh: Mesh; region: 'front' | 'rear'; base: number }[] = [];

  constructor(scene: Scene, private v: Vehicle, paintOverride?: Color3) {
    const look = v.spec.look;
    const paint = paintOverride ?? new Color3(...look.paint);
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
      const e = MeshBuilder.ExtrudePolygon(n, { shape, depth: width, sideOrientation: Mesh.DEFAULTSIDE, updatable: DENTABLE.has(n) }, scene, earcut);
      // polygon plane XZ -> vehicle ZY plane, extrusion (-Y) -> across X, centred
      e.bakeTransformIntoVertices(Matrix.FromValues(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, x + width / 2, 0, 0, 1));
      e.parent = this.root; e.material = m; this.meshes.push(e); return e;
    };
    if (look.style === 'crawler') {
    // ---- short open-top crawler with a tube roll cage ----
    const cfz = v.spec.wheelFrontZ, crz = v.spec.wheelRearZ, cR = 0.66, cY = -0.5, cbot = -0.2;
    const carch = (cz: number): [number, number][] => {
      const a0 = Math.asin((cbot - cY) / cR), pts: [number, number][] = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI - a0 - (i / 12) * (Math.PI - 2 * a0); pts.push([cz + cR * Math.cos(a), cY + cR * Math.sin(a)]); }
      return pts;
    };
    ext('tub', [[-1.95, cbot], ...carch(crz), ...carch(cfz), [1.9, cbot], [1.98, 0.12], [1.9, 0.3], [0.75, 0.4], [0.62, 0.38], [-1.95, 0.36]], 1.66, body);
    ext('hood', [[1.86, 0.3], [0.78, 0.41], [0.78, 0.47], [1.7, 0.36]], 1.3, dark);
    box('frame', 1.0, 0.14, 3.6, dark, 0, -0.32, 0);
    box('skid', 0.9, 0.05, 1.4, steel, 0, -0.42, 0.4);
    const tube = (n: string, pts: [number, number, number][], r = 0.035, m = dark) => {
      const t = MeshBuilder.CreateTube(n, { path: pts.map(p => new Vector3(...p)), radius: r, tessellation: 8, cap: Mesh.CAP_ALL }, scene);
      t.parent = this.root; t.material = m; this.meshes.push(t); return t;
    };
    // roll cage: A pillars, roof hoop, B hoop, rear down-bars
    for (const sx of [-0.74, 0.74]) {
      tube('cage', [[sx, 0.4, 0.66], [sx * 0.96, 1.25, 0.05], [sx * 0.96, 1.28, -0.75], [sx, 0.36, -0.95]]);
      tube('cage', [[sx * 0.96, 1.28, -0.75], [sx, 0.38, -1.85]]);
      box('slider', 0.1, 0.08, 1.7, steel, sx * 1.2, -0.26, 0);
    }
    tube('cage', [[-0.71, 1.25, 0.05], [0.71, 1.25, 0.05]]);
    tube('cage', [[-0.71, 1.28, -0.75], [0.71, 1.28, -0.75]]);
    tube('cage', [[-0.71, 1.27, -0.35], [0.71, 1.27, -0.35]], 0.025);
    // windscreen frame (no glass), dash, seats, steering wheel
    const ws = box('windshield', 1.3, 0.42, 0.02, glass, 0, 0.62, 0.55, -0.35); ws.visibility = 0.6;
    box('dash', 1.4, 0.18, 0.25, dark, 0, 0.42, 0.42);
    for (const sx of [-0.38, 0.38]) { box('seat', 0.46, 0.12, 0.5, dark, sx, 0.2, -0.4); box('seat', 0.46, 0.6, 0.1, dark, sx, 0.5, -0.66, -0.15); }
    const sw = MeshBuilder.CreateTorus('steering', { diameter: 0.36, thickness: 0.035, tessellation: 20 }, scene);
    sw.parent = this.root; sw.position.set(0.38, 0.62, 0.22); sw.rotation.x = -1.1; sw.material = dark; this.meshes.push(sw);
    // tube bumpers, winch, round lamps, rear-mounted spare lying on the deck
    this.loose.push({ mesh: tube('bumper-f', [[-0.95, -0.12, 2.02], [0.95, -0.12, 2.02]], 0.06, steel), region: 'front', base: 0 });
    tube('bumper-f-hoop', [[-0.5, -0.12, 2.02], [-0.4, 0.3, 2.1], [0.4, 0.3, 2.1], [0.5, -0.12, 2.02]], 0.04, steel);
    cyl('winch', 0.1, 0.55, dark, 0, 0.0, 2.08, 'x');
    for (const sx of [-0.62, 0.62]) { cyl('headlight', 0.11, 0.05, this.head, sx, 0.28, 1.95, 'z'); cyl('bezel', 0.14, 0.08, dark, sx, 0.28, 1.93, 'z'); }
    this.loose.push({ mesh: tube('bumper-r', [[-0.95, -0.1, -2.0], [0.95, -0.1, -2.0]], 0.06, steel), region: 'rear', base: 0 });
    for (const sx of [-0.78, 0.78]) box('taillight', 0.12, 0.12, 0.04, this.brake, sx, 0.2, -1.97);
    const spare = cyl('spare', 0.45, 0.3, dark, 0, 0.62, -1.42, 'y'); spare.rotation.x = 0.35;
    box('lightbar', 1.0, 0.08, 0.08, dark, 0, 1.36, 0.0);
    for (let i = 0; i < 4; i++) box('lightbar-led', 0.16, 0.05, 0.02, this.head, -0.36 + i * 0.24, 1.36, 0.05);
    box('fender-f', 0.3, 0.03, 0.8, mat('accent', new Color3(...look.accent), 0.6), 0.86, 0.33, cfz);
    box('fender-f', 0.3, 0.03, 0.8, mat('accent2', new Color3(...look.accent), 0.6), -0.86, 0.33, cfz);
    if (look.snorkel) { cyl('snorkel', 0.06, 0.95, dark, -0.92, 0.75, 0.6, 'y'); }
    } else {
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
    this.loose.push({ mesh: box('bumper-f', 1.94, 0.2, 0.26, steel, 0, -0.28, 2.26), region: 'front', base: 0 });
    cyl('bullbar', 0.045, 1.34, steel, 0, 0.36, 2.42, 'x');
    for (const sx of [-0.58, 0.58]) cyl('bullbar-post', 0.045, 0.66, steel, sx, 0.04, 2.42, 'y');
    cyl('winch', 0.1, 0.6, dark, 0, -0.2, 2.42, 'x');
    for (const sx of [-0.72, 0.72]) { cyl('headlight', 0.12, 0.05, this.head, sx, 0.18, 2.2, 'z'); cyl('bezel', 0.15, 0.04, steel, sx, 0.18, 2.18, 'z'); }
    this.loose.push({ mesh: box('bumper-r', 1.94, 0.2, 0.22, steel, 0, -0.28, -2.3), region: 'rear', base: 0 });
    for (const sx of [-0.8, 0.8]) box('taillight', 0.14, 0.28, 0.04, this.brake, sx, 0.14, -2.24);
    cyl('spare', 0.4, 0.27, dark, 0, 0.45, -2.42, 'z'); cyl('spare-hub', 0.2, 0.28, steel, 0, 0.45, -2.42, 'z');
    box('rack', 1.5, 0.04, 1.8, dark, 0, 1.2, -1.0);
    for (const sx of [-0.74, 0.74]) box('rack', 0.04, 0.1, 1.8, dark, sx, 1.16, -1.0);
    box('lightbar', 1.2, 0.09, 0.09, dark, 0, 1.18, -0.04);
    for (let i = 0; i < 5; i++) box('lightbar-led', 0.16, 0.06, 0.02, this.head, -0.48 + i * 0.24, 1.18, 0.01);
    if (look.snorkel) { cyl('snorkel', 0.06, 0.95, dark, -0.95, 0.62, 0.5, 'y'); box('snorkel-head', 0.16, 0.12, 0.22, dark, -0.95, 1.12, 0.52); }
    box('jerrycan', 0.2, 0.46, 0.34, mat('jerrycan', new Color3(0.24, 0.35, 0.16), 0.6), 0.6, 1.45, -1.6);
    box('hood-scoop', 0.6, 0.05, 0.5, dark, 0, 0.46, 1.25);

    }

    for (const sx of [-0.68, 0.68]) {
      const l = new SpotLight('headlamp-beam', new Vector3(sx, look.style === 'crawler' ? 0.28 : 0.15, v.spec.halfExtents[2] - 0.1), new Vector3(0, -0.08, 1), Math.PI / 3.2, 2, scene);
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
      const squash = new TransformNode(`wheel-tyre-${i}`, scene); squash.parent = steer; this.tyreScale.push(squash);
      const spin = new TransformNode(`wheel-spin-${i}`, scene); spin.parent = squash;
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
    this.snapshot();
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
    // flat tyres run smaller (the sim lowers the corner by the same amount)
    this.tyreScale.forEach((n, i) => { const k = v.wheelRadiusOf(i) / s.wheelRadius; n.scaling.set(1, k, k); });
    // hanging bumpers
    const c = v.condition.body;
    for (const l of this.loose) { const d = c[l.region]; l.mesh.rotation.z = d > 0.5 ? (d - 0.5) * 0.25 * (l.region === 'front' ? 1 : -1) : 0; }
  }

  /** Push body panel vertices in around an impact (vehicle-local point). */
  dent(e: ImpactEvent) {
    if (e.part === 'suspension') return;
    const r = 0.55 + e.severity * 0.5, depth = 0.05 + e.severity * 0.16;
    const p = e.point;
    const c = new Vector3(0, this.v.spec.hullOffsetY, 0);
    for (const m of this.meshes) {
      if (!DENTABLE.has(m.name)) continue;
      const pos = m.getVerticesData(VertexBuffer.PositionKind);
      if (!pos) continue;
      let changed = false;
      for (let i = 0; i < pos.length; i += 3) {
        const dx = pos[i] - p.x, dy = pos[i + 1] - p.y, dz = pos[i + 2] - p.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > r) continue;
        const f = (1 - d / r) ** 2 * depth;
        // push towards the body centre line, a little downward: a crumple, not a shrink
        const tx = c.x - pos[i], ty = c.y - pos[i + 1], tz = c.z - pos[i + 2], tl = Math.hypot(tx, ty, tz) || 1;
        pos[i] += (tx / tl) * f; pos[i + 1] += (ty / tl) * f - f * 0.2; pos[i + 2] += (tz / tl) * f;
        changed = true;
      }
      if (!changed) continue;
      m.updateVerticesData(VertexBuffer.PositionKind, pos);
      const idx = m.getIndices(), nrm = m.getVerticesData(VertexBuffer.NormalKind);
      if (idx && nrm) { VertexData.ComputeNormals(pos, idx, nrm); m.updateVerticesData(VertexBuffer.NormalKind, nrm); }
    }
  }

  /** Workshop repair: panels back to their original shape. */
  undent() { for (const m of this.meshes) if (DENTABLE.has(m.name) && this.original.has(m)) { m.updateVerticesData(VertexBuffer.PositionKind, this.original.get(m)!.slice()); const idx = m.getIndices(), nrm = m.getVerticesData(VertexBuffer.NormalKind); if (idx && nrm) { VertexData.ComputeNormals(this.original.get(m)!, idx, nrm); m.updateVerticesData(VertexBuffer.NormalKind, nrm); } } }
  private original = new Map<Mesh, Float32Array | number[]>();
  /** Remember undamaged panel shapes (call once after construction). */
  snapshot() { for (const m of this.meshes) if (DENTABLE.has(m.name)) { const p = m.getVerticesData(VertexBuffer.PositionKind); if (p) this.original.set(m, Array.from(p)); } }
}
