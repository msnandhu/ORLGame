import { Vec3 } from '../math/vec';
import { Terrain } from '../terrain/terrain';
import { clamp } from '../math/noise';

/** walk: hold to stroll instead of jogging (the default pace is a run, as in most third-person games). */
export interface MoveInput { forward: number; right: number; sprint: boolean; jump: boolean; crouch: boolean; camYaw: number; walk?: boolean }
/** What the body is doing, for animation and gameplay (e.g. no entering a vehicle mid-air). */
export type LocomotionState = 'idle' | 'walk' | 'run' | 'sprint' | 'crouch' | 'crouch-walk' | 'jump' | 'fall' | 'land';

/** Kinematic third-person character controller over the heightfield with obstacle collision. */
export class Character {
  readonly pos = new Vec3();
  readonly vel = new Vec3();
  heading = 0;               // radians, 0 = +Z
  grounded = true;
  crouching = false;
  stamina = 1;
  /** sprinting to empty leaves you winded: no sprint until stamina recovers to 30% */
  exhausted = false;
  speed = 0;                 // horizontal speed m/s (for animation)
  animPhase = 0;
  state: LocomotionState = 'idle';
  airTime = 0;
  /** seconds of landing recovery left; set on touchdown, longer for harder landings */
  landTimer = 0;
  /** last touchdown speed (m/s, downward) */
  landSpeed = 0;
  /** height scale from the appearance (1 = 1.75 m); taller characters stride further */
  stature = 1;
  readonly radius = 0.35;
  private _qb = new Set<number>(); private _qt = new Set<number>();

  constructor(private terrain: Terrain) {}

  place(x: number, z: number) {
    this.pos.set(x, this.groundAt(x, z), z);
    this.vel.set(0, 0, 0);
  }

  /** Ground height including standing on boulders. */
  groundAt(x: number, z: number): number {
    let g = this.terrain.heightAt(x, z);
    this.terrain.query(x, z, 0.5, this._qb, this._qt);
    for (const i of this._qb) {
      const b = this.terrain.boulders[i];
      const dx = x - b.x, dz = z - b.z, d2 = dx * dx + dz * dz;
      if (d2 < b.r * b.r) g = Math.max(g, b.y + Math.sqrt(b.r * b.r - d2));
    }
    return g;
  }

  /** obstacleBoxes: oriented rectangles (e.g. the vehicle) the character cannot walk through. */
  update(dt: number, inp: MoveInput, obstacleBoxes: { cx: number; cz: number; hx: number; hz: number; yaw: number; top: number }[]) {
    const T = this.terrain;
    this.crouching = inp.crouch && this.grounded;
    if (this.stamina <= 0.02) this.exhausted = true; else if (this.stamina > 0.3) this.exhausted = false;
    const wantSprint = inp.sprint && !this.crouching && !this.exhausted && inp.forward > 0;
    const landing = this.landTimer > 0 ? 0.45 : 1; // a hard landing costs a moment
    const maxSpeed = (this.crouching ? 1.6 : wantSprint ? 7.5 : inp.walk ? 1.7 : 3.6) * landing * (0.9 + 0.1 * this.stature);
    // camera-relative wish direction (camYaw 0 looks toward +Z)
    const fx = Math.sin(inp.camYaw), fz = Math.cos(inp.camYaw);
    const rx = -fz, rz = fx; // right vector
    let wx = fx * inp.forward + rx * inp.right, wz = fz * inp.forward + rz * inp.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    // slope slows uphill movement
    const n = T.normalAt(this.pos.x, this.pos.z);
    const uphill = -(n[0] * wx + n[2] * wz);
    const slopeFactor = clamp(1 - Math.max(0, uphill) * 1.6, 0.15, 1);
    const water = T.waterDepthAt(this.pos.x, this.pos.z);
    const waterFactor = water > 0.3 ? 0.55 : 1;
    const target = maxSpeed * slopeFactor * waterFactor;
    const accel = this.grounded ? 14 : 3;
    const tvx = wx * target, tvz = wz * target;
    this.vel.x += clamp(tvx - this.vel.x, -accel * dt, accel * dt);
    this.vel.z += clamp(tvz - this.vel.z, -accel * dt, accel * dt);
    if (wl > 0.05) {
      const want = Math.atan2(wx, wz);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 12);
    }
    if (wantSprint && Math.hypot(this.vel.x, this.vel.z) > 4) this.stamina = Math.max(0, this.stamina - dt / 8);
    else this.stamina = Math.min(1, this.stamina + dt / 5);

