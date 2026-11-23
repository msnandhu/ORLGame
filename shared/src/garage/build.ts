import type { VehicleSpec, PaintFinish, Livery } from '../vehicles/spec';
import { slotsFor, optionsFor, stockOption, findOption, SLOT_BY_ID, type SlotId, type PartEffect } from './parts';

/** How one vehicle is configured: paint shop choices plus the option fitted in each slot. */
export interface VehicleBuild {
  /** '#rrggbb' (sRGB), or null for the factory colour */
  paint: string | null;
  accent: string | null;
  finish: PaintFinish | 'stock';
  livery: Livery;
  /** fitted option per slot; a missing slot means the factory part */
  parts: Partial<Record<SlotId, string>>;
}

export const FINISHES: { id: PaintFinish | 'stock'; name: string; price: number }[] = [
  { id: 'stock', name: 'Factory', price: 0 },
  { id: 'gloss', name: 'Solid gloss', price: 900 },
  { id: 'metallic', name: 'Metallic', price: 1800 },
  { id: 'pearl', name: 'Pearl', price: 3200 },
  { id: 'matte', name: 'Matte', price: 2400 },
];
export const LIVERIES: { id: Livery; name: string; price: number }[] = [
  { id: 'stock', name: 'Factory', price: 0 },
  { id: 'none', name: 'Plain', price: 300 },
  { id: 'stripes', name: 'Twin stripes', price: 1100 },
];
/** Respray (any colour) and accent colour prices for a $40,000 vehicle. */
export const PAINT_PRICE = 1500, ACCENT_PRICE = 600;
/** Paint shop swatches (sRGB). Any colour is allowed; these are suggestions. */
export const PAINT_SWATCHES = [
  '#f2f2ee', '#c9ccd0', '#7c8087', '#2b2e33', '#0d0e10', '#a8231b', '#d8541c', '#e8a317', '#f3d23a', '#8fae3a',
  '#3d6b3a', '#5e6b4a', '#1f6f78', '#2a62b8', '#152a63', '#5b2a86', '#8a6a4a', '#c8b48a', '#6b1d2a', '#ff6fa8',
];

export const defaultBuild = (): VehicleBuild => ({ paint: null, accent: null, finish: 'stock', livery: 'stock', parts: {} });

const HEX = /^#[0-9a-f]{6}$/;
const FIN_IDS = new Set(FINISHES.map(f => f.id)), LIV_IDS = new Set(LIVERIES.map(l => l.id));

/** Validate an untrusted build for a vehicle: unknown slots, options the vehicle can't fit and bad colours are dropped. */
export function sanitizeBuild(spec: VehicleSpec, raw: unknown): VehicleBuild {
  const b = defaultBuild();
  if (!raw || typeof raw !== 'object') return b;
  const o = raw as Record<string, unknown>;
  const col = (v: unknown) => (typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : null);
  b.paint = col(o.paint); b.accent = col(o.accent);
  if (typeof o.finish === 'string' && FIN_IDS.has(o.finish as PaintFinish)) b.finish = o.finish as PaintFinish;
  if (typeof o.livery === 'string' && LIV_IDS.has(o.livery as Livery)) b.livery = o.livery as Livery;
  const parts = o.parts && typeof o.parts === 'object' ? (o.parts as Record<string, unknown>) : {};
  for (const d of slotsFor(spec)) {
    const v = parts[d.id];
    if (typeof v !== 'string' || v === stockOption(spec, d.id)) continue;
    if (optionsFor(spec, d.id).some(x => x.id === v)) b.parts[d.id] = v;
  }
  return b;
}

/** The option fitted in a slot (factory part when none was chosen). */
export const fitted = (spec: VehicleSpec, b: VehicleBuild, slot: SlotId) => b.parts[slot] ?? stockOption(spec, slot);

/** Compact text form for the network ("p:#rrggbb|f:matte|ecu:stage1|…"); decodeBuild re-validates it. */
export function encodeBuild(b: VehicleBuild): string {
  const out: string[] = [];
  if (b.paint) out.push(`p:${b.paint}`);
  if (b.accent) out.push(`a:${b.accent}`);
  if (b.finish !== 'stock') out.push(`f:${b.finish}`);
  if (b.livery !== 'stock') out.push(`l:${b.livery}`);
  for (const [k, v] of Object.entries(b.parts)) if (v) out.push(`${k}:${v}`);
  return out.join('|');
}
export function decodeBuild(spec: VehicleSpec, code: unknown): VehicleBuild {
  if (typeof code !== 'string' || code.length > 600) return defaultBuild();
  const raw: Record<string, unknown> & { parts: Record<string, string> } = { parts: {} };
  for (const kv of code.split('|')) {
    const i = kv.indexOf(':'); if (i <= 0) continue;
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (k === 'p') raw.paint = v; else if (k === 'a') raw.accent = v; else if (k === 'f') raw.finish = v; else if (k === 'l') raw.livery = v;
    else if (k in SLOT_BY_ID) raw.parts[k] = v;
  }
  return sanitizeBuild(spec, raw);
}

/** '#rrggbb' sRGB to the linear RGB the renderer's colours use. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16), c = (v: number) => Math.pow(v / 255, 2.2);
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}
export function linearToHex(c: readonly number[]): string {
  const h = (v: number) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

const RIM_COLOURS: Record<string, [number, number, number]> = {
  black: [0.02, 0.02, 0.022], silver: [0.72, 0.73, 0.75], bronze: [0.5, 0.3, 0.1], gunmetal: [0.12, 0.125, 0.135],
};

/**
 * The vehicle as built: a new spec whose numbers the shared simulation uses directly, so every performance part changes
 * how the vehicle drives (and how the server's and every client's copy of it drives). Each slot applies the difference
 * between the fitted part and the factory part, so a factory-fitted accessory can also be removed.
 */
