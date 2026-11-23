import { describe, it, expect, beforeAll } from 'vitest';
import {
  Terrain, Vehicle, VEHICLES, RANGER_TX4, BRAMBLE_RC2, VANTA_GT, PELLA, vehicleStats, LIMITS, Surface,
  applyBuild, defaultBuild, sanitizeBuild, encodeBuild, decodeBuild, withPart, slotsFor, optionsFor, stockOption, fitted,
  newCareer, sanitizeCareer, transact, partPrice, Ledger, isGarageRequest, vehiclePrice, STARTING_CASH, resaleValue, repairPrice,
  type VehicleSpec, type VehicleInput, type VehicleBuild, type SlotId, type Career,
} from '@orl/shared';

/** Phase 4 quality gate: the parts catalogue changes the real simulation, and the economy can't be cheated. */
let pg: Terrain;   // flat dirt proving ground
let mud: Terrain;  // the same, deep mud
const flat: [number, number] = [0, -380];
const flatten = (t: Terrain, surface: Surface, mudDepth: number) => {
  t.heights.fill(20); t.surface.fill(surface); t.mudDepth.fill(mudDepth);
  t.boulders.length = 0; t.trees.length = 0; t.boxes.length = 0;
  (t as unknown as { grid: Map<number, unknown> }).grid.clear(); t.reindexBoxes();
};
beforeAll(() => { pg = new Terrain(); flatten(pg, Surface.Dirt, 0); mud = new Terrain(); flatten(mud, Surface.Mud, 0.6); });
const DT = 1 / 240;
const run = (v: Vehicle, secs: number, inp: Partial<VehicleInput>, each?: () => void) => {
  const i: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...inp };
  for (let s = 0; s < secs; s += DT) { v.step(DT, i); each?.(); }
};
const spawn = (spec: VehicleSpec, t = pg) => { const v = new Vehicle(spec, t); v.reset(flat[0], flat[1], 0); run(v, 1.5, {}); return v; };
const build = (spec: VehicleSpec, parts: Partial<Record<SlotId, string>>): VehicleSpec => applyBuild(spec, { ...defaultBuild(), parts });
/** seconds to reach a speed from rest at full throttle (automatic) */
const sprint = (spec: VehicleSpec, kmh: number, t = pg) => {
  const v = spawn(spec, t); let s = 0, at = -1;
  run(v, 25, { throttle: 1 }, () => { s += DT; if (at < 0 && v.speedKmh >= kmh) at = s; });
  return at < 0 ? Infinity : at;
};
const clearance = (spec: VehicleSpec) => { const v = spawn(spec); run(v, 1, {}); return v.body.pos.y + spec.bellyY - pg.heightAt(v.body.pos.x, v.body.pos.z); };

