import { mulberry32 } from '../math/noise';
import { randomAppearance, sanitizeAppearance, CLOTH_COLORS, type CharacterAppearance } from '../characters/appearance';
import type { VehicleBuild } from '../garage/build';

/**
 * The cast of "The Lost Empire": the protagonist's family and allies, the four gangs (every member has a name, role,
 * vehicle, look, difficulty, bounty, behaviour and territory), the underground's guards and the master gangster.
 * Everything is data; looks are generated deterministically from each person's id so every client and the server
 * agree on who is who.
 */

export type GangId = 1 | 2 | 3 | 4;
export type GangRole = 'scout' | 'driver' | 'enforcer' | 'lookout' | 'mechanic' | 'tracker' | 'bruiser' | 'runner' | 'smuggler' | 'lieutenant' | 'leader';
/** How the person drives in a fight (maps onto AI behaviours in the mission runtime). */
export type Temper = 'rammer' | 'chaser' | 'racer' | 'fleer' | 'blocker' | 'holder' | 'patrol';

export interface Gang {
  id: GangId; name: string; motto: string;
  /** territory: the map place of the compound, the island region, the terrain they specialise in */
  compound: string; region: 'hill' | 'plain' | 'snow' | 'forest'; terrain: string; specialty: string;
  /** member count from the design document */
  size: number;
  key: { id: string; name: string };
  /** gang colours: body paint and accent (sRGB hex), and the cloth colour index their people wear */
  paint: string; accent: string; cloth: number;
}

export const GANGS: Record<GangId, Gang> = {
  1: { id: 1, name: 'The Cragjaws', motto: 'The mountain decides who comes down.', compound: 'gang-1', region: 'hill', terrain: 'Rocky mountains', specialty: 'Extreme off-road and rock crawling', size: 13, key: { id: 'granite', name: 'Granite Key' }, paint: '#596068', accent: '#e0782a', cloth: 4 },
  2: { id: 2, name: 'The Dune Vipers', motto: 'Fast, dry and gone.', compound: 'gang-camp', region: 'plain', terrain: 'Dry plains and dust flats (the island\'s desert country)', specialty: 'High-speed modified vehicles', size: 9, key: { id: 'sun', name: 'Sun Key' }, paint: '#d9b679', accent: '#1d1d1f', cloth: 8 },
  3: { id: 3, name: 'Frostline', motto: 'Nothing moves up here without us.', compound: 'gang-3', region: 'snow', terrain: 'Snow, ice roads and mountain passes', specialty: 'Heavy-duty vehicles', size: 6, key: { id: 'frost', name: 'Frost Key' }, paint: '#e6edf2', accent: '#2c5f8f', cloth: 9 },
  4: { id: 4, name: 'The Bog Kings', motto: 'Everything sinks eventually.', compound: 'gang-4', region: 'forest', terrain: 'Mudlands and deep forest', specialty: 'Heavy modified off-road vehicles', size: 17, key: { id: 'root', name: 'Root Key' }, paint: '#4b4a2c', accent: '#7fa83a', cloth: 7 },
};

export interface Gangster {
  id: string; name: string; nick?: string;
  gang: GangId | 0;
  role: GangRole;
  /** 1 (green) .. 5 (elite); leaders are 6, the master 7 */
  difficulty: number;
  /** USD, paid when they are defeated */
  bounty: number;
  vehicle: string;
  temper: Temper;
  /** one line of who they are */
  bio: string;
  /** the mission that defeats them (filled from the mission list) */
  mission?: string;
}

/** Bounty by difficulty (a member) — leaders are worth $250,000 each, the master $1,000,000. */
export const memberBounty = (difficulty: number, role: GangRole) => (4000 + difficulty * 4000) * (role === 'lieutenant' ? 2 : 1);
export const LEADER_BOUNTY = 250000;
export const MASTER_BOUNTY = 1000000;

