import {
  SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, EYE_COLORS, OUTFIT_VARIANTS, type CharacterAppearance,
} from '@orl/shared';
import {
  Builder, ring, frames, ellipsoidRows, spline, table, lin, mixc, mulc, smooth, clamp01, fbm, noise3, norm, sub, add, scl, cross, len,
  type V3, type RGB, type Weights, type WeightFn,
} from './geo';
import { EYE_UV, PLAIN_UV } from './textures';

/**
 * Builds the character's surfaces from a CharacterAppearance into a Builder (per-material geometry with
 * skin weights). Bind pose = the rest pose of the animation rig below, in a 1.75 m reference space.
 *
 * The two lead looks (trail jacket / crop jacket) follow the project's concept sheets: curly hair and short beard,
 * aviators, red bandana, open weathered jacket over a dark tee with rolled sleeves, cargo pants with a thigh rig,
 * fingerless gloves, watch, laced boots and a tan tactical pack (with a sleeping mat for the female lead).
 */

// ---------------- rig (bind pose) ----------------
export const BONES = ['hips', 'spine', 'neck', 'head', 'armR', 'elbowR', 'armL', 'elbowL', 'thighR', 'kneeR', 'ankleR', 'thighL', 'kneeL', 'ankleL', 'tail0', 'tail1', 'tail2'] as const;
export const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<typeof BONES[number], number>;
export const HIPS_BIND = 0.95, SPINE_UP = 0.06, NECK_UP = 0.52, HEAD_UP = 0.13, SHOULDER_UP = 0.4, UPPER_ARM = 0.29, THIGH = 0.42, SHIN = 0.42, FOOT_Y = 0.07;
export const TAIL_SEG = 0.12;

export interface RigLayout {
  shoulderX: number; hipX: number;
  /** bind positions of every bone (scale space) */
  pos: Record<typeof BONES[number], V3>;
  /** local offset of each bone from its parent */
  local: Record<typeof BONES[number], V3>;
  parent: Record<typeof BONES[number], typeof BONES[number] | null>;
}

export function rigLayout(a: CharacterAppearance): RigLayout {
  const female = a.body === 'female', W = 0.95 + a.build * 0.16;
  const shoulderX = (female ? 0.162 : 0.18) * (0.95 + a.build * 0.1), hipX = (female ? 0.094 : 0.092) * W;
  const local: RigLayout['local'] = {
    hips: [0, HIPS_BIND, 0], spine: [0, SPINE_UP, 0], neck: [0, NECK_UP, 0], head: [0, HEAD_UP, 0],
    armR: [-shoulderX, SHOULDER_UP, 0], elbowR: [0, -UPPER_ARM, 0], armL: [shoulderX, SHOULDER_UP, 0], elbowL: [0, -UPPER_ARM, 0],
    thighR: [-hipX, -0.04, 0], kneeR: [0, -THIGH, 0], ankleR: [0, -SHIN, 0], thighL: [hipX, -0.04, 0], kneeL: [0, -THIGH, 0], ankleL: [0, -SHIN, 0],
    tail0: [0, 0.03, -0.083], tail1: [0, -TAIL_SEG, -0.012], tail2: [0, -TAIL_SEG, 0.012],
  };
  const parent: RigLayout['parent'] = {
    hips: null, spine: 'hips', neck: 'spine', head: 'neck', armR: 'spine', elbowR: 'armR', armL: 'spine', elbowL: 'armL',
    thighR: 'hips', kneeR: 'thighR', ankleR: 'kneeR', thighL: 'hips', kneeL: 'thighL', ankleL: 'kneeL', tail0: 'head', tail1: 'tail0', tail2: 'tail1',
  };
  const pos = {} as RigLayout['pos'];
  for (const n of BONES) { const p = parent[n]; pos[n] = p ? add(pos[p], local[n]) : local[n]; }
  return { shoulderX, hipX, pos, local, parent };
}

// ---------------- palettes ----------------
interface Outfit { jacket: 'canvas' | 'leather' | 'camo'; body: string; yoke: string; piping: string; tee: string; lace: string; pack: string }
function outfitFor(a: CharacterAppearance): Outfit {
  const v = OUTFIT_VARIANTS[a.variant] ?? OUTFIT_VARIANTS[0], female = a.body === 'female';
  switch (v) {
    case 'yellow': return { jacket: 'canvas', body: '#c9951f', yoke: '#3a3733', piping: '#2a2622', tee: '#262422', lace: female ? '#b3201b' : '#c49a5a', pack: '#a07d45' };
    case 'arctic': return { jacket: 'canvas', body: '#d4d6d8', yoke: '#7d838a', piping: '#5c6168', tee: '#2a2c2e', lace: female ? '#b3201b' : '#9a9ea3', pack: '#a8a49a' };
    case 'camo': return { jacket: 'camo', body: '#ffffff', yoke: '#3b4029', piping: '#2c2f22', tee: '#2b2d24', lace: female ? '#b3201b' : '#6b6447', pack: '#6e6a48' };
    default: return female
      ? { jacket: 'leather', body: '#8c271f', yoke: '#5e1913', piping: '#3a0f0c', tee: '#262423', lace: '#b3201b', pack: '#9c7a45' }
      : { jacket: 'canvas', body: '#6a5638', yoke: '#3a3029', piping: '#7a2a1e', tee: '#2a2826', lace: '#b07b45', pack: '#9c7a45' };
  }
}

/** material keys produced by the builder */
export type MatKey = 'skin' | 'cloth' | 'canvas' | 'leather' | 'camo' | 'bandana' | 'hair' | 'metal' | 'lens' | 'patch' | 'rubber' | `plaid:${string}`;

export interface ModelInfo {
  /** key of the face map and the values to paint it */
  faceKey: string; skinHex: string; hairHex: string; lipsHex: string; irisHex: string; beardShadow: number; female: boolean;
  /** head-local paint mapping */
  toUv: (x: number, y: number) => [number, number] | null;
  fromUv: (px: number, py: number) => [number, number] | null;
  beardMask: (x: number, y: number) => number;
  /** mean albedo multiplier per material key (for the single-material far LODs) */
  mean: Record<string, RGB>;
}

