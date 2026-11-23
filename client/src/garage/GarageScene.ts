import { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vehicle, Quat, type VehicleSpec, type Terrain } from '@orl/shared';
import { VehicleView } from '../vehicles/VehicleView';
import { Environment } from '../rendering/Environment';
import { PRESETS } from '../config/settings';
import type { GraphicsQuality } from '@orl/shared';

/**
 * The garage's own 3D scene: a workshop bay with a turntable. The vehicle on it is built by the same VehicleView as in
 * the world, from the spec as built (applyBuild), standing at its real static ride height, so a lift kit, bigger tyres or
 * a new wing look exactly as they will on the road. Orbit with the mouse (drag, wheel) to inspect it from every side.
 */
export class GarageScene {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private env: Environment;
  private sim: Vehicle | null = null;
  private view: VehicleView | null = null;
  private yaw = -0.6;
  private idle = 0;
  /** turntable turns on its own until the player grabs the camera */
  spin = true;

  constructor(engine: AbstractEngine, private canvas: HTMLCanvasElement, quality: GraphicsQuality) {
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    this.scene = scene;
    const cam = new ArcRotateCamera('garage-cam', 0.9, 1.25, 11, new Vector3(0, 0.75, 0), scene);
    cam.lowerRadiusLimit = 3; cam.upperRadiusLimit = 15; cam.lowerBetaLimit = 0.25; cam.upperBetaLimit = 1.52;
    cam.wheelPrecision = 40; cam.panningSensibility = 0; cam.minZ = 0.05; cam.maxZ = 4000;
    // the panels cover the right of the screen: frame the car left of centre
    cam.targetScreenOffset.set(-1.5, 0);
    this.camera = cam;
    this.env = new Environment(scene, cam);
    this.env.apply({ ...PRESETS[quality], shadows: PRESETS[quality].shadows === 'off' ? 'off' : 'basic', fogEnd: 4000, haze: 0 });
    scene.fogDensity = 0;
    this.buildStudio();
  }

