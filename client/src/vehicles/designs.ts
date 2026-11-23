import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { stockFit, type VehicleSpec } from '@orl/shared';
import type { Kit } from './carKit';
import type { Pt } from './loft';
import { offroadParts, roadParts } from './accessories';

/**
 * The car designs. Each is an original model inspired by a real-world type of car (proportions, stance, surfacing and
 * the kind of details such a car has), with fictional names and no real makes' badges, logos or signature grilles.
 *
 *   Ranger TX4    long-wheelbase body-on-frame expedition wagon (the classic Japanese/British 4x4 wagon school)
 *   Bramble RC2   short two-door open-top trail crawler on 37-inch tyres
 *   Vanta GT      GT3-class endurance race coupe: wide arches, splitter, swan-neck wing, centre-lock wheels
 *   Strix R2      homologation rally hot hatch: three doors, bonnet scoop, roof spoiler, mud flaps
 *   Pella 1.4     European C-segment five-door hatchback
 *   Corvan 2.0    mid-size family saloon
 *   Halcyon Grand full-size flagship luxury saloon with an upright chrome grille and a full-width light bar
 *   Solenne GT    front-engined V12 grand tourer: long bonnet, fastback, side strakes
 */
export type RimStyle = 'multi' | 'five' | 'split' | 'mesh' | 'turbine' | 'steel' | 'beadlock';
export interface DesignInfo {
  rim: RimStyle; rimF: number; centreLock?: boolean; brakes: boolean;
  /** headlamp beam origins (vehicle frame) */
  beams: [number, number, number][];
  /** garage driving lamps (light bar, pods) */
  extraBeams?: [number, number, number][];
}

const rr = (w: number, h: number, r: number, seg = 4): Pt[] => {
  const pts: Pt[] = [], cx = w / 2 - r, cy = h / 2 - r;
  for (const [qx, qy, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]] as const)
    for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); pts.push([qx * cx + Math.cos(a) * r, qy * cy + Math.sin(a) * r]); }
  return pts;
};
const circle = (r: number, n = 20): Pt[] => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r] as Pt);
const ring = (r: number, n: number): Pt[] => circle(r, n);

/** Geometry shared by every design, derived from the vehicle's data spec so the body always fits the simulation. */
function base(sp: VehicleSpec) {
  const sag = (sp.mass * 9.81 / 4) / sp.springRate, yc = sp.mountY - sp.restLength + sag, g = yc - sp.wheelRadius;
  return { g, yc, R: sp.wheelRadius, h: (above: number) => g + above, seat: sp.look.seat };
}

/** Lines that follow the body side: door shuts, crease lines, chrome strips. */
function sideLine(k: Kit, z: number, y0: number, y1: number, mat: PBRMaterial, r = 0.0035, n = 10) {
  if (k.lite) return;
  for (const sx of [-1, 1]) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const y = y0 + (y1 - y0) * (i / n), x = k.body.xAt(z, y);
      if (x > 0) pts.push([sx * (x + 0.0015), y, z]);
    }
    if (pts.length > 1) k.tube('door-line', pts, r, mat, 5);
  }
}
function sideStrip(k: Kit, z0: number, z1: number, y: number, mat: PBRMaterial, r = 0.006, out = 0.002) {
  // split where the strip would cross a wheel arch
  const n = Math.max(16, Math.round(Math.abs(z1 - z0) / 0.05));
  for (const sx of [-1, 1]) {
    let pts: [number, number, number][] = [];
    const flush = () => { if (pts.length > 1) k.tube('strip', pts, r, mat, 6); pts = []; };
    for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * (i / n), x = k.body.xAt(z, y); if (x > 0) pts.push([sx * (x + out), y, z]); else flush(); }
    flush();
  }
}
/** Rounded aero mirror on a stalk, at the base of the A-pillar. */
function mirrors(k: Kit, z: number, y: number, w = 0.2, h = 0.11, mat?: PBRMaterial) {
  for (const sx of [-1, 1]) {
    let x = k.body.xAt(z, y - 0.06); if (x < 0) x = k.body.section(z).tw;
    const mm = k.sphere('mirror', 0.1, h, w * 0.7, mat ?? k.m.paint, sx * (x + 0.12), y + 0.02, z - 0.02); mm.scaling.set(1, 1, 1.25);
    k.box('mirror-glass', 0.08, h * 0.7, 0.005, k.m.chrome, sx * (x + 0.12), y + 0.02, z - 0.115);
    k.box('mirror-stalk', 0.1, 0.03, 0.05, k.m.trim, sx * (x + 0.04), y - 0.02, z);
  }
}
function handles(k: Kit, zs: number[], y: number, mat: PBRMaterial) {
  if (k.lite) return;
  for (const z of zs) for (const sx of [-1, 1]) k.onSide('handle', sx, z, y, rr(0.15, 0.03, 0.012, 2), 0.02, mat, 0.004);
}
/** The design's own spoiler stays unless the garage fitted something else in its place. */
const factoryAero = (k: Kit) => (k.fit.spoiler ?? 'stock') === 'stock';
function plate(k: Kit, dir: 1 | -1, y: number, x = 0) {
  k.onEnd('plate', dir, x, y, rr(0.52, 0.115, 0.01, 2), 0.012, k.m.plate, 0.004);
}
/** Dark wheel-well liners so you see into the arch, not through the car. */
function wells(k: Kit, sp: VehicleSpec, r: number, yc: number, inset = 0.12) {
  for (const z of [sp.wheelFrontZ, sp.wheelRearZ]) for (const sx of [-1, 1]) {
    const xo = sx * (sp.wheelX + sp.wheelWidth / 2 + 0.06), xi = sx * (sp.wheelX - sp.wheelWidth / 2 - inset);
    const arc = (x: number, rad: number) => Array.from({ length: 17 }, (_, i) => { const a = -0.15 + (Math.PI + 0.3) * (i / 16); return new Vector3(x, yc + Math.sin(a) * rad, z + Math.cos(a) * rad); });
    const liner = MeshBuilder.CreateRibbon('well', { pathArray: [arc(xo, r - 0.01), arc(xi, r - 0.01)], sideOrientation: Mesh.DOUBLESIDE }, k.scene);
    liner.material = k.m.rubber; k.add(liner);
    const wall = MeshBuilder.CreateRibbon('well', { pathArray: [arc(xi, r - 0.01), arc(xi, 0.02)], sideOrientation: Mesh.DOUBLESIDE }, k.scene);
    wall.material = k.m.rubber; k.add(wall);
  }
}
/** Seats, dash, steering wheel and centre console in the cabin well. */
function cabin(k: Kit, sp: VehicleSpec, o: { dashZ: number; dashY: number; dashW: number; rear?: number; sport?: boolean }) {
  const [sx0, seatY, sz0] = sp.look.seat, m = k.m;
  // the dash sits just under the windscreen, at the waist, ahead of the driver
  if (k.gh) { const cowl = k.gh.g.z0; o = { ...o, dashZ: Math.min(o.dashZ, cowl - 0.24), dashY: Math.min(o.dashY, k.body.top(cowl) - 0.08) }; }
  for (const sx of [-sx0, sx0]) {
    k.box('seat', 0.46, 0.12, 0.5, m.interior, sx, seatY + 0.02, sz0);
    k.box('seat', 0.46, 0.66, 0.11, m.interior, sx, seatY + 0.37, sz0 - 0.3, -0.2);
    if (o.sport) { k.box('seat', 0.08, 0.5, 0.12, m.trim, sx - 0.2, seatY + 0.35, sz0 - 0.27, -0.2); k.box('seat', 0.08, 0.5, 0.12, m.trim, sx + 0.2, seatY + 0.35, sz0 - 0.27, -0.2); }
    else k.box('headrest', 0.26, 0.16, 0.09, m.interior, sx, seatY + 0.78, sz0 - 0.38, -0.2);
  }
  if (o.rear !== undefined) k.box('seat', o.dashW * 0.86, 0.55, 0.13, m.interior, 0, seatY + 0.32, o.rear, -0.2);
  k.box('dash', o.dashW, 0.18, 0.4, m.interior, 0, o.dashY, o.dashZ);
  k.box('dash-top', o.dashW, 0.02, 0.34, m.trim, 0, o.dashY + 0.1, o.dashZ - 0.02);
  if (!k.lite) {
    k.box('console', 0.22, 0.2, 0.7, m.trim, 0, seatY + 0.1, sz0 + 0.15);
    k.box('screen', 0.24, 0.13, 0.015, m.gloss, 0, o.dashY + 0.14, o.dashZ - 0.12, -0.3);
  }
  const sw = MeshBuilder.CreateTorus('steering', { diameter: 0.37, thickness: 0.032, tessellation: k.lite ? 10 : 24 }, k.scene);
  sw.position.set(sx0, o.dashY - 0.04, sz0 + 0.48); sw.rotation.x = -1.15; sw.material = m.trim; k.add(sw);
  k.cyl('steering', 0.02, 0.3, m.trim, sx0, o.dashY - 0.0, sz0 + 0.6, 'z').rotation.x = Math.PI / 2 - 0.42;
}
/** Wiper arms resting at the base of the windscreen. */
function wipers(k: Kit, z: number, y: number, w: number) {
  if (k.lite) return;
  for (const sx of [-0.05, 0.45]) { const b = k.box('wiper', w * 0.45, 0.012, 0.018, k.m.trim, sx * w, y + 0.015, z - 0.04); b.rotation.y = 0.12; }
}