    const wasGrounded = this.grounded, fallVel = this.vel.y;
    if (this.grounded && inp.jump && !this.crouching && this.landTimer <= 0) { this.vel.y = 5.2; this.grounded = false; }
    this.vel.y -= 9.81 * dt;
    this.pos.addScaledVector(this.vel, dt);

    // collide with trees and boulders (horizontal push-out)
    T.query(this.pos.x, this.pos.z, 2, this._qb, this._qt);
    for (const i of this._qt) {
      const t = T.trees[i];
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z, d = Math.hypot(dx, dz), r = t.r + this.radius;
      if (d < r && d > 1e-4) { this.pos.x = t.x + (dx / d) * r; this.pos.z = t.z + (dz / d) * r; }
    }
    for (const i of this._qb) {
      const b = T.boulders[i];
      const dx = this.pos.x - b.x, dz = this.pos.z - b.z, d = Math.hypot(dx, dz);
      // only block if the boulder surface here is more than a step above the feet
      const top = d < b.r ? b.y + Math.sqrt(b.r * b.r - d * d) : -1e9;
      const r = b.r + this.radius * 0.5;
      if (d < r && d > 1e-4 && top > this.pos.y + 0.55) { this.pos.x = b.x + (dx / d) * r; this.pos.z = b.z + (dz / d) * r; }
    }
    for (const o of obstacleBoxes) {
      if (this.pos.y > o.top) continue;
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
      const dx = this.pos.x - o.cx, dz = this.pos.z - o.cz;
      // local coords (box x = right/left, z = forward)
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ex = o.hx + this.radius, ez = o.hz + this.radius;
      if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
        let nx = lx, nz = lz;
        if (ex - Math.abs(lx) < ez - Math.abs(lz)) nx = Math.sign(lx) * ex; else nz = Math.sign(lz) * ez;
        this.pos.x = o.cx + nx * c + nz * s;
        this.pos.z = o.cz - nx * s + nz * c;
      }
    }
    const near = T.boxesNear(this.pos.x, this.pos.z), nb = near.length + T.dynamicBoxes.length;
    for (let q = 0; q < nb; q++) {
      const b = q < near.length ? T.boxes[near[q]] : T.dynamicBoxes[q - near.length];
      if (this.pos.y + 1.7 < b.cy - b.hy || this.pos.y > b.cy + b.hy - 0.3) continue;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const dx = this.pos.x - b.cx, dz = this.pos.z - b.cz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ex = b.hx + this.radius, ez = b.hz + this.radius;
      if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
        let nx = lx, nz = lz;
        if (ex - Math.abs(lx) < ez - Math.abs(lz)) nx = Math.sign(lx) * ex; else nz = Math.sign(lz) * ez;
        this.pos.x = b.cx + nx * c + nz * s; this.pos.z = b.cz - nx * s + nz * c;
      }
    }
    const lim = T.half - 3;
    this.pos.x = clamp(this.pos.x, -lim, lim); this.pos.z = clamp(this.pos.z, -lim, lim);

    const g = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y <= g + (this.grounded ? 0.3 : 0) && this.vel.y <= 0.1) {
      this.pos.y = g; this.vel.y = 0; this.grounded = true;
    } else this.grounded = this.pos.y <= g + 0.01;
    // can't sink into water deeper than wading; swim-float at chest depth
    const wd = T.waterLevel - this.pos.y;
    if (wd > 1.2) { this.pos.y = T.waterLevel - 1.2; this.vel.y = 0; this.grounded = true; }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // stride length scales with height, so a tall character's legs don't skate
    this.animPhase += dt * this.speed * 2.2 / this.stature;
    // ---- locomotion state ----
    if (this.landTimer > 0) this.landTimer -= dt;
    if (!this.grounded) this.airTime += dt;
    if (this.grounded && !wasGrounded && this.airTime > 0.12) {
      this.landSpeed = Math.max(0, -fallVel);
      this.landTimer = Math.min(0.45, 0.08 + this.landSpeed * 0.04);
    }
    if (this.grounded) this.airTime = 0;
    this.state = this.locomotion(wantSprint);
  }

  private locomotion(sprinting: boolean): LocomotionState {
    if (!this.grounded && (this.vel.y > 0.5 || this.airTime > 0.08)) return this.vel.y > 0 ? 'jump' : 'fall';
    if (this.landTimer > 0) return 'land';
    if (this.crouching) return this.speed > 0.3 ? 'crouch-walk' : 'crouch';
    if (this.speed < 0.25) return 'idle';
    if (sprinting && this.speed > 5) return 'sprint';
    return this.speed > 2.6 ? 'run' : 'walk';
  }
}
