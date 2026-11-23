import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { clamp } from '../core/noise';

export type CamMode = 'chase' | 'far' | 'hood';

/** Orbit/chase camera: mouse orbits, wheel zooms, auto-recentres behind the target when idle. */
export class GameCamera {
  yaw = 0; pitch = 0.28; distance = 7.5;
  mode: CamMode = 'chase';
  sensitivity = 1; invertY = false;
  private idle = 10;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private init = false;

  constructor(public cam: THREE.PerspectiveCamera, private terrain: Terrain) {}

  input(dx: number, dy: number, wheel: number, dt: number) {
    if (dx || dy) this.idle = 0; else this.idle += dt;
    this.yaw -= dx * 0.0025 * this.sensitivity;
    this.pitch = clamp(this.pitch + dy * 0.0025 * this.sensitivity * (this.invertY ? -1 : 1), -0.35, 1.35);
    if (wheel) this.distance = clamp(this.distance * (1 + wheel * 0.1), 3, 25);
  }
  cycleMode() { this.mode = this.mode === 'chase' ? 'far' : this.mode === 'far' ? 'hood' : 'chase'; this.distance = this.mode === 'far' ? 13 : 7.5; }

  /** target: point to orbit; heading: direction the target faces (for auto-follow); inVehicle toggles behaviour. */
  update(dt: number, target: THREE.Vector3, heading: number, inVehicle: boolean, speed: number, vehicleQuat?: THREE.Quaternion) {
    if (inVehicle && this.mode === 'hood' && vehicleQuat) {
      const off = new THREE.Vector3(0.38, 0.75, 0.15).applyQuaternion(vehicleQuat);
      this.cam.position.copy(target).add(off);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicleQuat);
      const yawOff = this.idle < 1.5 ? this.yaw - heading - Math.PI : 0;
      fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOff);
      this.cam.up.set(0, 1, 0);
      this.cam.lookAt(this.cam.position.clone().add(fwd).add(new THREE.Vector3(0, -0.05, 0)));
      this.init = false;
      return;
    }
    // auto recentre behind vehicle after idle, faster when moving
    if (inVehicle && this.idle > 1.5 && speed > 1.5) {
      const want = heading + Math.PI;
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 2.0);
      this.pitch += (0.22 - this.pitch) * Math.min(1, dt * 1.0);
    }
    const dist = this.distance * (inVehicle ? 1 : 0.55);
    const focus = target.clone().add(new THREE.Vector3(0, inVehicle ? 1.4 : 1.6, 0));
    const want = new THREE.Vector3(
      focus.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist,
      focus.y + Math.sin(this.pitch) * dist,
      focus.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
    // keep the camera above the ground
    const g = this.terrain.heightAt(want.x, want.z) + 0.6;
    if (want.y < g) want.y = g;
    if (!this.init) { this.pos.copy(want); this.look.copy(focus); this.init = true; }
    const k = Math.min(1, dt * (inVehicle ? 10 : 14));
    this.pos.lerp(want, k);
    this.look.lerp(focus, Math.min(1, dt * 18));
    this.cam.position.copy(this.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.look);
    // speed-based FOV for sense of speed
    const fov = 62 + Math.min(12, speed * 0.35);
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov += (fov - this.cam.fov) * Math.min(1, dt * 3); this.cam.updateProjectionMatrix(); }
  }
}