// ------------------------------------------------------------------------------------------------------------------
// Road cars
// ------------------------------------------------------------------------------------------------------------------

function vanta(k: Kit, sp: VehicleSpec): DesignInfo {
  const { yc, h, seat } = base(sp), m = k.m, aR = sp.wheelRadius + 0.035;
  const roof = seat[1] + 0.9;
  k.buildBody({
    zf: 2.31, zr: -2.29, hw: 1.0, peF: 4.5, peR: 6, flare: 0.075,
    top: [[2.31, h(0.44)], [2.26, h(0.54)], [2.05, h(0.63)], [1.75, h(0.72)], [1.36, h(0.79)], [0.95, h(0.79)], [0.55, h(0.81)], [-1.0, h(0.84)], [-1.6, h(0.86)], [-2.02, h(0.93)], [-2.22, h(0.9)], [-2.29, h(0.72)]],
    sill: [[2.31, h(0.3)], [2.2, h(0.13)], [1.9, h(0.1)], [-1.9, h(0.12)], [-2.2, h(0.2)], [-2.29, h(0.38)]],
    shoulder: 0.66, nLo: 4, nUp: 3.8, tumble: 0.12,
    arches: [{ z: sp.wheelFrontZ, yc, r: aR }, { z: sp.wheelRearZ, yc, r: aR }],
    cabin: [-1.9, 0.5], wellY: seat[1] - 0.05,
  }, { step: k.lite ? 0.09 : 0.04, detail: k.lite ? 5 : 9, dent: !k.lite, stripes: [0.07, 0.2] });
  k.buildGreenhouse({ z0: 0.55, zr0: -0.2, zr1: -0.75, z1: -1.95, roof, w0: 0.8, w1: 0.58, n: 3,
    profile: [[-1.95, h(0.9)], [-1.3, roof - 0.17], [-0.75, roof - 0.02], [-0.45, roof + 0.005], [-0.2, roof - 0.01], [0.1, roof - 0.17], [0.55, h(0.8)]] },
  { step: k.lite ? 0.1 : 0.05, detail: k.lite ? 3 : 6, solid: [[-2.5, -0.95]], bpillar: [], seal: 'trim', truck: false, stripes: [0.07, 0.2] });
  wells(k, sp, aR, yc);
  cabin(k, sp, { dashZ: 0.33, dashY: seat[1] + 0.36, dashW: 1.36, sport: true });
  // nose: wide intake, splitter, slim swept lamps with LED signature, bonnet louvres
  k.onEnd('intake', 1, 0, h(0.26), [[-0.62, -0.1], [0.62, -0.1], [0.55, 0.09], [-0.55, 0.09]], 0.05, m.grille, 0.002);
  for (const sx of [-1, 1]) k.onEnd('intake', 1, sx * 0.8, h(0.24), [[-0.13, -0.08], [0.13, -0.08], [0.1, 0.07], [-0.1, 0.07]], 0.05, m.grille, 0.002);
  k.box('splitter', 1.8, 0.025, 0.3, m.carbon, 0, k.body.sill(2.1) - 0.015, 2.1);
  for (const sx of [-1, 1]) {
    k.lamp('headlight', 1, sx * 0.66, h(0.56), [[-0.2, -0.04], [0.16, -0.06], [0.22, 0.04], [-0.14, 0.06]], m.head, { depth: 0.06 });
    k.onEnd('drl', 1, sx * 0.66, h(0.515), [[-0.17, -0.008], [0.17, -0.02], [0.17, -0.008], [-0.17, 0.004]], 0.02, m.drl, 0.012);
    // bonnet louvres over the front wheels
    if (!k.lite) for (let i = 0; i < 5; i++) k.box('louvre', 0.32, 0.012, 0.025, m.carbon, sx * 0.62, h(0.795) + 0.004, 1.15 + i * 0.06, -0.15);
    // side exit vent behind the front wheel, side skirt
    k.onSide('side-vent', sx, 0.78, h(0.5), [[-0.14, -0.12], [0.12, -0.12], [0.16, 0.1], [-0.1, 0.1]], 0.03, m.grille, 0.002);
  }
  sideStrip(k, -1.0, 1.0, h(0.14), m.carbon, 0.035, 0.0);
  // the wing: swan-neck posts holding a twin-element carbon wing with end plates (the garage can delete or swap it)
  const wy = roof + 0.04, wz = -2.05;
  if (k.fit.spoiler === 'wing') {
    k.box('wing', 1.86, 0.025, 0.34, m.carbon, 0, wy, wz, -0.08);
    k.box('wing', 1.86, 0.018, 0.12, m.carbon, 0, wy + 0.06, wz - 0.17, -0.35);
    for (const sx of [-1, 1]) {
      k.box('wing-plate', 0.012, 0.22, 0.48, m.carbon, sx * 0.93, wy, wz - 0.04);
      k.tube('wing-post', [[sx * 0.34, h(0.92), -1.95], [sx * 0.34, wy + 0.08, -1.96], [sx * 0.34, wy + 0.03, -2.02]], 0.018, m.carbon, 6);
    }
  }
  // tail: full-width lamp, diffuser, centre exhausts
  k.onEnd('taillight', -1, 0, h(0.8), [[-0.6, -0.02], [0.6, -0.02], [0.62, 0.02], [-0.62, 0.02]], 0.03, m.brake, 0.003);
  for (const sx of [-1, 1]) k.lamp('taillight', -1, sx * 0.6, h(0.74), [[-0.16, -0.05], [0.12, -0.05], [0.18, 0.05], [-0.16, 0.05]], m.brake, { housing: m.gloss });
  k.onEnd('rear-mesh', -1, 0, h(0.45), rr(1.5, 0.2, 0.04), 0.03, m.grille, 0.002);
  k.box('diffuser', 1.5, 0.03, 0.4, m.carbon, 0, h(0.13), -2.12, -0.2);
  if (!k.lite) for (let i = -3; i <= 3; i++) k.box('diffuser-fin', 0.012, 0.14, 0.38, m.carbon, i * 0.2, h(0.18), -2.14, -0.2);
  for (const sx of [-1, 1]) k.cyl('exhaust', 0.055, 0.14, m.steel, sx * 0.1, h(0.27), -2.27, 'z');
  plate(k, -1, h(0.58));
  mirrors(k, 0.35, h(0.86), 0.18, 0.09, m.carbon);
  wipers(k, 0.55, h(0.81), 1.2);
  // quick-release bonnet pins, tow loop, roof scoop
  if (!k.lite) k.box('roof-scoop', 0.3, 0.05, 0.3, m.carbon, 0, roof + 0.02, -0.45);
  return { rim: 'split', rimF: 0.78, centreLock: true, brakes: true, beams: [[0.66, h(0.56), 2.2], [-0.66, h(0.56), 2.2]] };
}

