import { describe, it, expect, beforeAll } from 'vitest';
import {
  Terrain, Character, VehicleTransition, APPROACH_TIMEOUT, pickInteractable, Npc, CAMP_MECHANIC, DialogueSession, validateDialogue,
  DEFAULT_MALE, DEFAULT_FEMALE, encodeAppearance, decodeAppearance, sanitizeAppearance, randomAppearance, statureOf,
  HAIR_STYLES, BEARD_STYLES, TOP_STYLES, HEADWEAR, ACCESSORIES, SKIN_TONES,
  type MoveInput, type LocomotionState, type CharacterAppearance, type Interactable,
} from '@orl/shared';

/** Phase 3 quality gate: appearance data, locomotion states, enter/exit, interaction, NPC and dialogue. */
let pg: Terrain; // flat proving ground
beforeAll(() => {
  pg = new Terrain();
  pg.heights.fill(20); pg.surface.fill(1); pg.mudDepth.fill(0);
  pg.boulders.length = 0; pg.trees.length = 0; pg.boxes.length = 0; pg.reindexBoxes();
  (pg as unknown as { grid: Map<number, unknown> }).grid.clear();
});
const DT = 1 / 60;
const idle: MoveInput = { forward: 0, right: 0, sprint: false, jump: false, crouch: false, camYaw: 0 };
const run = (c: Character, secs: number, inp: Partial<MoveInput>, each?: (s: LocomotionState) => void) => {
  for (let s = 0; s < secs; s += DT) { c.update(DT, { ...idle, ...inp }, []); each?.(c.state); }
};
// simple deterministic generator for the random-appearance tests
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe('character appearance (customization data)', () => {
  it('round-trips every default through the network code', () => {
    for (const a of [DEFAULT_MALE, DEFAULT_FEMALE]) {
      const code = encodeAppearance(a);
      expect(code).toMatch(/^[mf][0-9]{4}[0-9a-z]{14}$/);
      const b = decodeAppearance(code);
      expect({ ...b, height: Math.round(b.height * 99), build: Math.round(b.build * 99) })
        .toEqual({ ...a, height: Math.round(a.height * 99), build: Math.round(a.build * 99) });
    }
  });
  it('round-trips 200 random looks, covering every option list', () => {
    const rnd = lcg(7), seen = { hair: new Set<string>(), top: new Set<string>(), head: new Set<string>(), beard: new Set<string>(), acc: new Set<string>() };
    for (let i = 0; i < 200; i++) {
      const a = randomAppearance(rnd);
      expect(sanitizeAppearance(a)).toEqual(a); // random output is already valid
      const b = decodeAppearance(encodeAppearance(a));
      expect(encodeAppearance(b)).toBe(encodeAppearance(a));
      expect(b.accessories.sort()).toEqual([...a.accessories].sort());
      seen.hair.add(a.hair); seen.top.add(a.top); seen.head.add(a.headwear); seen.beard.add(a.beard); a.accessories.forEach(x => seen.acc.add(x));
      if (a.body === 'female') expect(a.beard).toBe('none');
    }
    expect(seen.hair.size).toBe(HAIR_STYLES.length);
    expect(seen.top.size).toBe(TOP_STYLES.length);
    expect(seen.head.size).toBe(HEADWEAR.length);
    expect(seen.beard.size).toBe(BEARD_STYLES.length);
    expect(seen.acc.size).toBe(ACCESSORIES.length);
  });
  it('sanitizes hostile input into a valid look', () => {
    const a = sanitizeAppearance({ body: 'female', beard: 'full', height: 9, build: -3, skin: 99, hair: '<script>', accessories: ['watch', 'watch', 'jetpack'], topColor: 1.5 });
    expect(a.beard).toBe('none');
    expect(a.height).toBe(1); expect(a.build).toBe(0);
    expect(a.skin).toBe(DEFAULT_FEMALE.skin);
    expect(a.hair).toBe(DEFAULT_FEMALE.hair);
    expect(a.accessories).toEqual(['watch']);
    expect(a.topColor).toBe(DEFAULT_FEMALE.topColor);
    expect(sanitizeAppearance('nonsense')).toEqual(DEFAULT_MALE);
    for (const bad of [null, 42, '', 'x0000000000000000000', 'm00000000000000000000', 'mzz00000000000000000']) expect(decodeAppearance(bad)).toEqual(DEFAULT_MALE);
    // a well-formed code with out-of-range digits still decodes to something valid
    const wild = decodeAppearance('m9999zzzzzzzzzzzzzz');
    expect(SKIN_TONES[wild.skin]).toBeDefined();
    expect(HAIR_STYLES).toContain(wild.hair);
  });
  it('maps height and body to a plausible stature', () => {
    const s = (a: Partial<CharacterAppearance>) => statureOf({ ...DEFAULT_MALE, ...a });
    expect(s({ height: 0 })).toBeCloseTo(1.6); expect(s({ height: 1 })).toBeCloseTo(1.95);
    expect(s({ body: 'female', height: 0 })).toBeCloseTo(1.52); expect(s({ body: 'female', height: 1 })).toBeCloseTo(1.85);
  });
});

