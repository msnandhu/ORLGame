import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vehicle, Quat, type Terrain, type Traffic, type TrafficCar, type VehicleSpec } from '@orl/shared';
import { VehicleView } from '../vehicles/VehicleView';

interface Slot { view: VehicleView; sim: Vehicle; car: TrafficCar | null; spec: VehicleSpec }

const _qy = new Quat(), _qp = new Quat();

/**
 * Draws the AI traffic near the camera with a small pool of simplified car models per type (the same original
 * bodies as the drivable cars, merged into a few draw calls). Far cars still drive; they just aren't drawn.
 */
export class TrafficRenderer {
  readonly slots: Slot[] = [];
  range = 420;

  constructor(scene: Scene, terrain: Terrain, private traffic: Traffic, pool: { spec: VehicleSpec; n: number }[]) {
    for (const { spec, n } of pool) for (let i = 0; i < n; i++) {
      const sim = new Vehicle(spec, terrain);
      const sag = (spec.mass * 9.81 / 4) / spec.springRate;
      for (const w of sim.wheels) w.compression = sag;
      const view = new VehicleView(scene, sim, undefined, true);
      view.root.setEnabled(false);
      this.slots.push({ view, sim, car: null, spec });
    }
  }

  get meshes() { return this.slots.flatMap(s => s.view.meshes); }

  update(cam: Vector3, dt: number) {
    const near = this.traffic.cars
      .map(c => ({ c, d: Math.hypot(c.x - cam.x, c.z - cam.z) }))
      .filter(e => e.d < this.range)
      .sort((a, b) => a.d - b.d);
    const keep = new Set<TrafficCar>();
    // keep existing assignments for cars still in range, then fill free slots nearest-first
    const free = new Map<VehicleSpec, Slot[]>();
    for (const s of this.slots) {
      if (s.car && near.some(e => e.c === s.car)) keep.add(s.car);
      else { s.car = null; let l = free.get(s.spec); if (!l) { l = []; free.set(s.spec, l); } l.push(s); }
    }
    for (const { c } of near) {
      if (keep.has(c)) continue;
      const s = free.get(c.spec)?.pop();
      if (!s) continue;
      s.car = c; s.view.setPaint(new Color3(...c.paint));
    }
    for (const s of this.slots) {
      const c = s.car;
      s.view.root.setEnabled(!!c);
      if (!c) continue;
      const b = s.sim.body;
      b.pos.set(c.x, c.y, c.z);
      // yaw about +Y, then the road's pitch (nose up is a negative rotation about +X)
      _qy.setFromAxisAngle({ x: 0, y: 1, z: 0 }, c.yaw); _qp.setFromAxisAngle({ x: 1, y: 0, z: 0 }, -c.pitch);
      b.quat.copy(_qy).multiply(_qp);
      s.sim.wheels.forEach((w, i) => { w.steer = i < 2 ? c.steer : 0; w.rotation += (c.v / s.spec.wheelRadius) * dt; });
      s.sim.lastInput = { throttle: 0, brake: c.v < 0.5 || c.shaken > 0 ? 1 : 0, steer: 0, handbrake: 0 };
      s.view.sync();
    }
  }
}
