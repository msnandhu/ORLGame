import { GANGSTERS, LEADERS, MASTER, GANGS, UG_GUARDS, LEGENDS, type GangId, type Temper } from './roster';

/**
 * "The Lost Empire": every mission of the campaign as data. A mission is a list of phases (objectives) played in
 * order; each phase is one of a dozen objective kinds the runtime knows how to run and judge. Places are given
 * relative to story sites (a gang compound's road, a compound itself, an underground hall, a map place), so the
 * same data is placed identically on every machine.
 */

/** Where something is. */
export type Where =
  /** on the road a compound stands beside: `along` metres from the compound's road point (+ = along the road's direction), `side` metres to the right */
  | { at: 'road'; site: string; along: number; side?: number }
  /** in a compound's own frame: lx to the right, lz towards the gate */
  | { at: 'compound'; site: string; lx: number; lz: number }
  /** in an underground hall: `ang` radians from the way out, `rr` fraction of its radius; `ch` is the challenge number (0 = entry hall, 99 = final arena) */
  | { at: 'ug'; ch: number; ang: number; rr: number }
  /** at a map place */
  | { at: 'poi'; poi: string; dx?: number; dz?: number };

/** A route (checkpoints, patrol or flight path). */
export type Route =
  | { kind: 'road'; site: string; from: number; to: number; step?: number }
  | { kind: 'ring'; ch: number; rr: number; n: number; reverse?: boolean }
  | { kind: 'slalom'; ch: number }
  | { kind: 'tunnel'; ch: number };

export type Phase =
  | { kind: 'reach'; to: Where; r?: number; time?: number; text: string }
  | { kind: 'race'; route: Route; laps: number; rivals: string[]; text: string }
  | { kind: 'takedown'; targets: string[]; time?: number; text: string }
  | { kind: 'catch'; target: string; hold: number; escape: number; time?: number; text: string }
  | { kind: 'survive'; seconds: number; text: string }
  | { kind: 'hold'; zone: Where; r: number; seconds: number; text: string }
  | { kind: 'collect'; points: Where[]; time?: number; text: string; pages?: boolean }
  | { kind: 'stealth'; lights: { at: Where; sweep: number; range: number }[]; exit: Where; text: string }
  | { kind: 'destroy'; pylons: Where[]; time?: number; text: string }
  | { kind: 'outrun'; to: Where; speed: number; head: number; text: string }
  | { kind: 'precision'; route: Route; laps: number; maxHits: number; time: number; text: string }
  | { kind: 'talk'; npc: string; text: string }
  | { kind: 'descend'; text: string };

export interface EnemyDef {
  /** key used by objectives; also the gangster id when it is a named person */
  key: string;
  /** gangster id, or 'guard' for one of Crowe's unnamed guards */
  who: string;
  vehicle?: string;
  at: Where;
  /** start heading: along the road ('road' / 'road-back'), towards the hall's centre, or radians */
  face?: 'road' | 'road-back' | 'centre' | number;
  temper: Temper;
  /** a path for racers, fleers and patrols */
  route?: Route;
  /** appears when this phase starts (default 0), optionally a few seconds in */
  phase?: number; delay?: number;
  skill?: number; armor?: number; maxKmh?: number;
  /** a boss: health bar, intro card */
  boss?: boolean;
}

export type Chapter = 'prologue' | 'gang1' | 'gang2' | 'gang3' | 'gang4' | 'underground' | 'finale';
export interface MissionDef {
  id: string; chapter: Chapter; title: string;
  /** who hands it out (shown on the briefing) */
  giver: string;
  brief: string;
  /** missions that must be complete first; keys needed */
  requires: string[]; keys?: number;
  /** where the mission is started (marker) */
  start: Where;
  /** the vehicle must be on, or it can be on foot (talk missions) */
  onFoot?: boolean;
  phases: Phase[];
  enemies: EnemyDef[];
  /** named gang members this mission defeats (their bounties are paid) */
  defeats: string[];
  /** base reward on top of bounties */
  reward: number;
  key?: GangId;
  legend?: string;
  /** recover the father's core vehicle */
  core?: boolean;
  /** cutscenes before and after */
  intro?: string; outro?: string;
  /** minimum believable completion time, seconds (the server refuses faster claims) */
  minTime: number;
  /** a journal entry unlocked on completion */
  journal?: string;
}

const G = (gang: GangId, name: string) => {
  const g = GANGSTERS.find(m => m.gang === gang && m.name === name);
  if (!g) throw new Error(`no gangster ${name} in gang ${gang}`);
  return g;
};
const SITE = (gang: GangId) => `gang${gang}-hq`;
const road = (gang: GangId, along: number, side = 0): Where => ({ at: 'road', site: SITE(gang), along, side });
const member = (gang: GangId, name: string, at: Where, o: Partial<EnemyDef> = {}): EnemyDef => {
  const g = G(gang, name);
  return { key: g.id, who: g.id, vehicle: g.vehicle, at, temper: g.temper, skill: 0.45 + g.difficulty * 0.09, armor: 0.8 + g.difficulty * 0.2, face: 'road', ...o };
};
const ids = (e: EnemyDef[]) => e.map(x => x.key);
const ug = (ch: number, ang = 0, rr = 0): Where => ({ at: 'ug', ch, ang, rr });
const guard = (key: string, vehicle: string, at: Where, temper: Temper, o: Partial<EnemyDef> = {}): EnemyDef => ({ key, who: 'guard', vehicle, at, temper, face: 'centre', skill: 0.75, armor: 1.4, ...o });

