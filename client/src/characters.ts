import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DEFAULT_MALE, DEFAULT_FEMALE, OUTFIT_VARIANTS, type Character, type CharacterAppearance } from '@orl/shared';
import { CharacterView, characterStats } from './characters/CharacterView';
import { Environment } from './rendering/Environment';
import { PRESETS } from './config/settings';

/**
 * Character room (dev page, /characters.html): the lead characters and their outfit variants on a pad under
 * the game's sky and lighting, for checking the models (and taking the reference-view screenshots).
 */
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, stencil: true, adaptToDeviceRatio: true }, true);
const scene = new Scene(engine);
scene.useRightHandedSystem = true;
const cam = new ArcRotateCamera('cam', Math.PI / 2 - 3.3, 1.45, 3.2, new Vector3(0, 0.95, 0), scene);
cam.attachControl(canvas, true); cam.lowerRadiusLimit = 0.4; cam.upperRadiusLimit = 30; cam.wheelPrecision = 60; cam.minZ = 0.02; cam.fov = 0.6;
const env = new Environment(scene, cam);
const params = new URLSearchParams(location.search);
env.apply({ ...PRESETS.high, shadows: 'basic' });
const ground = MeshBuilder.CreateGround('ground', { width: 400, height: 400 }, scene);
const gm = new PBRMaterial('ground', scene); gm.albedoColor = new Color3(0.2, 0.19, 0.17); gm.roughness = 0.9; gm.metallic = 0; ground.material = gm; ground.receiveShadows = true;
const pad = MeshBuilder.CreateDisc('pad', { radius: 1.2, tessellation: 64 }, scene); pad.rotation.x = Math.PI / 2; pad.position.y = 0.002;
const pm = new PBRMaterial('pad', scene); pm.albedoColor = new Color3(0.26, 0.27, 0.29); pm.roughness = 0.4; pm.metallic = 0.2; pad.material = pm; pad.receiveShadows = true;

const looks: { name: string; a: CharacterAppearance }[] = [];
for (const [n, base] of [['Male lead', DEFAULT_MALE], ['Female lead', DEFAULT_FEMALE]] as const)
  OUTFIT_VARIANTS.forEach((v, i) => looks.push({ name: `${n} · ${v}`, a: { ...base, variant: i } }));
// ?set=beard:none,hair:bald overrides fields of every look (debugging)
for (const kv of (params.get('set') ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split(':');
  for (const l of looks) (l.a as unknown as Record<string, unknown>)[k] = k === 'accessories' ? v.split('+').filter(Boolean) : isNaN(+v) ? v : +v;
}
const view = new CharacterView(scene, looks[0].a);
view.forceLod = params.has('lod') ? +params.get('lod')! : 0;
for (const m of view.meshes) env.addShadowCaster(m);
view.onRebuild = (added, removed) => { for (const m of removed) env.removeShadowCaster(m); for (const m of added) env.addShadowCaster(m); };

// a stand-in controller so the locomotion poses can be previewed (walk / run)
const heading = params.has('heading') ? +params.get('heading')! : 3.3; // face the afternoon sun
const fake = { pos: { x: 0, y: 0, z: 0 }, heading, state: 'idle', speed: 0, animPhase: 0, landSpeed: 0 } as unknown as Character;
let gait: 'idle' | 'walk' | 'run' = (params.get('pose') as 'idle' | 'walk' | 'run') ?? 'idle';

const nameEl = document.getElementById('name')!, bar = document.getElementById('bar')!;

function show(i: number) {

  view.applyAppearance(looks[i].a);
  nameEl.innerHTML = `${looks[i].name}<small>${characterStats.vertices.map((v, k) => `LOD${k} ${v.toLocaleString()} verts / ${characterStats.drawCalls[k]} draws`).join(' · ')}</small>`;
  [...bar.children].forEach((b, k) => b.classList.toggle('on', k === i));
}
looks.forEach((l, i) => { const b = document.createElement('button'); b.textContent = l.name; b.onclick = () => show(i); bar.appendChild(b); });
for (const g of ['idle', 'walk', 'run'] as const) { const b = document.createElement('button'); b.textContent = g; b.onclick = () => { gait = g; }; bar.appendChild(b); }
const startLook = params.get('look') === 'female' ? 4 : 0;
show(startLook + Math.max(0, OUTFIT_VARIANTS.indexOf((params.get('variant') ?? 'classic') as typeof OUTFIT_VARIANTS[number])));
if (params.get('ui') === '0') { bar.style.display = 'none'; nameEl.style.display = 'none'; }
let frozen = params.has('freeze');
(window as unknown as Record<string, unknown>).__char = {
  show, cam, view, scene, engine, looks, stats: characterStats,
  /** camera around the figure: alpha (0 = from +x, pi/2 = from the front), beta from the zenith */
  view3(alpha: number, beta: number, radius: number, ty = 0.95) { const k = view.stature / 1.8; cam.alpha = alpha - heading; cam.beta = beta; cam.radius = radius * (ty > 1.2 ? 1 : k); cam.target.set(0, ty * k, 0); },
  setGait(g: 'idle' | 'walk' | 'run') { gait = g; }, freeze(v: boolean) { frozen = v; },
  step(dt: number, n = 1) { for (let i = 0; i < n; i++) tick(dt); },
};
function tick(dt: number) {
  const f = fake as unknown as { state: string; speed: number; animPhase: number };
  f.state = gait; f.speed = gait === 'walk' ? 1.6 : gait === 'run' ? 4.5 : 0;
  f.animPhase += dt * (gait === 'walk' ? 5.5 : gait === 'run' ? 9 : 0);
  view.sync(fake, dt);
}
engine.runRenderLoop(() => { if (!frozen) tick(Math.min(0.05, engine.getDeltaTime() / 1000)); env.follow(Vector3.Zero()); scene.render(); });
addEventListener('resize', () => engine.resize());
