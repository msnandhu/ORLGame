import './ui/style.css';
import { encodeAppearance, type GraphicsQuality, type CharacterAppearance } from '@orl/shared';
import { GameApp } from './core/GameApp';
import { installErrorHandling } from './core/errors';
import { loadSettings, saveSettings } from './config/settings';
import { SaveGame } from './save/SaveGame';
import { CharacterStore } from './save/CharacterStore';
import { CharacterCreator } from './ui/CharacterCreator';
import { log } from './core/logger';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const { fatal } = installErrorHandling();
const settings = loadSettings();
const canvas = $<HTMLCanvasElement>('game');
const app = new GameApp(canvas, settings);
const SERVER_KEY = 'orl.server';
const defaultServer = () => {
  // an HTTPS page may only open secure WebSockets
  const fallback = location.protocol === 'https:' ? `wss://${location.hostname}` : `ws://${location.hostname || 'localhost'}:2567`;
  try { return localStorage.getItem(SERVER_KEY) || fallback; } catch { return fallback; }
};

function showMenu() {
  $('menu').classList.remove('hidden'); $('hud').classList.add('hidden');
  $('btn-continue').classList.toggle('hidden', !SaveGame.read());
}
function play(fromSave: boolean) {
  app.newGame(fromSave);
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  app.setPaused(false); app.start();
  app.hud.toast(fromSave ? 'Save loaded · J: journal' : 'Your Ranger waits at camp. Ezra, by the track at camp, knew your father: talk to him (E). J opens the journal');
}

// ---------- character creator ----------
const creator = new CharacterCreator($('creator'), app.appearance);
let afterCreator: (() => void) | null = null;
function openCreator(then: (() => void) | null) {
  afterCreator = then;
  $('menu').classList.add('hidden');
  app.creatorOpen = true; app.creatorSpin = 0; app.input.allowLock = false;
  creator.open(app.appearance);
}
creator.onChange = a => app.setAppearance(a);
creator.onDone = (a: CharacterAppearance | null) => {
  const saved = CharacterStore.read();
  if (a) CharacterStore.write(a);
  else app.setAppearance(saved ?? creator.value); // cancel restores the stored look
  creator.close(); app.creatorOpen = false; app.input.allowLock = true;
  const next = afterCreator; afterCreator = null;
  if (next && (a || saved)) next(); else showMenu();
};

// ---------- main menu ----------
$('btn-continue').addEventListener('click', () => play(true));
// the first new game opens the creator so the player picks a look before driving
$('btn-new').addEventListener('click', () => (CharacterStore.read() ? play(false) : openCreator(() => play(false))));
$('btn-character').addEventListener('click', () => openCreator(null));
$('btn-mp').addEventListener('click', async () => {
  const url = ($<HTMLInputElement>('opt-server').value || defaultServer()).trim();
  const status = $('menu-status');
  status.textContent = `Connecting to ${url}…`;
  const ok = await app.net.connect(url, 'Explorer' + Math.floor(Math.random() * 900 + 100), encodeAppearance(app.appearance));
  if (ok) { status.textContent = ''; play(false); app.hud.toast('Joined free roam server'); }
  else status.textContent = `Could not reach ${url}. Start one with "npm run dev:server", or set the address in Settings.`;
});
$('btn-map').addEventListener('click', () => app.toggleMap());
// story and challenges: into the game (the save if there is one) with the journal open
const story = (tab: 'missions' | 'challenges') => {
  const go = () => { play(!!SaveGame.read()); app.openJournal(tab); };
  if (CharacterStore.read()) go(); else openCreator(go);
};
$('btn-story').addEventListener('click', () => story('missions'));
$('btn-challenges').addEventListener('click', () => story('challenges'));
$('btn-abandon').addEventListener('click', () => { if (app.story.abandon()) app.hud.toast('Mission abandoned'); app.setPaused(false); });
$('btn-garage').addEventListener('click', () => app.openGarage('Main menu'));
$('btn-pause-map').addEventListener('click', () => app.toggleMap());
$('btn-menu-settings').addEventListener('click', () => $('settings').classList.remove('hidden'));

