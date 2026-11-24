import { Vehicle, type VehicleInput } from '../vehicles/vehicle';
import { VehicleContacts } from '../vehicles/contact';
import { vehicleById } from '../vehicles/catalog';
import { applyBuild, type VehicleBuild } from '../garage/build';
import { overallDamage } from '../vehicles/damage';
import { AiDriver, type AiTarget } from './ai';
import { gangsterById, gangBuild, displayName, LEADERS, MASTER, type Temper } from './roster';
import type { MissionDef, EnemyDef, Phase, Route, Where } from './missions';
import type { StoryWorld } from './placement';

/**
 * Runs one mission: spawns its enemies as real vehicles driven by AI, steps them with the player's vehicle at the
 * physics rate (with vehicle-to-vehicle contact), and judges each objective in turn. It has no rendering: the client
 * draws what it reports, and tests drive it headless with an autopilot.
 *
 * The client calls `substep(dt, player)` inside its fixed-rate physics loop (before stepping the player), and
 * `update(dt, player)` once per frame for the objectives.
 */
export interface SimEnemy {
  def: EnemyDef; key: string; name: string; boss: boolean;
  vehicle: Vehicle; ai: AiDriver;
  /** 1 = untouched, 0 = wrecked */
  hp: number;
  state: 'waiting' | 'active' | 'wrecked' | 'gone';
  spawnAt: number;
  build: VehicleBuild | null;
  baseKmh?: number;
}
export interface SimPlayer { x: number; z: number; vx: number; vz: number; vehicle: Vehicle | null }
export type MarkerKind = 'goal' | 'checkpoint' | 'next' | 'page' | 'pickup' | 'zone' | 'light' | 'pylon' | 'collapse' | 'exit';
export interface Marker { kind: MarkerKind; x: number; z: number; r: number; ang?: number; range?: number; half?: number }
export interface SimHud {
  title: string; objective: string;
  /** seconds left on a timer */
  timer?: number;
  /** "2 / 3" style counter */
  count?: string;
  /** a meter (hold progress, detection, catch) */
  meter?: { label: string; value: number; danger?: boolean };
  boss?: { name: string; hp: number }[];
  /** race position */
  rank?: string;
  /** big centre text (countdown) */
  banner?: string;
}
export type SimEvent =
  | { type: 'phase'; index: number; text: string }
  | { type: 'spawn'; key: string }
  | { type: 'wreck'; key: string; name: string }
  | { type: 'collect'; index: number; page: boolean }
  | { type: 'pylon'; index: number }
  | { type: 'checkpoint'; n: number; of: number }
  | { type: 'hit'; n: number; of: number }
  | { type: 'won' }
  | { type: 'lost'; reason: string };

const HOLD_DECAY = 0.5, BEAM_HALF = 0.24;
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

interface Racer { next: number; count: number; stillT?: number; sx?: number; sz?: number; init?: boolean }

export class MissionSim {
  readonly enemies: SimEnemy[] = [];
  readonly contacts = new VehicleContacts();
  readonly events: SimEvent[] = [];
  status: 'running' | 'won' | 'lost' = 'running';
  failReason = '';
  phaseIndex = 0; phaseTime = 0; elapsed = 0;
  /** the player may not move yet (race countdown) */
  frozen = false;
  /** where the player should be placed when the mission starts (races, challenges), or null to start where they are */
  readonly startPose: { x: number; z: number; heading: number };
  readonly origin: { x: number; z: number };
  // per-phase state
  private pts: [number, number][] = [];
  private loop = false;
  private total = 0;
  private racers = new Map<string, Racer>();
  private player: Racer = { next: 0, count: 0 };
  private got: boolean[] = [];
  private meter = 0;
  private hits = 0;
  private front = 0;
  private outPath: [number, number][] = []; private outCum: number[] = [];
  private catchHold = 0;
  private footTime = 0;
  private lastHitT = -1;

