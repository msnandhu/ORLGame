import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Terrain, Surface } from './world/terrain';
import { Vehicle } from './vehicle/vehicle';
import { RANGER_TX4 } from './vehicle/spec';
import { Character } from './player/character';
import { Input } from './core/input';
import { GameCamera } from './render/camera';
import { buildTerrainMeshes, buildWater } from './render/terrainMesh';
import { buildVegetation, buildCamp } from './render/props';
import { VehicleModel } from './render/vehicleModel';
import { CharacterModel } from './render/characterModel';
import { Particles } from './render/particles';
import { Hud } from './ui/hud';
import { EngineAudio } from './audio/engineAudio';

type Gfx = 'low' | 'medium' | 'high';
interface Settings { gfx: Gfx; sens: number; invert: boolean; vol: number; fps: boolean }
const DEFAULTS: Settings = { gfx: 'medium', sens: 1, invert: false, vol: 0.6, fps: false };
function loadSettings(): Settings { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('orl.settings') || '{}') }; } catch { return { ...DEFAULTS }; } }
function saveSettings(s: Settings) { try { localStorage.setItem('orl.settings', JSON.stringify(s)); } catch { /* storage unavailable */ } }

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('game') as HTMLCanvasElement;
const settings = loadSettings();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2500);
scene.fog = new THREE.Fog(0xb9c7d0, 120, 900);

// Sky + sun (late-afternoon)
const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(215));
const su = sky.material.uniforms;
su.turbidity.value = 6; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.8; su.sunPosition.value.copy(sunDir);
const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
sun.castShadow = true;
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 400; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x4a3a28, 0.9));
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(1000);
Object.assign(envSky.material.uniforms.sunPosition.value, sunDir); envSky.material.uniforms.turbidity.value = 6; envSky.material.uniforms.rayleigh.value = 1.6;
envScene.add(envSky);
scene.environment = pmrem.fromScene(envScene).texture;
scene.environmentIntensity = 0.6;

function applyGraphics(g: Gfx) {
  const dpr = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(g === 'low' ? Math.min(1, dpr) * 0.75 : g === 'medium' ? Math.min(dpr, 1.5) : dpr);
  renderer.shadowMap.enabled = g !== 'low';
  const sz = g === 'high' ? 4096 : 2048;
  if (sun.shadow.mapSize.x !== sz) { sun.shadow.mapSize.set(sz, sz); sun.shadow.map?.dispose(); sun.shadow.map = null as never; }
  scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  (scene.fog as THREE.Fog).far = g === 'low' ? 450 : g === 'medium' ? 800 : 1100;
  camera.far = g === 'low' ? 600 : 2500; camera.updateProjectionMatrix();
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);

// ---------- Game state ----------
let terrain: Terrain, vehicle: Vehicle, player: Character, vModel: VehicleModel, cModel: CharacterModel, hud: Hud, cam: GameCamera, particles: Particles;
const input = new Input(canvas);
const audio = new EngineAudio();
let inVehicle = false, paused = false, started = false, headlights = false;
let flag: THREE.Mesh | undefined;
const fixedDt = 1 / 240;
let acc = 0, last = performance.now(), fpsAcc = 0, fpsFrames = 0;

