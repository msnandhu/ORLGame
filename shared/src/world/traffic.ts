import { mulberry32 } from '../math/noise';
import type { Terrain, StaticBox } from '../terrain/terrain';
import type { VehicleSpec } from '../vehicles/spec';
import { roadPointAt, type Road } from './layout';

/** Something traffic must not drive into: the player, their vehicle, a parked car. */
export interface TrafficObstacle { x: number; z: number; r: number }

export interface TrafficCar {
  id: number; spec: VehicleSpec; paint: [number, number, number];
  road: Road; dir: 1 | -1; lane: number; s: number;
  v: number; cruise: number;
  /** world pose, updated every step */
  x: number; y: number; z: number; yaw: number; pitch: number; steer: number;
  /** seconds stopped (to break junction stand-offs) and seconds left of a post-collision stop */
  stopped: number; ignoreCross: number; shaken: number;
  /** the junction ahead this car has decided about, and the turn it will take there (null: straight on) */
  decided?: Branch | null; plan?: Branch | null;
}
/** A place along a road where another road can be joined: a crossing, or a side road ending on it. */
export interface Branch { s: number; to: Road; ts: number }

const S0 = 3.5, HEADWAY = 1.4, ACC = 1.8, DEC = 3.2, LAT_ACC = 2.6;

/**
 * Ambient AI traffic. Cars are kinematic: they follow lane centrelines on the graded roads, keep a safe gap
 * with the Intelligent Driver Model, slow for curves, give way to anything in their path (other cars at
 * junctions, the player, the player's vehicle) and turn onto a connecting road at the end of each road.
 * They stop for a few seconds when something hits them.
 */
export class Traffic {
  readonly cars: TrafficCar[] = [];
  private rnd: () => number;
  /** road ends -> roads that continue from there */
  private links = new Map<string, { road: Road; s: number }[]>();
  /** mid-road junctions per road, sorted by s */
  readonly branches = new Map<Road, Branch[]>();

  constructor(terrain: Terrain, specs: readonly VehicleSpec[], weights: readonly number[], count: number, seed = 7) {
    this.rnd = mulberry32(seed);
    const roads = terrain.roads;
    for (const r of roads) if (!r.closed) for (const end of [0, 1] as const) {
      const p = end === 0 ? r.pts[0] : r.pts[r.pts.length - 1], list: { road: Road; s: number }[] = [];
      for (const o of roads) {
        if (o === r) continue;
        let best = 1e9, bs = 0;
        for (let i = 0; i < o.pts.length; i++) { const d = Math.hypot(o.pts[i][0] - p[0], o.pts[i][1] - p[1]); if (d < best) { best = d; bs = o.cum[i]; } }
        if (best < 16) list.push({ road: o, s: bs });
      }
      this.links.set(`${r.id}:${end}`, list);
    }
    // mid-road junctions: crossings and side roads that end on a road (exits from the highway, town grids)
    for (const r of roads) {
      const list: Branch[] = [];
      for (const o of roads) {
        if (o === r) continue;
        const near = r.cls.width / 2 + 3;
        let best = 1e9, bi = -1, bj = -1;
        const flush = () => {
          if (bi < 0) return;
          const s = r.cum[bi], endGap = Math.min(s, r.length - s);
          if (r.closed || endGap > 12) list.push({ s, to: o, ts: o.cum[bj] });
          best = 1e9; bi = bj = -1;
        };
        for (let i = 0; i < r.pts.length; i++) {
          let d = 1e9, jj = -1;
          for (let j = 0; j < o.pts.length; j++) { const q = Math.abs(o.pts[j][0] - r.pts[i][0]) + Math.abs(o.pts[j][1] - r.pts[i][1]); if (q < d) { d = q; jj = j; } }
          if (d < near) { if (d < best) { best = d; bi = i; bj = jj; } } else flush();
        }
        flush();
      }
      list.sort((a, b) => a.s - b.s);
      this.branches.set(r, list);
    }
    // spread cars over the network in proportion to lane length
    const total = roads.reduce((a, r) => a + r.length * r.cls.lanesPerDir, 0), wsum = weights.reduce((a, b) => a + b, 0);
    const palette: [number, number, number][] = [[0.8, 0.8, 0.82], [0.08, 0.08, 0.09], [0.55, 0.05, 0.05], [0.1, 0.2, 0.45], [0.45, 0.47, 0.5], [0.9, 0.9, 0.88], [0.12, 0.3, 0.18], [0.75, 0.55, 0.2]];
    for (let i = 0; i < count; i++) {
      let pickL = this.rnd() * total, road = roads[0];
      for (const r of roads) { pickL -= r.length * r.cls.lanesPerDir; if (pickL <= 0) { road = r; break; } }
      let pw = this.rnd() * wsum, spec = specs[0];
      for (let k = 0; k < specs.length; k++) { pw -= weights[k]; if (pw <= 0) { spec = specs[k]; break; } }
      const dir: 1 | -1 = this.rnd() < 0.5 ? 1 : -1;
      const car: TrafficCar = {
        id: i, spec, paint: palette[Math.floor(this.rnd() * palette.length)], road, dir, lane: Math.floor(this.rnd() * road.cls.lanesPerDir),
        s: this.rnd() * road.length, v: 0, cruise: 0.85 + this.rnd() * 0.2, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, steer: 0, stopped: 0, ignoreCross: 0, shaken: 0,
      };
      // don't spawn on top of another car
      if (this.cars.some(c => c.road === road && c.dir === dir && c.lane === car.lane && Math.abs(c.s - car.s) < 25)) continue;
      car.v = road.cls.speedLimit * 0.6;
      this.place(car);
      this.cars.push(car);
    }
  }