function strix(k: Kit, sp: VehicleSpec): DesignInfo {
  const { yc, h, seat } = base(sp), m = k.m, aR = sp.wheelRadius + 0.04;
  const roof = seat[1] + 0.93, belt = h(0.93);
  k.buildBody({
    zf: 2.04, zr: -1.98, hw: 0.94, peF: 5.5, peR: 9, flare: 0.07,
    top: [[2.04, h(0.58)], [1.99, h(0.68)], [1.8, h(0.76)], [1.27, h(0.85)], [0.62, belt], [-1.85, h(0.98)], [-1.95, h(0.94)], [-1.98, h(0.84)]],
    sill: [[2.04, h(0.33)], [1.92, h(0.18)], [1.6, h(0.15)], [-1.6, h(0.16)], [-1.9, h(0.22)], [-1.98, h(0.4)]],
    shoulder: 0.7, nLo: 5, nUp: 4.6, tumble: 0.12,
    arches: [{ z: sp.wheelFrontZ, yc, r: aR }, { z: sp.wheelRearZ, yc, r: aR }],
    cabin: [-1.86, 0.58], wellY: seat[1] - 0.05,
  }, { step: k.lite ? 0.09 : 0.04, detail: k.lite ? 5 : 9, dent: !k.lite, cladY: h(0.22) });
  k.buildGreenhouse({ z0: 0.62, zr0: -0.05, zr1: -1.55, z1: -1.92, roof, w0: 0.78, w1: 0.62, n: 3.4,
    profile: [[-1.92, h(0.97)], [-1.64, roof - 0.05], [-1.4, roof], [-0.6, roof + 0.01], [-0.05, roof - 0.005], [0.22, roof - 0.13], [0.62, belt]] },
  { step: k.lite ? 0.1 : 0.05, detail: k.lite ? 3 : 6, solid: [[-2.5, -1.32]], bpillar: [[-0.92, -0.84]], seal: 'trim', truck: false });
  wells(k, sp, aR, yc);
  cabin(k, sp, { dashZ: 0.4, dashY: seat[1] + 0.38, dashW: 1.32, rear: -1.1, sport: true });
  // nose: big hexagonal mesh grille, angular lamps, fog lamps, bonnet scoop
  k.onEnd('grille', 1, 0, h(0.36), [[-0.42, -0.16], [0.42, -0.16], [0.5, 0.04], [0.36, 0.14], [-0.36, 0.14], [-0.5, 0.04]], 0.05, m.grille, 0.002);
  for (const sx of [-1, 1]) {
    k.lamp('headlight', 1, sx * 0.6, h(0.6), [[-0.12, -0.05], [0.2, -0.03], [0.22, 0.05], [-0.16, 0.05]], m.head);
    k.onEnd('drl', 1, sx * 0.6, h(0.555), [[-0.12, -0.006], [0.2, -0.006], [0.2, 0.006], [-0.12, 0.006]], 0.02, m.drl, 0.01);
    k.lamp('fog', 1, sx * 0.72, h(0.3), circle(0.045, 14), m.head, { housing: m.trim });
    // rally mud flaps
    k.box('mudflap', 0.24, 0.18, 0.012, m.accent, sx * 0.8, h(0.18), sp.wheelFrontZ - 0.42);
    k.box('mudflap', 0.24, 0.2, 0.012, m.accent, sx * 0.8, h(0.18), sp.wheelRearZ - 0.42);
  }
  k.box('scoop', 0.42, 0.07, 0.38, m.paint, 0, h(0.85), 1.2, -0.12);
  k.box('scoop-mouth', 0.36, 0.045, 0.02, m.gloss, 0, h(0.875), 1.385, -0.12);
  k.box('lip', 1.6, 0.025, 0.2, m.trim, 0, k.body.sill(1.85) - 0.012, 1.85);
  // tail: roof spoiler, lamps, twin exhaust, diffuser
  if (factoryAero(k)) {
    k.box('spoiler', 1.3, 0.03, 0.3, m.paint, 0, roof + 0.01, -1.6, 0.12);
    for (const sx of [-1, 1]) k.box('spoiler-side', 0.03, 0.08, 0.28, m.paint, sx * 0.63, roof - 0.02, -1.6);
  }
  for (const sx of [-1, 1]) k.lamp('taillight', -1, sx * 0.56, h(0.84), [[-0.14, -0.06], [0.15, -0.06], [0.18, 0.06], [-0.12, 0.05]], m.brake, { housing: m.gloss });
  k.onEnd('rear-bumper', -1, 0, h(0.25), rr(1.4, 0.12, 0.03), 0.03, m.trim, 0.002);
  for (const sx of [-1, 1]) k.cyl('exhaust', 0.045, 0.14, m.steel, sx * 0.4, h(0.24), -1.98, 'z');
  plate(k, -1, h(0.52));
  plate(k, 1, h(0.25));
  mirrors(k, 0.45, belt + 0.02);
  handles(k, [-0.6], belt - 0.08, m.trim);
  sideLine(k, 0.6, h(0.2), belt, m.trim); sideLine(k, -0.88, h(0.2), belt, m.trim);
  wipers(k, 0.62, belt, 1.2);
  // a rally livery band along the flank
  sideStrip(k, -1.6, 1.7, h(0.42), m.accent, 0.025, -0.008);
  return { rim: 'multi', rimF: 0.74, brakes: true, beams: [[0.6, h(0.6), 1.95], [-0.6, h(0.6), 1.95]] };
}

