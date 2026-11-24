import { Vec3 } from '../math/vec';
import { clamp } from '../math/noise';
import type { Vehicle, VehicleInput } from '../vehicles/vehicle';

/**
 * AI drivers for story vehicles. An AI driver never moves its vehicle directly: it reads the vehicle's state and
 * returns pedal and steering inputs, and the vehicle runs the same 240 Hz simulation as the player's, so gang cars
 * slide, roll, get stuck and wreck for real.
 *
 * Behaviours:
 * - path: follow a polyline (patrols loop, racers run checkpoints, fleeing cars run their escape route), with a speed
 *   chosen from the bend ahead (pure pursuit with a look-ahead that grows with speed);
 * - chase: run the target down, aiming where it will be (lead from closing speed), and ram it at full speed when close;
 * - block: put the vehicle across the target's way to its goal;
 * - hold: guard a zone: return to it, and ram anyone inside it;
 * - park: stand still with the handbrake on.
 * Every behaviour backs out when stuck, recovers when upside down and steers round trees, rocks and walls ahead.
 */
export type AiBehavior =
  | { kind: 'park' }
  | { kind: 'path'; pts: [number, number][]; loop: boolean; speed: number }
  | { kind: 'chase'; ram: boolean }
  | { kind: 'block'; goal: [number, number] }
  | { kind: 'hold'; x: number; z: number; r: number };

export interface AiTarget { x: number; z: number; vx: number; vz: number }

