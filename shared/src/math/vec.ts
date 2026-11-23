/**
 * Renderer-independent vector / quaternion math used by the shared simulation (client + server).
 * The method names mirror the subset of the common 3D-math API the simulation needs, so the
 * physics code is identical on both sides of the network.
 */
export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: Vec3Like) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v: Vec3Like) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: Vec3Like) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v: Vec3Like, s: number) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  subVectors(a: Vec3Like, b: Vec3Like) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiply(v: Vec3Like) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s: number) { return this.multiplyScalar(1 / s); }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  dot(v: Vec3Like) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v: Vec3Like) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  cross(v: Vec3Like) { return this.crossVectors(this, v); }
  crossVectors(a: Vec3Like, b: Vec3Like) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx; return this;
  }
  applyQuaternion(q: Quat) {
    const { x, y, z } = this, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  applyAxisAngle(axis: Vec3Like, angle: number) { return this.applyQuaternion(_q.setFromAxisAngle(axis, angle)); }
  lerp(v: Vec3Like, t: number) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  toArray(): [number, number, number] { return [this.x, this.y, this.z]; }
}
export interface Vec3Like { x: number; y: number; z: number }

export class Quat {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q: Quat) { return this.set(q.x, q.y, q.z, q.w); }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }
  setFromAxisAngle(a: Vec3Like, angle: number) {
    const h = angle / 2, s = Math.sin(h);
    return this.set(a.x * s, a.y * s, a.z * s, Math.cos(h));
  }
  invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  /** this = this * q */
  multiply(q: Quat) { return this.multiplyQuaternions(this, q); }
  multiplyQuaternions(a: Quat, b: Quat) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
  normalize() { const l = Math.hypot(this.x, this.y, this.z, this.w) || 1; this.x /= l; this.y /= l; this.z /= l; this.w /= l; return this; }
  /** Yaw (rotation about +Y) of the +Z forward axis. */
  yaw() { const f = new Vec3(0, 0, 1).applyQuaternion(this); return Math.atan2(f.x, f.z); }
}
const _q = new Quat();