  constructor(readonly world: StoryWorld, readonly def: MissionDef) {
    let s = world.where(def.start);
    // a race starts on the grid: just behind its first checkpoint, facing along the course
    const ph0 = def.phases[0];
    if (ph0.kind === 'race' || ph0.kind === 'precision') {
      const pts = world.route(ph0.route), [ax, az] = pts[0], [bx, bz] = pts[1], L = Math.hypot(bx - ax, bz - az) || 1;
      // as far back as the ground allows (a hall's first gate can be close to its wall)
      let back = ph0.kind === 'race' ? 14 : 18;
      while (back > 3 && !(world.open(ax - (bx - ax) / L * back, az - (bz - az) / L * back) && world.open(ax - (bx - ax) / L * (back + 4), az - (bz - az) / L * (back + 4)))) back -= 2;
      s = { x: ax - (bx - ax) / L * back, z: az - (bz - az) / L * back, heading: Math.atan2(bx - ax, bz - az) };
    }
    this.startPose = s; this.origin = { x: s.x, z: s.z };
    for (const e of def.enemies) this.enemies.push(this.makeEnemy(e));
    this.beginPhase(0);
  }

  get phase(): Phase { return this.def.phases[this.phaseIndex]; }
  get underground() { return this.def.chapter === 'underground' && this.def.id !== 'ug-descent' || this.def.chapter === 'finale'; }
  /** challenge number of an underground mission (99 for the finale) */
  get ch(): number { return this.def.chapter === 'finale' ? 99 : Number(this.def.id.slice(3)) || 0; }

  // ------------------------------------------------------------------ enemies
  private makeEnemy(e: EnemyDef): SimEnemy {
    const T = this.world.terrain, g = gangsterById(e.who);
    const vid = e.vehicle ?? g?.vehicle ?? 'ranger-tx4';
    const build = g ? gangBuild(g) : null;
    const spec = build ? applyBuild(vehicleById(vid), build) : vehicleById(vid);
    const v = new Vehicle(spec, T);
    const ai = new AiDriver(v);
    ai.skill = e.skill ?? 0.7; ai.recoverAfter = 4;
    if (e.maxKmh) ai.maxKmh = e.maxKmh;
    const name = g ? displayName(g) : 'Crowe\'s guard';
    return { def: e, key: e.key, name, boss: !!e.boss, vehicle: v, ai, hp: 1, state: 'waiting', spawnAt: Infinity, build };
  }
  private enemy(key: string) { return this.enemies.find(e => e.key === key); }
  private place(e: SimEnemy) {
    const p = this.world.where(e.def.at);
    let h = p.heading;
    const f = e.def.face;
    if (f === 'road') h = p.heading; else if (f === 'road-back') h = p.heading + Math.PI;
    else if (typeof f === 'number') h = f;
    const route = e.def.route && this.routePts(e.def.route);
    if (route && (e.def.temper === 'racer' || e.def.temper === 'fleer' || e.def.temper === 'patrol')) {
      // face along the route from the nearest point
      let bi = 0, bd = Infinity; route.forEach(([x, z], i) => { const d = dist(x, z, p.x, p.z); if (d < bd) { bd = d; bi = i; } });
      const j = Math.min(route.length - 1, bi + 1), i = j === bi ? bi - 1 : bi;
      if (i >= 0) h = Math.atan2(route[j][0] - route[i][0], route[j][1] - route[i][1]);
    }
    e.vehicle.reset(p.x, p.z, h);
    for (let i = 0; i < 120; i++) e.vehicle.step(1 / 240, { throttle: 0, brake: 1, steer: 0, handbrake: 1 });
    e.vehicle.onImpact = ev => {
      if (e.state !== 'active') return;
      const armor = e.def.armor ?? 1;
      // armoured rigs shrug off frontal hits: their bull bars take it
      const k = ev.part === 'front' && armor >= 2 ? 0.4 : ev.part === 'left' || ev.part === 'right' || ev.part === 'rear' ? 1.2 : 1;
      // a knock from another gang car (pack racing, a pile-up) does a fifth of the harm of the player's ram
      const byAi = this.inContacts && !this.touchingPlayer(e);
      e.hp = Math.max(0, e.hp - ev.severity * 2.2 * k / armor * (byAi ? 0.2 : 1));
    };
    e.state = 'active';
    this.assign(e);
    this.events.push({ type: 'spawn', key: e.key });
  }
  /** Map the person's temper and the current objective onto an AI behaviour. */
  private assign(e: SimEnemy) {
    const ai = e.ai, ph = this.phase, t: Temper = e.def.temper;
    const route = e.def.route ? this.routePts(e.def.route) : null, ringRoute = e.def.route && e.def.route.kind === 'ring';
    const speed = (ai.maxKmh / 3.6) * (0.7 + 0.3 * ai.skill);
    if (ph.kind === 'race' && ph.rivals.includes(e.key) && route) { ai.setPath(route, !!ringRoute, speed); return; }
    if (ph.kind === 'catch' && ph.target === e.key && route) { ai.setPath(route, !!ringRoute, speed); return; }
    switch (t) {
      case 'racer': case 'fleer':
        if (route && ph.kind !== 'takedown') ai.setPath(route, !!ringRoute, speed); else ai.behavior = { kind: 'chase', ram: true };
        // a lone fleeing target being hunted keeps running its route
        if (t === 'fleer' && route) ai.setPath(route, !!ringRoute, speed);
        return;
      case 'patrol':
        if (route) ai.setPath([...route, ...route.slice(1, -1).reverse()], true, 14); else ai.behavior = { kind: 'hold', ...this.world.where(e.def.at), r: 40 };
        return;
      case 'holder': { const p = this.world.where(e.def.at); ai.behavior = { kind: 'hold', x: p.x, z: p.z, r: 40 }; return; }
      case 'blocker': {
        const goal = this.blockGoal();
        if (goal) ai.behavior = { kind: 'block', goal }; else ai.behavior = { kind: 'chase', ram: true };
        return;
      }
      default: ai.behavior = { kind: 'chase', ram: true };
    }
  }
  /** What a blocker shields: the boss of the phase, or the objective point. */
  private blockGoal(): [number, number] | null {
    const ph = this.phase;
    if (ph.kind === 'takedown') { const b = this.enemies.find(x => ph.targets.includes(x.key) && x.boss && x.state === 'active'); if (b) return [b.vehicle.body.pos.x, b.vehicle.body.pos.z]; }
    if (ph.kind === 'catch') { const b = this.enemy(ph.target); if (b && b.state === 'active') return [b.vehicle.body.pos.x, b.vehicle.body.pos.z]; }
    const o = this.objectivePoint(); return o ? [o.x, o.z] : null;
  }
  private wreck(e: SimEnemy) {
    if (e.state !== 'active') return;
    e.state = 'wrecked'; e.hp = 0;
    e.ai.behavior = { kind: 'park' }; e.vehicle.engineOn = false;
    this.events.push({ type: 'wreck', key: e.key, name: e.name });
  }

