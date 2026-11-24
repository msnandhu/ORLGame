import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Bone } from '@babylonjs/core/Bones/bone';
import {
  DEFAULT_MALE, statureOf,
  type Character, type CharacterAppearance, type LocomotionState,
} from '@orl/shared';
import { Builder, Geo, mulc } from './geo';
import { buildModel, rigLayout, BONES, THIGH, SHIN, FOOT_Y, type ModelInfo, type RigLayout } from './model';
import {
  fabricNormal, leatherNormal, skinNormal, hairNormal, hairAlbedo, treadNormal, canvasAlbedo, leatherAlbedo, camoAlbedo,
  bandanaAlbedo, plaidAlbedo, patchAlbedo, faceAlbedo,
} from './textures';

/** Reference figure is 1.75 m tall; the whole skeleton scales to the appearance's stature. */
const REF_STATURE = 1.75;
/** hip height used by the airborne/climbing poses */
const HIP_Y = 0.92;

/** Anatomical pose: angles in radians, positive = the natural direction (flexion forward, bend, out to the side). */
interface Pose {
  hipsY: number;          // NaN = plant the feet automatically
  lean: number; headPitch: number; twist: number;
  hip: [number, number]; knee: [number, number];
  shoulder: [number, number]; abduct: [number, number]; elbow: [number, number];
  footFlat: number;
  /** stance width: thighs out to the side (radians) */
  spread: number;
  /** vertical bounce of the stride, metres */
  bob: number;
}
const zero = (): Pose => ({ hipsY: 0, lean: 0, headPitch: 0, twist: 0, hip: [0, 0], knee: [0, 0], shoulder: [0, 0], abduct: [0, 0], elbow: [0, 0], footFlat: 0, spread: 0, bob: 0 });
export type PoseName = 'idle' | 'walk' | 'run' | 'sprint' | 'crouch' | 'crouch-walk' | 'jump' | 'fall' | 'land' | 'seated' | 'climb' | 'talk';
const POSES: PoseName[] = ['idle', 'walk', 'run', 'sprint', 'crouch', 'crouch-walk', 'jump', 'fall', 'land', 'seated', 'climb', 'talk'];

/** Options for one frame of animation. Without `mode` the pose follows the character's locomotion state. */
export interface SyncOptions {
  mode?: 'seated' | 'climb' | 'talk';
  /** steering input for the seated pose (-1..1) */
  steer?: number;
  /** position/heading in the parent's space when attached to a vehicle */
  local?: { x: number; y: number; z: number; yaw: number };
}

/** LOD levels: tessellation quality, single merged material, switch-out distance (m). */
const LODS = [{ q: 1, merged: false, until: 14 }, { q: 0.5, merged: true, until: 45 }, { q: 0.28, merged: true, until: 260 }];
/** total vertex counts per LOD of the last built character (for the performance overlay and tests) */
export const characterStats = { vertices: [0, 0, 0], drawCalls: [0, 0, 0] };