/** Father's journal pages scattered across the island (free roam collectibles beyond the three in the prologue). */
export const PAGES: { id: string; poi: string; title: string; text: string }[] = [
  { id: 'page-plain', poi: 'plain-city', title: 'Page I · Plain City', text: 'I built Plain City\'s roads with Silas. Two kids with one tow truck and a borrowed shovel. He drove, I fixed. It was the best year of my life.' },
  { id: 'page-millbrook', poi: 'millbrook', title: 'Page II · Millbrook', text: 'Dax, Rhea, Ivan, Marek. My four captains. I gave each a region and a key to the underground, because no single person should hold all four. Not even me.' },
  { id: 'page-ashby', poi: 'ashby', title: 'Page III · Ashby Hollow', text: 'Silas asks about the keys too often. If anything happens, Ezra knows where the Ranger is. The boy will need it.' },
  { id: 'page-ruins', poi: 'ancient-ruins', title: 'Page IV · Ancient Ruins', text: 'The underground was here before us. We only dug it out, sealed it with four locks and drove through it like kings.' },
  { id: 'page-research', poi: 'research-base', title: 'Page V · Research Base', text: 'The Sovereign X1 is finished. Twin turbos, armour, legs like a crawler. Silas couldn\'t take his eyes off it.' },
  { id: 'page-lookout', poi: 'watch-tower', title: 'Page VI · Watch Tower', text: 'From up here you can see all four regions. One island. One family. That was the dream.' },
];
/** Where a journal page lies: beside its map place. */
export const pageWhere = (p: { poi: string }): Where => ({ at: 'poi', poi: p.poi, dx: 24, dz: 30 });

export const MISSIONS: MissionDef[] = [];
const add = (m: MissionDef) => { MISSIONS.push(m); return m; };

// ------------------------------------------------------------------ prologue
add({ id: 'p1-legacy', chapter: 'prologue', title: 'The Last Legend', giver: 'Ezra Holloway', onFoot: true,
  brief: 'An old man has been watching your Ranger at camp. He says he knew your father.',
  requires: [], start: { at: 'poi', poi: 'base-camp', dx: 8, dz: -9 }, phases: [{ kind: 'talk', npc: 'ezra-holloway', text: 'Talk to Ezra Holloway at base camp' }],
  enemies: [], defeats: [], reward: 2500, outro: 'flashback-empire', minTime: 0, journal: 'legacy' });
add({ id: 'p2-footsteps', chapter: 'prologue', title: 'Father\'s Footsteps', giver: 'Ezra Holloway',
  brief: 'Elias Kade hid his journal in pages across the valley before the betrayal. Find three of them: in Plain City, in Millbrook and in Ashby Hollow.',
  requires: ['p1-legacy'], start: { at: 'poi', poi: 'base-camp', dx: 8, dz: -9 },
  phases: [{ kind: 'collect', pages: true, points: PAGES.slice(0, 3).map(pageWhere), text: 'Find your father\'s journal pages' }],
  enemies: [], defeats: [], reward: 5000, outro: 'flashback-betrayal', minTime: 40, journal: 'betrayal' });

// ------------------------------------------------------------------ gang 1: the Cragjaws (mountain)
{
  const g: GangId = 1;
  let e: EnemyDef[];
  e = [member(g, 'Brick Tolliver', road(g, -520), { route: { kind: 'road', site: SITE(g), from: -520, to: -2600 }, face: 'road-back', maxKmh: 85 })];
  add({ id: 'g1-1', chapter: 'gang1', title: 'Scout\'s Honour', giver: 'Ezra Holloway', brief: 'A Cragjaw scout watches the mountain road. Catch him before he reports you to Rockbreaker: box him in and hold him, or wreck his crawler.',
    requires: ['p2-footsteps'], start: road(g, -420), phases: [{ kind: 'catch', target: e[0].key, hold: 4, escape: 650, text: 'Catch Brick Tolliver' }], enemies: e, defeats: ids(e), reward: 6000, minTime: 15 });
  e = [member(g, 'Jessa Flint', road(g, -900), { route: { kind: 'road', site: SITE(g), from: -900, to: -600 } }), member(g, 'Sable Drummond', road(g, -980, 3), { route: { kind: 'road', site: SITE(g), from: -980, to: -700 } })];
  add({ id: 'g1-2', chapter: 'gang1', title: 'Ridge Patrol', giver: 'Ezra Holloway', brief: 'Two Cragjaw crawlers patrol the switchbacks. They will come for you the moment they see you. Take both off the road.',
    requires: ['g1-1'], start: road(g, -500), phases: [{ kind: 'takedown', targets: ids(e), text: 'Take down the patrol' }], enemies: e.map(x => ({ ...x, temper: 'patrol' as Temper })), defeats: ids(e), reward: 9000, minTime: 20 });
  e = [member(g, 'Petra Lusk', road(g, -1500, -3), { temper: 'racer' }), member(g, 'Noor Talbot', road(g, -1510, 3), { temper: 'racer' }), member(g, 'Wren Stavros', road(g, -1525, 0), { temper: 'racer' })];
  for (const x of e) x.route = { kind: 'road', site: SITE(g), from: -1500, to: -150 };
  add({ id: 'g1-3', chapter: 'gang1', title: 'King of the Crawl', giver: 'Ezra Holloway', brief: 'The Cragjaws settle rank with a climb up their mountain road. Enter it and beat all three of them to the top.',
    requires: ['g1-2'], start: road(g, -1540), phases: [{ kind: 'race', route: { kind: 'road', site: SITE(g), from: -1500, to: -150 }, laps: 1, rivals: ids(e), text: 'Win the climb' }], enemies: e, defeats: ids(e), reward: 12000, minTime: 45 });
  e = [member(g, 'Hob Granger', road(g, 260, 20), { temper: 'rammer' }), member(g, 'Odell Crane', road(g, 300, -20), { temper: 'rammer' }), member(g, 'Kel Ashdown', road(g, 340, 0), { temper: 'chaser', phase: 0, delay: 25 })];
  add({ id: 'g1-4', chapter: 'gang1', title: 'Quarry Ambush', giver: 'Ezra Holloway', brief: 'It\'s a trap, and you\'re walking into it on purpose. Survive the ambush on the quarry road until the Cragjaws break.',
    requires: ['g1-3'], start: road(g, 160), phases: [{ kind: 'survive', seconds: 75, text: 'Survive the ambush' }], enemies: e, defeats: ids(e), reward: 14000, minTime: 70 });
  e = [member(g, 'Garrick Boone', road(g, 520), { boss: true }), member(g, 'Rusty Vane', road(g, 540, 6), { temper: 'blocker' }), member(g, 'Gage Mercer', road(g, 560, -6)), member(g, 'Tobin Hale', road(g, 580, 0))];
  add({ id: 'g1-5', chapter: 'gang1', title: 'Slate\'s Last Stand', giver: 'Ezra Holloway', brief: 'Garrick "Slate" Boone holds the road to Rockbreaker\'s compound with his three best. Break them.',
    requires: ['g1-4'], start: road(g, 380), phases: [{ kind: 'takedown', targets: ids(e), text: 'Take down Slate and his crew' }], enemies: e, defeats: ids(e), reward: 18000, minTime: 30 });
  const L = LEADERS[g];
  e = [{ key: L.id, who: L.id, vehicle: L.vehicle, at: { at: 'compound', site: SITE(g), lx: 0, lz: 10 }, face: 'road', temper: 'rammer', skill: 0.95, armor: 4, boss: true }];
  add({ id: 'g1-boss', chapter: 'gang1', title: 'Rockbreaker', giver: 'Ezra Holloway', brief: 'Every Cragjaw is down. Dax "Rockbreaker" Morrow waits at his compound in your father\'s Summit King. Take it back.',
    requires: ['g1-5'], start: road(g, 160), phases: [{ kind: 'reach', to: { at: 'compound', site: SITE(g), lx: 0, lz: 40 }, r: 14, text: 'Drive to the Cragjaw compound' }, { kind: 'takedown', targets: [L.id], text: 'Defeat Rockbreaker' }],
    enemies: e.map(x => ({ ...x, phase: 1 })), defeats: [L.id], reward: 0, key: g, legend: L.legend, intro: 'boss-1', outro: 'key-1', minTime: 25, journal: 'key-1' });
}