const ROLE_TEMPER: Record<GangRole, Temper> = { scout: 'fleer', driver: 'racer', enforcer: 'rammer', lookout: 'patrol', mechanic: 'blocker', tracker: 'chaser', bruiser: 'rammer', runner: 'racer', smuggler: 'fleer', lieutenant: 'rammer', leader: 'rammer' };
const ROLE_BIO: Record<GangRole, string> = {
  scout: 'Rides ahead and radios in anything that moves.', driver: 'Wheelman on the gang\'s runs.', enforcer: 'Settles arguments with a bull bar.',
  lookout: 'Watches the roads from the high ground.', mechanic: 'Keeps the gang\'s rigs alive and blocks the road when told.', tracker: 'Follows tyre marks like a hound.',
  bruiser: 'Heavy rig, heavy foot.', runner: 'Moves cargo fast and doesn\'t stop for anyone.', smuggler: 'Knows every back trail on the island.',
  lieutenant: 'Second only to the boss.', leader: 'Runs the gang.',
};

type M = [name: string, nick: string | '', role: GangRole, difficulty: number, vehicle: string];
const MEMBERS: Record<GangId, M[]> = {
  1: [
    ['Brick Tolliver', '', 'scout', 1, 'bramble-rc2'], ['Jessa Flint', '', 'driver', 2, 'bramble-rc2'], ['Hob Granger', '', 'enforcer', 2, 'ranger-tx4'],
    ['Kel Ashdown', '', 'lookout', 1, 'ranger-tx4'], ['Rusty Vane', '', 'mechanic', 2, 'ranger-tx4'], ['Noor Talbot', '', 'tracker', 3, 'bramble-rc2'],
    ['Gage Mercer', 'Anvil', 'bruiser', 3, 'ranger-tx4'], ['Petra Lusk', '', 'driver', 3, 'bramble-rc2'], ['Odell Crane', '', 'enforcer', 3, 'ranger-tx4'],
    ['Wren Stavros', '', 'runner', 2, 'bramble-rc2'], ['Tobin Hale', '', 'enforcer', 4, 'ranger-tx4'], ['Sable Drummond', '', 'scout', 2, 'bramble-rc2'],
    ['Garrick Boone', 'Slate', 'lieutenant', 5, 'bramble-rc2'],
  ],
  2: [
    ['Cass Varga', '', 'runner', 2, 'strix-r2'], ['Marco Ilyin', 'Dust', 'driver', 3, 'vanta-gt'], ['Zara Quint', '', 'scout', 1, 'strix-r2'],
    ['Teo Navarro', '', 'smuggler', 2, 'corvan'], ['Lux Bramwell', '', 'driver', 3, 'strix-r2'], ['Ike Sorensen', '', 'enforcer', 3, 'corvan'],
    ['Dina Okafor', '', 'tracker', 3, 'strix-r2'], ['Remy Castell', '', 'driver', 4, 'vanta-gt'], ['Vic Salazar', 'Mirage', 'lieutenant', 5, 'vanta-gt'],
  ],
  3: [
    ['Bjorn Ekdahl', '', 'enforcer', 3, 'ranger-tx4'], ['Sasha Krell', '', 'driver', 3, 'ranger-tx4'], ['Olin Frost', '', 'lookout', 2, 'ranger-tx4'],
    ['Hedda Lund', '', 'mechanic', 3, 'ranger-tx4'], ['Pavel Strand', '', 'bruiser', 4, 'ranger-tx4'], ['Yuri Volkov', 'Tundra', 'lieutenant', 5, 'ranger-tx4'],
  ],
  4: [
    ['Mags Fenwick', '', 'enforcer', 2, 'ranger-tx4'], ['Cole Rooker', '', 'bruiser', 3, 'ranger-tx4'], ['Tansy Moss', '', 'scout', 1, 'bramble-rc2'],
    ['Bram Ketter', '', 'driver', 2, 'bramble-rc2'], ['Lyle Barrow', '', 'driver', 3, 'bramble-rc2'], ['Ruth Kegan', '', 'enforcer', 3, 'ranger-tx4'],
    ['Dez Malloy', '', 'bruiser', 3, 'ranger-tx4'], ['Finch Harlow', '', 'runner', 2, 'corvan'], ['Gus Peat', '', 'mechanic', 2, 'ranger-tx4'],
    ['Ada Thorne', '', 'tracker', 3, 'bramble-rc2'], ['Nico Brandt', '', 'enforcer', 4, 'ranger-tx4'], ['Moll Sedge', '', 'lookout', 2, 'ranger-tx4'],
    ['Ivo Rusk', '', 'bruiser', 4, 'ranger-tx4'], ['Penny Clay', '', 'smuggler', 2, 'corvan'], ['Hector Bayou', '', 'driver', 4, 'bramble-rc2'],
    ['Lena Ferris', '', 'lieutenant', 5, 'bramble-rc2'], ['Otto Graves', 'Sinkhole', 'lieutenant', 5, 'ranger-tx4'],
  ],
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
export const GANGSTERS: Gangster[] = [];
for (const g of [1, 2, 3, 4] as GangId[]) for (const [name, nick, role, difficulty, vehicle] of MEMBERS[g]) {
  GANGSTERS.push({ id: `g${g}-${slug(name)}`, name, nick: nick || undefined, gang: g, role, difficulty, bounty: memberBounty(difficulty, role), vehicle, temper: ROLE_TEMPER[role], bio: ROLE_BIO[role] });
}

export interface Leader extends Gangster { gang: GangId; legend: string; title: string; intro: string }
export const LEADERS: Record<GangId, Leader> = {
  1: { id: 'boss-rockbreaker', name: 'Dax Morrow', nick: 'Rockbreaker', title: 'Gang Leader 1 · The Cragjaws', gang: 1, role: 'leader', difficulty: 6, bounty: LEADER_BOUNTY, vehicle: 'bramble-rc2', temper: 'rammer', legend: 'summit-king',
    bio: 'Climbed out of the quarries on Elias Kade\'s money, then sold him out for the mountain.', intro: 'You drove up my mountain in your daddy\'s old wagon? Then you can roll back down it.' },
  2: { id: 'boss-sidewinder', name: 'Rhea Solis', nick: 'Sidewinder', title: 'Gang Leader 2 · The Dune Vipers', gang: 2, role: 'leader', difficulty: 6, bounty: LEADER_BOUNTY, vehicle: 'vanta-gt', temper: 'racer', legend: 'sand-viper',
    bio: 'Ran the Kade empire\'s fastest convoys until Crowe offered her the whole dust country.', intro: 'Nobody has ever passed me. You won\'t be the first.' },
  3: { id: 'boss-glacier', name: 'Ivan Holt', nick: 'Glacier', title: 'Gang Leader 3 · Frostline', gang: 3, role: 'leader', difficulty: 6, bounty: LEADER_BOUNTY, vehicle: 'ranger-tx4', temper: 'holder', legend: 'frost-titan',
    bio: 'Elias Kade\'s quartermaster in the north. He opened the passes to Crowe\'s trucks the night of the betrayal.', intro: 'Your father trusted me with the north. Cold place to put your trust.' },
  4: { id: 'boss-mire', name: 'Marek Doyle', nick: 'The Mire', title: 'Gang Leader 4 · The Bog Kings', gang: 4, role: 'leader', difficulty: 6, bounty: LEADER_BOUNTY, vehicle: 'ranger-tx4', temper: 'rammer', legend: 'bog-monarch',
    bio: 'Biggest crew on the island. Swallowed the forest trade and anyone who argued.', intro: 'Seventeen of mine are in the mud because of you. Your turn to sink.' },
};
export const MASTER: Gangster & { title: string; intro: string } = {
  id: 'master-crowe', name: 'Silas Crowe', nick: 'The Usurper', title: 'Master of the Underground', gang: 0, role: 'leader', difficulty: 7, bounty: MASTER_BOUNTY, vehicle: 'sovereign-x1', temper: 'rammer',
  bio: 'Elias Kade\'s partner and closest friend, until the night he took everything.',
  intro: 'I watched you grow up poor, boy. I made sure of it. Now you come down here with four keys and your father\'s face. Let\'s finish what I started.',
};
/** The underground's named guards (the boss guards and elites of the 21 challenges). */
export const UG_GUARDS: Gangster[] = [
  { id: 'ug-warden', name: 'Bruno Kask', nick: 'The Warden', gang: 0, role: 'lieutenant', difficulty: 6, bounty: 60000, vehicle: 'ranger-tx4', temper: 'rammer', bio: 'Keeps the Frozen Keep and everyone in it.' },
  { id: 'ug-twin-nadia', name: 'Nadia Voss', nick: 'Twin', gang: 0, role: 'lieutenant', difficulty: 6, bounty: 45000, vehicle: 'bramble-rc2', temper: 'chaser', bio: 'One half of Crowe\'s personal guard.' },
  { id: 'ug-twin-kira', name: 'Kira Voss', nick: 'Twin', gang: 0, role: 'lieutenant', difficulty: 6, bounty: 45000, vehicle: 'bramble-rc2', temper: 'blocker', bio: 'The other half. Never far from her sister.' },
  { id: 'ug-elite-hex', name: 'Hex', nick: 'Elite', gang: 0, role: 'enforcer', difficulty: 5, bounty: 30000, vehicle: 'strix-r2', temper: 'chaser', bio: 'Crowe\'s elite pursuit driver.' },
  { id: 'ug-elite-rook', name: 'Rook', nick: 'Elite', gang: 0, role: 'enforcer', difficulty: 5, bounty: 30000, vehicle: 'ranger-tx4', temper: 'rammer', bio: 'Crowe\'s elite heavy driver.' },
];

/** Allies and family. */
export const FAMILY = {
  father: { name: 'Elias Kade', title: 'The Supreme Ruler of the surface and underground worlds' },
  ally: { id: 'ezra-holloway', name: 'Ezra Holloway', title: 'Your father\'s mechanic, and the only one who stayed' },
};

/** The father's legendary vehicles, taken by the leaders: recovering one hands its legendary build to the player. */
export interface Legend { id: string; name: string; vehicle: string; holder: string; build: VehicleBuild; story: string }
export const LEGENDS: Legend[] = [
  { id: 'summit-king', name: 'Summit King', vehicle: 'bramble-rc2', holder: 'boss-rockbreaker', story: 'Elias Kade\'s rock crawler, built to climb the Cragjaw cliffs nobody else could.',
    build: { paint: '#1c1c1e', accent: '#c9a24a', finish: 'metallic', livery: 'stripes', parts: { bullbar: 'full', lights: 'pods', steps: 'sliders', tyres: 'rock', tyreSize: 'plus2', height: 'lift50', shocks: 'long', rims: 'beadlock', ecu: 'stage1' } } },
  { id: 'sand-viper', name: 'Sand Viper', vehicle: 'vanta-gt', holder: 'boss-sidewinder', story: 'The coupe Elias drove across the dust flats in record time; Rhea Solis never gave it back.',
    build: { paint: '#c9a24a', accent: '#1c1c1e', finish: 'pearl', livery: 'stripes', parts: { ecu: 'stage2', turbo: 'hybrid', spoiler: 'wing', splitter: 'carbon', rims: 'mesh', tyres: 'performance' } } },
  { id: 'frost-titan', name: 'Frost Titan', vehicle: 'ranger-tx4', holder: 'boss-glacier', story: 'The expedition wagon that opened the northern passes for the Kade convoys.',
    build: { paint: '#e9eef2', accent: '#c9a24a', finish: 'pearl', livery: 'stripes', parts: { bullbar: 'full', rack: 'expedition', lights: 'pods', tyres: 'snow', height: 'lift50', ecu: 'stage1', turbo: 'hybrid' } } },
  { id: 'bog-monarch', name: 'Bog Monarch', vehicle: 'ranger-tx4', holder: 'boss-mire', story: 'A swamp-proof Ranger on mud tyres with a snorkel to the roof: Elias\'s answer to the forest.',
    build: { paint: '#2e3a1f', accent: '#c9a24a', finish: 'metallic', livery: 'stripes', parts: { bullbar: 'full', snorkel: 'snorkel', tyres: 'mud', tyreSize: 'plus1', height: 'lift100', shocks: 'long', ecu: 'stage1' } } },
];

const looks = new Map<string, CharacterAppearance>();
/** A gangster's look: generated from their id, dressed in their gang's colour. */
export function gangsterLook(g: Gangster): CharacterAppearance {
  let a = looks.get(g.id);
  if (a) return a;
  let h = 2166136261; for (const ch of g.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = mulberry32(h >>> 0);
  const female = /^(Jessa|Kel|Noor|Petra|Wren|Sable|Cass|Zara|Lux|Dina|Sasha|Hedda|Mags|Tansy|Ruth|Ada|Moll|Penny|Lena|Rhea|Nadia|Kira)\b/.test(g.name);
  a = randomAppearance(rnd, female ? 'female' : 'male');
  const cloth = g.gang ? GANGS[g.gang].cloth : 6;
  a = sanitizeAppearance({ ...a, topColor: cloth, headwearColor: cloth, pantsColor: 6, top: a.top === 'crop-jacket' || a.top === 'trail-jacket' ? 'field-jacket' : a.top, gloves: 'work', headwear: g.role === 'leader' ? 'none' : a.headwear });
  looks.set(g.id, a);
  return a;
}
void CLOTH_COLORS;

/** A gangster's vehicle build: gang colours, and parts that fit their gang's terrain and their role. */
export function gangBuild(g: Gangster): VehicleBuild {
  if (g.gang === 0) {
    if (g.id === 'master-crowe') return { paint: null, accent: null, finish: 'stock', livery: 'stock', parts: {} };
    return { paint: '#2a2a2e', accent: '#b0182a', finish: 'metallic', livery: 'stripes', parts: g.vehicle === 'strix-r2' ? { ecu: 'stage2' } : { bullbar: 'full', ecu: 'stage1' } };
  }
  const leader = Object.values(LEADERS).find(l => l.id === g.id);
  if (leader) return LEGENDS.find(l => l.id === leader.legend)!.build;
  const G = GANGS[g.gang], off = g.vehicle === 'ranger-tx4' || g.vehicle === 'bramble-rc2';
  const parts: VehicleBuild['parts'] = {};
  if (off) {
    if (g.temper === 'rammer' || g.temper === 'holder') parts.bullbar = 'full';
    parts.tyres = g.gang === 3 ? 'snow' : g.gang === 4 ? 'mud' : g.gang === 1 ? 'rock' : 'all-terrain';
    if (g.gang === 4) parts.height = 'lift50';
  } else if (g.difficulty >= 3) parts.ecu = 'stage1';
  return { paint: G.paint, accent: G.accent, finish: 'gloss', livery: g.role === 'lieutenant' ? 'stripes' : 'stock', parts };
}

export const gangsterById = (id: string): Gangster | undefined =>
  GANGSTERS.find(g => g.id === id) ?? Object.values(LEADERS).find(l => l.id === id) ?? UG_GUARDS.find(g => g.id === id) ?? (MASTER.id === id ? MASTER : undefined);
export const displayName = (g: Gangster) => g.nick && g.nick !== 'Twin' && g.nick !== 'Elite' ? `${g.name.split(' ')[0]} "${g.nick}" ${g.name.split(' ').slice(1).join(' ')}` : g.name;