// ---------------- materials ----------------
const matCache = new WeakMap<Scene, Map<string, PBRMaterial>>();
function material(scene: Scene, key: string, info: ModelInfo): PBRMaterial {
  let cache = matCache.get(scene);
  if (!cache) { cache = new Map(); matCache.set(scene, cache); }
  const ck = key === 'skin' ? `skin|${info.faceKey}` : key;
  let m = cache.get(ck);
  if (m) return m;
  m = new PBRMaterial(`char-${ck}`, scene);
  m.albedoColor = Color3.White(); m.metallic = 0; m.roughness = 0.85;
  const fabric = fabricNormal(scene); fabric.uScale = fabric.vScale = 9;
  const bumpLevel = (t: PBRMaterial, level: number) => { if (t.bumpTexture) t.bumpTexture.level = level; };
  switch (key) {
    case 'skin': {
      m.albedoTexture = faceAlbedo(scene, info.faceKey, { skin: info.skinHex, lips: info.lipsHex, brow: info.hairHex, iris: info.irisHex, beard: info.beardShadow, female: info.female, toUv: info.toUv, fromUv: info.fromUv, beardMask: info.beardMask });
      const n = skinNormal(scene); n.uScale = 6; n.vScale = 3;
      m.bumpTexture = n; bumpLevel(m, 0.35); m.roughness = 0.55;
      // a touch of sheen reads as the soft highlight of skin
      m.sheen.isEnabled = true; m.sheen.intensity = 0.06; m.sheen.color = new Color3(1, 0.8, 0.75);
      break;
    }
    case 'cloth': m.bumpTexture = fabric; bumpLevel(m, 0.55); m.roughness = 0.92; break;
    case 'canvas': { const t = canvasAlbedo(scene); t.uScale = t.vScale = 2.5; m.albedoTexture = t; m.bumpTexture = fabric; bumpLevel(m, 0.7); m.roughness = 0.78; break; }
    case 'leather': { const t = leatherAlbedo(scene); t.uScale = t.vScale = 3; m.albedoTexture = t; const n = leatherNormal(scene); n.uScale = n.vScale = 7; m.bumpTexture = n; bumpLevel(m, 0.6); m.roughness = 0.5; m.clearCoat.isEnabled = true; m.clearCoat.intensity = 0.25; m.clearCoat.roughness = 0.4; break; }
    case 'camo': { const t = camoAlbedo(scene); t.uScale = t.vScale = 2.5; m.albedoTexture = t; m.bumpTexture = fabric; bumpLevel(m, 0.7); m.roughness = 0.85; break; }
    case 'bandana': { const t = bandanaAlbedo(scene); t.uScale = t.vScale = 9; m.albedoTexture = t; m.bumpTexture = fabric; bumpLevel(m, 0.5); m.roughness = 0.95; m.backFaceCulling = false; m.twoSidedLighting = true; break; }
    case 'hair': { const t = hairAlbedo(scene); t.uScale = 14; t.vScale = 5; m.albedoTexture = t; const n = hairNormal(scene); n.uScale = 14; n.vScale = 5; m.bumpTexture = n; bumpLevel(m, 0.35); m.roughness = 0.5; break; }
    case 'metal': m.metallic = 0.9; m.roughness = 0.32; break;
    case 'lens': m.metallic = 0.85; m.roughness = 0.05; break;
    case 'patch': m.albedoTexture = patchAlbedo(scene); m.bumpTexture = fabric; bumpLevel(m, 0.4); m.roughness = 0.9; break;
    case 'rubber': { const n = treadNormal(scene); n.uScale = n.vScale = 9; m.bumpTexture = n; bumpLevel(m, 0.9); m.roughness = 0.88; break; }
    case 'merged': m.roughness = 0.8; break;
    default:
      if (key.startsWith('plaid:')) { const t = plaidAlbedo(scene, key.slice(6)); t.uScale = t.vScale = 4; m.albedoTexture = t; m.bumpTexture = fabric; bumpLevel(m, 0.5); m.roughness = 0.9; }
  }
  // the open jackets and collars are single sheets seen from both sides (they carry an inner face where it shows)
  if (key === 'canvas' || key === 'leather' || key === 'camo' || key.startsWith('plaid:') || key === 'cloth') m.backFaceCulling = true;
  m.freeze();
  cache.set(ck, m);
  return m;
}

function toMesh(scene: Scene, name: string, g: Geo, parent: TransformNode, skeleton: Skeleton, mat: PBRMaterial) {
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = new Float32Array(g.pos); vd.normals = new Float32Array(g.nrm); vd.uvs = new Float32Array(g.uv); vd.colors = new Float32Array(g.col);
  vd.indices = g.count > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
  vd.matricesIndices = new Float32Array(g.mi); vd.matricesWeights = new Float32Array(g.mw);
  vd.applyToMesh(m, false);
  m.parent = parent; m.material = mat; m.skeleton = skeleton; m.numBoneInfluencers = 4;
  // the bind-pose box grown by the reach of the limbs, so animated poses are never culled
  const bi = m.getBoundingInfo();
  m.setBoundingInfo(new BoundingInfo(bi.minimum.subtract(new Vector3(0.7, 0.6, 0.7)), bi.maximum.add(new Vector3(0.7, 0.5, 0.7))));
  m.isPickable = false; m.receiveShadows = true;
  return m;
}

/**
 * The player/NPC model: one skinned mesh per material on a 17-bone rig, built procedurally from a
 * CharacterAppearance (see model.ts), with three LODs, animated by blending named procedural poses.
 * The bones follow TransformNodes, so the animation code drives plain node rotations.
 */