export function applyBuild(spec: VehicleSpec, build: VehicleBuild): VehicleSpec {
  const s: VehicleSpec = {
    ...spec, look: { ...spec.look }, torqueCurve: spec.torqueCurve.map(p => [p[0], p[1]] as [number, number]),
    gears: [...spec.gears], inertia: [...spec.inertia] as [number, number, number], halfExtents: [...spec.halfExtents] as [number, number, number],
  };
  let mass = 0, drag = 1, down = 0, torque = 1, top = 1, low = 1, redline = 0, cooling = 1, rest = 0, travel = 0, springs = 1, damping = 1, roll = 1;
  let radius = 0, width = 0, wInertia = 1, fuel = 1, armour = 1, sound = 1, beams = 0;
  const fit: Record<string, string> = {};
  for (const d of slotsFor(spec)) {
    const stock = stockOption(spec, d.id), sel = fitted(spec, build, d.id);
    fit[d.id] = sel;
    const e: PartEffect = findOption(d.id, sel)?.effect ?? {}, b: PartEffect = findOption(d.id, stock)?.effect ?? {};
    beams += e.beams ?? 0; // driving lamps are drawn from the fitted parts, factory ones included
    if (sel === stock) continue;
    const r = (k: keyof PartEffect) => ((e[k] as number | undefined) ?? 1) / ((b[k] as number | undefined) ?? 1);
    const a = (k: keyof PartEffect) => ((e[k] as number | undefined) ?? 0) - ((b[k] as number | undefined) ?? 0);
    mass += a('mass'); drag *= r('drag'); down += a('downforce'); torque *= r('torque'); top *= r('torqueTop'); low *= r('torqueLow');
    redline += a('redline'); cooling *= r('cooling'); rest += a('restLength'); travel += a('maxTravel'); springs *= r('springs');
    damping *= r('damping'); roll *= r('antiRoll'); radius += a('radius'); width += a('width'); wInertia *= r('wheelInertia');
    fuel *= r('fuel'); armour *= r('armour'); sound *= r('sound');
    if (e.intake !== undefined) s.intakeHeight = e.intake;
    if (e.tyre) s.tyre = e.tyre;
  }
  // engine: torque multipliers shaped over the rev range
  const R = spec.redlineRpm;
  const shape = (rpm: number) => {
    const u = rpm / R;
    const lo = u < 0.4 ? low + (1 - low) * (u / 0.4) : 1;
    const hi = u > 0.4 ? 1 + (top - 1) * Math.min(1, (u - 0.4) / 0.6) : 1;
    return torque * lo * hi;
  };
  s.torqueCurve = s.torqueCurve.map(([rpm, nm]) => [rpm, Math.round(nm * shape(rpm) * 10) / 10]);
  if (redline > 0) {
    s.redlineRpm = R + redline;
    const last = s.torqueCurve[s.torqueCurve.length - 1];
    if (last[0] < s.redlineRpm + 400) s.torqueCurve.push([s.redlineRpm + 400, Math.round(last[1] * 0.85)]);
  }
  // chassis
  const m0 = spec.mass;
  s.mass = m0 + mass;
  s.inertia = spec.inertia.map(v => v * s.mass / m0) as [number, number, number];
  s.dragCoef = spec.dragCoef * drag;
  if (down !== 0 || spec.downforce) s.downforce = Math.max(0, (spec.downforce ?? 0) + down);
  s.coolingCapacity = (spec.coolingCapacity ?? 1) * cooling;
  s.restLength = spec.restLength + rest; s.maxTravel = Math.max(0.08, spec.maxTravel + travel);
  // keep the static ride frequency sensible when the vehicle gets heavier: springs scale with mass as well
  s.springRate = spec.springRate * springs * (s.mass / m0);
  s.bumpDamping = spec.bumpDamping * damping * Math.sqrt(s.mass / m0); s.reboundDamping = spec.reboundDamping * damping * Math.sqrt(s.mass / m0);
  s.antiRoll = spec.antiRoll * roll;
  s.wheelRadius = spec.wheelRadius + radius; s.wheelWidth = spec.wheelWidth + width; s.wheelInertia = spec.wheelInertia * wInertia;
  s.fuelCapacity = Math.round(spec.fuelCapacity * fuel);
  s.damageResistance = spec.damageResistance * armour;
  // look: the client draws the fitted parts and the paint shop's work from this
  if (build.paint) s.look.paint = hexToLinear(build.paint);
  if (build.accent) s.look.accent = hexToLinear(build.accent);
  if (build.finish !== 'stock') s.look.finish = build.finish;
  s.look.livery = build.livery;
  const rc = RIM_COLOURS[fit.rimColor ?? 'stock'];
  if (rc) s.look.rimColor = rc;
  s.look.fit = fit; s.look.sound = sound; s.look.beams = beams;
  return s;
}

/** A build changed in one slot (no validation: use sanitizeBuild on anything untrusted). */
export function withPart(b: VehicleBuild, slot: SlotId, option: string): VehicleBuild {
  return { ...b, parts: { ...b.parts, [slot]: option } };
}
