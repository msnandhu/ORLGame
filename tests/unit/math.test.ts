import { describe, it, expect } from 'vitest';
import { Vec3, Quat } from '@orl/shared';

describe('shared math', () => {
  it('rotates +Z by +90° about Y to +X', () => {
    const v = new Vec3(0, 0, 1).applyQuaternion(new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2));
    expect(v.x).toBeCloseTo(1); expect(v.z).toBeCloseTo(0);
  });
  it('quaternion inverse undoes rotation', () => {
    const q = new Quat().setFromAxisAngle(new Vec3(1, 2, 3).normalize(), 0.7);
    const v = new Vec3(0.3, -1, 2).applyQuaternion(q).applyQuaternion(q.clone().invert());
    expect(v.x).toBeCloseTo(0.3); expect(v.y).toBeCloseTo(-1); expect(v.z).toBeCloseTo(2);
  });
  it('composes rotations in the right order', () => {
    const a = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const b = new Quat().setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    // (a*b) applied = a(b(v)): b takes +Z to -Y, a leaves -Y
    const v = new Vec3(0, 0, 1).applyQuaternion(a.clone().multiply(b));
    expect(v.y).toBeCloseTo(-1);
  });
  it('cross product is right-handed', () => {
    const c = new Vec3(1, 0, 0).cross(new Vec3(0, 1, 0));
    expect(c.z).toBeCloseTo(1);
  });
});