// ------------------------------------------------------------------ gang 2: the Dune Vipers (dust country)
{
  const g: GangId = 2;
  let e: EnemyDef[];
  e = [member(g, 'Cass Varga', road(g, -300, -3), { temper: 'racer' }), member(g, 'Zara Quint', road(g, -310, 3), { temper: 'racer' }), member(g, 'Lux Bramwell', road(g, -325, 0), { temper: 'racer' })];
  for (const x of e) x.route = { kind: 'road', site: SITE(g), from: -300, to: -2700 };
  add({ id: 'g2-1', chapter: 'gang2', title: 'Dust Trail Sprint', giver: 'Ezra Holloway', brief: 'The Vipers race the Plains Loop for pink slips. Beat three of their drivers to the end of the straight.',
    requires: ['p2-footsteps'], start: road(g, -340), phases: [{ kind: 'race', route: { kind: 'road', site: SITE(g), from: -300, to: -2700 }, laps: 1, rivals: ids(e), text: 'Win the sprint' }], enemies: e.map(x => ({ ...x, face: 'road-back' as const })), defeats: ids(e), reward: 9000, minTime: 50 });
  e = [member(g, 'Teo Navarro', road(g, 500), { route: { kind: 'road', site: SITE(g), from: 500, to: 3200 }, maxKmh: 120 })];
  add({ id: 'g2-2', chapter: 'gang2', title: 'The Smuggler', giver: 'Ezra Holloway', brief: 'Teo Navarro runs Viper cash up the Plains Loop. Catch him before he reaches the junction.',
    requires: ['g2-1'], start: road(g, 420), phases: [{ kind: 'catch', target: e[0].key, hold: 4, escape: 800, text: 'Catch Teo Navarro' }], enemies: e, defeats: ids(e), reward: 9000, minTime: 15 });
  e = [member(g, 'Ike Sorensen', road(g, 900, 25), { temper: 'rammer' }), member(g, 'Dina Okafor', road(g, 950, -25), { temper: 'chaser' })];
  add({ id: 'g2-3', chapter: 'gang2', title: 'Viper Pit', giver: 'Ezra Holloway', brief: 'Two Viper enforcers want a word about Teo. Answer them with your bumper.',
    requires: ['g2-2'], start: road(g, 760), phases: [{ kind: 'takedown', targets: ids(e), text: 'Take down Ike and Dina' }], enemies: e, defeats: ids(e), reward: 12000, minTime: 20 });
  e = [member(g, 'Marco Ilyin', road(g, -700), { temper: 'rammer', delay: 4 }), member(g, 'Remy Castell', road(g, 700), { temper: 'rammer', delay: 8 }), member(g, 'Vic Salazar', road(g, -900), { temper: 'chaser', delay: 18, boss: true })];
  add({ id: 'g2-4', chapter: 'gang2', title: 'Fuel Run', giver: 'Ezra Holloway', brief: 'The Vipers\' fuel cache sits by the road. Hold it until their tankers give up trying to take it back.',
    requires: ['g2-3'], start: road(g, 60), phases: [{ kind: 'hold', zone: road(g, 0, 0), r: 22, seconds: 50, text: 'Hold the fuel cache' }], enemies: e, defeats: ids(e), reward: 16000, minTime: 50 });
  const L = LEADERS[g];
  e = [{ key: L.id, who: L.id, vehicle: L.vehicle, at: road(g, -200, 3), face: 'road-back', temper: 'racer', route: { kind: 'road', site: SITE(g), from: -200, to: -3200 }, skill: 0.95, armor: 3, boss: true }];
  add({ id: 'g2-boss', chapter: 'gang2', title: 'Sidewinder', giver: 'Ezra Holloway', brief: 'Rhea "Sidewinder" Solis has never been passed. She drives your father\'s Sand Viper. Beat her down the Plains Loop, then finish it.',
    requires: ['g2-4'], start: road(g, -220), phases: [{ kind: 'race', route: { kind: 'road', site: SITE(g), from: -200, to: -3200 }, laps: 1, rivals: [L.id], text: 'Beat Sidewinder to the end of the road' }, { kind: 'takedown', targets: [L.id], text: 'Defeat Sidewinder' }],
    enemies: e, defeats: [L.id], reward: 0, key: g, legend: L.legend, intro: 'boss-2', outro: 'key-2', minTime: 60, journal: 'key-2' });
}

