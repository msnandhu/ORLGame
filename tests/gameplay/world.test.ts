import { describe, it, expect, beforeAll } from 'vitest';
import {
  Terrain, Vehicle, Traffic, Surface, roadPointAt, VEHICLES, isRoadCar,
  RANGER_TX4, VANTA_GT, STRIX_R2, PELLA, CORVAN, HALCYON, SOLENNE_GT,
  type VehicleInput, type VehicleSpec,
} from '@orl/shared';

/** Towns, highways and road cars: the world layout, the road car classes and AI traffic. */
let t: Terrain;   // the real world
let pg: Terrain;  // flat asphalt proving ground
beforeAll(() => {
  t = new Terrain();
  pg = new Terrain();
  pg.heights.fill(20); pg.surface.fill(Surface.Asphalt); pg.mudDepth.fill(0);
  pg.boulders.length = 0; pg.trees.length = 0; pg.boxes.length = 0; pg.reindexBoxes();
  (pg as unknown as { grid: Map<number, unknown> }).grid.clear();
});
const DT = 1 / 240;
const run = (v: Vehicle, secs: number, inp: Partial<VehicleInput>, each?: () => void) => {
  const i: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...inp };
  for (let s = 0; s < secs; s += DT) { v.step(DT, i); each?.(); }
};
const ROAD_CARS = [VANTA_GT, STRIX_R2, PELLA, CORVAN, HALCYON, SOLENNE_GT];

describe('world layout', () => {
  it('has a city, a town and a village, each on a flat plateau above the water', () => {
    expect(t.settlements.map(s => s.kind).sort()).toEqual(['city', 'town', 'village']);
    for (const s of t.settlements) {
      let lo = 1e9, hi = -1e9;
      for (let x = s.cx - s.hx + 10; x <= s.cx + s.hx - 10; x += 8) for (let z = s.cz - s.hz + 10; z <= s.cz + s.hz - 10; z += 8) {
        const h = t.heightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      console.log(s.name, 'plateau', s.y.toFixed(1), 'range', (hi - lo).toFixed(2));
      expect(hi - lo).toBeLessThan(1.2);
      expect(lo).toBeGreaterThan(t.waterLevel + 3);
    }
  });

  it('roads are paved, graded within their class limit and stay above the water', () => {
    expect(t.roads.some(r => r.kind === 'highway' && r.closed)).toBe(true);
    for (const r of t.roads) {
      let maxGrade = 0, paved = 0, n = 0;
      for (let s = 10; s < r.length - 10; s += 10) {
        const a = roadPointAt(r, s), b = roadPointAt(r, s + 10);
        maxGrade = Math.max(maxGrade, Math.abs(t.heightAt(b.x, b.z) - t.heightAt(a.x, a.z)) / 10);
        if (t.surfaceAt(a.x, a.z) === Surface.Asphalt) paved++;
        n++;
        expect(t.heightAt(a.x, a.z)).toBeGreaterThan(t.waterLevel + 1);
      }
      expect(maxGrade).toBeLessThan(r.cls.maxGrade + 0.03);
      expect(paved / n).toBeGreaterThan(0.97);
    }
    const hw = t.roads.find(r => r.kind === 'highway')!;
    console.log('highway', hw.length.toFixed(0), 'm; roads', t.roads.length);
    expect(hw.length).toBeGreaterThan(5000);
  });

  it('the road network connects camp to every settlement', () => {
    // roads meet where one ends on another or where they cross
    const meet = (a: typeof t.roads[0], b: typeof t.roads[0]) => a.pts.some(p => b.pts.some(q => Math.abs(q[0] - p[0]) < 12 && Math.abs(q[1] - p[1]) < 12));
    const adj = new Map(t.roads.map(r => [r, t.roads.filter(o => o !== r && meet(r, o))]));
    const start = t.roads.find(r => Math.hypot(r.pts[0][0], r.pts[0][1]) < 80)!;
    expect(start).toBeTruthy();
    const seen = new Set([start]), q = [start];
    while (q.length) for (const o of adj.get(q.shift()!)!) if (!seen.has(o)) { seen.add(o); q.push(o); }
    expect(seen.size).toBe(t.roads.length);
    for (const s of t.settlements) expect([...seen].some(r => r.pts.some(p => t.inSettlement(p[0], p[1], 0) === s))).toBe(true);
  });

  it('buildings sit inside their settlement, off the roads and with collision boxes', () => {
    expect(t.buildings.length).toBeGreaterThan(100);
    const kinds = new Set(t.buildings.map(b => b.kind));
    for (const k of ['tower', 'apartment', 'shop', 'house', 'station']) expect(kinds.has(k as never)).toBe(true);
    for (const b of t.buildings) {
      expect(t.inSettlement(b.x, b.z, 0)).toBeTruthy();
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
        const x = b.x + lx * b.w / 2 * c + lz * b.d / 2 * s, z = b.z - lx * b.w / 2 * s + lz * b.d / 2 * c;
        expect(t.roadEdgeDist(x, z)).toBeGreaterThan(0.5);
      }
      // the building is solid: a point at its centre is inside a static box
      expect(t.boxesNear(b.x, b.z).some(i => t.boxAt(i).ref === t.buildings.indexOf(b))).toBe(true);
    }
  });

  it('fuel pumps and car parks in every settlement, clear of buildings', () => {
    expect(t.fuelPumps.length).toBeGreaterThanOrEqual(7);
    expect(t.parking.length).toBeGreaterThanOrEqual(ROAD_CARS.length);
    for (const s of t.settlements) expect(t.fuelPumps.some(p => t.inSettlement(p.x, p.z, 0) === s)).toBe(true);
    for (const p of t.parking) for (const b of t.buildings) {
      const dx = p.x - b.x, dz = p.z - b.z, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      expect(Math.abs(lx) > b.w / 2 + 1.5 || Math.abs(lz) > b.d / 2 + 1.5).toBe(true);
    }
  });
});