export class CharacterView {
  readonly root: TransformNode;
  meshes: Mesh[] = [];
  appearance: CharacterAppearance;
  /** called after the model is rebuilt with the new meshes (and the old ones, now disposed) */
  onRebuild: (added: Mesh[], removed: Mesh[]) => void = () => {};
  private scaler: TransformNode;
  private hips!: TransformNode; private spine!: TransformNode; private neck!: TransformNode;
  private thighs: TransformNode[] = []; private knees: TransformNode[] = []; private ankles: TransformNode[] = [];
  private arms: TransformNode[] = []; private elbows: TransformNode[] = [];
  private tail: TransformNode[] = [];
  private skeleton: Skeleton | null = null;
  private lodNodes: TransformNode[] = [];
  private lod = -1;
  private weights = new Map<PoseName, number>(POSES.map(p => [p, p === 'idle' ? 1 : 0]));
  private time = 0;
  private visible = true;
  /** ponytail spring state: [pitch, pitch velocity, roll, roll velocity] */
  private hairSpring = [0, 0, 0, 0];
  private lastPos: Vector3 | null = null; private lastVel = new Vector3();
  /** force the closest LOD (creator, portraits) */
  forceLod: number | null = null;

  constructor(private scene: Scene, appearance: CharacterAppearance = DEFAULT_MALE) {
    this.root = new TransformNode('character', scene);
    this.scaler = new TransformNode('character-scale', scene); this.scaler.parent = this.root;
    this.appearance = appearance;
    this.build(appearance);
  }

  get stature() { return statureOf(this.appearance); }

  /** Rebuild the model for a new look. Materials are shared and cached, meshes are rebuilt. */
  applyAppearance(a: CharacterAppearance) {
    const old = this.meshes;
    for (const c of this.scaler.getChildren()) c.dispose();
    this.skeleton?.dispose(); this.skeleton = null;
    this.thighs = []; this.knees = []; this.ankles = []; this.arms = []; this.elbows = []; this.tail = []; this.meshes = []; this.lodNodes = []; this.lod = -1;
    this.appearance = a;
    this.build(a);
    this.root.setEnabled(this.visible);
    this.onRebuild(this.meshes, old);
  }

  setVisible(v: boolean) { this.visible = v; this.root.setEnabled(v); }

  /** Attach to a vehicle (or any node) so the figure rides with it; null detaches to world space. */
  attach(parent: TransformNode | null) {
    if (this.root.parent === parent) return;
    this.root.parent = parent;
  }

  private build(a: CharacterAppearance) {
    const scene = this.scene;
    const k = statureOf(a) / REF_STATURE;
    this.scaler.scaling.set(k, k, k);
    const rig: RigLayout = rigLayout(a);
    // nodes (animated) and bones (follow the nodes)
    const nodes = {} as Record<typeof BONES[number], TransformNode>;
    const sk = this.skeleton = new Skeleton(`char-skel`, `char-skel-${Math.random().toString(36).slice(2)}`, scene);
    const bones = {} as Record<typeof BONES[number], Bone>;
    for (const n of BONES) {
      const t = new TransformNode(n, scene), p = rig.parent[n], l = rig.local[n];
      t.parent = p ? nodes[p] : this.scaler; t.position.set(l[0], l[1], l[2]);
      nodes[n] = t;
      bones[n] = new Bone(n, sk, p ? bones[p] : null, Matrix.Translation(l[0], l[1], l[2]));
      bones[n].linkTransformNode(t);
    }
    this.hips = nodes.hips; this.spine = nodes.spine; this.neck = nodes.neck;
    this.thighs = [nodes.thighR, nodes.thighL]; this.knees = [nodes.kneeR, nodes.kneeL]; this.ankles = [nodes.ankleR, nodes.ankleL];
    this.arms = [nodes.armR, nodes.armL]; this.elbows = [nodes.elbowR, nodes.elbowL]; this.tail = [nodes.tail0, nodes.tail1, nodes.tail2];
    LODS.forEach((L, li) => {
      const holder = new TransformNode(`lod${li}`, scene); holder.parent = this.scaler;
      const bd = new Builder(L.q, L.merged);
      const info = buildModel(bd, a, rig);
      let verts = 0, draws = 0;
      if (L.merged) {
        const all = new Geo();
        for (const [key, g] of bd.groups) {
          const mean = key === 'skin' ? info.mean.skin : info.mean[key] ?? [1, 1, 1];
          for (let i = 0; i < g.col.length; i += 4) { g.col[i] *= mean[0]; g.col[i + 1] *= mean[1]; g.col[i + 2] *= mean[2]; }
          all.append(g);
        }
        this.meshes.push(toMesh(scene, `char-lod${li}`, all, holder, sk, material(scene, 'merged', info)));
        verts = all.count; draws = 1;
      } else {
        for (const [key, g] of bd.groups) { this.meshes.push(toMesh(scene, `char-${key}`, g, holder, sk, material(scene, key, info))); verts += g.count; draws++; }
      }
      characterStats.vertices[li] = verts; characterStats.drawCalls[li] = draws;
      holder.setEnabled(li === 0);
      this.lodNodes.push(holder);
    });
    this.lod = 0;
    void mulc;
  }

