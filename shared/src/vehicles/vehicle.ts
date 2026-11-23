import { Vec3 } from '../math/vec';
import { RigidBody } from './rigidbody';
import { Terrain, Surface, type BoxContactMemory } from '../terrain/terrain';
import { VehicleSpec } from './spec';
import { clamp, smoothstep } from '../math/noise';
import { DrivingMode, DRIVING_MODE_PROFILES } from './modes';
import { VehicleCondition, BodyRegion, newCondition, regionOf, isPunctured } from './damage';

export type DriveMode = '2H' | '4H' | '4L';
export interface VehicleInput { throttle: number; brake: number; steer: number; handbrake: number }
/** Reported for every damaging hit. point is in the vehicle's local frame. */
export interface ImpactEvent { point: Vec3; severity: number; part: BodyRegion | 'suspension'; wheel: number }

/** Hull contact closing speed (m/s) below which nothing gets damaged: parking bumps and scrapes are free. */
export const IMPACT_THRESHOLD = 4;
/** Suspension compression speed (m/s) at the bump stop below which it is not damaged. */
export const BUMPSTOP_THRESHOLD = 3;
const AMBIENT_C = 20;

/** Per-surface tyre/ground properties. */
export const SURFACE_PROPS: Record<Surface, { mu: number; roll: number; sink: number; stiff: number }> = {
  [Surface.Grass]:  { mu: 0.78, roll: 0.025, sink: 0.0,  stiff: 0.9 },
  [Surface.Dirt]:   { mu: 0.85, roll: 0.02,  sink: 0.0,  stiff: 1.0 },
  [Surface.Mud]:    { mu: 0.42, roll: 0.10,  sink: 0.09, stiff: 0.55 },
  [Surface.Rock]:   { mu: 1.05, roll: 0.015, sink: 0.0,  stiff: 1.1 },
  [Surface.Gravel]: { mu: 0.68, roll: 0.035, sink: 0.02, stiff: 0.8 },
};

export class Wheel {
  // static
  readonly mount = new Vec3();
  readonly front: boolean; readonly left: boolean;
  // state
  omega = 0; rotation = 0; steer = 0;
  compression = 0; prevCompression = 0;
  contact = false; load = 0; surface: Surface = Surface.Grass; onBoulder = false;
  slipRatio = 0; slipAngle = 0; mudSink = 0; inWater = false;
  readonly contactPoint = new Vec3();
  readonly contactNormal = new Vec3(0, 1, 0);
  readonly worldCenter = new Vec3();
  driveTorque = 0; brakeTorque = 0;
  bumpHit = false;
  constructor(x: number, y: number, z: number, front: boolean) {
    this.mount.set(x, y, z); this.front = front; this.left = x > 0;
  }
}

const GRAVITY = 9.81;
const _v = new Vec3(), _f = new Vec3(), _p = new Vec3(), _n = new Vec3();
const _up = new Vec3(), _fwd = new Vec3(), _right = new Vec3();
const _wf = new Vec3(), _wl = new Vec3();
const _nArr: [number, number, number] = [0, 1, 0];
const _hit = { boulder: false };
const _qb = new Set<number>(), _qt = new Set<number>();

export class Vehicle {
  readonly body: RigidBody;
  readonly wheels: Wheel[];
  readonly hullPoints: Vec3[] = [];
  // drivetrain state
  gear = 1;                // -1 reverse, 0 neutral, 1..n
  automatic = true;
  driveMode: DriveMode = '4H';
  diffLock = false;
  rpm = 800;
  engineTorque = 0;
  shiftTimer = 0;
  engineOn = true;
  flooded = false;
  fuel: number;
  steerSmoothed = 0;
  reverseHold = 0;
  upsideDownTimer = 0;
  hullContact = false;
  speedKmh = 0;
  lastInput: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  // Phase 2: driving modes, electronics, condition
  drivingMode: DrivingMode = 'normal';
  condition: VehicleCondition = newCondition();
  engineTemp = 85;            // deg C
  overheated = false;         // stalled from heat; restarts once below 100 C
  tcActive = false; absActive = false; crawlActive = false;
  impactGrace = 0;            // seconds after a reset during which nothing is damaged
  onImpact: ((e: ImpactEvent) => void) | null = null;
  private hullWasContact: boolean[] = [];
  private hullNowContact: boolean[] = [];
  private hullBoxMem: BoxContactMemory[] = [];
  private wheelBoxMem: BoxContactMemory[] = [0, 1, 2, 3].map(() => ({ box: -1, axis: 0, sign: 1 }));