async function init() {
  await new Promise(r => setTimeout(r, 30)); // let the menu paint
  terrain = new Terrain();
  scene.add(buildTerrainMeshes(terrain), buildWater(terrain), buildVegetation(terrain));
  const camp = buildCamp(terrain); scene.add(camp);
  flag = camp.getObjectByName('flag') as THREE.Mesh;
  vehicle = new Vehicle(RANGER_TX4, terrain);
  vehicle.reset(-4, 4, 0.4);
  for (let i = 0; i < 480; i++) vehicle.step(fixedDt, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
  vModel = new VehicleModel(vehicle); scene.add(vModel.root);
  player = new Character(terrain); player.place(1, -2); player.heading = -2.4;
  cModel = new CharacterModel(); scene.add(cModel.root);
  particles = new Particles(); scene.add(particles.points);
  cam = new GameCamera(camera, terrain); cam.yaw = 0.9;
  hud = new Hud(terrain);
  applyGraphics(settings.gfx); resize();
  cam.sensitivity = settings.sens; cam.invertY = settings.invert; audio.setVolume(settings.vol);
  const btn = $('btn-start') as HTMLButtonElement; btn.disabled = false; btn.textContent = 'Start';
  renderer.compile(scene, camera);
  (window as unknown as Record<string, unknown>).__game = { get vehicle() { return vehicle; }, get player() { return player; }, get inVehicle() { return inVehicle; }, terrain, cam: () => cam };
  requestAnimationFrame(frame);
}

// ---------- Menus ----------
$('btn-start').addEventListener('click', () => {
  started = true; $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  audio.start(); canvas.requestPointerLock?.();
  hud.toast('Walk to the Ranger TX4 and press E');
});
function setPaused(p: boolean) {
  if (!started) return;
  paused = p; $('pause').classList.toggle('hidden', !p);
  if (p) { document.exitPointerLock?.(); audio.suspend(); } else audio.start();
}
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-recover').addEventListener('click', () => { vehicle.recover(); setPaused(false); hud.toast('Vehicle recovered'); });
$('btn-camp').addEventListener('click', () => {
  vehicle.reset(-4, 4, 0.4);
  if (inVehicle) { /* stays inside */ } else player.place(1, -2);
  setPaused(false); hud.toast('Returned to base camp');
});
$('btn-help').addEventListener('click', () => $('help').classList.toggle('hidden'));
const gfxSel = $('opt-gfx') as HTMLSelectElement, sens = $('opt-sens') as HTMLInputElement, inv = $('opt-invert') as HTMLInputElement, vol = $('opt-vol') as HTMLInputElement, fpsBox = $('opt-fps') as HTMLInputElement;
gfxSel.value = settings.gfx; sens.value = String(settings.sens); inv.checked = settings.invert; vol.value = String(settings.vol); fpsBox.checked = settings.fps;
gfxSel.addEventListener('change', () => { settings.gfx = gfxSel.value as Gfx; applyGraphics(settings.gfx); saveSettings(settings); });
sens.addEventListener('input', () => { settings.sens = +sens.value; cam.sensitivity = settings.sens; saveSettings(settings); });
inv.addEventListener('change', () => { settings.invert = inv.checked; cam.invertY = inv.checked; saveSettings(settings); });
vol.addEventListener('input', () => { settings.vol = +vol.value; audio.setVolume(settings.vol); saveSettings(settings); });
fpsBox.addEventListener('change', () => { settings.fps = fpsBox.checked; saveSettings(settings); });

// ---------- Enter / exit ----------
function driverDoorWorld() { return new THREE.Vector3(1.4, 0, 0.2).applyQuaternion(vehicle.body.quat).add(vehicle.body.pos); }
function canEnter() { const d = driverDoorWorld(); return Math.hypot(player.pos.x - d.x, player.pos.z - d.z) < 2.6 || player.pos.distanceTo(vehicle.body.pos) < 3.2; }
function enterVehicle() {
  inVehicle = true; cModel.root.visible = false;
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.body.quat);
  cam.yaw = Math.atan2(f.x, f.z) + Math.PI;
  if (!vehicle.engineOn && vehicle.fuel > 0 && !vehicle.flooded) vehicle.engineOn = true;
  hud.toast(`${vehicle.spec.name} · ${vehicle.driveMode}`);
}
function exitVehicle() {
  if (vehicle.speedKmh > 12) { hud.toast('Slow down to exit'); return; }
  // try driver side, then passenger side, then behind
  const opts = [new THREE.Vector3(1.6, 0, 0.2), new THREE.Vector3(-1.6, 0, 0.2), new THREE.Vector3(0, 0, -3.2), new THREE.Vector3(0, 0, 3.2)];
  for (const o of opts) {
    const p = o.applyQuaternion(vehicle.body.quat).add(vehicle.body.pos);
    if (terrain.waterDepthAt(p.x, p.z) > 1.0) continue;
    player.place(p.x, p.z);
    inVehicle = false; cModel.root.visible = true;
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.body.quat);
    player.heading = Math.atan2(f.x, f.z);
    return;
  }
  hud.toast('No safe place to exit');
}

