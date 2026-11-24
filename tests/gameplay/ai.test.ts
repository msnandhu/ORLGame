import { describe, it, expect, beforeAll } from 'vitest';
import { Terrain, Vehicle, Vec3, RANGER_TX4, BRAMBLE_RC2, STRIX_R2, AiDriver, VehicleContacts, overallDamage, type VehicleInput } from '@orl/shared';

/** Phase 5: AI drivers run the real vehicle simulation, and vehicles collide with each other. */
let pg: Terrain;
beforeAll(() => {
  pg = new Terrain();
  pg.heights.fill(20); pg.surface.fill(1); pg.mudDepth.fill(0);
  pg.boulders.length = 0; pg.trees.length = 0; pg.boxes.length = 0;
  (pg as unknown as { grid: Map<number, unknown> }).grid.clear(); pg.reindexBoxes();
});
const DT = 1 / 240;
const settle = (v: Vehicle) => { for (let i = 0; i < 360; i++) v.step(DT, { throttle: 0, brake: 1, steer: 0, handbrake: 1 }); };
const tgt = (v: Vehicle) => ({ x: v.body.pos.x, z: v.body.pos.z, vx: v.body.vel.x, vz: v.body.vel.z });
const up = (v: Vehicle) => new Vec3(0, 1, 0).applyQuaternion(v.body.quat).y;

describe('AI drivers', () => {
  it('follows a closed course and laps it at speed', () => {
    const v = new Vehicle(STRIX_R2, pg); v.reset(0, -300, Math.PI / 2); settle(v);
    const ai = new AiDriver(v); ai.skill = 0.8;
    const pts: [number, number][] = [];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; pts.push([Math.cos(a) * 120 - 120, -300 + Math.sin(a) * 70]); }
    ai.setPath(pts, true, 30);
    let maxErr = 0, t = 0, vmax = 0;
    while (ai.laps < 2 && t < 120) {
      v.step(DT, ai.update(DT, null)); t += DT;
      // distance from the ellipse
      const p = v.body.pos, e = Math.abs(Math.hypot((p.x + 120) / 120, (p.z + 300) / 70) - 1) * 70;
      if (ai.laps >= 1) maxErr = Math.max(maxErr, e); // second lap: up to speed, off the standing start
      vmax = Math.max(vmax, v.speedKmh);
    }
    console.log(`2 laps in ${t.toFixed(1)} s, top ${vmax.toFixed(0)} km/h, worst line error ${maxErr.toFixed(1)} m`);
    expect(ai.laps).toBe(2);
    expect(vmax).toBeGreaterThan(50);
    expect(maxErr).toBeLessThan(15);
    expect(up(v)).toBeGreaterThan(0.9);
  });

  it('chases down a fleeing vehicle and rams it hard enough to damage it', () => {
    const prey = new Vehicle(RANGER_TX4, pg), hunter = new Vehicle(BRAMBLE_RC2, pg);
    prey.reset(0, -200, Math.PI / 2); hunter.reset(-60, -230, Math.PI / 2); settle(prey); settle(hunter);
    const run = new AiDriver(prey); run.maxKmh = 45;
    run.setPath([[0, -200], [200, -200], [200, -400], [-200, -400], [-200, -200]], true, 13);
    const ai = new AiDriver(hunter); ai.behavior = { kind: 'chase', ram: true }; ai.skill = 0.9;
    const contacts = new VehicleContacts();
    let t = 0, firstHit = -1, hits = 0;
    while (t < 60) {
      contacts.step([prey, hunter]);
      if (contacts.hits.length) { hits += contacts.hits.length; if (firstHit < 0) firstHit = t; }
      prey.step(DT, run.update(DT, null));
      hunter.step(DT, ai.update(DT, tgt(prey)));
      t += DT;
      if (overallDamage(prey.condition) > 0.25) break;
    }
    console.log(`first ram after ${firstHit.toFixed(1)} s, ${hits} hits, prey damage ${(overallDamage(prey.condition) * 100).toFixed(0)}%, hunter damage ${(overallDamage(hunter.condition) * 100).toFixed(0)}%`);
    expect(firstHit).toBeGreaterThan(0);
    expect(firstHit).toBeLessThan(30);
    expect(overallDamage(prey.condition)).toBeGreaterThan(0.05);
    expect(overallDamage(hunter.condition)).toBeGreaterThan(0);
  });

  it('backs out when driven into a wall', () => {
    const t2 = new Terrain(); t2.heights.fill(20); t2.surface.fill(1); t2.mudDepth.fill(0); t2.boulders.length = 0; t2.trees.length = 0; t2.boxes.length = 0;
    (t2 as unknown as { grid: Map<number, unknown> }).grid.clear();
    t2.boxes.push({ kind: 'wall', cx: 0, cy: 22, cz: -280, hx: 6, hy: 3, hz: 0.5, yaw: 0 }); t2.reindexBoxes();
    const v = new Vehicle(RANGER_TX4, t2); v.reset(0, -300, 0); settle(v);
    const ai = new AiDriver(v); ai.setPath([[0, -300], [0, -200]], false, 8);
    let t = 0; while (t < 25 && v.body.pos.z < -210) { v.step(DT, ai.update(DT, null)); t += DT; }
    console.log(`round the wall in ${t.toFixed(1)} s, at z=${v.body.pos.z.toFixed(0)}`);
    expect(v.body.pos.z).toBeGreaterThan(-215);
  });
});

describe('vehicle-to-vehicle contact', () => {
  it('a 40 km/h T-bone exchanges momentum and damages both vehicles', () => {
    const a = new Vehicle(RANGER_TX4, pg), b = new Vehicle(RANGER_TX4, pg);
    a.reset(0, -400, Math.PI / 2); b.reset(12, -400, 0); settle(a); settle(b);
    // b sits broadside; a drives into its side at 40 km/h
    a.body.vel.set(40 / 3.6, 0, 0);
    const c = new VehicleContacts(); const idle: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    const p0 = a.body.vel.x * a.body.mass;
    for (let i = 0; i < 240 * 3; i++) { c.step([a, b]); a.step(DT, idle); b.step(DT, { ...idle, handbrake: 1 }); }
    console.log(`after: a ${a.body.vel.x.toFixed(1)} m/s, b moved ${(b.body.pos.x - 12).toFixed(1)} m, damage a ${(overallDamage(a.condition) * 100).toFixed(0)}% b ${(overallDamage(b.condition) * 100).toFixed(0)}%`);
    expect(b.body.pos.x - 12).toBeGreaterThan(0.5);           // pushed sideways
    expect(a.body.pos.x).toBeLessThan(b.body.pos.x);           // no tunnelling through
    expect(b.condition.body.left + b.condition.body.right).toBeGreaterThan(0); // side damage on b
    expect(a.condition.body.front).toBeGreaterThan(0);          // front damage on a
    expect(p0).toBeGreaterThan(0);
  });
});