  private buildStudio() {
    const s = this.scene;
    const mat = (n: string, c: Color3, r: number, m = 0) => { const x = new PBRMaterial(n, s); x.albedoColor = c; x.roughness = r; x.metallic = m; return x; };
    // polished concrete floor, dark epoxy turntable with a steel rim
    const floor = MeshBuilder.CreateDisc('garage-floor', { radius: 40, tessellation: 64 }, s);
    floor.rotation.x = Math.PI / 2; floor.material = mat('garage-concrete', new Color3(0.23, 0.23, 0.24), 0.42); floor.receiveShadows = true;
    const table = MeshBuilder.CreateCylinder('turntable', { diameter: 7.4, height: 0.06, tessellation: 96 }, s);
    table.position.y = 0.03; table.material = mat('turntable', new Color3(0.06, 0.065, 0.07), 0.25, 0.3); table.receiveShadows = true;
    const rim = MeshBuilder.CreateTorus('turntable-rim', { diameter: 7.42, thickness: 0.05, tessellation: 96 }, s);
    rim.position.y = 0.055; rim.material = mat('turntable-steel', new Color3(0.7, 0.71, 0.73), 0.2, 1);
    // safety line round the bay
    const line = MeshBuilder.CreateTorus('bay-line', { diameter: 10, thickness: 0.08, tessellation: 96 }, s);
    line.position.y = 0.004; line.scaling.y = 0.05; line.material = mat('bay-yellow', new Color3(0.85, 0.62, 0.05), 0.6);
    // cyclorama wall behind the car (curved, so there is no corner), with a band of light along the top
    const wall = MeshBuilder.CreateCylinder('cyclorama', { diameter: 30, height: 9, tessellation: 96, arc: 0.6, sideOrientation: Mesh.BACKSIDE, enclose: false }, s);
    wall.position.y = 4.5; wall.rotation.y = Math.PI * 0.45; wall.material = mat('cyc', new Color3(0.36, 0.37, 0.38), 0.85);
    wall.receiveShadows = true;
    const strip = mat('light-strip', new Color3(1, 1, 1), 0.5); strip.emissiveColor = new Color3(1, 0.97, 0.92); strip.emissiveIntensity = 1.6;
    for (let i = -2; i <= 2; i++) {
      const b = MeshBuilder.CreateBox('ceiling-light', { width: 0.25, height: 0.05, depth: 5 }, s);
      b.position.set(i * 1.6, 6.2, 0); b.material = strip;
    }
    // workshop dressing: tool chests and a tyre stack at the back of the bay
    const red = mat('tool-chest', new Color3(0.55, 0.05, 0.04), 0.35, 0.3), steel = mat('chest-steel', new Color3(0.6, 0.6, 0.62), 0.3, 0.9), rubber = mat('tyre-stack', new Color3(0.03, 0.03, 0.03), 0.9);
    for (const [x, z, r] of [[-8.5, -9.5, 0.5], [-6.8, -10.6, 0.45]] as const) {
      const c = MeshBuilder.CreateBox('chest', { width: 1.5, height: 1.0, depth: 0.6 }, s); c.position.set(x, 0.5, z); c.rotation.y = r; c.material = red;
      const t = MeshBuilder.CreateBox('chest-top', { width: 1.52, height: 0.04, depth: 0.62 }, s); t.position.set(x, 1.02, z); t.rotation.y = r; t.material = steel;
    }
    for (let i = 0; i < 4; i++) { const t = MeshBuilder.CreateTorus('tyre', { diameter: 0.78, thickness: 0.26, tessellation: 28 }, s); t.position.set(8.4, 0.13 + i * 0.26, -9.4); t.material = rubber; }
    // studio lights: soft key and fill from above
    const key = new PointLight('garage-key', new Vector3(3, 5.5, 4), s); key.intensity = 60; key.diffuse = new Color3(1, 0.97, 0.92); key.range = 30;
    const fill = new PointLight('garage-fill', new Vector3(-4, 5, -3), s); fill.intensity = 35; fill.diffuse = new Color3(0.85, 0.9, 1); fill.range = 30;
  }

  /** Put a vehicle (as built) on the turntable. */
  show(spec: VehicleSpec) {
    if (this.view) { for (const m of this.view.meshes) this.env.removeShadowCaster(m); this.view.dispose(); }
    const v = new Vehicle(spec, {} as Terrain);
    const sag = (spec.mass * 9.81 / 4) / spec.springRate;
    for (const w of v.wheels) w.compression = sag;
    // the body floats at its static ride height above the turntable top
    v.body.pos.set(0, 0.06 - (spec.mountY - spec.restLength + sag - spec.wheelRadius), 0);
    const view = new VehicleView(this.scene, v);
    for (const m of view.meshes) this.env.addShadowCaster(m);
    this.sim = v; this.view = view;
    this.camera.target.set(0, Math.max(0.6, v.body.pos.y * 0.9), 0);
    this.place();
  }

  /** Lights on or off (to check the driving lamps). */
  setLights(on: boolean) { this.view?.setHeadlights(on); }

  private place() {
    const v = this.sim, view = this.view; if (!v || !view) return;
    v.body.quat.copy(new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, this.yaw));
    view.sync();
  }

  attach() { this.camera.attachControl(this.canvas, true); this.idle = 0; }
  detach() { this.camera.detachControl(); }

  render(dt: number, grabbing: boolean) {
    if (grabbing) this.idle = 0; else this.idle += dt;
    if (this.spin && this.idle > 2.5) { this.yaw += dt * 0.25; this.place(); }
    this.env.follow(Vector3.Zero());
    // a tight shadow frustum: the whole bay is ~25 m across
    const l = this.env.sun; l.orthoLeft = -14; l.orthoRight = 14; l.orthoTop = 14; l.orthoBottom = -14;
    this.scene.render();
  }
}
