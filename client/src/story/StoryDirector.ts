import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import {
  StoryWorld, MissionSim, Npc, Character, EZRA, CUTSCENES, MISSIONS, MISSION_BY_ID, PAGES, pageWhere, GANGS, GANGSTERS, LEADERS, MASTER, UG_GUARDS,
  gangsterLook, gangsterById, missionLock, ugGateOpen, inUnderground, repairFull, statureOf, sanitizeAppearance, CLOTH_COLORS,
  type Vehicle, type Terrain, type SimEnemy, type CharacterAppearance, type Career, type GangId, type Interactable,
} from '@orl/shared';
import { VehicleView } from '../vehicles/VehicleView';
import { CharacterView } from '../characters/CharacterView';
import type { CameraRig } from '../cameras/CameraRig';
import type { Environment } from '../rendering/Environment';
import type { Hud } from '../ui/Hud';
import type { BankResult } from '../garage/Bank';
import { UndergroundRenderer } from './UndergroundRenderer';
import { CompoundRenderer } from './CompoundRenderer';
import { MarkerRenderer, type WorldMarker } from './MarkerRenderer';
import { CutscenePlayer } from './CutscenePlayer';
import { StoryUI } from './StoryUI';
import type { GarageRequest } from '@orl/shared';

/**
 * Runs the campaign in the game: mission start beams and briefings, the mission runtime (enemy vehicles with their
 * drivers, objectives, markers, HUD), cutscenes, Ezra at camp, the gangs' guards at their compounds, journal pages,
 * and the underground (the descent, its halls and gates, repair bays, the way back up). Rewards always go through
 * the bank (the server online), never straight into the career.
 */
export interface StoryHost {
  scene: Scene; terrain: Terrain; rig: CameraRig; env: Environment; hud: Hud; canvas: HTMLCanvasElement;
  readonly inVehicle: boolean; readonly vehicle: Vehicle; readonly player: Character;
  career(): Career;
  request(r: GarageRequest): Promise<BankResult>;
  addCasters(m: AbstractMesh[]): void; removeCasters(m: AbstractMesh[]): void;
  /** keep: meshes that stay visible underground (vehicles, people) */
  keepMeshes(): Set<AbstractMesh>;
  /** stop/allow the player's controls (briefings, cutscenes) */
  setControlLock(on: boolean): void;
  online(): boolean;
}
interface EnemyView { v: VehicleView; c: CharacterView }
const START_R = 12;
const GUARD_RANGE = 260;

export class StoryDirector {
  readonly world: StoryWorld;
  readonly ui: StoryUI;
  readonly underground: UndergroundRenderer;
  readonly compounds: CompoundRenderer;
  private markers: MarkerRenderer;
  readonly cutscenes: CutscenePlayer;
  sim: MissionSim | null = null;
  private views = new Map<string, EnemyView>();
  /** wrecks and views of a finished mission linger a few seconds */
  private cleanupIn = 0;
  tracked: string | null = null;
  /** what the player can do here (Y), shown on the prompt line */
  prompt: string | null = null;
  private action: (() => void) | null = null;
  ezra: Npc; ezraView: CharacterView;
  private guards: { gang: GangId; ch: Character; view: CharacterView | null; look: CharacterAppearance }[] = [];
  /** player is in the underground (surface hidden, cave lit) */
  below = false;
  private hidden: AbstractMesh[] = [];
  private savedEnv: { clear: Color4; fog: Color3; density: number; sun: number; hemi: number; hemiColor: Color3; ground: Color3 } | null = null;
  private busy = false;
  private pagesBusy = new Set<string>();
  private repairCooldown = new Set<number>();
  private lastMission: string | null = null;

