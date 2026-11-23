import { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Terrain, Vehicle, Character, RANGER_TX4, WORLD_SEED, PHYSICS_HZ, Vec3, Quat, type Settings, type PlayerTransform } from '@orl/shared';
import { createEngine, type Backend } from '../engine/createEngine';
import { AssetManager } from '../assets/AssetManager';
import { detailTextures, type RawImage } from '../assets/proceduralTextures';
import { terrainLayers } from '../assets/terrainTextures';
import { HavokWorld, type HavokModule } from '../physics/HavokWorld';
import { Environment } from '../rendering/Environment';
import { WheelParticles } from '../rendering/WheelParticles';
import { TerrainRenderer } from '../world/TerrainRenderer';
import { PropsRenderer } from '../world/PropsRenderer';
import { Scenery } from '../world/Scenery';
import { GrassField } from '../world/GrassField';
import { VehicleView } from '../vehicles/VehicleView';
import { CharacterView } from '../characters/CharacterView';
import { CameraRig } from '../cameras/CameraRig';
import { Input } from '../input/Input';
import { Hud } from '../ui/Hud';
import { EngineAudio } from '../audio/EngineAudio';
import { NetClient } from '../multiplayer/NetClient';
import { SaveGame } from '../save/SaveGame';
import { PRESETS, saveSettings } from '../config/settings';
import { log } from './logger';
import { markStarted } from './errors';

const $ = (id: string) => document.getElementById(id)!;
const SPAWN = { vx: -4, vz: 4, vh: 0.4, px: 1, pz: -2, ph: -2.4 };

/** Owns the engine, scene and every game system, and runs the frame loop. */
export class GameApp {
  engine!: AbstractEngine; backend!: Backend; scene!: Scene;
  terrain!: Terrain; physics: HavokWorld | null = null;
  vehicle!: Vehicle; player!: Character;
  vView!: VehicleView; cView!: CharacterView; rig!: CameraRig; env!: Environment;
  terrainR!: TerrainRenderer; props!: PropsRenderer; grass!: GrassField; scenery!: Scenery; particles!: WheelParticles;
  hud!: Hud; input!: Input; audio = new EngineAudio(); net = new NetClient();
  private remoteViews = new Map<string, { v: VehicleView; c: CharacterView; sim: Vehicle; ch: Character }>();
  inVehicle = false; paused = false; started = false;
  private acc = 0; private refuel = 0; private playTime = 0;
  private fpsAcc = 0; private fpsFrames = 0; private fps = 60; private scaling = 1; private adaptTimer = 0;

  constructor(private canvas: HTMLCanvasElement, public settings: Settings) {}

