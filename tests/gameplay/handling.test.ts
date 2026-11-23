import { describe, it, expect, beforeAll } from 'vitest';
import { Terrain, Vehicle, VEHICLES, isRoadCar, type VehicleInput } from '@orl/shared';

/** Handling sweep on an endless flat pad: every vehicle stays upright and in line in the manoeuvres a player does at speed. */
let pad: Terrain, world: Terrain;
let SURF = 5;
const DT = 1 / 240;
beforeAll(() => {
  world = new Terrain();
  pad = new Terrain();
  const P = pad as unknown as Record<string, unknown>;
  P.heightAt = () => 20; P.normalAt = () => [0, 1, 0]; P.surfaceAt = () => SURF; P.mudAt = () => 0; P.waterAt = () => -Infinity;
  P.query = (_x: number, _z: number, _r: number, b: Set<number>, t: Set<number>) => { b.clear(); t.clear(); };
  P.clampToWorld = () => {};
});
const mk = (id: string, surf = 5) => {
  SURF = surf;
  const v = new Vehicle(VEHICLES.find(s => s.id === id)!, pad); v.reset(0, 0, 0); v.engineOn = true;
  for (let i = 0; i < 480; i++) v.step(DT, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
  return v;
};
const run = (v: Vehicle, secs: number, f: (t: number) => Partial<VehicleInput>, each?: () => void) => {
  for (let s = 0; s < secs; s += DT) { v.step(DT, { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...f(s) }); each?.(); }
};
const upright = (v: Vehicle) => 1 - 2 * (v.body.quat.x ** 2 + v.body.quat.z ** 2);
const bodySlipDeg = (v: Vehicle) => { const sp = v.body.vel.length(); return sp < 3 ? 0 : Math.acos(Math.min(1, Math.abs(v.forwardSpeed()) / sp)) * 57.3; };

describe('handling', () => {
  for (const spec of VEHICLES) {
    it(`${spec.id}: lane change at 100 km/h and a hard corner stay upright and under control`, () => {
      let v = mk(spec.id);
      run(v, 25, () => ({ throttle: v.speedKmh < 100 ? 1 : 0.3 }));
      let up = 1, slip = 0;
      run(v, 5, t => ({ throttle: 0.3, steer: t < 0.6 ? 0.5 : t < 1.2 ? -0.5 : 0 }), () => { up = Math.min(up, upright(v)); slip = Math.max(slip, bodySlipDeg(v)); });
      expect(up).toBeGreaterThan(0.95);
      expect(slip).toBeLessThan(20);
      // a long corner at 100 km/h with the driver keeping the power on
      v = mk(spec.id); up = 1; slip = 0;
      run(v, 25, () => ({ throttle: v.speedKmh < 100 ? 1 : 0.3 }));
      run(v, 6, t => ({ throttle: v.speedKmh < 100 ? 0.6 : 0.1, steer: Math.min(1, t / 0.2) * 0.6 }), () => { up = Math.min(up, upright(v)); slip = Math.max(slip, bodySlipDeg(v)); });
      expect(up).toBeGreaterThan(0.95);
      expect(slip).toBeLessThan(isRoadCar(spec) ? 20 : 25);
    });
  }

  it('the Ranger cruises a highway at 90 km/h with all four wheels on the road', () => {
    const r = world.outer.roads.find(r => r.src.id === 'hw-east')!, P = r.pts;
    const v = new Vehicle(VEHICLES[0], world);
    let i = Math.floor(P.length * 0.1);
    v.reset(P[i][0], P[i][1], Math.atan2(P[i + 2][0] - P[i][0], P[i + 2][1] - P[i][1])); v.engineOn = true; v.fuel = 999;
    for (let k = 0; k < 480; k++) v.step(DT, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    let air = 0, travelled = 0;
    const p0 = v.body.pos.clone();
    for (let s = 0; s < 30; s += DT) {
      const lx = v.body.pos.x, lz = v.body.pos.z;
      let bd = Infinity; for (let k = i; k < Math.min(P.length, i + 40); k++) { const d = Math.hypot(P[k][0] - lx, P[k][1] - lz); if (d < bd) { bd = d; i = k; } }
      let j = i; while (j < P.length - 2 && Math.hypot(P[j][0] - lx, P[j][1] - lz) < Math.max(8, v.speedKmh / 3.6)) j++;
      const dx = P[j + 1][0] - P[j][0], dz = P[j + 1][1] - P[j][1], dl = Math.hypot(dx, dz) || 1;
      let e = Math.atan2(P[j][0] - dz / dl * 4 - lx, P[j][1] + dx / dl * 4 - lz) - v.body.quat.yaw();
      e = Math.atan2(Math.sin(e), Math.cos(e));
      v.step(DT, { throttle: v.speedKmh < 90 ? Math.min(1, (90 - v.speedKmh) / 10) : 0, brake: 0, steer: Math.max(-1, Math.min(1, -e * 2.5)), handbrake: 0 });
      if (s > 2 && v.wheels.filter(w => !w.contact).length >= 2) air += DT;
    }
    travelled = Math.hypot(v.body.pos.x - p0.x, v.body.pos.z - p0.z);
    expect(travelled).toBeGreaterThan(500);
    expect(air).toBeLessThan(0.05);
  });
});
