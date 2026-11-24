import { describe, it, expect, beforeAll } from 'vitest';
import {
  Terrain, WORLD_SEED, Vehicle, AiDriver, StoryWorld, MissionSim, MISSIONS, MISSION_BY_ID, UG_CHALLENGES, GANGS, GANGSTERS, LEADERS, MASTER, LEGENDS, PAGES,
  newCareer, transact, sanitizeCareer, missionPayout, missionLock, ugGateOpen, inUnderground, vehicleById, overallDamage, LEADER_BOUNTY, gangsterLook, sanitizeAppearance,
  type Career, type GarageContext, type MissionDef,
} from '@orl/shared';

/** Phase 5: the story campaign's data, its server-checked progression, the underground, and missions played headless. */
let T: Terrain, W: StoryWorld;
beforeAll(() => { T = new Terrain(WORLD_SEED); W = new StoryWorld(T); });

describe('story data', () => {
  it('has the four gangs at their design sizes, every member complete and defeated exactly once', () => {
    const sizes = [1, 2, 3, 4].map(g => GANGSTERS.filter(m => m.gang === g).length);
    expect(sizes).toEqual([13, 9, 6, 17]);
    for (const g of [1, 2, 3, 4] as const) expect(GANGS[g].size).toBe(sizes[g - 1]);
    const ids = new Set<string>();
    for (const m of GANGSTERS) {
      expect(ids.has(m.id)).toBe(false); ids.add(m.id);
      expect(m.name.length).toBeGreaterThan(3);
      expect(vehicleById(m.vehicle).id).toBe(m.vehicle);
      expect(m.bounty).toBeGreaterThan(0);
      expect(m.difficulty).toBeGreaterThanOrEqual(1);
      expect(m.bio.length).toBeGreaterThan(10);
      // a deterministic, valid look
      const look = gangsterLook(m);
      expect(sanitizeAppearance(look)).toEqual(look);
      expect(gangsterLook(m)).toEqual(look);
    }
    const defeated = MISSIONS.flatMap(m => m.defeats);
    for (const m of GANGSTERS) expect(defeated.filter(d => d === m.id).length, m.id).toBe(1);
    for (const L of Object.values(LEADERS)) { expect(defeated.filter(d => d === L.id).length).toBe(1); expect(L.bounty).toBe(LEADER_BOUNTY); }
    expect(defeated.filter(d => d === MASTER.id).length).toBe(1);
  });

  it('has 21 distinct underground challenges, four keys and four legendary vehicles', () => {
    expect(UG_CHALLENGES.length).toBe(21);
    expect(new Set(UG_CHALLENGES.map(m => m.title.replace(/^\d+\. /, ''))).size).toBe(21);
    // at least eight different kinds of objective across them
    expect(new Set(UG_CHALLENGES.flatMap(m => m.phases.map(p => p.kind))).size).toBeGreaterThanOrEqual(10);
    expect(MISSIONS.filter(m => m.key).map(m => m.key).sort()).toEqual([1, 2, 3, 4]);
    expect(MISSIONS.filter(m => m.legend).map(m => m.legend).sort()).toEqual(LEGENDS.map(l => l.id).sort());
    expect(MISSIONS.filter(m => m.core).map(m => m.id)).toEqual(['finale']);
    // every requirement exists and the campaign is one connected chain
    for (const m of MISSIONS) for (const r of m.requires) expect(MISSION_BY_ID[r], `${m.id} needs ${r}`).toBeTruthy();
  });

  it('places every mission start, enemy, objective and route on open, dry ground', () => {
    const bad: string[] = [];
    const chk = (l: string, x: number, z: number) => { if (!(T.normalAt(x, z)[1] > 0.75) || T.waterDepthAt(x, z) > 0.45) bad.push(l); };
    for (const m of MISSIONS) {
      const s = W.where(m.start); chk(`${m.id} start`, s.x, s.z);
      for (const e of m.enemies) { const p = W.where(e.at); chk(`${m.id} ${e.key}`, p.x, p.z); if (e.route) expect(W.route(e.route).length).toBeGreaterThan(1); }
      m.phases.forEach((ph, i) => {
        if ('to' in ph) { const p = W.where(ph.to); chk(`${m.id}/${i} to`, p.x, p.z); }
        if ('zone' in ph) { const p = W.where(ph.zone); chk(`${m.id}/${i} zone`, p.x, p.z); }
        if (ph.kind === 'collect') ph.points.forEach((q, j) => { const p = W.where(q); chk(`${m.id}/${i} point ${j}`, p.x, p.z); });
        if (ph.kind === 'destroy') ph.pylons.forEach((q, j) => { const p = W.where(q); chk(`${m.id}/${i} pylon ${j}`, p.x, p.z); });
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('the underground', () => {
  it('connects the entry hall to the final arena through every challenge hall', () => {
    const U = T.underground;
    expect(U.chambers.filter(c => c.kind === 'challenge').length).toBe(21);
    expect(U.chambers.filter(c => c.kind === 'repair').length).toBe(3);
    const path = U.route(0, U.chambers.length - 1);
    let worst = 1, minCeil = Infinity, prevH = U.heightAt(...path[0]);
    let steepest = 0;
    for (let k = 1; k < path.length; k++) {
      const [ax, az] = path[k - 1], [bx, bz] = path[k];
      for (let t = 0.25; t <= 1; t += 0.25) {
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t, h = U.heightAt(x, z);
        worst = Math.min(worst, U.normalAt(x, z)[1]); minCeil = Math.min(minCeil, U.ceilingAt(x, z) - h);
        steepest = Math.max(steepest, Math.abs(h - prevH) / Math.max(1, Math.hypot(bx - ax, bz - az) * 0.25)); prevH = h;
      }
    }
    console.log(`underground route: ${path.length} points, flattest normal ${worst.toFixed(2)}, lowest headroom ${minCeil.toFixed(1)} m, steepest grade ${(steepest * 100).toFixed(0)}%`);
    expect(worst).toBeGreaterThan(0.8);
    expect(minCeil).toBeGreaterThan(5);
    for (const [x, z] of path) expect(inUnderground(x, z)).toBe(true);
  });
  it('keeps each challenge\'s exit gate shut until the challenge is beaten', () => {
    const U = T.underground;
    expect(U.gates.length).toBe(21);
    const g5 = U.gates.findIndex(g => U.chambers[g.chamber].challenge === 5);
    expect(ugGateOpen(U, g5, [], 'ug-05')).toBe(false);
    expect(ugGateOpen(U, g5, ['ug-05'], null)).toBe(true);
    const g15 = U.gates.findIndex(g => U.chambers[g.chamber].challenge === 15);
    expect(ugGateOpen(U, g15, [], 'ug-15')).toBe(true); // the collapsing shaft is the run through its gate
    // a closed gate is a wall
    T.setGate(g5, false);
    const b = T.boxes[T.ugGateBoxes[g5]];
    expect(b.cy).toBeGreaterThan(U.heightAt(b.cx, b.cz));
    T.setGate(g5, true); expect(T.boxes[T.ugGateBoxes[g5]].cy).toBeLessThan(U.heightAt(b.cx, b.cz) - 10); T.setGate(g5, false);
  });
});

describe('story progression (server rules)', () => {
  const pois = () => T.outer.island.pois;
  const at = (m: MissionDef) => { const p = W.where(m.start); return { x: p.x, z: p.z }; };
  const run = (c: Career, req: Parameters<typeof transact>[1], ctx: GarageContext) => { const r = transact(c, req, { pois: pois(), ...ctx }); if (!r.ok) throw new Error(`${req.op}: ${r.error}`); return r.career; };
  /** Play a mission by the rules: start it, wait its minimum time, finish where it is played. */
  const play = (c: Career, id: string, t: number) => {
    const m = MISSION_BY_ID[id], where = at(m);
    c = run(c, { op: 'story-start', mission: id }, { at: where, now: t });
    return run(c, { op: 'story-done', mission: id }, { at: where, now: t + m.minTime * 1000 + 1 });
  };

  it('refuses locked missions, instant completions, completions from far away and replays of the payout', () => {
    let c = newCareer();
    const g11 = MISSION_BY_ID['g1-1'];
    expect(transact(c, { op: 'story-start', mission: 'g1-1' }, { pois: pois(), at: at(g11), now: 0 }).ok).toBe(false);
    c = play(c, 'p1-legacy', 0);
    // the prologue's pages must really be picked up, beside their places
    expect(transact(c, { op: 'story-page', page: 'page-plain' }, { pois: pois(), at: { x: 0, z: 0 } }).ok).toBe(false);
    for (const p of PAGES.slice(0, 3)) { const q = pois().find(o => o.id === p.poi)!; c = run(c, { op: 'story-page', page: p.id }, { at: { x: q.x + 20, z: q.z + 20 } }); }
    c = play(c, 'p2-footsteps', 1e5);
    const start = (x: Career) => run(x, { op: 'story-start', mission: 'g1-1' }, { at: at(g11), now: 1e6 });
    const s = start(c);
    expect(transact(s, { op: 'story-done', mission: 'g1-1' }, { pois: pois(), at: at(g11), now: 1e6 + 2000 }).ok).toBe(false); // too fast
    expect(transact(s, { op: 'story-done', mission: 'g1-1' }, { pois: pois(), at: { x: 0, z: 0 }, now: 1e6 + 60000 }).ok).toBe(false); // far away
    expect(transact(s, { op: 'story-done', mission: 'g1-2' }, { pois: pois(), at: at(g11), now: 1e6 + 60000 }).ok).toBe(false); // not the active mission
    const before = s.cash;
    const done = run(s, { op: 'story-done', mission: 'g1-1' }, { at: at(g11), now: 1e6 + 60000 });
    expect(done.cash - before).toBe(missionPayout(g11));
    expect(done.story.defeated).toContain(g11.defeats[0]);
    // replaying pays nothing
    const again = play(done, 'g1-1', 2e6);
    expect(again.cash).toBe(done.cash);
    // a forged save can't claim the Sovereign
    const forged = sanitizeCareer({ ...again, owned: { ...again.owned, 'sovereign-x1': { build: {}, unlocked: [], spent: 0 } } });
    expect(forged.owned['sovereign-x1']).toBeUndefined();
  });

  it('plays the whole campaign to the end by the rules: four keys, four legends, the underground and the Sovereign', () => {
    let c = newCareer(), t = 0;
    c = play(c, 'p1-legacy', t += 1e6);
    for (const p of PAGES) { const q = pois().find(o => o.id === p.poi)!; c = run(c, { op: 'story-page', page: p.id }, { at: { x: q.x, z: q.z } }); }
    expect(c.cash).toBe(newCareer().cash + MISSION_BY_ID['p1-legacy'].reward + 3 * 3000);
    c = play(c, 'p2-footsteps', t += 1e6);
    for (const m of MISSIONS.filter(x => x.chapter.startsWith('gang'))) c = play(c, m.id, t += 1e6);
    expect(c.story.keys.sort()).toEqual([1, 2, 3, 4]);
    expect(c.story.legends.length).toBe(4);
    for (const L of LEGENDS) { const ov = c.owned[L.vehicle]; expect(ov, L.id).toBeTruthy(); }
    // the underground gate needs all four keys, and only at the gate
    expect(transact(c, { op: 'ug-enter' }, { pois: pois(), at: { x: 0, z: 0 } }).ok).toBe(false);
    const gate = pois().find(p => p.id === 'underground')!;
    c = run(c, { op: 'ug-enter' }, { at: { x: gate.x, z: gate.z } });
    c = play(c, 'ug-descent', t += 1e6);
    for (const m of UG_CHALLENGES) {
      // a challenge can't be claimed from the surface
      const s = run(c, { op: 'story-start', mission: m.id }, { at: at(m), now: t += 1e6 });
      expect(transact(s, { op: 'story-done', mission: m.id }, { pois: pois(), at: { x: gate.x, z: gate.z }, now: t + 1e6 }).ok).toBe(false);
      c = play(c, m.id, t += 1e6);
    }
    expect(c.owned['sovereign-x1']).toBeUndefined();
    c = play(c, 'finale', t += 1e6);
    expect(c.story.core).toBe(true);
    expect(c.owned['sovereign-x1']).toBeTruthy();
    expect(c.story.done.length).toBe(MISSIONS.length);
    expect(MISSIONS.every(m => !missionLock(c.story, m))).toBe(true);
    const total = MISSIONS.reduce((a, m) => a + missionPayout(m), 0);
    console.log(`campaign: ${MISSIONS.length} missions, ${c.story.defeated.length} people defeated, payouts $${total.toLocaleString('en-US')}, final cash $${c.cash.toLocaleString('en-US')}`);
    expect(c.cash).toBe(newCareer().cash + total + 3 * 3000);
    // the save survives a round trip
    expect(sanitizeCareer(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
});

// ------------------------------------------------------------------ headless missions with an autopilot
const DT = 1 / 240;
function playHeadless(id: string, vid = 'ranger-tx4', cap = 240) {
  const def = MISSION_BY_ID[id];
  const U = T.underground;
  // the gates the director would open: every gate behind the player, and this challenge's own when it is the run
  const done = MISSIONS.slice(0, MISSIONS.indexOf(def)).map(m => m.id);
  U.gates.forEach((_, i) => T.setGate(i, ugGateOpen(U, i, done, id)));
  const sim = new MissionSim(W, def);
  const pv = new Vehicle(vehicleById(vid), T), s = sim.startPose;
  pv.reset(s.x, s.z, s.heading);
  for (let i = 0; i < 120; i++) pv.step(DT, { throttle: 0, brake: 1, steer: 0, handbrake: 1 });
  const ai = new AiDriver(pv); ai.skill = 0.85; ai.maxKmh = 110;
  let t = 0, phase = -1, still = 0, sx = 0, sz = 0;
  const log: string[] = [];
  while (sim.status === 'running' && t < cap) {
    // autopilot: choose a behaviour for the current objective
    const ph = sim.phase;
    if (sim.phaseIndex !== phase) {
      phase = sim.phaseIndex;
      const g = sim.guide();
      if (g) ai.setPath(g.pts, g.loop, ph.kind === 'precision' ? 7 : 30);
    }
    let target = null;
    if (ph.kind === 'takedown' || ph.kind === 'catch') {
      const e = sim.enemies.find(x => (ph.kind === 'catch' ? x.key === ph.target : ph.targets.includes(x.key)) && x.state === 'active');
      if (e) { ai.behavior = { kind: 'chase', ram: true }; target = { x: e.vehicle.body.pos.x, z: e.vehicle.body.pos.z, vx: e.vehicle.body.vel.x, vz: e.vehicle.body.vel.z }; }
    } else if (ph.kind === 'survive') { ai.behavior = { kind: 'hold', x: sim.origin.x, z: sim.origin.z, r: 25 }; }
    else if (ph.kind === 'talk' || ph.kind === 'descend') sim.signal(ph.kind);
    else if (ph.kind === 'destroy') { const o = sim.objectivePoint(); if (o) { ai.behavior = { kind: 'chase', ram: true }; target = { x: o.x, z: o.z, vx: 0, vz: 0 }; } }
    else if (!sim.guide()) { const o = sim.objectivePoint(); if (o) ai.behavior = { kind: 'path', pts: [[o.x, o.z]], loop: false, speed: ph.kind === 'stealth' ? 18 : 25 }; }
    for (let k = 0; k < 4; k++) {
      sim.substep(DT, pv);
      pv.step(DT, sim.frozen ? { throttle: 0, brake: 1, steer: 0, handbrake: 1 } : ai.update(DT, target));
      t += DT;
    }
    // like a player would: press R when wedged for ten seconds
    if (Math.hypot(pv.body.pos.x - sx, pv.body.pos.z - sz) > 3) { sx = pv.body.pos.x; sz = pv.body.pos.z; still = 0; } else if ((still += DT * 4) > 10) { sim.recoverPlayer(pv); still = 0; }
    sim.update(DT * 4, { x: pv.body.pos.x, z: pv.body.pos.z, vx: pv.body.vel.x, vz: pv.body.vel.z, vehicle: pv });
    for (const e of sim.events.splice(0)) if (e.type !== 'checkpoint' && e.type !== 'spawn') log.push(`${t.toFixed(1)}s ${e.type}${'name' in e ? ` ${e.name}` : ''}${'reason' in e ? ` (${e.reason})` : ''}`);
  }
  U.gates.forEach((_, i) => T.setGate(i, false));
  console.log(`${id} "${def.title}": ${sim.status}${sim.failReason ? ` (${sim.failReason})` : ''} after ${t.toFixed(0)} s · player damage ${(overallDamage(pv.condition) * 100).toFixed(0)}% · ${log.join(' · ')}`);
  return { sim, t, pv };
}

describe('missions run headless (autopilot player, AI enemies, real vehicle physics)', () => {
  // the autopilot is a bot, not a skilled player: these must end in a verdict, and the plain ones must be winnable
  it('a chase: catch or wreck the scout before he gets away', () => {
    const r = playHeadless('g1-1');
    expect(r.sim.status).not.toBe('running');
    expect(r.t).toBeGreaterThan(MISSION_BY_ID['g1-1'].minTime);
  }, 120000);
  it('a takedown: two patrol crawlers rammed off the road', () => {
    const r = playHeadless('g1-2');
    expect(r.sim.status).not.toBe('running');
    const wrecked = r.sim.enemies.filter(e => e.state === 'wrecked').length;
    expect(r.sim.status === 'won' ? wrecked : 2).toBe(2);
  }, 120000);
  it('a race against three Dune Vipers on the Plains Loop', () => {
    const r = playHeadless('g2-1', 'ranger-tx4', 300);
    expect(r.sim.status).not.toBe('running');
  }, 160000);
  it('underground: the slalom, the searchlights, the sand race, the pylons and the collapsing shaft', () => {
    for (const id of ['ug-01', 'ug-02', 'ug-05', 'ug-13', 'ug-15']) {
      const r = playHeadless(id, 'bramble-rc2', 200);
      expect(r.sim.status, id).not.toBe('running');
      if (id === 'ug-13' || id === 'ug-15') expect(r.sim.status, id).toBe('won');
    }
  }, 300000);
  it('the finale: Crowe in the Sovereign flees, then fights with his guards', () => {
    const r = playHeadless('finale', 'ranger-tx4', 240);
    expect(r.sim.status).not.toBe('running');
    const crowe = r.sim.enemies.find(e => e.key === MASTER.id)!;
    expect(crowe.vehicle.spec.id).toBe('sovereign-x1');
  }, 200000);
});
