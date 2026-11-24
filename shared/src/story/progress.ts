import { MISSIONS, MISSION_BY_ID, PAGES, missionPayout, type MissionDef } from './missions';
import { LEGENDS, GANGS, type GangId } from './roster';
import { UG_RECT, type Underground } from './underground';
import { VEHICLES } from '../vehicles/catalog';
import { sanitizeBuild, defaultBuild } from '../garage/build';
import { optionsFor, type SlotId } from '../garage/parts';
import type { Career, GarageContext, GarageResult } from '../garage/economy';

/**
 * Story progress, kept in the career beside the money, and the only functions allowed to change it. Every story
 * reward (cash, keys, legendary vehicles, the Sovereign) is paid from the mission catalogue here, never from the
 * request, and a completion is only accepted for the mission that was started, after its minimum believable time,
 * from a believable place. The server runs the same functions for online players.
 */
export interface StoryProgress {
  /** completed missions (in order) */
  done: string[];
  /** named people beaten (bounties paid) */
  defeated: string[];
  /** gang keys held */
  keys: GangId[];
  /** legendary vehicles recovered */
  legends: string[];
  /** father's journal pages found */
  pages: string[];
  /** journal entries unlocked */
  journal: string[];
  /** the mission in progress and when it started (ms, authority clock) */
  active: { id: string; t0: number } | null;
  /** the father's core vehicle is back */
  core: boolean;
}
export const newStory = (): StoryProgress => ({ done: [], defeated: [], keys: [], legends: [], pages: [], journal: [], active: null, core: false });

/** A free-roam journal page (outside the prologue mission) pays a finder's fee. */
export const PAGE_REWARD = 3000;
/** How close to a page's map place the player must be to pick it up (pages lie beside the place, nudged to open ground). */
export const PAGE_RADIUS = 180;
/** How far from the mission's territory a completion may be claimed (a believable drive from where it started). */
export const MISSION_RADIUS = 4500;
/** How close to the underground's map place the gate is (the portal stands beside the nearest drivable road). */
export const UG_GATE_RADIUS = 1200;
/** Replays of finished missions pay this share (bounties are only paid once). */
export const REPLAY_SHARE = 0;

export function sanitizeStory(raw: unknown): StoryProgress {
  const s = newStory();
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  const strs = (v: unknown, ok: (x: string) => boolean) => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length < 64 && ok(x)))] : [];
  s.done = strs(o.done, x => !!MISSION_BY_ID[x]);
  s.defeated = strs(o.defeated, () => true);
  s.keys = Array.isArray(o.keys) ? [...new Set(o.keys.filter((k): k is GangId => k === 1 || k === 2 || k === 3 || k === 4))] : [];
  s.legends = strs(o.legends, x => LEGENDS.some(l => l.id === x));
  s.pages = strs(o.pages, x => PAGES.some(p => p.id === x));
  s.journal = strs(o.journal, () => true);
  s.core = o.core === true;
  const a = o.active as Record<string, unknown> | null | undefined;
  s.active = a && typeof a.id === 'string' && MISSION_BY_ID[a.id] && typeof a.t0 === 'number' && Number.isFinite(a.t0) ? { id: a.id, t0: a.t0 } : null;
  return s;
}
export const cloneStory = (s: StoryProgress): StoryProgress => ({ ...s, done: [...s.done], defeated: [...s.defeated], keys: [...s.keys], legends: [...s.legends], pages: [...s.pages], journal: [...s.journal], active: s.active && { ...s.active } });

/** Why a mission can't be started yet, or null when it can. */
export function missionLock(story: StoryProgress, m: MissionDef): string | null {
  for (const r of m.requires) if (!story.done.includes(r)) return `Finish "${MISSION_BY_ID[r]?.title ?? r}" first`;
  if (m.keys && story.keys.length < m.keys) return `Needs all ${m.keys} gang keys (${story.keys.length} held)`;
  return null;
}
/** Missions that can be played now: unlocked and not finished (finished ones can be replayed from the menu). */
export const availableMissions = (story: StoryProgress) => MISSIONS.filter(m => !story.done.includes(m.id) && !missionLock(story, m));
export const inUnderground = (x: number, z: number) => x >= UG_RECT.x0 && x <= UG_RECT.x1 && z >= UG_RECT.z0 && z <= UG_RECT.z1;