export function buildModel(bd: Builder, a: CharacterAppearance, rig: RigLayout): ModelInfo {
  const female = a.body === 'female', lite = bd.q < 0.6, far = bd.q < 0.35;
  const W = 0.95 + a.build * 0.16, D = 0.94 + a.build * 0.16, limb = 0.92 + a.build * 0.2;
  const skinHex = SKIN_TONES[a.skin], hairHex = HAIR_COLORS[a.hairColor];
  const expedition = a.top === 'trail-jacket' || a.top === 'crop-jacket';
  const fit = outfitFor(a);
  const WHITE: RGB = [1, 1, 1];
  const P = rig.pos;
  const mean: Record<string, RGB> = {
    skin: lin(skinHex), hair: mulc(lin('#b0b0b0'), 1), canvas: mulc(WHITE, 0.62), leather: mulc(WHITE, 0.62), camo: lin('#454b33'),
    bandana: lin('#8f2520'), patch: lin('#6a6258'), cloth: WHITE, metal: WHITE, lens: WHITE, rubber: WHITE,
  };
  const jacketKey: MatKey = a.top === 'flannel' ? `plaid:${CLOTH_COLORS[a.topColor]}` : a.top === 'trail-jacket' || a.top === 'crop-jacket' ? fit.jacket : a.top === 'hoodie' || a.top === 'tee' ? 'cloth' : 'canvas';
  if (jacketKey.startsWith('plaid:')) mean[jacketKey] = mulc(lin(CLOTH_COLORS[a.topColor]), 0.75);

  // ---------- torso surface ----------
  // y, rx, rzFront, rzBack, zOffset, superellipse power
  // shoulders slope from the neck down to the arm sockets (trapezius); athletic V taper (male), hourglass (female)
  const TM = [
    [0.84, 0.158, 0.094, 0.108, -0.006, 2.3], [0.90, 0.172, 0.100, 0.120, -0.006, 2.3], [0.96, 0.164, 0.098, 0.112, -0.002, 2.35],
    [1.03, 0.143, 0.095, 0.098, 0.004, 2.35], [1.12, 0.146, 0.100, 0.096, 0.006, 2.4], [1.22, 0.158, 0.110, 0.098, 0.006, 2.45],
    [1.30, 0.168, 0.118, 0.104, 0.002, 2.5], [1.37, 0.173, 0.112, 0.104, -0.004, 2.5], [1.42, 0.176, 0.096, 0.098, -0.008, 2.45],
    [1.465, 0.142, 0.068, 0.088, -0.016, 2.3], [1.505, 0.084, 0.05, 0.07, -0.014, 2.1], [1.545, 0.058, 0.046, 0.055, -0.01, 2],
  ];
  const TF = [
    [0.84, 0.152, 0.090, 0.114, -0.008, 2.3], [0.90, 0.176, 0.096, 0.130, -0.008, 2.3], [0.96, 0.164, 0.090, 0.114, -0.004, 2.3],
    [1.04, 0.124, 0.080, 0.086, 0, 2.2], [1.10, 0.116, 0.080, 0.084, 0.002, 2.2], [1.18, 0.124, 0.086, 0.087, 0.004, 2.3],
    [1.27, 0.140, 0.092, 0.092, 0.004, 2.4], [1.35, 0.150, 0.090, 0.092, -0.002, 2.45], [1.41, 0.152, 0.078, 0.084, -0.008, 2.4],
    [1.455, 0.122, 0.06, 0.074, -0.013, 2.2], [1.50, 0.076, 0.046, 0.062, -0.012, 2.1], [1.545, 0.050, 0.042, 0.050, -0.01, 2],
  ];
  const T = female ? TF : TM;
  const g2 = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));
  /** point on the torso at height y, angle a (0 = front, +pi/2 = +x), pushed out by `off` metres */
  const torso = (y: number, ang: number, off = 0): V3 => {
    const [rx, rzf, rzb, zo, p] = table(T, y), s = Math.sin(ang), c = Math.cos(ang), e = 2 / p;
    const x = Math.sign(s) * Math.pow(Math.abs(s), e) * (rx * W + off);
    let z = zo + Math.sign(c) * Math.pow(Math.abs(c), e) * ((c >= 0 ? rzf : rzb) * D + off);
    const ax = Math.abs(x);
    if (c > 0) {
      if (female) z += c * (0.04 + a.build * 0.012) * (g2(ax, y, 0.066, 1.29, 0.048, 0.055));
      else z += c * 0.012 * g2(ax, y, 0.075, 1.33, 0.06, 0.05);
    } else {
      z -= -c * (female ? 0.022 : 0.016) * g2(ax, y, 0.07, 0.885, 0.075, 0.06);
      if (!female) z -= -c * 0.01 * g2(ax, y, 0.08, 1.36, 0.06, 0.06);
    }
    return [x, y, z];
  };
  const shoulderSide = (x: number) => (x < 0 ? B.armR : B.armL);
  const torsoW: WeightFn = p => {
    const [x, y] = p, ax = Math.abs(x);
    const hips = 1 - smooth(0.96, 1.09, y), neck = smooth(1.49, 1.56, y) * 0.8;
    const sh = smooth(0.1, 0.19, ax) * smooth(1.3, 1.45, y) * 0.55;
    const th = smooth(0.95, 0.86, y) * smooth(0.02, 0.13, ax) * 0.45;
    const spine = Math.max(0, 1 - hips - neck - sh);
    const w: Weights = [[B.hips, hips * (1 - th)], [B.spine, spine], [B.neck, neck], [shoulderSide(x), sh]];
    if (th > 0) w.push([x < 0 ? B.thighR : B.thighL, hips * th]);
    return w;
  };

  // baked shading: cavities (armpits, under the collar, crotch) and dirt toward the ground
  const MUD = lin('#4a3a28');
  const cavity = (p: V3) => {
    const [x, y, z] = p, ax = Math.abs(x);
    let k = 1;
    k -= 0.22 * g2(ax, y, rig.shoulderX - 0.05, 1.3, 0.04, 0.06) * (z < 0.06 ? 1 : 0.5);
    k -= 0.18 * g2(ax, y, 0, 0.85, 0.05, 0.05);
    return Math.max(0.55, k);
  };
  const dirt = (p: V3, base: RGB, amount: number) => {
    const n = fbm(p, 9, 3) * 0.5 + 0.5;
    const t = clamp01(smooth(0.5, 0.06, p[1]) * amount * (0.4 + n));
    return mixc(base, MUD, t * 0.75);
  };
  const tint = (hex: string, p: V3, vary = 0.08, dirtAmt = 0.6): RGB => mulc(dirt(p, lin(hex), dirtAmt), cavity(p) * (1 + fbm(p, 14, 2) * vary));

  // ---------- garments that make up the torso surface ----------
  const teeHex = a.top === 'tee' ? CLOTH_COLORS[a.topColor] : a.top === 'vest' ? '#d9cfb8' : expedition ? fit.tee : '#2a2826';
  const pantsHex = CLOTH_COLORS[a.pantsColor];
  const closedTop = a.top === 'field-jacket' || a.top === 'hoodie' || a.top === 'flannel';
  const waistY = female ? 1.035 : 1.005, cropY = female && a.top === 'crop-jacket' ? 1.13 : -1;
  const torsoRows = bd.n(34, 10), torsoCols = bd.n(44, 12);
  // bands: [y0, y1, material, colour]
  const topKey: MatKey = closedTop ? jacketKey : 'cloth';
  const topHex = closedTop ? (jacketKey.startsWith('plaid') || jacketKey === 'camo' ? '#ffffff' : CLOTH_COLORS[a.topColor]) : teeHex;
  const bands: [number, number, MatKey, string][] = [[0.84, waistY, 'canvas', pantsHex]];
  if (cropY > 0) { bands.push([waistY - 0.01, cropY, 'skin', '#ffffff']); bands.push([cropY - 0.005, 1.545, 'cloth', teeHex]); }
  else bands.push([waistY - 0.01, 1.545, topKey, topHex]);
  for (const [y0, y1, key, hex] of bands) {
    const rows: V3[][] = [], nr = Math.max(3, Math.round(torsoRows * (y1 - y0) / 0.7));
    for (let i = 0; i <= nr; i++) {
      const y = y0 + (y1 - y0) * (i / nr), r: V3[] = [];
      const loose = y < waistY ? 0.006 : closedTop && key !== 'skin' ? 0.012 : 0;
      for (let j = 0; j < torsoCols; j++) r.push(torso(y, (j / torsoCols) * Math.PI * 2, loose));
      rows.push(r);
    }
    const yoke = closedTop && a.top === 'field-jacket';
    bd.grid(key, rows, {
      closed: true, weights: torsoW, capStart: y0 < 0.85, inside: i => [0, rows[i][0][1], 0],
      color: key === 'skin' ? WHITE : p => tint(yoke && p[1] > 1.38 ? shadeHex(hex, 0.75) : hex, p, 0.1, y0 < 0.85 ? 0.3 : 0),
      uv: key === 'skin' ? () => PLAIN_UV : undefined,
    });
  }

  // ---------- neck ----------
  const H = P.head, neckR = female ? 0.05 : 0.062;
  {
    const rows: V3[][] = [], n = bd.n(16, 6);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, y = 1.47 + t * 0.15;
      rows.push(ring([0, y, -0.008 + t * 0.016], [1, 0, 0], [0, 0, 1], n, { xp: neckR * (1 + 0.15 * (1 - t) ** 3), yp: neckR * 0.95 * (1 + 0.1 * (1 - t) ** 3) }));
    }
    bd.grid('skin', rows, {
      closed: true, color: WHITE, uv: () => PLAIN_UV, inside: i => [0, rows[i][0][1], 0],
      weights: p => { const t = smooth(1.47, 1.6, p[1]); return [[B.spine, 1 - smooth(1.47, 1.53, p[1])], [B.neck, Math.max(0, 1 - Math.abs(t - 0.55) * 2)], [B.head, smooth(1.57, 1.62, p[1])]]; },
    });
  }

  // ---------- head ----------
  const shapes: Record<string, [number, number, number, number]> = { oval: [0.074, 0.114, 0.097, 0.26], square: [0.078, 0.112, 0.098, 0.16], round: [0.08, 0.108, 0.098, 0.2], long: [0.071, 0.12, 0.096, 0.24] };
  const [ha0, hb0, hcd, taper0] = shapes[a.face];
  const ha = ha0 * (female ? 1.0 : 1.04), hb = hb0 * (female ? 0.95 : 1.04), hc = hcd * (female ? 0.97 : 1.04), taper = taper0 + (female ? 0.08 : 0);
  const C: V3 = [0, -0.02, 0.004];
  const features = (x: number, y: number) => {
    const ax = Math.abs(x);
    const t = clamp01((0.03 - y) / 0.058), w = 0.0065 + 0.009 * t;
    let f = (0.003 + (female ? 0.014 : 0.018) * Math.pow(t, 1.4)) * smooth(-0.046, -0.029, y) * Math.exp(-((x / (w * (female ? 0.85 : 1))) ** 2));
    f += 0.007 * g2(ax, y, 0.013, -0.031, 0.007, 0.008);
    f += (female ? 0.004 : 0.008) * Math.exp(-(((y - 0.037) / 0.011) ** 2)) * smooth(0.075, 0.035, ax);
    f -= 0.011 * g2(ax, y, 0.032, 0.014, 0.016, 0.011);
    f += 0.006 * g2(ax, y, 0.05, -0.012, 0.018, 0.018);
    f += 0.006 * g2(x, y, 0, -0.055, 0.022, 0.008) + 0.007 * g2(x, y, 0, -0.07, 0.02, 0.008) - 0.003 * g2(x, y, 0, -0.062, 0.024, 0.003);
    f += (female ? 0.008 : 0.012) * g2(x, y, 0, -0.098, 0.024, 0.018);
    return f;
  };
  const lowK = (uy: number) => smooth(-0.1, -0.85, uy);
  /** head surface at longitude lam (0 = face), colatitude th, in bind space; `feat` adds the face relief */
  const headPt = (lam: number, th: number, feat = true): V3 => {
    const ux = Math.sin(th) * Math.sin(lam), uy = Math.cos(th), uz = Math.sin(th) * Math.cos(lam);
    let x = ha * ux, z = hc * uz;
    const y = hb * uy;
    const lo = lowK(uy);
    x *= 1 - lo * taper + (female ? 0 : 0.05 * g2(0, uy, 0, -0.55, 1, 0.2));
    if (uz < 0) z *= 1 - 0.22 * smooth(-0.3, -0.95, uy);
    z *= 1 - 0.08 * lo;
    if (feat) z += smooth(0.35, 0.8, uz) * features(x, y);
    // under the jaw and at the nape the surface tucks into the neck
    const fr = (Math.cos(lam) + 1) / 2, k = smooth(1.75 + 0.75 * fr, 2.45 + 0.6 * fr, th);
    if (k > 0) {
      const nr = neckR * 1.04, nz = 0.006 - C[2];
      x += (Math.sin(lam) * nr * 1.08 - x) * k; z += (nz + Math.cos(lam) * nr - z) * k;
    }
    return [C[0] + x + H[0], C[1] + y + H[1], C[2] + z + H[2]];
  };
  const toUv = (x: number, y: number): [number, number] | null => {
    const uy = Math.max(-1, Math.min(1, y / hb)), th = Math.acos(uy), lo = lowK(uy);
    const ax = ha * Math.sin(th) * (1 - lo * taper + (female ? 0 : 0.05 * g2(0, uy, 0, -0.55, 1, 0.2)));
    const s = Math.max(-1, Math.min(1, x / Math.max(1e-4, ax))), lam = Math.asin(s);
    return [(0.5 + lam / (Math.PI * 2)) * 1024, (th / Math.PI) * 512];
  };
  const fromUv = (px: number, py: number): [number, number] | null => {
    const lam = (px / 1024 - 0.5) * Math.PI * 2, th = (py / 512) * Math.PI;
    if (Math.abs(lam) > 1.5) return null;
    const uy = Math.cos(th), lo = lowK(uy);
    return [ha * Math.sin(th) * Math.sin(lam) * (1 - lo * taper + (female ? 0 : 0.05 * g2(0, uy, 0, -0.55, 1, 0.2))), hb * uy];
  };
  const headW: Weights = [[B.head, 1]];
  {
    const R = bd.n(44, 12), Cn = bd.n(56, 14), th0 = 0.03, th1 = 3.0, rows: V3[][] = [];
    for (let i = 0; i <= R; i++) {
      const th = th0 + (th1 - th0) * (i / R), r: V3[] = [];
      for (let j = 0; j < Cn; j++) r.push(headPt(-Math.PI + (j / Cn) * Math.PI * 2, th));
      rows.push(r);
    }
    bd.grid('skin', rows, {
      closed: true, weights: p => (p[1] < H[1] - 0.115 ? [[B.head, 0.6], [B.neck, 0.4]] : headW), color: WHITE, inside: [C[0] + H[0], C[1] + H[1], C[2] + H[2]],
      uv: (i, j) => [j / Cn, (th0 + (th1 - th0) * (i / R)) / Math.PI],
    });
    // eyes (sclera and iris from the face map's eye square)
    if (false as boolean) for (const sx of [-1, 1]) {
      const ex = sx * 0.032, ey = 0.014, zf = hc * Math.sqrt(Math.max(0, 1 - (ex / ha) ** 2 - (ey / hb) ** 2)) - 0.0135, r = 0.0125;
      const c: V3 = [C[0] + ex + H[0], C[1] + ey + H[1], C[2] + zf + H[2]], erows: V3[][] = [], n = bd.n(12, 6);
      for (let i = 0; i <= n; i++) { const th = 0.05 + (Math.PI - 0.1) * (i / n); erows.push(ring(add(c, [0, 0, r * Math.cos(th)]), [1, 0, 0], [0, 1, 0], n * 2, { xp: r * Math.sin(th), yp: r * Math.sin(th) })); }
      bd.grid('skin', erows, {
        closed: true, weights: headW, color: WHITE, inside: c,
        uv: (_i, _j, p) => [EYE_UV.u0 + ((p[0] - c[0]) / r * 0.5 + 0.5) * EYE_UV.size / 1024, EYE_UV.v0 + ((p[1] - c[1]) / r * 0.5 + 0.5) * EYE_UV.size / 512],
      });
    }
    // ears: a cupped shell tilted back
    for (const sx of [-1, 1]) {
      const c: V3 = [C[0] + sx * (ha * 0.93 + 0.006) + H[0], C[1] - 0.002 + H[1], C[2] - 0.012 + H[2]], n = bd.n(10, 5);
      const erows = ellipsoidRows(c, [0.008, 0.029, 0.018], n, n * 2, (th, ph) => 1 + 0.15 * Math.sin(th) * (Math.cos(ph) > 0 ? 0 : 1) - 0.25 * Math.max(0, Math.sin(ph) * sx) * Math.sin(th) ** 4,
        [1, 0, 0], [0, Math.cos(0.2), Math.sin(0.2)], [0, -Math.sin(0.2), Math.cos(0.2)]);
      bd.grid('skin', erows, { closed: true, weights: headW, color: mulc(WHITE, 0.92), uv: () => PLAIN_UV, inside: c });
    }
  }

  // ---------- hair, beard ----------
  const hairCol = lin(hairHex);
  const hairEdge = (lam: number) => {
    const L = Math.abs(lam);
    const base = table([[0, female ? 0.64 : 0.74], [0.45, female ? 0.72 : 0.8], [0.8, 0.98], [1.1, 1.24], [1.35, 1.38], [1.6, 1.42], [2.1, 1.74], [Math.PI, a.hair === 'short' || a.hair === 'buzz' ? 1.95 : 2.05]], L)[0];
    return base;
  };
  const hatEdge = a.headwear === 'cap' ? 1.25 : a.headwear === 'beanie' ? 1.5 : a.headwear === 'bush-hat' ? 1.3 : a.headwear === 'helmet' ? 1.45 : 0;
  const hc0 = [C[0] + H[0], C[1] + H[1], C[2] + H[2]] as V3;
  /** a shell over the scalp: thickness(lam, th, t), t = 0 at the crown .. 1 at the hairline */
  const scalpShell = (key: MatKey, thick: (lam: number, th: number, t: number, base: V3) => number, edge: (lam: number) => number, color: RGB | ((p: V3) => RGB), rowsN = 22, colsN = 52) => {
    const R = bd.n(rowsN, 6), Cn = bd.n(colsN, 12), rows: V3[][] = [];
    for (let i = 0; i <= R; i++) {
      const t = i / R, r: V3[] = [];
      for (let j = 0; j < Cn; j++) {
        const lam = -Math.PI + (j / Cn) * Math.PI * 2, th = 0.02 + (edge(lam) - 0.02) * t;
        const b = headPt(lam, th, th > 1.1), n = norm(sub(b, hc0));
        r.push(add(b, scl(n, Math.max(0.0012, thick(lam, th, t, b)))));
      }
      rows.push(r);
    }
    bd.grid(key, rows, { closed: true, weights: headW, color: typeof color === 'function' ? (p: V3) => color(p) : color, inside: hc0 });
  };
  const hairT = (th: number, T: number) => (hatEdge && th < hatEdge + 0.1 ? Math.min(T, 0.006) : T);
  const strands = (p: V3) => mulc(hairCol, 0.8 + fbm(p, 40, 2) * 0.45 + Math.max(0, fbm(p, 12, 2)) * 0.6);
  switch (a.hair) {
    case 'curly': {
      // a voluminous mass of rounded clumps (billow noise) plus loose curls along the hairline and crown
      const billow = (p: V3, f: number) => { let sum = 0, amp = 1, k = f; for (let i = 0; i < 3; i++) { sum += (1 - Math.abs(noise3(p[0] * k, p[1] * k, p[2] * k))) * amp; amp *= 0.5; k *= 2.1; } return sum / 1.75; };
      const edgeFn = (lam: number) => hairEdge(lam) + noise3(lam * 3, 0, 1) * 0.05 - (Math.abs(lam) < 0.6 ? 0.03 : 0);
      const thickAt = (th: number, t: number, b: V3) => {
        const T = table([[0, 0.044], [0.8, 0.042], [1.25, 0.026], [1.6, 0.016], [2.0, 0.013]], th)[0], e = 1 - smooth(0.7, 1, t) * 0.88;
        return hairT(th, T * e + (billow(b, 34) - 0.55) * 0.024 * e);
      };
      scalpShell('hair', (_l, th, t, b) => thickAt(th, t, b), edgeFn, strands, 30, 72);
      if (!hatEdge && !far) {
        const count = lite ? 14 : 48;
        for (let k = 0; k < count; k++) {
          const fringe = k < (lite ? 6 : 16);
          const lam = fringe ? -0.95 + 1.9 * ((k + 0.5) / (lite ? 6 : 16)) + noise3(k, 7, 1) * 0.08 : noise3(k * 1.37, 2, 5) * Math.PI;
          const th = fringe ? edgeFn(lam) - 0.12 - (k % 3) * 0.04 : (0.12 + (((k * 0.618) % 1) ** 0.8) * 0.8) * edgeFn(lam);
          const t = th / Math.max(0.3, edgeFn(lam)), b = headPt(lam, th, false), n = norm(sub(b, hc0));
          const c = add(b, scl(n, thickAt(th, Math.min(1, t), b) * (fringe ? 0.55 : 0.8) + 0.004));
          const r = (fringe ? 0.0095 : 0.012) + ((k * 0.61) % 1) * 0.005;
          const down: V3 = fringe ? norm([0, -1, 0.35]) : [0, 1, 0];
          const side = norm(cross(down, n)), fwd = norm(cross(side, down));
          const crows = ellipsoidRows(fringe ? add(c, scl(down, r * 0.5)) : c, [r, r * (fringe ? 1.5 : 1.1), r * 0.9], 6, 9,
            (tt, ph) => 1 + 0.18 * Math.sin(ph * 3 + k + tt * 4), side, down, fwd);
          bd.grid('hair', crows, { closed: true, weights: headW, color: strands, inside: c });
        }
      }
      break;
    }
    case 'short': scalpShell('hair', (_l, th, t) => hairT(th, 0.014 * (1 - smooth(0.75, 1, t) * 0.9)), hairEdge, strands); break;
    case 'buzz': scalpShell('hair', (_l, _th, t) => 0.0035 * (1 - t * 0.5), hairEdge, p => mixc(strands(p), lin(skinHex), 0.35)); break;
    case 'swept': scalpShell('hair', (lam, th, t) => hairT(th, (0.016 + 0.02 * g2(lam, th, 0, 0.75, 0.5, 0.35)) * (1 - smooth(0.75, 1, t) * 0.9)), hairEdge, strands); break;
    case 'bald': break;
    default: {
      // long, ponytail, bun: sleek cap pulled back
      scalpShell('hair', (lam, th, t) => {
        const L = Math.abs(lam);
        const vol = (a.hair === 'long' ? 0.017 : 0.013) + 0.009 * g2(L, th, 1.25, 1.2, 0.45, 0.45) + 0.008 * g2(L, th, 0, 0.55, 0.7, 0.4);
        const comb = 0.0022 * Math.abs(Math.sin(lam * 21 + th * 2.5)) - 0.004 * g2(lam, t, 0.28, 0.2, 0.05, 0.35);
        return hairT(th, (vol + comb) * (1 - smooth(0.8, 1, t) * 0.82) + 0.002);
      }, lam => hairEdge(lam) + (a.hair === 'long' ? 0.12 * smooth(1.6, 2.4, Math.abs(lam)) : 0), strands);
      if (a.hair === 'long' && !hatEdge) {
        // back curtain down to the shoulders
        const rows: V3[][] = [], n = bd.n(10, 4), m = bd.n(22, 8);
        for (let i = 0; i <= n; i++) {
          const t = i / n, r: V3[] = [];
          for (let j = 0; j <= m; j++) {
            const lam = Math.PI * (0.45 + 1.1 * (j / m)), L = lam > Math.PI ? lam - Math.PI * 2 : lam;
            const top = headPt(L, 1.9, false), n2 = norm(sub(top, hc0));
            r.push(add(add(top, scl(n2, 0.012 + 0.02 * t)), [0, -t * 0.26, -t * 0.03]));
          }
          rows.push(r);
        }
        bd.grid('hair', rows, { weights: p => (p[1] > H[1] - 0.1 ? headW : [[B.head, 0.5], [B.neck, 0.3], [B.spine, 0.2]]), color: strands, inside: [0, H[1] - 0.05, H[2] + 0.02] });
      }
      if (a.hair === 'bun' && !hatEdge) {
        const c = add(headPt(Math.PI, 0.75, false), [0, 0.02, -0.035]), rows: V3[][] = [], n = bd.n(10, 5);
        for (let i = 0; i <= n; i++) { const tt = 0.1 + (Math.PI - 0.2) * (i / n); rows.push(ring(add(c, [0, 0.042 * Math.cos(tt), 0]), [1, 0, 0], [0, 0, 1], n * 2, { xp: 0.048 * Math.sin(tt), yp: 0.044 * Math.sin(tt) }, ang => 1 + 0.06 * Math.sin(ang * 5))); }
        bd.grid('hair', rows, { closed: true, weights: headW, color: strands, inside: c });
      }
      if (a.hair === 'ponytail' && !(a.headwear === 'helmet' || a.headwear === 'beanie')) {
        const tie: V3 = add(P.tail0, [0, 0, 0.004]);
        // scrunchie
        {
          const rows: V3[][] = [], n = bd.n(8, 4);
          for (let i = 0; i <= n; i++) { const t = i / n, ang = t * Math.PI * 2; rows.push(ring(add(tie, [0, Math.sin(ang) * 0.008, -0.012 + Math.cos(ang) * 0.008]), [1, 0, 0], [0, 1, 0], bd.n(14, 6), { xp: 0.026 + Math.cos(ang) * 0.008, yp: 0.022 + Math.cos(ang) * 0.008 })); }
          bd.grid('cloth', rows, { closed: true, weights: [[B.tail0, 1]], color: lin(expedition ? '#9e1d18' : CLOTH_COLORS[a.topColor]), inside: tie });
        }
        // the tail: a main lock plus loose strands winding around it, rigged on three bones
        const path = spline([add(tie, [0, 0.004, -0.01]), add(tie, [0, -0.04, -0.035]), add(P.tail1, [0, 0, -0.028]), add(P.tail2, [0, 0, -0.022]), add(P.tail2, [0, -0.09, -0.01]), add(P.tail2, [0.006, -0.15, 0.0])], bd.n(26, 8));
        const tailW = (p: V3): Weights => {
          const d = P.tail0[1] - p[1];
          const w0 = 1 - smooth(0.02, TAIL_SEG + 0.02, d), w2 = smooth(TAIL_SEG + 0.02, TAIL_SEG * 2 + 0.03, d);
          return [[B.tail0, w0], [B.tail1, Math.max(0, 1 - w0 - w2)], [B.tail2, w2]];
        };
        const fr = frames(path, [1, 0, 0]);
        const lock = (radius: (t: number) => number, offset: (t: number) => [number, number], segs: number) => {
          const rows: V3[][] = [];
          fr.forEach(([p, , n, b], i) => { const t = i / (fr.length - 1), [ox, oy] = offset(t); rows.push(ring(add(add(p, scl(n, ox)), scl(b, oy)), n, b, segs, { xp: radius(t), yp: radius(t) * 0.85 }, ang => 1 + 0.12 * Math.sin(ang * 4 + t * 9))); });
          bd.grid('hair', rows, { closed: true, weights: tailW, color: strands, capEnd: true });
        };
        lock(t => 0.018 + 0.026 * Math.sin(Math.min(1, t * 2.0) * Math.PI * 0.7) * (1 - t * 0.8) + 0.005 * (1 - t), () => [0, 0], bd.n(16, 6));
        if (!lite) for (let k = 0; k < 8; k++) lock(t => (0.012 - 0.008 * t) * (k % 2 ? 0.85 : 1.1), t => [Math.cos(k * 0.785 + t * 3.2) * (0.026 * (1 - t * 0.7) + 0.006), Math.sin(k * 0.785 + t * 3.2) * (0.024 * (1 - t * 0.7) + 0.005)], 6);
        // strands framing the face
        if (!lite) for (const sx of [-1, 1]) for (let k = 0; k < 1; k++) {
          const l0 = sx * 0.8, o = 0.01;
          const pts = [0.62, 1.0, 1.35, 1.7, 2.02].map((th, i) => add(headPt(l0 + sx * (0.15 + i * 0.07), th + k * 0.06, false), [sx * (o + 0.006 * Math.sin(i * 1.9 + k)), -0.004 * i, 0.004 * Math.cos(i * 2.1 + k)]));
          const path2 = spline(pts, 14), rows: V3[][] = [];
          frames(path2, [0, 0, 1]).forEach(([p, , n, b], i) => { const t = i / 13; rows.push(ring(p, n, b, 6, { xp: 0.016 * (1 - t * 0.6), yp: 0.0045 }, ang => 1 + 0.15 * Math.sin(ang * 3 + t * 7))); });
          bd.grid('hair', rows, { closed: true, weights: headW, color: strands, capEnd: true });
        }
      }
    }
  }
  const beardShadow = a.beard === 'none' ? 0 : a.beard === 'stubble' ? 1 : 2;
  const mask = (x: number, y: number) => {
    if (a.beard === 'none') return 0;
    const ax = Math.abs(x);
    let top = -0.036 + (ax / ha) * 0.02 + smooth(0.066, 0.078, ax) * 0.04;
    if (a.beard === 'goatee') top = -0.075;
    let m = smooth(top, top - 0.012, y);
    const lip = g2(x, y, 0, -0.064, 0.026, 0.011);
    m *= 1 - smooth(0.35, 0.75, lip);
    const stache = g2(x, y, 0, -0.046, 0.03, 0.006);
    m = Math.max(m, smooth(0.3, 0.6, stache) * (a.beard === 'stubble' ? 0.8 : 1));
    if (a.beard === 'goatee') m *= smooth(0.04, 0.03, ax);
    return m;
  };
  if (a.beard !== 'none' && a.beard !== 'stubble') {
    const T = a.beard === 'full' ? 0.02 : a.beard === 'short' ? 0.0075 : 0.007;
    const R = bd.n(34, 8), Cn = bd.n(84, 16), rows: V3[][] = [], ms: number[][] = [];
    for (let i = 0; i <= R; i++) {
      const th = 1.45 + (2.75 - 1.45) * (i / R), r: V3[] = [], mr: number[] = [];
      for (let j = 0; j <= Cn; j++) {
        const lam = -1.62 + 3.24 * (j / Cn), b = headPt(lam, th), lx = b[0] - H[0] - C[0], ly = b[1] - H[1] - C[1];
        const m = mask(lx, ly) * smooth(-0.13, -0.09, ly) ** 0.3 * smooth(1.62, 1.35, Math.abs(lam)), n = norm(sub(b, [hc0[0], hc0[1] + 0.02, hc0[2] - 0.02]));
        mr.push(m);
        r.push(add(b, scl(n, -0.0016 + smooth(0.08, 0.35, m) * 0.0026 + Math.pow(m, 1.5) * T * (0.75 + fbm(b, 60, 2) * 0.6))));
      }
      rows.push(r); ms.push(mr);
    }
    bd.grid('hair', rows, { weights: headW, color: strands, inside: hc0, keep: (i, j) => Math.max(ms[i][j], ms[i][j + 1] ?? 0, ms[i + 1]?.[j] ?? 0, ms[i + 1]?.[j + 1] ?? 0) > 0.02 });
  }

  // ---------- headwear ----------
  if (a.headwear !== 'none') {
    const hw = CLOTH_COLORS[a.headwearColor], above = a.hair === 'bald' ? 0.004 : 0.011;
    const edge = () => hatEdge;
    if (a.headwear === 'cap' || a.headwear === 'beanie' || a.headwear === 'helmet') {
      const T = a.headwear === 'helmet' ? 0.03 : a.headwear === 'beanie' ? 0.016 : 0.008;
      scalpShell(a.headwear === 'helmet' ? 'metal' : 'cloth', (_l, _th, t) => above + T * (1 - t * 0.2), edge, p => tint(hw, p, 0.06, 0), 14, 40);
    }
    if (a.headwear === 'cap') {
      const rows: V3[][] = [];
      for (let i = 0; i <= 4; i++) { const t = i / 4, r: V3[] = []; for (let j = 0; j <= 10; j++) { const lam = -0.95 + 1.9 * (j / 10), b = headPt(lam, 1.25, false), n = norm(sub(b, hc0)); r.push(add(add(b, scl(n, above + 0.008 + t * 0.07 * Math.cos(lam * 0.9))), [0, -t * 0.012, 0])); } rows.push(r); }
      bd.grid('cloth', rows, { weights: headW, color: lin(hw), inside: add(hc0, [0, 0.1, 0]) });
    } else if (a.headwear === 'bush-hat') {
      const rows: V3[][] = [], n = bd.n(28, 10);
      const crown = (y: number, r: number) => ring(add(hc0, [0, y, 0]), [1, 0, 0], [0, 0, 1], n, { xp: r * ha / 0.075, yp: r * hc / 0.098 });
      rows.push(crown(0.065, 0.11), crown(0.095, 0.105), crown(0.12, 0.098));
      bd.grid('cloth', rows, { closed: true, weights: headW, color: lin(hw), capEnd: true });
      const brim: V3[][] = [crown(0.07, 0.112), crown(0.055, 0.17), crown(0.04, 0.18)];
      bd.grid('cloth', brim, { closed: true, weights: headW, color: mulc(lin(hw), 0.9), inside: add(hc0, [0, 0.2, 0]) });
    }
  }

  // ---------- arms, hands ----------
  const sleeve = (() => {
    switch (a.top) {
      case 'trail-jacket': return { end: 0.335, key: jacketKey, roll: true, off: 0.009 };
      case 'crop-jacket': return { end: 0.33, key: jacketKey, roll: true, off: 0.007 };
      case 'tee': return { end: 0.13, key: 'cloth' as MatKey, roll: false, off: 0.01 };
      case 'vest': return { end: 0.1, key: 'cloth' as MatKey, roll: false, off: 0.008 };
      default: return { end: 0.51, key: jacketKey, roll: false, off: 0.014 };
    }
  })();
  const jacketColor = (p: V3, yokeLine: number) => {
    if (jacketKey === 'cloth' || jacketKey.startsWith('plaid')) return tint(a.top === 'hoodie' || a.top === 'tee' ? CLOTH_COLORS[a.topColor] : '#ffffff', p, 0.06, 0);
    if (!expedition) return tint(jacketKey === 'camo' ? '#ffffff' : CLOTH_COLORS[a.topColor], p, 0.08, 0);
    const y = p[1];
    const hex = y > yokeLine + 0.006 ? fit.yoke : y > yokeLine - 0.006 ? fit.piping : fit.body;
    return tint(hex, p, 0.12, 0);
  };
  const armProfile = [[-0.062, 0.014, 0.016], [-0.052, 0.03, 0.033], [-0.036, 0.042, 0.045], [-0.018, 0.049, 0.051], [0.0, 0.052, 0.053], [0.05, 0.052, 0.052], [0.1, 0.048, 0.05], [0.16, 0.045, 0.05], [0.235, 0.042, 0.044], [0.29, 0.037, 0.038], [0.33, 0.043, 0.041], [0.38, 0.042, 0.038], [0.45, 0.034, 0.03], [0.53, 0.027, 0.021]];
  const fa = female ? 0.86 : 1;
  for (const [side, sx] of [[0, -1], [1, 1]] as const) {
    const S = side === 0 ? P.armR : P.armL, bArm = side === 0 ? B.armR : B.armL, bEl = side === 0 ? B.elbowR : B.elbowL;
    const armW: WeightFn = p => {
      const d = S[1] - p[1];
      const el = smooth(0.24, 0.33, d), sp = smooth(0.02, -0.07, d) * 0.45;
      return [[B.spine, sp], [bArm, Math.max(0, 1 - el - sp)], [bEl, el]];
    };
    const centre = (d: number): V3 => [S[0] + sx * (0.006 * smooth(-0.05, 0.0, d) * smooth(0.16, 0.04, d) - 0.022 * smooth(-0.01, -0.062, d)), S[1] - d, d > 0.29 ? (d - 0.29) * 0.03 : 0];
    const n = bd.n(18, 6);
    const armRing = (d: number, extra: number) => {
      const [rx, rz] = table(armProfile, d);
      return ring(centre(d), [1, 0, 0], [0, 0, 1], n, { xp: (rx * limb * fa + extra), yp: (rz * limb * fa + extra) });
    };
    const ds = (d0: number, d1: number, k: number) => Array.from({ length: k + 1 }, (_, i) => d0 + (d1 - d0) * (i / k));
    // sleeve (or the shoulder cap of a sleeveless top)
    const sl: V3[][] = [];
    for (const d of [-0.062, -0.052, -0.036, -0.018, ...ds(0, sleeve.end, bd.n(14, 5))]) sl.push(armRing(d, sleeve.off * smooth(-0.062, -0.03, d)));
    if (sleeve.roll) for (const [dd, ex] of [[0.006, 0.012], [0.017, 0.015], [0.028, 0.012], [0.034, 0.003]] as const) sl.push(armRing(sleeve.end + dd, ex));
    else sl.push(armRing(sleeve.end + 0.004, sleeve.off * 0.4));
    const yokeLine = S[1] - 0.075;
    bd.grid(sleeve.key, sl, { closed: true, capStart: true, weights: armW, color: p => (sleeve.key === 'cloth' && (a.top === 'tee' || a.top === 'vest') ? tint(teeHex, p, 0.08, 0) : jacketColor(p, yokeLine)), inside: i => centre(S[1] - sl[i][0][1]) });
    // bare arm below the sleeve
    const ar: V3[][] = [];
    const d0 = a.top === 'vest' ? -0.05 : sleeve.end - 0.02;
    for (const d of ds(d0, 0.535, bd.n(12, 4))) ar.push(armRing(d, 0));
    bd.grid('skin', ar, { closed: true, weights: armW, color: WHITE, uv: () => PLAIN_UV, inside: i => centre(S[1] - ar[i][0][1]) });
    // shoulder patch
    if (expedition && !far) {
      const d0p = 0.05, rows: V3[][] = [];
      for (let i = 0; i <= 2; i++) {
        const d = d0p + i * 0.04, [rx, rz] = table(armProfile, d), c = centre(d), r: V3[] = [];
        for (let j = 0; j <= 3; j++) { const ang = (sx > 0 ? Math.PI / 2 : -Math.PI / 2) + (j / 3 - 0.5) * 0.9; r.push([c[0] + Math.sin(ang) * (rx * limb * fa + sleeve.off + 0.003), c[1], c[2] + Math.cos(ang) * (rz * limb * fa + sleeve.off + 0.003)]); }
        rows.push(r);
      }
      bd.grid('patch', rows, { weights: armW, color: WHITE, inside: centre(0.09), uv: (i, j) => [(sx > 0 ? 1 - j / 3 : j / 3) * 0.5, (i / 2) * 0.5] });
    }
    // hand: palm facing the thigh, fingers relaxed
    const wristY = S[1] - 0.53, hx = S[0], hz = 0.017;
    const handW: Weights = [[bEl, 1]];
    const gloveKey: MatKey = a.gloves === 'none' ? 'skin' : 'leather', gloveHex = a.gloves === 'work' ? '#9a7748' : '#2a2421';
    const gcol = (p: V3): RGB => (a.gloves === 'none' ? WHITE : tint(gloveHex, p, 0.15, 0));
    const guv = a.gloves === 'none' ? () => PLAIN_UV : undefined;
    const palm: V3[][] = [];
    const pk = bd.n(8, 4);
    for (let i = 0; i <= pk; i++) {
      const t = i / pk, y = wristY - t * 0.095 * fa;
      const wz = (0.024 + 0.018 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2)) * fa, wx = (0.016 - 0.003 * t) * fa;
      palm.push(ring([hx - sx * 0.004 * t, y, hz], [1, 0, 0], [0, 0, 1], bd.n(14, 6), { xp: wx, yp: wz, p: 2.4 }));
    }
    bd.grid(gloveKey, palm, { closed: true, weights: handW, color: gcol, uv: guv, capEnd: far, inside: i => [hx, palm[i][0][1], hz] });
    if (a.gloves !== 'none' && !far) {
      const cuff: V3[][] = [];
      for (const [dy, ex] of [[0.012, 0.003], [0.0, 0.006], [-0.02, 0.006], [-0.026, 0.002]] as const) cuff.push(ring([hx, wristY + dy, hz * 0.6], [1, 0, 0], [0, 0, 1], bd.n(14, 6), { xp: 0.02 * fa + ex, yp: 0.026 * fa + ex }));
      bd.grid('leather', cuff, { closed: true, weights: handW, color: p => tint('#1e1a18', p, 0.1, 0) });
    }
    if (!far) {
      const knuckleY = wristY - 0.095 * fa, fz = [0.024, 0.008, -0.008, -0.023], fl = [0.07, 0.078, 0.073, 0.058], fr = [0.0102, 0.0106, 0.0098, 0.0088];
      const fingerCount = lite ? 2 : 4;
      for (let f = 0; f < 4; f += 4 / fingerCount) {
        const L = fl[f] * fa, r0 = fr[f] * fa * (lite ? 1.9 : 1);
        const pts: V3[] = [[hx - sx * 0.003, knuckleY + 0.008, hz + fz[f] * fa * (lite ? 1.4 : 1)]];
        let ang = 0.15, cur = pts[0];
        for (let s = 0; s < 3; s++) { ang += [0.3, 0.45, 0.4][s]; const seg = L * [0.45, 0.3, 0.25][s]; cur = add(cur, [-sx * Math.sin(ang) * seg, -Math.cos(ang) * seg, 0]); pts.push(cur); }
        const path = spline(pts, bd.n(9, 4)), fr2 = frames(path, [0, 0, 1]);
        const cut = a.gloves === 'fingerless' ? 0.4 : a.gloves === 'work' ? 1.01 : -1;
        const rowsA: V3[][] = [], rowsB: V3[][] = [];
        fr2.forEach(([p, , nn, bb], i) => {
          const t = i / (fr2.length - 1), r = r0 * (1 - t * 0.25) * (t > 0.92 ? 0.7 : 1);
          const g = t <= cut + 0.06;
          if (g && cut > 0) rowsA.push(ring(p, nn, bb, bd.n(8, 4), { xp: r + 0.0016, yp: r + 0.0016 }));
          if (t >= cut - 0.02 || cut < 0) rowsB.push(ring(p, nn, bb, bd.n(8, 4), { xp: r, yp: r }));
        });
        if (rowsA.length > 1) bd.grid('leather', rowsA, { closed: true, weights: handW, color: gcol, capEnd: cut > 1 });
        if (rowsB.length > 1) bd.grid('skin', rowsB, { closed: true, weights: handW, color: WHITE, uv: () => PLAIN_UV, capEnd: true });
      }
      // thumb
      const tp = spline([[hx - sx * 0.012, wristY - 0.03, hz + 0.03 * fa], [hx - sx * 0.025, wristY - 0.058, hz + 0.045 * fa], [hx - sx * 0.032, wristY - 0.085, hz + 0.042 * fa]], bd.n(7, 4));
      const thumbRows: V3[][] = [];
      frames(tp, [1, 0, 0]).forEach(([p, , nn, bb], i) => { const t = i / (tp.length - 1); thumbRows.push(ring(p, nn, bb, bd.n(8, 4), { xp: 0.011 * fa * (1 - t * 0.3), yp: 0.01 * fa * (1 - t * 0.3) })); });
      bd.grid(a.gloves === 'work' ? 'leather' : 'skin', thumbRows, { closed: true, weights: handW, color: a.gloves === 'work' ? gcol : WHITE, uv: a.gloves === 'work' ? undefined : () => PLAIN_UV, capEnd: true });
      // knuckle pads on the back of the glove
      if (a.gloves === 'fingerless' && !lite) for (let f = 0; f < 4; f++) {
        const c: V3 = [hx + sx * 0.014 * fa, knuckleY + 0.004, hz + fz[f] * fa], rows: V3[][] = [];
        for (let i = 0; i <= 4; i++) { const t = i / 4; rows.push(ring(add(c, [sx * 0.005 * Math.sin(t * Math.PI), 0, (t - 0.5) * 0.016]), [0, 1, 0], [sx, 0, 0], 6, { xp: 0.008 * Math.sin(0.3 + t * 2.5), yp: 0.004 * Math.sin(0.3 + t * 2.5) })); }
        bd.grid('leather', rows, { closed: true, weights: handW, color: p => tint('#151312', p, 0.1, 0), inside: c });
      }
    }
    // watch on the left wrist
    if (sx > 0 && a.accessories.includes('watch') && !far) {
      const wy = wristY + 0.035, band: V3[][] = [];
      for (const [dy, ex] of [[0.009, 0.0], [0.008, 0.004], [-0.008, 0.004], [-0.009, 0.0]] as const) band.push(ring([hx, wy + dy, 0.005], [1, 0, 0], [0, 0, 1], bd.n(14, 6), { xp: 0.029 * fa * limb + ex, yp: 0.026 * fa * limb + ex }));
      bd.grid('leather', band, { closed: true, weights: handW, color: lin('#1c1b1a') });
      if (!lite) {
        const fc: V3 = [hx + sx * (0.029 * fa * limb + 0.007), wy, 0.005], face: V3[][] = [];
        for (const [ox, r] of [[-0.004, 0.017], [0.0, 0.019], [0.003, 0.018], [0.0035, 0.0]] as const) face.push(ring(add(fc, [sx * ox, 0, 0]), [0, 1, 0], [0, 0, 1], 16, { xp: r, yp: r }));
        bd.grid('metal', face, { closed: true, weights: handW, color: lin('#3a3a3c'), inside: add(fc, [-sx * 0.02, 0, 0]) });
      }
    }
  }

  // ---------- legs ----------
  const LEG = [[1.0, 0.078, 0.076, 0.09, 0.0, -0.005], [0.9, 0.083, 0.08, 0.097, 0.004, -0.006], [0.8, 0.077, 0.074, 0.084, 0.005, 0.0], [0.68, 0.068, 0.067, 0.072, 0.004, 0.004],
    [0.56, 0.058, 0.06, 0.058, 0.0, 0.006], [0.49, 0.052, 0.058, 0.052, 0.0, 0.01], [0.42, 0.054, 0.054, 0.064, 0.0, 0.002], [0.36, 0.055, 0.052, 0.066, 0.0, -0.004], [0.3, 0.051, 0.05, 0.058, 0.0, -0.004],
    [0.255, 0.05, 0.05, 0.052, 0.0, -0.002], [0.215, 0.057, 0.058, 0.058, 0, 0], [0.19, 0.052, 0.052, 0.052, 0, 0], [0.16, 0.048, 0.048, 0.048, 0, 0]];
  const bootTop = a.boots === 'tall' ? 0.3 : 0.2;
  for (const [side, sx] of [[0, -1], [1, 1]] as const) {
    const Tn = side === 0 ? P.thighR : P.thighL, bT = side === 0 ? B.thighR : B.thighL, bK = side === 0 ? B.kneeR : B.kneeL, bA = side === 0 ? B.ankleR : B.ankleL;
    const legW: WeightFn = p => {
      const y = p[1];
      const hips = smooth(0.85, 0.99, y) * 0.8, knee = smooth(0.54, 0.45, y), ank = smooth(0.2, 0.15, y) * 0.6;
      return [[B.hips, hips], [bT, Math.max(0, 1 - hips - knee)], [bK, knee * (1 - ank)], [bA, knee * ank]];
    };
    const legAt = (y: number, extra = 0) => {
      const shift = bootTop > 0.25 ? 0 : 0;
      const [rl, rf, rb, dx, dz] = table(LEG, y + shift), k = female ? 0.95 - 0.07 * smooth(0.8, 0.5, y) : 1;
      return { c: [Tn[0] + sx * dx * W, y, dz] as V3, rl: rl * limb * k * W + extra, rf: rf * limb * k + extra, rb: rb * limb * k + extra };
    };
    const n = bd.n(22, 8), rows: V3[][] = [];
    const yBottom = bootTop - 0.04, steps = bd.n(26, 8);
    for (let i = 0; i <= steps; i++) {
      const y = 1.0 - (1.0 - yBottom) * (i / steps);
      const L = legAt(bootTop > 0.25 && y < 0.36 ? Math.max(y, 0.26) - 0.1 * smooth(0.36, 0.26, y) : y);
      const blouse = bootTop > 0.25 ? 0 : 0;
      rows.push(ring(L.c, [sx, 0, 0], [0, 0, 1], n, { xp: L.rl + blouse, xn: L.rl * 0.92, yp: L.rf, yn: L.rb, p: 2.2 }, ang => {
        // cloth: soft vertical drape, bunching behind the knee and stacking above the boot
        const back = Math.max(0, -Math.cos(ang)), front = Math.max(0, Math.cos(ang));
        const knee = Math.exp(-(((y - 0.47) / 0.05) ** 2)) * (0.6 * back + 0.25), stack = smooth(bootTop + 0.13, bootTop + 0.01, y);
        return 1 + 0.012 * Math.sin(ang * 6 + y * 40) + 0.035 * knee * Math.max(0, Math.sin(y * 150 + ang)) + 0.06 * stack * (0.4 + 0.6 * Math.max(0, Math.sin(y * 120 + ang * 2))) * (0.6 + 0.4 * front)
          + 0.02 * smooth(0.8, 0.95, y) * front * Math.sin(ang * 3 + y * 25);
      }));
    }
    bd.grid('canvas', rows, {
      closed: true, weights: legW, inside: i => [Tn[0], rows[i][0][1], 0],
      color: p => {
        let c = tint(pantsHex, p, 0.1, 1);
        const kneeFront = g2(p[1], p[2], 0.49, 0.07, 0.05, 0.03), seam = g2(p[1], 0, 0.56, 0, 0.006, 1) + g2(p[1], 0, 0.43, 0, 0.006, 1);
        c = mulc(c, (1 - 0.18 * kneeFront) * (1 - 0.25 * seam * smooth(0.02, 0.06, p[2])) * (1 + 0.18 * g2(p[1], p[2], 0.72, 0.07, 0.08, 0.04)));
        return c;
      },
    });
    // cargo pocket with a flap on the outer thigh
    if (!far) {
      const py = 0.7, L = legAt(py), out = L.rl + 0.004;
      const pocket = (y0: number, y1: number, thick: number, w: number, hex: string) => {
        const rows2: V3[][] = [], m = 6;
        for (let i = 0; i <= m; i++) {
          const y = y0 + (y1 - y0) * (i / m), Ly = legAt(y), r: V3[] = [];
          const bulge = thick * Math.sin(Math.min(1, (i / m) * 1.3 + 0.1) * Math.PI);
          for (let j = 0; j <= 6; j++) { const ang = (j / 6 - 0.5) * w; r.push([Ly.c[0] + sx * Math.cos(ang) * (Ly.rl + 0.003 + bulge * Math.cos(ang * 2)), y, Ly.c[2] + Math.sin(ang) * (Ly.rf + 0.003 + bulge * Math.cos(ang * 2))]); }
          rows2.push(r);
        }
        bd.grid('canvas', rows2, { weights: legW, color: p => mulc(tint(hex, p, 0.1, 1), 0.92), inside: [L.c[0], py, L.c[2]] });
      };
      void out;
      pocket(0.62, 0.76, 0.016, 1.15, pantsHex);
      pocket(0.745, 0.785, 0.008, 1.25, shadeHex(pantsHex, 0.9));
      // thigh rig: straps and a holster / pouch (expedition looks)
      if (expedition) {
        const right = sx < 0;
        if (right || female) {
          for (const y of [0.8, 0.66]) {
            const r2: V3[][] = [];
            for (const [dy, ex] of [[0.011, 0.0015], [0.009, 0.0045], [-0.009, 0.0045], [-0.011, 0.0015]] as const) { const Ly = legAt(y + dy); r2.push(ring(Ly.c, [sx, 0, 0], [0, 0, 1], n, { xp: Ly.rl + ex, xn: Ly.rl * 0.92 + ex, yp: Ly.rf + ex, yn: Ly.rb + ex, p: 2.2 })); }
            bd.grid('leather', r2, { closed: true, weights: legW, color: p => tint('#2b2219', p, 0.1, 0.5) });
          }
          const Ly = legAt(0.73), hxp = Ly.c[0] + sx * (Ly.rl + 0.02), box = roundedBox([hxp, 0.73, Ly.c[2] + 0.025], [sx, 0, 0], [0, 1, 0], [0, 0, 1], 0.022, 0.07, 0.05, bd.n(12, 6));
          bd.grid('leather', box, { closed: true, capStart: true, capEnd: true, weights: legW, color: p => tint(female ? '#9a7442' : '#3a2a1c', p, 0.12, 0.4), inside: [hxp, 0.73, Ly.c[2] + 0.025] });
        }
      }
    }
    // boot: shaft, foot, sole, laces
    const A = side === 0 ? P.ankleR : P.ankleL;
    const bootHex = a.boots === 'work' ? '#211d1a' : a.boots === 'tall' ? '#3b2a1f' : female ? '#6b3d22' : '#6a4a2c';
    const bootCol = (p: V3) => tint(bootHex, p, 0.18, 1.4);
    const bootW: WeightFn = p => { const k = smooth(0.09, bootTop, p[1]) * 0.85; return [[bA, 1 - k], [bK, k]]; };
    const bx = A[0] + sx * 0.002;
    {
      const rows2: V3[][] = [], m = bd.n(18, 8), k = bd.n(8, 3);
      for (let i = 0; i <= k; i++) {
        const y = 0.06 + (bootTop - 0.06) * (i / k);
        rows2.push(ring([bx, y, 0.004], [sx, 0, 0], [0, 0, 1], m, { xp: 0.056 * limb, yp: 0.062 * limb, yn: 0.058 * limb, p: 2.2 }));
      }
      rows2.push(ring([bx, bootTop + 0.012, 0.004], [sx, 0, 0], [0, 0, 1], m, { xp: 0.064 * limb, yp: 0.068 * limb, yn: 0.066 * limb }));
      rows2.push(ring([bx, bootTop + 0.01, 0.004], [sx, 0, 0], [0, 0, 1], m, { xp: 0.05 * limb, yp: 0.054 * limb }));
      bd.grid('leather', rows2, { closed: true, weights: bootW, color: bootCol, inside: i => [bx, rows2[i][0][1], 0] });
    }
    const FOOT = [[-0.082, 0.032, 0.06], [-0.07, 0.046, 0.095], [-0.03, 0.051, 0.108], [0.03, 0.053, 0.1], [0.09, 0.055, 0.078], [0.14, 0.051, 0.064], [0.175, 0.042, 0.054], [0.193, 0.024, 0.04]];
    const footRow = (z: number, ex: number, yb: number) => {
      const [hw, top] = table(FOOT, z), cy = (top + yb) / 2, hy = (top - yb) / 2;
      return ring([bx + sx * z * 0.04, cy, z], [sx, 0, 0], [0, 1, 0], bd.n(18, 8), { xp: hw * limb + ex, yp: hy + ex * 0.5, p: 2.6 });
    };
    {
      const rows2: V3[][] = [], k = bd.n(14, 5);
      for (let i = 0; i <= k; i++) rows2.push(footRow(-0.082 + 0.275 * (i / k), 0, 0.028));
      bd.grid('leather', rows2, { closed: true, capStart: true, capEnd: true, weights: bootW, color: p => mulc(bootCol(p), p[2] > 0.13 ? 0.85 : 1) });
      // sole: lugged rubber, a little wider than the upper
      const sole: V3[][] = [];
      for (let i = 0; i <= k; i++) {
        const z = -0.088 + 0.287 * (i / k), [hw] = table(FOOT, z);
        sole.push(ring([bx + sx * z * 0.04, 0.0145, z], [sx, 0, 0], [0, 1, 0], bd.n(14, 6), { xp: hw * limb + 0.007, yp: 0.0145, p: 5 }));
      }
      bd.grid('rubber', sole, { closed: true, capStart: true, capEnd: true, weights: [[bA, 1]], color: p => mixc(lin('#1d1a17'), MUD, 0.35 * (0.5 + fbm(p, 20, 2))) });
      if (!lite) {
        const laceCol = lin(fit.lace && expedition ? fit.lace : a.boots === 'work' ? '#2a2826' : '#b08a55');
        for (let i = 0; i < 7; i++) {
          const z = i < 3 ? 0.085 - i * 0.03 : 0.025, y = i < 3 ? table(FOOT, 0.085 - i * 0.03)[1] + 0.004 : 0.1 + (i - 3) * 0.028;
          const zz = i < 3 ? z : 0.004 + 0.062 * limb + 0.003;
          const c: V3 = [bx, y, zz], rows3: V3[][] = [];
          for (const t of [-1, -0.5, 0, 0.5, 1]) rows3.push(ring(add(c, [t * 0.022, 0.002 * (1 - t * t), 0]), [0, 1, 0], [0, 0, 1], 5, { xp: 0.0032, yp: 0.0032 }));
          bd.grid('cloth', rows3, { closed: true, weights: i < 3 ? [[bA, 1]] : bootW, color: laceCol });
        }
      }
    }
  }

  // ---------- belt ----------
  if (!far) {
    const by = waistY + 0.012, rows: V3[][] = [], n = bd.n(44, 12);
    for (const [dy, ex] of [[0.02, 0.004], [0.018, 0.009], [-0.018, 0.009], [-0.02, 0.004]] as const) { const r: V3[] = []; for (let j = 0; j < n; j++) r.push(torso(by + dy, (j / n) * Math.PI * 2, ex + (closedTop ? 0.012 : 0.004))); rows.push(r); }
    bd.grid('leather', rows, { closed: true, weights: torsoW, color: p => tint('#3a2a1c', p, 0.12, 0), inside: i => [0, rows[i][0][1], 0] });
    const f = torso(by, 0, 0.016 + (closedTop ? 0.012 : 0.004));
    const buckle = roundedBox(add(f, [0, 0, 0.004]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.03, 0.024, 0.007, bd.n(10, 6));
    bd.grid('metal', buckle, { closed: true, capStart: true, capEnd: true, weights: torsoW, color: lin('#a07e3e'), inside: f });
    // utility pouch on the belt
    if (expedition) {
      const ps = torso(by - 0.03, -1.05, 0.03), box = roundedBox(ps, [Math.sin(-1.05), 0, Math.cos(-1.05)], [0, 1, 0], [Math.cos(-1.05), 0, -Math.sin(-1.05)], 0.026, 0.055, 0.05, bd.n(12, 6));
      bd.grid('canvas', box, { closed: true, capStart: true, capEnd: true, weights: torsoW, color: p => tint(fit.pack, p, 0.15, 0), inside: ps });
    }
  }

  // ---------- jacket shells (open jackets, vest) and collars ----------
  if (a.top === 'trail-jacket' || a.top === 'crop-jacket' || a.top === 'vest') {
    const crop = a.top === 'crop-jacket', vest = a.top === 'vest';
    const hem = crop ? 1.12 : vest ? 0.99 : 0.93, top = 1.478;
    const gapAt = (y: number) => (crop ? 0.26 + 0.22 * smooth(1.42, 1.15, y) : vest ? 0.35 + 0.15 * smooth(1.45, 1.0, y) : 0.2 + 0.3 * smooth(1.45, 0.95, y));
    const offAt = (y: number) => (crop ? 0.011 : 0.019) + (crop ? 0 : 0.014 * smooth(1.15, 0.93, y));
    const R = bd.n(26, 8), Cn = bd.n(44, 12), rows: V3[][] = [];
    for (let i = 0; i <= R; i++) {
      const yr = hem + (top - hem) * (i / R), r: V3[] = [];
      for (let j = 0; j <= Cn; j++) {
        const g0 = gapAt(yr), ang0 = g0 + (Math.PI * 2 - 2 * g0) * (j / Cn), e0 = Math.min(ang0 - g0, Math.PI * 2 - g0 - ang0);
        // the front corners of the neckline are cut down (lapels lie flat instead of standing up)
        const y = yr - (yr - hem) / (top - hem) * 0.05 * smooth(0.9, 0.1, e0) * smooth(hem + (top - hem) * 0.6, top, yr);
        const g = gapAt(y), ang = g + (Math.PI * 2 - 2 * g) * (j / Cn), edge = Math.min(ang - g, Math.PI * 2 - g - ang);
        let p = torso(y, ang, offAt(y) + 0.006 * smooth(0.35, 0, edge));
        // open fronts hang forward a little
        if (edge < 0.5) p = add(p, [0, 0, 0.008 * smooth(0.5, 0, edge) * smooth(1.42, 1.1, y)]);
        r.push(p);
      }
      rows.push(r);
    }
    const yokeLine = 1.38;
    bd.grid(jacketKey, rows, { weights: torsoW, color: p => jacketColor(p, yokeLine), inside: i => [0, rows[i][0][1], 0.0] });
    // inside face (the lining shows at the open front)
    bd.grid(jacketKey, rows.map(r => r.map(p => [p[0] * 0.985, p[1], p[2] * 0.985 - 0.001] as V3)), { weights: torsoW, color: p => mulc(jacketColor(p, yokeLine), 0.45), inside: i => [0, rows[i][0][1], 0], flip: true });
    // hem and front edges: a rolled trim
    const edgePath: V3[] = [];
    for (let i = R; i >= 0; i--) edgePath.push(rows[i][0]);
    for (let j = 1; j <= Cn; j++) edgePath.push(rows[0][j]);
    for (let i = 1; i <= R; i++) edgePath.push(rows[i][Cn]);
    const trimRows: V3[][] = [];
    frames(edgePath, [0, 1, 0]).forEach(([p, , nn, bb]) => trimRows.push(ring(p, nn, bb, 6, { xp: crop ? 0.005 : 0.0065, yp: crop ? 0.005 : 0.0065 })));
    bd.grid(jacketKey, trimRows, { closed: true, weights: torsoW, color: p => mulc(jacketColor(p, -1), 0.8) });
    // chest pockets, zip, radio
    if (!lite && !crop) for (const sx of [-1, 1]) {
      const ang = sx * 0.62, c = torso(1.3, ang, offAt(1.3) + 0.008), nrm: V3 = norm([Math.sin(ang), 0, Math.cos(ang)]), side: V3 = norm(cross([0, 1, 0], nrm));
      const box = roundedBox(c, nrm, [0, 1, 0], side, 0.012, 0.075, 0.085, 10);
      bd.grid(jacketKey, box, { closed: true, capStart: true, capEnd: true, weights: torsoW, color: p => mulc(jacketColor(p, 2), 0.88), inside: sub(c, scl(nrm, 0.02)) });
    }
    if (crop && !lite) {
      const zp: V3[] = []; for (let i = 0; i <= 10; i++) { const y = hem + 0.01 + (1.47 - hem) * (i / 10); zp.push(add(torso(y, gapAt(y) + 0.03, offAt(y) + 0.008), [0, 0, 0.002])); }
      const zr: V3[][] = []; frames(zp, [1, 0, 0]).forEach(([p, , nn, bb]) => zr.push(ring(p, nn, bb, 4, { xp: 0.003, yp: 0.003 })));
      bd.grid('metal', zr, { closed: true, weights: torsoW, color: lin('#8c8a86') });
    }
  }
  // collars
  if (a.top !== 'tee' && a.top !== 'hoodie') {
    const open = a.top === 'trail-jacket' || a.top === 'crop-jacket' || a.top === 'vest' ? 0.42 : a.top === 'flannel' ? 0.25 : 0.12;
    const key = a.top === 'vest' ? 'cloth' : jacketKey;
    const rows: V3[][] = [], Cn = bd.n(28, 10);
    const levels: [number, number][] = a.top === 'field-jacket' ? [[1.5, 0.012], [1.54, 0.016], [1.57, 0.022], [1.572, 0.012]] : [[1.475, 0.016], [1.508, 0.019], [1.526, 0.028], [1.508, 0.043], [1.482, 0.05]];
    for (const [y, ex] of levels) {
      const r: V3[] = [];
      for (let j = 0; j <= Cn; j++) { const ang = open + (Math.PI * 2 - 2 * open) * (j / Cn); r.push(add([Math.sin(ang) * (neckR + ex) * 1.08, y, Math.cos(ang) * (neckR + ex) - 0.006], [0, 0, 0])); }
      rows.push(r);
    }
    bd.grid(key as MatKey, rows, { weights: p => [[B.spine, 1 - smooth(1.5, 1.58, p[1]) * 0.5], [B.neck, smooth(1.5, 1.58, p[1]) * 0.5]], color: p => (key === 'cloth' ? tint('#d9cfb8', p, 0.05, 0) : mulc(jacketColor(p, expedition ? 1.0 : 2), expedition ? 0.9 : 0.95)), inside: [0, 1.53, 0] });
    bd.grid(key as MatKey, rows, { weights: [[B.spine, 1]], color: p => mulc(jacketColor(p, 2), 0.4), inside: [0, 1.53, 0], flip: true });
  }
  if (a.top === 'hoodie' && !far) {
    const c: V3 = [0, 1.52, -0.075], rows: V3[][] = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; rows.push(ring(add(c, [0, 0.05 * Math.cos(t * Math.PI), -0.03 * Math.sin(t * Math.PI)]), [1, 0, 0], [0, 0, 1], 14, { xp: 0.12 * Math.sin(0.2 + t * 2.7), yp: 0.06 * Math.sin(0.2 + t * 2.7) })); }
    bd.grid('cloth', rows, { closed: true, weights: [[B.spine, 0.7], [B.neck, 0.3]], color: p => tint(CLOTH_COLORS[a.topColor], p, 0.06, 0), inside: c });
    const kp = torso(1.13, 0, 0.018), box = roundedBox(kp, [0, 0, 1], [0, 1, 0], [1, 0, 0], 0.01, 0.1, 0.2, 10);
    bd.grid('cloth', box, { closed: true, capStart: true, capEnd: true, weights: torsoW, color: p => mulc(tint(CLOTH_COLORS[a.topColor], p, 0.06, 0), 0.9), inside: sub(kp, [0, 0, 0.02]) });
  }
  if ((a.top === 'field-jacket' || a.top === 'flannel') && !lite) {
    const zp: V3[] = []; for (let i = 0; i <= 12; i++) { const y = waistY + 0.01 + (1.5 - waistY - 0.01) * (i / 12); zp.push(torso(y, 0, 0.014)); }
    const zr: V3[][] = []; frames(zp, [1, 0, 0]).forEach(([p, , nn, bb]) => zr.push(ring(p, nn, bb, 4, { xp: 0.003, yp: 0.0025 })));
    bd.grid(a.top === 'flannel' ? 'cloth' : 'metal', zr, { closed: true, weights: torsoW, color: lin(a.top === 'flannel' ? '#1e1c1a' : '#6e6b66') });
    if (a.top === 'field-jacket') for (const sx of [-1, 1]) {
      const ang = sx * 0.55, c = torso(1.3, ang, 0.02), nrm: V3 = norm([Math.sin(ang), 0, Math.cos(ang)]), side: V3 = norm(cross([0, 1, 0], nrm));
      bd.grid(jacketKey, roundedBox(c, nrm, [0, 1, 0], side, 0.01, 0.08, 0.085, 10), { closed: true, capStart: true, capEnd: true, weights: torsoW, color: p => mulc(tint(CLOTH_COLORS[a.topColor], p, 0.06, 0), 0.82), inside: sub(c, scl(nrm, 0.02)) });
    }
  }

  // ---------- bandana ----------
  if (a.accessories.includes('scarf')) {
    const n = bd.n(36, 10), rows: V3[][] = [];
    const levels: [number, number, number][] = female
      ? [[1.522, 0.05, 0.01], [1.505, 0.062, 0.02], [1.482, 0.082, 0.024], [1.46, 0.1, 0.02], [1.442, 0.114, 0.012]]
      : [[1.53, 0.062, 0.01], [1.51, 0.076, 0.02], [1.485, 0.096, 0.026], [1.46, 0.12, 0.022], [1.438, 0.136, 0.012]];
    for (const [y, r, fold] of levels) rows.push(ring([0, y, 0.008], [1, 0, 0], [0, 0, 1], n, { xp: r * 1.06, yp: r }, ang => 1 + fold * 3 * Math.sin(ang * 7 + y * 60) * 0.3 + (Math.cos(ang) > 0 ? 0.08 * Math.cos(ang) : 0)));
    const scarfW: WeightFn = p => { const k = smooth(1.49, 1.55, p[1]); return [[B.spine, 1 - k], [B.neck, k * 0.8], [B.head, k * 0.2]]; };
    bd.grid('bandana', rows, { closed: true, weights: scarfW, color: p => mulc(WHITE, cavity(p) * (0.9 + fbm(p, 30, 2) * 0.2)), inside: i => [0, rows[i][0][1], 0.008] });
    // the knotted triangle hanging over the chest
    const drop = female ? 0.09 : 0.115, tri: V3[][] = [], k = bd.n(10, 4);
    for (let i = 0; i <= k; i++) {
      const t = i / k, y = levels[levels.length - 1][0] + 0.012 - drop * t, span = 0.85 * (1 - t) + 0.03, r: V3[] = [];
      for (let j = 0; j <= 10; j++) { const ang = -span + 2 * span * (j / 10); r.push(add(torso(y, ang, 0.03 + (a.top === 'crop-jacket' ? 0 : 0.008)), [0, 0, 0.006 * Math.sin(j * 1.9 + i)])); }
      tri.push(r);
    }
    bd.grid('bandana', tri, { weights: [[B.spine, 1]], color: p => mulc(WHITE, 0.95 + fbm(p, 30, 2) * 0.15), inside: [0, 1.4, -0.05] });
  }

  // ---------- sunglasses (aviators) ----------
  if (a.accessories.includes('sunglasses') && !far) {
    const lensRows = (sx: number, z0: number): V3[][] => {
      const cx = sx * 0.0335, cy = 0.01, out: V3[][] = [], m = bd.n(22, 12);
      for (const [k, dz] of [[1, 0], [0.5, 0.0015], [0.0, 0.002]] as const) {
        const r: V3[] = [];
        for (let j = 0; j < m; j++) {
          const ang = (j / m) * Math.PI * 2, s = Math.sin(ang), c = Math.cos(ang);
          // teardrop: rounder and deeper toward the lower outside
          // aviator: a straight, wide brow line and a deep drop toward the lower outside
          let x = 0.0265 * s * k, y = c >= 0 ? 0.0145 * Math.pow(c, 0.5) * k : -0.022 * Math.pow(-c, 0.85) * k;
          if (c < 0) x = x * (s * sx < 0 ? 0.82 : 1) + sx * 0.005 * (-c) * k * (s * sx > 0 ? 1 : 0.2);
          const bx2 = cx + x, curve = 0.5 * ((x / 0.026) ** 2) * 0.006;
          r.push([bx2 + H[0] + C[0], cy + y + H[1] + C[1], z0 + dz - curve + H[2] + C[2]]);
        }
        out.push(r);
      }
      return out;
    };
    const zf = hc + 0.016;
    for (const sx of [-1, 1]) {
      const rows = lensRows(sx, zf);
      bd.grid('lens', rows, { closed: true, capEnd: true, weights: headW, color: lin('#3b2a1a'), inside: add(rows[0][0], [0, 0, -0.05]) });
      const rim: V3[][] = [];
      frames([...rows[0], rows[0][0], rows[0][1]], [0, 0, 1]).forEach(([p, , nn, bb]) => rim.push(ring(p, nn, bb, 5, { xp: 0.0012, yp: 0.0012 })));
      bd.grid('metal', rim, { closed: true, weights: headW, color: lin('#b8933c') });
      // temple arm back to the ear
      const t0: V3 = add(rows[0][Math.round(rows[0].length * (sx > 0 ? 0.25 : 0.75))], [0, 0.004, -0.002]);
      const path = spline([t0, add(headPt(sx * 1.2, 1.5, false), [sx * 0.006, 0.006, 0]), add(headPt(sx * 1.75, 1.6, false), [sx * 0.006, 0.0, 0]), add(headPt(sx * 2.0, 1.75, false), [sx * 0.004, -0.006, 0])], 10);
      const ar: V3[][] = [];
      frames(path, [0, 1, 0]).forEach(([p, , nn, bb]) => ar.push(ring(p, nn, bb, 5, { xp: 0.0014, yp: 0.0014 })));
      bd.grid('metal', ar, { closed: true, weights: headW, color: lin('#b8933c') });
    }
    // double bridge
    for (const [y0, sag] of [[0.03, 0.0], [0.012, -0.004]] as const) {
      const pa: V3[] = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6, x = -0.012 + 0.024 * t; pa.push([x + H[0] + C[0], y0 + H[1] + C[1] + sag * Math.sin(t * Math.PI), zf + 0.004 + H[2] + C[2]]); }
      const br: V3[][] = [];
      frames(pa, [0, 1, 0]).forEach(([p, , nn, bb]) => br.push(ring(p, nn, bb, 5, { xp: 0.0011, yp: 0.0011 })));
      bd.grid('metal', br, { closed: true, weights: headW, color: lin('#b8933c') });
    }
  }

  // ---------- backpack ----------
  if (a.accessories.includes('backpack')) {
    const off = a.top === 'trail-jacket' ? 0.027 : a.top === 'crop-jacket' ? 0.016 : closedTop ? 0.016 : 0.006;
    const backZ = (y: number) => torso(y, Math.PI, off)[2];
    const pw = (female ? 0.26 : 0.3) * W, ph = female ? 0.38 : 0.42, pd = female ? 0.13 : 0.15, py = female ? 1.25 : 1.23;
    const zb = Math.min(backZ(py - 0.1), backZ(py + 0.1)) - pd / 2 + 0.012;
    const packCol = (p: V3) => tint(fit.pack, p, 0.14, 0);
    const packW: Weights = [[B.spine, 1]];
    const box = (c: V3, w: number, h: number, d: number, col: (p: V3) => RGB, key: MatKey = 'canvas') =>
      bd.grid(key, roundedBox(c, [0, 0, -1], [0, 1, 0], [1, 0, 0], d / 2, h, w, bd.n(14, 6)), { closed: true, capStart: true, capEnd: true, weights: packW, color: col, inside: c });
    box([0, py, zb], pw, ph, pd, packCol);
    if (!far) {
      box([0, py - 0.04, zb - pd / 2 - 0.018], pw * 0.74, ph * 0.5, 0.05, p => mulc(packCol(p), 0.95));
      box([0, py + ph / 2 + 0.005, zb - 0.005], pw * 1.02, 0.075, pd * 1.08, p => mulc(packCol(p), 0.9));
      // compression straps
      if (!lite) for (const dy of [-0.11, -0.02, 0.07]) box([0, py + dy, zb - pd / 2 - (dy < 0.05 ? 0.045 : 0.006)], pw * (dy < 0.05 ? 0.78 : 1.0), 0.022, 0.006, p => tint('#3a2c1e', p, 0.1, 0), 'cloth');
      // patch on the front pocket
      const pc: V3 = [0, py - 0.02, zb - pd / 2 - 0.044], rows: V3[][] = [];
      for (let i = 0; i <= 1; i++) { const r: V3[] = []; for (let j = 0; j <= 1; j++) r.push([pc[0] + (j - 0.5) * 0.09, pc[1] + (0.5 - i) * 0.07, pc[2]]); rows.push(r); }
      bd.grid('patch', rows, { weights: packW, color: WHITE, inside: add(pc, [0, 0, 0.1]), uv: (i, j) => [0.5 + j * 0.5, i * 0.5] });
      // side bottle
      const bxs = -(pw / 2 + 0.03), bc: V3 = [bxs, py - 0.07, zb], br: V3[][] = [];
      for (const [dy, r] of [[-0.1, 0.0], [-0.099, 0.028], [-0.09, 0.033], [0.05, 0.033], [0.07, 0.024], [0.08, 0.018], [0.1, 0.018], [0.102, 0.0]] as const) br.push(ring(add(bc, [0, dy, 0]), [1, 0, 0], [0, 0, 1], bd.n(12, 6), { xp: r, yp: r }));
      bd.grid('metal', br, { closed: true, weights: packW, color: p => (p[1] > bc[1] + 0.075 ? lin('#1e1e1c') : lin('#5d6247')), inside: bc });
    }
    // roll under the pack: bedroll (male) or ribbed sleeping mat (female)
    {
      const rc: V3 = [0, py - ph / 2 - 0.05, zb + 0.004], rr = female ? 0.058 : 0.052, rows: V3[][] = [], k = bd.n(16, 4);
      for (let i = 0; i <= k; i++) { const t = i / k, x = (t - 0.5) * pw * 1.15, rib = female ? 1 + 0.06 * Math.abs(Math.sin(t * Math.PI * 9)) : 1; rows.push(ring([x, rc[1], rc[2]], [0, 1, 0], [0, 0, 1], bd.n(16, 6), { xp: rr * rib, yp: rr * rib })); }
      bd.grid(female ? 'cloth' : 'canvas', rows, { closed: true, capStart: true, capEnd: true, weights: packW, color: p => tint(female ? '#3d3f3a' : '#5d5537', p, 0.12, 0), inside: i => [rows[i][0][0], rc[1], rc[2]] });
      for (const sx of [-1, 1]) {
        const sr: V3[][] = [];
        for (let i = 0; i <= 3; i++) { const x = sx * pw * 0.3 + (i / 3 - 0.5) * 0.024; sr.push(ring([x, rc[1], rc[2]], [0, 1, 0], [0, 0, 1], bd.n(16, 6), { xp: rr + 0.004, yp: rr + 0.004 })); }
        bd.grid('cloth', sr, { closed: true, weights: packW, color: lin('#2b221a') });
      }
    }
    // shoulder straps following the torso
    const strapOff = off + 0.001, topOff = (a.top === 'trail-jacket' ? 0.019 : a.top === 'crop-jacket' ? 0.011 : closedTop ? 0.016 : 0.004) + 0.007;
    const sOff = (y: number) => strapOff - (strapOff - topOff) * smooth(1.36, 1.44, y);
    for (const sx of [-1, 1]) {
      const pts: V3[] = ([[1.395, Math.PI - 0.52], [1.445, 2.15], [1.462, 1.58], [1.44, 0.98], [1.37, 0.66], [1.3, 0.66], [1.265, 0.98], [1.255, 1.35], [1.23, 1.9], [1.18, 2.45]] as [number, number][])
        .map(([y, ang]) => torso(y, sx * ang, sOff(y)));
      const path = spline(pts, bd.n(28, 10)), rows: V3[][] = [];
      path.forEach((p, i) => {
        const t = norm(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
        const out = norm([p[0], Math.max(0, p[1] - 1.3) * 1.6, p[2] + 0.01]), side = norm(cross(t, out)), up2 = norm(cross(side, t));
        const pad = i / path.length < 0.55 ? 1.25 : 0.8;
        rows.push(ring(add(p, scl(up2, 0.006)), side, up2, 8, { xp: 0.026 * pad, yp: 0.006 * pad, p: 5 }));
      });
      bd.grid('cloth', rows, { closed: true, weights: torsoW, color: p => tint(female ? '#6e5634' : '#5a4428', p, 0.12, 0), capStart: true, capEnd: true });
    }
    if (!lite) {
      // sternum strap and (male lead) a radio clipped to the left strap
      const y = 1.335, a0 = torso(y, -0.62, strapOff + 0.01), a1 = torso(y, 0.62, strapOff + 0.01), rows: V3[][] = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8, p = lerp(a0, a1, t); rows.push(ring(add(p, [0, 0, 0.006 * Math.sin(t * Math.PI) + 0.004]), [0, 1, 0], [0, 0, 1], 6, { xp: 0.008, yp: 0.003, p: 5 })); }
      bd.grid('cloth', rows, { closed: true, weights: torsoW, color: lin('#2a221a') });
      if (a.top === 'trail-jacket') {
        const rc = torso(1.31, 0.66, strapOff + 0.03), nrm: V3 = norm([Math.sin(0.66), 0, Math.cos(0.66)]);
        bd.grid('cloth', roundedBox(rc, nrm, [0, 1, 0], norm(cross([0, 1, 0], nrm)), 0.012, 0.07, 0.035, 10), { closed: true, capStart: true, capEnd: true, weights: torsoW, color: p => tint('#2c2e2a', p, 0.1, 0), inside: sub(rc, scl(nrm, 0.02)) });
        const ant: V3[][] = []; for (let i = 0; i <= 2; i++) ant.push(ring(add(rc, [0, 0.035 + i * 0.03, 0]), [1, 0, 0], [0, 0, 1], 6, { xp: 0.004 - i * 0.001, yp: 0.004 - i * 0.001 }));
        bd.grid('cloth', ant, { closed: true, capEnd: true, weights: torsoW, color: lin('#1a1a1a') });
      }
    }
  }

  const lipsHex = female ? '#a5524a' : shadeHex(skinHex, 0.78);
  return {
    faceKey: `${skinHex}|${hairHex}|${a.beard}|${a.eyes}|${a.body}|${a.face}`, skinHex, hairHex, lipsHex, irisHex: EYE_COLORS[a.eyes], beardShadow, female,
    toUv, fromUv, beardMask: mask, mean,
  };
}

const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** hex colour scaled (no leading #) */
function shadeHex(hex: string, k: number) {
  const n = parseInt(hex.replace('#', ''), 16), f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k))).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`.replace('##', '#');
}

/**
 * A rounded box as a closed loft along `fwd` (depth): rows from back to front, each a superellipse in the
 * up/side plane. `half` is half the depth; h and w are full height and width.
 */
export function roundedBox(c: V3, fwd: V3, up: V3, side: V3, half: number, h: number, w: number, n: number): V3[][] {
  const rows: V3[][] = [];
  for (const [t, k] of [[-1, 0.86], [-0.85, 1], [0.6, 1], [0.92, 0.94], [1, 0.8]] as const) rows.push(ring(add(c, scl(fwd, t * half)), side, up, n, { xp: (w / 2) * k, yp: (h / 2) * k, p: 6 }));
  void len;
  return rows;
}