function pella(k: Kit, sp: VehicleSpec): DesignInfo {
  const { yc, h, seat } = base(sp), m = k.m, aR = sp.wheelRadius + 0.04;
  const roof = seat[1] + 0.95, belt = h(0.88);
  k.buildBody({
    zf: 2.02, zr: -1.99, hw: 0.86, peF: 5.5, peR: 8, flare: 0.02,
    top: [[2.02, h(0.6)], [1.98, h(0.7)], [1.8, h(0.76)], [1.25, h(0.81)], [0.62, belt], [-1.85, h(0.94)], [-1.95, h(0.89)], [-1.99, h(0.78)]],
    sill: [[2.02, h(0.31)], [1.9, h(0.2)], [1.6, h(0.16)], [-1.6, h(0.17)], [-1.9, h(0.22)], [-1.99, h(0.36)]],
    shoulder: 0.72, nLo: 5, nUp: 4.6, tumble: 0.12,
    arches: [{ z: sp.wheelFrontZ, yc, r: aR }, { z: sp.wheelRearZ, yc, r: aR }],
    cabin: [-1.88, 0.56], wellY: seat[1] - 0.05,
  }, { step: k.lite ? 0.09 : 0.04, detail: k.lite ? 5 : 9, dent: !k.lite, cladY: h(0.21) });
  k.buildGreenhouse({ z0: 0.62, zr0: -0.02, zr1: -1.6, z1: -1.93, roof, w0: 0.74, w1: 0.6, n: 3.6,
    profile: [[-1.93, h(0.93)], [-1.72, roof - 0.05], [-1.5, roof], [-0.6, roof + 0.01], [-0.02, roof - 0.005], [0.25, roof - 0.13], [0.62, belt]] },
  { step: k.lite ? 0.1 : 0.05, detail: k.lite ? 3 : 6, solid: [[-2.5, -1.42]], bpillar: [[-0.6, -0.52]], seal: 'trim', truck: false });
  wells(k, sp, aR, yc);
  cabin(k, sp, { dashZ: 0.42, dashY: seat[1] + 0.38, dashW: 1.3, rear: -1.08 });
  // nose: slim upper grille bar joining the lamps, trapezoid lower grille
  k.onEnd('grille', 1, 0, h(0.6), rr(0.74, 0.07, 0.02), 0.04, m.gloss, 0.002);
  k.onEnd('grille-chrome', 1, 0, h(0.585), rr(0.86, 0.012, 0.005), 0.02, m.chrome, 0.01);
  k.onEnd('lower-grille', 1, 0, h(0.32), [[-0.36, -0.08], [0.36, -0.08], [0.42, 0.07], [-0.42, 0.07]], 0.04, m.grille, 0.002);
  for (const sx of [-1, 1]) {
    k.lamp('headlight', 1, sx * 0.56, h(0.6), [[-0.14, -0.04], [0.16, -0.05], [0.19, 0.04], [-0.14, 0.04]], m.head);
    k.onEnd('drl', 1, sx * 0.56, h(0.565), [[-0.12, -0.005], [0.15, -0.012], [0.15, 0.0], [-0.12, 0.006]], 0.02, m.drl, 0.01);
    k.lamp('fog', 1, sx * 0.66, h(0.28), rr(0.09, 0.035, 0.012), m.head, { housing: m.trim });
    // wrap-around tail lamps reaching into the tailgate
    k.lamp('taillight', -1, sx * 0.52, h(0.8), [[-0.16, -0.06], [0.14, -0.06], [0.18, 0.06], [-0.16, 0.05]], m.brake, { housing: m.gloss });
  }
  if (factoryAero(k)) k.box('spoiler', 1.1, 0.025, 0.18, m.paint, 0, roof - 0.005, -1.62, 0.1);
  k.onEnd('rear-bumper', -1, 0, h(0.24), rr(1.3, 0.05, 0.02), 0.02, m.trim, 0.002);
  k.cyl('exhaust', 0.03, 0.1, m.steel, -0.45, h(0.18), -1.96, 'z');
  plate(k, -1, h(0.5)); plate(k, 1, h(0.42));
  mirrors(k, 0.45, belt + 0.02);
  handles(k, [-0.2, -1.1], belt - 0.07, m.paint);
  for (const z of [0.6, -0.56, -1.38]) sideLine(k, z, h(0.2), belt, m.trim);
  // character line under the window
  sideStrip(k, -1.85, 1.9, belt - 0.08, m.paint, 0.008, -0.004);
  wipers(k, 0.62, belt, 1.15);
  return { rim: 'five', rimF: 0.72, brakes: true, beams: [[0.56, h(0.6), 1.95], [-0.56, h(0.6), 1.95]] };
}

