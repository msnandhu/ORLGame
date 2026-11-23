import type { VehicleSpec } from '@orl/shared';
import type { Kit } from './carKit';

/**
 * Garage parts drawn on the cars. The designs say where things go (Anchors); the fitted option ids come from the
 * vehicle's look (set by applyBuild), so what you buy in the garage is what you see in the world.
 */
export interface OffroadAnchors {
  /** roof (or roll cage) top: height, front and rear z, usable width */
  roofY: number; roofZ: [number, number]; roofW: number;
  /** front bumper: height and its front face z; half width */
  bumperY: number; bumperZ: number; bumperHW: number;
  /** sills: outer x, height, front and rear z */
  sillX: number; sillY: number; sillZ: [number, number];
  /** snorkel path (driver's-side-opposite front wing up the A-pillar), or null when the body has no place for one */
  snorkel: [number, number, number][];
}
type V3 = [number, number, number];

/** Off-road accessories; returns where the extra driving lamps shine from. */
export function offroadParts(k: Kit, a: OffroadAnchors): V3[] {
  const m = k.m, fit = k.fit, beams: V3[] = [];
  const [rz0, rz1] = a.roofZ, rlen = rz0 - rz1, rmid = (rz0 + rz1) / 2;
  // ---- front protection
  if (fit.bullbar === 'tube') {
    const z = a.bumperZ + 0.12, y0 = a.bumperY + 0.1, y1 = a.bumperY + 0.68;
    k.tube('bullbar', [[-0.62, y0, z], [-0.6, y1 - 0.06, z + 0.01], [-0.45, y1, z + 0.02], [0.45, y1, z + 0.02], [0.6, y1 - 0.06, z + 0.01], [0.62, y0, z]], 0.045, m.steel, 10);
    k.tube('bullbar', [[-0.62, y0 + 0.3, z + 0.01], [0.62, y0 + 0.3, z + 0.01]], 0.035, m.steel, 8);
  } else if (fit.bullbar === 'full') {
    const z = a.bumperZ + 0.14, y0 = a.bumperY - 0.05, y1 = a.bumperY + 0.78, w = a.bumperHW;
    k.box('bullbar-plate', w * 2, 0.26, 0.08, m.gloss, 0, a.bumperY + 0.02, z - 0.02);
    for (const sx of [-1, 1]) {
      k.tube('bullbar', [[sx * w * 0.98, y0, z], [sx * w * 0.98, y1 - 0.25, z + 0.02], [sx * w * 0.72, y1, z + 0.04]], 0.05, m.trim, 10);
      k.tube('bullbar', [[sx * 0.32, y0 + 0.1, z + 0.02], [sx * 0.32, y1, z + 0.05]], 0.045, m.trim, 10);
    }
    k.tube('bullbar', [[-w * 0.72, y1, z + 0.04], [w * 0.72, y1, z + 0.04]], 0.05, m.trim, 10);
    if (!k.lite) for (let i = 1; i < 4; i++) k.tube('bullbar', [[-0.3, y0 + 0.2 + i * 0.13, z + 0.04], [0.3, y0 + 0.2 + i * 0.13, z + 0.04]], 0.018, m.trim, 6);
  }
  // ---- roof rack
  if (fit.rack === 'expedition') {
    const y = a.roofY + 0.08;
    k.box('rack', a.roofW, 0.03, rlen, m.trim, 0, y, rmid);
    for (const sx of [-0.5, 0.5]) k.box('rack', 0.04, 0.1, rlen, m.trim, sx * a.roofW, y - 0.03, rmid);
    if (!k.lite) for (let i = 0; i < 6; i++) k.box('rack', a.roofW, 0.02, 0.03, m.trim, 0, y, rz1 + 0.1 + i * (rlen - 0.2) / 5);
    k.box('jerrycan', 0.2, 0.46, 0.34, m.accent, a.roofW * 0.4, y + 0.26, rz1 + 0.35);
  } else if (fit.rack === 'basket') {
    const y = a.roofY + 0.1, len = Math.min(1.3, rlen * 0.7), z = rmid - 0.1, w = a.roofW * 0.85;
    k.box('rack', w, 0.025, len, m.trim, 0, y, z);
    for (const sx of [-1, 1]) k.tube('rack', [[sx * w / 2, y, z - len / 2], [sx * w / 2, y + 0.14, z - len / 2 + 0.06], [sx * w / 2, y + 0.14, z + len / 2 - 0.06], [sx * w / 2, y, z + len / 2]], 0.018, m.trim, 6);
    for (const sz of [-1, 1]) k.tube('rack', [[-w / 2, y + 0.14, z + sz * (len / 2 - 0.06)], [w / 2, y + 0.14, z + sz * (len / 2 - 0.06)]], 0.018, m.trim, 6);
    k.cyl('spare', 0.36, 0.24, m.rubber, 0, y + 0.13, z, 'y'); k.cyl('spare-hub', 0.2, 0.26, m.steel, 0, y + 0.13, z, 'y');
  }
  // ---- driving lamps
  if (fit.lights === 'bar' || fit.lights === 'pods') {
    const y = a.roofY + 0.08, z = rz0 + 0.02, n = 5, w = Math.min(1.2, a.roofW * 0.85);
    k.box('lightbar', w, 0.09, 0.09, m.trim, 0, y, z);
    for (let i = 0; i < n; i++) k.box('lightbar-led', w / n - 0.04, 0.06, 0.02, m.head, -w / 2 + (i + 0.5) * (w / n), y, z + 0.05);
    beams.push([0, y, z + 0.08]);
  }
  if (fit.lights === 'pods') {
    for (const sx of [-1, 1]) for (const ox of [0.5, 0.78]) {
      const x = sx * ox * a.bumperHW, y = a.bumperY + 0.17, z = a.bumperZ + 0.06;
      k.cyl('pod', 0.075, 0.1, m.trim, x, y, z, 'z');
      k.cyl('lightbar-led', 0.06, 0.02, m.head, x, y, z + 0.055, 'z');
    }
    beams.push([0.6 * a.bumperHW, a.bumperY + 0.17, a.bumperZ + 0.12], [-0.6 * a.bumperHW, a.bumperY + 0.17, a.bumperZ + 0.12]);
  }
  // ---- sills
  const [sz0, sz1] = a.sillZ, slen = sz0 - sz1;
  for (const sx of [-1, 1]) {
    if (fit.steps === 'steps') k.box('step', 0.2, 0.05, slen, m.steel, sx * a.sillX, a.sillY, (sz0 + sz1) / 2);
    else if (fit.steps === 'sliders') {
      k.box('slider', 0.12, 0.09, slen, m.steel, sx * (a.sillX + 0.02), a.sillY + 0.15, (sz0 + sz1) / 2);
      for (const z of [sz1 + 0.15, (sz0 + sz1) / 2, sz0 - 0.15]) k.box('slider-mount', 0.16, 0.05, 0.06, m.trim, sx * (a.sillX - 0.08), a.sillY + 0.12, z);
    }
  }
  // ---- snorkel
  if (fit.snorkel === 'snorkel') {
    k.tube('snorkel', a.snorkel, 0.055, m.trim, 10);
    const top = a.snorkel[a.snorkel.length - 1];
    k.box('snorkel-head', 0.15, 0.13, 0.22, m.trim, top[0], top[1] + 0.05, top[2] + 0.03);
  }
  return beams;
}