// ------------------------------------------------------------------ gang 3: Frostline (snow)
{
  const g: GangId = 3;
  let e: EnemyDef[];
  e = [member(g, 'Bjorn Ekdahl', road(g, -500, 15), { armor: 2.2 }), member(g, 'Pavel Strand', road(g, -560, -15), { armor: 2.4 })];
  add({ id: 'g3-1', chapter: 'gang3', title: 'Heavy Haulers', giver: 'Ezra Holloway', brief: 'Frostline\'s armoured haulers own the Ridge Road. Hit them from the side: their bull bars eat anything from the front.',
    requires: ['p2-footsteps'], start: road(g, -380), phases: [{ kind: 'takedown', targets: ids(e), text: 'Take down the haulers' }], enemies: e, defeats: ids(e), reward: 12000, minTime: 25 });
  e = [member(g, 'Olin Frost', road(g, 400), { route: { kind: 'road', site: SITE(g), from: 400, to: 2600 }, maxKmh: 80 })];
  add({ id: 'g3-2', chapter: 'gang3', title: 'Whiteout Lookout', giver: 'Ezra Holloway', brief: 'Olin Frost spotted you. If he reaches the pass, Glacier will know you are coming. Catch him on the ice road.',
    requires: ['g3-1'], start: road(g, 320), phases: [{ kind: 'catch', target: e[0].key, hold: 4, escape: 650, text: 'Catch Olin Frost' }], enemies: e, defeats: ids(e), reward: 9000, minTime: 15 });
  e = [member(g, 'Sasha Krell', road(g, -260, 18), { temper: 'rammer' }), member(g, 'Hedda Lund', road(g, -300, -18), { temper: 'chaser', delay: 20 }), member(g, 'Yuri Volkov', road(g, 260, 0), { temper: 'rammer', delay: 40, boss: true })];
  add({ id: 'g3-3', chapter: 'gang3', title: 'Ice Road Siege', giver: 'Ezra Holloway', brief: 'Frostline\'s last crew comes for you on the frozen road below the compound. Stay alive and in one piece until they break.',
    requires: ['g3-2'], start: road(g, -120), phases: [{ kind: 'survive', seconds: 90, text: 'Survive the siege' }], enemies: e, defeats: ids(e), reward: 16000, minTime: 85 });
  const L = LEADERS[g];
  e = [{ key: L.id, who: L.id, vehicle: L.vehicle, at: { at: 'compound', site: SITE(g), lx: 0, lz: 8 }, face: 'road', temper: 'holder', skill: 0.9, armor: 5, boss: true }];
  add({ id: 'g3-boss', chapter: 'gang3', title: 'Glacier', giver: 'Ezra Holloway', brief: 'Ivan "Glacier" Holt opened the passes to Crowe. He waits at his gate in your father\'s Frost Titan. Take his gate, then take him.',
    requires: ['g3-3'], start: road(g, 140), phases: [{ kind: 'hold', zone: { at: 'compound', site: SITE(g), lx: 0, lz: 34 }, r: 16, seconds: 35, text: 'Take Glacier\'s gate' }, { kind: 'takedown', targets: [L.id], text: 'Defeat Glacier' }],
    enemies: e, defeats: [L.id], reward: 0, key: g, legend: L.legend, intro: 'boss-3', outro: 'key-3', minTime: 50, journal: 'key-3' });
}