  constructor(private h: StoryHost) {
    this.world = new StoryWorld(h.terrain);
    this.ui = new StoryUI(() => h.career());
    this.underground = new UndergroundRenderer(h.scene, h.terrain);
    this.compounds = new CompoundRenderer(h.scene, h.terrain.compounds);
    h.addCasters(this.compounds.meshes);
    this.markers = new MarkerRenderer(h.scene, h.terrain);
    this.cutscenes = new CutscenePlayer(h.rig.camera, this.world, h.terrain, h.canvas);
    this.ezra = new Npc(EZRA, h.terrain);
    this.ezra.body.stature = statureOf(EZRA.appearance) / 1.75;
    this.ezraView = new CharacterView(h.scene, EZRA.appearance);
    h.addCasters(this.ezraView.meshes);
    this.ui.onStart = id => void this.begin(id);
    this.ui.onTrack = id => { this.tracked = id; this.ui.closeJournal(); this.h.setControlLock(false); this.h.hud.toast(`Tracking: ${MISSION_BY_ID[id].title}`); };
    this.ui.onClose = () => { this.ui.closeJournal(); this.h.setControlLock(false); };
    this.ui.onRetry = () => { if (this.lastMission) void this.begin(this.lastMission, true); };
    // the gangs' guards stand at their compounds until their leader falls
    for (const c of h.terrain.compounds) if (c.gang) {
      const members = GANGSTERS.filter(m => m.gang === c.gang);
      c.posts.forEach((p, i) => {
        const ch = new Character(h.terrain); ch.place(p[0], p[1]); ch.heading = c.heading + (i % 2 ? 0.4 : -0.4);
        this.guards.push({ gang: c.gang as GangId, ch, view: null, look: gangsterLook(members[i % members.length]) });
      });
    }
  }

  // ------------------------------------------------------------------ physics hook
  substep(dt: number, player: Vehicle | null) { this.sim?.substep(dt, player); }

  get active() { return !!this.sim && this.sim.status === 'running'; }
  get cutscene() { return !!this.cutscenes.active; }
  get modal() { return this.ui.briefingOpen || this.ui.journalOpen || this.cutscene; }

  /** People the player can talk to (Ezra). */
  interactables(): Interactable[] {
    if (this.below) return [];
    const b = this.ezra.body.pos;
    return [{ id: `npc:${EZRA.id}`, kind: 'npc', x: b.x, z: b.z, radius: 2.6, label: `talk to ${EZRA.name}` }];
  }
  /** Ezra's dialogue action: "You knew my father?" completes the first mission. */
  talk() {
    const s = this.sim;
    if (s && s.def.id === 'p1-legacy') { s.signal('talk'); return; }
    if (!this.h.career().story.done.includes('p1-legacy') && !this.sim) void this.begin('p1-legacy').then(() => this.sim?.signal('talk'));
  }

