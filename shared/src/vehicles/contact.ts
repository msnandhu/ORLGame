import { Vec3, Quat } from '../math/vec';
import type { Vehicle } from './vehicle';

/**
 * Vehicle-to-vehicle collisions. Each vehicle's hull points are tested against the other's hull box (an oriented
 * box); a point inside is pushed out through the nearest face with a penalty spring-damper, and the opposite force
 * goes to the other vehicle at the same point, so momentum is exchanged and both bodies spin and roll from off-centre
 * hits. A point that starts touching with a closing speed above the impact threshold dents and damages both
 * vehicles through their normal damage model (Vehicle.externalImpact), which is what wins a ramming takedown.
 *
 * Call `step()` once per fixed physics step, before the vehicles' own `step`.
 */
const _p = new Vec3(), _l = new Vec3(), _n = new Vec3(), _va = new Vec3(), _vb = new Vec3(), _f = new Vec3(), _c = new Vec3(), _q = new Quat(), _lb = new Vec3();

export interface ContactHit { a: Vehicle; b: Vehicle; speed: number; point: Vec3 }

export class VehicleContacts {
  /** hull points touching another vehicle last step: key = vehicle index * 1e4 + other index * 100 + point */
  private touching = new Set<number>();
  private now = new Set<number>();
  /** every new contact above the impact threshold this step (for sound, scoring and AI) */
  readonly hits: ContactHit[] = [];
  /** spring and damper of the contact (per point) */
  k = 220000; c = 18000;

  step(vehicles: readonly Vehicle[]) {
    this.hits.length = 0;
    this.now.clear();
    for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i], b = vehicles[j];
      const reach = a.spec.halfExtents[2] + b.spec.halfExtents[2] + 1.5;
      const dx = a.body.pos.x - b.body.pos.x, dz = a.body.pos.z - b.body.pos.z, dy = a.body.pos.y - b.body.pos.y;
      if (dx * dx + dz * dz > reach * reach || Math.abs(dy) > 6) continue;
      this.pair(a, i, b, j);
      this.pair(b, j, a, i);
    }
    const t = this.touching; this.touching = this.now; this.now = t;
  }

  /** Points of `a` inside `b`'s hull box. */
  private pair(a: Vehicle, ai: number, b: Vehicle, bi: number) {
    const [hx, hy, hz] = b.spec.halfExtents, oy = b.spec.hullOffsetY;
    _q.copy(b.body.quat).invert();
    const mMin = Math.min(a.body.mass, b.body.mass);
    for (let k = 0; k < a.hullPoints.length; k++) {
      _p.copy(a.hullPoints[k]).applyQuaternion(a.body.quat).add(a.body.pos);
      _l.copy(_p).sub(b.body.pos).applyQuaternion(_q);
      _l.y -= oy;
      const px = hx - Math.abs(_l.x), py = hy - Math.abs(_l.y), pz = hz - Math.abs(_l.z);
      if (px <= 0 || py <= 0 || pz <= 0) continue;
      // push out through the nearest face of b's box
      let pen: number;
      if (px < py && px < pz) { pen = px; _n.set(Math.sign(_l.x) || 1, 0, 0); }
      else if (pz < py) { pen = pz; _n.set(0, 0, Math.sign(_l.z) || 1); }
      else { pen = py; _n.set(0, Math.sign(_l.y) || 1, 0); }
      _n.applyQuaternion(b.body.quat);
      a.body.pointVelocity(_p, _va); b.body.pointVelocity(_p, _vb);
      const vn = _va.sub(_vb).dot(_n); // < 0: closing
      const key = ai * 10000 + bi * 100 + k;
      this.now.add(key);
      if (!this.touching.has(key) && vn < -4) {
        const speed = -vn;
        a.externalImpact(a.hullPoints[k], speed);
        _lb.copy(_l); _lb.y += oy;
        b.externalImpact(_lb.clone(), speed);
        this.hits.push({ a, b, speed, point: _p.clone() });
      }
      let Fn = this.k * pen - this.c * vn;
      if (Fn <= 0) continue;
      Fn = Math.min(Fn, mMin * 12);
      _f.copy(_n).multiplyScalar(Fn);
      // a little sliding friction between the bodies
      _c.copy(_va).addScaledVector(_n, -vn);
      const vt = _c.length();
      if (vt > 0.05) _f.addScaledVector(_c, -Math.min(0.3 * Fn, vt * mMin * 4) / vt);
      a.body.applyForceAt(_f, _p);
      _f.multiplyScalar(-1);
      b.body.applyForceAt(_f, _p);
    }
  }
}