  // ------------------------------------------------------------------ routes
  routePts(r: Route): [number, number][] { return this.world.route(r); }

  private beginPhase(i: number) {
    this.phaseIndex = i; this.phaseTime = 0;
    const ph = this.phase;
    this.meter = 0; this.hits = 0; this.catchHold = 0; this.got = []; this.pts = []; this.loop = false; this.racers.clear(); this.frozen = false;
    switch (ph.kind) {
      case 'race': case 'precision': {
        this.pts = this.routePts(ph.route); this.loop = ph.route.kind === 'ring';
        this.total = this.loop ? ph.laps * this.pts.length + 1 : this.pts.length;
        this.player = { next: 0, count: 0 };
        if (ph.kind === 'race') { for (const k of ph.rivals) this.racers.set(k, { next: 0, count: 0, stillT: 0, sx: 0, sz: 0 }); this.frozen = true; }
        break;
      }
      case 'collect': this.got = ph.points.map(() => false); break;
      case 'destroy': this.got = ph.pylons.map(() => false); break;
      case 'outrun': {
        const U = this.world.terrain.underground, c = U.chamberForChallenge(this.ch);
        const s = this.startPose;
        this.outPath = [[s.x, s.z], [c.x, c.z], ...U.route(c.index, c.index + 1).slice(1)];
        const to = this.world.where(ph.to); this.outPath.push([to.x, to.z]);
        this.outCum = [0]; for (let k = 1; k < this.outPath.length; k++) this.outCum.push(this.outCum[k - 1] + dist(...this.outPath[k], ...this.outPath[k - 1]));
        this.front = -ph.head;
        break;
      }
    }
    for (const e of this.enemies) {
      if ((e.def.phase ?? 0) === i && e.state === 'waiting') e.spawnAt = this.elapsed + (e.def.delay ?? 0);
      else if (e.state === 'active') this.assign(e);
    }
    this.events.push({ type: 'phase', index: i, text: ph.text });
  }