// ------------------------------------------------------------------ gang 4: the Bog Kings (mud and forest)
{
  const g: GangId = 4;
  let e: EnemyDef[];
  e = [member(g, 'Mags Fenwick', road(g, -420, 15)), member(g, 'Tansy Moss', road(g, -460, -15), { temper: 'chaser' }), member(g, 'Bram Ketter', road(g, -500, 0), { temper: 'rammer' })];
  add({ id: 'g4-1', chapter: 'gang4', title: 'Into the Bog', giver: 'Ezra Holloway', brief: 'The Bog Kings meet strangers in the mud. Meet three of them back.',
    requires: ['p2-footsteps'], start: road(g, -300), phases: [{ kind: 'takedown', targets: ids(e), text: 'Take down the Bog Kings\' welcome party' }], enemies: e, defeats: ids(e), reward: 12000, minTime: 25 });
  e = [member(g, 'Lyle Barrow', road(g, -1300, -2), { temper: 'racer' }), member(g, 'Hector Bayou', road(g, -1315, 2), { temper: 'racer' })];
  for (const x of e) x.route = { kind: 'road', site: SITE(g), from: -1300, to: -100 };
  add({ id: 'g4-2', chapter: 'gang4', title: 'Mud Run', giver: 'Ezra Holloway', brief: 'Two Bog King drivers race the trail through the swamp to the compound. Get there first.',
    requires: ['g4-1'], start: road(g, -1330), phases: [{ kind: 'race', route: { kind: 'road', site: SITE(g), from: -1300, to: -100 }, laps: 1, rivals: ids(e), text: 'Win the mud run' }], enemies: e, defeats: ids(e), reward: 12000, minTime: 40 });
  e = [member(g, 'Ruth Kegan', road(g, 300, 20), { temper: 'rammer' }), member(g, 'Cole Rooker', road(g, 330, -20), { temper: 'rammer' }), member(g, 'Dez Malloy', road(g, -260, 15), { temper: 'rammer', delay: 35 }), member(g, 'Ivo Rusk', road(g, -300, -15), { temper: 'chaser', delay: 35 })];
  add({ id: 'g4-3', chapter: 'gang4', title: 'Swamp Siege', giver: 'Ezra Holloway', brief: 'Four heavy rigs come at you from both ends of the trail. Survive until they run out of nerve.',
    requires: ['g4-2'], start: road(g, 120), phases: [{ kind: 'survive', seconds: 90, text: 'Survive the siege' }], enemies: e, defeats: ids(e), reward: 18000, minTime: 85 });
  e = [member(g, 'Finch Harlow', road(g, 600), { route: { kind: 'road', site: SITE(g), from: 600, to: 2800 }, maxKmh: 90 })];
  add({ id: 'g4-4', chapter: 'gang4', title: 'The Runner', giver: 'Ezra Holloway', brief: 'Finch Harlow carries the Bog Kings\' ledger. Catch him before he reaches the logging road.',
    requires: ['g4-3'], start: road(g, 520), phases: [{ kind: 'catch', target: e[0].key, hold: 4, escape: 700, text: 'Catch Finch Harlow' }], enemies: e, defeats: ids(e), reward: 9000, minTime: 15 });
  e = [member(g, 'Gus Peat', road(g, -500), { temper: 'rammer', delay: 3 }), member(g, 'Moll Sedge', road(g, 500), { temper: 'rammer', delay: 12 }), member(g, 'Penny Clay', road(g, -600, 10), { temper: 'chaser', delay: 25 })];
  add({ id: 'g4-5', chapter: 'gang4', title: 'Logging Road Toll', giver: 'Ezra Holloway', brief: 'Take the Bog Kings\' toll gate on the trail and hold it while they try to push you off.',
    requires: ['g4-4'], start: road(g, 80), phases: [{ kind: 'hold', zone: road(g, 0), r: 22, seconds: 55, text: 'Hold the toll gate' }], enemies: e, defeats: ids(e), reward: 15000, minTime: 55 });
  e = [member(g, 'Lena Ferris', road(g, 420, 6), { boss: true }), member(g, 'Otto Graves', road(g, 440, -6), { boss: true }), member(g, 'Ada Thorne', road(g, 470, 0), { temper: 'chaser' }), member(g, 'Nico Brandt', road(g, 500, 0))];
  add({ id: 'g4-6', chapter: 'gang4', title: 'Kings\' Guard', giver: 'Ezra Holloway', brief: 'The Mire\'s lieutenants Lena Ferris and Otto "Sinkhole" Graves guard the last mile with their best. All four must fall.',
    requires: ['g4-5'], start: road(g, 280), phases: [{ kind: 'takedown', targets: ids(e), text: 'Take down the Kings\' Guard' }], enemies: e, defeats: ids(e), reward: 22000, minTime: 30 });
  const L = LEADERS[g];
  e = [{ key: L.id, who: L.id, vehicle: L.vehicle, at: { at: 'compound', site: SITE(g), lx: 0, lz: 10 }, face: 'road', temper: 'fleer', route: { kind: 'road', site: SITE(g), from: 0, to: -2200 }, skill: 0.9, armor: 4.5, boss: true, maxKmh: 75 }];
  add({ id: 'g4-boss', chapter: 'gang4', title: 'The Mire', giver: 'Ezra Holloway', brief: 'Marek "The Mire" Doyle runs for the swamp in your father\'s Bog Monarch. Run him down, then sink him.',
    requires: ['g4-6'], start: road(g, 120), phases: [{ kind: 'catch', target: L.id, hold: 3, escape: 900, text: 'Run down The Mire' }, { kind: 'takedown', targets: [L.id], text: 'Defeat The Mire' }],
    enemies: e, defeats: [L.id], reward: 0, key: g, legend: L.legend, intro: 'boss-4', outro: 'key-4', minTime: 30, journal: 'key-4' });
}

// ------------------------------------------------------------------ the underground
add({ id: 'ug-descent', chapter: 'underground', title: 'The Four Keys', giver: 'Ezra Holloway', brief: 'Granite, Sun, Frost and Root. With all four keys the old gate under the Snow Region opens. Your father\'s empire is down there, and so is Silas Crowe.',
  requires: ['g1-boss', 'g2-boss', 'g3-boss', 'g4-boss'], keys: 4, start: { at: 'compound', site: 'ug-entrance', lx: 0, lz: 30 },
  phases: [{ kind: 'reach', to: { at: 'compound', site: 'ug-entrance', lx: 0, lz: 2 }, r: 7, text: 'Drive into the underground gate' }, { kind: 'descend', text: 'Descend' }],
  enemies: [], defeats: [], reward: 10000, outro: 'underground', minTime: 3, journal: 'underground' });

type UgSpec = { title: string; brief: string; phases: Phase[]; enemies: EnemyDef[]; minTime: number };
const UG: UgSpec[] = [];
const C = (n: number, ang: number, rr: number) => ug(n, ang, rr);
// 1 Boulder Run: precision slalom
UG.push({ title: 'Boulder Run', brief: 'Crowe\'s first test: thread the boulder field through every gate. Three hits and the gate stays shut.', minTime: 25,
  phases: [{ kind: 'precision', route: { kind: 'slalom', ch: 1 }, laps: 1, maxHits: 3, time: 75, text: 'Clear the slalom' }], enemies: [] });
// 2 Sentry Vault: stealth
UG.push({ title: 'Sentry Vault', brief: 'Three searchlights sweep the old vault. Reach the far gate without being caught in a beam for long.', minTime: 12,
  phases: [{ kind: 'stealth', lights: [{ at: C(2, 0.9, 0.55), sweep: 1.2, range: 48 }, { at: C(2, -0.9, 0.55), sweep: 1.2, range: 48 }, { at: C(2, 0, 0.25), sweep: 1.6, range: 40 }], exit: C(2, 0, 0.92), text: 'Reach the exit unseen' }], enemies: [] });
