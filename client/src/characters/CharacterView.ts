import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {
  SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, EYE_COLORS, DEFAULT_MALE, statureOf,
  type Character, type CharacterAppearance, type LocomotionState,
} from '@orl/shared';

/** Reference figure is 1.75 m tall; the whole skeleton scales to the appearance's stature. */
const REF_STATURE = 1.75;
const HIP_Y = 0.92, THIGH = 0.42, SHIN = 0.42, FOOT_Y = 0.07;
const TEE = '#d9cfb8';

/** Anatomical pose: angles in radians, positive = the natural direction (flexion forward, bend, out to the side). */
interface Pose {
  hipsY: number;          // NaN = plant the feet automatically
  lean: number; headPitch: number; twist: number;
  hip: [number, number]; knee: [number, number];
  shoulder: [number, number]; abduct: [number, number]; elbow: [number, number];
  footFlat: number;
  /** vertical bounce of the stride, metres */
  bob: number;
}
const zero = (): Pose => ({ hipsY: 0, lean: 0, headPitch: 0, twist: 0, hip: [0, 0], knee: [0, 0], shoulder: [0, 0], abduct: [0, 0], elbow: [0, 0], footFlat: 0, bob: 0 });
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

const matCache = new WeakMap<Scene, Map<string, PBRMaterial>>();
function material(scene: Scene, hex: string, rough = 0.85, opts: { metal?: number; alpha?: number; plaid?: boolean } = {}) {
  let cache = matCache.get(scene);
  if (!cache) { cache = new Map(); matCache.set(scene, cache); }
  const key = `${hex}|${rough}|${opts.metal ?? 0}|${opts.alpha ?? 1}|${opts.plaid ? 1 : 0}`;
  let m = cache.get(key);
  if (!m) {
    m = new PBRMaterial(`char-${key}`, scene);
    m.albedoColor = Color3.FromHexString(hex).toLinearSpace();
    m.roughness = rough; m.metallic = opts.metal ?? 0;
    if (opts.alpha !== undefined && opts.alpha < 1) { m.alpha = opts.alpha; m.transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND; }
    if (opts.plaid) { m.albedoTexture = plaidTexture(scene, hex); m.albedoColor = Color3.White(); }
    cache.set(key, m);
  }
  return m;
}

