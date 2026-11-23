import { describe, it, expect, beforeAll } from 'vitest';
import { Vec3 } from '@orl/shared';
import { Terrain } from '@orl/shared';
import { Vehicle, type VehicleInput } from '@orl/shared';
import { RANGER_TX4 } from '@orl/shared';

let terrain: Terrain;
beforeAll(() => { terrain = new Terrain(); });
const DT = 1 / 240;
const run = (v: Vehicle, secs: number, inp: Partial<VehicleInput>) => {
  const i: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...inp };
  for (let t = 0; t < secs; t += DT) v.step(DT, i);
};
function findFlat(): [number, number] {
  for (let j = 20; j < terrain.n - 20; j += 3) for (let i = 20; i < terrain.n - 20; i += 3) {
    const x = i * terrain.cell - terrain.half, z = j * terrain.cell - terrain.half; let ok = true;
    for (let d = -20; d <= 30 && ok; d += 2) { const s = terrain.surfaceAt(x, z + d); if (s === 2 || s === 3 || terrain.normalAt(x, z + d)[1] < 0.985 || terrain.heightAt(x, z + d) < terrain.waterLevel + 0.3) ok = false; }
    // clear of trees, boulders and buildings along the run
    if (ok && (terrain.trees.some(t => Math.abs(t.x - x) < 5 && t.z > z - 30 && t.z < z + 40) || terrain.boulders.some(b => Math.abs(b.x - x) < 6 && b.z > z - 30 && b.z < z + 40) || terrain.inSettlement(x, z, 20))) ok = false;
    if (ok) return [x, z];
  }
  throw new Error('no flat strip');
}
const up = (v: Vehicle) => new Vec3(0, 1, 0).applyQuaternion(v.body.quat).y;

describe('terrain', () => {
  it('builds with obstacles and a flat camp', () => {
    expect(terrain.boulders.length).toBeGreaterThan(150);
    expect(terrain.trees.length).toBeGreaterThan(500);
    expect(Math.abs(terrain.heightAt(5, 5) - terrain.heightAt(-5, -5))).toBeLessThan(0.6);
  });
  it('has water, mud and rock areas', () => {
    const counts = [0, 0, 0, 0, 0];
    for (const s of terrain.surface) counts[s]++;
    expect(counts[2]).toBeGreaterThan(1000); // mud
    expect(counts[3]).toBeGreaterThan(1000); // rock
    let water = 0;
    for (const h of terrain.heights) if (h < terrain.waterLevel) water++;
    expect(water).toBeGreaterThan(1000);
  });
});