  /** Pick the level of detail from the distance to the active camera. */
  private updateLod() {
    let want = 0;
    if (this.forceLod !== null) want = this.forceLod;
    else {
      const cam = this.scene.activeCamera;
      if (cam) {
        const d = Vector3.Distance(cam.globalPosition, this.root.getAbsolutePosition());
        want = LODS.findIndex(L => d < L.until * (this.lod >= 0 && LODS.indexOf(L) === this.lod ? 1.08 : 1));
        if (want < 0) want = LODS.length; // beyond the last LOD: hidden
      }
    }
    if (want === this.lod) return;
    this.lod = want;
    this.lodNodes.forEach((n, i) => n.setEnabled(i === want));
  }

  /** Current level of detail (0 = full, 3 = culled). */
  get level() { return this.lod; }

  /** Ponytail: a damped spring that swings with the body's acceleration and hangs under gravity. */
  private updateHair(dt: number, lean: number) {
    if (!this.tail.length || dt <= 0) return;
    const pos = this.root.getAbsolutePosition().clone();
    if (!this.lastPos) { this.lastPos = pos; return; }
    const h = Math.min(dt, 0.05), vel = pos.subtract(this.lastPos).scale(1 / h);
    const acc = vel.subtract(this.lastVel).scale(1 / h);
    this.lastPos = pos; this.lastVel = vel;
    const yaw = this.root.absoluteRotationQuaternion ? this.root.absoluteRotationQuaternion.toEulerAngles().y : this.root.rotation.y;
    const fwd = Math.sin(yaw) * acc.x + Math.cos(yaw) * acc.z, side = Math.cos(yaw) * acc.x - Math.sin(yaw) * acc.z;
    const clampA = (v: number) => Math.max(-25, Math.min(25, v));
    const s = this.hairSpring, w = 9, z = 0.32;
    const tp = -lean * 0.75 + clampA(fwd) * 0.03 + clampA(acc.y) * 0.004, tr = -clampA(side) * 0.03;
    const steps = Math.max(1, Math.ceil(h / 0.0167));
    for (let i = 0; i < steps; i++) {
      const d = h / steps;
      s[1] += (w * w * (tp - s[0]) - 2 * z * w * s[1]) * d; s[0] += s[1] * d;
      s[3] += (w * w * (tr - s[2]) - 2 * z * w * s[3]) * d; s[2] += s[3] * d;
    }
    s[0] = Math.max(-1.1, Math.min(1.1, s[0])); s[2] = Math.max(-0.9, Math.min(0.9, s[2]));
    const lagP = s[1] * 0.04, lagR = s[3] * 0.04;
    this.tail[0].rotation.set(s[0] * 0.6, 0, s[2] * 0.6);
    this.tail[1].rotation.set(s[0] * 0.3 - lagP, 0, s[2] * 0.3 - lagR);
    this.tail[2].rotation.set(s[0] * 0.15 - lagP * 1.5, 0, s[2] * 0.15 - lagR * 1.5);
  }

  // ---------------- animation ----------------