  /** Lateral offset of a lane centre from the road centreline (right-hand traffic). */
  laneOffset(c: TrafficCar) { return c.road.cls.laneWidth * (c.lane + 0.5); }

  private place(c: TrafficCar) {
    const p = roadPointAt(c.road, c.s), tx = p.tx * c.dir, tz = p.tz * c.dir;
    // right of the travel direction is (-tz, tx)
    const off = this.laneOffset(c);
    c.x = p.x - tz * off; c.z = p.z + tx * off;
    c.yaw = Math.atan2(tx, tz);
    const ahead = roadPointAt(c.road, c.s + 3 * c.dir), behind = roadPointAt(c.road, c.s - 3 * c.dir);
    c.pitch = Math.atan2(ahead.y - behind.y, 6);
    const sag = (c.spec.mass * 9.81 / 4) / c.spec.springRate;
    c.y = p.y + (c.spec.restLength - sag) + c.spec.wheelRadius - c.spec.mountY;
  }

  /** Signed curvature of the lane ahead (rad/m), sampled over the next `look` metres. */
  private curvatureAhead(c: TrafficCar, look: number) {
    const a = roadPointAt(c.road, c.s + c.dir * 2), b = roadPointAt(c.road, c.s + c.dir * look);
    const ya = Math.atan2(a.tx, a.tz), yb = Math.atan2(b.tx, b.tz);
    return Math.atan2(Math.sin(yb - ya), Math.cos(yb - ya)) / look;
  }