/** Flannel check generated on a canvas (original procedural pattern, no external textures). */
function plaidTexture(scene: Scene, hex: string) {
  const t = new DynamicTexture(`plaid-${hex}`, { width: 64, height: 64 }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D, base = Color3.FromHexString(hex);
  ctx.fillStyle = hex; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = base.scale(0.45).toHexString(); ctx.globalAlpha = 0.6;
  ctx.fillRect(0, 20, 64, 14); ctx.fillRect(20, 0, 14, 64);
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#e8e0cc';
  ctx.fillRect(0, 44, 64, 2); ctx.fillRect(44, 0, 2, 64);
  ctx.globalAlpha = 1;
  t.update(); t.uScale = 3; t.vScale = 3; t.wrapU = t.wrapV = 1;
  return t;
}

const shade = (hex: string, k: number) => Color3.FromHexString(hex).scale(k).toHexString();
const mix = (a: string, b: string, k: number) => Color3.Lerp(Color3.FromHexString(a), Color3.FromHexString(b), k).toHexString();

/**
 * The player/NPC model: an original primitive-built figure assembled from a CharacterAppearance
 * (male/female body, height, build, face, hair, beard, clothing, boots, gloves, headwear, accessories),
 * animated procedurally by blending named poses with smoothed weights.
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
  private weights = new Map<PoseName, number>(POSES.map(p => [p, p === 'idle' ? 1 : 0]));
  private time = 0;
  private visible = true;

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
    this.thighs = []; this.knees = []; this.ankles = []; this.arms = []; this.elbows = []; this.meshes = [];
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
    const scene = this.scene, female = a.body === 'female';
    const k = statureOf(a) / REF_STATURE;
    this.scaler.scaling.set(k, k, k);
    const wide = 0.88 + a.build * 0.36, limb = 0.9 + a.build * 0.28;
    const skinHex = SKIN_TONES[a.skin], hairHex = HAIR_COLORS[a.hairColor], topHex = CLOTH_COLORS[a.topColor], pantsHex = CLOTH_COLORS[a.pantsColor];
    const skin = material(scene, skinHex, 0.6), hair = material(scene, hairHex, 0.75), lips = material(scene, shade(skinHex, 0.72), 0.5);
    const top = material(scene, topHex, 0.88, { plaid: a.top === 'flannel' }), topTrim = material(scene, shade(topHex, 0.7), 0.85);
    const pants = material(scene, pantsHex, 0.9), belt = material(scene, '#211a14', 0.6), tee = material(scene, TEE, 0.9);
    const white = material(scene, '#eeeae4', 0.3), iris = material(scene, EYE_COLORS[a.eyes], 0.25), dark = material(scene, '#1b1a19', 0.45);
    const node = (n: string, parent: TransformNode, x = 0, y = 0, z = 0) => { const t = new TransformNode(n, scene); t.parent = parent; t.position.set(x, y, z); return t; };
    const add = <M extends Mesh>(m: M, mt: PBRMaterial, parent: TransformNode, x = 0, y = 0, z = 0): M => { m.parent = parent; m.position.set(x, y, z); m.material = mt; this.meshes.push(m); return m; };
    const sphere = (n: string, dx: number, dy: number, dz: number, seg = 12, slice?: number) => MeshBuilder.CreateSphere(n, { diameterX: dx, diameterY: dy, diameterZ: dz, segments: seg, slice }, scene);
    const capsule = (n: string, r: number, h: number) => MeshBuilder.CreateCapsule(n, { radius: r, height: h, tessellation: 12, subdivisions: 1 }, scene);
    const box = (n: string, w: number, h: number, d: number) => MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
    const cyl = (n: string, d: number, h: number, tess = 14) => MeshBuilder.CreateCylinder(n, { diameter: d, height: h, tessellation: tess }, scene);
    const torus = (n: string, d: number, t: number) => MeshBuilder.CreateTorus(n, { diameter: d, thickness: t, tessellation: 18 }, scene);

    // ---------- skeleton ----------
    this.hips = node('hips', this.scaler, 0, HIP_Y);
    this.spine = node('spine', this.hips, 0, 0.06);
    this.neck = node('neck', this.spine, 0, 0.52);
    const shoulderX = (female ? 0.175 : 0.2) * (0.94 + a.build * 0.14), hipX = female ? 0.095 : 0.09;

    // ---------- torso ----------
    const chestR = female ? 0.135 : 0.15;
    const chest = add(capsule('chest', chestR, female ? 0.48 : 0.52), top, this.spine, 0, 0.25);
    chest.scaling.set((female ? 1.12 : 1.2) * wide, 1, 0.74 * wide);
    if (female) {
      const waist = add(capsule('waist', 0.13, 0.26), top, this.spine, 0, 0.06); waist.scaling.set(1.05 * wide, 1, 0.72 * wide);
      for (const sx of [-1, 1]) add(sphere('bust', 0.11, 0.1, 0.09, 10), top, this.spine, sx * 0.058, 0.33, 0.065 * wide);
    }
    const pelvis = add(capsule('pelvis', 0.1, female ? 0.34 : 0.31), pants, this.hips, 0, -0.01);
    pelvis.rotation.z = Math.PI / 2; pelvis.scaling.set(0.9, (female ? 1.06 : 1) * wide, 1.05 * wide);
    add(cyl('belt', 0.29, 0.05, 18), belt, this.hips, 0, 0.05).scaling.set((female ? 1.06 : 1.02) * wide, 1, 0.74 * wide);
    add(box('buckle', 0.05, 0.035, 0.01), material(scene, '#9a8f7a', 0.35, { metal: 0.8 }), this.hips, 0, 0.05, 0.11 * wide);
    add(cyl('neck', 0.085, 0.1, 10), skin, this.neck, 0, 0.03);

    // top style details
    const frontZ = 0.11 * wide;
    if (a.top === 'field-jacket') {
      add(torus('collar', 0.14, 0.03), topTrim, this.neck, 0, -0.02).scaling.set(1.15, 1, 1);
      for (const sx of [-1, 1]) add(box('pocket', 0.085, 0.09, 0.02), topTrim, this.spine, sx * 0.075, 0.33, frontZ + 0.005);
      add(box('zip', 0.012, 0.42, 0.012), dark, this.spine, 0, 0.24, frontZ + 0.006);
    } else if (a.top === 'hoodie') {
      add(sphere('hood', 0.22, 0.13, 0.15, 10), top, this.neck, 0, -0.01, -0.07);
      add(box('kangaroo', 0.2, 0.1, 0.02), topTrim, this.spine, 0, 0.12, frontZ);
      for (const sx of [-1, 1]) add(cyl('drawstring', 0.008, 0.12, 6), tee, this.spine, sx * 0.03, 0.42, frontZ + 0.01);
    } else if (a.top === 'flannel') {
      add(torus('collar', 0.15, 0.035), top, this.neck, 0, -0.01);
      for (let i = 0; i < 4; i++) add(sphere('button', 0.012, 0.012, 0.008, 6), dark, this.spine, 0, 0.42 - i * 0.1, frontZ + 0.004);
    } else if (a.top === 'vest') {
      add(box('tee-front', 0.07, 0.4, 0.02), tee, this.spine, 0, 0.25, frontZ - 0.005);
      for (const sx of [-1, 1]) for (const y of [0.15, 0.33]) add(box('vest-pocket', 0.07, 0.07, 0.025), topTrim, this.spine, sx * 0.08, y, frontZ + 0.006);
      add(torus('collar', 0.15, 0.03), tee, this.neck, 0, -0.015);
    } else {
      add(torus('collar', 0.145, 0.025), topTrim, this.neck, 0, -0.015);
    }

    // ---------- head ----------
    const fs = female ? 0.95 : 1;
    const dims: Record<string, [number, number, number]> = { oval: [0.17, 0.23, 0.2], square: [0.18, 0.22, 0.2], round: [0.19, 0.21, 0.205], long: [0.16, 0.245, 0.19] };
    const [hx, hy, hz] = dims[a.face].map(v => v * fs);
    const head = node('head', this.neck, 0, 0.13);
    add(sphere('skull', hx, hy, hz, 16), skin, head);
    if (a.face === 'square' && !female) add(box('jaw', hx * 0.82, 0.07, hz * 0.7), skin, head, 0, -hy * 0.27, hz * 0.08);
    const fz = hz * 0.45;
    for (const sx of [-1, 1]) {
      add(sphere('eye', 0.026, 0.02, 0.014, 8), white, head, sx * hx * 0.2, hy * 0.06, fz);
      add(sphere('iris', 0.013, 0.013, 0.008, 8), iris, head, sx * hx * 0.2, hy * 0.06, fz + 0.006);
      const brow = add(box('brow', 0.04, female ? 0.006 : 0.009, 0.01), hair, head, sx * hx * 0.2, hy * 0.17, fz - 0.002);
      brow.rotation.z = sx * (female ? 0.12 : 0.05);
      add(sphere('ear', 0.02, 0.05, 0.035, 8), skin, head, sx * hx * 0.5, 0, -0.005);
    }
    add(box('nose', 0.022, 0.045, 0.03), skin, head, 0, -hy * 0.04, fz + 0.012).rotation.x = -0.15;
    add(box('mouth', female ? 0.042 : 0.048, female ? 0.01 : 0.007, 0.01), lips, head, 0, -hy * 0.24, fz - 0.012);

    // hair
    const cap = (n: string, s: number, slice: number, mt: PBRMaterial, tilt = -0.32) => {
      const m = add(sphere(n, hx * s, hy * s, hz * s, 14, slice), mt, head, 0, 0.005, -0.008); m.rotation.x = tilt; return m;
    };
    switch (a.hair) {
      case 'short': cap('hair', 1.07, 0.52, hair); break;
      case 'buzz': cap('hair', 1.03, 0.5, material(scene, mix(hairHex, skinHex, 0.45), 0.9)); break;
      case 'swept': cap('hair', 1.07, 0.52, hair); add(box('quiff', hx * 0.8, 0.045, 0.08), hair, head, 0, hy * 0.45, hz * 0.22).rotation.x = -0.35; break;
      case 'long':
        cap('hair', 1.08, 0.55, hair);
        add(box('hair-back', hx * 1.0, 0.26, 0.05), hair, head, 0, -0.09, -hz * 0.42);
        for (const sx of [-1, 1]) add(box('hair-side', 0.025, 0.2, hz * 0.6), hair, head, sx * hx * 0.5, -0.05, -hz * 0.12);
        break;
      case 'ponytail': {
        cap('hair', 1.07, 0.55, hair);
        add(sphere('tie', 0.045, 0.045, 0.045, 8), material(scene, shade(topHex, 0.6), 0.5), head, 0, 0.03, -hz * 0.55);
        const tail = add(capsule('ponytail', 0.028, 0.22), hair, head, 0, -0.07, -hz * 0.62); tail.rotation.x = -0.25;
        break;
      }
      case 'bun': cap('hair', 1.07, 0.55, hair); add(sphere('bun', 0.085, 0.08, 0.08, 10), hair, head, 0, hy * 0.38, -hz * 0.42); break;
      case 'curly': {
        cap('hair', 1.12, 0.55, hair);
        for (let i = 0; i < 9; i++) { const t = (i / 8) * Math.PI * 1.4 - Math.PI * 0.2 + Math.PI / 2; add(sphere('curl', 0.07, 0.07, 0.07, 6), hair, head, Math.cos(t) * hx * 0.52, hy * 0.18, -Math.sin(t) * hz * 0.52 + 0.005); }
        break;
      }
      case 'bald': break;
    }
    // beard (the female body never has one; sanitizeAppearance enforces it)
    if (a.beard !== 'none') {
      const jaw = (s: number, mt: PBRMaterial) => { const m = add(sphere('beard', hx * s, hy * s, hz * s, 14, 0.5), mt, head, 0, -0.005, 0.006); m.rotation.x = Math.PI + 0.85; return m; };
      if (a.beard === 'stubble') jaw(1.015, material(scene, hairHex, 0.9, { alpha: 0.45 }));
      else if (a.beard === 'short' || a.beard === 'full') {
        jaw(a.beard === 'full' ? 1.07 : 1.035, hair);
        if (a.beard === 'full') add(sphere('beard-chin', 0.1, 0.09, 0.07, 10), hair, head, 0, -hy * 0.45, hz * 0.3);
        add(box('mustache', 0.06, 0.014, 0.02), hair, head, 0, -hy * 0.15, fz + 0.002);
      } else {
        add(box('goatee', 0.045, 0.06, 0.035), hair, head, 0, -hy * 0.4, fz - 0.012);
        add(box('mustache', 0.06, 0.012, 0.02), hair, head, 0, -hy * 0.15, fz + 0.002);
      }
    }
    // headwear
    const hw = material(scene, CLOTH_COLORS[a.headwearColor], 0.8);
    switch (a.headwear) {
      case 'cap': cap('cap', 1.13, 0.5, hw, -0.12); add(box('brim', hx * 0.85, 0.01, 0.1), hw, head, 0, hy * 0.2, hz * 0.6).rotation.x = -0.12; break;
      case 'beanie': cap('beanie', 1.16, 0.6, hw, -0.18); add(torus('beanie-fold', hx * 1.06, 0.035), hw, head, 0, hy * 0.1, -0.01).scaling.z = hz / hx; break;
      case 'bush-hat': {
        add(cyl('hat-crown', hx * 1.15, 0.08), hw, head, 0, hy * 0.42);
        add(cyl('hat-brim', hx * 2.1, 0.01, 22), hw, head, 0, hy * 0.27).scaling.z = 0.95;
        add(cyl('hat-band', hx * 1.17, 0.02), dark, head, 0, hy * 0.33);
        break;
      }
      case 'helmet': {
        cap('helmet', 1.25, 0.55, material(scene, CLOTH_COLORS[a.headwearColor], 0.3, { metal: 0.1 }), -0.15);
        add(box('visor', hx * 0.95, 0.03, 0.06), dark, head, 0, hy * 0.28, hz * 0.55).rotation.x = -0.25;
        break;
      }
      case 'none': break;
    }

    // ---------- arms ----------
    const longSleeve = a.top === 'field-jacket' || a.top === 'hoodie' || a.top === 'flannel';
    const gloveMat = a.gloves === 'work' ? material(scene, '#9c7a4f', 0.8) : a.gloves === 'fingerless' ? material(scene, '#2a2724', 0.7) : skin;
    for (const sx of [-1, 1]) {
      const arm = node('shoulder', this.spine, sx * shoulderX, 0.44);
      add(sphere('deltoid', 0.11, 0.1, 0.1, 10), a.top === 'vest' ? tee : top, arm, 0, -0.01).scaling.set(limb, 1, limb);
      const upper = add(capsule('upper-arm', 0.05, 0.3), a.top === 'vest' ? skin : top, arm, 0, -0.14); upper.scaling.set(limb, 1, limb);
      if (!longSleeve) add(cyl('sleeve', 0.115, 0.12, 12), a.top === 'vest' ? tee : top, arm, 0, -0.07).scaling.set(limb, 1, limb);
      const elbow = node('elbow', arm, 0, -0.29);
      const fore = add(capsule('forearm', 0.042, 0.27), longSleeve && a.top !== 'flannel' ? top : skin, elbow, 0, -0.12); fore.scaling.set(limb, 1, limb);
      if (a.top === 'flannel') add(torus('cuff', 0.09, 0.03), top, elbow, 0, -0.02).scaling.set(limb, 1, limb);
      const hand = add(sphere('hand', 0.07, 0.1, 0.04, 8), gloveMat, elbow, 0, -0.3);
      hand.scaling.setAll(a.gloves === 'work' ? 1.15 : 1);
      if (a.gloves === 'fingerless') add(box('fingers', 0.06, 0.035, 0.03), skin, elbow, 0, -0.355);
      if (a.gloves === 'work') add(cyl('glove-cuff', 0.085, 0.05, 10), gloveMat, elbow, 0, -0.245);
      if (sx < 0 && a.accessories.includes('watch')) {
        add(cyl('watch-strap', 0.075, 0.022, 12), dark, elbow, 0, -0.225).scaling.set(limb, 1, limb);
        add(cyl('watch-face', 0.03, 0.008, 12), material(scene, '#c8c2b4', 0.2, { metal: 0.7 }), elbow, -0.035 * limb, -0.225).rotation.z = Math.PI / 2;
      }
      this.arms.push(arm); this.elbows.push(elbow);
    }

    // ---------- legs ----------
    const bootHex = a.boots === 'work' ? '#1d1b19' : a.boots === 'tall' ? '#3b2a1f' : '#5a3b22';
    const bootMat = material(scene, bootHex, 0.65), sole = material(scene, '#151311', 0.9);
    for (const sx of [-1, 1]) {
      const thigh = node('thigh', this.hips, sx * hipX * wide, -0.04);
      const tm = add(capsule('thigh', female ? 0.072 : 0.075, THIGH + 0.06), pants, thigh, 0, -THIGH / 2); tm.scaling.set(limb * (female ? 1.08 : 1), 1, limb);
      const knee = node('knee', thigh, 0, -THIGH);
      add(capsule('shin', 0.058, SHIN + 0.04), pants, knee, 0, -SHIN / 2).scaling.set(limb, 1, limb);
      const ankle = node('ankle', knee, 0, -SHIN);
      const bs = a.boots === 'work' ? 1.12 : 1;
      const boot = add(capsule('boot', 0.052 * bs, 0.24 * bs), bootMat, ankle, 0, -0.025, 0.045);
      boot.rotation.x = Math.PI / 2; boot.scaling.set(1.05, 1, 0.78);
      add(box('sole', 0.095 * bs, 0.022, 0.25 * bs), sole, ankle, 0, -FOOT_Y + 0.011, 0.045);
      add(cyl('boot-cuff', 0.115 * bs, a.boots === 'tall' ? 0.24 : 0.09, 12), bootMat, ankle, 0, a.boots === 'tall' ? 0.1 : 0.02);
      if (a.boots === 'work') add(sphere('toe-cap', 0.1, 0.06, 0.07, 8), material(scene, '#2b2926', 0.4), ankle, 0, -0.03, 0.14);
      if (a.boots === 'hiking') for (let i = 0; i < 3; i++) add(box('lace', 0.05, 0.006, 0.008), material(scene, '#b8904f', 0.8), ankle, 0, 0.0 - i * 0.022, 0.05 + i * 0.02);
      this.thighs.push(thigh); this.knees.push(knee); this.ankles.push(ankle);
    }

    // ---------- accessories ----------
    if (a.accessories.includes('backpack')) {
      const pack = material(scene, '#3f4a52', 0.85), packTrim = material(scene, '#2a3036', 0.8);
      add(box('pack', 0.27 * wide, 0.36, 0.14), pack, this.spine, 0, 0.28, -0.12 * wide - 0.07);
      add(box('pack-lid', 0.25 * wide, 0.07, 0.15), packTrim, this.spine, 0, 0.47, -0.12 * wide - 0.07);
      add(cyl('bedroll', 0.08, 0.28 * wide, 10), material(scene, '#6b5a3c', 0.9), this.spine, 0, 0.08, -0.12 * wide - 0.08).rotation.z = Math.PI / 2;
      for (const sx of [-1, 1]) add(box('strap', 0.035, 0.36, 0.015), packTrim, this.spine, sx * 0.08, 0.3, frontZ + 0.006);
    }
    if (a.accessories.includes('scarf')) {
      const sc = material(scene, CLOTH_COLORS[(a.topColor + 4) % CLOTH_COLORS.length], 0.95);
      add(torus('scarf', 0.15, 0.05), sc, this.neck, 0, 0.0).scaling.set(1.1, 1.4, 1.05);
      add(box('scarf-tail', 0.06, 0.18, 0.02), sc, this.spine, 0.04, 0.4, frontZ + 0.02).rotation.z = 0.1;
    }
    if (a.accessories.includes('sunglasses')) {
      const lens = material(scene, '#101418', 0.08, { metal: 0.6 });
      add(box('sunglasses', hx * 0.78, 0.028, 0.01), lens, head, 0, hy * 0.06, fz + 0.016);
      for (const sx of [-1, 1]) add(box('sunglass-arm', 0.005, 0.008, hz * 0.45), lens, head, sx * hx * 0.42, hy * 0.08, fz - hz * 0.2);
    }
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
        p.hipsY = NaN; p.footFlat = 1; break;
      }
      case 'talk': {
        p.hip = [0.03, -0.02]; p.knee = [0.05, 0.08]; p.lean = 0.03; p.hipsY = NaN; p.footFlat = 1;
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
      b.lean += p.lean * w; b.headPitch += p.headPitch * w; b.twist += p.twist * w; b.footFlat += p.footFlat * w;
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
      this.arms[i].rotation.z = -side * b.abduct[i];
      this.elbows[i].rotation.x = -b.elbow[i];
    }
  }

  /** Current pose weights (for tests and debugging). */
  poseWeights(): Record<string, number> { return Object.fromEntries([...this.weights].filter(([, w]) => w > 0.01).map(([n, w]) => [n, +w.toFixed(2)])); }

  dispose() { this.root.dispose(); }
}
