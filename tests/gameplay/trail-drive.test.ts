import { it, expect } from 'vitest';
import { Vec3 } from '@orl/shared';
import { Terrain } from '@orl/shared';
import { Vehicle } from '@orl/shared';
import { RANGER_TX4 } from '@orl/shared';

/** Drive the main trail loop from camp, over the rock-crawl ridge, with a simple waypoint-following driver. */
it('follows the trail from camp across the rock-crawl ridge without flipping or exploding', () => {
  const t = new Terrain();
  const path = t.trails[0];
  const v = new Vehicle(RANGER_TX4, t);
  v.driveMode = '4L'; v.diffLock = true;
  v.reset(path[2][0], path[2][1], Math.atan2(path[3][0] - path[2][0], path[3][1] - path[2][1]));
  const DT = 1 / 240;
  let wp = 3, flips = 0, maxY = -1e9, minY = 1e9;
  for (let s = 0; s < 120 && wp < 50; s += DT) {
    const [tx, tz] = path[wp];
    if (Math.hypot(tx - v.body.pos.x, tz - v.body.pos.z) < 6) wp++;
    const f = new Vec3(0, 0, 1).applyQuaternion(v.body.quat);
    let d = Math.atan2(tx - v.body.pos.x, tz - v.body.pos.z) - Math.atan2(f.x, f.z); d = Math.atan2(Math.sin(d), Math.cos(d));
    v.step(DT, { throttle: v.speedKmh > 12 ? 0 : 0.8, brake: 0, steer: Math.max(-1, Math.min(1, -d * 2)), handbrake: 0 });
    expect(v.body.angVel.length()).toBeLessThan(20);
    if (v.upsideDownTimer > 1) { flips++; v.recover(); }
    maxY = Math.max(maxY, v.body.pos.y); minY = Math.min(minY, v.body.pos.y);
  }
  console.log(JSON.stringify({ kmh: v.speedKmh, gear: v.gear, rpm: v.rpm, flooded: v.flooded, eng: v.engineOn, hull: v.hullContact, w: v.wheels.map(w => [w.contact, Math.round(w.load), +w.omega.toFixed(1), w.surface, w.inWater, +w.mudSink.toFixed(2)]), water: t.waterDepthAt(v.body.pos.x, v.body.pos.z), td: t.trailDist(v.body.pos.x, v.body.pos.z) }));
  console.log(`reached waypoint ${wp} of ${path.length}, at ${v.body.pos.toArray().map(n => n.toFixed(0))}, elevation range ${minY.toFixed(1)}..${maxY.toFixed(1)} m, flips ${flips}`);
  expect(wp).toBeGreaterThan(30);
  expect(flips).toBe(0);
});