/** The map place a mission's territory is centred on (its gang's compound, the camp for the prologue). */
export function missionHome(m: MissionDef): string {
  switch (m.chapter) {
    case 'gang1': case 'gang2': case 'gang3': case 'gang4': return GANGS[Number(m.chapter.slice(4)) as GangId].compound;
    case 'prologue': return 'base-camp';
    default: return 'underground';
  }
}

export type StoryRequest =
  | { op: 'story-start'; mission: string }
  | { op: 'story-done'; mission: string }
  | { op: 'story-quit' }
  | { op: 'story-page'; page: string }
  | { op: 'ug-enter' }
  | { op: 'ug-exit' };
export const STORY_OPS = new Set(['story-start', 'story-done', 'story-quit', 'story-page', 'ug-enter', 'ug-exit']);
export function isStoryRequest(o: Record<string, unknown>): boolean {
  const str = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length < 64;
  switch (o.op) {
    case 'story-start': case 'story-done': return str(o.mission);
    case 'story-page': return str(o.page);
    case 'story-quit': case 'ug-enter': case 'ug-exit': return true;
    default: return false;
  }
}

const fail = (error: string): GarageResult => ({ ok: false, error });
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Give a legendary vehicle: the base vehicle if not owned, every part of the legend's build unlocked for free and fitted. */
function grantLegend(c: Career, legendId: string) {
  const L = LEGENDS.find(l => l.id === legendId); if (!L) return;
  const spec = VEHICLES.find(v => v.id === L.vehicle); if (!spec) return;
  const ov = c.owned[spec.id] ?? (c.owned[spec.id] = { build: defaultBuild(), unlocked: [], spent: 0 });
  for (const [slot, opt] of Object.entries(L.build.parts)) {
    if (!optionsFor(spec, slot as SlotId).some(o => o.id === opt)) continue;
    const key = `${slot}:${opt}`; if (!ov.unlocked.includes(key)) ov.unlocked.push(key);
  }
  ov.build = sanitizeBuild(spec, L.build);
}

