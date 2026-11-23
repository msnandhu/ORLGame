import { Character } from '../characters/character';
import { Terrain } from '../terrain/terrain';
import { CharacterAppearance, sanitizeAppearance } from '../characters/appearance';

export interface DialogueOption {
  text: string;
  /** node to show next; omitted = end the conversation */
  next?: string;
  /** game action to run when chosen (the game may redirect to another node, e.g. when it can't be done) */
  action?: string;
}
export interface DialogueNode { id: string; text: string; options: DialogueOption[] }
export type Dialogue = Record<string, DialogueNode>;

export type NpcRole = 'mechanic' | 'trader' | 'villager' | 'explorer';
export interface NpcDef {
  id: string; name: string; role: NpcRole;
  appearance: CharacterAppearance;
  /** patrol/routine waypoints (x, z) and how long to linger at each, seconds */
  route: [number, number][]; linger: number;
  dialogue: Dialogue; start: string;
}
type Obstacles = Parameters<Character['update']>[2];

/** Every option must lead somewhere real; returns a list of problems (empty = valid). */
export function validateDialogue(d: Dialogue, start: string): string[] {
  const errs: string[] = [];
  if (!d[start]) errs.push(`missing start node "${start}"`);
  for (const [id, n] of Object.entries(d)) {
    if (n.id !== id) errs.push(`node key "${id}" has id "${n.id}"`);
    if (!n.options.length) errs.push(`node "${id}" has no options`);
    for (const o of n.options) if (o.next && !d[o.next]) errs.push(`node "${id}" option "${o.text}" -> missing "${o.next}"`);
  }
  return errs;
}

/** One conversation. The game supplies the action handler; it can return a node id to divert to. */
export class DialogueSession {
  node: DialogueNode | null;
  constructor(readonly npc: NpcDef, private onAction: (action: string) => string | void) { this.node = npc.dialogue[npc.start] ?? null; }
  get ended() { return this.node === null; }
  choose(i: number) {
    const o = this.node?.options[i];
    if (!o) return;
    const divert = o.action ? this.onAction(o.action) : undefined;
    const next = divert || o.next;
    this.node = next ? this.npc.dialogue[next] ?? null : null;
  }
}

export type NpcState = 'idle' | 'walk' | 'talk';

/** A non-player character: same body controller as the player, driven by a simple daily routine. */
export class Npc {
  readonly body: Character;
  state: NpcState = 'idle';
  private routeIdx = 0; private wait: number;
  /** time spent walking to the current waypoint; a blocked path skips to the next one */
  private legTime = 0;
  private talkTo: { x: number; z: number } | null = null;

  constructor(readonly def: NpcDef, terrain: Terrain) {
    this.body = new Character(terrain);
    const [x, z] = def.route[0];
    this.body.place(x, z);
    this.wait = def.linger * 0.5;
  }

  startTalk(x: number, z: number) { this.talkTo = { x, z }; this.state = 'talk'; }
  endTalk() { this.talkTo = null; this.state = 'idle'; this.wait = Math.max(this.wait, 3); }

  update(dt: number, obstacles: Obstacles) {
    const b = this.body;
    const still = { forward: 0, right: 0, sprint: false, jump: false, crouch: false, camYaw: 0 };
    if (this.talkTo) {
      // stand and turn to face whoever is talking
      b.update(dt, still, obstacles);
      const want = Math.atan2(this.talkTo.x - b.pos.x, this.talkTo.z - b.pos.z);
      let d = want - b.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      b.heading += d * Math.min(1, dt * 6);
      return;
    }
    if (this.wait > 0) { this.wait -= dt; this.state = 'idle'; b.update(dt, still, obstacles); return; }
    const [tx, tz] = this.def.route[this.routeIdx];
    const dx = tx - b.pos.x, dz = tz - b.pos.z, d = Math.hypot(dx, dz);
    this.legTime += dt;
    if (d < 0.5 || this.legTime > 6 + d) {
      this.routeIdx = (this.routeIdx + 1) % this.def.route.length; this.legTime = 0;
      this.wait = this.def.linger * (0.6 + 0.8 * ((this.routeIdx * 0.618) % 1));
      this.state = 'idle';
      b.update(dt, still, obstacles);
      return;
    }
    this.state = 'walk';
    b.update(dt, { forward: Math.min(1, d), right: 0, sprint: false, jump: false, crouch: false, walk: true, camYaw: Math.atan2(dx, dz) }, obstacles);
  }
}

/** Marta Kell runs the camp workshop. Her options call into the same repair/restock systems as the shed. */
export const CAMP_MECHANIC: NpcDef = {
  id: 'marta-kell', name: 'Marta Kell', role: 'mechanic',
  appearance: sanitizeAppearance({
    body: 'female', height: 0.35, build: 0.55, skin: 4, face: 'round', eyes: 0, hair: 'bun', hairColor: 0, beard: 'none',
    top: 'vest', topColor: 6, pantsColor: 7, boots: 'work', gloves: 'work', headwear: 'none', headwearColor: 0, accessories: ['watch'],
  }),
  route: [[-15.5, 7.5], [-20.5, 8.5], [-11, 4.5], [-18, 12]], linger: 6,
  start: 'greet',
  dialogue: {
    greet: { id: 'greet', text: "Marta Kell. I keep the camp's rigs running. What do you need?", options: [
      { text: 'Can you fix my vehicle?', action: 'repair', next: 'repaired' },
      { text: 'Restock my repair kits.', action: 'restock', next: 'restocked' },
      { text: 'What do the driving modes actually do?', next: 'modes' },
      { text: 'Where should I take a rig like this?', next: 'routes' },
      { text: 'Nothing for now.' },
    ] },
    repaired: { id: 'repaired', text: "Done. Panels pulled straight, new radiator core, tyres re-seated. Try not to bring it back in pieces.", options: [
      { text: 'Thanks, Marta.', next: 'greet' }, { text: 'Bye.' },
    ] },
    'no-vehicle': { id: 'no-vehicle', text: "Fix what? Bring the vehicle into the shed or park it right next to me first.", options: [
      { text: 'Right.', next: 'greet' }, { text: 'Bye.' },
    ] },
    'nothing-to-fix': { id: 'nothing-to-fix', text: "It's fine. Not a scratch on it. Go break something and come back.", options: [
      { text: 'Fair enough.', next: 'greet' },
    ] },
    restocked: { id: 'restocked', text: "Two field kits: tyre plugs, hose clamps, radiator patch. They'll get you home, not win you a race.", options: [
      { text: 'Got it.', next: 'greet' }, { text: 'Bye.' },
    ] },
    modes: { id: 'modes', text: "Press C to cycle. Sport for the road. Off-road softens the bars so the wheels stay down. Rock crawl drops to low range, locks the diffs and holds walking pace. Snow pulls away in second. Mud turns traction control off so the tyres can clear.", options: [
      { text: 'And the diff lock?', next: 'lockers' }, { text: 'Back.', next: 'greet' },
    ] },
    lockers: { id: 'lockers', text: "L locks the diffs: both wheels on an axle turn together. Great on rock and ruts, awful for turning on grip. Unlock it on the trail home.", options: [
      { text: 'Back.', next: 'greet' },
    ] },
    routes: { id: 'routes', text: "East of camp there's the rock ridge. Take the Bramble, rock crawl mode. The valley trail runs down to the river ford; mind the water, the Ranger's snorkel only goes so high.", options: [
      { text: 'Back.', next: 'greet' }, { text: 'Thanks.' },
    ] },
  },
};