describe('parts catalogue → vehicle simulation', () => {
  it('a factory build is the factory vehicle', () => {
    for (const spec of VEHICLES) {
      const s = applyBuild(spec, defaultBuild());
      for (const k of ['mass', 'springRate', 'restLength', 'wheelRadius', 'dragCoef', 'fuelCapacity', 'damageResistance', 'intakeHeight', 'redlineRpm'] as const) expect(s[k]).toBeCloseTo(spec[k] as number, 6);
      expect(s.torqueCurve).toEqual(spec.torqueCurve);
      expect(s.tyre ?? 'all-terrain').toBe(spec.tyre ?? 'all-terrain');
    }
  });

  it('every option on every vehicle gives a sane, drivable spec under the server speed limit', () => {
    let fastest = 0;
    for (const spec of VEHICLES) {
      // the most extreme build: every slot's last option, then every slot's first
      for (const pick of [(o: string[]) => o[o.length - 1], (o: string[]) => o[0]]) {
        const parts: Partial<Record<SlotId, string>> = {};
        for (const d of slotsFor(spec)) parts[d.id] = pick(optionsFor(spec, d.id).map(o => o.id));
        const s = build(spec, parts), st = vehicleStats(s);
        for (const v of [s.mass, s.springRate, s.wheelRadius, s.dragCoef, st.powerKw, st.topSpeedKmh, st.groundClearanceM]) expect(Number.isFinite(v)).toBe(true);
        expect(s.mass).toBeGreaterThan(spec.mass * 0.95); expect(s.mass).toBeLessThan(spec.mass * 1.15);
        fastest = Math.max(fastest, st.topSpeedKmh);
      }
    }
    console.log('fastest fully tuned top speed', fastest, 'km/h');
    expect(fastest / 3.6).toBeLessThan(LIMITS.maxVehicleSpeed * 0.95);
  });

  it('engine parts add real torque: a Stage 2 + hybrid turbo Ranger out-accelerates the factory one', () => {
    const tuned = build(RANGER_TX4, { ecu: 'stage2', turbo: 'hybrid', exhaust: 'sport', intake: 'cold' });
    const a = vehicleStats(RANGER_TX4), b = vehicleStats(tuned);
    console.log('Ranger torque', a.peakTorqueNm, '→', b.peakTorqueNm, 'Nm, power', a.powerKw, '→', b.powerKw, 'kW');
    expect(b.peakTorqueNm / a.peakTorqueNm).toBeGreaterThan(1.15);
    expect(b.powerKw / a.powerKw).toBeGreaterThan(1.25);
    const t0 = sprint(RANGER_TX4, 80), t1 = sprint(tuned, 80);
    console.log('Ranger 0-80 km/h', t0.toFixed(2), '→', t1.toFixed(2), 's');
    expect(t1).toBeLessThan(t0 * 0.92);
  });

  it('a lift kit and bigger tyres raise the measured clearance by the right amount', () => {
    const c0 = clearance(RANGER_TX4), c1 = clearance(build(RANGER_TX4, { height: 'lift100' })), c2 = clearance(build(RANGER_TX4, { height: 'lift100', tyreSize: 'plus2' }));
    console.log('Ranger belly clearance', c0.toFixed(3), c1.toFixed(3), c2.toFixed(3));
    expect(c1 - c0).toBeGreaterThan(0.08); expect(c1 - c0).toBeLessThan(0.12);
    expect(c2 - c1).toBeGreaterThan(0.045);
    // taller tyres lengthen the gearing
    expect(vehicleStats(build(RANGER_TX4, { tyreSize: 'plus2' })).crawlRatio).toBe(vehicleStats(RANGER_TX4).crawlRatio);
    expect(vehicleStats(build(RANGER_TX4, { tyreSize: 'plus2' })).tyreDiameterIn).toBeGreaterThan(vehicleStats(RANGER_TX4).tyreDiameterIn + 3);
  });

  it('mud-terrain tyres pull harder in deep mud than road tyres', () => {
    const muddy = build(BRAMBLE_RC2, { tyres: 'mud' }), road = build(BRAMBLE_RC2, { tyres: 'road' });
    const dist = (spec: VehicleSpec) => { const v = spawn(spec, mud); v.setDrivingMode('mud'); const z0 = v.body.pos.z; run(v, 8, { throttle: 1 }); return v.body.pos.z - z0; };
    const dm = dist(muddy), dr = dist(road);
    console.log('8 s in mud: mud tyres', dm.toFixed(1), 'm, road tyres', dr.toFixed(1), 'm');
    expect(dm).toBeGreaterThan(dr * 1.1);
  });

  it('a snorkel is what keeps the engine breathing in deep water', () => {
    expect(RANGER_TX4.intakeHeight).toBeGreaterThan(0.3);
    expect(build(RANGER_TX4, { snorkel: 'none' }).intakeHeight).toBeLessThan(0.2);
    expect(build(BRAMBLE_RC2, { snorkel: 'snorkel' }).intakeHeight).toBeGreaterThan(0.9);
  });

  it('a tuned engine runs hotter and a heavy-duty radiator brings it back down', () => {
    const temp = (spec: VehicleSpec) => { const v = spawn(spec); v.automatic = false; v.gear = 1; v.driveMode = '4L'; run(v, 90, { throttle: 1, brake: 0.6 }); return v.engineTemp; };
    const stock = temp(RANGER_TX4), hot = temp(build(RANGER_TX4, { ecu: 'stage2', turbo: 'hybrid' })), cooled = temp(build(RANGER_TX4, { ecu: 'stage2', turbo: 'hybrid', cooling: 'hd' }));
    console.log('engine temperature under load', stock.toFixed(1), hot.toFixed(1), cooled.toFixed(1));
    expect(hot).toBeGreaterThan(stock + 0.5);
    expect(cooled).toBeLessThan(hot - 1);
  });

  it('a GT wing adds downforce, deleting it removes some', () => {
    expect(build(PELLA, { spoiler: 'wing' }).downforce).toBeGreaterThan(0.5);
    expect(build(VANTA_GT, { spoiler: 'none' }).downforce!).toBeLessThan(VANTA_GT.downforce!);
  });
});