function corvan(k: Kit, sp: VehicleSpec): DesignInfo {
  const { yc, h, seat } = base(sp), m = k.m, aR = sp.wheelRadius + 0.04;
  const roof = seat[1] + 0.95, belt = h(0.87);
  k.buildBody({
    zf: 2.42, zr: -2.4, hw: 0.91, peF: 5.5, peR: 6, flare: 0.02,
    top: [[2.42, h(0.6)], [2.37, h(0.7)], [2.1, h(0.77)], [1.4, h(0.81)], [0.75, belt], [-1.45, h(0.93)], [-2.1, h(0.96)], [-2.32, h(0.93)], [-2.4, h(0.79)]],
    sill: [[2.42, h(0.33)], [2.25, h(0.2)], [1.9, h(0.16)], [-1.9, h(0.17)], [-2.25, h(0.23)], [-2.4, h(0.38)]],
    shoulder: 0.72, nLo: 5, nUp: 4.6, tumble: 0.12,
    arches: [{ z: sp.wheelFrontZ, yc, r: aR }, { z: sp.wheelRearZ, yc, r: aR }],
    cabin: [-1.58, 0.7], wellY: seat[1] - 0.05,
  }, { step: k.lite ? 0.09 : 0.04, detail: k.lite ? 5 : 9, dent: !k.lite });
  k.buildGreenhouse({ z0: 0.75, zr0: 0.0, zr1: -0.95, z1: -1.62, roof, w0: 0.78, w1: 0.62, n: 3.4,
    profile: [[-1.62, h(0.92)], [-1.35, roof - 0.14], [-0.95, roof - 0.01], [-0.4, roof + 0.012], [0, roof], [0.3, roof - 0.13], [0.75, belt]] },
  { step: k.lite ? 0.1 : 0.05, detail: k.lite ? 3 : 6, solid: [[-2.5, -1.18]], bpillar: [[-0.52, -0.43]], seal: 'chrome', truck: false });
  wells(k, sp, aR, yc);
  cabin(k, sp, { dashZ: 0.55, dashY: seat[1] + 0.38, dashW: 1.38, rear: -1.05 });
  k.onEnd('grille', 1, 0, h(0.55), [[-0.42, -0.08], [0.42, -0.08], [0.46, 0.06], [-0.46, 0.06]], 0.04, m.mesh, 0.002);
  k.onEnd('grille-chrome', 1, 0, h(0.62), rr(0.95, 0.018, 0.006), 0.02, m.chrome, 0.008);
  k.onEnd('lower-grille', 1, 0, h(0.28), [[-0.5, -0.06], [0.5, -0.06], [0.44, 0.06], [-0.44, 0.06]], 0.04, m.grille, 0.002);
  for (const sx of [-1, 1]) {
    k.lamp('headlight', 1, sx * 0.62, h(0.63), [[-0.16, -0.035], [0.2, -0.05], [0.22, 0.04], [-0.18, 0.035]], m.head);
    k.onEnd('drl', 1, sx * 0.62, h(0.6), [[-0.16, -0.005], [0.2, -0.01], [0.2, 0.0], [-0.16, 0.004]], 0.02, m.drl, 0.01);
    k.lamp('taillight', -1, sx * 0.55, h(0.85), [[-0.2, -0.05], [0.15, -0.06], [0.2, 0.05], [-0.2, 0.05]], m.brake, { housing: m.gloss });
    k.lamp('reverse', -1, sx * 0.28, h(0.86), rr(0.08, 0.04, 0.01), m.reverse, { housing: m.gloss });
  }
  k.onEnd('boot-chrome', -1, 0, h(0.78), rr(0.5, 0.012, 0.005), 0.02, m.chrome, 0.008);
  k.onEnd('rear-bumper', -1, 0, h(0.25), rr(1.5, 0.04, 0.02), 0.02, m.trim, 0.002);
  plate(k, -1, h(0.6)); plate(k, 1, h(0.4));
  mirrors(k, 0.55, belt + 0.02);
  handles(k, [-0.15, -1.0], belt - 0.08, m.chrome);
  for (const z of [0.72, -0.48, -1.26]) sideLine(k, z, h(0.2), belt, m.trim);
  sideLine(k, -1.62, h(0.93), h(0.93), m.trim);
  sideStrip(k, -1.9, 2.0, h(0.63), m.paint, 0.007, -0.003);
  wipers(k, 0.75, belt, 1.2);
  return { rim: 'turbine', rimF: 0.7, brakes: true, beams: [[0.62, h(0.63), 2.32], [-0.62, h(0.63), 2.32]] };
}

function halcyon(k: Kit, sp: VehicleSpec): DesignInfo {
  const { yc, h, seat } = base(sp), m = k.m, aR = sp.wheelRadius + 0.04;
  const roof = seat[1] + 0.97, belt = h(0.92);
  k.buildBody({
    zf: 2.7, zr: -2.66, hw: 0.98, peF: 8, peR: 6, flare: 0.015,
    top: [[2.7, h(0.72)], [2.66, h(0.83)], [2.4, h(0.87)], [1.62, h(0.89)], [0.95, belt], [-1.6, h(0.98)], [-2.3, h(1.0)], [-2.58, h(0.97)], [-2.66, h(0.82)]],
    sill: [[2.7, h(0.3)], [2.55, h(0.2)], [2.2, h(0.17)], [-2.2, h(0.18)], [-2.55, h(0.24)], [-2.66, h(0.4)]],
    shoulder: 0.74, nLo: 6, nUp: 5.5, tumble: 0.1,
    arches: [{ z: sp.wheelFrontZ, yc, r: aR }, { z: sp.wheelRearZ, yc, r: aR }],
    cabin: [-1.75, 0.9], wellY: seat[1] - 0.05,
  }, { step: k.lite ? 0.09 : 0.04, detail: k.lite ? 5 : 9, dent: !k.lite });
  k.buildGreenhouse({ z0: 0.95, zr0: 0.15, zr1: -1.1, z1: -1.8, roof, w0: 0.84, w1: 0.68, n: 3.2,
    profile: [[-1.8, h(0.97)], [-1.5, roof - 0.13], [-1.1, roof - 0.01], [-0.5, roof + 0.012], [0.15, roof], [0.5, roof - 0.14], [0.95, belt]] },
  { step: k.lite ? 0.1 : 0.05, detail: k.lite ? 3 : 6, solid: [[-2.6, -1.42]], bpillar: [[-0.46, -0.36]], seal: 'chrome', truck: false });
  wells(k, sp, aR, yc);
  cabin(k, sp, { dashZ: 0.75, dashY: seat[1] + 0.4, dashW: 1.46, rear: -1.15 });
  // upright chrome grille: frame and vertical vanes
  k.onEnd('grille', 1, 0, h(0.6), rr(0.62, 0.34, 0.03), 0.05, m.gloss, 0.004);
  k.onEnd('grille-frame', 1, 0, h(0.6), rr(0.68, 0.4, 0.04), 0.03, m.chrome, 0.0);
  if (!k.lite) for (let i = -7; i <= 7; i++) k.onEnd('grille-vane', 1, i * 0.04, h(0.6), [[-0.006, -0.16], [0.006, -0.16], [0.006, 0.16], [-0.006, 0.16]], 0.03, m.chrome, 0.02);
  for (const sx of [-1, 1]) {
    k.lamp('headlight', 1, sx * 0.7, h(0.68), [[-0.16, -0.04], [0.2, -0.05], [0.22, 0.04], [-0.16, 0.04]], m.head);
    k.onEnd('drl', 1, sx * 0.7, h(0.64), [[-0.18, -0.006], [0.2, -0.012], [0.2, 0.0], [-0.18, 0.006]], 0.02, m.drl, 0.01);
    k.onEnd('intake', 1, sx * 0.66, h(0.3), rr(0.3, 0.08, 0.02), 0.03, m.grille, 0.002);
    k.onEnd('intake-chrome', 1, sx * 0.66, h(0.3), rr(0.34, 0.012, 0.005), 0.02, m.chrome, 0.012);
    k.cyl('exhaust', 0.04, 0.08, m.chrome, sx * 0.58, h(0.2), -2.63, 'z').scaling.set(2.6, 1, 1);
  }
  // full-width light bar with chrome strip beneath
  k.onEnd('taillight', -1, 0, h(0.88), [[-0.6, -0.025], [0.6, -0.025], [0.62, 0.025], [-0.62, 0.025]], 0.03, m.brake, 0.003);
  for (const sx of [-1, 1]) k.lamp('taillight', -1, sx * 0.64, h(0.86), [[-0.16, -0.05], [0.16, -0.05], [0.18, 0.05], [-0.16, 0.05]], m.brake, { housing: m.gloss });
  k.onEnd('boot-chrome', -1, 0, h(0.79), rr(1.2, 0.015, 0.006), 0.02, m.chrome, 0.008);
  k.onEnd('rear-chrome', -1, 0, h(0.32), rr(1.5, 0.015, 0.006), 0.02, m.chrome, 0.008);
  plate(k, -1, h(0.6)); plate(k, 1, h(0.36));
  mirrors(k, 0.75, belt + 0.02);
  handles(k, [-0.05, -1.05], belt - 0.08, m.chrome);
  for (const z of [0.9, -0.42, -1.4]) sideLine(k, z, h(0.2), belt, m.trim);
  sideStrip(k, -2.2, 2.25, h(0.22), m.chrome, 0.008, 0.0);
  sideStrip(k, -1.8, 0.95, belt + 0.005, m.chrome, 0.008, -0.004);
  wipers(k, 0.95, belt, 1.3);
  if (!k.lite) k.box('bonnet-crease', 0.012, 0.008, 1.5, m.chrome, 0, h(0.875), 1.85);
  return { rim: 'multi', rimF: 0.76, brakes: true, beams: [[0.7, h(0.68), 2.6], [-0.7, h(0.68), 2.6]] };
}