/** Apply one story transaction to an already-cloned career (called by `transact`). */
export function storyTransact(c: Career, req: StoryRequest, ctx: GarageContext): GarageResult {
  const s = c.story, now = ctx.now ?? Date.now(), at = ctx.at;
  const ok = (msg: string, delta = 0): GarageResult => ({ ok: true, career: c, delta, msg });
  const poi = (id: string) => ctx.pois?.find(p => p.id === id);
  switch (req.op) {
    case 'story-start': {
      const m = MISSION_BY_ID[req.mission]; if (!m) return fail('Unknown mission');
      const lock = missionLock(s, m); if (lock) return fail(lock);
      const ug = m.chapter === 'underground' && m.id !== 'ug-descent' || m.chapter === 'finale';
      if (at && ug !== inUnderground(at.x, at.z)) return fail(ug ? 'That challenge is in the underground' : 'Return to the surface first');
      s.active = { id: m.id, t0: now };
      return ok(`Mission started: ${m.title}`);
    }
    case 'story-quit': {
      if (!s.active) return fail('No mission in progress');
      s.active = null;
      return ok('Mission abandoned');
    }
    case 'story-done': {
      const m = MISSION_BY_ID[req.mission]; if (!m) return fail('Unknown mission');
      if (!s.active || s.active.id !== m.id) return fail('That mission is not in progress');
      if ((now - s.active.t0) / 1000 < m.minTime) return fail('Completion refused: impossibly fast');
      if (at) {
        if (m.chapter === 'underground' && m.id !== 'ug-descent' || m.chapter === 'finale') { if (!inUnderground(at.x, at.z)) return fail('Completion refused: not in the underground'); }
        else if (m.id === 'ug-descent') { const p = poi('underground'); if (p && Math.hypot(at.x - p.x, at.z - p.z) > UG_GATE_RADIUS && !inUnderground(at.x, at.z)) return fail('Completion refused: not at the underground gate'); }
        else { const p = poi(missionHome(m)); if (p && m.id !== 'p2-footsteps' && Math.hypot(at.x - p.x, at.z - p.z) > MISSION_RADIUS) return fail('Completion refused: too far from the mission'); }
      }
      if (m.id === 'p2-footsteps' && PAGES.slice(0, 3).some(p => !s.pages.includes(p.id))) return fail('The journal pages have not all been found');
      s.active = null;
      const first = !s.done.includes(m.id);
      if (!first) return ok(`${m.title}: replay complete`);
      s.done.push(m.id);
      const pay = missionPayout(m);
      for (const d of m.defeats) if (!s.defeated.includes(d)) s.defeated.push(d);
      if (m.key && !s.keys.includes(m.key)) s.keys.push(m.key);
      if (m.legend && !s.legends.includes(m.legend)) { s.legends.push(m.legend); grantLegend(c, m.legend); }
      if (m.core && !s.core) { s.core = true; const sov = VEHICLES.find(v => v.id === 'sovereign-x1'); if (sov && !c.owned[sov.id]) c.owned[sov.id] = { build: defaultBuild(), unlocked: [], spent: 0 }; }
      if (m.journal && !s.journal.includes(m.journal)) s.journal.push(m.journal);
      c.cash += pay; c.earned += pay;
      const extras = [m.key ? GANGS[m.key].key.name : '', m.legend ? LEGENDS.find(l => l.id === m.legend)!.name : '', m.core ? 'the Sovereign X1' : ''].filter(Boolean);
      return ok(`${m.title} complete: +${money(pay)}${extras.length ? ` · ${extras.join(' · ')}` : ''}`, pay);
    }
    case 'story-page': {
      const pg = PAGES.find(p => p.id === req.page); if (!pg) return fail('Unknown page');
      if (s.pages.includes(pg.id)) return fail('Already found');
      if (!s.done.includes('p1-legacy')) return fail('Talk to Ezra first');
      const p = poi(pg.poi);
      if (!p || !at || Math.hypot(at.x - p.x, at.z - p.z) > PAGE_RADIUS) return fail('Too far away');
      s.pages.push(pg.id);
      // the three prologue pages belong to the mission; the rest pay a finder's fee
      const fee = PAGES.indexOf(pg) >= 3 ? PAGE_REWARD : 0;
      c.cash += fee; c.earned += fee;
      return ok(`Found ${pg.title}${fee ? `: +${money(fee)}` : ''}`, fee);
    }
    case 'ug-enter': {
      if (s.keys.length < 4) return fail('The gate needs all four keys');
      const p = poi('underground');
      if (at && p && Math.hypot(at.x - p.x, at.z - p.z) > UG_GATE_RADIUS) return fail('Too far from the underground gate');
      return ok('Entering the underground');
    }
    case 'ug-exit': {
      if (at && !inUnderground(at.x, at.z)) return fail('Not in the underground');
      if (s.active && (MISSION_BY_ID[s.active.id].chapter === 'underground' || s.active.id === 'finale')) s.active = null;
      return ok('Back to the surface');
    }
  }
}

/**
 * Whether an underground gate stands open: each challenge hall's exit gate opens once its challenge is beaten (the
 * Collapsing Shaft's opens as the challenge starts, since its challenge is the run through it). Gates of the entry
 * hall and the repair bays are always open.
 */
export function ugGateOpen(U: Underground, gate: number, done: readonly string[], activeId: string | null): boolean {
  const ch = U.chambers[U.gates[gate].chamber]?.challenge;
  if (!ch) return true;
  const id = `ug-${String(ch).padStart(2, '0')}`;
  return done.includes(id) || (activeId === id && !!MISSION_BY_ID[id]?.phases.some(p => p.kind === 'outrun'));
}