const _f = new Vec3();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class AiDriver {
  behavior: AiBehavior = { kind: 'park' };
  /** 0..1: lead prediction, cornering bravery and top speed share */
  skill = 0.6;
  /** top speed cap in km/h (story difficulty, mission pacing) */
  maxKmh = 140;
  /** seconds upside down before it rights itself (mission enemies count a roll-over as a takedown first) */
  recoverAfter = 1.6;
  /** index of the path point being followed, and laps completed on a loop */
  pathIndex = 0; laps = 0;
  /** reversing out of a jam: seconds left and steering direction */
  private unstick = 0; private unstickSteer = 1; private jam = 0;
  private dodge = 0;
  /** the last inputs, for debugging and tests */
  last: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

  constructor(readonly v: Vehicle) {}

  setPath(pts: [number, number][], loop: boolean, speed: number) {
    this.behavior = { kind: 'path', pts, loop, speed };
    // start from the nearest point ahead
    let best = 0, bd = Infinity; const p = this.v.body.pos;
    pts.forEach(([x, z], i) => { const d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; best = i; } });
    this.pathIndex = best; this.laps = 0;
  }

  heading() { _f.set(0, 0, 1).applyQuaternion(this.v.body.quat); return Math.atan2(_f.x, _f.z); }

  update(dt: number, target: AiTarget | null): VehicleInput {
    const v = this.v, p = v.body.pos, b = this.behavior;
    const speed = v.forwardSpeed(), kmh = Math.abs(speed) * 3.6;
    let aimX = p.x, aimZ = p.z, want = 0; // want: target speed m/s (0 = stop)
    let ram = false;
    if (v.upsideDownTimer > this.recoverAfter) { v.recover(); this.unstick = 0; }
    switch (b.kind) {
      case 'park': return this.out({ throttle: 0, brake: 1, steer: 0, handbrake: 1 });
      case 'path': {
        const n = b.pts.length;
        // advance past points within reach, or already passed (beyond the line through the point across the path)
        for (let k = 0; k < n; k++) {
          const i = this.pathIndex, [x, z] = b.pts[i], d = Math.hypot(x - p.x, z - p.z);
          const j = i === n - 1 ? (b.loop ? 0 : -1) : i + 1;
          const passed = j >= 0 && ((p.x - x) * (b.pts[j][0] - x) + (p.z - z) * (b.pts[j][1] - z)) > 0 && d < 40;
          if (d > 6 + Math.abs(speed) * 0.3 && !passed) break;
          if (i === n - 1) { if (b.loop) { this.pathIndex = 0; this.laps++; } else break; }
          else this.pathIndex++;
        }
        const look = 4 + Math.abs(speed) * 0.4;
        [aimX, aimZ] = this.lookAhead(b.pts, b.loop, look);
        // the fastest speed from which every bend ahead can still be taken (braking at ~6 m/s²)
        const grip = 5 + this.skill * 3; // m/s² of lateral acceleration it dares
        want = Math.min(b.speed, this.cornerSpeed(b.pts, b.loop, grip, 40 + Math.abs(speed) * 3));
        if (!b.loop && this.pathIndex === n - 1) { const [x, z] = b.pts[n - 1]; const d = Math.hypot(x - p.x, z - p.z); want = Math.min(want, d * 0.5); }
        break;
      }
      case 'chase': {
        if (!target) return this.out({ throttle: 0, brake: 0.6, steer: 0, handbrake: 0 });
        const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
        const closing = Math.max(4, (v.body.vel.x * dx + v.body.vel.z * dz) / (d || 1));
        const lead = clamp(d / closing, 0, 1.6) * this.skill;
        aimX = target.x + target.vx * lead; aimZ = target.z + target.vz * lead;
        want = d < 20 && b.ram ? 40 : 45;
        ram = b.ram && d < 25;
        // don't overshoot a stopped target if not ramming
        if (!b.ram && d < 14) want = Math.hypot(target.vx, target.vz);
        break;
      }
      case 'block': {
        if (!target) return this.out({ throttle: 0, brake: 1, steer: 0, handbrake: 0 });
        const gx = b.goal[0] - target.x, gz = b.goal[1] - target.z, gl = Math.hypot(gx, gz) || 1;
        const ahead = Math.min(gl, 18 + Math.hypot(target.vx, target.vz) * 0.8);
        aimX = target.x + gx / gl * ahead; aimZ = target.z + gz / gl * ahead;
        const d = Math.hypot(aimX - p.x, aimZ - p.z);
        want = d > 10 ? 35 : d * 1.5;
        break;
      }
      case 'hold': {
        const inZone = target && Math.hypot(target.x - b.x, target.z - b.z) < b.r * 1.25;
        if (inZone && target) { aimX = target.x + target.vx * 0.4; aimZ = target.z + target.vz * 0.4; want = 30; ram = true; }
        else { aimX = b.x; aimZ = b.z; const d = Math.hypot(aimX - p.x, aimZ - p.z); want = d > 6 ? 14 : 0; }
        break;
      }
    }
    want = Math.min(want, this.maxKmh / 3.6 * (0.7 + 0.3 * this.skill));
    // ---- steering towards the aim point, around obstacles ----
    const hd = this.heading();
    let desired = Math.atan2(aimX - p.x, aimZ - p.z);
    const blocked = this.probe(hd, Math.max(8, Math.abs(speed) * 1.1));
    if (blocked && !ram) { this.dodge = clamp(this.dodge + dt * 2, 0, 1); desired += blocked * 0.9 * this.dodge; }
    else this.dodge = Math.max(0, this.dodge - dt);
    let err = wrap(desired - hd);
    // target behind: three-point turn (reverse while steering the other way) when slow, otherwise a hard turn
    const behind = Math.abs(err) > 2.2 && kmh < 15;
    // stuck: pushing on but not moving
    if (this.unstick <= 0) {
      if (want > 2 && kmh < 2 && v.lastInput.throttle > 0.5) this.jam += dt; else this.jam = Math.max(0, this.jam - dt * 2);
      if (this.jam > 1.5) { this.unstick = 1.4; this.unstickSteer = err > 0 ? 1 : -1; this.jam = 0; }
    }
    if (this.unstick > 0 || behind) {
      this.unstick -= dt;
      if (v.gear > 0 && kmh > 3) return this.out({ throttle: 0, brake: 1, steer: 0, handbrake: 0 });
      if (v.automatic && v.gear > 0) v.gear = -1;
      return this.out({ throttle: 0.7, brake: 0, steer: behind ? (err > 0 ? 1 : -1) : this.unstickSteer, handbrake: 0 });
    }
    if (v.automatic && v.gear < 0) v.gear = 1;
    // a positive steering input turns the vehicle towards -heading (and the reverse when backing up)
    const raw = -err * 2.4 + v.body.angVel.y * 0.12, steer = clamp(raw, -1, 1);
    // speed control; at full lock and still not turning enough, lift off until the nose comes round
    let goal = want * (Math.abs(err) > 0.9 ? 0.55 : 1);
    if (Math.abs(raw) > 1.2 && !ram && speed > 6) goal = Math.min(goal, speed - 1.5);
    let throttle = clamp((goal - speed) * 0.45 + (ram ? 0.6 : 0), 0, 1), brake = 0;
    if (speed > goal + 1) { throttle = 0; brake = clamp((speed - goal) * 0.4, 0, 1); }
    return this.out({ throttle, brake, steer, handbrake: 0 });
  }

  private out(i: VehicleInput) { this.last = i; return i; }

  /** Point `dist` metres ahead along the path from the current index. */
  private lookAhead(pts: [number, number][], loop: boolean, dist: number): [number, number] {
    const p = this.v.body.pos, n = pts.length;
    let [px, pz] = [p.x, p.z], i = this.pathIndex, left = dist;
    for (let k = 0; k < n; k++) {
      const [x, z] = pts[i], d = Math.hypot(x - px, z - pz);
      if (d >= left) return [px + (x - px) * left / d, pz + (z - pz) * left / d];
      left -= d; px = x; pz = z;
      if (i === n - 1) { if (!loop) return [x, z]; i = 0; } else i++;
    }
    return pts[i];
  }
  /** Highest speed now that lets the vehicle slow for each vertex ahead (curvature = turn / mean segment length). */
  private cornerSpeed(pts: [number, number][], loop: boolean, grip: number, dist: number): number {
    const n = pts.length, p = this.v.body.pos;
    let i = this.pathIndex, d = Math.hypot(pts[i][0] - p.x, pts[i][1] - p.z), best = Infinity;
    for (let k = 0; k < n && d < dist; k++) {
      const h = i === 0 ? (loop ? n - 1 : -1) : i - 1, j = i === n - 1 ? (loop ? 0 : -1) : i + 1;
      if (h >= 0 && j >= 0) {
        const a0 = Math.atan2(pts[i][0] - pts[h][0], pts[i][1] - pts[h][1]), a1 = Math.atan2(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
        const l0 = Math.hypot(pts[i][0] - pts[h][0], pts[i][1] - pts[h][1]), l1 = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
        const kappa = Math.abs(wrap(a1 - a0)) / Math.max(2, (l0 + l1) / 2);
        if (kappa > 1e-4) best = Math.min(best, Math.sqrt(grip / kappa + 2 * 3.5 * Math.max(0, d - 4)));
      }
      if (j < 0) break;
      d += Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]); i = j;
    }
    return best;
  }
  /**
   * Is the way ahead blocked by a tree, rock, building or a wall too steep to drive? Returns the side to steer to
   * (+1 / -1) or 0 when clear.
   */
  private probe(hd: number, dist: number): number {
    const v = this.v, T = v.terrain, p = v.body.pos, hw = v.spec.halfExtents[0] + 0.6;
    const hit = (ang: number) => {
      for (const d of [dist * 0.5, dist]) {
        const x = p.x + Math.sin(ang) * d, z = p.z + Math.cos(ang) * d;
        if (T.normalAt(x, z)[1] < 0.62) return true;
        T.query(x, z, hw, _qb, _qt);
        for (const i of _qb) { const o = T.boulders[i]; if (Math.hypot(o.x - x, o.z - z) < o.r + hw && o.y + o.r > T.heightAt(x, z) + 0.6) return true; }
        for (const i of _qt) { const o = T.treeAt(i); if (Math.hypot(o.x - x, o.z - z) < o.r + hw) return true; }
        for (const i of T.boxesNear(x, z)) { const bx = T.boxes[i]; if (bx.cy < T.heightAt(x, z) - 5) continue; const c = Math.cos(bx.yaw), s = Math.sin(bx.yaw), dx = x - bx.cx, dz = z - bx.cz; if (Math.abs(dx * c - dz * s) < bx.hx + hw && Math.abs(dx * s + dz * c) < bx.hz + hw) return true; }
      }
      return false;
    };
    if (!hit(hd)) return 0;
    const l = hit(hd + 0.5), r = hit(hd - 0.5);
    if (!l && r) return 1; if (!r && l) return -1; if (!l && !r) return this.dodge > 0 ? (this.lastSide || 1) : (this.lastSide = this.lastSide > 0 ? -1 : 1);
    return this.lastSide || 1;
  }
  private lastSide = 0;
}
const _qb = new Set<number>(), _qt = new Set<number>();