/** Road car aero parts that aren't part of a design's factory body. */
export function roadParts(k: Kit, sp: VehicleSpec, factoryWing: boolean) {
  const m = k.m, fit = k.fit, b = k.body;
  const zr = b.s.zr, zf = b.s.zf;
  if (fit.spoiler === 'ducktail') {
    const z = zr + 0.1, y = b.top(z) + 0.01, w = b.section(z + 0.1).hw * 1.6;
    k.box('spoiler', w, 0.025, 0.16, m.paint, 0, y + 0.02, z, 0.28);
  } else if (fit.spoiler === 'wing' && !factoryWing) {
    const zp = zr + 0.32, yd = b.top(zp), wy = yd + 0.32, wz = zr + 0.2, w = Math.min(1.8, b.section(zp).hw * 1.9);
    k.box('wing', w, 0.025, 0.32, m.carbon, 0, wy, wz, -0.08);
    k.box('wing', w, 0.018, 0.1, m.carbon, 0, wy + 0.05, wz - 0.16, -0.35);
    for (const sx of [-1, 1]) {
      k.box('wing-plate', 0.012, 0.2, 0.44, m.carbon, sx * w / 2, wy, wz - 0.03);
      k.tube('wing-post', [[sx * 0.32, yd - 0.01, zp], [sx * 0.32, wy + 0.06, zp - 0.02], [sx * 0.32, wy + 0.02, wz]], 0.018, m.carbon, 6);
    }
  }
  if (fit.splitter === 'carbon') {
    const z = zf - 0.12, y = b.sill(z) - 0.015, w = b.section(zf - 0.35).hw * 1.9;
    k.box('splitter', w, 0.02, 0.26, m.carbon, 0, y, z + 0.05);
    for (const sx of [-1, 1]) k.box('splitter', 0.01, 0.07, 0.24, m.carbon, sx * w * 0.42, y - 0.03, z + 0.05);
  }
  void sp;
}
