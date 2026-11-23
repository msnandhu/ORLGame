/**
 * Mechanical condition. Every value is wear in 0..1 (0 = new, 1 = broken).
 * The Vehicle reads these every step, so damage changes how it drives, not just how it looks.
 */
export type BodyRegion = 'front' | 'rear' | 'left' | 'right' | 'roof' | 'under';
export const BODY_REGIONS: readonly BodyRegion[] = ['front', 'rear', 'left', 'right', 'roof', 'under'];

export interface VehicleCondition {
  engine: number;
  cooling: number;              // radiator: damaged cooling makes the engine run hot
  body: Record<BodyRegion, number>;
  suspension: [number, number, number, number]; // FL FR RL RR (Vehicle.wheels order)
  tyres: [number, number, number, number];      // 1 = punctured
}

export function newCondition(): VehicleCondition {
  return { engine: 0, cooling: 0, body: { front: 0, rear: 0, left: 0, right: 0, roof: 0, under: 0 }, suspension: [0, 0, 0, 0], tyres: [0, 0, 0, 0] };
}

export function copyCondition(c: VehicleCondition): VehicleCondition {
  return { engine: c.engine, cooling: c.cooling, body: { ...c.body }, suspension: [...c.suspension], tyres: [...c.tyres] };
}

/** Accepts anything (e.g. an old save) and returns a valid condition. */
export function sanitizeCondition(raw: unknown): VehicleCondition {
  const c = newCondition();
  if (!raw || typeof raw !== 'object') return c;
  const r = raw as Partial<VehicleCondition>;
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  c.engine = n(r.engine); c.cooling = n(r.cooling);
  if (r.body) for (const k of BODY_REGIONS) c.body[k] = n((r.body as Record<string, unknown>)[k]);
  for (let i = 0; i < 4; i++) { c.suspension[i] = n(r.suspension?.[i]); c.tyres[i] = n(r.tyres?.[i]); }
  return c;
}

/** 0..1 overall wear, weighted towards the parts that stop you. */
export function overallDamage(c: VehicleCondition): number {
  const body = BODY_REGIONS.reduce((a, k) => a + c.body[k], 0) / BODY_REGIONS.length;
  const susp = c.suspension.reduce((a, v) => a + v, 0) / 4, tyre = c.tyres.reduce((a, v) => a + v, 0) / 4;
  return Math.min(1, c.engine * 0.3 + c.cooling * 0.15 + body * 0.2 + susp * 0.2 + tyre * 0.15);
}

export const isPunctured = (c: VehicleCondition, wheel: number) => c.tyres[wheel] >= 1;

/** Workshop at camp: everything back to new. */
export function repairFull(c: VehicleCondition) { Object.assign(c, newCondition()); }

/**
 * Field repair kit: fit the spare / plug tyres, bodge the radiator and suspension.
 * It gets you home; it does not straighten panels or rebuild an engine.
 */
export function repairWithKit(c: VehicleCondition) {
  for (let i = 0; i < 4; i++) { c.tyres[i] = Math.min(c.tyres[i], 0.2); c.suspension[i] *= 0.5; }
  c.cooling *= 0.4;
  c.engine = Math.min(c.engine, Math.max(0.3, c.engine * 0.7));
}

/** Map a local hull point (vehicle frame, +Z forward, +X left) to the body region it belongs to. */
export function regionOf(lx: number, ly: number, lz: number, halfExtents: [number, number, number], hullOffsetY: number): BodyRegion {
  const [hx, hy, hz] = halfExtents;
  const ny = (ly - hullOffsetY) / hy, nz = lz / hz, nx = lx / hx;
  if (Math.abs(nz) >= 0.9) return nz > 0 ? 'front' : 'rear';   // bumpers and the corners above them
  if (ny > 0.6) return 'roof';
  if (ny < -0.75 && Math.abs(nx) < 0.5) return 'under';
  if (Math.abs(nz) >= 0.6 && Math.abs(nz) >= Math.abs(nx) * 0.9) return nz > 0 ? 'front' : 'rear';
  return nx > 0 ? 'left' : 'right';
}
