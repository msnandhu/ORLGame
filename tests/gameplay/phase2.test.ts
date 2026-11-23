import { describe, it, expect, beforeAll } from 'vitest';
import {
  Terrain, Vehicle, Vec3, RANGER_TX4, BRAMBLE_RC2, VEHICLES, vehicleById, vehicleStats, DRIVING_MODES, DRIVING_MODE_PROFILES,
  overallDamage, repairFull, repairWithKit, sanitizeCondition, newCondition, regionOf,
  type VehicleInput, type VehicleSpec, type ImpactEvent,
} from '@orl/shared';

/** Phase 2 quality gate: data-driven vehicles, driving modes, collision damage. */
let t: Terrain;   // the real world
let pg: Terrain;  // proving ground: the same world flattened to bare dirt, so tests measure the vehicle, not the scenery
const flat: [number, number] = [0, -380];
beforeAll(() => {
  t = new Terrain();
  pg = new Terrain();
  pg.heights.fill(20); pg.surface.fill(1); pg.mudDepth.fill(0);
  pg.boulders.length = 0; pg.trees.length = 0; pg.boxes.length = 0; pg.reindexBoxes();
  (pg as unknown as { grid: Map<number, unknown> }).grid.clear(); pg.reindexBoxes();
});
const DT = 1 / 240;
const run = (v: Vehicle, secs: number, inp: Partial<VehicleInput>, each?: () => void) => {
  const i: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...inp };
  for (let s = 0; s < secs; s += DT) { v.step(DT, i); each?.(); }
};
const spawn = (spec: VehicleSpec, mode = 'normal' as const) => {
  const v = new Vehicle(spec, pg); v.reset(flat[0], flat[1], 0); v.setDrivingMode(mode); run(v, 1.5, {}); return v;
};
const heading = (v: Vehicle) => { const f = new Vec3(0, 0, 1).applyQuaternion(v.body.quat); return Math.atan2(f.x, f.z); };

describe('vehicle catalog (specs as data)', () => {
  it('has two distinct vehicles with complete data and derived stats', () => {
    expect(VEHICLES.length).toBeGreaterThanOrEqual(2);
    expect(new Set(VEHICLES.map(v => v.id)).size).toBe(VEHICLES.length);
    expect(vehicleById('bramble-rc2')).toBe(BRAMBLE_RC2);
    expect(vehicleById('nope')).toBe(RANGER_TX4);
    const r = vehicleStats(RANGER_TX4), b = vehicleStats(BRAMBLE_RC2);
    console.log('stats', JSON.stringify({ ranger: r, bramble: b }));
    expect(r.powerKw).toBeGreaterThan(100); expect(r.powerKw).toBeLessThan(200);
    expect(b.groundClearanceM).toBeGreaterThan(r.groundClearanceM);
    expect(b.crawlRatio).toBeGreaterThan(r.crawlRatio * 1.3);
    expect(b.wheelbaseM).toBeLessThan(r.wheelbaseM);
    expect(r.topSpeedKmh).toBeGreaterThan(b.topSpeedKmh);
  });

  for (const spec of [RANGER_TX4, BRAMBLE_RC2]) it(`${spec.name}: settles, drives straight and stays upright`, () => {
    const v = spawn(spec);
    const p0 = v.body.pos.clone();
    run(v, 2, {});
    expect(p0.distanceTo(v.body.pos)).toBeLessThan(0.1);
    let t40 = -1, s = 0;
    run(v, 8, { throttle: 1 }, () => { s += DT; if (t40 < 0 && v.speedKmh >= 40) t40 = s; });
    console.log(spec.name, '0-40 km/h', t40.toFixed(2), 's');
    expect(t40).toBeGreaterThan(0); expect(t40).toBeLessThan(8);
    expect(new Vec3(0, 1, 0).applyQuaternion(v.body.quat).y).toBeGreaterThan(0.95);
    expect(overallDamage(v.condition)).toBe(0);
  });

  it('the tuning shows up in the simulation, not just the numbers', () => {
    // measured belly clearance at rest and low-range wheel torque
    const clearance = (spec: VehicleSpec) => { const v = spawn(spec); run(v, 1, {}); const p = new Vec3(0, spec.bellyY, 0).applyQuaternion(v.body.quat).add(v.body.pos); return p.y - pg.heightAt(p.x, p.z); };
    const cr = clearance(RANGER_TX4), cb = clearance(BRAMBLE_RC2);
    console.log('measured belly clearance', cr.toFixed(2), cb.toFixed(2));
    expect(cb).toBeGreaterThan(cr + 0.1);
    // short wheelbase + more steering lock = tighter turning circle
    const circle = (spec: VehicleSpec) => {
      const v = spawn(spec); v.automatic = true; let minX = 1e9, maxX = -1e9;
      run(v, 12, { throttle: 0.35, steer: 1 }, () => { if (v.speedKmh > 12) v.lastInput.throttle = 0; minX = Math.min(minX, v.body.pos.x); maxX = Math.max(maxX, v.body.pos.x); });
      return maxX - minX;
    };
    const dr = circle(RANGER_TX4), db = circle(BRAMBLE_RC2);
    console.log('turning circle (m)', dr.toFixed(1), db.toFixed(1));
    expect(db).toBeLessThan(dr);
  });

  it('the crawler gets along the trail and over the rock ridge', () => {
    const path = t.trails[0];
    const v = new Vehicle(BRAMBLE_RC2, t); v.setDrivingMode('offroad'); v.driveMode = '4L'; v.diffLock = true;
    v.reset(path[2][0], path[2][1], Math.atan2(path[3][0] - path[2][0], path[3][1] - path[2][1]));
    let wp = 3, flips = 0;
    for (let s = 0; s < 120 && wp < 50; s += DT) {
      const [tx, tz] = path[wp];
      if (Math.hypot(tx - v.body.pos.x, tz - v.body.pos.z) < 6) wp++;
      let d = Math.atan2(tx - v.body.pos.x, tz - v.body.pos.z) - heading(v); d = Math.atan2(Math.sin(d), Math.cos(d));
      v.step(DT, { throttle: v.speedKmh > 12 ? 0 : 0.85, brake: 0, steer: Math.max(-1, Math.min(1, -d * 2)), handbrake: 0 });
      if (v.upsideDownTimer > 1) { flips++; v.recover(); }
    }
    console.log('crawler trail waypoint', wp, 'flips', flips, 'damage', overallDamage(v.condition).toFixed(3));
    expect(wp).toBeGreaterThan(30); expect(flips).toBe(0);
  });
});