describe('road cars', () => {
  const sprint = (spec: VehicleSpec) => {
    const v = new Vehicle(spec, pg); v.fuel = 80; v.reset(0, -1000, 0); run(v, 1, {});
    let t100 = 0, tt = 0;
    run(v, 30, { throttle: 1 }, () => { tt += DT; if (!t100 && v.speedKmh >= 100) t100 = tt; });
    return { t100, vmax: v.speedKmh };
  };
  it('the catalog has racing, common and luxury road cars next to the off-roaders', () => {
    const cats = new Set(VEHICLES.map(v => v.category));
    for (const c of ['racing', 'common', 'luxury']) expect(cats.has(c as never)).toBe(true);
    expect(VEHICLES.filter(isRoadCar).length).toBe(6);
    expect(isRoadCar(RANGER_TX4)).toBe(false);
  });

  it('acceleration follows the class: racing and luxury are quick, common cars are not', () => {
    const r = Object.fromEntries(ROAD_CARS.map(s => [s.id, sprint(s)]));
    console.log('0-100 / speed after 30 s', JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.t100.toFixed(1), v.vmax.toFixed(0)]]))));
    for (const s of ROAD_CARS) expect(r[s.id].t100).toBeGreaterThan(0);
    expect(r['vanta-gt'].t100).toBeLessThan(5.5);
    expect(r['strix-r2'].t100).toBeLessThan(5.5);
    expect(r['pella'].t100).toBeGreaterThan(9);
    expect(r['corvan'].t100).toBeGreaterThan(8);
    expect(r['halcyon'].t100).toBeLessThan(r['corvan'].t100);
    expect(r['vanta-gt'].vmax).toBeGreaterThan(r['pella'].vmax + 40);
    expect(r['halcyon'].vmax).toBeLessThan(253); // speed limiter
  });

  it('FWD, RWD and AWD drive the right wheels', () => {
    const spin = (spec: VehicleSpec) => {
      const v = new Vehicle(spec, pg); v.fuel = 80; v.reset(0, -1000, 0); run(v, 1, {}); run(v, 0.6, { throttle: 1 });
      const f = (v.wheels[0].omega + v.wheels[1].omega) / 2, r = (v.wheels[2].omega + v.wheels[3].omega) / 2;
      return { f: v.wheels.filter(w => w.front).reduce((a, w) => a + w.driveTorque, 0), r: v.wheels.filter(w => !w.front).reduce((a, w) => a + w.driveTorque, 0), om: [f, r] };
    };
    const fwd = spin(CORVAN), rwd = spin(VANTA_GT), awd = spin(STRIX_R2);
    console.log('drive torque front/rear', [fwd, rwd, awd].map(d => `${d.f.toFixed(0)}/${d.r.toFixed(0)}`).join(' '));
    expect(fwd.f).toBeGreaterThan(100); expect(Math.abs(fwd.r)).toBeLessThan(1);
    expect(rwd.r).toBeGreaterThan(100); expect(Math.abs(rwd.f)).toBeLessThan(1);
    expect(awd.f).toBeGreaterThan(100); expect(awd.r).toBeGreaterThan(100);
  });

  it('road cars have no transfer case or off-road modes', () => {
    const v = new Vehicle(PELLA, pg);
    const before = v.driveMode; v.toggleDriveMode(); expect(v.driveMode).toBe(before);
    v.setDrivingMode('rockcrawl'); expect(v.drivingMode).not.toBe('rockcrawl');
    v.setDrivingMode('sport'); expect(v.drivingMode).toBe('sport');
  });

  it('performance tyres grip harder on asphalt but give up in mud', () => {
    const brake = (spec: VehicleSpec, surface: Surface) => {
      const g = new Terrain(); g.heights.fill(20); g.surface.fill(surface); g.mudDepth.fill(surface === Surface.Mud ? 0.3 : 0);
      g.boulders.length = 0; g.trees.length = 0; g.boxes.length = 0; g.reindexBoxes();
      (g as unknown as { grid: Map<number, unknown> }).grid.clear();
      const v = new Vehicle({ ...spec, abs: true } as VehicleSpec, g); v.fuel = 80; v.reset(0, -1000, 0); run(v, 1, {});
      run(v, 12, { throttle: 0.7 }, () => { if (v.speedKmh > 60) v.body.vel.multiplyScalar(60 / v.speedKmh); });
      const v0 = v.forwardSpeed(); run(v, 0.8, { brake: 1 });
      return (v0 - v.forwardSpeed()) / 0.8;
    };
    const perfA = brake(CORVAN_PERF(), Surface.Asphalt), roadA = brake(CORVAN, Surface.Asphalt);
    const perfM = brake(CORVAN_PERF(), Surface.Mud), roadM = brake(CORVAN, Surface.Mud);
    console.log('braking m/s2 asphalt perf/road', perfA.toFixed(1), roadA.toFixed(1), 'mud', perfM.toFixed(1), roadM.toFixed(1));
    expect(perfA).toBeGreaterThan(roadA);
    expect(perfM).toBeLessThan(roadM);
  });
});
const CORVAN_PERF = (): VehicleSpec => ({ ...CORVAN, tyre: 'performance' });