  // ------------------------------------------------------------------ simulation
  /** One physics step: vehicle contacts, then every active enemy. Call before stepping the player's vehicle. */
  substep(dt: number, player: Vehicle | null) {
    if (this.status !== 'running') { for (const e of this.enemies) if (e.state !== 'waiting' && e.state !== 'gone') e.vehicle.step(dt, { throttle: 0, brake: 1, steer: 0, handbrake: 1 }); return; }
    const list: Vehicle[] = player ? [player] : [];
    for (const e of this.enemies) if (e.state === 'active' || e.state === 'wrecked') list.push(e.vehicle);
    this.playerV = player;
    this.inContacts = true;
    if (list.length > 1) this.contacts.step(list);
    this.inContacts = false;
    const target: AiTarget | null = player ? { x: player.body.pos.x, z: player.body.pos.z, vx: player.body.vel.x, vz: player.body.vel.z } : this.lastPlayer;
    for (const e of this.enemies) {
      if (e.state === 'waiting' || e.state === 'gone') continue;
      const inp: VehicleInput = e.state === 'active' && !this.frozen ? e.ai.update(dt, target) : { throttle: 0, brake: 1, steer: 0, handbrake: 1 };
      e.vehicle.step(dt, inp);
    }
  }
  private lastPlayer: AiTarget | null = null;
  private inContacts = false;
  private playerV: Vehicle | null = null;
  private touchingPlayer(e: SimEnemy) {
    const p = this.playerV; if (!p) return false;
    const a = e.vehicle.body.pos, b = p.body.pos, reach = e.vehicle.spec.halfExtents[2] + p.spec.halfExtents[2] + 1;
    return dist(a.x, a.z, b.x, b.z) < reach;
  }