describe('driving modes', () => {
  it('there are six modes and each selects its drivetrain', () => {
    expect([...DRIVING_MODES]).toEqual(['normal', 'sport', 'offroad', 'rockcrawl', 'snow', 'mud']);
    const v = new Vehicle(RANGER_TX4, t);
    v.setDrivingMode('rockcrawl'); expect(v.driveMode).toBe('4L'); expect(v.diffLock).toBe(true);
    v.setDrivingMode('snow'); expect(v.driveMode).toBe('4H'); expect(v.diffLock).toBe(false);
    v.setDrivingMode('mud'); expect(v.diffLock).toBe(true);
    v.setDrivingMode('sport'); expect(v.driveMode).toBe('2H');
    for (const m of DRIVING_MODES) expect(DRIVING_MODE_PROFILES[m].label.length).toBeGreaterThan(2);
  });

  it('rock crawl: crawl control holds walking pace at full throttle', () => {
    const v = spawn(RANGER_TX4, 'rockcrawl' as never);
    let max = 0;
    run(v, 10, { throttle: 1 }, () => { max = Math.max(max, v.speedKmh); });
    console.log('rockcrawl max km/h', max.toFixed(1));
    expect(max).toBeLessThan(11.5); expect(v.speedKmh).toBeGreaterThan(5);
  });

  it('snow pulls away in 2nd with a gentle pedal; sport revs higher before upshifting', () => {
    const snow = spawn(RANGER_TX4, 'snow' as never);
    let minGear = 9; run(snow, 3, { throttle: 0.6 }, () => { if (snow.speedKmh > 1) minGear = Math.min(minGear, snow.gear); });
    expect(minGear).toBeGreaterThanOrEqual(2);
    const peak = (mode: 'normal' | 'sport') => { const v = spawn(RANGER_TX4, mode as never); v.driveMode = '4H'; let r = 0; run(v, 3, { throttle: 0.7 }, () => { if (v.gear === 1) r = Math.max(r, v.rpm); }); return r; };
    const pn = peak('normal'), ps = peak('sport');
    console.log('1st gear peak rpm normal/sport', pn.toFixed(0), ps.toFixed(0));
    expect(ps).toBeGreaterThan(pn + 300);
    // snow's pedal map gives less torque at half pedal
    const dist = (mode: 'normal' | 'snow') => { const v = spawn(RANGER_TX4, mode as never); v.driveMode = '4H'; const p = v.body.pos.clone(); run(v, 3, { throttle: 0.5 }); return p.distanceTo(v.body.pos); };
    expect(dist('snow')).toBeLessThan(dist('normal'));
  });

  it('ABS keeps wheels turning under a panic stop; without ABS they lock', () => {
    const stop = (mode: 'normal' | 'offroad') => {
      const v = spawn(RANGER_TX4, mode as never); v.driveMode = '4H';
      run(v, 5, { throttle: 1 });
      let locked = 0, abs = false, n = 0;
      run(v, 1.2, { brake: 1 }, () => { if (v.speedKmh > 10) { n++; if (v.wheels.some(w => w.contact && w.omega === 0)) locked++; } abs ||= v.absActive; });
      return { lockedFrac: locked / Math.max(1, n), abs };
    };
    const a = stop('normal'), b = stop('offroad');
    console.log('ABS', JSON.stringify(a), 'no ABS', JSON.stringify(b));
    expect(a.abs).toBe(true); expect(b.abs).toBe(false);
    expect(a.lockedFrac).toBeLessThan(b.lockedFrac);
  });

  it('traction control intervenes in Normal on mud and stays off in Mud mode', () => {
    const mud = new Terrain();
    mud.heights.fill(20); mud.surface.fill(2); mud.mudDepth.fill(0.6);
    mud.boulders.length = 0; mud.trees.length = 0; mud.boxes.length = 0; mud.reindexBoxes();
    (mud as unknown as { grid: Map<number, unknown> }).grid.clear();
    const spot: [number, number] = [0, -380];
    const tc = (mode: 'normal' | 'mud') => { const v = new Vehicle(RANGER_TX4, mud); v.reset(spot[0], spot[1], 0); v.setDrivingMode(mode); v.driveMode = '2H'; v.diffLock = false; run(v, 1, {}); let on = false; run(v, 3, { throttle: 1 }, () => { on ||= v.tcActive; }); return on; };
    expect(tc('normal')).toBe(true);
    expect(tc('mud')).toBe(false);
  });
});