describe('character controller locomotion states', () => {
  const fresh = () => { const c = new Character(pg); c.place(0, -380); return c; };
  it('goes idle → walk → run → sprint with matching speeds', () => {
    const c = fresh();
    run(c, 0.5, {}); expect(c.state).toBe('idle');
    run(c, 1.5, { forward: 1, walk: true }); expect(c.state).toBe('walk'); expect(c.speed).toBeGreaterThan(1.4); expect(c.speed).toBeLessThan(2);
    run(c, 1.5, { forward: 1 }); expect(c.state).toBe('run'); expect(c.speed).toBeGreaterThan(3.2); expect(c.speed).toBeLessThan(4);
    run(c, 1.5, { forward: 1, sprint: true }); expect(c.state).toBe('sprint'); expect(c.speed).toBeGreaterThan(6.8);
    expect(c.stamina).toBeLessThan(1);
  });
  it('sprint runs out of stamina and drops back to a run', () => {
    const c = fresh();
    run(c, 9, { forward: 1, sprint: true }); // a full bar lasts 8 s
    expect(c.exhausted).toBe(true);
    expect(c.stamina).toBeLessThan(0.3);
    expect(c.state).toBe('run');
    // winded: holding sprint does not flicker back into a sprint until 30% stamina has returned
    let sprinted = false;
    run(c, 0.3, { forward: 1, sprint: true }, s => { sprinted ||= s === 'sprint'; });
    expect(sprinted).toBe(false);
    run(c, 6, { forward: 1 });
    expect(c.exhausted).toBe(false);
    run(c, 1, { forward: 1, sprint: true }); expect(c.state).toBe('sprint');
  });
  it('crouches and crouch-walks slowly', () => {
    const c = fresh();
    run(c, 0.5, { crouch: true }); expect(c.state).toBe('crouch');
    run(c, 1.5, { crouch: true, forward: 1 }); expect(c.state).toBe('crouch-walk'); expect(c.speed).toBeLessThan(1.8);
    run(c, 1, { crouch: true, forward: 1, sprint: true }); expect(c.speed).toBeLessThan(1.8); // no sprinting while crouched
  });
  it('jumps through jump → fall → land → idle, and cannot re-jump while landing', () => {
    const c = fresh();
    run(c, 0.3, {});
    const states: LocomotionState[] = [];
    c.update(DT, { ...idle, jump: true }, []);
    run(c, 2, {}, s => { if (states[states.length - 1] !== s) states.push(s); });
    expect(states).toEqual(['jump', 'fall', 'land', 'idle']);
    // peak height of a 5.2 m/s jump ≈ 1.38 m
    const c2 = fresh(); let peak = 0; const g = c2.pos.y;
    c2.update(DT, { ...idle, jump: true }, []);
    run(c2, 1.2, {}, () => { peak = Math.max(peak, c2.pos.y - g); });
    expect(peak).toBeGreaterThan(1.2); expect(peak).toBeLessThan(1.5);
    // landing recovery blocks an immediate second jump
    const c3 = fresh();
    c3.update(DT, { ...idle, jump: true }, []);
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++) { c3.update(DT, idle, []); landed = c3.state === 'land'; }
    expect(landed).toBe(true);
    c3.update(DT, { ...idle, jump: true }, []);
    expect(c3.grounded).toBe(true);
  });
  it('a longer fall gives a longer landing recovery', () => {
    const drop = (h: number) => { const c = fresh(); c.pos.y += h; c.grounded = false; let lt = 0; run(c, 3, {}, () => { lt = Math.max(lt, c.landTimer); }); return lt; };
    expect(drop(4)).toBeGreaterThan(drop(0.6) + 0.1);
  });
  it('taller characters take longer strides (slower animation phase at the same speed)', () => {
    const a = fresh(), b = fresh(); b.stature = 1.1;
    run(a, 2, { forward: 1, walk: true }); run(b, 2, { forward: 1, walk: true });
    expect(b.animPhase / b.speed).toBeLessThan(a.animPhase / a.speed);
  });
});