  async init(onProgress: (f: number, label: string) => void) {
    const { engine, backend } = await createEngine(this.canvas, this.settings.preferWebGPU);
    this.engine = engine; this.backend = backend;
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true; // matches the shared simulation's coordinate frame
    this.scene = scene;
    const assets = new AssetManager();
    assets.onProgress = onProgress;
    assets.add('Havok physics', async () => {
      try {
        const [{ default: HavokPhysics }, { default: wasmUrl }] = await Promise.all([import('@babylonjs/havok'), import('@babylonjs/havok/lib/esm/HavokPhysics.wasm?url')]);
        return await HavokPhysics({ locateFile: () => wasmUrl }) as HavokModule;
      } catch (e) { log.warn('physics', 'Havok unavailable; continuing without dynamic props', e); return null; }
    }, 2);
    assets.add('Terrain generation', () => new Terrain(WORLD_SEED), 4);
    assets.add('Terrain textures', () => detailTextures(), 1);
    assets.add('Terrain materials', () => terrainLayers(), 3);
    await assets.loadAll();
    this.terrain = assets.get<Terrain>('Terrain generation');

    onProgress(0.75, 'Building world');
    await tick();
    this.rig = new CameraRig(scene, this.terrain);
    this.env = new Environment(scene, this.rig.camera);
    const hk = assets.get<HavokModule | null>('Havok physics');
    if (hk) { this.physics = new HavokWorld(scene, hk); this.physics.buildStatic(this.terrain); this.physics.addProxy('vehicle', new Vector3(1.9, 1.3, 4.6)); this.physics.addProxy('player', new Vector3(0.6, 1.8, 0.6)); }
    this.terrainR = new TerrainRenderer(scene, this.terrain, assets.get('Terrain textures'), assets.get('Terrain materials'));
    onProgress(0.85, 'Planting trees');
    await tick();
    this.props = new PropsRenderer(scene, this.terrain);
    this.grass = new GrassField(scene, this.terrain);
    this.scenery = new Scenery(scene, this.terrain, this.physics, assets.get<{ normal: RawImage }>('Terrain textures').normal);
    this.vehicle = new Vehicle(RANGER_TX4, this.terrain);
    this.player = new Character(this.terrain);
    this.vView = new VehicleView(scene, this.vehicle);
    this.cView = new CharacterView(scene);
    this.particles = new WheelParticles(scene, this.vehicle);
    for (const m of [...this.props.casters, ...this.scenery.casters, ...this.vView.meshes, ...this.cView.meshes]) this.env.addShadowCaster(m);
    this.applyGraphics();
    this.input = new Input(this.canvas);
    this.hud = new Hud(this.terrain);
    this.rig.sensitivity = this.settings.mouseSensitivity; this.rig.invertY = this.settings.invertY; this.audio.setVolume(this.settings.volume);
    this.net.onCorrection = c => { const p = this.inVehicle ? null : this.player; if (p) p.place(c.x, c.z); else this.vehicle.reset(c.x, c.z, this.vehicle.body.quat.yaw()); this.hud.toast('Position corrected by server'); };
    this.net.onChat = c => this.hud.toast(`${c.from}: ${c.text}`);
    this.newGame(false);
    onProgress(0.95, 'Compiling shaders');
    await scene.whenReadyAsync();
    $('backend-info').textContent = `Renderer: ${this.backend}${this.physics ? ' · Havok physics' : ' · physics props off'} · ${this.terrain.size} m region`;
    log.info('app', `World ready: ${this.backend}, ${scene.meshes.length} meshes`);
    engine.runRenderLoop(() => this.frame());
    addEventListener('resize', () => engine.resize());
    (window as unknown as Record<string, unknown>).__game = this;
  }

