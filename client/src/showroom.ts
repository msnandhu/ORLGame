import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Vehicle, VEHICLES, type Terrain } from '@orl/shared';
import { VehicleView } from './vehicles/VehicleView';
import { Environment } from './rendering/Environment';
import { PRESETS } from './config/settings';

/**
 * Vehicle showroom (dev page, /showroom.html): every car on a turntable pad under the game's sky and lighting,
 * for checking the models without loading the island.
 */
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, stencil: true, adaptToDeviceRatio: true }, true);
const scene = new Scene(engine);
scene.useRightHandedSystem = true;
const cam = new ArcRotateCamera('cam', 0.9, 1.25, 7, new Vector3(0, 0.1, 0), scene);
cam.attachControl(canvas, true); cam.lowerRadiusLimit = 2.5; cam.upperRadiusLimit = 30; cam.wheelPrecision = 40; cam.minZ = 0.05;
const env = new Environment(scene, cam);
const params = new URLSearchParams(location.search);
env.apply({ ...PRESETS.high, shadows: 'basic' });
const ground = MeshBuilder.CreateGround('ground', { width: 400, height: 400 }, scene);
const gm = new PBRMaterial('ground', scene); gm.albedoColor = new Color3(0.2, 0.2, 0.21); gm.roughness = 0.85; gm.metallic = 0; ground.material = gm;
ground.receiveShadows = true;
const pad = MeshBuilder.CreateDisc('pad', { radius: 4.2, tessellation: 64 }, scene); pad.rotation.x = Math.PI / 2; pad.position.y = 0.002;
const pm = new PBRMaterial('pad', scene); pm.albedoColor = new Color3(0.32, 0.33, 0.35); pm.roughness = 0.35; pm.metallic = 0.2; pad.material = pm; pad.receiveShadows = true;

const fakeTerrain = {} as Terrain;
const views: { v: Vehicle; view: VehicleView }[] = [];
for (const spec of VEHICLES) {
  const v = new Vehicle(spec, fakeTerrain);
  const sag = (spec.mass * 9.81 / 4) / spec.springRate;
  for (const w of v.wheels) w.compression = sag;
  const ground = spec.mountY - spec.restLength + sag - spec.wheelRadius;
  v.body.pos.set(0, -ground, 0);
  const view = new VehicleView(scene, v, undefined, params.has('lite'));
  for (const m of view.meshes) env.addShadowCaster(m);
  view.sync(); view.root.setEnabled(false);
  views.push({ v, view });
}

const nameEl = document.getElementById('name')!, bar = document.getElementById('bar')!;
function show(i: number) {

  views.forEach((e, k) => e.view.root.setEnabled(k === i));
  const s = views[i].v.spec;
  nameEl.innerHTML = `${s.name}<small>${s.description}</small>`;
  [...bar.children].forEach((b, k) => b.classList.toggle('on', k === i));
}
views.forEach((e, i) => { const b = document.createElement('button'); b.textContent = e.v.spec.name; b.onclick = () => show(i); bar.appendChild(b); });
const start = Math.max(0, VEHICLES.findIndex(s => s.id === params.get('car')));
show(start);
if (params.has('night')) views.forEach(e => e.view.setHeadlights(true));
if (params.has('ui') && params.get('ui') === '0') { bar.style.display = 'none'; nameEl.style.display = 'none'; }
(window as unknown as Record<string, unknown>).__show = {
  show, cam, views, scene, engine,
  view(alpha: number, beta: number, radius: number, ty = 0.1) { cam.alpha = alpha; cam.beta = beta; cam.radius = radius; cam.target.set(0, ty, 0); },
  get count() { return views.length; },
};
engine.runRenderLoop(() => { env.follow(Vector3.Zero()); scene.render(); });
addEventListener('resize', () => engine.resize());
