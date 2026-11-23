import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Quat, Vec3, clamp, type Terrain, type CameraMode } from '@orl/shared';

/**
 * Camera framework: chase / far chase / hood (driving), first-person (on foot or driver's seat) and a
 * free-fly camera. Mouse orbits, wheel zooms, the chase cameras recentre behind the vehicle when idle,
 * and the third-person cameras never sink below the terrain.
 */
export class CameraRig {
  readonly camera: UniversalCamera;
  yaw = 0; pitch = 0.28; distance = 7.5;
  mode: CameraMode = 'chase';
  sensitivity = 1; invertY = false;
  /** first-person eye height on foot (follows the character's stature and crouch) */
  eyeHeight = 1.62;
  private idle = 10;
  private pos = new Vector3(); private look = new Vector3(); private init = false;
  private free = new Vector3();

  constructor(scene: Scene, private terrain: Terrain) {
    this.camera = new UniversalCamera('cam', new Vector3(0, 20, -10), scene);
    this.camera.minZ = 0.1; this.camera.fov = 1.08;
    this.camera.inputs.clear(); // input is handled by the game's Input system
  }

  input(dx: number, dy: number, wheel: number, dt: number) {
    if (dx || dy) this.idle = 0; else this.idle += dt;
    this.yaw -= dx * 0.0025 * this.sensitivity;
    const fp = this.mode === 'first-person' || this.mode === 'hood' || this.mode === 'free';
    this.pitch = clamp(this.pitch + dy * 0.0025 * this.sensitivity * (this.invertY ? -1 : 1) * (fp ? -1 : 1), fp ? -1.3 : -0.35, fp ? 1.3 : 1.35);
    if (wheel && !fp) this.distance = clamp(this.distance * (1 + wheel * 0.1), 3, 25);
  }

  /** Cycle through the modes allowed in the current context. */
  cycle(inVehicle: boolean) {
    const order: CameraMode[] = inVehicle ? ['chase', 'far', 'hood', 'first-person'] : ['chase', 'first-person', 'free'];
    const i = order.indexOf(this.mode);
    this.mode = order[(i + 1) % order.length] ?? order[0];
    this.distance = this.mode === 'far' ? 13 : 7.5;
    if (this.mode === 'free') this.free.copyFrom(this.camera.position);
    if (this.mode === 'first-person' || this.mode === 'hood') this.pitch = 0;
    this.init = false;
  }
  /** Close orbit for the character creator: frames the whole figure, slightly off-centre to leave room for the panel. */
  portrait(target: Vec3, yaw: number, stature: number) {
    const cam = this.camera, d = 1.2 + stature * 0.85, fy = target.y + stature * 0.55;
    const pos = new Vector3(target.x + Math.sin(yaw) * d, fy + 0.25, target.z + Math.cos(yaw) * d);
    // shift the look point to the camera's right so the figure sits left of the panel
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    cam.position.copyFrom(pos); cam.setTarget(new Vector3(target.x, fy, target.z).add(right.scale(0.55)));
    cam.fov = 0.9; this.init = false;
  }
  /** Look direction yaw (0 = +Z). */
  get viewYaw() { const d = this.camera.getDirection(Vector3.Forward(true)); return Math.atan2(d.x, d.z); }

  update(dt: number, target: Vec3, heading: number, inVehicle: boolean, speed: number, q: Quat | null, freeMove?: { f: number; r: number; u: number; fast: boolean }) {
    const cam = this.camera;
    if (this.mode === 'free' && freeMove) {
      const lookYaw = this.yaw + Math.PI;
      const fwd = new Vector3(Math.sin(lookYaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(lookYaw) * Math.cos(this.pitch));
      const right = new Vector3(-Math.cos(lookYaw), 0, Math.sin(lookYaw));
      const sp = freeMove.fast ? 40 : 12;
      this.free.addInPlace(fwd.scale(freeMove.f * sp * dt)).addInPlace(right.scale(freeMove.r * sp * dt)); this.free.y += freeMove.u * sp * dt;
      this.free.y = Math.max(this.free.y, this.terrain.heightAt(this.free.x, this.free.z) + 0.5);
      cam.position.copyFrom(this.free); cam.setTarget(this.free.add(fwd)); return;
    }
    if (this.mode === 'first-person' || this.mode === 'hood') {
      let eye: Vector3, baseYaw: number, basePitch = 0;
      if (inVehicle && q) {
        const off = this.mode === 'hood' ? new Vec3(0, 0.75, 1.6) : new Vec3(0.42, 0.72, -0.35); // driver seat on the left (+X)
        off.applyQuaternion(q);
        eye = new Vector3(target.x + off.x, target.y + off.y, target.z + off.z);
        baseYaw = heading; const f = new Vec3(0, 0, 1).applyQuaternion(q); basePitch = -Math.asin(clamp(f.y, -1, 1));
      } else {
        eye = new Vector3(target.x, target.y + this.eyeHeight, target.z); baseYaw = heading; basePitch = 0;
      }
      // in a vehicle the mouse looks around relative to the vehicle; on foot it sets the heading
      const lookYaw = inVehicle ? baseYaw + (this.idle < 2 ? wrap(this.yaw - baseYaw - Math.PI) : 0) : this.yaw + Math.PI;
      if (inVehicle && this.idle >= 2) this.yaw += wrap(baseYaw + Math.PI - this.yaw) * Math.min(1, dt * 3);
      const pitch = (inVehicle ? basePitch : 0) + this.pitch;
      const dir = new Vector3(Math.sin(lookYaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(lookYaw) * Math.cos(pitch));
      cam.position.copyFrom(eye); cam.setTarget(eye.add(dir));
      cam.fov = 1.2;
      this.init = false; return;
    }
    if (inVehicle && this.idle > 1.5 && speed > 1.5) {
      this.yaw += wrap(heading + Math.PI - this.yaw) * Math.min(1, dt * 2);
      this.pitch += (0.22 - this.pitch) * Math.min(1, dt);
    }
    const dist = this.distance * (inVehicle ? 1 : 0.55);
    const focus = new Vector3(target.x, target.y + (inVehicle ? 1.4 : 1.6), target.z);
    const want = new Vector3(focus.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist, focus.y + Math.sin(this.pitch) * dist, focus.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
    const g = this.terrain.heightAt(want.x, want.z) + 0.6;
    if (want.y < g) want.y = g;
    if (!this.init) { this.pos.copyFrom(want); this.look.copyFrom(focus); this.init = true; }
    this.pos = Vector3.Lerp(this.pos, want, Math.min(1, dt * (inVehicle ? 10 : 14)));
    this.look = Vector3.Lerp(this.look, focus, Math.min(1, dt * 18));
    cam.position.copyFrom(this.pos); cam.setTarget(this.look);
    const fov = 1.08 + Math.min(0.2, speed * 0.006);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
  }
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
