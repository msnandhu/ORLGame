import { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import {
  Terrain, Vehicle, Character, VEHICLES, vehicleById, DRIVING_MODE_PROFILES, nextDrivingMode, repairFull, repairWithKit, overallDamage, WORLD_SEED, PHYSICS_HZ, Vec3, Quat,
  VehicleTransition, pickInteractable, Npc, CAMP_MECHANIC, DialogueSession, statureOf, decodeAppearance, DEFAULT_MALE,
  type Settings, type PlayerTransform, type ImpactEvent, type Interactable, type CharacterAppearance, type DoorPose,
} from '@orl/shared';
import { createEngine, type Backend } from '../engine/createEngine';
import { AssetManager } from '../assets/AssetManager';
import { detailTextures, type RawImage } from '../assets/proceduralTextures';
import { terrainLayers } from '../assets/terrainTextures';
import { HavokWorld, type HavokModule } from '../physics/HavokWorld';
import { Environment } from '../rendering/Environment';
import { WheelParticles } from '../rendering/WheelParticles';
import { DamageFx } from '../rendering/DamageFx';
import { TerrainRenderer } from '../world/TerrainRenderer';
import { PropsRenderer } from '../world/PropsRenderer';
import { Scenery } from '../world/Scenery';
import { GrassField } from '../world/GrassField';
import { VehicleView } from '../vehicles/VehicleView';
import { CharacterView } from '../characters/CharacterView';
import { CharacterStore } from '../save/CharacterStore';
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
const SPAWN = { px: 1, pz: -2, ph: -2.4 };
/** Parking bays at base camp, one per catalog vehicle (in catalog order). */
const BAYS = [{ x: -4, z: 4, h: 0.4 }, { x: -10.5, z: 2.5, h: 0.4 }];
/** The open-sided shed at camp doubles as the workshop. */
const WORKSHOP = { x: -18, z: 11, r: 9 };
const KITS_PER_TRIP = 2;
const REF_STATURE = 1.75;
/** on foot, in the middle of climbing in or out, or in the driver's seat */
type SeatState = 'foot' | 'entering' | 'seated' | 'exiting';
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** Owns the engine, scene and every game system, and runs the frame loop. */
export class GameApp {
  engine!: AbstractEngine; backend!: Backend; scene!: Scene;
  terrain!: Terrain; physics: HavokWorld | null = null;
  /** the vehicle being driven, or the last one driven */
  vehicle!: Vehicle; player!: Character;
  fleet: Vehicle[] = []; fleetViews: VehicleView[] = []; private fleetFx: DamageFx[] = [];
  repairKits = KITS_PER_TRIP;
  vView!: VehicleView; cView!: CharacterView; rig!: CameraRig; env!: Environment;
  terrainR!: TerrainRenderer; props!: PropsRenderer; grass!: GrassField; scenery!: Scenery; particles!: WheelParticles;
  hud!: Hud; input!: Input; audio = new EngineAudio(); net = new NetClient();
  private remoteViews = new Map<string, { v: VehicleView; c: CharacterView; sim: Vehicle; ch: Character; vid: string; look: string }>();
  inVehicle = false; paused = false; started = false;
  /** the player's look (character creator) */
  appearance: CharacterAppearance = CharacterStore.read() ?? DEFAULT_MALE;
  seat: SeatState = 'foot';
  private transition: VehicleTransition | null = null; private transitionVehicle: Vehicle | null = null;
  npc!: Npc; npcView!: CharacterView;
  dialogue: DialogueSession | null = null;
  /** character creator open: the camera orbits the player */
  creatorOpen = false; creatorSpin = 0;
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
    if (hk) { this.physics = new HavokWorld(scene, hk); this.physics.buildStatic(this.terrain); VEHICLES.forEach((sp, i) => this.physics!.addProxy(`vehicle-${i}`, new Vector3(sp.halfExtents[0] * 2, sp.halfExtents[1] * 2 + 0.1, sp.halfExtents[2] * 2))); this.physics.addProxy('player', new Vector3(0.6, 1.8, 0.6)); }
    this.terrainR = new TerrainRenderer(scene, this.terrain, assets.get('Terrain textures'), assets.get('Terrain materials'));
    onProgress(0.85, 'Planting trees');
    await tick();
    this.props = new PropsRenderer(scene, this.terrain);
    this.grass = new GrassField(scene, this.terrain);
    this.scenery = new Scenery(scene, this.terrain, this.physics, assets.get<{ normal: RawImage }>('Terrain textures').normal);
    for (const spec of VEHICLES) {
      const sim = new Vehicle(spec, this.terrain), view = new VehicleView(scene, sim), fx = new DamageFx(scene, sim);
      sim.onImpact = e => this.onImpact(sim, view, fx, e);
      this.fleet.push(sim); this.fleetViews.push(view); this.fleetFx.push(fx);
    }
    this.vehicle = this.fleet[0]; this.vView = this.fleetViews[0];
    this.player = new Character(this.terrain);
    this.cView = new CharacterView(scene, this.appearance);
    this.player.stature = statureOf(this.appearance) / REF_STATURE;
    this.npc = new Npc(CAMP_MECHANIC, this.terrain);
    this.npc.body.stature = statureOf(CAMP_MECHANIC.appearance) / REF_STATURE;
    this.npcView = new CharacterView(scene, CAMP_MECHANIC.appearance);
    this.particles = new WheelParticles(scene, this.vehicle);
    for (const m of [...this.props.casters, ...this.scenery.casters, ...this.fleetViews.flatMap(v => v.meshes), ...this.cView.meshes, ...this.npcView.meshes]) this.env.addShadowCaster(m);
    this.cView.onRebuild = (added, removed) => { for (const m of removed) this.env.removeShadowCaster(m); for (const m of added) this.env.addShadowCaster(m); };
    this.applyGraphics();
    this.input = new Input(this.canvas);
    this.hud = new Hud(this.terrain);
    this.rig.sensitivity = this.settings.mouseSensitivity; this.rig.invertY = this.settings.invertY; this.audio.setVolume(this.settings.volume);
    this.net.onCorrection = c => { this.cancelInteraction(); const p = this.inVehicle ? null : this.player; if (p) p.place(c.x, c.z); else this.vehicle.reset(c.x, c.z, this.vehicle.body.quat.yaw()); this.hud.toast('Position corrected by server'); };
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
    this.fleet.forEach((v, i) => {
      const bay = BAYS[i % BAYS.length];
      v.condition = { ...v.condition }; repairFull(v.condition); v.engineTemp = 85; v.overheated = false;
      v.fuel = v.spec.fuelCapacity; v.automatic = true; v.diffLock = false; v.driveMode = '4H'; v.drivingMode = 'normal';
      v.reset(bay.x, bay.z, bay.h);
      this.fleetViews[i].undent();
    });
    this.repairKits = KITS_PER_TRIP;
    let active = this.fleet[0];
    if (s) {
      const saved = s.vehicles ?? [{ ...s.vehicle, id: s.vehicle.id ?? this.fleet[0].spec.id }];
      for (const sv of saved) { const v = this.fleet.find(f => f.spec.id === (sv.id ?? this.fleet[0].spec.id)); if (v) SaveGame.apply(v, sv); }
      active = this.fleet.find(f => f.spec.id === s.activeVehicle) ?? active;
      if (typeof s.repairKits === 'number') this.repairKits = Math.max(0, Math.min(KITS_PER_TRIP, Math.floor(s.repairKits)));
      this.player.place(s.player.x, s.player.z); this.player.heading = s.player.heading; this.playTime = s.playTimeSec;
    } else {
      this.player.place(SPAWN.px, SPAWN.pz); this.player.heading = SPAWN.ph; this.playTime = 0;
    }
    this.setActive(active);
    for (const v of this.fleet) for (let i = 0; i < 480; i++) v.step(1 / PHYSICS_HZ, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    this.cancelInteraction();
    this.inVehicle = false; this.seat = 'foot'; this.rig.mode = 'chase';
    if (s?.inVehicle) this.enterVehicle();
    this.rig.yaw = this.player.heading + Math.PI;
  }

  private setActive(v: Vehicle) {
    const i = this.fleet.indexOf(v);
    this.vehicle = v; this.vView = this.fleetViews[i]; this.particles.v = v;
  }

  /** Tow the current vehicle back to its camp bay (keeps fuel and damage; the workshop is there). */
  returnToCamp() {
    const wasIn = this.inVehicle, v = this.vehicle, bay = BAYS[this.fleet.indexOf(v) % BAYS.length];
    v.reset(bay.x, bay.z, bay.h);
    for (let i = 0; i < 240; i++) v.step(1 / PHYSICS_HZ, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    this.cancelInteraction();
    this.player.place(bay.x + 2.2, bay.z - 1);
    this.inVehicle = false; this.seat = 'foot';
    if (wasIn) this.enterVehicle();
  }

  private onImpact(v: Vehicle, view: VehicleView, fx: DamageFx, e: ImpactEvent) {
    view.dent(e);
    if (e.part !== 'suspension') fx.impact(e.point, e.severity);
    if (v !== this.vehicle || !this.inVehicle || !this.hud) return;
    const c = v.condition;
    if (e.part === 'suspension') { if (e.wheel >= 0 && c.tyres[e.wheel] >= 1) this.hud.toast('Puncture!'); else if (e.severity > 0.3) this.hud.toast('Hard landing: suspension damaged'); }
    else if (e.severity > 0.25) this.hud.toast(e.part === 'front' && c.cooling > 0.3 ? 'Heavy front impact: radiator damaged' : `Heavy impact (${e.part})`);
  }

  save() { const ok = SaveGame.write(SaveGame.capture(this.fleet, this.vehicle, this.player, this.inVehicle, this.playTime, this.repairKits)); this.hud.toast(ok ? 'Game saved' : 'Could not save (browser storage blocked)'); }

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
  /** New look from the character creator: rebuild the model and scale the controller's stride. */
  setAppearance(a: CharacterAppearance) {
    this.appearance = a;
    this.cView.applyAppearance(a);
    this.player.stature = statureOf(a) / REF_STATURE;
  }

  /** The driver's door, level with the seat, a step out from the body. */
  private doorLocal(v: Vehicle) { return new Vec3(v.spec.halfExtents[0] + 0.45, 0, v.spec.look.seat[2]); }
  private doorPose(v: Vehicle): DoorPose { const d = this.doorLocal(v).applyQuaternion(v.body.quat).add(v.body.pos); return { x: d.x, z: d.z, vehicleYaw: v.body.quat.yaw() }; }
  private obstacles() {
    return this.fleet.map(f => ({ cx: f.body.pos.x, cz: f.body.pos.z, hx: f.spec.halfExtents[0], hz: f.spec.halfExtents[2] + 0.05, yaw: f.body.quat.yaw(), top: f.body.pos.y + f.spec.hullOffsetY + f.spec.halfExtents[1] }));
  }
  /** Everything the player can use on foot right now. */
  interactables(): Interactable[] {
    const list: Interactable[] = this.fleet.map(v => { const d = this.doorPose(v); return { id: `vehicle:${v.spec.id}`, kind: 'vehicle', x: d.x, z: d.z, radius: 3.2, label: `drive the ${v.spec.name}` }; });
    const b = this.npc.body.pos;
    list.push({ id: `npc:${this.npc.def.id}`, kind: 'npc', x: b.x, z: b.z, radius: 2.6, label: `talk to ${this.npc.def.name}` });
    return list;
  }

  /** Put the player straight into the driver's seat (loading a save, towing, end of the climb-in). */
  enterVehicle(target?: Vehicle) {
    if (target) this.setActive(target);
    const v = this.vehicle;
    this.inVehicle = true; this.seat = 'seated';
    this.rig.yaw = v.body.quat.yaw() + Math.PI;
    if (this.rig.mode === 'free') this.rig.mode = 'chase';
    if (!v.engineOn && v.canStart()) v.engineOn = true;
    this.hud.toast(`${v.spec.name} · ${DRIVING_MODE_PROFILES[v.drivingMode].label} · ${v.driveMode}`);
  }
  /** Walk to the driver's door and climb in (animated). */
  beginEnter(v: Vehicle) {
    this.setActive(v);
    this.transition = new VehicleTransition('enter'); this.transitionVehicle = v; this.seat = 'entering';
  }
  exitVehicle() {
    const v = this.vehicle;
    if (v.speedKmh > 12) { this.hud.toast('Slow down to exit'); return; }
    const door = this.doorPose(v);
    if (this.terrain.waterDepthAt(door.x, door.z) <= 1) {
      // climb out of the driver's door (animated); the vehicle holds its handbrake meanwhile
      this.player.place(door.x, door.z); this.player.heading = VehicleTransition.faceCab(door.vehicleYaw);
      this.transition = new VehicleTransition('exit'); this.transitionVehicle = v;
      this.inVehicle = false; this.seat = 'exiting';
      if (this.rig.mode === 'far' || this.rig.mode === 'hood') this.rig.mode = 'chase';
      return;
    }
    // driver's side is in deep water: jump out of whichever side is safe
    for (const o of [new Vec3(-1.6, 0, 0.2), new Vec3(0, 0, -3.2), new Vec3(0, 0, 3.2)]) {
      const p = o.applyQuaternion(v.body.quat).add(v.body.pos);
      if (this.terrain.waterDepthAt(p.x, p.z) > 1) continue;
      this.player.place(p.x, p.z); this.player.heading = v.body.quat.yaw();
      this.inVehicle = false; this.seat = 'foot';
      if (this.rig.mode === 'far' || this.rig.mode === 'hood') this.rig.mode = 'chase';
      return;
    }
    this.hud.toast('No safe place to exit');
  }
  private stepTransition(dt: number) {
    const tr = this.transition!, v = this.transitionVehicle!;
    tr.update(dt, this.player, this.doorPose(v), tr.phase === 'approach' ? this.obstacles() : []);
    if (!tr.done) return;
    this.transition = null; this.transitionVehicle = null;
    if (tr.kind === 'enter') this.enterVehicle(v);
    else { this.seat = 'foot'; this.rig.yaw = this.player.heading + Math.PI; }
  }
  /** Abort any climb or conversation (teleports, loading, quitting). */
  cancelInteraction() {
    this.transition = null; this.transitionVehicle = null;
    if (this.seat === 'entering' || this.seat === 'exiting') this.seat = 'foot';
    if (this.dialogue) this.closeDialogue();
  }

  // ---- NPC conversation ----
  private openDialogue() {
    this.dialogue = new DialogueSession(this.npc.def, a => this.npcAction(a));
    this.npc.startTalk(this.player.pos.x, this.player.pos.z);
    this.input.allowLock = false;
    this.player.heading = Math.atan2(this.npc.body.pos.x - this.player.pos.x, this.npc.body.pos.z - this.player.pos.z);
    document.exitPointerLock?.();
    this.renderDialogue();
  }
  closeDialogue() {
    this.dialogue = null; this.npc.endTalk(); this.input.allowLock = true;
    $('dialogue').classList.add('hidden');
  }
  chooseDialogue(i: number) { if (!this.dialogue) return; this.dialogue.choose(i); this.renderDialogue(); }
  private renderDialogue() {
    const d = this.dialogue;
    if (!d || d.ended || !d.node) { this.closeDialogue(); return; }
    $('dlg-name').textContent = this.npc.def.name;
    $('dlg-text').textContent = d.node.text;
    const opts = $('dlg-options'); opts.innerHTML = '';
    d.node.options.forEach((o, i) => {
      const b = document.createElement('button');
      const n = document.createElement('b'); n.textContent = String(i + 1);
      b.append(n, o.text);
      b.addEventListener('click', () => this.chooseDialogue(i));
      opts.append(b);
    });
    $('dialogue').classList.remove('hidden');
  }
  /** Dialogue actions use the same systems as the workshop. Returns a node to divert to when it can't be done. */
  private npcAction(action: string): string | void {
    if (action === 'restock') { this.repairKits = KITS_PER_TRIP; return; }
    if (action === 'repair') {
      const n = this.npc.body.pos;
      let best: Vehicle | null = null, bd = Infinity;
      for (const v of this.fleet) {
        const d = Math.hypot(v.body.pos.x - n.x, v.body.pos.z - n.z), inShed = Math.hypot(v.body.pos.x - WORKSHOP.x, v.body.pos.z - WORKSHOP.z) < WORKSHOP.r;
        if ((d < 9 || inShed) && d < bd) { best = v; bd = d; }
      }
      if (!best) return 'no-vehicle';
      if (overallDamage(best.condition) <= 0 && !best.overheated) return 'nothing-to-fix';
      repairFull(best.condition); best.engineTemp = Math.min(best.engineTemp, 90); best.overheated = false;
      this.fleetViews[this.fleet.indexOf(best)].undent();
      this.hud.toast(`${this.npc.def.name} repaired the ${best.spec.name}`);
    }
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
        if (inp.wasPressed('KeyC') || inp.padPressed.has(2)) {
          v.setDrivingMode(nextDrivingMode(v.drivingMode));
          const m = DRIVING_MODE_PROFILES[v.drivingMode];
          this.hud.toast(`${m.label} mode · ${v.driveMode}${v.diffLock ? ' · lockers' : ''}: ${m.description}`);
        }
        if (inp.wasPressed('KeyK')) {
          if (this.repairKits <= 0) this.hud.toast('No repair kits left: the workshop at camp restocks them');
          else if (v.speedKmh > 2) this.hud.toast('Stop to use a repair kit');
          else { repairWithKit(v.condition); this.repairKits--; if (!v.engineOn && v.canStart()) v.engineOn = true; this.hud.toast(`Field repair done (${this.repairKits} kit${this.repairKits === 1 ? '' : 's'} left)`); }
        }
        const nearPump = Math.hypot(v.body.pos.x - T.fuelPump.x, v.body.pos.z - T.fuelPump.z) < 6;
        const atWorkshop = Math.hypot(v.body.pos.x - WORKSHOP.x, v.body.pos.z - WORKSHOP.z) < WORKSHOP.r;
        if (nearPump && inp.isDown('KeyF') && v.speedKmh < 3) { v.fuel = Math.min(v.spec.fuelCapacity, v.fuel + 12 * dt); this.refuel = 0.3; if (!v.engineOn && v.canStart()) v.engineOn = true; }
        if (atWorkshop && inp.wasPressed('KeyF') && v.speedKmh < 3) {
          repairFull(v.condition); v.engineTemp = Math.min(v.engineTemp, 90); v.overheated = false; this.vView.undent(); this.repairKits = KITS_PER_TRIP;
          if (!v.engineOn && v.canStart()) v.engineOn = true;
          this.hud.toast(`Workshop: ${v.spec.name} fully repaired, repair kits restocked`);
        }
        if (this.refuel > 0) this.refuel -= dt;
        const dmg = v.condition;
        this.hud.prompt(nearPump ? (this.refuel > 0 ? `Refuelling… ${Math.round(v.fuel)} L` : 'Hold F to refuel') :
          atWorkshop && (dmg.engine + dmg.cooling + dmg.tyres.reduce((a, b) => a + b, 0) + dmg.suspension.reduce((a, b) => a + b, 0) + Object.values(dmg.body).reduce((a, b) => a + b, 0)) > 0 ? 'Workshop: press F to repair' :
          v.flooded ? 'Engine flooded: press R to recover' : v.fuel <= 0 ? 'Out of fuel: pause menu → Return to base camp' :
          dmg.engine >= 1 ? 'Engine destroyed: pause menu → Return to base camp for the workshop' :
          v.overheated ? `Engine overheated (${Math.round(v.engineTemp)} °C): let it cool, then it restarts${this.repairKits > 0 && dmg.cooling > 0.3 ? ' · K: patch the radiator' : ''}` :
          v.upsideDownTimer > 1.5 ? 'Vehicle stuck: press R to recover' : null);
        if (enter && this.seat === 'seated') this.exitVehicle();
        const ctl = { throttle: inp.isDown('KeyW') || inp.isDown('ArrowUp') ? 1 : 0, brake: inp.isDown('KeyS') || inp.isDown('ArrowDown') ? 1 : 0, steer: inp.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), handbrake: inp.isDown('Space') ? 1 : 0 };
        if (gp) { ctl.throttle = Math.max(ctl.throttle, inp.padButton(7)); ctl.brake = Math.max(ctl.brake, inp.padButton(6)); if (inp.padAxis(0)) ctl.steer = inp.padAxis(0); ctl.handbrake = Math.max(ctl.handbrake, inp.padButton(0)); }
        while (this.acc >= fixed && steps < 14) { v.step(fixed, ctl); this.acc -= fixed; steps++; }
        this.player.pos.copy(v.body.pos);
        this.stepParked(steps, v);
      } else {
        while (this.acc >= fixed && steps < 14) { this.acc -= fixed; steps++; }
        this.stepParked(steps, null);
        const obstacles = this.obstacles();
        if (this.transition) {
          this.stepTransition(dt);
          this.hud.prompt(null);
        } else if (this.dialogue) {
          // standing still in conversation: number keys pick a reply, E or Esc ends it
          this.player.update(dt, { forward: 0, right: 0, sprint: false, jump: false, crouch: false, camYaw: this.rig.yaw + Math.PI }, obstacles);
          for (let i = 0; i < 5; i++) if (inp.wasPressed(`Digit${i + 1}`) || inp.wasPressed(`Numpad${i + 1}`)) this.chooseDialogue(i);
          if (enter) this.closeDialogue();
          this.hud.prompt(null);
        } else {
          const free = this.rig.mode === 'free';
          const fwd = free ? 0 : inp.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) || -inp.padAxis(1);
          const right = free ? 0 : inp.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) || inp.padAxis(0);
          const padMag = Math.hypot(inp.padAxis(0), inp.padAxis(1));
          this.player.update(dt, {
            forward: fwd, right, camYaw: this.rig.yaw + Math.PI,
            sprint: inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') || inp.padButton(10) > 0.5,
            walk: inp.isDown('AltLeft') || inp.isDown('AltRight') || (padMag > 0 && padMag < 0.55),
            jump: !free && (inp.wasPressed('Space') || inp.padPressed.has(0)), crouch: inp.isDown('KeyC') || inp.padButton(1) > 0.5,
          }, obstacles);
          if (this.rig.mode === 'first-person') this.player.heading = this.rig.yaw + Math.PI;
          const p = this.player, target = p.grounded ? pickInteractable(p.pos.x, p.pos.z, p.heading, this.interactables()) : null;
          this.hud.prompt(target ? `Press E to ${target.label}` : null);
          if (enter && target) {
            if (target.kind === 'vehicle') { const v = this.fleet.find(f => `vehicle:${f.spec.id}` === target.id); if (v) this.beginEnter(v); }
            else if (target.kind === 'npc') this.openDialogue();
          }
        }
      }
      this.npc.update(dt, this.obstacles());
      if (steps >= 14) this.acc = 0;
      // kinematic proxies so Havok props react to the custom-simulated vehicle and player
      this.fleet.forEach((f, i) => this.physics?.moveProxy(`vehicle-${i}`, f.body.pos.x, f.body.pos.y + f.spec.hullOffsetY, f.body.pos.z, f.body.quat, dt));
      const pq = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, this.player.heading);
      if (!this.inVehicle) this.physics?.moveProxy('player', this.player.pos.x, this.player.pos.y + 0.9, this.player.pos.z, pq, dt);
      else this.physics?.moveProxy('player', 0, -500, 0, pq, dt);
      this.particles.update();
      for (const fx of this.fleetFx) fx.update(dt, PRESETS[this.settings.graphics].particles);
      const slip = v.wheels.reduce((a, w) => a + (w.contact ? Math.abs(w.slipRatio) * 0.5 + Math.abs(w.slipAngle) : 0), 0) / 4;
      const water = v.wheels.some(w => w.inWater) ? Math.min(1, v.speedKmh / 20) : 0;
      this.audio.update(v.rpm, this.inVehicle ? v.lastInput.throttle + v.lastInput.brake * (v.gear < 0 ? 1 : 0) : 0, v.engineOn && this.inVehicle, this.inVehicle ? slip : 0, water, true);
      this.net.update(dt, this.localTransform());
    }
    // ---- presentation ----
    for (const view of this.fleetViews) { view.sync(); view.setCockpit(view === this.vView && this.inVehicle && this.rig.mode === 'first-person'); }
    this.syncPlayerView(dt);
    this.npcView.sync(this.npc.body, dt, this.npc.state === 'talk' ? { mode: 'talk' } : {});
    this.rig.eyeHeight = 1.62 * this.player.stature * (this.player.crouching ? 0.62 : 1);
    this.scenery.animate(performance.now());
    this.env.sky.update(performance.now() / 1000);
    this.syncRemotes(dt);
    const focus = this.inVehicle ? v.body.pos : this.player.pos;
    const freeMove = { f: this.input.axis(['KeyS'], ['KeyW']), r: this.input.axis(['KeyA'], ['KeyD']), u: this.input.axis(['KeyQ'], ['KeyE']), fast: this.input.isDown('ShiftLeft') };
    if (this.creatorOpen) {
      this.creatorSpin -= this.input.mouseDX * 0.008;
      this.rig.portrait(this.player.pos, this.player.heading + this.creatorSpin, statureOf(this.appearance));
    } else this.rig.update(dt, focus, this.inVehicle ? v.body.quat.yaw() : this.player.heading, this.inVehicle, Math.abs(v.forwardSpeed()), this.inVehicle ? v.body.quat : null, freeMove);
    const cam = this.rig.camera.position;
    this.terrainR.update(cam); this.props.update(cam); this.grass.update(cam);
    this.env.follow(new Vector3(focus.x, focus.y, focus.z));
    if (this.started) {
      this.hud.kits = this.repairKits;
      this.hud.update(dt, { px: focus.x, pz: focus.z, viewYaw: this.rig.viewYaw, inVehicle: this.inVehicle, v, vx: v.body.pos.x, vz: v.body.pos.z, vHeading: v.body.quat.yaw(), stamina: this.player.stamina, surface: T.surfaceAt(focus.x, focus.z) });
      const net = $('net');
      net.classList.toggle('hidden', this.net.status === 'offline');
      net.textContent = this.net.status === 'online' ? `Online · ${this.net.remotes.size + 1} players` : this.net.status === 'connecting' ? 'Connecting…' : 'Server unreachable';
    }
    this.scene.render();
    this.input.endFrame();
  }

  /** Place and animate the player's figure: on foot, climbing in or out, or seated in the driver's seat. */
  private syncPlayerView(dt: number) {
    const c = this.cView, tr = this.transition;
    if (this.seat === 'seated') {
      const v = this.vehicle, [x, y, z] = v.spec.look.seat;
      c.attach(this.vView.root);
      c.sync(null, dt, { mode: 'seated', local: { x, y, z, yaw: 0 }, steer: v.wheels[0].steer / v.spec.maxSteer });
      c.setVisible(this.rig.mode !== 'first-person');
      return;
    }
    if (tr && tr.phase !== 'approach' && this.transitionVehicle) {
      const v = this.transitionVehicle, view = this.fleetViews[this.fleet.indexOf(v)], [sx, sy, sz] = v.spec.look.seat;
      c.attach(view.root);
      // door point in the vehicle's frame, at ground level
      const dw = this.doorPose(v), gy = this.terrain.heightAt(dw.x, dw.z);
      const inv = view.root.computeWorldMatrix(true).clone().invert();
      const dl = Vector3.TransformCoordinates(new Vector3(dw.x, gy, dw.z), inv);
      const e = smooth(tr.progress), k = tr.kind === 'enter' ? e : 1 - e; // 0 = standing at the door, 1 = in the seat
      // climbing in faces the cab (-X), climbing out faces away (+X); seated faces forward
      const yaw = lerpAngle(tr.kind === 'enter' ? -Math.PI / 2 : Math.PI / 2, 0, tr.kind === 'enter' ? smooth(Math.max(0, (k - 0.35) / 0.65)) : Math.min(1, k * 1.6));
      c.sync(null, dt, { mode: k > 0.6 ? 'seated' : 'climb', local: { x: dl.x + (sx - dl.x) * k, y: dl.y + (sy - dl.y) * k, z: dl.z + (sz - dl.z) * k, yaw } });
      c.setVisible(true);
      return;
    }
    c.attach(null);
    c.sync(this.player, dt);
    c.setVisible(this.rig.mode !== 'first-person' || this.creatorOpen);
  }

  /** Parked vehicles keep simulating (handbrake on) so they settle, roll on slopes and can be pushed. */
  private stepParked(steps: number, driven: Vehicle | null) {
    const fixed = 1 / PHYSICS_HZ;
    for (const f of this.fleet) if (f !== driven) for (let k = 0; k < steps; k++) f.step(fixed, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
  }

  private localTransform(): PlayerTransform {
    const v = this.vehicle, p = this.player;
    if (this.inVehicle) { const b = v.body; return { mode: 'vehicle', vid: v.spec.id, x: b.pos.x, y: b.pos.y, z: b.pos.z, qx: b.quat.x, qy: b.quat.y, qz: b.quat.z, qw: b.quat.w, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, t: performance.now() }; }
    const q = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, p.heading);
    return { mode: 'foot', vid: v.spec.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z, t: performance.now() };
  }

  private syncRemotes(dt: number) {
    for (const [id, r] of this.net.remotes) {
      let view = this.remoteViews.get(id);
      const spec = vehicleById(r.vid);
      if (view && view.vid !== spec.id) { view.c.attach(null); view.v.root.dispose(); view.c.dispose(); this.remoteViews.delete(id); view = undefined; }
      if (!view) {
        const sim = new Vehicle(spec, this.terrain), ch = new Character(this.terrain), look = decodeAppearance(r.look);
        view = { sim, ch, vid: spec.id, look: r.look, v: new VehicleView(this.scene, sim, Color3.FromHSV((id.charCodeAt(0) * 47) % 360, 0.6, 0.7)), c: new CharacterView(this.scene, look) };
        ch.stature = statureOf(look) / REF_STATURE;
        for (const w of sim.wheels) w.compression = 0.26;
        this.remoteViews.set(id, view);
      }
      if (view.look !== r.look) { const look = decodeAppearance(r.look); view.look = r.look; view.c.applyAppearance(look); view.ch.stature = statureOf(look) / REF_STATURE; }
      const s = this.net.sample(r);
      if (!s) continue;
      const veh = s.mode === 'vehicle', ch = view.ch;
      view.v.root.setEnabled(true); view.c.setVisible(true);
      if (veh) {
        view.sim.body.pos.set(s.x, s.y, s.z); view.sim.body.quat.set(s.qx, s.qy, s.qz, s.qw);
        const sp = Math.hypot(s.vx, s.vz); for (const w of view.sim.wheels) w.rotation += (sp / spec.wheelRadius) * dt;
        view.v.sync();
        // remote drivers sit in their seat
        const [x, y, z] = spec.look.seat;
        view.c.attach(view.v.root);
        view.c.sync(null, dt, { mode: 'seated', local: { x, y, z, yaw: 0 } });
      } else {
        ch.pos.set(s.x, s.y, s.z); ch.heading = new Quat(s.qx, s.qy, s.qz, s.qw).yaw();
        // the network sends a transform, not the animation state: infer it from the motion
        const sp = Math.hypot(s.vx, s.vz);
        ch.speed = sp; ch.animPhase += dt * sp * 2.2 / ch.stature; ch.grounded = Math.abs(s.vy) < 1;
        ch.state = Math.abs(s.vy) > 1 ? (s.vy > 0 ? 'jump' : 'fall') : sp < 0.25 ? 'idle' : sp < 2.6 ? 'walk' : sp < 5 ? 'run' : 'sprint';
        view.c.attach(null);
        view.c.sync(ch, dt);
        view.v.root.setEnabled(false);
      }
    }
    for (const [id, view] of this.remoteViews) if (!this.net.remotes.has(id)) { view.c.attach(null); view.v.root.dispose(); view.c.dispose(); this.remoteViews.delete(id); }
  }

  private handleGlobalKeys() {
    const inp = this.input;
    if (this.dialogue && inp.wasPressed('Escape')) { this.closeDialogue(); return; }
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