// ---------- pause menu ----------
$('btn-resume').addEventListener('click', () => { app.setPaused(false); canvas.requestPointerLock?.(); });
$('btn-save').addEventListener('click', () => app.save());
$('btn-recover').addEventListener('click', () => { app.vehicle.recover(); app.setPaused(false); app.hud.toast('Vehicle recovered'); });
$('btn-camp').addEventListener('click', () => {
  const msg = app.returnToCamp();
  app.setPaused(false); app.hud.toast(msg);
});
for (const [id, place] of [['btn-go-camp', 'camp'], ['btn-go-city', 'halden'], ['btn-go-town', 'millbrook'], ['btn-go-village', 'ashby']] as const) {
  $(id).addEventListener('click', () => { const msg = app.travelTo(place); app.setPaused(false); canvas.requestPointerLock?.(); app.hud.toast(msg); });
}
$('btn-settings').addEventListener('click', () => $('settings').classList.remove('hidden'));
$('btn-help').addEventListener('click', () => $('help').classList.toggle('hidden'));
$('btn-quit').addEventListener('click', () => { app.cancelInteraction(); app.save(); app.net.disconnect(); app.setPaused(false); app.started = false; app.audio.suspend(); showMenu(); });

// ---------- settings ----------
const gfx = $<HTMLSelectElement>('opt-gfx'), adaptive = $<HTMLInputElement>('opt-adaptive'), webgpu = $<HTMLInputElement>('opt-webgpu');
const sens = $<HTMLInputElement>('opt-sens'), inv = $<HTMLInputElement>('opt-invert'), vol = $<HTMLInputElement>('opt-vol'), fps = $<HTMLInputElement>('opt-fps'), server = $<HTMLInputElement>('opt-server');
gfx.value = settings.graphics; adaptive.checked = settings.adaptiveQuality; webgpu.checked = settings.preferWebGPU;
sens.value = String(settings.mouseSensitivity); inv.checked = settings.invertY; vol.value = String(settings.volume); fps.checked = settings.showFps; server.value = defaultServer();
gfx.addEventListener('change', () => { settings.graphics = gfx.value as GraphicsQuality; app.applyGraphics(); });
adaptive.addEventListener('change', () => { settings.adaptiveQuality = adaptive.checked; app.applyGraphics(); });
webgpu.addEventListener('change', () => { settings.preferWebGPU = webgpu.checked; saveSettings(settings); app.hud?.toast('Renderer preference applies after reload'); });
sens.addEventListener('input', () => { settings.mouseSensitivity = +sens.value; app.rig.sensitivity = settings.mouseSensitivity; saveSettings(settings); });
inv.addEventListener('change', () => { settings.invertY = inv.checked; app.rig.invertY = inv.checked; saveSettings(settings); });
vol.addEventListener('input', () => { settings.volume = +vol.value; app.audio.setVolume(settings.volume); saveSettings(settings); });
fps.addEventListener('change', () => { settings.showFps = fps.checked; saveSettings(settings); });
server.addEventListener('change', () => { try { localStorage.setItem(SERVER_KEY, server.value.trim()); } catch { /* storage blocked */ } });
$('btn-settings-close').addEventListener('click', () => $('settings').classList.add('hidden'));
for (const id of ['help']) $(id).addEventListener('click', () => $(id).classList.add('hidden'));

// ---------- boot ----------
const fill = $('load-fill'), label = $('load-label');
app.init((f, l) => { fill.style.width = `${Math.round(f * 100)}%`; label.textContent = l; })
  .then(() => { $('loading').classList.add('hidden'); showMenu(); log.info('boot', 'Ready'); })
  .catch(e => {
    // WebGPU drivers vary a lot; if anything fails on WebGPU, retry once on WebGL2 instead of stopping
    let retried = false;
    try { retried = sessionStorage.getItem('orl.webgl2-retry') === '1'; } catch { /* storage blocked */ }
    if (app.backend === 'WebGPU' && !retried) {
      log.warn('boot', 'Start-up failed on WebGPU; switching to WebGL2 and reloading', e);
      settings.preferWebGPU = false; saveSettings(settings);
      try { sessionStorage.setItem('orl.webgl2-retry', '1'); } catch { /* storage blocked */ }
      location.reload();
      return;
    }
    fatal('The game could not start', e);
  });