  // ------------------------------------------------------------------ input
  /** Keys the story owns this frame. Returns true when the key was used. */
  key(code: string): boolean {
    if (this.cutscene) { if (code === 'Space' || code === 'Enter') this.cutscenes.skipLine(); else if (code === 'Escape') this.cutscenes.skipAll(); return true; }
    if (this.ui.resultOpen && (code === 'Enter' || code === 'Escape' || code === 'KeyY')) { document.getElementById('res-ok')!.click(); return true; }
    if (this.ui.briefingOpen) {
      if (code === 'Escape') { this.ui.closeBriefing(); this.h.setControlLock(false); return true; }
      if (code === 'Enter' || code === 'KeyY') { document.getElementById('br-start')!.click(); return true; }
      return false;
    }
    if (code === 'KeyJ') { if (this.ui.journalOpen) { this.ui.closeJournal(); this.h.setControlLock(false); } else { this.ui.openJournal(); this.h.setControlLock(true); } return true; }
    if (this.ui.journalOpen && code === 'Escape') { this.ui.closeJournal(); this.h.setControlLock(false); return true; }
    if (code === 'KeyY' && this.action) { this.action(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ missions
  private briefing(id: string) {
    const m = MISSION_BY_ID[id];
    this.ui.briefing(m); this.h.setControlLock(true);
  }
  /** Start a mission: the bank (server online) records the start; then the intro, then the action. */
  async begin(id: string, retry = false) {
    if (this.busy) return;
    const m = MISSION_BY_ID[id]; if (!m) return;
    this.ui.closeBriefing();
    if (this.sim && this.sim.status === 'running') { this.sim.abort(); await this.h.request({ op: 'story-quit' }); }
    this.busy = true;
    const r = await this.h.request({ op: 'story-start', mission: id });
    this.busy = false;
    if (!r.ok) { this.h.hud.toast(r.msg); this.h.setControlLock(false); return; }
    this.clearMission();
    this.lastMission = id; this.tracked = id;
    const sim = new MissionSim(this.world, m);
    this.sim = sim;
    // races and hall challenges start on their grid
    const ph0 = m.phases[0], v = this.h.vehicle;
    if (this.h.inVehicle && (ph0.kind === 'race' || ph0.kind === 'precision' || retry || (sim.underground && m.id !== 'finale'))) {
      const s = sim.startPose; v.reset(s.x, s.z, s.heading); this.h.rig.yaw = s.heading + Math.PI;
    }
    if (retry) { repairFull(v.condition); v.fuel = Math.max(v.fuel, v.spec.fuelCapacity * 0.5); }
    this.h.setControlLock(false);
    if (m.intro && CUTSCENES[m.intro]) await this.playCutscene(m.intro);
    this.h.hud.toast(`${m.title}: ${ph0.text}`);
  }
  async playCutscene(id: string) {
    const c = CUTSCENES[id]; if (!c) return;
    this.h.setControlLock(true);
    const boss = () => {
      const s = this.sim; if (!s) return null;
      const e = s.enemies.find(x => x.boss && x.state === 'active') ?? s.enemies.find(x => x.boss);
      if (e && e.state !== 'waiting') { const p = e.vehicle.body.pos; return new Vector3(p.x, p.y, p.z); }
      const d = s.def.enemies.find(x => x.boss); if (!d) return null;
      const w = this.world.where(d.at); return new Vector3(w.x, this.h.terrain.heightAt(w.x, w.z) + 1, w.z);
    };
    await this.cutscenes.play(c, { player: () => { const p = this.h.inVehicle ? this.h.vehicle.body.pos : this.h.player.pos; return new Vector3(p.x, p.y + 1, p.z); }, boss });
    this.h.setControlLock(false);
  }
  /** New game or loaded save: no mission, no cutscene, back on the surface (the position decides from there). */
  reset() {
    this.cutscenes.stop();
    this.clearMission();
    this.ui.closeBriefing(); this.ui.closeJournal(); document.getElementById('mission-result')?.classList.add('hidden');
    this.tracked = null; this.lastMission = null; this.busy = false;
    if (this.below) this.setBelow(false);
    this.h.setControlLock(false);
  }
  abandon() {
    if (!this.sim || this.sim.status !== 'running') return false;
    this.sim.abort();
    void this.h.request({ op: 'story-quit' });
    return true;
  }
  private clearMission() {
    for (const [, ev] of this.views) { this.h.removeCasters([...ev.v.meshes, ...ev.c.meshes]); ev.c.attach(null); ev.v.dispose(); ev.c.dispose(); }
    this.views.clear(); this.sim = null; this.cleanupIn = 0;
    this.ui.hud(null); this.h.hud.target = null; this.h.hud.blips = [];
  }
  private lookOf(e: SimEnemy): CharacterAppearance {
    const g = gangsterById(e.def.who);
    if (g) return gangsterLook(g);
    // Crowe's guards: black and grey
    return sanitizeAppearance({ body: e.key.length % 2 ? 'male' : 'female', height: 0.5, build: 0.6, skin: (e.key.charCodeAt(0) % 6), face: 'square', eyes: 0, hair: 'buzz', hairColor: 0, beard: 'none', top: 'field-jacket', topColor: 6, variant: 0, pantsColor: 6, boots: 'tall', gloves: 'work', headwear: 'helmet', headwearColor: 6, accessories: [] });
  }
  private spawnView(e: SimEnemy) {
    if (this.views.has(e.key)) return;
    const v = new VehicleView(this.h.scene, e.vehicle), c = new CharacterView(this.h.scene, this.lookOf(e));
    v.setHeadlights(this.below);
    this.views.set(e.key, { v, c });
    this.h.addCasters([...v.meshes, ...c.meshes]);
    e.vehicle.onImpact = ((orig => ev => { orig?.(ev); v.dent(ev); })(e.vehicle.onImpact));
  }

  private async finish(won: boolean) {
    const s = this.sim!, m = s.def;
    if (!won) {
      void this.h.request({ op: 'story-quit' });
      this.ui.result(false, m.title, s.failReason, true);
      this.cleanupIn = 6;
      return;
    }
    if (m.id === 'p2-footsteps') await this.waitPages();
    const r = await this.h.request({ op: 'story-done', mission: m.id });
    this.cleanupIn = 6;
    if (!r.ok) { this.ui.result(false, m.title, r.msg, true); return; }
    if (m.outro && CUTSCENES[m.outro]) await this.playCutscene(m.outro);
    const next = MISSIONS.find(x => !this.h.career().story.done.includes(x.id) && !missionLock(this.h.career().story, x));
    this.tracked = next?.id ?? null;
    this.ui.result(true, m.title, `${r.msg}${next ? ` · Next: ${next.title}` : ''}`, false);
    this.syncGates();
  }
  private async waitPages() { for (let k = 0; k < 40 && this.pagesBusy.size; k++) await new Promise(r => setTimeout(r, 50)); }

  // ------------------------------------------------------------------ per frame
  /** Returns true when a cutscene owns the camera this frame. */
  update(dt: number): boolean {
    const H = this.h, inV = H.inVehicle, pv = inV ? H.vehicle : null;
    const p = inV ? H.vehicle.body.pos : H.player.pos;
    const career = H.career(), story = career.story;
    // underground or not
    const ug = inUnderground(p.x, p.z);
    if (ug !== this.below) this.setBelow(ug);
    this.compounds.update(H.rig.camera.position);
    this.underground.update(H.rig.camera.position);
    // Ezra and the guards
    this.ezra.update(dt, []);
    this.ezraView.setVisible(!this.below);
    if (!this.below) this.ezraView.sync(this.ezra.body, dt, this.ezra.state === 'talk' ? { mode: 'talk' } : {});
    this.updateGuards(dt, p.x, p.z, story.defeated);
    // the mission
    const sim = this.sim;
    if (sim) {
      sim.update(dt, { x: p.x, z: p.z, vx: inV ? H.vehicle.body.vel.x : H.player.vel.x, vz: inV ? H.vehicle.body.vel.z : H.player.vel.z, vehicle: pv });
      for (const ev of sim.events.splice(0)) this.onEvent(ev, sim);
      for (const e of sim.enemies) {
        const view = this.views.get(e.key); if (!view) continue;
        view.v.sync();
        const [x, y, z] = e.vehicle.spec.look.seat;
        view.c.attach(view.v.root); view.c.sync(null, dt, { mode: 'seated', local: { x, y, z, yaw: 0 }, steer: e.vehicle.wheels[0].steer / e.vehicle.spec.maxSteer });
      }
      if (sim.status === 'running') {
        this.ui.hud(sim.hud());
        const o = sim.objectivePoint();
        H.hud.target = o ? { ...o, label: sim.phase.text } : null;
        H.hud.blips = sim.enemies.filter(e => e.state === 'active').map(e => ({ x: e.vehicle.body.pos.x, z: e.vehicle.body.pos.z, color: e.boss ? '#ff2a2a' : '#ff8a3a' }));
      } else if (this.cleanupIn > 0) {
        this.ui.hud(null); H.hud.target = null; H.hud.blips = [];
        this.cleanupIn -= dt;
        if (this.cleanupIn <= 0 && !this.ui.resultOpen) this.clearMission();
      }
    } else if (this.tracked) {
      const m = MISSION_BY_ID[this.tracked];
      if (story.done.includes(m.id) && this.tracked !== this.lastMission) this.tracked = null;
      else { const w = this.world.where(m.start); H.hud.target = { x: w.x, z: w.z, label: m.title }; }
    } else H.hud.target = null;
    // markers: mission starts nearby, free-roam journal pages, the underground doors
    const list: WorldMarker[] = sim && sim.status === 'running' ? [...sim.markers()] : [];
    this.prompt = null; this.action = null;
    if (!sim || sim.status !== 'running') this.offerMissions(p.x, p.z, list, story);
    this.offerPages(p.x, p.z, list, story);
    this.offerUnderground(p.x, p.z, list, story);
    if (this.below) this.repairBays(p.x, p.z);
    const cp = H.rig.camera.position; this.markers.update(list, dt, { x: cp.x, z: cp.z });
    this.syncGates();
    // cutscene camera
    return this.cutscenes.update(dt);
  }

  private onEvent(ev: MissionSim['events'][number], sim: MissionSim) {
    const H = this.h;
    switch (ev.type) {
      case 'spawn': { const e = sim.enemies.find(x => x.key === ev.key); if (e) this.spawnView(e); break; }
      case 'wreck': H.hud.toast(`${ev.name} taken down`); break;
      case 'phase': if (ev.index > 0) H.hud.toast(ev.text); break;
      case 'collect': {
        if (ev.page) { const pg = PAGES[ev.index]; if (pg) this.pickPage(pg.id); }
        else H.hud.toast('Data drive secured');
        break;
      }
      case 'pylon': H.hud.toast('Pylon down'); break;
      case 'hit': H.hud.toast(`Hit ${ev.n} of ${ev.of}`); break;
      case 'won': void this.finish(true); break;
      case 'lost': void this.finish(false); break;
    }
  }
  private pickPage(id: string) {
    if (this.pagesBusy.has(id) || this.h.career().story.pages.includes(id)) return;
    this.pagesBusy.add(id);
    void this.h.request({ op: 'story-page', page: id }).then(r => { this.pagesBusy.delete(id); this.h.hud.toast(r.msg); });
  }

  private offerMissions(x: number, z: number, list: WorldMarker[], story: Career['story']) {
    for (const m of MISSIONS) {
      if (missionLock(story, m) || m.id === 'p1-legacy') continue;
      const done = story.done.includes(m.id);
      if (done && m.id !== this.tracked) continue;
      const ugm = m.chapter === 'underground' && m.id !== 'ug-descent' || m.chapter === 'finale';
      if (ugm !== this.below) continue;
      const w = this.world.where(m.start), d = Math.hypot(w.x - x, w.z - z);
      if (d > 1500) continue;
      list.push({ kind: 'start', x: w.x, z: w.z, r: START_R });
      if (d < START_R && !this.action) {
        const needVehicle = !m.onFoot && !this.h.inVehicle;
        this.prompt = needVehicle ? `${m.title}: get in a vehicle to start` : `Y: ${done ? 'replay' : 'start'} "${m.title}"`;
        if (!needVehicle) this.action = () => this.briefing(m.id);
      }
    }
  }
  private offerPages(x: number, z: number, list: WorldMarker[], story: Career['story']) {
    if (this.below || !story.done.includes('p1-legacy')) return;
    const inP2 = this.sim?.def.id === 'p2-footsteps' && this.sim.status === 'running';
    PAGES.forEach((pg, i) => {
      if (story.pages.includes(pg.id) || (i < 3 && !inP2) || (inP2 && i < 3)) return;
      const w = this.world.where(pageWhere(pg)), d = Math.hypot(w.x - x, w.z - z);
      if (d > 600) return;
      list.push({ kind: 'page', x: w.x, z: w.z, r: 6 });
      if (d < 9) this.pickPage(pg.id);
    });
  }
  private offerUnderground(x: number, z: number, list: WorldMarker[], story: Career['story']) {
    if (!story.done.includes('ug-descent') && !(this.sim?.def.id === 'ug-descent' && this.sim.phase.kind === 'descend')) return;
    if (this.active && this.sim!.def.id !== 'ug-descent') return;
    if (!this.below) {
      const w = this.world.where({ at: 'compound', site: 'ug-entrance', lx: 0, lz: 2 }), d = Math.hypot(w.x - x, w.z - z);
      if (d < 14 && this.h.inVehicle && !this.action) { this.prompt = 'Y: drive down into the underground'; this.action = () => void this.descend(); }
    } else {
      const U = this.h.terrain.underground, [ex, ez] = U.pointIn(U.entry, Math.PI, 0.72);
      list.push({ kind: 'exit', x: ex, z: ez, r: 8 });
      if (Math.hypot(ex - x, ez - z) < 10 && !this.action) { this.prompt = 'Y: take the lift back to the surface'; this.action = () => void this.ascend(); }
    }
  }
  private repairBays(x: number, z: number) {
    const U = this.h.terrain.underground, c = U.chamberAt(x, z);
    for (const i of [...this.repairCooldown]) if (!c || c.index !== i) this.repairCooldown.delete(i);
    if (!c || c.kind !== 'repair' || this.repairCooldown.has(c.index) || !this.h.inVehicle) return;
    if (Math.hypot(c.x - x, c.z - z) > c.r * 0.6) return;
    this.repairCooldown.add(c.index);
    const v = this.h.vehicle; repairFull(v.condition); v.overheated = false; v.engineTemp = Math.min(v.engineTemp, 90); v.fuel = v.spec.fuelCapacity;
    if (!v.engineOn && v.canStart()) v.engineOn = true;
    this.h.hud.toast(`${c.name}: Ezra's people patched you up and filled the tank`);
  }

  /** Through the gate: the bank (server) checks the keys and allows the jump to the underground's coordinates. */
  async descend() {
    if (this.busy) return;
    this.busy = true;
    const r = await this.h.request({ op: 'ug-enter' });
    this.busy = false;
    if (!r.ok) { this.h.hud.toast(r.msg); return; }
    const U = this.h.terrain.underground, [x, z] = U.pointIn(U.entry, Math.PI, 0.45), v = this.h.vehicle;
    this.setBelow(true);
    this.underground.prime(new Vector3(x, U.heightAt(x, z), z));
    v.reset(x, z, U.headingOut(U.entry)); this.h.rig.yaw = U.headingOut(U.entry) + Math.PI;
    if (this.sim?.def.id === 'ug-descent') this.sim.signal('descend');
    else this.h.hud.toast('The underground: Iron Gate Hall');
  }
  async ascend() {
    if (this.busy) return;
    this.busy = true;
    const r = await this.h.request({ op: 'ug-exit' });
    this.busy = false;
    if (!r.ok) { this.h.hud.toast(r.msg); return; }
    if (this.sim && this.sim.status === 'running') { this.sim.abort(); }
    const w = this.world.where({ at: 'compound', site: 'ug-entrance', lx: 0, lz: 24 }), v = this.h.vehicle;
    this.setBelow(false);
    v.reset(w.x, w.z, w.heading); this.h.rig.yaw = w.heading + Math.PI;
    this.h.hud.toast('Back on the surface');
  }

  /** Gates follow the story: beaten halls stay open. */
  private syncGates() {
    const T = this.h.terrain, U = T.underground, s = this.h.career().story, active = this.sim && this.sim.status === 'running' ? this.sim.def.id : null;
    U.gates.forEach((_, i) => { const open = ugGateOpen(U, i, s.done, active); if (T.gateOpen[i] !== open) T.setGate(i, open); });
  }

  /** Swap between the island and the caves: surface meshes off, cave on, light and fog of a cavern. */
  private setBelow(on: boolean) {
    if (on === this.below) return;
    this.below = on;
    const sc = this.h.scene, env = this.h.env;
    this.h.hud.dark = on;
    if (on) {
      const keep = this.h.keepMeshes();
      for (const m of this.underground.meshes) keep.add(m);
      for (const v of this.views.values()) { for (const m of v.v.meshes) keep.add(m); for (const m of v.c.meshes) keep.add(m); }
      this.hidden = sc.meshes.filter(m => m.isEnabled() && !keep.has(m) && !(m.parent && keep.has(m.parent as AbstractMesh)) && !m.name.startsWith('marker') && !this.isMarker(m));
      for (const m of this.hidden) m.setEnabled(false);
      this.savedEnv = { clear: sc.clearColor.clone(), fog: sc.fogColor.clone(), density: sc.fogDensity, sun: env.sun.intensity, hemi: env.hemi.intensity, hemiColor: env.hemi.diffuse.clone(), ground: env.hemi.groundColor.clone() };
      sc.clearColor = new Color4(0.02, 0.02, 0.025, 1); sc.fogColor = new Color3(0.03, 0.03, 0.035); sc.fogDensity = 0.0035;
      env.sun.intensity = 0; env.hemi.intensity = 0.42; env.hemi.diffuse = new Color3(0.9, 0.78, 0.62); env.hemi.groundColor = new Color3(0.12, 0.1, 0.09);
      this.underground.setEnabled(true); this.compounds.setEnabled(false);
    } else {
      for (const m of this.hidden) m.setEnabled(true);
      this.hidden = [];
      const e = this.savedEnv;
      if (e) { sc.clearColor = e.clear; sc.fogColor = e.fog; sc.fogDensity = e.density; env.sun.intensity = e.sun; env.hemi.intensity = e.hemi; env.hemi.diffuse = e.hemiColor; env.hemi.groundColor = e.ground; }
      this.underground.setEnabled(false); this.compounds.setEnabled(true);
    }
    for (const v of this.views.values()) v.v.setHeadlights(on);
  }
  private isMarker(m: AbstractMesh) { return !!m.material?.name.startsWith('marker-'); }

  private updateGuards(dt: number, x: number, z: number, defeated: string[]) {
    for (const g of this.guards) {
      const near = !this.below && Math.hypot(g.ch.pos.x - x, g.ch.pos.z - z) < GUARD_RANGE && !defeated.includes(LEADERS[g.gang].id) && !(this.sim && this.sim.status === 'running');
      if (near && !g.view) { g.view = new CharacterView(this.h.scene, g.look); this.h.addCasters(g.view.meshes); }
      if (!near && g.view) { this.h.removeCasters(g.view.meshes); g.view.dispose(); g.view = null; }
      if (g.view) { g.ch.state = 'idle'; g.ch.speed = 0; g.ch.grounded = true; g.ch.pos.y = this.h.terrain.heightAt(g.ch.pos.x, g.ch.pos.z); g.view.sync(g.ch, dt); }
    }
  }
}
void GANGS; void UG_GUARDS; void MASTER; void CLOTH_COLORS;
export type { Mesh };
