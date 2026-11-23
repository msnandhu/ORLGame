import { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import {
  Terrain, Vehicle, Character, VEHICLES, vehicleById, DRIVING_MODE_PROFILES, nextDrivingMode, repairFull, repairWithKit, overallDamage, WORLD_SEED, PHYSICS_HZ, Vec3, Quat,
  VehicleTransition, pickInteractable, Npc, CAMP_MECHANIC, DialogueSession, statureOf, decodeAppearance, DEFAULT_MALE,
  Traffic, Island, isRoadCar, PELLA, CORVAN, HALCYON, STRIX_R2, VANTA_GT, SOLENNE_GT,
  applyBuild, defaultBuild, encodeBuild, decodeBuild, vehiclePrice, formatMoney, newCareer, discoveryReward, DISCOVERY_RADIUS, FUEL_PRICE, KIT_PRICE,
  type VehicleSpec, type Settings, type TrafficObstacle, type PlayerTransform, type ImpactEvent, type Interactable, type CharacterAppearance, type DoorPose,
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
import { RoadRenderer } from '../world/RoadRenderer';
import { BuildingRenderer } from '../world/BuildingRenderer';
import { TrafficRenderer } from '../world/TrafficRenderer';
import { GrassField } from '../world/GrassField';
import { IslandRenderer } from '../world/island/IslandRenderer';
import { IslandFeatures } from '../world/island/IslandFeatures';
import { VehicleView } from '../vehicles/VehicleView';
import { CharacterView } from '../characters/CharacterView';
import { CharacterStore } from '../save/CharacterStore';
import { CameraRig } from '../cameras/CameraRig';
import { Input } from '../input/Input';
import { Hud } from '../ui/Hud';
import { WorldMap } from '../ui/worldmap/WorldMap';
import { EngineAudio } from '../audio/EngineAudio';
import { NetClient } from '../multiplayer/NetClient';
import { SaveGame } from '../save/SaveGame';
import { PRESETS, saveSettings } from '../config/settings';
import { log } from './logger';
import { Bank } from '../garage/Bank';
import { GarageScene } from '../garage/GarageScene';
import { GarageUI } from '../garage/GarageUI';
const REGION_NAME: Record<string, string> = { plain: 'the Plain Region', hill: 'the Hill Region', snow: 'the Snow Region', forest: 'the Deep Forest' };
import { markStarted } from './errors';

const $ = (id: string) => document.getElementById(id)!;
const SPAWN = { px: 1, pz: -2, ph: -2.4 };
/** Parking bays at base camp, one per catalog vehicle (in catalog order). */
const BAYS = [{ x: -4, z: 4, h: 0.4 }, { x: -10.5, z: 2.5, h: 0.4 }];
/** The open-sided shed at camp doubles as the workshop (and the garage). */
const WORKSHOP = { x: -18, z: 11, r: 9 };
/** Island garages (map places) where the garage can be used too. */
const GARAGE_POIS = ['service-garage', 'mountain-garage'];
const KITS_PER_TRIP = 2;
/** Where each road car lives: the car park of a settlement (city: racing and luxury, town and village: everyday cars). */
const HOME_LOT: Record<string, string> = { 'vanta-gt': 'halden', 'solenne-gt': 'halden', halcyon: 'halden', corvan: 'millbrook', 'strix-r2': 'millbrook', pella: 'ashby' };
/** AI traffic mix: mostly everyday cars, the odd luxury saloon and sports car. */
const TRAFFIC_MIX = [{ spec: PELLA, w: 5, n: 3 }, { spec: CORVAN, w: 5, n: 3 }, { spec: HALCYON, w: 2, n: 2 }, { spec: STRIX_R2, w: 1, n: 2 }, { spec: VANTA_GT, w: 0.6, n: 1 }, { spec: SOLENNE_GT, w: 0.6, n: 1 }];
const TRAFFIC_CARS = 70;
/** Parked vehicles further than this from the player sleep (no simulation) once they are at rest. */
const SLEEP_RANGE = 140;
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
  roads!: RoadRenderer; buildings!: BuildingRenderer; islandR!: IslandRenderer; islandF!: IslandFeatures; traffic!: Traffic; trafficR!: TrafficRenderer;
  hud!: Hud; input!: Input; island!: Island; worldMap!: WorldMap; private mapPaused = false; audio = new EngineAudio(); net = new NetClient();
  private remoteViews = new Map<string, { v: VehicleView; c: CharacterView; sim: Vehicle; ch: Character; vid: string; look: string; bld: string }>();
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
  /** money: local career offline, the server's online */
  bank!: Bank;
  garage!: GarageUI; garageScene: GarageScene | null = null; garageOpen = false; private garagePaused = false;
  /** build code each fleet vehicle was last built with */
  private fleetCodes: string[] = [];
  private pendingFuel = 0; private discoverTimer = 0; private discovering = new Set<string>(); private cashTimer = 0;
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
    onProgress(0.8, 'Paving roads and building towns');
    await tick();
    this.roads = new RoadRenderer(scene, this.terrain);
    this.buildings = new BuildingRenderer(scene, this.terrain);
    BuildingRenderer.lotPaving(scene, this.terrain);
    this.traffic = new Traffic(this.terrain, TRAFFIC_MIX.map(m => m.spec), TRAFFIC_MIX.map(m => m.w), TRAFFIC_CARS, WORLD_SEED);
    this.trafficR = new TrafficRenderer(scene, this.terrain, this.traffic, TRAFFIC_MIX.map(m => ({ spec: m.spec, n: m.n })));
    onProgress(0.85, 'Planting trees');
    await tick();
    this.props = new PropsRenderer(scene, this.terrain);
    this.grass = new GrassField(scene, this.terrain);
    this.scenery = new Scenery(scene, this.terrain, this.physics, assets.get<{ normal: RawImage }>('Terrain textures').normal);
    // the rest of the island: streamed terrain, sea, lakes, rivers, roads and bridges
    this.terrainR.viewDistance = Infinity;
    this.islandR = new IslandRenderer(scene, this.terrainR.material, this.terrain.outer);
    this.islandR.onCasters = (added, removed) => { for (const m of removed) this.env.removeShadowCaster(m); for (const m of added) this.env.addShadowCaster(m); };
    this.islandF = new IslandFeatures(scene, this.terrain.outer, this.scenery.water.material!);
    this.bank = new Bank(this.net, () => { const f = this.inVehicle ? this.vehicle.body.pos : this.player.pos; return { pois: this.island.pois, at: { x: f.x, z: f.z } }; });
    for (const spec of VEHICLES) {
      const built = this.builtSpec(spec);
      this.fleetCodes.push(this.buildCode(spec));
      const sim = new Vehicle(built, this.terrain), view = new VehicleView(scene, sim), fx = new DamageFx(scene, sim);
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
    for (const m of [...this.props.casters, ...this.scenery.casters, ...this.fleetViews.flatMap(v => v.meshes), ...this.cView.meshes, ...this.npcView.meshes, ...this.buildings.meshes, ...this.trafficR.meshes]) this.env.addShadowCaster(m);
    this.cView.onRebuild = (added, removed) => { for (const m of removed) this.env.removeShadowCaster(m); for (const m of added) this.env.addShadowCaster(m); };
    this.applyGraphics();
    this.input = new Input(this.canvas);
    this.hud = new Hud(this.terrain);
    this.island = this.terrain.outer.island;
    this.worldMap = new WorldMap(this.island, { img: this.hud.mapImg, half: this.terrain.half });
    this.worldMap.onCloseRequest = () => this.toggleMap();
    this.worldMap.onTravelRequest = (x, z) => { void this.travelToPoint(x, z); };
    this.worldMap.onMarkersChanged = () => { this.hud.waypoint = this.worldMap.waypoint; };
    this.hud.waypoint = this.worldMap.waypoint;
    this.rig.sensitivity = this.settings.mouseSensitivity; this.rig.invertY = this.settings.invertY; this.audio.setVolume(this.settings.volume);
    this.net.onCorrection = c => { this.cancelInteraction(); const p = this.inVehicle ? null : this.player; if (p) p.place(c.x, c.z); else this.vehicle.reset(c.x, c.z, this.vehicle.body.quat.yaw()); this.hud.toast('Position corrected by server'); };
    this.net.onChat = c => this.hud.toast(`${c.from}: ${c.text}`);
    this.garage = new GarageUI($('garage'), {
      career: () => this.bank.career,
      request: r => this.bank.request(r),
      preview: sp => this.garageScene?.show(sp),
      lights: on => this.garageScene?.setLights(on),
      close: () => this.closeGarage(),
    });
    this.bank.onChange = () => { this.refreshFleet(); this.garage.refresh(); };
    this.newGame(false);
    onProgress(0.9, 'Streaming the island');
    await this.islandR.prime(new Vector3(this.player.pos.x, this.player.pos.y + 2, this.player.pos.z), 25000);
    onProgress(0.95, 'Compiling shaders');
    try { await scene.whenReadyAsync(); }
    catch (e) {
      // an optional effect (SSAO) that this device or build cannot run must not stop the game: drop it and retry
      if (!this.env.dropSsao()) throw e;
      log.warn('app', 'Retrying start-up without SSAO', e);
      await scene.whenReadyAsync();
    }
    $('backend-info').textContent = `Renderer: ${this.backend}${this.physics ? ' · Havok physics' : ' · physics props off'} · ${this.terrain.size} m region`;
    log.info('app', `World ready: ${this.backend}, ${scene.meshes.length} meshes`);
    // a WebGPU device that is lost (driver reset, unsupported feature) leaves a black screen: restart on WebGL2
    if (backend === 'WebGPU') engine.onContextLostObservable.add(() => this.fallbackToWebGL2('the WebGPU device was lost'));
    engine.runRenderLoop(() => this.frame());
    addEventListener('resize', () => engine.resize());
    (window as unknown as Record<string, unknown>).__game = this;
  }

  /** WebGPU failed while running: remember WebGL2 and reload once (the player keeps their save). */
  private fallbackToWebGL2(why: string, err?: unknown) {
    log.warn('engine', `Switching to WebGL2: ${why}`, err);
    let tried = false;
    try { tried = sessionStorage.getItem('orl.webgl2-retry') === '1'; sessionStorage.setItem('orl.webgl2-retry', '1'); } catch { /* storage blocked */ }
    this.settings.preferWebGPU = false; saveSettings(this.settings);
    if (tried) return;
    if (this.started) { try { SaveGame.write(SaveGame.capture(this.fleet, this.vehicle, this.player, this.inVehicle, this.playTime, this.repairKits)); } catch { /* best effort */ } }
    location.reload();
  }

  newGame(fromSave: boolean) {
    const s = fromSave ? SaveGame.read() : null;
    // starting over (a save exists and the player chose New game) starts a new career too
    if (!fromSave && SaveGame.read() && this.net.status !== 'online') this.bank.resetLocal(newCareer());
    this.refreshFleet();
    this.fleet.forEach((v, i) => {
      const bay = this.home(v);
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
      if (!this.owns(active)) active = this.fleet.find(f => this.owns(f)) ?? active;
      if (typeof s.repairKits === 'number') this.repairKits = Math.max(0, Math.min(KITS_PER_TRIP, Math.floor(s.repairKits)));
      this.player.place(s.player.x, s.player.z); this.player.heading = s.player.heading; this.playTime = s.playTimeSec;
    } else {
      this.player.place(SPAWN.px, SPAWN.pz); this.player.heading = SPAWN.ph; this.playTime = 0;
    }
    if (!s) active = this.fleet.find(f => this.owns(f)) ?? active;
    this.setActive(active);
    for (const v of this.fleet) for (let i = 0; i < 480; i++) v.step(1 / PHYSICS_HZ, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    this.cancelInteraction();
    this.inVehicle = false; this.seat = 'foot'; this.rig.mode = 'chase';
    if (s?.inVehicle && this.owns(this.vehicle)) this.enterVehicle();
    this.rig.yaw = this.player.heading + Math.PI;
    this.terrainR.prime(new Vector3(this.player.pos.x, this.player.pos.y, this.player.pos.z));
  }

  /** Where a vehicle is parked at the start and where the tow truck takes it: camp bays or its settlement's car park. */
  home(v: Vehicle): { x: number; z: number; h: number; where: string } {
    const lot = HOME_LOT[v.spec.id];
    if (lot) {
      const spots = this.terrain.parking.filter(p => p.settlement === lot);
      const k = this.fleet.filter(f => HOME_LOT[f.spec.id] === lot).indexOf(v);
      const p = spots[Math.max(0, k) % spots.length], s = this.terrain.settlements.find(q => q.id === lot)!;
      return { x: p.x, z: p.z, h: p.heading, where: s.name };
    }
    const offroad = this.fleet.filter(f => !HOME_LOT[f.spec.id]);
    const bay = BAYS[Math.max(0, offroad.indexOf(v)) % BAYS.length];
    return { ...bay, where: 'base camp' };
  }

  /** Offline fast travel: on foot, next to a settlement's car park (or at camp). */
  travelTo(id: string): string {
    if (this.net.status === 'online') return 'Fast travel is off in multiplayer';
    this.cancelInteraction();
    if (this.inVehicle) { this.inVehicle = false; this.seat = 'foot'; if (this.rig.mode === 'far' || this.rig.mode === 'hood') this.rig.mode = 'chase'; }
    let x = SPAWN.px, z = SPAWN.pz, h = SPAWN.ph, name = 'base camp';
    const s = this.terrain.settlements.find(q => q.id === id);
    if (s) {
      const spots = this.terrain.parking.filter(p => p.settlement === s.id);
      const mx = spots.reduce((a, p) => a + p.x, 0) / spots.length, mz = spots[0].z;
      x = mx; z = mz - 6; h = 0; name = s.name; // stand in front of the bays, facing the cars
    }
    this.player.place(x, z); this.player.heading = h; this.rig.yaw = h + Math.PI;
    this.terrainR.prime(new Vector3(x, this.terrain.heightAt(x, z), z));
    return `Travelled to ${name}`;
  }

  /**
   * Offline fast travel to any point of the island (a map marker): the nearest dry, drivable ground within 400 m,
   * in the current vehicle if driving. Waits for the terrain there to stream in before handing back control.
   */
  async travelToPoint(x: number, z: number): Promise<string> {
    const say = (m: string) => { if (this.worldMap.isOpen) this.worldMap.flash(m); else this.hud.toast(m); return m; };
    if (!this.started) return say('Start or continue a game to travel');
    if (this.net.status === 'online') return say('Fast travel is off in multiplayer');
    if (this.transition || this.dialogue) return say('Finish what you are doing first');
    const T = this.terrain;
    let spot: [number, number] | null = null;
    for (let r = 0; r <= 400 && !spot; r += 8) for (let a = 0; a < 16 && !spot; a++) {
      const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r;
      if (!T.inBounds(px, pz) || T.waterDepthAt(px, pz) > 0.05 || T.normalAt(px, pz)[1] < 0.93) continue;
      spot = [px, pz];
      if (r === 0) break;
    }
    if (!spot) return say('No dry ground near that marker');
    const [px, pz] = spot, heading = Math.atan2(-px, -pz);
    if (this.worldMap.isOpen) this.worldMap.flash('Travelling…');
    await this.islandR.prime(new Vector3(px, T.heightAt(px, pz) + 2, pz), 30000);
    this.cancelInteraction();
    if (this.inVehicle) { this.vehicle.reset(px, pz, heading); this.vehicle.body.vel.set(0, 0, 0); this.vehicle.body.angVel.set(0, 0, 0); }
    else this.player.place(px, pz);
    this.player.heading = heading; this.rig.yaw = heading + Math.PI;
    this.terrainR.prime(new Vector3(px, T.heightAt(px, pz), pz));
    if (this.worldMap.isOpen) this.toggleMap();
    const region = this.island.regionAt(px, pz);
    return say(`Travelled to ${region ? REGION_NAME[region] : 'the coast'}`);
  }

  // ---------------- garage and economy ----------------
  owns(v: Vehicle) { return !!this.bank.career.owned[v.spec.id]; }
  private buildCode(spec: VehicleSpec) { const o = this.bank.career.owned[spec.id]; return o ? encodeBuild(o.build) : ''; }
  /** A catalogue vehicle as the player has built it (factory if not owned). */
  private builtSpec(spec: VehicleSpec) { return applyBuild(spec, this.bank.career.owned[spec.id]?.build ?? defaultBuild()); }
  /** Re-fit every fleet vehicle whose build changed: the simulation is retuned in place, the model rebuilt. */
  refreshFleet() {
    if (!this.fleet.length) return;
    VEHICLES.forEach((spec, i) => {
      const code = this.buildCode(spec);
      if (code === this.fleetCodes[i]) return;
      this.fleetCodes[i] = code;
      const sim = this.fleet[i], old = this.fleetViews[i], lights = old.headlightsOn;
      sim.retune(this.builtSpec(spec));
      for (const m of old.meshes) this.env.removeShadowCaster(m);
      old.dispose();
      const view = new VehicleView(this.scene, sim);
      for (const m of view.meshes) this.env.addShadowCaster(m);
      view.setHeadlights(lights); view.sync();
      this.fleetViews[i] = view;
      if (this.vView === old) this.vView = view;
      sim.onImpact = e => this.onImpact(sim, view, this.fleetFx[i], e);
    });
    // a sold vehicle can't stay the active one
    if (!this.owns(this.vehicle) && !this.inVehicle) { const o = this.fleet.find(f => this.owns(f)); if (o) this.setActive(o); }
  }
  /** Where the player can use a garage right now (camp workshop or an island garage), or null. */
  garageHere(): string | null {
    const p = this.inVehicle ? this.vehicle.body.pos : this.player.pos;
    if (Math.hypot(p.x - WORKSHOP.x, p.z - WORKSHOP.z) < WORKSHOP.r) return 'Base camp workshop';
    for (const id of GARAGE_POIS) { const g = this.island.pois.find(q => q.id === id); if (g && Math.hypot(p.x - g.x, p.z - g.z) < 40) return g.name; }
    return null;
  }
  openGarage(where: string) {
    if (this.garageOpen) return;
    if (!this.garageScene) this.garageScene = new GarageScene(this.engine, this.canvas, this.settings.graphics);
    this.cancelInteraction();
    this.garageOpen = true; this.garage.where = where;
    document.exitPointerLock?.(); this.input.allowLock = false;
    if (this.started && !this.paused) { this.paused = true; this.garagePaused = true; this.audio.suspend(); }
    $('hud').classList.add('hidden'); $('menu').classList.add('hidden');
    this.garageScene.attach();
    this.garage.open(this.vehicle.spec.id);
  }
  closeGarage() {
    if (!this.garageOpen) return;
    this.garage.close(); this.garageScene?.detach(); this.garageScene?.setLights(false);
    this.garageOpen = false; this.input.allowLock = true;
    this.refreshFleet();
    if (this.started) {
      $('hud').classList.remove('hidden');
      if (this.garagePaused) { this.paused = false; this.audio.start(); }
    } else $('menu').classList.remove('hidden');
    this.garagePaused = false;
  }
  /** Paid workshop repair (and kit restock) for a vehicle. */
  private async paidRepair(v: Vehicle, view: VehicleView, by: string) {
    const dmg = Math.min(1, overallDamage(v.condition) + (v.overheated ? 0.05 : 0));
    const msgs: string[] = [];
    if (dmg > 0.001) {
      const r = await this.bank.request({ op: 'repair', vid: v.spec.id, damage: dmg });
      if (!r.ok) { this.hud.toast(r.msg); return; }
      repairFull(v.condition); v.engineTemp = Math.min(v.engineTemp, 90); v.overheated = false; view.undent();
      if (!v.engineOn && v.canStart()) v.engineOn = true;
      msgs.push(`${by}: ${v.spec.name} ${r.msg.toLowerCase()}`);
    }
    const missing = KITS_PER_TRIP - this.repairKits;
    if (missing > 0 && this.bank.career.cash >= KIT_PRICE * missing) {
      const r = await this.bank.request({ op: 'kits', count: missing });
      if (r.ok) { this.repairKits = KITS_PER_TRIP; msgs.push(`kits restocked (${formatMoney(KIT_PRICE * missing)})`); }
    }
    this.hud.toast(msgs.length ? msgs.join(' · ') : 'Nothing to repair');
  }
  /** Fuel is paid for in 5-litre steps (and whatever is left when the pump stops). */
  private settleFuel() {
    if (this.pendingFuel <= 0) return;
    const l = this.pendingFuel; this.pendingFuel = 0;
    void this.bank.request({ op: 'refuel', litres: l });
  }
  /** First visit to a place on the island pays a finder's fee. */
  private checkDiscoveries(x: number, z: number, dt: number) {
    this.discoverTimer -= dt; if (this.discoverTimer > 0) return;
    this.discoverTimer = 1;
    const done = this.bank.career.discovered;
    for (const p of this.island.pois) {
      if (discoveryReward(p.kind) <= 0 || done.includes(p.id) || this.discovering.has(p.id)) continue;
      if (Math.hypot(p.x - x, p.z - z) > DISCOVERY_RADIUS * 0.9) continue;
      this.discovering.add(p.id);
      void this.bank.request({ op: 'discover', poi: p.id }).then(r => { this.discovering.delete(p.id); if (r.ok) this.hud.toast(r.msg); });
    }
  }

  private setActive(v: Vehicle) {
    const i = this.fleet.indexOf(v);
    this.vehicle = v; this.vView = this.fleetViews[i]; this.particles.v = v;
    // eye about 0.7 m above the hip point; the bonnet camera sits just above the nose
    const [sx, sy, sz] = v.spec.look.seat, low = isRoadCar(v.spec);
    this.rig.seatEye.set(sx, sy + (low ? 0.66 : 0.54), sz + (low ? 0.02 : 0.03));
    this.rig.hoodEye.set(0, low ? sy + 0.6 : 0.75, low ? v.spec.halfExtents[2] * 0.55 : 1.6);
  }

  /** Tow the current vehicle back to its home bay or car park (keeps fuel and damage). Returns a message. */
  returnToCamp(): string {
    const wasIn = this.inVehicle, v = this.vehicle, bay = this.home(v);
    v.reset(bay.x, bay.z, bay.h);
    for (let i = 0; i < 240; i++) v.step(1 / PHYSICS_HZ, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    this.cancelInteraction();
    this.player.place(bay.x + 2.2, bay.z - 1);
    this.inVehicle = false; this.seat = 'foot';
    if (wasIn) this.enterVehicle();
    this.terrainR.prime(new Vector3(bay.x, this.terrain.heightAt(bay.x, bay.z), bay.z));
    return bay.where === 'base camp' ? 'Towed back to base camp: drive into the shed and press F for the workshop' : `Towed to the ${bay.where} car park`;
  }

  private onImpact(v: Vehicle, view: VehicleView, fx: DamageFx, e: ImpactEvent) {
    view.dent(e);
    if (e.part !== 'suspension') fx.impact(e.point, e.severity);
    if (v !== this.vehicle || !this.inVehicle || !this.hud) return;
    const c = v.condition;
    if (e.part === 'suspension') { if (e.wheel >= 0 && c.tyres[e.wheel] >= 1) this.hud.toast('Puncture!'); else if (e.severity > 0.3) this.hud.toast('Hard landing: suspension damaged'); }
    else if (e.severity > 0.25) this.hud.toast(e.part === 'front' && c.cooling > 0.3 ? 'Heavy front impact: radiator damaged' : `Heavy impact (${e.part})`);
  }

  save() { this.settleFuel(); const ok = SaveGame.write(SaveGame.capture(this.fleet, this.vehicle, this.player, this.inVehicle, this.playTime, this.repairKits)); this.hud.toast(ok ? 'Game saved' : 'Could not save (browser storage blocked)'); }

  start() { this.started = true; markStarted(); this.audio.start(); this.canvas.requestPointerLock?.(); }

  applyGraphics() {
    const p = PRESETS[this.settings.graphics];
    this.scaling = p.hardwareScaling; this.engine.setHardwareScalingLevel(this.scaling);
    this.env.apply(p);
    this.terrainR.viewDistance = Infinity; this.props.viewDistance = Math.min(p.viewDistance, 1400);
    this.islandF.viewDistance = p.islandDistance * 0.5; this.islandR.splitFactor = p.islandDetail; this.islandR.treeDensity = p.treeDensity;
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
    const list: Interactable[] = this.fleet.map(v => {
      const d = this.doorPose(v), own = this.owns(v);
      return { id: `vehicle:${v.spec.id}`, kind: 'vehicle', x: d.x, z: d.z, radius: 3.2, label: own ? `drive the ${v.spec.name}` : `look at the ${v.spec.name} (for sale, ${formatMoney(vehiclePrice(v.spec.id))})` };
    });
    // the garage: the camp shed, and the island's garages
    list.push({ id: 'garage', kind: 'workshop', x: WORKSHOP.x, z: WORKSHOP.z, radius: 7, label: 'open the garage (Base camp workshop)' });
    for (const id of GARAGE_POIS) { const g = this.island.pois.find(q => q.id === id); if (g) list.push({ id: 'garage', kind: 'workshop', x: g.x, z: g.z, radius: 14, label: `open the garage (${g.name})` }); }
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
    this.hud.toast(`${v.spec.name} · ${DRIVING_MODE_PROFILES[v.drivingMode].label} · ${v.partTime ? v.driveMode : v.spec.drivetrain.toUpperCase()}`);
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
    if (action === 'restock') {
      const missing = KITS_PER_TRIP - this.repairKits;
      if (missing > 0) void this.bank.request({ op: 'kits', count: missing }).then(r => { if (r.ok) this.repairKits = KITS_PER_TRIP; this.hud.toast(r.ok ? `Repair kits restocked: ${r.msg}` : r.msg); });
      return;
    }
    if (action === 'repair') {
      const n = this.npc.body.pos;
      let best: Vehicle | null = null, bd = Infinity;
      for (const v of this.fleet) {
        const d = Math.hypot(v.body.pos.x - n.x, v.body.pos.z - n.z), inShed = Math.hypot(v.body.pos.x - WORKSHOP.x, v.body.pos.z - WORKSHOP.z) < WORKSHOP.r;
        if ((d < 9 || inShed) && d < bd) { best = v; bd = d; }
      }
      if (!best) return 'no-vehicle';
      if (overallDamage(best.condition) <= 0 && !best.overheated) return 'nothing-to-fix';
      void this.paidRepair(best, this.fleetViews[this.fleet.indexOf(best)], this.npc.def.name);
    }
  }

  private frame() {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    const inp = this.input, v = this.vehicle, T = this.terrain;
    inp.pollGamepad();
    this.trackFps(dt);
    if (this.garageOpen && this.garageScene) {
      if (inp.wasPressed('Escape')) this.closeGarage();
      this.garageScene.render(dt, inp.mouseDown);
      inp.endFrame();
      return;
    }
    if (this.started) this.handleGlobalKeys();
    else if (this.worldMap?.isOpen && (this.input.wasPressed('KeyM') || this.input.wasPressed('Escape'))) this.toggleMap();
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
        if ((inp.wasPressed('KeyG') || inp.wasPressed('KeyL')) && !v.partTime) this.hud.toast(`${v.spec.name}: permanent ${v.spec.drivetrain.toUpperCase()}, no transfer case or lockers`);
        else if (inp.wasPressed('KeyG')) { v.toggleDriveMode(); this.hud.toast(`Drive mode ${v.driveMode}${v.driveMode === '4L' ? ' (low range)' : ''}`); }
        else if (inp.wasPressed('KeyL')) { v.diffLock = !v.diffLock; this.hud.toast(v.diffLock ? 'Diff lock ON' : 'Diff lock OFF'); }
        if (inp.wasPressed('KeyT')) { v.automatic = !v.automatic; if (v.automatic && v.gear === 0) v.gear = 1; this.hud.toast(v.automatic ? 'Automatic transmission' : 'Manual transmission (X/Z to shift)'); }
        if (!v.automatic && (inp.wasPressed('KeyX') || inp.padPressed.has(5))) v.shiftUp();
        if (!v.automatic && (inp.wasPressed('KeyZ') || inp.padPressed.has(4))) v.shiftDown();
        if (inp.wasPressed('KeyN')) this.vView.setHeadlights(!this.vView.headlightsOn);
        if (inp.wasPressed('KeyR')) { v.recover(); this.hud.toast('Vehicle recovered'); }
        if (inp.wasPressed('KeyC') || inp.padPressed.has(2)) {
          v.setDrivingMode(nextDrivingMode(v.drivingMode, v.spec.modes));
          const m = DRIVING_MODE_PROFILES[v.drivingMode];
          this.hud.toast(`${m.label} mode${v.partTime ? ` · ${v.driveMode}${v.diffLock ? ' · lockers' : ''}` : ''}: ${m.description}`);
        }
        if (inp.wasPressed('KeyK')) {
          if (this.repairKits <= 0) this.hud.toast('No repair kits left: the workshop at camp restocks them');
          else if (v.speedKmh > 2) this.hud.toast('Stop to use a repair kit');
          else { repairWithKit(v.condition); this.repairKits--; if (!v.engineOn && v.canStart()) v.engineOn = true; this.hud.toast(`Field repair done (${this.repairKits} kit${this.repairKits === 1 ? '' : 's'} left)`); }
        }
        const nearPump = T.fuelPumps.some(p => Math.hypot(v.body.pos.x - p.x, v.body.pos.z - p.z) < 6);
        const atWorkshop = Math.hypot(v.body.pos.x - WORKSHOP.x, v.body.pos.z - WORKSHOP.z) < WORKSHOP.r;
        const pumping = nearPump && inp.isDown('KeyF') && v.speedKmh < 3 && v.fuel < v.spec.fuelCapacity - 0.05;
        if (pumping && this.bank.career.cash >= (this.pendingFuel + 1) * FUEL_PRICE) {
          const add = Math.min(v.spec.fuelCapacity - v.fuel, 12 * dt);
          v.fuel += add; this.pendingFuel += add; this.refuel = 0.3; if (!v.engineOn && v.canStart()) v.engineOn = true;
          if (this.pendingFuel >= 5) this.settleFuel();
        } else if (pumping && this.refuel <= 0) this.hud.toast(`Not enough money for fuel (${formatMoney(FUEL_PRICE)}/L)`);
        if (!pumping) this.settleFuel();
        const garage = this.garageHere();
        if (atWorkshop && inp.wasPressed('KeyF') && v.speedKmh < 3) void this.paidRepair(v, this.vView, 'Workshop');
        if (garage && inp.wasPressed('KeyU') && v.speedKmh < 3) this.openGarage(garage);
        if (this.refuel > 0) this.refuel -= dt;
        const dmg = v.condition;
        this.hud.prompt(nearPump ? (this.refuel > 0 ? `Refuelling… ${Math.round(v.fuel)} L` : `Hold F to refuel (${formatMoney(FUEL_PRICE)}/L)`) :
          atWorkshop && overallDamage(dmg) > 0 ? `Workshop: F to repair (${formatMoney(Math.max(150, Math.round(vehiclePrice(v.spec.id) * 0.03 * overallDamage(dmg) / 50) * 50))}) · U: garage` :
          garage && v.speedKmh < 3 ? `${garage}: press U for the garage` :
          v.flooded ? 'Engine flooded: press R to recover' : v.fuel <= 0 ? 'Out of fuel: pause menu → Tow vehicle home' :
          dmg.engine >= 1 ? 'Engine destroyed: pause menu → Tow vehicle home' :
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
            if (target.kind === 'vehicle') {
              const v = this.fleet.find(f => `vehicle:${f.spec.id}` === target.id);
              if (v && this.owns(v)) this.beginEnter(v);
              else if (v) this.hud.toast(`The ${v.spec.name} is for sale: buy it in a garage for ${formatMoney(vehiclePrice(v.spec.id))} (you have ${formatMoney(this.bank.career.cash)})`);
            } else if (target.kind === 'workshop') this.openGarage(this.garageHere() ?? 'Garage');
            else if (target.kind === 'npc') this.openDialogue();
          }
        }
      }
      this.npc.update(dt, this.obstacles());
      this.stepTraffic(dt);
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
      this.audio.tone = v.spec.look.sound ?? 1;
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
    this.rig.camera.minZ = this.rig.mode === 'first-person' ? 0.08 : 0.3;
    this.terrainR.update(cam); this.islandR.update(cam); this.islandF.update(cam); this.props.update(cam); this.grass.update(cam); this.roads.update(cam);
    this.trafficR.update(cam, dt);
    this.env.follow(new Vector3(focus.x, focus.y, focus.z));
    if (this.started) {
      this.hud.kits = this.repairKits;
      this.worldMap.trackExploration(focus.x, focus.z, dt);
      this.checkDiscoveries(focus.x, focus.z, dt);
      this.cashTimer -= dt;
      if (this.cashTimer <= 0) { this.cashTimer = 0.25; $('cash').textContent = formatMoney(this.bank.career.cash); }
      if (!this.terrain.inCore(focus.x, focus.z) || Math.max(Math.abs(focus.x), Math.abs(focus.z)) > this.terrain.half - 200) this.worldMap.ensureLocal(focus.x, focus.z);
      this.hud.outerImg = this.worldMap.localImg;
      this.worldMap.update(dt, this.mapState(focus.x, focus.z));
      this.hud.update(dt, { px: focus.x, pz: focus.z, viewYaw: this.rig.viewYaw, inVehicle: this.inVehicle, v, vx: v.body.pos.x, vz: v.body.pos.z, vHeading: v.body.quat.yaw(), stamina: this.player.stamina, surface: T.surfaceAt(focus.x, focus.z) });
      const net = $('net');
      net.classList.toggle('hidden', this.net.status === 'offline');
      net.textContent = this.net.status === 'online' ? `Online · ${this.net.remotes.size + 1} players` : this.net.status === 'connecting' ? 'Connecting…' : 'Server unreachable';
    }
    // the map opened from the main menu still needs drawing
    if (!this.started && this.worldMap?.isOpen) this.worldMap.update(dt, this.mapState(this.player.pos.x, this.player.pos.z));
    try { this.scene.render(); }
    catch (e) {
      if (this.backend === 'WebGPU') { this.fallbackToWebGL2('a frame failed to render on WebGPU', e); return; }
      if (!this.env.dropSsao()) throw e; this.hud?.toast('Ambient occlusion is not supported here and was turned off');
    }
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
    const p = driven ? driven.body.pos : this.player.pos;
    for (const f of this.fleet) {
      if (f === driven) continue;
      // far away and at rest: asleep until someone comes near (traffic or the player can wake it by pushing)
      if (Math.hypot(f.body.pos.x - p.x, f.body.pos.z - p.z) > SLEEP_RANGE && f.body.vel.lengthSq() < 0.01 && f.body.angVel.lengthSq() < 0.01) continue;
      for (let k = 0; k < steps; k++) f.step(fixed, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    }
  }

  /** AI traffic: yields to the player and the fleet, collides with them as moving boxes, and stops when hit. */
  private stepTraffic(dt: number) {
    const obs: TrafficObstacle[] = this.fleet.map(f => ({ x: f.body.pos.x, z: f.body.pos.z, r: f.spec.halfExtents[0] + 0.4 }));
    if (!this.inVehicle) obs.push({ x: this.player.pos.x, z: this.player.pos.z, r: 0.5 });
    if (this.npc) obs.push({ x: this.npc.body.pos.x, z: this.npc.body.pos.z, r: 0.5 });
    this.traffic.update(dt, obs);
    // only cars near the player take part in collisions
    const v = this.vehicle, c = this.inVehicle ? v.body.pos : this.player.pos, near = this.traffic.cars.filter(t => Math.abs(t.x - c.x) < 60 && Math.abs(t.z - c.z) < 60);
    this.terrain.dynamicBoxes = near.map(t => ({ kind: 'traffic', cx: t.x, cy: t.y + t.spec.hullOffsetY, cz: t.z, hx: t.spec.halfExtents[0], hy: t.spec.halfExtents[1], hz: t.spec.halfExtents[2], yaw: t.yaw }));
    for (const t of near) {
      const d = Math.hypot(t.x - v.body.pos.x, t.z - v.body.pos.z);
      if (d < t.spec.halfExtents[2] + v.spec.halfExtents[2] + 0.3 && v.body.vel.length() > 1.5 && t.shaken <= 0) this.traffic.bump(t);
    }
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
      if (view && view.vid !== spec.id) { view.c.attach(null); view.v.dispose(); view.c.dispose(); this.remoteViews.delete(id); view = undefined; }
      // another player's build (from the server): rebuild their car when it changes
      if (view && view.bld !== r.bld) { const b = decodeBuild(spec, r.bld); view.sim.retune(applyBuild(spec, b)); view.v.dispose(); view.v = new VehicleView(this.scene, view.sim, b.paint ? undefined : Color3.FromHSV((id.charCodeAt(0) * 47) % 360, 0.6, 0.7)); view.bld = r.bld; }
      if (!view) {
        const b = decodeBuild(spec, r.bld);
        const sim = new Vehicle(applyBuild(spec, b), this.terrain), ch = new Character(this.terrain), look = decodeAppearance(r.look);
        view = { sim, ch, vid: spec.id, look: r.look, bld: r.bld, v: new VehicleView(this.scene, sim, b.paint ? undefined : Color3.FromHSV((id.charCodeAt(0) * 47) % 360, 0.6, 0.7)), c: new CharacterView(this.scene, look) };
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
    for (const [id, view] of this.remoteViews) if (!this.net.remotes.has(id)) { view.c.attach(null); view.v.dispose(); view.c.dispose(); this.remoteViews.delete(id); }
  }

  private handleGlobalKeys() {
    const inp = this.input;
    if (this.dialogue && inp.wasPressed('Escape')) { this.closeDialogue(); return; }
    if (this.worldMap.isOpen) { if (inp.wasPressed('KeyM') || inp.wasPressed('Escape') || inp.padPressed.has(9)) this.toggleMap(); return; }
    if (inp.wasPressed('KeyP') || (inp.wasPressed('Escape') && !inp.locked) || inp.padPressed.has(9)) this.setPaused(!this.paused);
    if (inp.wasPressed('KeyH')) $('help').classList.toggle('hidden');
    if (inp.wasPressed('KeyM')) this.toggleMap();
    if (inp.wasPressed('F5')) this.save();
  }
  /** The world map pauses single-player driving while it is open (online, the world keeps running). */
  toggleMap() {
    if (!this.started) {
      // from the main menu: the map replaces the menu until it is closed
      if (this.worldMap.isOpen) { this.worldMap.close(); $('menu').classList.remove('hidden'); }
      else { $('menu').classList.add('hidden'); this.worldMap.open(this.mapState(this.player.pos.x, this.player.pos.z)); }
      return;
    }
    if (this.worldMap.isOpen) {
      this.worldMap.close();
      if (this.mapPaused) { this.paused = false; this.audio.start(); }
      this.mapPaused = false;
      return;
    }
    if (this.paused) this.setPaused(false);
    const focus = this.inVehicle ? this.vehicle.body.pos : this.player.pos;
    document.exitPointerLock?.();
    if (this.net.status !== 'online') { this.paused = true; this.mapPaused = true; this.audio.suspend(); }
    this.worldMap.open(this.mapState(focus.x, focus.z));
  }
  private mapState(x: number, z: number) {
    const bearing = ((180 - (this.rig.viewYaw * 180) / Math.PI) % 360 + 360) % 360;
    return { x, z, bearing, vx: this.vehicle.body.pos.x, vz: this.vehicle.body.pos.z, inVeh: this.inVehicle };
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