function solenne(k: Kit, sp: VehicleSpec): DesignInfo {
  const { yc, h, seat } = base(sp), m = k.m, aR = sp.wheelRadius + 0.035;
  const roof = seat[1] + 0.9, belt = h(0.81);
  k.buildBody({
    zf: 2.47, zr: -2.43, hw: 1.0, peF: 4.2, peR: 4.6, flare: 0.055,
    top: [[2.47, h(0.48)], [2.42, h(0.58)], [2.2, h(0.67)], [1.5, h(0.76)], [0.4, belt], [-1.4, h(0.84)], [-2.0, h(0.87)], [-2.32, h(0.88)], [-2.43, h(0.74)]],
    sill: [[2.47, h(0.3)], [2.3, h(0.15)], [2.0, h(0.12)], [-2.0, h(0.13)], [-2.3, h(0.2)], [-2.43, h(0.36)]],
    shoulder: 0.66, nLo: 4, nUp: 3.8, tumble: 0.14,
    arches: [{ z: sp.wheelFrontZ, yc, r: aR }, { z: sp.wheelRearZ, yc, r: aR }],
    cabin: [-2.0, 0.35], wellY: seat[1] - 0.05,
  }, { step: k.lite ? 0.09 : 0.04, detail: k.lite ? 5 : 9, dent: !k.lite });
  k.buildGreenhouse({ z0: 0.4, zr0: -0.3, zr1: -0.85, z1: -2.05, roof, w0: 0.78, w1: 0.56, n: 3,
    profile: [[-2.05, h(0.87)], [-1.5, roof - 0.2], [-0.85, roof - 0.02], [-0.55, roof + 0.006], [-0.3, roof - 0.01], [-0.02, roof - 0.15], [0.4, belt]] },
  { step: k.lite ? 0.1 : 0.05, detail: k.lite ? 3 : 6, solid: [[-2.5, -1.12]], bpillar: [], seal: 'chrome', truck: false });
  wells(k, sp, aR, yc);
  cabin(k, sp, { dashZ: 0.2, dashY: seat[1] + 0.36, dashW: 1.36 });
  // wide trapezoid grille with horizontal chrome slats
  k.onEnd('grille', 1, 0, h(0.34), [[-0.36, -0.12], [0.36, -0.12], [0.46, 0.1], [-0.46, 0.1]], 0.05, m.gloss, 0.002);
  k.onEnd('grille-frame', 1, 0, h(0.34), [[-0.39, -0.14], [0.39, -0.14], [0.5, 0.12], [-0.5, 0.12]], 0.03, m.chrome, -0.004);
  if (!k.lite) for (let i = 0; i < 6; i++) { const y = -0.1 + i * 0.038, w = 0.37 + (i / 5) * 0.08; k.onEnd('grille-slat', 1, 0, h(0.34) + y, [[-w, -0.004], [w, -0.004], [w, 0.004], [-w, 0.004]], 0.02, m.chrome, 0.02); }
  for (const sx of [-1, 1]) {
    k.lamp('headlight', 1, sx * 0.68, h(0.55), [[-0.18, -0.03], [0.14, -0.05], [0.2, 0.02], [-0.12, 0.05]], m.head);
    k.onEnd('drl', 1, sx * 0.68, h(0.52), [[-0.15, -0.005], [0.15, -0.015], [0.15, -0.003], [-0.15, 0.006]], 0.02, m.drl, 0.012);
    // side strakes behind the front wheels
    k.onSide('strake', sx, 1.0, h(0.5), [[-0.12, -0.05], [0.12, -0.05], [0.1, 0.05], [-0.14, 0.05]], 0.02, m.gloss, 0.0);
    if (!k.lite) k.onSide('strake-chrome', sx, 1.0, h(0.5), [[-0.13, -0.006], [0.12, -0.006], [0.12, 0.006], [-0.13, 0.006]], 0.02, m.chrome, 0.008);
    // slim tail lamps wrapping round the haunches
    k.lamp('taillight', -1, sx * 0.6, h(0.77), [[-0.2, -0.035], [0.16, -0.045], [0.2, 0.035], [-0.2, 0.04]], m.brake, { housing: m.gloss });
    for (const ex of [0.38, 0.5]) k.cyl('exhaust', 0.042, 0.12, m.steel, sx * ex, h(0.2), -2.4, 'z');
  }
  k.onEnd('diffuser', -1, 0, h(0.24), rr(1.3, 0.1, 0.03), 0.03, m.gloss, 0.002);
  plate(k, -1, h(0.55));
  mirrors(k, 0.25, belt + 0.02, 0.2, 0.09);
  handles(k, [-0.35], belt - 0.07, m.paint);
  sideLine(k, 0.36, h(0.18), belt, m.trim); sideLine(k, -1.0, h(0.18), belt, m.trim);
  // integrated boot-lid spoiler lip
  if (factoryAero(k)) k.box('lip', 1.3, 0.02, 0.12, m.paint, 0, h(0.89), -2.28, 0.15);
  wipers(k, 0.4, belt, 1.2);
  if (!k.lite) for (const sx of [-1, 1]) k.box('bonnet-vent', 0.2, 0.01, 0.3, m.gloss, sx * 0.4, h(0.775), 1.3, -0.06);
  return { rim: 'mesh', rimF: 0.76, brakes: true, beams: [[0.68, h(0.55), 2.36], [-0.68, h(0.55), 2.36]] };
}

// ------------------------------------------------------------------------------------------------------------------
// Off-roaders
// ------------------------------------------------------------------------------------------------------------------