// 3 Black River: ford in time
UG.push({ title: 'Black River', brief: 'The underground river splits the hall. Ford it at the shallows and reach the far bank before the sluice opens.', minTime: 10,
  phases: [{ kind: 'reach', to: C(3, 0, 0.85), r: 10, time: 45, text: 'Ford the river' }], enemies: [] });
// 4 Scout Den: takedown two scouts
UG.push({ title: 'Scout Den', brief: 'Two of Crowe\'s scouts run the den. Wreck them both before they raise the alarm.', minTime: 15,
  phases: [{ kind: 'takedown', targets: ['s1', 's2'], text: 'Take down the scouts' }],
  enemies: [guard('s1', 'strix-r2', C(4, 1.2, 0.6), 'fleer', { route: { kind: 'ring', ch: 4, rr: 0.6, n: 16 }, armor: 1 }), guard('s2', 'bramble-rc2', C(4, -1.2, 0.6), 'chaser', { armor: 1 })] });
// 5 Sand Hall: circuit race
UG.push({ title: 'Sand Hall', brief: 'Three laps of the sand hall against two of Crowe\'s drivers. Only a win opens the gate.', minTime: 40,
  phases: [{ kind: 'race', route: { kind: 'ring', ch: 5, rr: 0.66, n: 18 }, laps: 3, rivals: ['r1', 'r2'], text: 'Win the sand race' }],
  enemies: [guard('r1', 'strix-r2', C(5, -0.15, 0.66), 'racer', { route: { kind: 'ring', ch: 5, rr: 0.66, n: 18 }, skill: 0.8 }), guard('r2', 'bramble-rc2', C(5, -0.25, 0.7), 'racer', { route: { kind: 'ring', ch: 5, rr: 0.66, n: 18 }, skill: 0.8 })] });
// 6 Pump Station: hold zone
UG.push({ title: 'Pump Station', brief: 'Hold the pump platform in the middle of the mud while the station guards try to shove you off.', minTime: 45,
  phases: [{ kind: 'hold', zone: C(6, 0, 0), r: 14, seconds: 45, text: 'Hold the pump platform' }],
  enemies: [guard('h1', 'ranger-tx4', C(6, 1.6, 0.8), 'rammer'), guard('h2', 'ranger-tx4', C(6, -1.6, 0.8), 'rammer', { delay: 10 }), guard('h3', 'bramble-rc2', C(6, 3.1, 0.8), 'rammer', { delay: 22 })] });
// 7 Ice Gallery: precision time attack
UG.push({ title: 'Ice Gallery', brief: 'Two laps round the ice pillars against the clock. Touch the walls more than twice and you start again.', minTime: 30,
  phases: [{ kind: 'precision', route: { kind: 'ring', ch: 7, rr: 0.72, n: 16 }, laps: 2, maxHits: 2, time: 95, text: 'Lap the ice gallery' }], enemies: [] });
// 8 Ore Works: heavy hauler
UG.push({ title: 'Ore Works', brief: 'An armoured ore hauler guards the works. Its front is a wall of steel: hit it from the sides and rear.', minTime: 15,
  phases: [{ kind: 'takedown', targets: ['hv'], text: 'Take down the ore hauler' }], enemies: [guard('hv', 'ranger-tx4', C(8, 0.4, 0.4), 'rammer', { armor: 4, skill: 0.7, boss: true })] });
// 9 Wedge Hall: formation
UG.push({ title: 'Wedge Hall', brief: 'A three-car wedge circles the hall: two blockers shield their captain. Get through them and take the captain down.', minTime: 15,
  phases: [{ kind: 'takedown', targets: ['cap'], text: 'Take down the wedge captain' }],
  enemies: [guard('cap', 'strix-r2', C(9, 0, 0.55), 'fleer', { route: { kind: 'ring', ch: 9, rr: 0.55, n: 16 }, armor: 2, boss: true, maxKmh: 70 }), guard('w1', 'ranger-tx4', C(9, -0.3, 0.6), 'blocker'), guard('w2', 'ranger-tx4', C(9, 0.3, 0.5), 'blocker')] });
// 10 Crusher Pit: survive
UG.push({ title: 'Crusher Pit', brief: 'Sixty seconds in the pit with three rammers. Keep moving.', minTime: 60,
  phases: [{ kind: 'survive', seconds: 60, text: 'Survive the Crusher Pit' }],
  enemies: [guard('k1', 'ranger-tx4', C(10, 1, 0.7), 'rammer'), guard('k2', 'bramble-rc2', C(10, 3, 0.7), 'rammer'), guard('k3', 'ranger-tx4', C(10, 5, 0.7), 'rammer', { delay: 15 })] });
// 11 Vehicle Laboratory: collect while hunted
UG.push({ title: 'Vehicle Laboratory', brief: 'Crowe\'s engineers copied your father\'s designs. Grab the three data drives from the lab before the hunters get you.', minTime: 20,
  phases: [{ kind: 'collect', points: [C(11, 1.3, 0.7), C(11, 3.1, 0.6), C(11, -1.4, 0.7)], time: 80, text: 'Steal the data drives' }],
  enemies: [guard('lh1', 'strix-r2', C(11, 2.4, 0.5), 'chaser', { delay: 3 }), guard('lh2', 'bramble-rc2', C(11, -2.4, 0.5), 'chaser', { delay: 8 })] });
// 12 Freight Line: stop the carrier
UG.push({ title: 'Freight Line', brief: 'A carrier is hauling stolen parts round the freight line with an escort. Stop it: box it in or wreck it.', minTime: 12,
  phases: [{ kind: 'catch', target: 'car', hold: 4, escape: 260, text: 'Stop the carrier' }],
  enemies: [guard('car', 'corvan', C(12, 0.5, 0.65), 'fleer', { route: { kind: 'ring', ch: 12, rr: 0.65, n: 18 }, maxKmh: 65, armor: 2 }), guard('esc', 'ranger-tx4', C(12, 0.2, 0.6), 'blocker')] });