  newGame(fromSave: boolean) {
    const s = fromSave ? SaveGame.read() : null;
    if (s) {
      this.vehicle.reset(s.vehicle.x, s.vehicle.z, s.vehicle.heading);
      this.vehicle.fuel = s.vehicle.fuel; this.vehicle.driveMode = s.vehicle.driveMode; this.vehicle.automatic = s.vehicle.automatic; this.vehicle.diffLock = s.vehicle.diffLock;
      this.player.place(s.player.x, s.player.z); this.player.heading = s.player.heading; this.playTime = s.playTimeSec;
    } else {
      this.vehicle.fuel = this.vehicle.spec.fuelCapacity;
      this.vehicle.reset(SPAWN.vx, SPAWN.vz, SPAWN.vh);
      this.player.place(SPAWN.px, SPAWN.pz); this.player.heading = SPAWN.ph; this.playTime = 0;
    }
    for (let i = 0; i < 480; i++) this.vehicle.step(1 / PHYSICS_HZ, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    this.inVehicle = false; this.cView.setVisible(true); this.rig.mode = 'chase';
    if (s?.inVehicle) this.enterVehicle();
    this.rig.yaw = this.player.heading + Math.PI;
  }

  save() { const ok = SaveGame.write(SaveGame.capture(this.vehicle, this.player, this.inVehicle, this.playTime)); this.hud.toast(ok ? 'Game saved' : 'Could not save (browser storage blocked)'); }

  start() { this.started = true; markStarted(); this.audio.start(); this.canvas.requestPointerLock?.(); }

  applyGraphics() {
    const p = PRESETS[this.settings.graphics];
    this.scaling = p.hardwareScaling; this.engine.setHardwareScalingLevel(this.scaling);
    this.env.apply(p);
    this.terrainR.viewDistance = p.viewDistance; this.props.viewDistance = Math.min(p.viewDistance, 1400);
    this.props.setDensity(p.treeDensity); this.grass.setDensity(p.grassDensity); this.particles.budget = p.particles;
    saveSettings(this.settings);
  }

  // ---------------- gameplay ----------------
  private driverDoor() { return new Vec3(1.4, 0, 0.2).applyQuaternion(this.vehicle.body.quat).add(this.vehicle.body.pos); }
  private canEnter() { const d = this.driverDoor(); return Math.hypot(this.player.pos.x - d.x, this.player.pos.z - d.z) < 2.6 || this.player.pos.distanceTo(this.vehicle.body.pos) < 3.2; }
  enterVehicle() {
    this.inVehicle = true; this.cView.setVisible(false);
    this.rig.yaw = this.vehicle.body.quat.yaw() + Math.PI;
    if (this.rig.mode === 'free') this.rig.mode = 'chase';
    if (!this.vehicle.engineOn && this.vehicle.fuel > 0 && !this.vehicle.flooded) this.vehicle.engineOn = true;
    this.hud.toast(`${this.vehicle.spec.name} · ${this.vehicle.driveMode}`);
  }
  exitVehicle() {
    const v = this.vehicle;
    if (v.speedKmh > 12) { this.hud.toast('Slow down to exit'); return; }
    for (const o of [new Vec3(1.6, 0, 0.2), new Vec3(-1.6, 0, 0.2), new Vec3(0, 0, -3.2), new Vec3(0, 0, 3.2)]) {
      const p = o.applyQuaternion(v.body.quat).add(v.body.pos);
      if (this.terrain.waterDepthAt(p.x, p.z) > 1) continue;
      this.player.place(p.x, p.z); this.player.heading = v.body.quat.yaw();
      this.inVehicle = false; this.cView.setVisible(true);
      if (this.rig.mode === 'far' || this.rig.mode === 'hood') this.rig.mode = 'chase';
      return;
    }
    this.hud.toast('No safe place to exit');
  }

  private frame() {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    const inp = this.input, v = this.vehicle, T = this.terrain;
    inp.pollGamepad();
    this.trackFps(dt);
    if (this.started) this.handleGlobalKeys();
    if (this.started && !this.paused) {
      this.playTime += dt;
      const gp = inp.gamepad;
      let mdx = inp.mouseDX, mdy = inp.mouseDY;
      if (gp) { mdx += inp.padAxis(2) * 900 * dt; mdy += inp.padAxis(3) * 600 * dt; }
      this.rig.input(mdx, mdy, inp.wheel, dt);
      if (inp.wasPressed('KeyV')) { this.rig.cycle(this.inVehicle); this.hud.toast(`Camera: ${this.rig.mode}`); }
      const enter = inp.wasPressed('KeyE') || inp.padPressed.has(3);
      const fixed = 1 / PHYSICS_HZ;
      this.acc += dt;
      let steps = 0;
      if (this.inVehicle) {
        if (inp.wasPressed('KeyG')) { v.toggleDriveMode(); this.hud.toast(`Drive mode ${v.driveMode}${v.driveMode === '4L' ? ' (low range)' : ''}`); }
        if (inp.wasPressed('KeyL')) { v.diffLock = !v.diffLock; this.hud.toast(v.diffLock ? 'Diff lock ON' : 'Diff lock OFF'); }
        if (inp.wasPressed('KeyT')) { v.automatic = !v.automatic; if (v.automatic && v.gear === 0) v.gear = 1; this.hud.toast(v.automatic ? 'Automatic transmission' : 'Manual transmission (X/Z to shift)'); }
        if (!v.automatic && (inp.wasPressed('KeyX') || inp.padPressed.has(5))) v.shiftUp();
        if (!v.automatic && (inp.wasPressed('KeyZ') || inp.padPressed.has(4))) v.shiftDown();
        if (inp.wasPressed('KeyN')) this.vView.setHeadlights(!this.vView.headlightsOn);
        if (inp.wasPressed('KeyR')) { v.recover(); this.hud.toast('Vehicle recovered'); }
        const nearPump = Math.hypot(v.body.pos.x - T.fuelPump.x, v.body.pos.z - T.fuelPump.z) < 6;
        if (nearPump && inp.isDown('KeyF') && v.speedKmh < 3) { v.fuel = Math.min(v.spec.fuelCapacity, v.fuel + 12 * dt); this.refuel = 0.3; if (!v.engineOn && !v.flooded) v.engineOn = true; }
        if (this.refuel > 0) this.refuel -= dt;
        this.hud.prompt(nearPump ? (this.refuel > 0 ? `Refuelling… ${Math.round(v.fuel)} L` : 'Hold F to refuel') :
          v.flooded ? 'Engine flooded: press R to recover' : v.fuel <= 0 ? 'Out of fuel: pause menu → Return to base camp' :
          v.upsideDownTimer > 1.5 ? 'Vehicle stuck: press R to recover' : null);
        if (enter) this.exitVehicle();
        const ctl = { throttle: inp.isDown('KeyW') || inp.isDown('ArrowUp') ? 1 : 0, brake: inp.isDown('KeyS') || inp.isDown('ArrowDown') ? 1 : 0, steer: inp.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), handbrake: inp.isDown('Space') ? 1 : 0 };
        if (gp) { ctl.throttle = Math.max(ctl.throttle, inp.padButton(7)); ctl.brake = Math.max(ctl.brake, inp.padButton(6)); if (inp.padAxis(0)) ctl.steer = inp.padAxis(0); ctl.handbrake = Math.max(ctl.handbrake, inp.padButton(0)); }
        while (this.acc >= fixed && steps < 14) { v.step(fixed, ctl); this.acc -= fixed; steps++; }
        this.player.pos.copy(v.body.pos);
      } else {
        while (this.acc >= fixed && steps < 14) { v.step(fixed, { throttle: 0, brake: 0, steer: 0, handbrake: 1 }); this.acc -= fixed; steps++; }
        const free = this.rig.mode === 'free';
        const fwd = free ? 0 : inp.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) || -inp.padAxis(1);
        const right = free ? 0 : inp.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) || inp.padAxis(0);
        this.player.update(dt, { forward: fwd, right, sprint: inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') || inp.padButton(10) > 0.5, jump: !free && (inp.wasPressed('Space') || inp.padPressed.has(0)), crouch: inp.isDown('KeyC') || inp.padButton(1) > 0.5, camYaw: this.rig.yaw + Math.PI },
          [{ cx: v.body.pos.x, cz: v.body.pos.z, hx: 0.95, hz: 2.35, yaw: v.body.quat.yaw(), top: v.body.pos.y + 1.2 }]);
        if (this.rig.mode === 'first-person') this.player.heading = this.rig.yaw + Math.PI;
        const ce = this.canEnter();
        this.hud.prompt(ce ? `Press E to drive the ${v.spec.name}` : null);
        if (enter && ce) this.enterVehicle();
      }
      if (steps >= 14) this.acc = 0;
      // kinematic proxies so Havok props react to the custom-simulated vehicle and player
      this.physics?.moveProxy('vehicle', v.body.pos.x, v.body.pos.y + 0.25, v.body.pos.z, v.body.quat, dt);
      const pq = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, this.player.heading);
      if (!this.inVehicle) this.physics?.moveProxy('player', this.player.pos.x, this.player.pos.y + 0.9, this.player.pos.z, pq, dt);
      else this.physics?.moveProxy('player', 0, -500, 0, pq, dt);
      this.particles.update();
      const slip = v.wheels.reduce((a, w) => a + (w.contact ? Math.abs(w.slipRatio) * 0.5 + Math.abs(w.slipAngle) : 0), 0) / 4;
      const water = v.wheels.some(w => w.inWater) ? Math.min(1, v.speedKmh / 20) : 0;
      this.audio.update(v.rpm, this.inVehicle ? v.lastInput.throttle + v.lastInput.brake * (v.gear < 0 ? 1 : 0) : 0, v.engineOn && this.inVehicle, this.inVehicle ? slip : 0, water, true);
      this.net.update(dt, this.localTransform());
    }
    // ---- presentation ----
    this.vView.sync();
    this.vView.setCockpit(this.inVehicle && this.rig.mode === 'first-person');
    this.cView.sync(this.player, dt);
    this.cView.setVisible(!this.inVehicle && this.rig.mode !== 'first-person');
    this.scenery.animate(performance.now());
    this.env.sky.update(performance.now() / 1000);
    this.syncRemotes(dt);
    const focus = this.inVehicle ? v.body.pos : this.player.pos;
    const freeMove = { f: this.input.axis(['KeyS'], ['KeyW']), r: this.input.axis(['KeyA'], ['KeyD']), u: this.input.axis(['KeyQ'], ['KeyE']), fast: this.input.isDown('ShiftLeft') };
    this.rig.update(dt, focus, this.inVehicle ? v.body.quat.yaw() : this.player.heading, this.inVehicle, Math.abs(v.forwardSpeed()), this.inVehicle ? v.body.quat : null, freeMove);
    const cam = this.rig.camera.position;
    this.terrainR.update(cam); this.props.update(cam); this.grass.update(cam);
    this.env.follow(new Vector3(focus.x, focus.y, focus.z));
    if (this.started) {
      this.hud.update(dt, { px: focus.x, pz: focus.z, viewYaw: this.rig.viewYaw, inVehicle: this.inVehicle, v, vx: v.body.pos.x, vz: v.body.pos.z, vHeading: v.body.quat.yaw(), stamina: this.player.stamina, surface: T.surfaceAt(focus.x, focus.z) });
      const net = $('net');
      net.classList.toggle('hidden', this.net.status === 'offline');
      net.textContent = this.net.status === 'online' ? `Online · ${this.net.remotes.size + 1} players` : this.net.status === 'connecting' ? 'Connecting…' : 'Server unreachable';
    }
    this.scene.render();
    this.input.endFrame();
  }

  private localTransform(): PlayerTransform {
    const v = this.vehicle, p = this.player;
    if (this.inVehicle) { const b = v.body; return { mode: 'vehicle', x: b.pos.x, y: b.pos.y, z: b.pos.z, qx: b.quat.x, qy: b.quat.y, qz: b.quat.z, qw: b.quat.w, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, t: performance.now() }; }
    const q = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, p.heading);
    return { mode: 'foot', x: p.pos.x, y: p.pos.y, z: p.pos.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z, t: performance.now() };
  }

  private syncRemotes(dt: number) {
    for (const [id, r] of this.net.remotes) {
      let view = this.remoteViews.get(id);
      if (!view) {
        const sim = new Vehicle(RANGER_TX4, this.terrain), ch = new Character(this.terrain);
        view = { sim, ch, v: new VehicleView(this.scene, sim, Color3.FromHSV((id.charCodeAt(0) * 47) % 360, 0.6, 0.7)), c: new CharacterView(this.scene) };
        for (const w of sim.wheels) w.compression = 0.26;
        this.remoteViews.set(id, view);
      }
      const s = this.net.sample(r);
      if (!s) continue;
      const veh = s.mode === 'vehicle';
      view.v.root.setEnabled(true); view.c.setVisible(!veh);
      if (veh) { view.sim.body.pos.set(s.x, s.y, s.z); view.sim.body.quat.set(s.qx, s.qy, s.qz, s.qw); const sp = Math.hypot(s.vx, s.vz); for (const w of view.sim.wheels) w.rotation += (sp / 0.42) * dt; }
      else {
        view.ch.pos.set(s.x, s.y, s.z); view.ch.heading = new Quat(s.qx, s.qy, s.qz, s.qw).yaw(); view.ch.speed = Math.hypot(s.vx, s.vz); view.ch.animPhase += dt * view.ch.speed * 2.2; view.ch.grounded = Math.abs(s.vy) < 1;
        view.c.sync(view.ch, dt);
        view.v.root.setEnabled(false);
      }
      view.v.sync();
    }
    for (const [id, view] of this.remoteViews) if (!this.net.remotes.has(id)) { view.v.root.dispose(); view.c.root.dispose(); this.remoteViews.delete(id); }
  }

  private handleGlobalKeys() {
    const inp = this.input;
    if (inp.wasPressed('KeyP') || (inp.wasPressed('Escape') && !inp.locked) || inp.padPressed.has(9)) this.setPaused(!this.paused);
    if (inp.wasPressed('KeyH')) $('help').classList.toggle('hidden');
    if (inp.wasPressed('KeyM')) $('bigmap').classList.toggle('hidden');
    if (inp.wasPressed('F5')) this.save();
  }
  setPaused(p: boolean) {
    this.paused = p; $('pause').classList.toggle('hidden', !p);
    if (!p) { $('settings').classList.add('hidden'); this.audio.start(); } else { document.exitPointerLock?.(); this.audio.suspend(); }
  }

  private trackFps(dt: number) {
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0;
      $('fps').textContent = this.settings.showFps ? `${Math.round(this.fps)} fps · ${this.backend} · ${(1 / this.scaling * 100).toFixed(0)}% res` : '';
      // adaptive resolution: trade resolution for frame rate, never above the preset's quality
      if (this.settings.adaptiveQuality && this.started) {
        this.adaptTimer += 0.5;
        const base = PRESETS[this.settings.graphics].hardwareScaling;
        if (this.adaptTimer >= 2) {
          if (this.fps < 45 && this.scaling < 2) { this.scaling = Math.min(2, this.scaling + 0.15); this.adaptTimer = 0; }
          else if (this.fps > 58 && this.scaling > base) { this.scaling = Math.max(base, this.scaling - 0.1); this.adaptTimer = 0; }
          this.engine.setHardwareScalingLevel(this.scaling);
        }
      }
    }
  }
}
const tick = () => new Promise(r => setTimeout(r, 0));
