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
import { VEHICLES, type Vehicle, type ImpactEvent, type VehicleSpec } from '@orl/shared';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { treadTexture } from '../assets/proceduralTextures';
import { Kit, carMats } from './carKit';
import { buildDesign } from './designs';

/**
 * Original procedural models of the fictional vehicles, each inspired by a real-world type of car (see designs.ts):
 * lofted body panels, a glasshouse with pillars and tinted glass, lamps, grilles, trim and multi-part wheels with
 * brakes, all built in code and driven entirely by the shared vehicle simulation. Body panels dent where the
 * simulation reports impacts.
 */
const COCKPIT_HIDDEN = new Set(['cab', 'rack', 'lightbar', 'lightbar-led', 'rear-glass', 'side-glass', 'jerrycan', 'cage', 'windshield', 'ws-frame', 'seal', 'wing', 'wing-plate', 'wing-post', 'spoiler', 'spoiler-side', 'roof-scoop', 'snorkel', 'snorkel-head']);
/** Meshes whose vertices are pushed in by impacts. */
const DENTABLE = new Set(['tub', 'tub-int', 'cab', 'roof', 'hood']);

/** Per-car finish: paint type, wheel and brake caliper colours. */
const FINISH: Record<string, { metallic: number; rim: [number, number, number]; rimMetal: number; caliper: [number, number, number] }> = {
  'ranger-tx4': { metallic: 0.1, rim: [0.16, 0.16, 0.17], rimMetal: 0.5, caliper: [0.2, 0.2, 0.2] },
  'bramble-rc2': { metallic: 0.1, rim: [0.05, 0.05, 0.055], rimMetal: 0.4, caliper: [0.2, 0.2, 0.2] },
  'vanta-gt': { metallic: 0.35, rim: [0.05, 0.05, 0.055], rimMetal: 0.7, caliper: [0.95, 0.75, 0.05] },
  'strix-r2': { metallic: 0.2, rim: [0.72, 0.55, 0.18], rimMetal: 0.9, caliper: [0.8, 0.06, 0.04] },
  pella: { metallic: 0.6, rim: [0.68, 0.69, 0.7], rimMetal: 0.9, caliper: [0.25, 0.25, 0.26] },
  corvan: { metallic: 0.65, rim: [0.62, 0.63, 0.64], rimMetal: 0.9, caliper: [0.25, 0.25, 0.26] },
  halcyon: { metallic: 0.7, rim: [0.82, 0.83, 0.85], rimMetal: 1, caliper: [0.12, 0.12, 0.13] },
  'solenne-gt': { metallic: 0.7, rim: [0.16, 0.165, 0.17], rimMetal: 0.9, caliper: [0.7, 0.05, 0.05] },
};

type P2 = [number, number];
const rot2 = (pts: P2[], a: number): P2[] => pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
/** A tapered spoke from the hub (radius r0, angle th) to the rim (r1, th + sweep). */
function spoke(th: number, r0: number, r1: number, w0: number, w1: number, sweep = 0): P2[] {
  const c0: P2 = [Math.cos(th) * r0, Math.sin(th) * r0], c1: P2 = [Math.cos(th + sweep) * r1, Math.sin(th + sweep) * r1];
  const dx = c1[0] - c0[0], dy = c1[1] - c0[1], l = Math.hypot(dx, dy) || 1, px = -dy / l, py = dx / l;
  return [[c0[0] - px * w0 / 2, c0[1] - py * w0 / 2], [c1[0] - px * w1 / 2, c1[1] - py * w1 / 2], [c1[0] + px * w1 / 2, c1[1] + py * w1 / 2], [c0[0] + px * w0 / 2, c0[1] + py * w0 / 2]];
}

