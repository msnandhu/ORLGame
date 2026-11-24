import { sanitizeAppearance } from '../characters/appearance';
import type { NpcDef } from '../npc/npc';

/**
 * Cutscenes and Ezra Holloway, the story's guide. A cutscene is a list of shots: a line of dialogue or narration
 * over a camera move around a story place. Flashbacks (the father's history) are graded sepia by the client.
 */
export type ShotFocus =
  | { at: 'player' }
  | { at: 'boss' }
  | { at: 'poi'; poi: string; height?: number }
  | { at: 'compound'; site: string }
  | { at: 'ug'; ch: number };
export interface Shot {
  speaker: string; line: string;
  /** seconds on screen (the line's reading time when omitted) */
  dur?: number;
  focus: ShotFocus;
  /** camera orbit: start and end bearing (radians), distance, height above the focus */
  yaw0?: number; yaw1?: number; dist?: number; height?: number;
}
export interface Cutscene { id: string; title: string; flashback?: boolean; shots: Shot[] }

const N = 'Narrator', EZ = 'Ezra Holloway', EK = 'Elias Kade', SC = 'Silas Crowe';
export const CUTSCENES: Record<string, Cutscene> = {
  'flashback-empire': { id: 'flashback-empire', title: 'The Empire', flashback: true, shots: [
    { speaker: EZ, line: 'Thirty years ago this island had one name on every road sign that mattered: Kade.', focus: { at: 'poi', poi: 'plain-city', height: 120 }, yaw0: 0.4, yaw1: 1.1, dist: 420 },
    { speaker: EZ, line: 'Your father built the roads, the depots, the camps. Then he went under the mountains and built a second world down there.', focus: { at: 'compound', site: 'ug-entrance' }, yaw0: -0.6, yaw1: 0.2, dist: 70, height: 26 },
    { speaker: EK, line: '"Four regions, four captains, four keys. No single hand holds the underground. Not even mine."', focus: { at: 'poi', poi: 'watch-tower', height: 80 }, yaw0: 2, yaw1: 2.8, dist: 300 },
    { speaker: EZ, line: 'He drove that Ranger of yours to every corner of it. The roads above, the halls below. They called him the Supreme Ruler. He called himself a mechanic.', focus: { at: 'player' }, yaw0: 0.5, yaw1: -0.4, dist: 9, height: 2.5 },
  ] },
  'flashback-betrayal': { id: 'flashback-betrayal', title: 'The Betrayal', flashback: true, shots: [
    { speaker: N, line: 'Silas Crowe was Elias Kade\'s partner from the first day: one tow truck, one borrowed shovel.', focus: { at: 'poi', poi: 'plain-city', height: 60 }, yaw0: 3, yaw1: 3.6, dist: 260 },
    { speaker: N, line: 'One night the four captains opened their gates to Crowe\'s crews. Dax Morrow in the mountains.', focus: { at: 'compound', site: 'gang1-hq' }, yaw0: 0.3, yaw1: 1, dist: 80, height: 30 },
    { speaker: N, line: 'Rhea Solis on the dust flats. Ivan Holt in the snow. Marek Doyle in the swamps.', focus: { at: 'compound', site: 'gang4-hq' }, yaw0: -1, yaw1: -0.3, dist: 80, height: 30 },
    { speaker: N, line: 'Each took a legendary vehicle and a key. Crowe took the Sovereign X1, the throne, and the underground.', focus: { at: 'compound', site: 'ug-entrance' }, yaw0: 1.2, yaw1: 2, dist: 60, height: 18 },
    { speaker: EZ, line: 'Your father never came back up. Four keys open that gate. Start with the captains.', focus: { at: 'player' }, yaw0: -0.5, yaw1: 0.3, dist: 9, height: 2.4 },
  ] },
  'boss-1': { id: 'boss-1', title: 'Rockbreaker', shots: [
    { speaker: 'Dax "Rockbreaker" Morrow', line: 'Kade\'s kid. In the old man\'s Ranger. The mountain\'s going to keep you, boy.', focus: { at: 'boss' }, yaw0: 0.4, yaw1: -0.2, dist: 11, height: 3 },
  ] },
  'boss-2': { id: 'boss-2', title: 'Sidewinder', shots: [
    { speaker: 'Rhea "Sidewinder" Solis', line: 'Nobody has ever passed me on this road. Your father tried, once.', focus: { at: 'boss' }, yaw0: 1, yaw1: 0.4, dist: 10, height: 2.5 },
  ] },
  'boss-3': { id: 'boss-3', title: 'Glacier', shots: [
    { speaker: 'Ivan "Glacier" Holt', line: 'I opened these passes to Crowe and I\'d do it again. Turn round while the road\'s still white.', focus: { at: 'boss' }, yaw0: -0.6, yaw1: 0.2, dist: 12, height: 3.5 },
  ] },
  'boss-4': { id: 'boss-4', title: 'The Mire', shots: [
    { speaker: 'Marek "The Mire" Doyle', line: 'Everything sinks eventually. Even Kades.', focus: { at: 'boss' }, yaw0: 0.8, yaw1: 1.5, dist: 11, height: 3 },
  ] },
  'key-1': { id: 'key-1', title: 'The Granite Key', shots: [
    { speaker: EZ, line: 'The Granite Key, and the Summit King back in the family. It\'s in your garage now. Three to go.', focus: { at: 'player' }, yaw0: 0.2, yaw1: 1, dist: 10, height: 3 },
  ] },
  'key-2': { id: 'key-2', title: 'The Sun Key', shots: [
    { speaker: EZ, line: 'Sidewinder got passed. The Sand Viper and the Sun Key are yours.', focus: { at: 'player' }, yaw0: -0.3, yaw1: 0.6, dist: 10, height: 3 },
  ] },
  'key-3': { id: 'key-3', title: 'The Frost Key', shots: [
    { speaker: EZ, line: 'The north is open again. The Frost Titan and the third key come home.', focus: { at: 'player' }, yaw0: 0.5, yaw1: 1.2, dist: 10, height: 3 },
  ] },
  'key-4': { id: 'key-4', title: 'The Root Key', shots: [
    { speaker: EZ, line: 'The Root Key. That\'s all four. The gate under the snow will open for you now.', focus: { at: 'player' }, yaw0: -0.8, yaw1: 0, dist: 10, height: 3 },
    { speaker: EZ, line: 'Crowe is down there with your father\'s Sovereign. Twenty-one of his tests stand in the way.', focus: { at: 'compound', site: 'ug-entrance' }, yaw0: 0.2, yaw1: 0.9, dist: 60, height: 20 },
  ] },
  underground: { id: 'underground', title: 'Below', shots: [
    { speaker: SC, line: 'Elias\'s boy, in my halls. Welcome. Every gate down here is a test. Pass them all and you can have the throne. Fail one and you stay.', focus: { at: 'ug', ch: 0 }, yaw0: 0, yaw1: 0.8, dist: 30, height: 8 },
  ] },
  'boss-crowe': { id: 'boss-crowe', title: 'Silas Crowe', shots: [
    { speaker: SC, line: 'Your father built this car for me. He just didn\'t know it yet.', focus: { at: 'boss' }, yaw0: 0.6, yaw1: -0.3, dist: 12, height: 3 },
    { speaker: SC, line: 'Catch me if you can, Kade.', focus: { at: 'boss' }, yaw0: -0.3, yaw1: -0.9, dist: 9, height: 2 },
  ] },
  ending: { id: 'ending', title: 'The Empire Reclaimed', shots: [
    { speaker: N, line: 'Silas Crowe is finished. The Sovereign X1 is back in Kade hands.', focus: { at: 'player' }, yaw0: 0, yaw1: 1.4, dist: 12, height: 3 },
    { speaker: EZ, line: 'Your father would have liked to see this. The roads above and the halls below. They answer to you now.', focus: { at: 'ug', ch: 99 }, yaw0: 0.3, yaw1: 1.2, dist: 70, height: 20 },
    { speaker: N, line: 'The Sovereign X1 waits at base camp. The island is yours to drive.', focus: { at: 'poi', poi: 'base-camp', height: 40 }, yaw0: 2, yaw1: 2.6, dist: 160 },
  ] },
};