function ranger(k: Kit, sp: VehicleSpec): DesignInfo {
  const { yc, seat } = base(sp), m = k.m, aR = 0.56;
  const fz = sp.wheelFrontZ, rz = sp.wheelRearZ;
  k.buildBody({
    zf: 2.24, zr: -2.26, hw: 0.92, peF: 12, peR: 14, flare: 0,
    top: [[2.24, 0.34], [2.18, 0.43], [1.9, 0.455], [0.6, 0.47], [-2.12, 0.47], [-2.24, 0.45], [-2.26, 0.36]],
    sill: [[2.24, -0.22], [2.12, -0.31], [-2.12, -0.31], [-2.26, -0.22]],
    shoulder: 0.72, nLo: 8, nUp: 5, tumble: 0.03,
    arches: [{ z: fz, yc, r: aR }, { z: rz, yc, r: aR }],
    cabin: [-1.95, 0.48], wellY: seat[1] - 0.04,
  }, { step: k.lite ? 0.09 : 0.04, detail: k.lite ? 5 : 8, dent: !k.lite });
  const roof = 1.12;
  k.buildGreenhouse({ z0: 0.56, zr0: 0.1, zr1: -2.03, z1: -2.14, roof, w0: 0.86, w1: 0.8, n: 7,
    profile: [[-2.14, 0.46], [-2.07, roof - 0.03], [-1.9, roof + 0.005], [-0.3, roof + 0.012], [0.1, roof], [0.56, 0.46]] },
  { step: k.lite ? 0.1 : 0.05, detail: k.lite ? 3 : 6, solid: [[-2.3, -1.96], [-1.56, -1.46]], bpillar: [[-0.64, -0.54]], seal: 'trim', truck: true, railA: 0.56 });
  cabin(k, sp, { dashZ: 0.32, dashY: 0.58, dashW: 1.56, rear: -1.35 });
  // black wheel-arch flares following the arch, rubber liners
  wells(k, sp, aR, yc, 0.08);
  for (const sx of [-1, 1]) for (const cz of [fz, rz]) {
    const path: [number, number, number][] = [];
    for (let i = 0; i <= 14; i++) { const a = 0.18 + (Math.PI - 0.36) * (i / 14); path.push([sx * 0.935, yc + Math.sin(a) * (aR + 0.04), cz + Math.cos(a) * (aR + 0.04)]); }
    const t = k.tube('flare', path, 0.07, m.trim, 8); t.scaling.x = 0.7;
  }
  // nose: slatted grille in a body-colour surround, round lamps in square bezels, amber indicators
  k.onEnd('grille', 1, 0, 0.16, rr(1.16, 0.3, 0.02), 0.05, m.gloss, 0.004);
  if (!k.lite) for (let i = 0; i < 4; i++) k.onEnd('grille-slat', 1, 0, 0.06 + i * 0.065, [[-0.54, -0.012], [0.54, -0.012], [0.54, 0.012], [-0.54, 0.012]], 0.03, m.steel, 0.025);
  for (const sx of [-1, 1]) {
    k.onEnd('bezel', 1, sx * 0.74, 0.17, rr(0.3, 0.27, 0.03), 0.04, m.gloss, 0.004);
    k.lamp('headlight', 1, sx * 0.74, 0.17, circle(0.1, 22), m.head, { housing: m.chrome, inset: 0.88, out: 0.018 });
    k.lamp('indicator', 1, sx * 0.74, -0.03, rr(0.2, 0.06, 0.015), m.amber, { housing: m.trim, out: 0.004 });
    // tall rear lamp clusters in the corners
    k.lamp('taillight', -1, sx * 0.82, 0.2, rr(0.13, 0.36, 0.02), m.brake, { housing: m.trim });
    k.lamp('reverse', -1, sx * 0.82, -0.05, rr(0.13, 0.08, 0.02), m.reverse, { housing: m.trim });
    // mud flaps
    k.box('mudflap', 0.26, 0.3, 0.012, m.rubber, sx * 0.8, -0.5, rz - 0.62);
  }
  // steel bumpers, bull bar, winch, recovery points
  k.loose.push({ mesh: k.box('bumper-f', 1.96, 0.2, 0.26, m.steel, 0, -0.28, 2.3), region: 'front', base: 0 });
  k.loose.push({ mesh: k.box('bumper-r', 1.96, 0.2, 0.22, m.steel, 0, -0.28, -2.34), region: 'rear', base: 0 });
  k.cyl('winch', 0.1, 0.6, m.trim, 0, -0.2, 2.44, 'x');
  for (const sx of [-1, 1]) k.box('shackle', 0.04, 0.09, 0.06, m.accent, sx * 0.72, -0.28, 2.45);
  // the rear door: spare wheel carrier, ladder, plate
  k.cyl('spare', 0.4, 0.27, m.rubber, 0.2, 0.42, -2.42, 'z'); k.cyl('spare-hub', 0.24, 0.29, m.steel, 0.2, 0.42, -2.42, 'z');
  if (!k.lite) for (let i = 0; i < 5; i++) k.box('ladder', 0.32, 0.025, 0.025, m.trim, -0.55, 0.0 + i * 0.22, -2.31);
  k.box('ladder', 0.025, 1.0, 0.025, m.trim, -0.7, 0.45, -2.31); k.box('ladder', 0.025, 1.0, 0.025, m.trim, -0.4, 0.45, -2.31);
  plate(k, -1, -0.1, 0.2);
  plate(k, 1, -0.29);
  // body details: door shuts, handles, mirrors on arms, bonnet vent, wipers
  for (const z of [0.52, -0.6, -1.5]) sideLine(k, z, -0.28, 0.46, m.trim);
  handles(k, [-0.4, -1.3], 0.36, m.steel);
  for (const sx of [-1, 1]) {
    k.box('mirror-arm', 0.18, 0.03, 0.03, m.trim, sx * 0.97, 0.6, 0.42);
    k.box('mirror', 0.05, 0.2, 0.24, m.gloss, sx * 1.06, 0.66, 0.4);
  }
  k.box('bonnet-vent', 0.6, 0.04, 0.4, m.gloss, 0, 0.475, 1.25);
  wipers(k, 0.56, 0.47, 1.4);
  k.box('frame', 1.0, 0.16, 4.1, m.trim, 0, -0.42, 0);
  k.box('skid', 1.0, 0.05, 1.1, m.steel, 0, -0.5, 1.2);
  // garage parts: bull bar, roof rack, driving lamps, steps or sliders, snorkel
  const extraBeams = offroadParts(k, {
    roofY: roof, roofZ: [0.0, -1.95], roofW: 1.5, bumperY: -0.28, bumperZ: 2.3, bumperHW: 0.98,
    sillX: 0.98, sillY: -0.42, sillZ: [0.75, -0.85],
    snorkel: [[-0.94, 0.1, 0.95], [-0.95, 0.4, 0.8], [-0.95, 0.46, 0.56], [-0.92, 1.0, 0.2], [-0.92, 1.12, 0.17]],
  });
  return { rim: 'steel', rimF: 0.6, brakes: false, beams: [[0.74, 0.17, 2.24], [-0.74, 0.17, 2.24]], extraBeams };
}