// ---------- Frame ----------
const tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3();
const SURF_COL: Record<number, number> = { [Surface.Grass]: 0x6b6046, [Surface.Dirt]: 0x9a8360, [Surface.Mud]: 0x3e2c1c, [Surface.Rock]: 0x8c8780, [Surface.Gravel]: 0xa49c8c };
let refuelTimer = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) { $('fps').textContent = settings.fps ? `${Math.round(fpsFrames / fpsAcc)} fps` : ''; fpsAcc = 0; fpsFrames = 0; }
  input.pollGamepad();
  const gp = input.gamepad;

  if (started) {
    if (input.wasPressed('KeyP') || (input.wasPressed('Escape') && !input.locked)) setPaused(!paused);
    if (input.wasPressed('KeyH')) $('help').classList.toggle('hidden');
    if (input.wasPressed('KeyM')) $('bigmap').classList.toggle('hidden');
    if (gp && input.padPressed.has(9)) setPaused(!paused);
  }

  if (started && !paused) {
    // camera input
    let mdx = input.mouseDX, mdy = input.mouseDY;
    if (gp) { mdx += input.padAxis(2) * 900 * dt; mdy += input.padAxis(3) * 600 * dt; }
    cam.input(mdx, mdy, input.wheel, dt);
    if (input.wasPressed('KeyV')) { cam.cycleMode(); hud.toast(`Camera: ${cam.mode}`); }
    const enterPressed = input.wasPressed('KeyE') || input.padPressed.has(3);

    if (inVehicle) {
      if (input.wasPressed('KeyG')) { vehicle.toggleDriveMode(); hud.toast(`Drive mode ${vehicle.driveMode}${vehicle.driveMode === '4L' ? ' (low range)' : ''}`); }
      if (input.wasPressed('KeyL')) { vehicle.diffLock = !vehicle.diffLock; hud.toast(vehicle.diffLock ? 'Diff lock ON (axles locked)' : 'Diff lock OFF'); }
      if (input.wasPressed('KeyT')) { vehicle.automatic = !vehicle.automatic; if (vehicle.automatic && vehicle.gear === 0) vehicle.gear = 1; hud.toast(vehicle.automatic ? 'Automatic transmission' : 'Manual transmission (X/Z to shift)'); }
      if (!vehicle.automatic && (input.wasPressed('KeyX') || input.padPressed.has(5))) vehicle.shiftUp();
      if (!vehicle.automatic && (input.wasPressed('KeyZ') || input.padPressed.has(4))) vehicle.shiftDown();
      if (input.wasPressed('KeyN')) { headlights = !headlights; vModel.setHeadlights(headlights); }
      if (input.wasPressed('KeyR')) { vehicle.recover(); hud.toast('Vehicle recovered'); }
      // refuel at pump
      const nearPump = Math.hypot(vehicle.body.pos.x - terrain.fuelPump.x, vehicle.body.pos.z - terrain.fuelPump.z) < 6;
      if (nearPump && input.isDown('KeyF') && vehicle.speedKmh < 3) {
        vehicle.fuel = Math.min(vehicle.spec.fuelCapacity, vehicle.fuel + 12 * dt); refuelTimer = 0.3;
        if (!vehicle.engineOn && !vehicle.flooded) vehicle.engineOn = true;
      }
      if (refuelTimer > 0) refuelTimer -= dt;
      hud.prompt(nearPump ? (refuelTimer > 0 ? `Refuelling… ${Math.round(vehicle.fuel)} L` : 'Hold F to refuel') :
        vehicle.flooded ? 'Engine flooded: press R to recover' :
        vehicle.fuel <= 0 ? 'Out of fuel: return to the base camp pump (pause menu → Return to base camp)' :
        vehicle.upsideDownTimer > 1.5 ? 'Vehicle stuck on its side: press R to recover' : null);
      if (enterPressed) exitVehicle();

      const kb = { throttle: input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0, brake: input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0, steer: input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), handbrake: input.isDown('Space') ? 1 : 0 };
      if (gp) { kb.throttle = Math.max(kb.throttle, input.padButton(7)); kb.brake = Math.max(kb.brake, input.padButton(6)); if (input.padAxis(0)) kb.steer = input.padAxis(0); kb.handbrake = Math.max(kb.handbrake, input.padButton(0)); }
      acc += dt;
      let n = 0;
      while (acc >= fixedDt && n < 14) { vehicle.step(fixedDt, kb); acc -= fixedDt; n++; }
      if (n >= 14) acc = 0;
      player.pos.copy(vehicle.body.pos);
    } else {
      // vehicle still simulates when parked (handbrake on), so it can roll if left on a slope with no brake
      acc += dt;
      let n = 0;
      while (acc >= fixedDt && n < 14) { vehicle.step(fixedDt, { throttle: 0, brake: 0, steer: 0, handbrake: 1 }); acc -= fixedDt; n++; }
      if (n >= 14) acc = 0;
      const fwd = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) || -input.padAxis(1);
      const right = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) || input.padAxis(0);
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.body.quat);
      const vyaw = Math.atan2(f.x, f.z);
      player.update(dt, { forward: fwd, right, sprint: input.isDown('ShiftLeft') || input.isDown('ShiftRight') || input.padButton(10) > 0.5, jump: input.wasPressed('Space') || input.padPressed.has(0), crouch: input.isDown('KeyC') || input.padButton(1) > 0.5, camYaw: cam.yaw + Math.PI },
        [{ cx: vehicle.body.pos.x, cz: vehicle.body.pos.z, hx: 0.95, hz: 2.35, yaw: vyaw, top: vehicle.body.pos.y + 1.2 }]);
      const ce = canEnter();
      hud.prompt(ce ? `Press E to drive the ${vehicle.spec.name}` : null);
      if (enterPressed && ce) enterVehicle();
    }

    // particles from wheels
    for (const w of vehicle.wheels) {
      if (!w.contact) continue;
      const slip = Math.abs(w.slipRatio) + Math.abs(w.slipAngle);
      const sp = vehicle.speedKmh;
      const rate = (w.inWater ? 0.6 : 0) + (w.surface === Surface.Mud ? 0.25 + slip : 0) + ((w.surface === Surface.Dirt || w.surface === Surface.Gravel) && sp > 15 ? 0.35 : 0) + (slip > 0.3 ? 0.4 : 0);
      if (Math.random() < rate * dt * 60) {
        tmpC.set(w.inWater ? 0xdfe8ea : SURF_COL[w.surface]);
        tmpP.copy(w.contactPoint).add(tmpV.set((Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4));
        vehicle.body.pointVelocity(w.contactPoint, tmpV).multiplyScalar(-0.15);
        tmpV.y += 1 + Math.random() * 2 * (w.inWater ? 1.5 : 1);
        particles.emit(tmpP, tmpV, tmpC, 0.8 + Math.random() * 0.7);
      }
    }
    particles.update(dt);

    // audio
    const slipSum = vehicle.wheels.reduce((a, w) => a + (w.contact ? Math.abs(w.slipRatio) * 0.5 + Math.abs(w.slipAngle) : 0), 0) / 4;
    const waterAmt = vehicle.wheels.some(w => w.inWater) ? Math.min(1, vehicle.speedKmh / 20) : 0;
    audio.update(vehicle.rpm, inVehicle ? vehicle.lastInput.throttle + vehicle.lastInput.brake * (vehicle.gear < 0 ? 1 : 0) : 0, vehicle.engineOn && inVehicle, inVehicle ? slipSum : 0, waterAmt, true);
  }

  if (vehicle) {
    vModel.sync();
    cModel.sync(player, dt);
    if (flag) { const pa = flag.geometry.attributes.position as THREE.BufferAttribute; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i) + 1.1; pa.setZ(i, Math.sin(now * 0.004 + x * 2.5) * 0.12 * x); } pa.needsUpdate = true; }
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.body.quat);
    const vh = Math.atan2(f.x, f.z);
    if (inVehicle) cam.update(dt, vehicle.body.pos, vh, true, Math.abs(vehicle.forwardSpeed()), vehicle.body.quat);
    else cam.update(dt, player.pos, player.heading, false, 0);
    // shadow camera follows the action
    const focus = inVehicle ? vehicle.body.pos : player.pos;
    sun.position.copy(focus).addScaledVector(sunDir, 200); sun.target.position.copy(focus);
    if (started) {
      const camLook = new THREE.Vector3(); camera.getWorldDirection(camLook);
      const viewYaw = Math.atan2(camLook.x, camLook.z);
      hud.update(dt, { px: focus.x, pz: focus.z, viewYaw, inVehicle, v: vehicle, vx: vehicle.body.pos.x, vz: vehicle.body.pos.z, vHeading: vh, stamina: player.stamina, surface: terrain.surfaceAt(focus.x, focus.z) });
    }
    renderer.render(scene, camera);
  }
  input.endFrame();
}

init();