// 13 Secret Garage: destroy pylons
UG.push({ title: 'Secret Garage', brief: 'Your father\'s secret garage, wired with Crowe\'s tracking pylons. Ram all four down.', minTime: 15,
  phases: [{ kind: 'destroy', pylons: [C(13, 0.9, 0.6), C(13, 2.2, 0.55), C(13, -0.9, 0.6), C(13, -2.2, 0.55)], time: 90, text: 'Destroy the tracking pylons' }],
  enemies: [guard('gg', 'bramble-rc2', C(13, 3.1, 0.5), 'chaser', { delay: 10 })] });
// 14 Flooded Cistern: elite guards
UG.push({ title: 'Flooded Cistern', brief: 'Crowe\'s elite pursuit pair, Hex and Rook, wait in the flooded cistern.', minTime: 20,
  phases: [{ kind: 'takedown', targets: ['ug-elite-hex', 'ug-elite-rook'], text: 'Defeat Hex and Rook' }],
  enemies: [{ key: 'ug-elite-hex', who: 'ug-elite-hex', at: C(14, 1, 0.6), face: 'centre', temper: 'chaser', skill: 0.92, armor: 2.2, boss: true }, { key: 'ug-elite-rook', who: 'ug-elite-rook', at: C(14, -1, 0.6), face: 'centre', temper: 'rammer', skill: 0.88, armor: 2.6, boss: true }] });
// 15 Collapsing Shaft: outrun
UG.push({ title: 'Collapsing Shaft', brief: 'Crowe drops the shaft roof the moment you enter. Outrun the collapse to the next hall.', minTime: 12,
  phases: [{ kind: 'outrun', to: C(16, Math.PI, 0.5), speed: 9, head: 70, text: 'Outrun the collapse' }], enemies: [] });
// 16 Dust Gauntlet: race with blockers
UG.push({ title: 'Dust Gauntlet', brief: 'Beat Crowe\'s runner around the dust hall while two blockers try to stop you.', minTime: 30,
  phases: [{ kind: 'race', route: { kind: 'ring', ch: 16, rr: 0.66, n: 16, reverse: true }, laps: 2, rivals: ['dr'], text: 'Win the gauntlet' }],
  enemies: [guard('dr', 'strix-r2', C(16, 0.1, 0.66), 'racer', { route: { kind: 'ring', ch: 16, rr: 0.66, n: 16, reverse: true }, skill: 0.85 }), guard('b1', 'ranger-tx4', C(16, 1.6, 0.5), 'blocker'), guard('b2', 'ranger-tx4', C(16, -1.6, 0.5), 'blocker', { delay: 6 })] });
// 17 Sump Arena: three waves
UG.push({ title: 'Sump Arena', brief: 'Three waves of guards in the sump. Every wave must be wrecked before the next is let in.', minTime: 30,
  phases: [{ kind: 'takedown', targets: ['a1', 'a2'], text: 'Wave 1 of 3' }, { kind: 'takedown', targets: ['b1', 'b2'], text: 'Wave 2 of 3' }, { kind: 'takedown', targets: ['c1', 'c2', 'c3'], text: 'Wave 3 of 3' }],
  enemies: [guard('a1', 'ranger-tx4', C(17, 1.5, 0.75), 'rammer', { armor: 1 }), guard('a2', 'bramble-rc2', C(17, -1.5, 0.75), 'chaser', { armor: 1 }),
    guard('b1', 'ranger-tx4', C(17, 0.7, 0.8), 'rammer', { phase: 1, armor: 1.2 }), guard('b2', 'strix-r2', C(17, -0.7, 0.8), 'chaser', { phase: 1, armor: 1.2 }),
    guard('c1', 'ranger-tx4', C(17, 2.5, 0.8), 'rammer', { phase: 2 }), guard('c2', 'bramble-rc2', C(17, 0, 0.85), 'chaser', { phase: 2 }), guard('c3', 'ranger-tx4', C(17, -2.5, 0.8), 'rammer', { phase: 2 })] });
// 18 Frozen Keep: the Warden
UG.push({ title: 'Frozen Keep', brief: 'The Warden keeps the ice keep. His rig is armoured all round; make every hit count.', minTime: 20,
  phases: [{ kind: 'takedown', targets: ['ug-warden'], text: 'Defeat the Warden' }],
  enemies: [{ key: 'ug-warden', who: 'ug-warden', at: C(18, 0, 0.4), face: 'centre', temper: 'rammer', skill: 0.9, armor: 5, boss: true }] });
// 19 Twin Pillars: the Twins
UG.push({ title: 'Twin Pillars', brief: 'Nadia and Kira Voss fight as one: one hunts, one blocks. Take both.', minTime: 25,
  phases: [{ kind: 'takedown', targets: ['ug-twin-nadia', 'ug-twin-kira'], text: 'Defeat the Twins' }],
  enemies: [{ key: 'ug-twin-nadia', who: 'ug-twin-nadia', at: C(19, 0.8, 0.5), face: 'centre', temper: 'chaser', skill: 0.92, armor: 3.2, boss: true }, { key: 'ug-twin-kira', who: 'ug-twin-kira', at: C(19, -0.8, 0.5), face: 'centre', temper: 'blocker', skill: 0.9, armor: 3.2, boss: true }] });