  /** Judge the objectives (once per frame). `talk` and `descend` phases complete through `signal`. */
  update(dt: number, p: SimPlayer) {
    this.lastPlayer = { x: p.x, z: p.z, vx: p.vx, vz: p.vz };
    if (this.status !== 'running') return;
    this.elapsed += dt; this.phaseTime += dt;
    const ph = this.phase;
    // spawns
    for (const e of this.enemies) if (e.state === 'waiting' && this.elapsed >= e.spawnAt) this.place(e);
    // enemy health: wrecked by damage, a dead engine or a roll-over
    for (const e of this.enemies) {
      if (e.state !== 'active') continue;
      if (e.hp <= 0 || e.vehicle.condition.engine >= 1 || e.vehicle.upsideDownTimer > 2.5 || e.vehicle.body.pos.y < this.world.terrain.heightAt(e.vehicle.body.pos.x, e.vehicle.body.pos.z) - 20) this.wreck(e);
      else if (e.def.temper === 'blocker' && e.ai.behavior.kind === 'block') { const g = this.blockGoal(); if (g) e.ai.behavior.goal = g; }
    }
    // the player's own condition
    const pv = p.vehicle;
    if (pv && (pv.condition.engine >= 1 || overallDamage(pv.condition) >= 0.92)) return this.lose('Your vehicle is wrecked');
    if (!pv && !this.def.onFoot && ph.kind !== 'talk' && ph.kind !== 'descend') { this.footTime += dt; if (this.footTime > 30) return this.lose('You left your vehicle'); } else this.footTime = 0;
    if (!this.underground && this.def.id !== 'p2-footsteps' && ph.kind !== 'catch' && ph.kind !== 'race' && dist(p.x, p.z, this.origin.x, this.origin.z) > 3000) return this.lose('You left the area');
    const timeLimit = 'time' in ph ? ph.time : undefined;
    if (timeLimit && this.phaseTime > timeLimit) return this.lose('Out of time');
    switch (ph.kind) {
      case 'reach': { const w = this.world.where(ph.to); if (dist(p.x, p.z, w.x, w.z) < (ph.r ?? 12)) this.next(); break; }
      case 'talk': case 'descend': break;
      case 'takedown': if (ph.targets.every(k => this.enemy(k)?.state === 'wrecked')) this.next(); break;
      case 'survive': if (this.phaseTime >= ph.seconds) { for (const e of this.enemies) if (e.state === 'active') { e.ai.behavior = { kind: 'park' }; } this.next(); } break;
      case 'hold': {
        const w = this.world.where(ph.zone), inside = dist(p.x, p.z, w.x, w.z) < ph.r;
        this.meter = Math.max(0, this.meter + (inside ? dt : -dt * HOLD_DECAY));
        if (this.meter >= ph.seconds) { for (const e of this.enemies) if (e.state === 'active' && !this.def.phases.slice(this.phaseIndex + 1).some(q => q.kind === 'takedown' && q.targets.includes(e.key))) e.ai.behavior = { kind: 'park' }; this.next(); }
        else if (this.phaseTime > ph.seconds * 3 + 30) this.lose('You lost the zone');
        break;
      }
      case 'collect': {
        ph.points.forEach((q, i) => { if (this.got[i]) return; const w = this.world.where(q); if (dist(p.x, p.z, w.x, w.z) < (ph.pages ? 9 : 8)) { this.got[i] = true; this.events.push({ type: 'collect', index: i, page: !!ph.pages }); } });
        if (this.got.every(Boolean)) this.next();
        break;
      }
      case 'destroy': {
        const kmh = pv ? pv.speedKmh : 0;
        ph.pylons.forEach((q, i) => { if (this.got[i]) return; const w = this.world.where(q); if (dist(p.x, p.z, w.x, w.z) < 4 && kmh > 12) { this.got[i] = true; this.events.push({ type: 'pylon', index: i }); } });
        if (this.got.every(Boolean)) this.next();
        break;
      }
      case 'stealth': {
        let seen = false;
        for (const L of ph.lights) {
          const w = this.world.where(L.at), a = this.beamAngle(L, w), d = dist(p.x, p.z, w.x, w.z);
          if (d < L.range && d > 2) { const ang = Math.atan2(p.x - w.x, p.z - w.z); if (Math.abs(Math.atan2(Math.sin(ang - a), Math.cos(ang - a))) < BEAM_HALF) seen = true; }
        }
        this.meter = Math.max(0, Math.min(1, this.meter + (seen ? dt * 0.9 : -dt * 0.35)));
        if (this.meter >= 1) return this.lose('Spotted by the searchlights');
        const x = this.world.where(ph.exit); if (dist(p.x, p.z, x.x, x.z) < 10) this.next();
        break;
      }
      case 'race': case 'precision': {
        if (ph.kind === 'race' && this.phaseTime < 3) { this.frozen = true; break; }
        this.frozen = false;
        const R = this.gateR();
        this.advance(this.player, p.x, p.z, R, true);
        for (const [k, r] of this.racers) {
          const e = this.enemy(k); if (!e || e.state !== 'active') continue;
          this.advance(r, e.vehicle.body.pos.x, e.vehicle.body.pos.z, R, false);
          this.unstickOnCourse(e, r, dt);
          // rivals well ahead ease off a little, so a race is won by driving well rather than by the car alone
          e.baseKmh ??= e.ai.maxKmh;
          e.ai.maxKmh = r.count - this.player.count >= 4 ? e.baseKmh * 0.8 : e.baseKmh;
          if (r.count >= this.total) return this.lose(`${e.name} won`);
        }
        if (ph.kind === 'precision' && pv && this.hitCheck(pv, ph.maxHits)) return;
        if (this.player.count >= this.total) this.next();
        break;
      }
      case 'catch': {
        const e = this.enemy(ph.target); if (!e) { this.next(); break; }
        if (e.state === 'wrecked') { this.next(); break; }
        if (e.state !== 'active') break;
        const ep = e.vehicle.body.pos, d = dist(p.x, p.z, ep.x, ep.z);
        if (d > ph.escape) return this.lose(`${e.name} got away`);
        const b = e.ai.behavior;
        if (b.kind === 'path' && !b.loop && e.ai.pathIndex >= b.pts.length - 1 && dist(ep.x, ep.z, ...b.pts[b.pts.length - 1]) < 25 && d > 30) return this.lose(`${e.name} got away`);
        const boxed = d < 10 && e.vehicle.speedKmh < 10;
        this.catchHold = Math.max(0, this.catchHold + (boxed ? dt : -dt * 0.5));
        if (this.catchHold >= ph.hold) this.next();
        break;
      }
      case 'outrun': {
        if (this.phaseTime > 2) this.front += ph.speed * dt * (1 + this.phaseTime / 60);
        const s = this.project(p.x, p.z);
        if (s < this.front) return this.lose('Buried in the collapse');
        const w = this.world.where(ph.to); if (dist(p.x, p.z, w.x, w.z) < 14) this.next();
        break;
      }
    }
  }
  /** Signal an objective that the client completes (talking to someone, the descent). */
  signal(kind: 'talk' | 'descend') { if (this.status === 'running' && this.phase.kind === kind) this.next(); }
  /** The client reports each hull impact of the player's vehicle (precision challenges count them). */
  notePlayerImpact() { if (this.status === 'running' && this.phase.kind === 'precision' && this.elapsed - this.lastHitT > 0.6) { this.lastHitT = this.elapsed; this.hits++; this.events.push({ type: 'hit', n: this.hits, of: this.phase.maxHits }); } }
  private hitCheck(_v: Vehicle, max: number) { if (this.hits > max) { this.lose('Too many hits'); return true; } return false; }