/** Ezra Holloway: the father's old mechanic, at base camp; he starts the story and hands out the gang jobs. */
export const EZRA: NpcDef = {
  id: 'ezra-holloway', name: 'Ezra Holloway', role: 'explorer',
  appearance: sanitizeAppearance({ body: 'male', height: 0.4, build: 0.62, skin: 3, face: 'long', eyes: 3, hair: 'short', hairColor: 6, beard: 'full', top: 'flannel', topColor: 3, variant: 0, pantsColor: 10, boots: 'work', gloves: 'work', headwear: 'cap', headwearColor: 1, accessories: ['watch'] }),
  route: [[7, -10], [9, -7], [6, -12]], linger: 9,
  start: 'greet',
  dialogue: {
    greet: { id: 'greet', text: 'Ezra Holloway. I kept your father\'s trucks running for twenty years. You have his jaw, and his Ranger.', options: [
      { text: 'You knew my father?', action: 'story-talk', next: 'father' },
      { text: 'What should I do next?', next: 'next' },
      { text: 'Who are the gangs?', next: 'gangs' },
      { text: 'Later.' },
    ] },
    father: { id: 'father', text: 'Knew him? Elias Kade ran this island, above and below. Sit down, kid. There\'s a lot you were never told.', options: [{ text: 'Go on.' }] },
    next: { id: 'next', text: 'Open your journal with J: the jobs I\'ve lined up are on the Missions page, and a marker shows where each one starts. Drive into a yellow beam and press Y.', options: [{ text: 'Got it.' }] },
    gangs: { id: 'gangs', text: 'Four gangs hold your father\'s regions. The Cragjaws in the mountains, the Dune Vipers on the dust flats, Frostline in the snow and the Bog Kings in the swamps. Every one of them has a price on their head.', options: [{ text: 'And the leaders?', next: 'leaders' }, { text: 'Enough for now.' }] },
    leaders: { id: 'leaders', text: 'Rockbreaker, Sidewinder, Glacier and The Mire. A quarter of a million each, and each one drives a car your father built. Beat them and the keys are yours.', options: [{ text: 'Then I\'ll start.' }] },
  },
};