  private pose(name: PoseName, c: Character | null, o: SyncOptions): Pose {
    const p = zero(), ph = c?.animPhase ?? 0, t = this.time;
    const cycle = (amp: number, kneeAmp: number, armAmp: number, elbow: number, lean: number, bob: number) => {
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1, sw = Math.sin(ph) * s;
        p.hip[i] = sw * amp + 0.05;
        p.knee[i] = 0.08 + Math.max(0, Math.cos(ph) * s) * kneeAmp + Math.max(0, sw) * kneeAmp * 0.25;
        p.shoulder[i] = -sw * armAmp; p.abduct[i] = 0.08; p.elbow[i] = elbow + Math.max(0, -sw) * armAmp * 0.4;
      }
      p.lean = lean; p.hipsY = NaN; p.footFlat = 0.65; p.twist = Math.sin(ph) * amp * 0.25;
      p.headPitch = -lean * 0.5;
      p.bob = Math.abs(Math.cos(ph)) * bob;
    };
    switch (name) {
      case 'idle': {
        const br = Math.sin(t * 1.7);
        p.hip = [0.03, -0.02]; p.knee = [0.05, 0.08]; p.shoulder = [0.04, 0.02]; p.abduct = [0.1 + br * 0.015, 0.1 + br * 0.015];
        p.elbow = [0.18, 0.2]; p.lean = 0.02 + br * 0.012; p.headPitch = Math.sin(t * 0.37) * 0.05; p.twist = Math.sin(t * 0.23) * 0.04;
        p.hipsY = NaN; p.footFlat = 1; p.spread = 0.06; break;
      }
      case 'talk': {
        p.hip = [0.03, -0.02]; p.knee = [0.05, 0.08]; p.lean = 0.03; p.hipsY = NaN; p.footFlat = 1; p.spread = 0.06;
        p.shoulder = [0.35 + Math.sin(t * 2.3) * 0.25, 0.05]; p.abduct = [0.2, 0.1]; p.elbow = [1.1 + Math.sin(t * 3.1) * 0.3, 0.25];
        p.headPitch = Math.sin(t * 1.9) * 0.08; break;
      }
      case 'walk': cycle(0.42, 0.75, 0.38, 0.2, 0.04, 0.025); break;
      case 'run': cycle(0.7, 1.35, 0.7, 1.25, 0.16, 0.055); break;
      case 'sprint': cycle(0.95, 1.75, 1.05, 1.5, 0.32, 0.07); break;
      case 'crouch': {
        p.hip = [1.15, 0.95]; p.knee = [2.0, 1.85]; p.lean = 0.45; p.headPitch = -0.35; p.shoulder = [0.45, 0.4]; p.abduct = [0.15, 0.15];
        p.elbow = [0.9, 0.8]; p.hipsY = NaN; p.footFlat = 1; break;
      }
      case 'crouch-walk': {
        for (let i = 0; i < 2; i++) { const s = i === 0 ? 1 : -1, sw = Math.sin(ph) * s; p.hip[i] = 1.0 + sw * 0.35; p.knee[i] = 1.75 + Math.max(0, Math.cos(ph) * s) * 0.4; p.shoulder[i] = 0.4 - sw * 0.2; p.elbow[i] = 0.9; p.abduct[i] = 0.15; }
        p.lean = 0.5; p.headPitch = -0.4; p.hipsY = NaN; p.footFlat = 0.8; break;
      }
      case 'jump': p.hip = [0.75, -0.15]; p.knee = [1.25, 0.55]; p.shoulder = [0.5, 0.75]; p.abduct = [0.45, 0.45]; p.elbow = [0.6, 0.5]; p.lean = 0.08; p.hipsY = HIP_Y; break;
      case 'fall': {
        const f = Math.sin(t * 9) * 0.12;
        p.hip = [0.35, 0.15]; p.knee = [0.7, 0.45]; p.shoulder = [0.3 + f, 0.3 - f]; p.abduct = [0.95, 0.95]; p.elbow = [0.4, 0.4]; p.lean = -0.05; p.hipsY = HIP_Y; break;
      }
      case 'land': {
        const k = Math.min(1, (c?.landSpeed ?? 4) / 7);
        p.hip = [0.5 + 0.5 * k, 0.45 + 0.5 * k]; p.knee = [0.9 + 0.9 * k, 0.85 + 0.9 * k]; p.lean = 0.25 + 0.2 * k; p.shoulder = [0.35, 0.35]; p.abduct = [0.35, 0.35];
        p.elbow = [0.5, 0.5]; p.hipsY = NaN; p.footFlat = 1; break;
      }
      case 'seated': {
        const st = o.steer ?? 0;
        p.hip = [1.45, 1.4]; p.knee = [1.35, 1.5]; p.lean = -0.18; p.headPitch = 0.08;
        p.shoulder = [0.95 - st * 0.25, 0.95 + st * 0.25]; p.abduct = [0.18 + st * 0.12, 0.18 - st * 0.12]; p.elbow = [0.7, 0.7]; p.twist = -st * 0.08;
        p.hipsY = 0; p.footFlat = 0.9; break;
      }
      case 'climb': {
        p.hip = [1.25, 0.25]; p.knee = [1.5, 0.35]; p.lean = 0.35; p.shoulder = [1.4, 1.1]; p.abduct = [0.25, 0.3]; p.elbow = [0.55, 0.7]; p.headPitch = -0.1;
        p.hipsY = HIP_Y; p.footFlat = 0.5; break;
      }
    }
    return p;
  }

  /** Smoothed pose weights: the target pose fades in while the others fade out (≈0.1 s blends). */
  private targetPoses(c: Character | null, o: SyncOptions): Partial<Record<PoseName, number>> {
    if (o.mode) return { [o.mode]: 1 };
    const s: LocomotionState = c?.state ?? 'idle';
    if (s === 'walk' || s === 'run' || s === 'sprint') {
      // blend the gaits by speed so a walk speeds up into a run without a pop
      const v = c!.speed;
      if (v < 3.0) { const k = Math.max(0, Math.min(1, (v - 1.7) / 1.3)); return { walk: 1 - k, run: k }; }
      const k = Math.max(0, Math.min(1, (v - 4.2) / 2.8)); return { run: 1 - k, sprint: k };
    }
    return { [s]: 1 };
  }

  /** Advance animation and place the figure. `c` may be null when a pose is driven externally (seated, climbing). */
  sync(c: Character | null, dt: number, o: SyncOptions = {}) {
    this.time += dt;
    if (o.local) { this.root.position.set(o.local.x, o.local.y, o.local.z); this.root.rotation.y = o.local.yaw; }
    else if (c) { this.root.position.set(c.pos.x, c.pos.y, c.pos.z); this.root.rotation.y = c.heading; }
    const target = this.targetPoses(c, o);
    const rate = o.mode === 'seated' || o.mode === 'climb' ? 7 : 11, k = 1 - Math.exp(-rate * dt);
    let sum = 0;
    for (const n of POSES) { const w = this.weights.get(n)! + ((target[n] ?? 0) - this.weights.get(n)!) * k; this.weights.set(n, w < 1e-3 ? 0 : w); sum += w < 1e-3 ? 0 : w; }
    const b = zero(); let fixedY = 0, fixedW = 0, bob = 0;
    for (const n of POSES) {
      const w = this.weights.get(n)! / (sum || 1);
      if (!w) continue;
      const p = this.pose(n, c, o);
      b.lean += p.lean * w; b.headPitch += p.headPitch * w; b.twist += p.twist * w; b.footFlat += p.footFlat * w; b.spread += p.spread * w;
      for (let i = 0; i < 2; i++) { b.hip[i] += p.hip[i] * w; b.knee[i] += p.knee[i] * w; b.shoulder[i] += p.shoulder[i] * w; b.abduct[i] += p.abduct[i] * w; b.elbow[i] += p.elbow[i] * w; }
      if (!Number.isNaN(p.hipsY)) { fixedY += p.hipsY * w; fixedW += w; }
      bob += p.bob * w;
    }
    // planted poses: lower the hips until the lower foot touches the ground
    const reach = (i: number) => THIGH * Math.cos(b.hip[i]) + SHIN * Math.cos(b.hip[i] - b.knee[i]) + FOOT_Y + 0.04;
    const planted = Math.max(reach(0), reach(1)) - bob;
    this.hips.position.y = fixedY + planted * (1 - fixedW);
    this.hips.rotation.y = b.twist * 0.5;
    this.spine.rotation.x = b.lean; this.spine.rotation.y = -b.twist;
    this.neck.rotation.x = b.headPitch - b.lean * 0.4;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1; // thighs[0]/arms[0] are on the -X side
      this.thighs[i].rotation.x = -b.hip[i];
      this.knees[i].rotation.x = b.knee[i];
      this.ankles[i].rotation.x = (b.hip[i] - b.knee[i]) * b.footFlat; // keep the sole level with the ground
      this.arms[i].rotation.x = -b.shoulder[i];
      this.arms[i].rotation.z = side * b.abduct[i];
      this.thighs[i].rotation.z = side * b.spread;
      this.ankles[i].rotation.z = -side * b.spread;
      this.elbows[i].rotation.x = -b.elbow[i];
    }
    this.updateHair(dt, b.lean + b.headPitch * 0.6);
    this.updateLod();
  }

  /** Current pose weights (for tests and debugging). */
  poseWeights(): Record<string, number> { return Object.fromEntries([...this.weights].filter(([, w]) => w > 0.01).map(([n, w]) => [n, +w.toFixed(2)])); }

  dispose() { this.skeleton?.dispose(); this.root.dispose(); }
}