  /** Half-width of a checkpoint gate: wide on roads, tighter round a hall, a real gate in a slalom. */
  private gateR() { const ph = this.phase; const k = 'route' in ph ? ph.route.kind : 'road'; return k === 'slalom' ? 9 : k === 'ring' ? 16 : 26; }
  /** Direction of the course through checkpoint i (bisecting the legs in and out). */
  private gateDir(i: number): [number, number] {
    const n = this.pts.length, P = this.pts;
    const a = P[i === 0 ? (this.loop ? n - 1 : 0) : i - 1], b = P[i === n - 1 ? (this.loop ? 0 : n - 1) : i + 1];
    let dx = b[0] - a[0], dz = b[1] - a[1]; if (!dx && !dz) { dx = P[1][0] - P[0][0]; dz = P[1][1] - P[0][1]; }
    const L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L];
  }
  /**
   * Checkpoints are gates: one is passed by crossing the line through it (across the course) within R of its
   * centre, so a fast car can't skip one between frames and a gate can't be taken by driving round it.
   */
  private advance(r: Racer, x: number, z: number, R: number, isPlayer: boolean) {
    if (!r.init) {
      // the first checkpoint not yet passed: grid slots ahead of the first checkpoint have already passed it
      r.init = true;
      const [ax, az] = this.pts[0], [dx, dz] = this.gateDir(0);
      if ((x - ax) * dx + (z - az) * dz > 0 && dist(x, z, ax, az) < 60) { r.next = 1; r.count = 1; }
    }
    for (let k = 0; k < 3 && r.count < this.total; k++) {
      const [cx, cz] = this.pts[r.next], [dx, dz] = this.gateDir(r.next);
      const along = (x - cx) * dx + (z - cz) * dz, across = Math.abs(-(x - cx) * dz + (z - cz) * dx);
      if (!(along >= 0 && along < 12 && across < R) && dist(x, z, cx, cz) > R * 0.5) break;
      r.count++; r.next = (r.next + 1) % this.pts.length;
      if (isPlayer) this.events.push({ type: 'checkpoint', n: r.count, of: this.total });
    }
  }
  /** Put the player's vehicle back on its wheels (R), clear of the mission's other vehicles and wrecks. */
  recoverPlayer(v: Vehicle) {
    const p = v.body.pos, h = Math.atan2(new_fwd(v)[0], new_fwd(v)[1]);
    let x = p.x, z = p.z;
    for (let k = 0; k < 8; k++) {
      const near = this.enemies.find(e => e.state !== 'waiting' && dist(e.vehicle.body.pos.x, e.vehicle.body.pos.z, x, z) < 6);
      if (!near) break;
      const a = h + Math.PI / 2 * (k % 2 ? -1 : 1);
      x = p.x + Math.sin(a) * 7 * (1 + (k >> 1)); z = p.z + Math.cos(a) * 7 * (1 + (k >> 1));
    }
    v.reset(x, z, h);
  }
  /** A rival stuck for 12 s (wedged on a rock, nose in a ditch) is put back on the course at its next checkpoint. */
  private unstickOnCourse(e: SimEnemy, r: Racer, dt: number) {
    const p = e.vehicle.body.pos;
    if (dist(p.x, p.z, r.sx ?? 0, r.sz ?? 0) > 4) { r.sx = p.x; r.sz = p.z; r.stillT = 0; return; }
    r.stillT = (r.stillT ?? 0) + dt;
    if (r.stillT < 12) return;
    const i = r.next, [x, z] = this.pts[i], [nx, nz] = this.pts[(i + 1) % this.pts.length];
    e.vehicle.reset(x, z, Math.atan2(nx - x, nz - z)); e.ai.pathIndex = i; r.stillT = 0;
  }
  private project(x: number, z: number): number {
    let best = Infinity, s = 0;
    for (let i = 1; i < this.outPath.length; i++) {
      const [ax, az] = this.outPath[i - 1], [bx, bz] = this.outPath[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), d = dist(x, z, ax + dx * t, az + dz * t);
      if (d < best) { best = d; s = this.outCum[i - 1] + t * Math.sqrt(L2); }
    }
    return s;
  }
  private pointAt(s: number): [number, number, number] {
    for (let i = 1; i < this.outPath.length; i++) if (this.outCum[i] >= s || i === this.outPath.length - 1) {
      const [ax, az] = this.outPath[i - 1], [bx, bz] = this.outPath[i], L = this.outCum[i] - this.outCum[i - 1] || 1, t = Math.max(0, Math.min(1, (s - this.outCum[i - 1]) / L));
      return [ax + (bx - ax) * t, az + (bz - az) * t, Math.atan2(bx - ax, bz - az)];
    }
    return [...this.outPath[0], 0];
  }
  beamAngle(L: { sweep: number }, w: { x: number; z: number }) {
    // the beam swings across the hall, centred on the line to the hall's middle
    const c = this.world.chamber(this.ch), base = Math.atan2(c.x - w.x, c.z - w.z);
    return base + Math.sin(this.elapsed * L.sweep * 0.6 + w.x * 0.01) * 1.1;
  }

  private next() {
    if (this.phaseIndex + 1 >= this.def.phases.length) { this.status = 'won'; this.frozen = false; this.events.push({ type: 'won' }); return; }
    this.beginPhase(this.phaseIndex + 1);
  }
  private lose(reason: string) { if (this.status !== 'running') return; this.status = 'lost'; this.failReason = reason; this.frozen = false; this.events.push({ type: 'lost', reason }); }
  /** Give up (the player quit). */
  abort() { this.lose('Mission abandoned'); }

  // ------------------------------------------------------------------ reporting
  /** The line to follow in this phase (race and precision courses, the escape tunnel), or null. */
  guide(): { pts: [number, number][]; loop: boolean } | null {
    const ph = this.phase;
    if (ph.kind === 'race' || ph.kind === 'precision') return { pts: this.pts, loop: this.loop };
    if (ph.kind === 'outrun') return { pts: this.outPath, loop: false };
    return null;
  }
  /** The point the HUD arrow points at. */
  objectivePoint(): { x: number; z: number } | null {
    const ph = this.phase, W = (w: Where) => this.world.where(w);
    switch (ph.kind) {
      case 'reach': return W(ph.to);
      case 'hold': return W(ph.zone);
      case 'stealth': return W(ph.exit);
      case 'outrun': return W(ph.to);
      case 'collect': { const i = this.got.findIndex(g => !g); return i >= 0 ? W(ph.points[i]) : null; }
      case 'destroy': { const i = this.got.findIndex(g => !g); return i >= 0 ? W(ph.pylons[i]) : null; }
      case 'race': case 'precision': { const [x, z] = this.pts[this.player.next] ?? this.pts[0]; return { x, z }; }
      case 'catch': { const e = this.enemy(ph.target); return e && e.state === 'active' ? { x: e.vehicle.body.pos.x, z: e.vehicle.body.pos.z } : null; }
      case 'takedown': { const e = this.enemies.find(x => ph.targets.includes(x.key) && x.state === 'active'); return e ? { x: e.vehicle.body.pos.x, z: e.vehicle.body.pos.z } : null; }
      default: return null;
    }
  }
  markers(): Marker[] {
    const ph = this.phase, out: Marker[] = [], W = (w: Where) => this.world.where(w);
    switch (ph.kind) {
      case 'reach': { const w = W(ph.to); out.push({ kind: 'goal', x: w.x, z: w.z, r: ph.r ?? 12 }); break; }
      case 'hold': { const w = W(ph.zone); out.push({ kind: 'zone', x: w.x, z: w.z, r: ph.r }); break; }
      case 'collect': ph.points.forEach((q, i) => { if (!this.got[i]) { const w = W(q); out.push({ kind: ph.pages ? 'page' : 'pickup', x: w.x, z: w.z, r: 6 }); } }); break;
      case 'destroy': ph.pylons.forEach((q, i) => { if (!this.got[i]) { const w = W(q); out.push({ kind: 'pylon', x: w.x, z: w.z, r: 1.2 }); } }); break;
      case 'stealth': {
        for (const L of ph.lights) { const w = W(L.at); out.push({ kind: 'light', x: w.x, z: w.z, r: 1, ang: this.beamAngle(L, w), range: L.range, half: BEAM_HALF }); }
        const x = W(ph.exit); out.push({ kind: 'exit', x: x.x, z: x.z, r: 10 }); break;
      }
      case 'race': case 'precision': {
        const R = this.gateR();
        if (this.player.count < this.total) { const [x, z] = this.pts[this.player.next]; out.push({ kind: 'checkpoint', x, z, r: R }); }
        if (this.player.count + 1 < this.total) { const [x, z] = this.pts[(this.player.next + 1) % this.pts.length]; out.push({ kind: 'next', x, z, r: R }); }
        break;
      }
      case 'outrun': { const w = W(ph.to); out.push({ kind: 'goal', x: w.x, z: w.z, r: 14 }); const [x, z, h] = this.pointAt(Math.max(0, this.front)); out.push({ kind: 'collapse', x, z, r: 9, ang: h }); break; }
    }
    return out;
  }
  hud(): SimHud {
    const ph = this.phase, h: SimHud = { title: this.def.title, objective: ph.text };
    const t = 'time' in ph && ph.time ? ph.time - this.phaseTime : undefined;
    if (t !== undefined) h.timer = Math.max(0, t);
    switch (ph.kind) {
      case 'survive': h.timer = Math.max(0, ph.seconds - this.phaseTime); break;
      case 'hold': h.meter = { label: 'Holding', value: Math.min(1, this.meter / ph.seconds) }; break;
      case 'collect': h.count = `${this.got.filter(Boolean).length} / ${this.got.length}`; break;
      case 'destroy': h.count = `${this.got.filter(Boolean).length} / ${this.got.length}`; break;
      case 'takedown': h.count = `${ph.targets.filter(k => this.enemy(k)?.state === 'wrecked').length} / ${ph.targets.length}`; break;
      case 'stealth': h.meter = { label: 'Detection', value: this.meter, danger: true }; break;
      case 'catch': h.meter = { label: 'Boxed in', value: Math.min(1, this.catchHold / ph.hold) }; break;
      case 'precision': h.count = `Gate ${Math.min(this.player.count, this.total)} / ${this.total}`; h.meter = { label: `Hits ${this.hits} / ${ph.maxHits}`, value: Math.min(1, this.hits / Math.max(1, ph.maxHits)), danger: true }; break;
      case 'race': {
        h.count = this.loop ? `Lap ${Math.min(ph.laps, Math.floor(Math.max(0, this.player.count - 1) / this.pts.length) + 1)} / ${ph.laps}` : `Checkpoint ${this.player.count} / ${this.total}`;
        const me = this.player.count, ahead = [...this.racers.entries()].filter(([k, r]) => this.enemy(k)?.state === 'active' && r.count > me).length;
        h.rank = `${ahead + 1} / ${this.racers.size + 1}`;
        if (this.phaseTime < 3) h.banner = String(3 - Math.floor(this.phaseTime)); else if (this.phaseTime < 3.8) h.banner = 'GO';
        break;
      }
      case 'outrun': h.meter = { label: 'Collapse', value: Math.max(0, Math.min(1, 1 - (this.lastPlayer ? this.project(this.lastPlayer.x, this.lastPlayer.z) - this.front : 99) / 60)), danger: true }; break;
    }
    const bosses = this.enemies.filter(e => e.boss && e.state === 'active');
    if (bosses.length) h.boss = bosses.map(e => ({ name: e.name, hp: e.hp }));
    return h;
  }
}

const new_fwd = (v: Vehicle): [number, number] => { const q = v.body.quat, x = 2 * (q.x * q.z + q.w * q.y), z = 1 - 2 * (q.x * q.x + q.y * q.y); return [x, z]; };

/** The name and vehicle of whoever an enemy key stands for (for cards and tags). */
export function enemyTitle(e: SimEnemy): string {
  const L = Object.values(LEADERS).find(l => l.id === e.key);
  if (L) return `${L.name} · ${L.title}`;
  if (e.key === MASTER.id) return `${MASTER.name} · ${MASTER.title}`;
  return e.name;
}