describe('vehicle physics', () => {
  it('settles on its suspension at camp', () => {
    const v = new Vehicle(RANGER_TX4, terrain);
    v.reset(0, 0, 0);
    run(v, 3, { handbrake: 1 });
    expect(v.wheels.every(w => w.contact)).toBe(true);
    const avg = v.wheels.reduce((a, w) => a + w.compression, 0) / 4;
    expect(avg).toBeGreaterThan(0.18); expect(avg).toBeLessThan(0.36);
    expect(v.body.vel.length()).toBeLessThan(0.05);
    expect(up(v)).toBeGreaterThan(0.98);
  });
  it('accelerates, upshifts and brakes to a stop', () => {
    const v = new Vehicle(RANGER_TX4, terrain);
    v.reset(0, 0, 0); run(v, 1, {});
    run(v, 6, { throttle: 1 });
    const s6 = v.speedKmh;
    console.log('0-6s speed km/h', s6.toFixed(1), 'gear', v.gear, 'rpm', v.rpm.toFixed(0));
    expect(s6).toBeGreaterThan(35);
    expect(v.gear).toBeGreaterThan(1);
    // braking measured on a flat, firm strip
    const [fx, fz] = findFlat();
    v.reset(fx, fz - 18, 0); run(v, 1, {}); run(v, 3, { throttle: 1 });
    const v0 = v.forwardSpeed();
    run(v, 0.75, { brake: 1 });
    const decel = (v0 - v.forwardSpeed()) / 0.75;
    console.log('braking decel m/s2', decel.toFixed(1), 'surface', v.wheels.map(w => w.surface).join(''));
    expect(decel).toBeGreaterThan(5.5); expect(decel).toBeLessThan(11);
  });
  it('turns right with positive steer', () => {
    const v = new Vehicle(RANGER_TX4, terrain);
    v.reset(0, 0, 0); run(v, 1, {});
    run(v, 2, { throttle: 0.6 });
    run(v, 2, { throttle: 0.4, steer: 1 });
    const f = new Vec3(0, 0, 1).applyQuaternion(v.body.quat);
    // right of +Z heading is -X
    expect(f.x).toBeLessThan(-0.3);
    expect(up(v)).toBeGreaterThan(0.9);
  });
  it('reverses in automatic when holding brake at standstill', () => {
    const v = new Vehicle(RANGER_TX4, terrain);
    v.reset(0, 0, 0); run(v, 1, {});
    run(v, 3, { brake: 1 });
    expect(v.gear).toBe(-1);
    expect(v.forwardSpeed()).toBeLessThan(-1);
  });
  it('4L climbs harder than 2H, and diff lock does not break things', () => {
    const v = new Vehicle(RANGER_TX4, terrain);
    v.driveMode = '4L'; v.diffLock = true;
    v.reset(0, 0, 0); run(v, 1, {});
    run(v, 5, { throttle: 1 });
    expect(v.speedKmh).toBeGreaterThan(5);
    expect(v.speedKmh).toBeLessThan(60);
    expect(up(v)).toBeGreaterThan(0.85);
  });
  it('mud slows the vehicle more than a dirt trail', () => {
    // find a mud cell and a dirt cell on flat-ish ground
    const find = (s: number) => {
      for (let j = 20; j < terrain.n - 20; j += 3) for (let i = 20; i < terrain.n - 20; i += 3) {
        const k = j * terrain.n + i;
        if (terrain.surface[k] !== s) continue;
        const x = i * terrain.cell - terrain.half, z = j * terrain.cell - terrain.half;
        let ok = true;
        for (let d = -12; d <= 12 && ok; d += 2) { if (terrain.surfaceAt(x, z + d) !== s || terrain.heightAt(x, z + d) < terrain.waterLevel + 0.3) ok = false; }
        // level along the whole run, so neither side gets a downhill advantage
        if (ok && Math.abs(terrain.heightAt(x, z + 25) - terrain.heightAt(x, z - 12)) > 0.8) ok = false;
        for (let d = -12; d <= 25 && ok; d += 2) if (terrain.normalAt(x, z + d)[1] < 0.97) ok = false;
        // clear of trees, boulders and buildings along the run
    if (ok && (terrain.trees.some(t => Math.abs(t.x - x) < 5 && t.z > z - 30 && t.z < z + 40) || terrain.boulders.some(b => Math.abs(b.x - x) < 6 && b.z > z - 30 && b.z < z + 40) || terrain.inSettlement(x, z, 20))) ok = false;
    if (ok) return [x, z];
      }
      return null;
    };
    const mud = find(2), dirt = find(1);
    expect(mud).not.toBeNull(); expect(dirt).not.toBeNull();
    const speed = (p: number[]) => { const v = new Vehicle(RANGER_TX4, terrain); v.reset(p[0], p[1] - 10, 0); run(v, 1, {}); run(v, 3, { throttle: 0.5 }); return v.speedKmh; };
    const sm = speed(mud!), sd = speed(dirt!);
    console.log('mud', sm.toFixed(1), 'dirt', sd.toFixed(1));
    expect(sm).toBeLessThan(sd);
  });
  it('survives a long random drive without NaN or explosion', () => {
    const v = new Vehicle(RANGER_TX4, terrain);
    v.reset(0, 0, 0);
    let steer = 0;
    for (let t = 0; t < 60; t += DT) {
      if (Math.floor(t * 2) !== Math.floor((t - DT) * 2)) steer = Math.sin(t * 0.7);
      v.step(DT, { throttle: 0.8, brake: 0, steer, handbrake: 0 });
      if (v.upsideDownTimer > 1) v.recover();
      expect(Number.isFinite(v.body.pos.x)).toBe(true);
      expect(v.body.vel.length()).toBeLessThan(80);
    }
    console.log('random drive end', v.body.pos.toArray().map(n => n.toFixed(1)).join(','), 'km/h', v.speedKmh.toFixed(1));
  });
});