describe('enter / exit vehicle sequence', () => {
  const door = { x: 3, z: -380, vehicleYaw: 0 };
  it('walks to the door, turns to face the cab, climbs in', () => {
    const c = new Character(pg); c.place(-1, -383);
    const tr = new VehicleTransition('enter');
    const phases: string[] = [];
    for (let i = 0; i < 600 && !tr.done; i++) { const p = tr.update(DT, c, door, []); if (phases[phases.length - 1] !== p) phases.push(p); }
    expect(phases).toEqual(['approach', 'climb-in', 'done']);
    expect(Math.hypot(c.pos.x - door.x, c.pos.z - door.z)).toBeLessThan(0.35);
    // the door is on the vehicle's +X side, so facing the cab means facing -X
    expect(Math.sin(c.heading)).toBeLessThan(-0.95);
    expect(tr.progress).toBe(1);
  });
  it('a blocked approach times out and snaps to the door instead of hanging', () => {
    const c = new Character(pg); c.place(-1, -380);
    const wall = [{ cx: 1, cz: -380, hx: 0.3, hz: 4, yaw: 0, top: 100 }];
    const tr = new VehicleTransition('enter');
    let t = 0;
    while (!tr.done && t < 10) { tr.update(DT, c, door, wall); t += DT; }
    expect(tr.done).toBe(true);
    expect(t).toBeGreaterThan(APPROACH_TIMEOUT);
    expect(t).toBeLessThan(APPROACH_TIMEOUT + 1.2);
  });
  it('exit climbs out and turns away from the cab', () => {
    const c = new Character(pg); c.place(door.x, door.z); c.heading = 0;
    const tr = new VehicleTransition('exit');
    expect(tr.phase).toBe('climb-out');
    let n = 0;
    while (!tr.done && n++ < 200) tr.update(DT, c, door, []);
    expect(tr.done).toBe(true);
    expect(Math.sin(c.heading)).toBeGreaterThan(0.95);
  });
});

describe('interaction picking', () => {
  const list: Interactable[] = [
    { id: 'a', kind: 'vehicle', x: 0, z: 2, radius: 3, label: 'ahead' },
    { id: 'b', kind: 'npc', x: 0, z: -1.6, radius: 3, label: 'behind' },
    { id: 'c', kind: 'fuel', x: 20, z: 0, radius: 3, label: 'far' },
  ];
  it('prefers what the character faces, even if slightly further', () => {
    expect(pickInteractable(0, 0, 0, list)?.id).toBe('a');
    expect(pickInteractable(0, 0, Math.PI, list)?.id).toBe('b');
  });
  it('ignores things out of reach', () => {
    expect(pickInteractable(0, 0, Math.PI / 2, list.slice(2))).toBeNull();
    expect(pickInteractable(19, 0, 0, list)?.id).toBe('c');
  });
});

describe('NPC routine and dialogue', () => {
  it('the camp mechanic dialogue is well-formed', () => {
    expect(validateDialogue(CAMP_MECHANIC.dialogue, CAMP_MECHANIC.start)).toEqual([]);
    expect(validateDialogue({ a: { id: 'a', text: '', options: [{ text: 'x', next: 'zz' }] } }, 'q')).toHaveLength(2);
  });
  it('walks her route, lingers, and stops to face the player while talking', () => {
    const n = new Npc({ ...CAMP_MECHANIC, route: [[0, -380], [6, -380]], linger: 1 }, pg);
    let walked = false, reached = false;
    for (let i = 0; i < 60 * 12; i++) { n.update(DT, []); walked ||= n.state === 'walk'; reached ||= Math.hypot(n.body.pos.x - 6, n.body.pos.z + 380) < 0.6; }
    expect(walked).toBe(true); expect(reached).toBe(true);
    const before = { x: n.body.pos.x, z: n.body.pos.z };
    n.startTalk(n.body.pos.x, n.body.pos.z - 3); // player stands to her -Z
    for (let i = 0; i < 90; i++) n.update(DT, []);
    expect(n.state).toBe('talk');
    expect(Math.cos(n.body.heading)).toBeLessThan(-0.95);
    expect(Math.hypot(n.body.pos.x - before.x, n.body.pos.z - before.z)).toBeLessThan(0.3);
    n.endTalk();
    expect(n.state).toBe('idle');
  });
  it('skips a waypoint she cannot reach instead of walking into a wall forever', () => {
    const n = new Npc({ ...CAMP_MECHANIC, route: [[0, -380], [0, -370], [6, -380]], linger: 0.2 }, pg);
    const wall = [{ cx: 0, cz: -375, hx: 3, hz: 0.3, yaw: 0, top: 100 }];
    let reachedThird = false;
    for (let i = 0; i < 60 * 30 && !reachedThird; i++) { n.update(DT, wall); reachedThird = Math.hypot(n.body.pos.x - 6, n.body.pos.z + 380) < 0.6; }
    expect(reachedThird).toBe(true);
  });
  it('dialogue actions run and can divert to another node', () => {
    const calls: string[] = [];
    let hasCar = false;
    const s = new DialogueSession(CAMP_MECHANIC, a => { calls.push(a); return a === 'repair' && !hasCar ? 'no-vehicle' : undefined; });
    expect(s.node?.id).toBe('greet');
    s.choose(0); expect(s.node?.id).toBe('no-vehicle');
    s.choose(0); expect(s.node?.id).toBe('greet');
    hasCar = true;
    s.choose(0); expect(s.node?.id).toBe('repaired');
    s.choose(0); s.choose(1); expect(s.node?.id).toBe('restocked');
    s.choose(1); expect(s.ended).toBe(true);
    expect(calls).toEqual(['repair', 'repair', 'restock']);
    s.choose(0); // choosing on an ended session is a no-op
    expect(s.ended).toBe(true);
  });
});