describe('AI traffic', () => {
  const specs = [PELLA, CORVAN, HALCYON, VANTA_GT], weights = [4, 4, 1.5, 0.5];

  it('spawns on the roads and drives for two minutes without NaN, collisions or stalls', () => {
    const tr = new Traffic(t, specs, weights, 60, 3);
    expect(tr.cars.length).toBeGreaterThan(45);
    let minGap = 1e9, speedSum = 0, n = 0;
    for (let step = 0; step < 120 * 30; step++) {
      tr.update(1 / 30, []);
      if (step % 15) continue;
      for (const c of tr.cars) {
        expect(Number.isFinite(c.x + c.y + c.z + c.yaw + c.v)).toBe(true);
        speedSum += c.v; n++;
      }
      // cars sharing a lane keep apart
      for (let i = 0; i < tr.cars.length; i++) for (let j = i + 1; j < tr.cars.length; j++) {
        const a = tr.cars[i], b = tr.cars[j];
        if (a.road !== b.road || a.dir !== b.dir || a.lane !== b.lane) continue;
        minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.z - b.z) - a.spec.halfExtents[2] - b.spec.halfExtents[2]);
      }
    }
    // every car sits on its road surface
    for (const c of tr.cars) expect(Math.abs(t.heightAt(c.x, c.z) - roadPointAt(c.road, c.s).y)).toBeLessThan(0.6);
    console.log('traffic: cars', tr.cars.length, 'mean speed', (speedSum / n * 3.6).toFixed(0), 'km/h, min same-lane gap', minGap.toFixed(2), 'm');
    expect(minGap).toBeGreaterThan(0.3);
    expect(speedSum / n).toBeGreaterThan(6);
  });

  it('stops for someone standing in the lane, and a bump stops it', () => {
    const tr = new Traffic(t, specs, weights, 1, 11);
    const c = tr.cars[0];
    for (let i = 0; i < 300; i++) tr.update(1 / 30, []);
    expect(c.v).toBeGreaterThan(5);
    // a person 30 m ahead in its lane
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), ox = c.x + fx * 30, oz = c.z + fz * 30;
    let closest = 1e9;
    for (let i = 0; i < 300; i++) { tr.update(1 / 30, [{ x: ox, z: oz, r: 0.4 }]); closest = Math.min(closest, Math.hypot(c.x - ox, c.z - oz)); }
    console.log('stopped', closest.toFixed(2), 'm from the pedestrian, speed', c.v.toFixed(2));
    expect(c.v).toBeLessThan(0.3);
    expect(closest).toBeGreaterThan(c.spec.halfExtents[2] + 0.4);
    // it drives on once the lane is clear, and stops when hit
    for (let i = 0; i < 150; i++) tr.update(1 / 30, []);
    expect(c.v).toBeGreaterThan(2);
    tr.bump(c);
    for (let i = 0; i < 60; i++) tr.update(1 / 30, []);
    expect(c.v).toBe(0);
  });
});
