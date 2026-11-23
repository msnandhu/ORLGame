import { Vector3, Quaternion } from 'three';

/** Minimal 6-DOF rigid body with semi-implicit Euler integration. */
export class RigidBody {
  pos = new Vector3();
  quat = new Quaternion();
  vel = new Vector3();
  angVel = new Vector3();
  force = new Vector3();
  torque = new Vector3();
  readonly invInertiaBody: Vector3;
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(public mass: number, inertia: Vector3) {
    this.invInertiaBody = new Vector3(1 / inertia.x, 1 / inertia.y, 1 / inertia.z);
  }

  /** Apply world-space force at world-space point. */
  applyForceAt(f: Vector3, p: Vector3) {
    this.force.add(f);
    this.tmp.subVectors(p, this.pos).cross(f);
    this.torque.add(this.tmp);
  }

  pointVelocity(p: Vector3, out: Vector3): Vector3 {
    out.subVectors(p, this.pos);
    out.crossVectors(this.angVel, out);
    return out.add(this.vel);
  }

  /** World-space inverse inertia applied to vector v (in place). */
  applyInvInertia(v: Vector3): Vector3 {
    // local = R^T v ; scale ; world = R local
    const q = this.quat;
    this.tmp2.copy(v).applyQuaternion(this.tmpQ.copy(q).invert());
    this.tmp2.multiply(this.invInertiaBody);
    return v.copy(this.tmp2.applyQuaternion(q));
  }
  private tmpQ = new Quaternion();
  private tmp3 = new Vector3();
  private dq = new Quaternion();

  /** Effective mass seen along direction n at world point p. */
  effectiveMass(p: Vector3, n: Vector3): number {
    const r = this.tmp.subVectors(p, this.pos);
    const rn = this.tmp3.crossVectors(r, n);
    this.applyInvInertia(rn);
    const k = 1 / this.mass + n.dot(rn.cross(r));
    return 1 / k;
  }

  integrate(dt: number, gravity: number) {
    this.vel.addScaledVector(this.force, dt / this.mass);
    this.vel.y -= gravity * dt;
    this.applyInvInertia(this.torque);
    this.angVel.addScaledVector(this.torque, dt);
    // light angular damping for numerical robustness
    this.angVel.multiplyScalar(1 - 0.05 * dt);
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel;
    const q = this.quat;
    const dq = this.dq.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(q);
    q.set(q.x + dq.x, q.y + dq.y, q.z + dq.z, q.w + dq.w).normalize();
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}