function bramble(k: Kit, sp: VehicleSpec): DesignInfo {
  const { yc } = base(sp), m = k.m, aR = 0.62;
  const fz = sp.wheelFrontZ, rz = sp.wheelRearZ;
  k.buildBody({
    zf: 1.95, zr: -1.95, hw: 0.86, peF: 12, peR: 14, flare: 0,
    top: [[1.95, 0.22], [1.9, 0.3], [1.6, 0.36], [0.72, 0.41], [-1.88, 0.39], [-1.95, 0.3]],
    sill: [[1.95, -0.1], [1.85, -0.2], [-1.85, -0.2], [-1.95, -0.1]],
    shoulder: 0.66, nLo: 8, nUp: 5, tumble: 0.03,
    arches: [{ z: fz, yc, r: aR }, { z: rz, yc, r: aR }],
    cabin: [-1.75, 0.66], wellY: 0.02,
  }, { step: k.lite ? 0.09 : 0.04, detail: k.lite ? 5 : 8, dent: !k.lite });
  cabin(k, sp, { dashZ: 0.48, dashY: 0.44, dashW: 1.4 });
  wells(k, sp, aR, yc, 0.06);
  // flat-topped tube fenders over the big tyres
  for (const sx of [-1, 1]) for (const cz of [fz, rz]) {
    const path: [number, number, number][] = [];
    for (let i = 0; i <= 14; i++) { const a = 0.12 + (Math.PI - 0.24) * (i / 14); path.push([sx * 0.98, yc + Math.sin(a) * (aR + 0.03), cz + Math.cos(a) * (aR + 0.03)]); }
    const t = k.tube('flare', path, 0.08, m.trim, 8); t.scaling.x = 1.3;
    k.box('fender-top', 0.3, 0.03, 0.7, m.trim, sx * 0.96, yc + aR + 0.08, cz);
  }
  // nose: round lamps flanking a horizontal-bar grille, tow hooks, hood vents
  k.onEnd('grille-panel', 1, 0, 0.08, rr(1.5, 0.42, 0.04), 0.03, m.paint, 0.002);
  k.onEnd('grille', 1, 0, 0.06, rr(0.7, 0.3, 0.03), 0.04, m.gloss, 0.014);
  if (!k.lite) for (let i = 0; i < 4; i++) k.onEnd('grille-bar', 1, 0, -0.04 + i * 0.07, [[-0.32, -0.012], [0.32, -0.012], [0.32, 0.012], [-0.32, 0.012]], 0.02, m.trim, 0.03);
  for (const sx of [-1, 1]) {
    k.lamp('headlight', 1, sx * 0.56, 0.1, circle(0.11, 22), m.head, { housing: m.chrome, inset: 0.86, out: 0.016 });
    k.lamp('indicator', 1, sx * 0.8, 0.14, rr(0.08, 0.06, 0.015), m.amber, { housing: m.trim, out: 0.004 });
    k.box('hood-vent', 0.22, 0.02, 0.3, m.gloss, sx * 0.36, 0.385, 1.3, -0.05);
    k.box('tow-hook', 0.04, 0.08, 0.1, m.accent, sx * 0.5, -0.12, 2.08);
    // vertical rear lamps
    k.lamp('taillight', -1, sx * 0.76, 0.12, rr(0.1, 0.26, 0.02), m.brake, { housing: m.trim });
  }
  // open top: windscreen frame, roll cage, light bar
  k.tube('ws-frame', [[-0.74, 0.4, 0.66], [-0.72, 0.98, 0.5], [0.72, 0.98, 0.5], [0.74, 0.4, 0.66]], 0.035, m.paint, 8);
  const ws = k.box('windshield', 1.4, 0.52, 0.015, m.glass, 0, 0.69, 0.58, -0.27); ws.name = 'windshield';
  for (const sx of [-0.74, 0.74]) {
    k.tube('cage', [[sx, 0.98, 0.5], [sx * 0.96, 1.25, 0.05], [sx * 0.96, 1.28, -0.75], [sx, 0.36, -0.95]], 0.035, m.trim);
    k.tube('cage', [[sx * 0.96, 1.28, -0.75], [sx, 0.38, -1.85]], 0.035, m.trim);
    k.box('mirror', 0.04, 0.12, 0.18, m.gloss, sx * 1.22, 0.62, 0.5);
    k.box('mirror-arm', 0.24, 0.02, 0.02, m.trim, sx * 1.08, 0.6, 0.52);
  }
  k.tube('cage', [[-0.71, 1.25, 0.05], [0.71, 1.25, 0.05]], 0.035, m.trim);
  k.tube('cage', [[-0.71, 1.28, -0.75], [0.71, 1.28, -0.75]], 0.035, m.trim);
  k.tube('cage', [[-0.71, 1.27, -0.35], [0.71, 1.27, -0.35]], 0.025, m.trim);
  // steel bumpers, winch, tailgate spare
  k.loose.push({ mesh: k.tube('bumper-f', [[-0.95, -0.12, 2.04], [0.95, -0.12, 2.04]], 0.07, m.steel), region: 'front', base: 0 });
  k.cyl('winch', 0.1, 0.55, m.trim, 0, 0.0, 2.1, 'x');
  k.loose.push({ mesh: k.tube('bumper-r', [[-0.95, -0.1, -2.02], [0.95, -0.1, -2.02]], 0.07, m.steel), region: 'rear', base: 0 });
  k.cyl('spare', 0.48, 0.3, m.rubber, 0, 0.42, -2.12, 'z'); k.cyl('spare-hub', 0.3, 0.32, m.rim, 0, 0.42, -2.12, 'z');
  plate(k, -1, -0.05, 0.45);
  for (const z of [0.66, -0.55]) sideLine(k, z, -0.15, 0.39, m.trim);
  if (!k.lite) for (const sx of [-1, 1]) for (const z of [0.58, 0.0]) k.box('hinge', 0.02, 0.05, 0.08, m.trim, sx * 0.88, 0.25, z);
  k.box('frame', 1.0, 0.14, 3.6, m.trim, 0, -0.32, 0);
  k.box('skid', 0.9, 0.05, 1.4, m.steel, 0, -0.42, 0.4);
  // garage parts on the cage and frame
  const extraBeams = offroadParts(k, {
    roofY: 1.27, roofZ: [0.05, -0.75], roofW: 1.42, bumperY: -0.12, bumperZ: 2.0, bumperHW: 0.95,
    sillX: 0.98, sillY: -0.4, sillZ: [0.85, -0.85],
    snorkel: [[-0.9, 0.2, 1.0], [-0.92, 0.36, 0.86], [-0.92, 0.4, 0.66], [-0.8, 0.98, 0.52], [-0.8, 1.12, 0.5]],
  });
  return { rim: 'beadlock', rimF: 0.58, brakes: false, beams: [[0.56, 0.1, 1.98], [-0.56, 0.1, 1.98]], extraBeams };
}

const DESIGNS: Record<string, (k: Kit, sp: VehicleSpec) => DesignInfo> = {
  'ranger-tx4': ranger, 'bramble-rc2': bramble, 'vanta-gt': vanta, 'strix-r2': strix, pella, corvan, halcyon, 'solenne-gt': solenne,
};

/** Fallback by body style for any vehicle without a bespoke design. */
const BY_STYLE: Record<string, (k: Kit, sp: VehicleSpec) => DesignInfo> = { wagon: ranger, crawler: bramble, coupe: solenne, hatch: pella, sedan: corvan };

export function buildDesign(k: Kit, sp: VehicleSpec): DesignInfo {
  k.fit = sp.look.fit ?? stockFit(sp); k.livery = sp.look.livery ?? 'stock';
  const info = (DESIGNS[sp.id] ?? BY_STYLE[sp.look.style] ?? corvan)(k, sp);
  if (sp.drivetrain !== 'part-time-4wd') roadParts(k, sp, sp.id === 'vanta-gt');
  return info;
}

export { ring as ringPts };