  update(dt: number, obstacles: readonly TrafficObstacle[]) {
    const cars = this.cars;
    // leaders per lane: sort by travelled distance
    const lanes = new Map<string, TrafficCar[]>();
    for (const c of cars) { const k = `${c.road.id}:${c.dir}:${c.lane}`; let l = lanes.get(k); if (!l) { l = []; lanes.set(k, l); } l.push(c); }
    for (const l of lanes.values()) l.sort((a, b) => a.s * a.dir - b.s * b.dir);
    for (const c of cars) {
      const lane = lanes.get(`${c.road.id}:${c.dir}:${c.lane}`)!, i = lane.indexOf(c);
      let gap = 1e9, vLead = 0;
      const next = lane[i + 1] ?? (c.road.closed ? lane[0] : undefined);
      if (next && next !== c) {
        let d = (next.s - c.s) * c.dir;
        if (d <= 0 && c.road.closed) d += c.road.length;
        if (d > 0) { gap = d - (next.spec.halfExtents[2] + c.spec.halfExtents[2]); vLead = next.v; }
      }
      // anything else in the path: the player, other cars crossing at junctions
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const consider = (ox: number, oz: number, r: number, v: number) => {
        const dx = ox - c.x, dz = oz - c.z, along = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx);
        if (along > 0 && along < 45 && lat < 1.6 + r) { const g = along - r - c.spec.halfExtents[2]; if (g < gap) { gap = g; vLead = v; } }
      };
      for (const o of obstacles) consider(o.x, o.z, o.r, 0);
      if (c.ignoreCross <= 0) for (const o of cars) {
        if (o === c || (o.road === c.road && o.dir === c.dir)) continue;
        if (Math.abs(o.x - c.x) > 45 || Math.abs(o.z - c.z) > 45) continue;
        // oncoming traffic in its own lane is not in the way
        if (o.road === c.road) continue;
        consider(o.x, o.z, o.spec.halfExtents[0] + 0.3, 0);
      }
      // desired speed: limit, personality, curves
      const k = Math.max(Math.abs(this.curvatureAhead(c, 25)), Math.abs(this.curvatureAhead(c, 50)));
      let v0 = c.road.cls.speedLimit * c.cruise;
      if (k > 1e-4) v0 = Math.min(v0, Math.sqrt(LAT_ACC / k));
      // a junction ahead: decide once whether to turn there, and slow down for it if so
      const b = this.branchAhead(c, 40);
      if (b && c.decided !== b) { c.decided = b; c.plan = this.rnd() < (c.road.kind === 'highway' ? 0.2 : b.to.kind === 'street' ? 0.22 : 0.6) ? b : null; }
      if (c.plan) { const d = this.ahead(c, c.plan.s); v0 = Math.min(v0, Math.max(4, Math.sqrt(2 * DEC * Math.max(0, d - 3)) + 4)); }
      // end of an open road: slow down for the turn
      if (!c.road.closed) { const left = c.dir > 0 ? c.road.length - c.s : c.s; v0 = Math.min(v0, Math.max(5, Math.sqrt(2 * DEC * Math.max(0, left - 4)) + 4)); }
      let acc: number;
      if (c.shaken > 0) { c.shaken -= dt; acc = -8; }
      else {
        const dv = c.v - vLead, sStar = S0 + c.v * HEADWAY + (c.v * dv) / (2 * Math.sqrt(ACC * DEC));
        acc = ACC * (1 - (c.v / Math.max(1, v0)) ** 4 - (gap < 1e8 ? (Math.max(0, sStar) / Math.max(0.5, gap)) ** 2 : 0));
        acc = Math.max(-9, acc);
      }
      c.v = Math.max(0, c.v + acc * dt);
      if (gap < 0.5) c.v = 0;
      c.stopped = c.v < 0.3 ? c.stopped + dt : 0;
      if (c.ignoreCross > 0) c.ignoreCross -= dt;
      else if (c.stopped > 6) { c.ignoreCross = 3; c.stopped = 0; } // break a junction stand-off
      const before = c.plan ? this.ahead(c, c.plan.s) : 0;
      c.s += c.v * dt * c.dir;
      if (c.road.closed) c.s = ((c.s % c.road.length) + c.road.length) % c.road.length;
      if (c.plan && (this.ahead(c, c.plan.s) <= 0 || this.ahead(c, c.plan.s) > before + 1)) this.takeBranch(c, c.plan);
      else if (!c.road.closed && (c.s < 0 || c.s > c.road.length)) this.turn(c);
      c.steer = Math.atan(this.curvatureAhead(c, 6) * (c.spec.wheelFrontZ - c.spec.wheelRearZ)) * c.dir;
      this.place(c);
    }
  }

  /** Distance along the travel direction from the car to arc length s (negative once passed). */
  private ahead(c: TrafficCar, s: number) {
    let d = (s - c.s) * c.dir;
    if (c.road.closed) { const L = c.road.length; d = ((d % L) + L) % L; if (d > L / 2) d -= L; }
    return d;
  }
  private branchAhead(c: TrafficCar, look: number): Branch | null {
    let best: Branch | null = null, bd = look;
    for (const b of this.branches.get(c.road) ?? []) { const d = this.ahead(c, b.s); if (d > 0.5 && d <= bd) { bd = d; best = b; } }
    return best;
  }
  /** Turn onto the other road at a junction, in a direction that leads somewhere. */
  private takeBranch(c: TrafficCar, b: Branch) {
    const o = b.to;
    let dir: 1 | -1 = this.rnd() < 0.5 ? 1 : -1;
    if (!o.closed) { if (b.ts < 12) dir = 1; else if (b.ts > o.length - 12) dir = -1; }
    c.road = o; c.dir = dir; c.s = b.ts; c.lane = Math.min(c.lane, o.cls.lanesPerDir - 1);
    c.plan = null; c.decided = null; c.v = Math.min(c.v, 6);
  }

  /** At the end of an open road: continue onto a connecting road, or turn around. */
  private turn(c: TrafficCar) {
    const end = c.s > 0 ? 1 : 0, opts = this.links.get(`${c.road.id}:${end}`) ?? [];
    const p = roadPointAt(c.road, end ? c.road.length : 0), fx = p.tx * c.dir, fz = p.tz * c.dir;
    if (opts.length) {
      // leaving a town grid: roads out are favoured over more streets
      const wts = opts.map(o => (o.road.kind === 'street' ? 1 : 3)), tot = wts.reduce((x, y) => x + y, 0);
      let pick = this.rnd() * tot, o = opts[0];
      for (let k = 0; k < opts.length; k++) { pick -= wts[k]; if (pick <= 0) { o = opts[k]; break; } }
      const q = roadPointAt(o.road, o.s);
      // continue in whichever direction keeps going forwards (or turns least)
      let dir: 1 | -1 = q.tx * fx + q.tz * fz >= 0 ? 1 : -1;
      // at the very end of the new road, the only way is back along it
      if (!o.road.closed && ((dir > 0 && o.s > o.road.length - 5) || (dir < 0 && o.s < 5))) dir = dir > 0 ? -1 : 1;
      c.road = o.road; c.dir = dir; c.s = o.s; c.lane = Math.min(c.lane, o.road.cls.lanesPerDir - 1); c.plan = null; c.decided = null;
    } else {
      c.dir = c.dir > 0 ? -1 : 1; c.s = Math.max(0, Math.min(c.road.length, c.s));
    }
    c.v = Math.min(c.v, 6);
  }

  /** Oriented boxes of every car, for vehicle and pedestrian collisions. */
  boxes(): StaticBox[] {
    return this.cars.map(c => ({ kind: 'traffic', cx: c.x, cy: c.y + c.spec.hullOffsetY, cz: c.z, hx: c.spec.halfExtents[0], hy: c.spec.halfExtents[1], hz: c.spec.halfExtents[2], yaw: c.yaw }));
  }

  /** Something hit this car: it brakes to a stop and waits. */
  bump(c: TrafficCar) { c.shaken = 4; }
}