// 20 Reactor Hall: lockdown escape
UG.push({ title: 'Reactor Hall', brief: 'Alarms. The blast door at the far end seals in 40 seconds and Crowe\'s hunters are already rolling.', minTime: 8,
  phases: [{ kind: 'reach', to: C(20, 0, 0.9), r: 9, time: 40, text: 'Reach the blast door' }],
  enemies: [guard('x1', 'strix-r2', C(20, 1.2, 0.6), 'chaser', { skill: 0.9 }), guard('x2', 'ranger-tx4', C(20, -1.2, 0.6), 'blocker'), guard('x3', 'bramble-rc2', C(20, 0.4, 0.5), 'rammer', { delay: 6 })] });
// 21 Throne Gate: king of the hill
UG.push({ title: 'Throne Gate', brief: 'The last gate before Crowe. Hold the gate dais for 45 seconds against everything he has left.', minTime: 45,
  phases: [{ kind: 'hold', zone: C(21, 0, 0), r: 15, seconds: 45, text: 'Hold the Throne Gate' }],
  enemies: [guard('t1', 'ranger-tx4', C(21, 0.8, 0.8), 'rammer'), guard('t2', 'bramble-rc2', C(21, -0.8, 0.8), 'rammer', { delay: 5 }), guard('t3', 'strix-r2', C(21, 2.4, 0.8), 'chaser', { delay: 14 }), guard('t4', 'ranger-tx4', C(21, -2.4, 0.8), 'rammer', { delay: 24, armor: 2 })] });

UG.forEach((u, i) => {
  const n = i + 1;
  add({ id: `ug-${String(n).padStart(2, '0')}`, chapter: 'underground', title: `${n}. ${u.title}`, giver: 'Silas Crowe', brief: u.brief,
    requires: [n === 1 ? 'ug-descent' : `ug-${String(n - 1).padStart(2, '0')}`], start: ug(n, Math.PI, 0.82), phases: u.phases, enemies: u.enemies, defeats: u.enemies.filter(e => e.who !== 'guard').map(e => e.who),
    reward: 18000 + n * 2500, minTime: u.minTime });
});

// ------------------------------------------------------------------ the master gangster
add({ id: 'finale', chapter: 'finale', title: 'The Sovereign', giver: 'Silas Crowe', brief: 'Silas Crowe waits in the Sovereign Arena in your father\'s core vehicle, the Sovereign X1. Run him down, then end it.',
  requires: ['ug-21'], start: ug(99, Math.PI, 0.85),
  phases: [{ kind: 'catch', target: MASTER.id, hold: 6, escape: 400, text: 'Run Crowe down' }, { kind: 'takedown', targets: [MASTER.id, 'fg1', 'fg2'], text: 'Defeat Silas Crowe' }],
  enemies: [{ key: MASTER.id, who: MASTER.id, vehicle: MASTER.vehicle, at: ug(99, 0, 0.5), face: 'centre', temper: 'fleer', route: { kind: 'ring', ch: 99, rr: 0.62, n: 20 }, skill: 0.95, armor: 6, boss: true, maxKmh: 95 },
    guard('fg1', 'ranger-tx4', ug(99, 2, 0.8), 'rammer', { phase: 1, delay: 8, armor: 2 }), guard('fg2', 'bramble-rc2', ug(99, -2, 0.8), 'chaser', { phase: 1, delay: 16, armor: 2 })],
  defeats: [MASTER.id], reward: 0, core: true, intro: 'boss-crowe', outro: 'ending', minTime: 40, journal: 'ending' });

export const MISSION_BY_ID: Record<string, MissionDef> = Object.fromEntries(MISSIONS.map(m => [m.id, m]));
export const UG_CHALLENGES = MISSIONS.filter(m => m.chapter === 'underground' && m.id !== 'ug-descent');

/** Cash paid for a mission: its base reward plus the bounty on everyone it defeats (catalogue values only). */
export function missionPayout(m: MissionDef): number {
  let cash = m.reward;
  for (const id of m.defeats) {
    const g = GANGSTERS.find(x => x.id === id) ?? Object.values(LEADERS).find(x => x.id === id) ?? UG_GUARDS.find(x => x.id === id) ?? (id === MASTER.id ? MASTER : undefined);
    if (g) cash += g.bounty;
  }
  return cash;
}

/** Story text for the journal, unlocked by missions. */
export const JOURNAL: Record<string, { title: string; text: string }> = {
  legacy: { title: 'The Last Legend', text: 'Ezra Holloway, my father\'s mechanic, says the Ranger I grew up sleeping in was the first of Elias Kade\'s legendary vehicles, and the only one Crowe\'s people did not take. He says my father ruled the roads above and the tunnels below. I thought he was a trucker who died broke.' },
  betrayal: { title: 'The Betrayal', text: 'From the journal pages: Silas Crowe was my father\'s partner. Four of the empire\'s captains — Dax Morrow in the mountains, Rhea Solis on the dust flats, Ivan Holt in the snow, Marek Doyle in the swamps — opened the gates to Crowe\'s crews in one night. Each took one of the legendary vehicles and one of the four keys to the underground. Crowe took the Sovereign X1, the core vehicle, and the throne.' },
  'key-1': { title: 'The Granite Key', text: 'Rockbreaker is finished. The Summit King is mine again, and so is the first key.' },
  'key-2': { title: 'The Sun Key', text: 'Sidewinder got passed. The Sand Viper and the Sun Key are back in the family.' },
  'key-3': { title: 'The Frost Key', text: 'Glacier opened the north to Crowe; now it is open to me. The Frost Titan comes home with the third key.' },
  'key-4': { title: 'The Root Key', text: 'The Mire sank. The Bog Monarch and the Root Key are mine. All four keys: the gate under the snow will open.' },
  underground: { title: 'Below', text: 'The underground is a chain of halls my father built and Crowe fortified: rock, river, sand, mud, ice, factories, laboratories and secret garages. Twenty-one of Crowe\'s challenges stand between me and his arena.' },
  ending: { title: 'The Empire Reclaimed', text: 'Silas Crowe is beaten. The Sovereign X1 is back where it belongs, and the roads above and below answer to the Kade name again.' },
};

void GANGS; void LEGENDS;