describe('collision damage', () => {
  it('normal driving does no damage', () => {
    const v = spawn(RANGER_TX4);
    run(v, 12, { throttle: 0.5 });
    expect(overallDamage(v.condition)).toBe(0);
  });

  it('a hard landing damages the suspension; a tougher vehicle takes less', () => {
    const drop = (spec: VehicleSpec) => { const v = spawn(spec); v.body.pos.y += 2.5; run(v, 3, {}); return v.condition.suspension.reduce((a, b) => a + b, 0) / 4; };
    const base = drop(RANGER_TX4), tough = drop({ ...RANGER_TX4, damageResistance: 2.5 });
    console.log('landing suspension damage', base.toFixed(3), 'tough', tough.toFixed(3));
    expect(base).toBeGreaterThan(0.02);
    expect(tough).toBeLessThan(base);
  });

  it('a head-on crash into a wall damages the front, radiator and engine, and reports the impact', () => {
    // flat ground with a 2 m thick concrete wall across the road (static boxes are active near camp)
    const tc = new Terrain();
    tc.heights.fill(20); tc.surface.fill(1); tc.boulders.length = 0; tc.trees.length = 0; tc.boxes.length = 0;
    (tc as unknown as { grid: Map<number, unknown> }).grid.clear();
    tc.boxes.push({ kind: 'wall', cx: 0, cy: 21.5, cz: 10, hx: 6, hy: 1.5, hz: 1, yaw: 0 }); tc.reindexBoxes();
    const v = new Vehicle(RANGER_TX4, tc); v.reset(0, -36, 0); v.driveMode = '4H'; run(v, 1.5, {});
    const events: ImpactEvent[] = [];
    let hitKmh = 0;
    v.onImpact = e => { if (!events.length) hitKmh = v.speedKmh; events.push(e); };
    // the driver lifts and brakes as soon as they hit
    for (let s = 0; s < 8; s += DT) v.step(DT, { throttle: events.length ? 0 : 1, brake: events.length ? 1 : 0, steer: 0, handbrake: 0 });
    console.log('crash at', hitKmh.toFixed(0), 'km/h', JSON.stringify(v.condition), events.map(e => e.part).join(','));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].part).toBe('front');
    expect(v.condition.body.front).toBeGreaterThan(0.2);
    expect(v.condition.cooling).toBeGreaterThan(0.2);
    expect(v.condition.engine).toBeGreaterThan(0);
    expect(v.condition.body.rear).toBe(0);
    expect(Math.max(...Object.values(v.condition.body))).toBe(v.condition.body.front);
    expect(events.filter(e => e.part === 'front').length).toBeLessThanOrEqual(2);
    // a slow nudge into the same wall does nothing
    const slow = new Vehicle(RANGER_TX4, tc); slow.reset(0, 2, 0); run(slow, 1.5, {});
    run(slow, 4, { throttle: 0.25 });
    expect(overallDamage(slow.condition)).toBe(0);
  });

  it('a fast car cannot punch through a thin wall (shed walls are 30 cm)', () => {
    const tc = new Terrain();
    tc.heights.fill(20); tc.surface.fill(1); tc.boulders.length = 0; tc.trees.length = 0; tc.boxes.length = 0;
    (tc as unknown as { grid: Map<number, unknown> }).grid.clear();
    tc.boxes.push({ kind: 'wall', cx: 0, cy: 22, cz: 10, hx: 5, hy: 2, hz: 0.15, yaw: 0 }); tc.reindexBoxes();
    const v = new Vehicle(RANGER_TX4, tc); v.reset(0, -36, 0); v.driveMode = '4H'; run(v, 1.5, {});
    let hit = false, maxZ = -1e9;
    v.onImpact = () => { hit = true; };
    for (let s = 0; s < 8; s += DT) { v.step(DT, { throttle: hit ? 0 : 1, brake: hit && v.speedKmh > 1 ? 1 : 0, steer: 0, handbrake: 0 }); maxZ = Math.max(maxZ, v.body.pos.z); }
    console.log('thin wall: max z', maxZ.toFixed(2), JSON.stringify(v.condition.body));
    expect(hit).toBe(true);
    expect(maxZ).toBeLessThan(9.85); // the body stays on the near side (the soft contact lets the nose crumple into it)
    expect(v.condition.body.rear).toBe(0);
  });

  it('a damaged radiator overheats the engine under load until it stalls; a healthy one does not', () => {
    const rev = (cooling: number) => { const v = spawn(RANGER_TX4); v.condition.cooling = cooling; v.automatic = false; v.gear = 0; run(v, 15, { throttle: 1 }); return v; };
    const ok = rev(0), bad = rev(1);
    console.log('temps healthy/damaged', ok.engineTemp.toFixed(0), bad.engineTemp.toFixed(0));
    expect(ok.engineOn).toBe(true); expect(ok.engineTemp).toBeLessThan(110);
    expect(bad.overheated).toBe(true); expect(bad.engineOn).toBe(false); expect(bad.canStart()).toBe(false);
  });

  it('a puncture lowers the corner, reduces grip and pulls the steering', () => {
    const drift = (flat: boolean) => { const v = spawn(RANGER_TX4); if (flat) v.condition.tyres[0] = 1; const h0 = heading(v); run(v, 5, { throttle: 0.5 }); return Math.abs(Math.atan2(Math.sin(heading(v) - h0), Math.cos(heading(v) - h0))); };
    const v = new Vehicle(RANGER_TX4, pg); v.condition.tyres[0] = 1;
    expect(v.wheelRadiusOf(0)).toBeLessThan(v.wheelRadiusOf(1));
    const a = drift(false), b = drift(true);
    console.log('heading drift healthy/puncture', a.toFixed(3), b.toFixed(3));
    expect(b).toBeGreaterThan(a + 0.05);
  });

  it('repairs: workshop restores everything, a kit gets you home', () => {
    const c = newCondition(); c.engine = 0.6; c.cooling = 0.8; c.tyres = [1, 0, 0, 1]; c.suspension = [0.6, 0, 0, 0]; c.body.front = 0.7;
    repairWithKit(c);
    expect(Math.max(...c.tyres)).toBeLessThan(1); expect(c.cooling).toBeLessThan(0.5); expect(c.body.front).toBe(0.7); expect(c.engine).toBeGreaterThan(0);
    repairFull(c); expect(overallDamage(c)).toBe(0);
    expect(overallDamage(sanitizeCondition({ engine: 'x', tyres: [5, -1], body: { roof: 0.5 } }))).toBeGreaterThan(0);
    expect(sanitizeCondition(null).engine).toBe(0);
    expect(regionOf(0, 0.25, 2.3, RANGER_TX4.halfExtents, RANGER_TX4.hullOffsetY)).toBe('front');
    expect(regionOf(0, 0.85, 0, RANGER_TX4.halfExtents, RANGER_TX4.hullOffsetY)).toBe('roof');
    expect(regionOf(0.95, 0.25, 0, RANGER_TX4.halfExtents, RANGER_TX4.hullOffsetY)).toBe('left');
  });
});