describe('builds over the network', () => {
  it('round-trips through the compact code and re-validates it', () => {
    const b: VehicleBuild = { paint: '#a8231b', accent: '#0d0e10', finish: 'matte', livery: 'stripes', parts: { ecu: 'stage1', height: 'lift50', tyres: 'mud', rims: 'beadlock' } };
    const code = encodeBuild(b);
    expect(decodeBuild(RANGER_TX4, code)).toEqual(b);
    // a road car can't fit a lift kit or mud tyres, and junk is dropped
    const d = decodeBuild(PELLA, code + '|turbo:nitrous|a:#zzzzzz|bogus:1');
    expect(d.parts.height).toBeUndefined(); expect(d.parts.tyres).toBeUndefined(); expect(d.parts.rims).toBeUndefined();
    expect(d.parts.ecu).toBe('stage1'); expect(d.paint).toBe('#a8231b'); expect(d.accent).toBeNull();
    expect(decodeBuild(PELLA, 42)).toEqual(defaultBuild());
    expect(sanitizeBuild(RANGER_TX4, { parts: { ecu: 'stock' }, paint: 'red' })).toEqual(defaultBuild());
  });
});

describe('upgrade economy', () => {
  const ok = (r: ReturnType<typeof transact>): Career => { if (!r.ok) throw new Error(r.error); return r.career; };

  it('starts with the Ranger and some money; vehicles cost their list price and sell back for less', () => {
    let c = newCareer();
    expect(Object.keys(c.owned)).toEqual(['ranger-tx4']); expect(c.cash).toBe(STARTING_CASH);
    const r = transact(c, { op: 'buy-vehicle', vid: 'vanta-gt' });
    expect(r.ok).toBe(false);
    c = ok(transact(c, { op: 'buy-vehicle', vid: 'pella' }));
    expect(c.cash).toBe(STARTING_CASH - vehiclePrice('pella'));
    expect(transact(c, { op: 'buy-vehicle', vid: 'pella' }).ok).toBe(false);
    const value = resaleValue('pella', c.owned.pella);
    c = ok(transact(c, { op: 'sell-vehicle', vid: 'pella' }));
    expect(c.cash).toBe(STARTING_CASH - vehiclePrice('pella') + value);
    expect(value).toBeLessThan(vehiclePrice('pella'));
    expect(transact(c, { op: 'sell-vehicle', vid: 'ranger-tx4' }).ok).toBe(false); // the only vehicle
  });

  it('charges for a part once; refitting factory or already-bought parts is free; the input career is untouched', () => {
    const c0 = newCareer();
    const price = partPrice(RANGER_TX4, 'ecu', 'stage1', c0.owned['ranger-tx4']);
    expect(price).toBeGreaterThan(0);
    const c1 = ok(transact(c0, { op: 'fit', vid: 'ranger-tx4', slot: 'ecu', option: 'stage1' }));
    expect(c0.cash).toBe(STARTING_CASH); expect(c0.owned['ranger-tx4'].build.parts.ecu).toBeUndefined();
    expect(c1.cash).toBe(STARTING_CASH - price);
    expect(fitted(RANGER_TX4, c1.owned['ranger-tx4'].build, 'ecu')).toBe('stage1');
    const c2 = ok(transact(c1, { op: 'fit', vid: 'ranger-tx4', slot: 'ecu', option: 'stock' }));
    const c3 = ok(transact(c2, { op: 'fit', vid: 'ranger-tx4', slot: 'ecu', option: 'stage1' }));
    expect(c3.cash).toBe(c1.cash);
    // removing a factory accessory is free and putting it back is free
    expect(stockOption(RANGER_TX4, 'bullbar')).toBe('tube');
    const c4 = ok(transact(c3, { op: 'fit', vid: 'ranger-tx4', slot: 'bullbar', option: 'none' }));
    const c5 = ok(transact(c4, { op: 'fit', vid: 'ranger-tx4', slot: 'bullbar', option: 'tube' }));
    expect(c5.cash).toBe(c3.cash);
    // parts that don't fit, unknown parts and vehicles not owned are refused
    expect(transact(c5, { op: 'fit', vid: 'ranger-tx4', slot: 'spoiler', option: 'wing' }).ok).toBe(false);
    expect(transact(c5, { op: 'fit', vid: 'ranger-tx4', slot: 'turbo', option: 'nitrous' }).ok).toBe(false);
    expect(transact(c5, { op: 'fit', vid: 'vanta-gt', slot: 'ecu', option: 'stage1' }).ok).toBe(false);
  });

  it('refuses what you cannot afford, and a broke player can still get repaired', () => {
    let c = newCareer(); c.cash = 100;
    expect(transact(c, { op: 'fit', vid: 'ranger-tx4', slot: 'turbo', option: 'hybrid' }).ok).toBe(false);
    c = ok(transact(c, { op: 'repair', vid: 'ranger-tx4', damage: 0.8 }));
    expect(c.cash).toBe(0);
    expect(repairPrice('ranger-tx4', 0)).toBe(0); expect(repairPrice('vanta-gt', 1)).toBeGreaterThan(repairPrice('pella', 1));
  });

  it('pays a discovery reward once, and only near the place', () => {
    const pois = [{ id: 'x', name: 'Lookout', kind: 'lookout' as const, x: 1000, z: 1000 }];
    const c0 = newCareer();
    expect(transact(c0, { op: 'discover', poi: 'x' }, { pois, at: { x: 0, z: 0 } }).ok).toBe(false);
    const c1 = ok(transact(c0, { op: 'discover', poi: 'x' }, { pois, at: { x: 1050, z: 990 } }));
    expect(c1.cash).toBeGreaterThan(c0.cash);
    expect(transact(c1, { op: 'discover', poi: 'x' }, { pois, at: { x: 1000, z: 1000 } }).ok).toBe(false);
  });

  it('a replayed transaction is answered, not charged again', () => {
    const led = new Ledger();
    let c = newCareer();
    const req = { op: 'fit' as const, vid: 'ranger-tx4', slot: 'ecu' as const, option: 'stage2' };
    for (let i = 0; i < 3; i++) { const r = led.run('txn-0001', () => transact(c, req)); if (r.ok) c = r.career; }
    expect(c.cash).toBe(STARTING_CASH - partPrice(RANGER_TX4, 'ecu', 'stage2'));
    expect(led.run('x', () => transact(c, req)).ok).toBe(false); // malformed id
  });

  it('validates requests and stored careers', () => {
    expect(isGarageRequest({ op: 'fit', vid: 'ranger-tx4', slot: 'ecu', option: 'stage1' })).toBe(true);
    expect(isGarageRequest({ op: 'fit', vid: 'ranger-tx4', slot: 'ecu' })).toBe(false);
    expect(isGarageRequest({ op: 'refuel', litres: NaN })).toBe(false);
    expect(isGarageRequest({ op: 'give-money' })).toBe(false);
    // a hand-edited save: negative cash, unknown vehicles, a fitted part that was never paid for
    const c = sanitizeCareer({ cash: -5, owned: { 'ranger-tx4': { build: { parts: { ecu: 'stage2', turbo: 'hybrid' } }, unlocked: ['ecu:stage2', 'ecu:warp'] }, tank: {} } });
    expect(c.cash).toBe(0);
    expect(Object.keys(c.owned)).toEqual(['ranger-tx4']);
    expect(c.owned['ranger-tx4'].build.parts).toEqual({ ecu: 'stage2' });
    expect(c.owned['ranger-tx4'].unlocked).toEqual(['ecu:stage2']);
    expect(sanitizeCareer(null)).toEqual(newCareer());
  });

  it('withPart builds compose', () => {
    const b = withPart(withPart(defaultBuild(), 'ecu', 'stage1'), 'height', 'lift50');
    expect(b.parts).toEqual({ ecu: 'stage1', height: 'lift50' });
  });
});
