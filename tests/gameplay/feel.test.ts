import { describe, it, expect, beforeAll } from 'vitest';
import { Terrain, Vehicle, Character, RANGER_TX4, Vec3, type VehicleInput } from '@orl/shared';

/** Glitch sweep: things a player notices immediately (creeping when parked, jitter, spawn, walking). */
let t: Terrain;
beforeAll(() => { t = new Terrain(); });
const DT = 1 / 240;
const run = (v: Vehicle, secs: number, inp: Partial<VehicleInput>, each?: () => void) => {
  const i: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...inp };
  for (let s = 0; s < secs; s += DT) { v.step(DT, i); each?.(); }
};

describe('feel and glitch sweep', () => {
  it('spawn: the vehicle settles at camp without bouncing', () => {
    const v = new Vehicle(RANGER_TX4, t); v.fuel = 80; v.reset(-4, 4, 0.4);
    run(v, 2, { handbrake: 1 });
    const p0 = v.body.pos.clone(); let maxV = 0;
    run(v, 3, { handbrake: 1 }, () => { maxV = Math.max(maxV, v.body.vel.length()); });
    console.log('spawn drift', p0.distanceTo(v.body.pos).toFixed(4), 'max speed', maxV.toFixed(4));
    expect(p0.distanceTo(v.body.pos)).toBeLessThan(0.03);
    expect(maxV).toBeLessThan(0.08);
  });

  it('parked on a slope with the handbrake it does not creep', () => {
    // find a ~10-15 degree grassy slope
    let spot: [number, number, number] | null = null;
    for (let z = -480; z < 480 && !spot; z += 4) for (let x = -480; x < 480; x += 4) {
      const n = t.normalAt(x, z); if (n[1] > 0.975 || n[1] < 0.93 || t.surfaceAt(x, z) !== 0 || t.heightAt(x, z) < t.waterLevel + 1) continue;
      // a planar patch the size of the vehicle, clear of boulders and trees
      let planar = true;
      for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4], [0, 0]]) { const m = t.normalAt(x + dx, z + dz); if (Math.abs(m[0] - n[0]) + Math.abs(m[2] - n[2]) > 0.15 || t.surfaceAt(x + dx, z + dz) !== 0) planar = false; }
      if (!planar || t.boulders.some(b => Math.hypot(b.x - x, b.z - z) < 8) || t.trees.some(tr => Math.hypot(tr.x - x, tr.z - z) < 5)) continue;
      spot = [x, z, Math.atan2(n[0], n[2])]; break;
    }
    expect(spot).not.toBeNull();
    const [x, z, h] = spot!;
    for (const heading of [h, h + Math.PI / 2]) {
      const v = new Vehicle(RANGER_TX4, t); v.fuel = 80; v.reset(x, z, heading);
      run(v, 2, { handbrake: 1 });
      expect(v.wheels.every(w => w.contact && w.load > 0)).toBe(true);
      const p0 = v.body.pos.clone();
      run(v, 5, { handbrake: 1 });
      console.log('slope creep', p0.distanceTo(v.body.pos).toFixed(4));
      expect(p0.distanceTo(v.body.pos)).toBeLessThan(0.05);
    }
  });

  it('idling on flat ground with no input it stays put (no auto creep or jitter)', () => {
    const v = new Vehicle(RANGER_TX4, t); v.fuel = 80; v.reset(-4, 4, 0.4); v.engineOn = true;
    run(v, 2, {});
    const p0 = v.body.pos.clone();
    run(v, 4, {});
    console.log('idle drift', p0.distanceTo(v.body.pos).toFixed(4));
    expect(p0.distanceTo(v.body.pos)).toBeLessThan(0.1);
  });

  it('accelerates briskly and steers at speed without rolling over', () => {
    const v = new Vehicle(RANGER_TX4, t); v.fuel = 80; v.reset(-4, 4, 0.4); v.engineOn = true;
    run(v, 1, {});
    let t60 = -1, s = 0;
    run(v, 10, { throttle: 1 }, () => { s += DT; if (t60 < 0 && v.speedKmh >= 40) t60 = s; });
    console.log('0-40 km/h', t60.toFixed(2), 's, speed after 10 s', v.speedKmh.toFixed(0));
    expect(t60).toBeGreaterThan(0); expect(t60).toBeLessThan(8);
  });

  it('character walks up a gentle slope, stays on the ground and cannot walk into deep water forever', () => {
    const c = new Character(t); c.place(1, -2);
    const y0 = c.pos.y;
    for (let i = 0; i < 240; i++) c.update(1 / 60, { forward: 1, right: 0, sprint: false, jump: false, crouch: false, camYaw: 0 }, []);
    expect(Number.isFinite(c.pos.x)).toBe(true);
    expect(Math.abs(c.pos.y - t.heightAt(c.pos.x, c.pos.z))).toBeLessThan(0.3);
    console.log('walked', new Vec3(c.pos.x - 1, c.pos.y - y0, c.pos.z + 2).length().toFixed(1), 'm in 4 s');
  });
});