  constructor(public spec: VehicleSpec, public terrain: Terrain) {
    this.body = new RigidBody(spec.mass, new Vec3(...spec.inertia));
    const { wheelX: x, wheelFrontZ: fz, wheelRearZ: rz, mountY: y } = spec;
    this.wheels = [new Wheel(x, y, fz, true), new Wheel(-x, y, fz, true), new Wheel(x, y, rz, false), new Wheel(-x, y, rz, false)];
    this.fuel = spec.fuelCapacity;
    const [hx, hy, hz] = spec.halfExtents, oy = spec.hullOffsetY;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) this.hullPoints.push(new Vec3(sx * hx, oy + sy * hy, sz * hz));
    // belly / skid-plate points (high-centering), bumper mid points, roof mid points
    for (const z of [-0.9, 0, 0.9]) this.hullPoints.push(new Vec3(0, spec.bellyY, z * hz / 2.3));
    for (const sz of [-1, 1]) this.hullPoints.push(new Vec3(0, oy - hy, sz * (hz + 0.1)), new Vec3(0, oy + hy, sz * hz * 0.5));
    for (const sx of [-1, 1]) this.hullPoints.push(new Vec3(sx * hx, oy, 0));
    this.hullWasContact = this.hullPoints.map(() => false);
    this.hullNowContact = this.hullPoints.map(() => false);
    this.hullBoxMem = this.hullPoints.map(() => ({ box: -1, axis: 0, sign: 1 }));
  }

  /** Effective rolling radius: a flat tyre runs on the rim. */
  wheelRadiusOf(i: number) { return this.spec.wheelRadius - (isPunctured(this.condition, i) ? 0.07 : 0); }

  /** Select a driving mode; it also sets the transfer case and lockers the mode is designed for. */
  setDrivingMode(m: DrivingMode) {
    this.drivingMode = m;
    const r = DRIVING_MODE_PROFILES[m].recommend;
    if (r) { this.driveMode = r.range; this.diffLock = r.diffLock; }
  }

  /** Whether the engine can be (re)started now. */
  canStart(): boolean {
    return this.fuel > 0 && !this.flooded && this.condition.engine < 1 && !(this.overheated && this.engineTemp > 100);
  }
  /** Engine power multiplier from wear and heat (1 = full power). */
  powerFactor(): number {
    return (1 - 0.55 * this.condition.engine) * (1 - 0.8 * smoothstep(112, 122, this.engineTemp));
  }

  get ratio(): number {
    const s = this.spec;
    const range = this.driveMode === '4L' ? s.lowRange : 1;
    if (this.gear === 0) return 0;
    const g = this.gear < 0 ? -s.reverseRatio : s.gears[this.gear - 1];
    return g * s.finalDrive * range;
  }

  /** Place the vehicle resting above the terrain at x,z facing heading (radians, 0 = +Z). */
  reset(x: number, z: number, heading: number) {
    const b = this.body;
    // clear the whole footprint (terrain + boulders) so no hull point starts buried
    let h = -1e9;
    const c = Math.cos(heading), sn = Math.sin(heading);
    for (let lz = -2.6; lz <= 2.6; lz += 0.65) for (let lx = -1.1; lx <= 1.1; lx += 0.55) {
      const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
      h = Math.max(h, this.terrain.heightAt(wx, wz));
      this.terrain.query(wx, wz, 0.1, _qb, _qt);
      for (const i of _qb) { const bo = this.terrain.boulders[i]; const d2 = (wx - bo.x) ** 2 + (wz - bo.z) ** 2; if (d2 < bo.r * bo.r) h = Math.max(h, bo.y + Math.sqrt(bo.r * bo.r - d2)); }
    }
    b.pos.set(x, h + 1.0, z);
    b.quat.setFromAxisAngle(new Vec3(0, 1, 0), heading);
    b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0);
    for (const w of this.wheels) { w.omega = 0; w.compression = w.prevCompression = 0; }
    this.gear = 1; this.rpm = this.spec.idleRpm; this.flooded = false;
    if (this.overheated && this.engineTemp < 100) this.overheated = false;
    this.engineOn = this.canStart();
    this.upsideDownTimer = 0; this.impactGrace = 1;
    this.hullWasContact.fill(false); for (const w of this.wheels) w.bumpHit = false;
    for (const m of [...this.hullBoxMem, ...this.wheelBoxMem]) m.box = -1;
  }

  /** Recover: lift and set upright, keeping heading. */
  recover() {
    const f = new Vec3(0, 0, 1).applyQuaternion(this.body.quat);
    const heading = Math.atan2(f.x, f.z);
    let { x, z } = this.body.pos;
    // nudge off boulders
    this.terrain.query(x, z, 3, _qb, _qt);
    for (const i of _qb) { const bo = this.terrain.boulders[i]; const d = Math.hypot(x - bo.x, z - bo.z); if (d < bo.r + 2.5) { x += ((x - bo.x) / (d || 1)) * 3; z += ((z - bo.z) / (d || 1)) * 3; } }
    this.reset(x, z, heading);
  }

  toggleDriveMode() {
    this.driveMode = this.driveMode === '2H' ? '4H' : this.driveMode === '4H' ? '4L' : '2H';
  }
  shiftUp() { if (this.gear < this.spec.gears.length) { this.gear = this.gear === -1 ? 0 : this.gear + 1; this.shiftTimer = 0.2; } }
  shiftDown() { if (this.gear > -1) { this.gear = this.gear === 1 && Math.abs(this.forwardSpeed()) > 2 ? 1 : this.gear - 1; this.shiftTimer = 0.2; } }

  forwardSpeed(): number { return _fwd.set(0, 0, 1).applyQuaternion(this.body.quat).dot(this.body.vel); }

  private torqueAt(rpm: number): number {
    const c = this.spec.torqueCurve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) if (rpm <= c[i][0]) { const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t; }
    return c[c.length - 1][1];
  }

  private driven(w: Wheel) { return this.driveMode === '2H' ? !w.front : true; }

  step(dt: number, input: VehicleInput) {
    const s = this.spec, b = this.body, T = this.terrain;
    this.lastInput = input;
    const q = b.quat;
    _up.set(0, 1, 0).applyQuaternion(q);
    _fwd.set(0, 0, 1).applyQuaternion(q);
    _right.set(-1, 0, 0).applyQuaternion(q);
    const vFwd = _fwd.dot(b.vel);
    this.speedKmh = Math.abs(vFwd) * 3.6;

    // ---------- Input interpretation (automatic handles reverse) ----------
    let throttle = input.throttle, brake = input.brake;
    if (this.automatic) {
      if (this.gear > 0 && input.brake > 0.1 && vFwd < 0.6 && input.throttle < 0.1) { this.reverseHold += dt; if (this.reverseHold > 0.25) { this.gear = -1; this.reverseHold = 0; } }
      else if (this.gear < 0 && input.throttle > 0.1 && vFwd > -0.6) { this.reverseHold += dt; if (this.reverseHold > 0.25) { this.gear = 1; this.reverseHold = 0; } }
      else this.reverseHold = 0;
      if (this.gear < 0) { throttle = input.brake; brake = input.throttle; }
      if (this.gear === 0) this.gear = 1;
      // auto hold: at a standstill with no pedal input the brakes hold the vehicle (no idle creep or rolling back)
      if (throttle < 0.05 && Math.abs(vFwd) < 0.8 && this.reverseHold === 0) brake = Math.max(brake, 0.4);
    }
    const mode = DRIVING_MODE_PROFILES[this.drivingMode];
    const cond = this.condition;
    if (this.impactGrace > 0) this.impactGrace -= dt;
    // pedal map
    throttle = mode.throttleGain * Math.pow(clamp(throttle, 0, 1), mode.throttleExp);
    // crawl control: holds walking pace up and down hill using throttle and brakes
    this.crawlActive = false;
    if (mode.crawlKmh !== null && this.gear !== 0) {
      const over = this.speedKmh - mode.crawlKmh;
      if (over > 0) { this.crawlActive = true; throttle *= Math.max(0, 1 - over / 2); brake = Math.max(brake, clamp(over / 4, 0, 0.7)); }
    }
    // traction control (engine): cut torque when a driven wheel spins past the mode's slip target
    this.tcActive = false;
    if (mode.tcSlip !== null && throttle > 0.05) {
      let maxSlip = 0;
      for (const w of this.wheels) if (w.contact && this.driven(w)) maxSlip = Math.max(maxSlip, Math.abs(w.slipRatio));
      const excess = maxSlip - mode.tcSlip;
      if (excess > 0) { throttle *= clamp(1 - excess * 1.5, 0.15, 1); this.tcActive = true; }
    }

    // ---------- Steering (speed sensitive, smoothed, Ackermann) ----------
    const steerLimit = s.maxSteer * (1 - 0.55 * smoothstep(5, 30, Math.abs(vFwd)));
    // bent steering / a flat front tyre pull the car towards the damaged side (+X is left; positive steer is right)
    const pull = -((cond.suspension[0] - cond.suspension[1]) * 0.05 + ((isPunctured(cond, 0) ? 1 : 0) - (isPunctured(cond, 1) ? 1 : 0)) * 0.03);
    const target = clamp(input.steer * steerLimit + pull * smoothstep(1, 6, Math.abs(vFwd)), -s.maxSteer, s.maxSteer);
    const rate = 2.2 * mode.steerRateMul * dt;
    this.steerSmoothed += clamp(target - this.steerSmoothed, -rate, rate);
    const st = this.steerSmoothed;
    const wb = s.wheelFrontZ - s.wheelRearZ;
    if (Math.abs(st) > 1e-4) {
      const R = wb / Math.tan(Math.abs(st));
      const inner = Math.atan(wb / (R - s.wheelX)), outer = Math.atan(wb / (R + s.wheelX));
      // positive st = steer right (towards -X local, i.e. right side wheels are inner)
      for (const w of this.wheels) if (w.front) w.steer = Math.sign(st) * ((st > 0) !== w.left ? inner : outer);
    } else for (const w of this.wheels) w.steer = 0;

    // ---------- Suspension raycasts ----------
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      const maxLen = s.restLength + this.wheelRadiusOf(wi);
      _p.copy(w.mount).applyQuaternion(q).add(b.pos);
      _n.copy(_up).negate();
      const t = T.raycast(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, maxLen + 0.1, _nArr, _hit);
      w.prevCompression = w.compression;
      w.inWater = false;
      if (t >= 0 && t <= maxLen) {
        w.contact = true;
        w.onBoulder = _hit.boulder;
        w.surface = _hit.boulder ? Surface.Rock : T.surfaceAt(_p.x + _n.x * t, _p.z + _n.z * t);
        const mud = _hit.boulder ? 0 : T.mudAt(_p.x, _p.z);
        w.mudSink = SURFACE_PROPS[w.surface].sink * (w.surface === Surface.Mud ? 0.5 + mud : 1);
        w.compression = Math.min(maxLen - t + w.mudSink, s.maxTravel + 0.12);
        w.contactPoint.copy(_p).addScaledVector(_n, t);
        w.contactNormal.set(_nArr[0], _nArr[1], _nArr[2]);
      } else {
        w.contact = false;
        w.compression = Math.max(0, w.compression - dt * 3); // visual droop
        w.load = 0;
      }
      const susp = s.restLength - w.compression;
      w.worldCenter.copy(_p).addScaledVector(_n, susp + (w.contact ? 0 : 0));
      if (w.worldCenter.y < T.waterLevel) w.inWater = true;
    }

    // Spring/damper + bump stop + anti-roll
    const comp = this.wheels.map(w => (w.contact ? w.compression : 0));
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) continue;
      const cv = (w.compression - w.prevCompression) / dt;
      const sd = cond.suspension[i]; // a damaged corner sags and wallows
      let F = s.springRate * (1 - 0.4 * sd) * w.compression + (cv > 0 ? s.bumpDamping : s.reboundDamping) * mode.dampingMul * (1 - 0.5 * sd) * cv;
      if (w.compression > s.maxTravel) {
        F += (w.compression - s.maxTravel) * 400000 + Math.max(cv, 0) * 20000;
        if (!w.bumpHit && cv > BUMPSTOP_THRESHOLD && this.impactGrace <= 0) {
          const sev = Math.min(1, (cv - BUMPSTOP_THRESHOLD) / 6 / s.damageResistance);
          cond.suspension[i] = Math.min(1, cond.suspension[i] + sev * 0.45);
          cond.tyres[i] = Math.min(1, cond.tyres[i] + sev * (w.surface === Surface.Rock ? 0.8 : 0.25));
          this.onImpact?.({ point: w.mount.clone(), severity: sev, part: 'suspension', wheel: i });
        }
        w.bumpHit = true;
      } else if (w.compression < s.maxTravel - 0.05) w.bumpHit = false;
      const other = comp[i ^ 1];
      F += (w.compression - other) * s.antiRoll * mode.antiRollMul;
      F = Math.max(0, F);
      w.load = F * Math.max(0.2, _up.dot(w.contactNormal));
      _f.copy(_up).multiplyScalar(F);
      b.applyForceAt(_f, w.worldCenter);
    }

    // ---------- Engine & drivetrain ----------
    const ratio = this.ratio;
    const drivenWheels = this.wheels.filter(w => this.driven(w));
    let avgOmega = 0;
    for (const w of drivenWheels) avgOmega += w.omega;
    avgOmega /= drivenWheels.length;
    const wheelRpm = avgOmega * ratio * 60 / (2 * Math.PI);
    if (this.flooded && !this.wheels.some(w => w.inWater)) { /* stays off until restart */ }
    const intakeY = _p.copy(new Vec3(0, s.intakeHeight, 1.6)).applyQuaternion(q).add(b.pos).y;
    if (this.engineOn && intakeY < T.waterLevel) { this.engineOn = false; this.flooded = true; }
    if (this.fuel <= 0) this.engineOn = false;
    if (cond.engine >= 1) this.engineOn = false;
    // ---------- Engine temperature ----------
    if (this.engineOn) {
      const load = throttle * this.rpm / s.redlineRpm;
      const airflow = Math.min(this.speedKmh, 60) / 60 * 4 * (1 - cond.cooling);
      const target = 88 + 14 * load + cond.cooling * (15 + 55 * load) - airflow;
      this.engineTemp += (target - this.engineTemp) * Math.min(1, dt * 0.08);
      if (this.engineTemp > 118) cond.engine = Math.min(1, cond.engine + dt * 0.004 * (this.engineTemp - 118));
      if (this.engineTemp > 125) { this.engineOn = false; this.overheated = true; }
    } else this.engineTemp += (AMBIENT_C - this.engineTemp) * Math.min(1, dt * 0.012);
    // once cooled the driver can restart it
    if (this.overheated && this.engineTemp < 100) { this.overheated = false; if (this.canStart()) this.engineOn = true; }

    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const clutchRpm = s.idleRpm + throttle * 1100;
    const engaged = this.gear !== 0 && this.shiftTimer <= 0 && this.engineOn;
    let rpm: number;
    if (!this.engineOn) rpm = Math.max(0, Math.abs(wheelRpm) * (this.gear !== 0 ? 1 : 0));
    else if (!engaged || Math.abs(wheelRpm) < clutchRpm) rpm = Math.max(engaged ? Math.abs(wheelRpm) : 0, clutchRpm + (engaged ? 0 : throttle * 2800));
    else rpm = Math.abs(wheelRpm);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 12);

    let tq = 0;
    if (this.engineOn) {
      const limiter = 1 - smoothstep(s.redlineRpm - 150, s.redlineRpm + 80, Math.abs(wheelRpm));
      tq = this.torqueAt(this.rpm) * throttle * limiter * this.powerFactor();
      // engine braking when off-throttle and engaged
      tq -= (1 - throttle) * (25 + this.rpm * 0.018) * (Math.abs(wheelRpm) > s.idleRpm ? 1 : 0) * Math.sign(wheelRpm);
      this.fuel = Math.max(0, this.fuel - (0.00012 + throttle * this.rpm * 2.2e-7) * dt * 60);
    }
    this.engineTorque = engaged ? tq : 0;
    const shaft = engaged ? tq * ratio : 0; // torque at wheels, total
    const engInertiaPerWheel = engaged ? Math.min(s.engineInertia * ratio * ratio / drivenWheels.length, 14) : 0;

    // ---------- Automatic gearbox ----------
    if (this.automatic && this.gear > 0 && this.shiftTimer <= 0 && this.engineOn) {
      const up = Math.min(s.redlineRpm * (0.52 + 0.34 * throttle) + mode.shiftBias, s.redlineRpm - 150);
      const down = Math.max(s.idleRpm * 1.25, s.idleRpm * 1.6 + mode.shiftBias * 0.5);
      const minGear = this.driveMode === '4L' ? 1 : Math.min(mode.startGear, s.gears.length);
      if (this.gear < minGear) this.gear = minGear;
      const g = this.gear;
      if (Math.abs(wheelRpm) > up && g < s.gears.length && Math.abs(vFwd) > 1.5) { this.gear++; this.shiftTimer = 0.25; }
      else if (g > minGear) {
        const lowerRpm = Math.abs(wheelRpm) * s.gears[g - 2] / s.gears[g - 1];
        if (Math.abs(wheelRpm) < down && lowerRpm < up - 600) { this.gear--; this.shiftTimer = 0.2; }
      }
    }

    // ---------- Tyres ----------
    const mEff = s.mass / 4;
    this.absActive = false;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      const isDriven = this.driven(w);
      w.driveTorque = isDriven ? shaft / drivenWheels.length : 0;
      let service = (w.front ? s.brakeTorqueFront : s.brakeTorqueRear) * brake;
      // ABS: release a wheel that starts to lock (uses last step's slip) above walking pace
      if (mode.abs && service > 0 && w.contact && Math.abs(vFwd) > 1.5 && w.slipRatio * Math.sign(vFwd) < -0.15) { service *= 0.25; this.absActive = true; }
      // brake traction control: brake a wheel spinning much faster than its axle partner so the open diff drives the other
      if (mode.brakeTc && throttle > 0.1 && isDriven && w.contact && !this.diffLock) {
        const partner = this.wheels[wi ^ 1];
        const excess = Math.abs(w.slipRatio) - Math.abs(partner.slipRatio) - 0.25;
        if (excess > 0) { service += clamp(excess, 0, 1) * s.brakeTorqueFront * 0.5; this.tcActive = true; }
      }
      const bt = service + (!w.front ? s.handbrakeTorque * input.handbrake : 0);
      w.brakeTorque = bt;
      const I = s.wheelInertia + (isDriven ? engInertiaPerWheel : 0);
      const R = this.wheelRadiusOf(wi) - w.mudSink * 0.5;
      let Fx = 0, Fy = 0;
      if (w.contact && w.load > 0) {
        const sp = SURFACE_PROPS[w.surface];
        const n = w.contactNormal;
        // wheel heading projected onto ground plane
        _wf.copy(_fwd).applyAxisAngle(_up, -w.steer);
        _wf.addScaledVector(n, -_wf.dot(n)).normalize();
        _wl.crossVectors(n, _wf).normalize(); // points to vehicle's left (+X local)
        b.pointVelocity(w.contactPoint, _v);
        const vx = _v.dot(_wf), vy = _v.dot(_wl);
        const mu = sp.mu * s.tireGrip * (w.inWater ? 0.85 : 1) * (isPunctured(cond, wi) ? 0.6 : 1 - 0.12 * cond.tyres[wi]);
        const N = Math.min(w.load, s.mass * GRAVITY * 1.6);
        const maxF = mu * N;
        // Longitudinal: slip ratio with low-speed denominator
        const sv = w.omega * R - vx;
        // braked wheels near standstill behave like static friction (no viscous creep on slopes)
        const held = w.brakeTorque > 0 && Math.abs(w.omega) < 0.05;
        const denom = Math.max(Math.abs(vx), held ? 0.08 : 1.2);
        w.slipRatio = sv / denom;
        Fx = clamp(w.slipRatio * s.tireLongStiffness * sp.stiff, -1.2, 1.2) * N;
        const fZero = Math.abs(sv) / (dt * ((held ? 0 : R * R / I) + 1 / mEff)); // a held wheel cannot spin up, so the tyre alone stops the slide
        Fx = clamp(Fx, -fZero, fZero);
        // Lateral: slip angle
        w.slipAngle = Math.atan2(vy, Math.max(Math.abs(vx), held ? 0.3 : 1.5));
        Fy = -clamp(w.slipAngle * s.tireLatStiffness * sp.stiff, -1.15, 1.15) * N;
        const fyZero = Math.abs(vy) * mEff / dt;
        Fy = clamp(Fy, -fyZero, fyZero);
        // Friction circle (longitudinal prioritised slightly less than lateral)
        const tot = Math.hypot(Fx, Fy);
        if (tot > maxF) { Fx *= maxF / tot; Fy *= maxF / tot; }
        // Rolling resistance & mud drag
        const roll = sp.roll * N * Math.tanh(vx * 2);
        _f.copy(_wf).multiplyScalar(Fx - roll).addScaledVector(_wl, Fy);
        b.applyForceAt(_f, w.contactPoint);
        // wheel spin dynamics: reaction torque
        w.omega += ((w.driveTorque - Fx * R) / I) * dt;
      } else {
        w.slipRatio = 0; w.slipAngle = 0;
        w.omega += (w.driveTorque / I) * dt;
        w.omega *= 1 - 0.3 * dt; // bearing drag
      }
      // brakes: cannot reverse the wheel within a step
      const bImpulse = (w.brakeTorque / I) * dt;
      if (Math.abs(w.omega) <= bImpulse) w.omega = 0; else w.omega -= Math.sign(w.omega) * bImpulse;
    }

    // ---------- Differentials (speed constraints) ----------
    const W = this.wheels;
    const ie = (w: Wheel) => s.wheelInertia + (this.driven(w) ? engInertiaPerWheel : 0);
    const lockPair = (a: Wheel, c: Wheel) => { const ia = ie(a), ic = ie(c); const m = (a.omega * ia + c.omega * ic) / (ia + ic); a.omega = m; c.omega = m; };
    if (this.diffLock) { lockPair(W[0], W[1]); if (this.driveMode !== '2H' || true) lockPair(W[2], W[3]); }
    if (this.driveMode !== '2H') {
      // part-time 4WD: transfer case locks front & rear driveshaft speeds together
      const fAvg = (W[0].omega + W[1].omega) / 2, rAvg = (W[2].omega + W[3].omega) / 2;
      const If = ie(W[0]) + ie(W[1]), Ir = ie(W[2]) + ie(W[3]);
      const m = (fAvg * If + rAvg * Ir) / (If + Ir);
      W[0].omega += m - fAvg; W[1].omega += m - fAvg; W[2].omega += m - rAvg; W[3].omega += m - rAvg;
    }
    // Rev limit when not engaged in gear (free revving does not move wheels)
    for (const w of W) w.rotation += w.omega * dt;

    // ---------- Hull collisions (terrain, boulders, trees) ----------
    this.hullContact = false;
    this.terrain.query(b.pos.x, b.pos.z, 3.5, _qb, _qt);
    this.hullNowContact.fill(false);
    for (const k in this.stepImpact) this.stepImpact[k as BodyRegion] = Math.max(0, this.stepImpact[k as BodyRegion] - dt * 2);
    for (let hi = 0; hi < this.hullPoints.length; hi++) {
      const lp = this.hullPoints[hi];
      this.hullIndex = hi;
      _p.copy(lp).applyQuaternion(q).add(b.pos);
      // terrain
      const gh = T.heightAt(_p.x, _p.z);
      if (_p.y < gh) {
        const nn = T.normalAt(_p.x, _p.z);
        _n.set(nn[0], nn[1], nn[2]);
        this.contactForce(_p, _n, (gh - _p.y) * _n.y, 0.6);
      }
      if (Math.abs(b.pos.x) < 40 && Math.abs(b.pos.z) < 40) {
        const pen = T.boxPenetration(_p.x, _p.y, _p.z, 0, _nArr, this.hullBoxMem[hi]);
        if (pen > 0) { _n.set(_nArr[0], _nArr[1], _nArr[2]); this.contactForce(_p, _n, pen, 0.5); }
      }
      for (const i of _qb) {
        const bo = T.boulders[i];
        _n.set(_p.x - bo.x, _p.y - bo.y, _p.z - bo.z);
        const d = _n.length();
        if (d < bo.r && d > 1e-4) { _n.divideScalar(d); this.contactForce(_p, _n, bo.r - d, 0.7); }
      }
      for (const i of _qt) {
        const tr = T.trees[i];
        if (_p.y < tr.y - 0.5 || _p.y > tr.y + tr.h) continue;
        _n.set(_p.x - tr.x, 0, _p.z - tr.z);
        const d = _n.length();
        if (d < tr.r + 0.05 && d > 1e-4) { _n.divideScalar(d); this.contactForce(_p, _n, tr.r + 0.05 - d, 0.4); }
      }
    }
    this.hullIndex = -1;
    for (let hi = 0; hi < this.hullPoints.length; hi++) this.hullWasContact[hi] = this.hullNowContact[hi];
    // Wheels vs camp structures
    if (Math.abs(b.pos.x) < 40 && Math.abs(b.pos.z) < 40) for (let wi = 0; wi < 4; wi++) {
      const w = W[wi];
      const pen = T.boxPenetration(w.worldCenter.x, w.worldCenter.y, w.worldCenter.z, s.wheelRadius * 0.9, _nArr, this.wheelBoxMem[wi]);
      if (pen > 0) { _n.set(_nArr[0], _nArr[1], _nArr[2]); this.contactForce(w.worldCenter, _n, pen, 0.4); }
    }
    // Wheels vs trees (sideways blocking)
    for (const w of W) for (const i of _qt) {
      const tr = T.trees[i];
      _n.set(w.worldCenter.x - tr.x, 0, w.worldCenter.z - tr.z);
      const d = _n.length(), rr = tr.r + s.wheelRadius * 0.8;
      if (d < rr && d > 1e-4 && w.worldCenter.y < tr.y + tr.h) { _n.divideScalar(d); this.contactForce(w.worldCenter, _n, rr - d, 0.3); }
    }

    // ---------- Water: buoyancy + drag ----------
    let submerged = 0;
    for (const lp of this.hullPoints) {
      _p.copy(lp).applyQuaternion(q).add(b.pos);
      const depth = T.waterLevel - _p.y;
      if (depth > 0) {
        submerged++;
        b.pointVelocity(_p, _v);
        _f.copy(_v).multiplyScalar(-160 * Math.min(depth, 1));
        _f.y += Math.min(depth, 1.2) * 2200;
        b.applyForceAt(_f, _p);
      }
    }
    // ---------- Aerodynamic drag ----------
    const sp2 = b.vel.length();
    b.force.addScaledVector(b.vel, -s.dragCoef * sp2);

    b.integrate(dt, GRAVITY);

    // keep inside the region
    const lim = T.half - 6;
    if (Math.abs(b.pos.x) > lim) { b.pos.x = Math.sign(b.pos.x) * lim; b.vel.x *= -0.3; }
    if (Math.abs(b.pos.z) > lim) { b.pos.z = Math.sign(b.pos.z) * lim; b.vel.z *= -0.3; }

    // upside-down detection
    if (_up.y < 0.25 && sp2 < 2) this.upsideDownTimer += dt; else this.upsideDownTimer = 0;
    void submerged;
  }

  private hullIndex = -1;
  /** recent strongest hit per region (fades over ~0.5 s): several hull points, or the rebound of one crash, count once */
  private stepImpact: Record<BodyRegion, number> = { front: 0, rear: 0, left: 0, right: 0, roof: 0, under: 0 };

  /** Apply a hull impact (closing speed in m/s) to the condition model. */
  private registerImpact(lp: Vec3, speed: number) {
    const s = this.spec, cond = this.condition;
    const full = Math.min(1, (speed - IMPACT_THRESHOLD) / 12 / s.damageResistance);
    const region = regionOf(lp.x, lp.y, lp.z, s.halfExtents, s.hullOffsetY);
    const sev = full - this.stepImpact[region];
    if (sev <= 0.01) return;
    this.stepImpact[region] = full;
    cond.body[region] = Math.min(1, cond.body[region] + sev * 0.6);
    if (region === 'front') { cond.cooling = Math.min(1, cond.cooling + sev * 0.7); cond.engine = Math.min(1, cond.engine + sev * 0.2); }
    if (region === 'under') cond.engine = Math.min(1, cond.engine + sev * 0.12);
    if (region === 'left' || region === 'right') {
      // side hits bend the steering/suspension arms on the nearer axle
      const left = region === 'left', front = lp.z > 0;
      const wi = (front ? 0 : 2) + (left ? 0 : 1);
      cond.suspension[wi] = Math.min(1, cond.suspension[wi] + sev * 0.3);
    }
    this.onImpact?.({ point: lp.clone(), severity: sev, part: region, wheel: -1 });
  }

  /** Penalty contact with Coulomb friction. */
  private contactForce(p: Vec3, n: Vec3, pen: number, mu: number) {
    const b = this.body;
    this.hullContact = true;
    b.pointVelocity(p, _v);
    const vn = _v.dot(n);
    const hi = this.hullIndex;
    if (hi >= 0) {
      if (!this.hullWasContact[hi] && !this.hullNowContact[hi] && vn < -IMPACT_THRESHOLD && this.impactGrace <= 0) this.registerImpact(this.hullPoints[hi], -vn);
      this.hullNowContact[hi] = true;
    }
    const k = 260000, c = 22000;
    let Fn = k * pen - c * vn;
    if (Fn <= 0) return;
    Fn = Math.min(Fn, b.mass * 14);
    const f = new Vec3().copy(n).multiplyScalar(Fn);
    // tangential friction, velocity-capped
    const vt = _v.clone().addScaledVector(n, -vn);
    const vtl = vt.length();
    if (vtl > 1e-3) {
      const ft = Math.min(mu * Fn, (vtl * b.mass * 0.25) / (1 / 240));
      f.addScaledVector(vt, -ft / vtl);
    }
    b.applyForceAt(f, p);
  }
}