export class VehicleView {
  readonly root: TransformNode;
  meshes: Mesh[] = [];
  private wheels: { steer: TransformNode; spin: TransformNode }[] = [];
  private brake: PBRMaterial; private head: PBRMaterial; private reverse: PBRMaterial;
  private lamps: SpotLight[] = [];
  headlightsOn = false;
  private tyreScale: TransformNode[] = [];
  private loose: { mesh: Mesh; region: 'front' | 'rear'; base: number }[] = [];
  private paints: PBRMaterial[] = [];
  /** materials made for this car only (the shared ones belong to the scene) */
  private own: PBRMaterial[] = [];
  /** lite: no headlight beams and simpler parts, merged into a few draw calls (AI traffic and far parked cars) */
  constructor(scene: Scene, private v: Vehicle, paintOverride?: Color3, lite = false) {
    const look = v.spec.look, sp = v.spec;
    const paint = paintOverride ?? new Color3(...look.paint);
    this.root = new TransformNode('vehicle', scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    const fin = FINISH[sp.id] ?? { metallic: 0.5, rim: [0.6, 0.6, 0.62], rimMetal: 0.9, caliper: [0.3, 0.3, 0.3] };
    const m = carMats(scene, paint, new Color3(...look.accent), { metallic: fin.metallic, rim: new Color3(...(look.rimColor ?? fin.rim)), rimMetal: look.rimColor ? 0.7 : fin.rimMetal, caliper: new Color3(...fin.caliper) });
    this.own.push(m.paint, m.accent, m.head, m.drl, m.brake, m.reverse, m.caliper, m.rim);
    // paint shop finishes
    switch (look.finish) {
      case 'gloss': m.paint.metallic = 0; m.paint.roughness = 0.28; break;
      case 'metallic': m.paint.metallic = 0.7; m.paint.roughness = 0.3; break;
      case 'pearl': m.paint.metallic = 0.45; m.paint.roughness = 0.22; m.paint.sheen.isEnabled = true; m.paint.sheen.intensity = 0.6; m.paint.sheen.color = new Color3(0.9, 0.92, 1); break;
      case 'matte': m.paint.metallic = 0.05; m.paint.roughness = 0.72; m.paint.clearCoat.isEnabled = false; break;
    }
    this.paints.push(m.paint);
    this.head = m.head; this.brake = m.brake; this.reverse = m.reverse;
    const kit = new Kit(scene, this.root, m, lite);
    // the body is drawn from the factory geometry (a lift kit raises the body off the wheels, it doesn't reshape it);
    // the wheels and everything the simulation moves use the vehicle as built
    const factory = VEHICLES.find(f => f.id === sp.id);
    const geo: VehicleSpec = factory ? { ...factory, look: sp.look, tyre: sp.tyre, drivetrain: sp.drivetrain } : sp;
    const info = buildDesign(kit, geo);
    const fitRim = look.fit?.rims;
    if (fitRim && fitRim !== 'stock') info.rim = fitRim as typeof info.rim;
    this.meshes = kit.meshes;
    this.loose = kit.loose;

    if (!lite) for (const [bx, by, bz] of info.beams) {
      const l = new SpotLight('headlamp-beam', new Vector3(bx, by, bz), new Vector3(0, -0.08, 1), Math.PI / 3.2, 2, scene);
      l.parent = this.root; l.intensity = 60; l.range = 70; l.diffuse = new Color3(1, 0.95, 0.82);
      l.setEnabled(false); // disabled lights cost nothing in the shaders
      this.lamps.push(l);
    }
    // garage driving lamps: a long, narrower beam from the light bar and pods
    if (!lite) for (const [bx, by, bz] of info.extraBeams ?? []) {
      const l = new SpotLight('driving-lamp', new Vector3(bx, by, bz), new Vector3(0, -0.05, 1), Math.PI / 4.5, 4, scene);
      l.parent = this.root; l.intensity = 90; l.range = 140; l.diffuse = new Color3(0.95, 0.97, 1);
      l.setEnabled(false);
      this.lamps.push(l);
    }

    // ---- wheels: steer node -> tyre squash node -> spin node; tyre, rim barrel, spokes, brakes ----
    const tt = treadTexture();
    const tex = new RawTexture(tt.data, tt.width, tt.height, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    tex.uScale = 2; tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    const tyreM = new PBRMaterial('tyre', scene); this.own.push(tyreM); tyreM.albedoColor = Color3.White(); tyreM.roughness = 0.92; tyreM.metallic = 0; tyreM.albedoTexture = tex;
    const R = sp.wheelRadius, W = sp.wheelWidth, offroad = look.style === 'wagon' || look.style === 'crawler';
    const rimR = R * info.rimF, tess = lite ? 18 : 40;
    for (let i = 0; i < v.wheels.length; i++) {
      const steer = new TransformNode(`wheel-${i}`, scene); steer.parent = this.root;
      const squash = new TransformNode(`wheel-tyre-${i}`, scene); squash.parent = steer; this.tyreScale.push(squash);
      const spin = new TransformNode(`wheel-spin-${i}`, scene); spin.parent = squash;
      const outer = v.wheels[i].mount.x > 0 ? 1 : -1;
      const parts: Mesh[] = [];
      const lathe = (n: string, prof: [number, number][], mat: PBRMaterial) => {
        // profile in (radius, axle offset towards the outside); the lathe runs round local Y, which then lies along X
        const l = MeshBuilder.CreateLathe(n, { shape: prof.map(([r, y]) => new Vector3(r, -y * outer, 0)), tessellation: tess, closed: false, sideOrientation: Mesh.DOUBLESIDE }, scene);
        l.rotation.z = Math.PI / 2; l.parent = spin; l.material = mat; parts.push(l); return l;
      };
      // tyre: rounded sidewalls, squarer shoulders on the off-road tyres
      const sh = offroad ? 0.035 : 0.05, hw = W / 2;
      lathe('tyre', [[rimR + 0.01, -hw * 0.92], [R - sh - 0.03, -hw], [R - sh * 0.4, -hw + 0.012], [R, -hw + sh * 0.6], [R, hw - sh * 0.6], [R - sh * 0.4, hw - 0.012], [R - sh - 0.03, hw], [rimR + 0.01, hw * 0.92]], tyreM);
      // rim barrel and polished lip
      const face = hw * 0.78, dish = offroad ? 0.06 : 0.035;
      lathe('rim', [[rimR - 0.02, -hw * 0.85], [rimR, -hw * 0.8], [rimR, face - 0.015], [rimR + 0.014, face], [rimR + 0.008, face + 0.012], [rimR - 0.01, face + 0.008], [rimR - 0.03, face - dish * 0.5]], m.rim);
      // the wheel face: spokes in the wheel plane, then turned to face outwards
      const faceParts: [P2[], PBRMaterial, number][] = [];
      const r0 = rimR * 0.24, r1 = rimR - 0.02;
      const add = (pts: P2[], mat: PBRMaterial, depth: number) => faceParts.push([pts, mat, depth]);
      switch (info.rim) {
        case 'five': for (let k = 0; k < 5; k++) for (const o of [-0.13, 0.13]) add(spoke((k / 5) * Math.PI * 2 + o, r0, r1, 0.045, 0.03, o * 0.3), m.rim, 0.03); break;
        case 'multi': for (let k = 0; k < 10; k++) add(spoke((k / 10) * Math.PI * 2, r0, r1, 0.04, 0.026), m.rim, 0.03); break;
        case 'split': for (let k = 0; k < 6; k++) { const th = (k / 6) * Math.PI * 2; add(spoke(th, r0, r1 * 0.55, 0.06, 0.05), m.rim, 0.035); for (const o of [-0.16, 0.16]) add(spoke(th + o * 0.3, r1 * 0.5, r1, 0.035, 0.03, o), m.rim, 0.03); } break;
        case 'mesh': for (let k = 0; k < 10; k++) for (const o of [-0.35, 0.35]) add(spoke((k / 10) * Math.PI * 2, r0, r1, 0.022, 0.018, o), m.rim, 0.025); break;
        case 'turbine': for (let k = 0; k < 12; k++) add(spoke((k / 12) * Math.PI * 2, r0, r1, 0.05, 0.04, 0.32), m.rim, 0.025); break;
        case 'steel': {
          const n = 24, disc: P2[] = Array.from({ length: n }, (_, k) => [Math.cos((k / n) * Math.PI * 2) * r1, Math.sin((k / n) * Math.PI * 2) * r1]);
          add(disc, m.rim, 0.02);
          if (!lite) for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, c: P2 = [Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62]; add(rot2(Array.from({ length: 10 }, (_, q) => [Math.cos((q / 10) * Math.PI * 2) * 0.035, Math.sin((q / 10) * Math.PI * 2) * 0.035] as P2), 0).map(([x, y]) => [x + c[0], y + c[1]] as P2), m.rubber, 0.03); }
          break;
        }
        case 'beadlock': for (let k = 0; k < 8; k++) add(spoke((k / 8) * Math.PI * 2, r0, r1, 0.07, 0.06), m.rim, 0.035); break;
      }
      const centre: P2[] = Array.from({ length: 12 }, (_, k) => [Math.cos((k / 12) * Math.PI * 2) * r0 * 1.15, Math.sin((k / 12) * Math.PI * 2) * r0 * 1.15]);
      add(centre, info.centreLock ? m.accent : m.rim, 0.04);
      for (const [pts, mat, depth] of faceParts) {
        const sm = MeshBuilder.ExtrudePolygon('spoke', { shape: pts.map(([x, y]) => new Vector3(-x, 0, y)), depth, sideOrientation: Mesh.DOUBLESIDE }, scene, earcut);
        // shape plane (XZ, extruded down Y) -> wheel plane (ZY), extrusion along the axle, outer face at `face`
        sm.bakeTransformIntoVertices(Matrix.FromValues(0, 0, -1, 0, outer, 0, 0, 0, 0, 1, 0, 0, outer * (face - dish * 0.4), 0, 0, 1));
        sm.parent = spin; sm.material = mat; parts.push(sm);
      }
      if (!lite) {
        // lug nuts or a centre-lock nut
        if (info.centreLock) { const n = MeshBuilder.CreateCylinder('nut', { diameter: 0.07, height: 0.05, tessellation: 6 }, scene); n.rotation.z = Math.PI / 2; n.position.x = outer * (face + 0.005); n.parent = spin; n.material = m.steel; parts.push(n); }
        else for (let k = 0; k < (offroad ? 6 : 5); k++) {
          const a = (k / (offroad ? 6 : 5)) * Math.PI * 2, n = MeshBuilder.CreateCylinder('nut', { diameter: 0.022, height: 0.03, tessellation: 6 }, scene);
          n.rotation.z = Math.PI / 2; n.position.set(outer * (face - dish * 0.2), Math.cos(a) * r0 * 0.7, Math.sin(a) * r0 * 0.7); n.parent = spin; n.material = m.chrome; parts.push(n);
        }
        if (info.rim === 'beadlock') { const t = MeshBuilder.CreateTorus('beadlock', { diameter: rimR * 2 + 0.01, thickness: 0.03, tessellation: 32 }, scene); t.rotation.z = Math.PI / 2; t.position.x = outer * (face + 0.005); t.parent = spin; t.material = m.accent; parts.push(t); }
      }
      // brakes: a disc that turns with the wheel and a caliper that does not
      if (info.brakes) {
        const dR = rimR * 0.82, disc = MeshBuilder.CreateCylinder('disc', { diameter: dR * 2, height: 0.028, tessellation: lite ? 16 : 28 }, scene);
        disc.rotation.z = Math.PI / 2; disc.position.x = outer * (face - 0.09); disc.parent = spin; disc.material = m.disc; parts.push(disc);
        const cal = MeshBuilder.CreateBox('caliper', { width: 0.07, height: 0.16, depth: 0.12 }, scene);
        cal.position.set(outer * (face - 0.075), dR * 0.68, (i < 2 ? -1 : 1) * dR * 0.42); cal.rotation.x = (i < 2 ? 1 : -1) * 0.55;
        cal.parent = squash; cal.material = m.caliper; this.meshes.push(cal);
      }
      this.meshes.push(...parts);
      this.wheels.push({ steer, spin });
    }
    this.snapshot();
    this.mergeStatic(lite);
  }

  /** Combine the many small static parts by material: a handful of draw calls per car instead of hundreds. */
  private mergeStatic(lite: boolean) {
    const keep = (mm: Mesh) => !lite && (DENTABLE.has(mm.name) || COCKPIT_HIDDEN.has(mm.name) || this.loose.some(l => l.mesh === mm));
    const groups = new Map<TransformNode, Map<unknown, Mesh[]>>();
    const rest: Mesh[] = [];
    for (const mm of this.meshes) {
      const parent = mm.parent as TransformNode | null;
      if (!parent || keep(mm)) { rest.push(mm); continue; }
      let g = groups.get(parent); if (!g) { g = new Map(); groups.set(parent, g); }
      let l = g.get(mm.material); if (!l) { l = []; g.set(mm.material, l); }
      l.push(mm);
    }
    const out: Mesh[] = [...rest];
    for (const [parent, byMat] of groups) for (const [, list] of byMat) {
      if (list.length === 1) { out.push(list[0]); continue; }
      const merged = Mesh.MergeMeshes(list, true, true);
      if (merged) { merged.parent = parent; merged.name = 'merged'; out.push(merged); }
    }
    this.meshes = out;
    if (lite) this.loose.length = 0;
  }

  /** Remove the car from the scene (a garage refit builds a new view). */
  dispose() {
    for (const l of this.lamps) l.dispose();
    this.root.dispose(false, false);
    for (const mat of this.own) mat.dispose(true, true);
  }

  /** Repaint (traffic cars are reused for different cars). */
  setPaint(c: Color3) { for (const p of this.paints) p.albedoColor.copyFrom(c); }

  setHeadlights(on: boolean) {
    this.headlightsOn = on;
    for (const l of this.lamps) l.setEnabled(on);
    this.head.emissiveIntensity = on ? 3 : 0.35;
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
    this.brake.emissiveIntensity = braking ? 3 : this.headlightsOn ? 0.9 : 0.35;
    this.reverse.emissiveIntensity = v.gear < 0 ? 2 : 0;
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
