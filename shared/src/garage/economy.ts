import { VEHICLES, vehicleById, STORY_VEHICLES } from '../vehicles/catalog';
import type { VehicleSpec } from '../vehicles/spec';
import type { PoiKind } from '../world/island';
import { optionsFor, stockOption, findOption, SLOT_BY_ID, slotsFor, type SlotId } from './parts';
import { defaultBuild, sanitizeBuild, fitted, FINISHES, LIVERIES, PAINT_PRICE, ACCENT_PRICE, type VehicleBuild } from './build';
import { newStory, sanitizeStory, cloneStory, storyTransact, isStoryRequest, STORY_OPS, type StoryProgress, type StoryRequest } from '../story/progress';

/**
 * The upgrade economy: what vehicles and parts cost, and the only functions allowed to change a player's money.
 * Every transaction is a pure function of (career, request): prices always come from the catalogue here, never from
 * the request, so a client can't name its own price. The server runs the same functions for online players.
 */

/** List prices in USD. */
export const VEHICLE_PRICES: Record<string, number> = {
  'ranger-tx4': 42000, 'bramble-rc2': 58000, pella: 14500, corvan: 23000, 'strix-r2': 49000, halcyon: 135000, 'vanta-gt': 210000, 'solenne-gt': 240000, 'sovereign-x1': 450000,
};
export const vehiclePrice = (id: string) => VEHICLE_PRICES[id] ?? 50000;
/** Parts for dearer vehicles cost more (a GT's wheels cost more than a hatchback's). */
export const priceScale = (id: string) => Math.max(0.6, Math.min(2.4, Math.sqrt(vehiclePrice(id) / 40000)));
const round50 = (v: number) => Math.round(v / 50) * 50;

export const STARTING_CASH = 25000;
export const STARTER_VEHICLE = 'ranger-tx4';
/** Selling back returns this share of the list price, and of what was spent on parts. */
export const RESALE = { vehicle: 0.6, parts: 0.4 };
export const FUEL_PRICE = 1.65;      // USD per litre
export const KIT_PRICE = 180;        // field repair kit
/** First visit to a place on the island pays a finder's fee (exploration reward). */
export const DISCOVERY_RADIUS = 150;
const DISCOVERY_REWARD: Partial<Record<PoiKind, number>> = {
  city: 5000, village: 2500, gang: 4000, garage: 2000, fuel: 1000, race: 3000, explorer: 3000, lookout: 3500, lab: 5000, cave: 4000, gate: 5000,
  peak: 4500, cablecar: 3000, rescue: 2500, hazard: 3000, lake: 2000, waterfall: 3000, ruins: 3500, wildlife: 2000, resource: 2500,
  collectible: 4000, mission: 2000, depot: 2000, farm: 1500,
};
export const discoveryReward = (kind: PoiKind) => DISCOVERY_REWARD[kind] ?? 0;

export interface OwnedVehicle {
  build: VehicleBuild;
  /** options bought for this vehicle ('slot:option'); factory parts are always owned */
  unlocked: string[];
  /** money spent on parts and paint, for resale */
  spent: number;
}
export interface Career {
  version: 1;
  cash: number;
  owned: Record<string, OwnedVehicle>;
  /** places already rewarded */
  discovered: string[];
  /** lifetime totals */
  earned: number; spentTotal: number;
  /** the campaign: missions, keys, legends, pages */
  story: StoryProgress;
}

export function newCareer(): Career {
  return { version: 1, cash: STARTING_CASH, owned: { [STARTER_VEHICLE]: { build: defaultBuild(), unlocked: [], spent: 0 } }, discovered: [], earned: 0, spentTotal: 0, story: newStory() };
}

/** Repair a stored career (old, hand-edited or corrupt saves): unknown vehicles and parts are dropped, money is a finite integer ≥ 0. */
export function sanitizeCareer(raw: unknown): Career {
  const c = newCareer();
  if (!raw || typeof raw !== 'object') return c;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d);
  c.cash = num(o.cash, STARTING_CASH); c.earned = num(o.earned, 0); c.spentTotal = num(o.spentTotal, 0);
  if (Array.isArray(o.discovered)) c.discovered = [...new Set(o.discovered.filter((x): x is string => typeof x === 'string' && x.length < 64))];
  c.story = sanitizeStory(o.story);
  if (o.owned && typeof o.owned === 'object') {
    const owned: Record<string, OwnedVehicle> = {};
    for (const [id, v] of Object.entries(o.owned as Record<string, unknown>)) {
      const spec = VEHICLES.find(s => s.id === id); if (!spec || !v || typeof v !== 'object') continue;
      const ov = v as Record<string, unknown>;
      const unlocked = Array.isArray(ov.unlocked) ? ov.unlocked.filter((k): k is string => typeof k === 'string' && validKey(spec, k)) : [];
      const build = sanitizeBuild(spec, ov.build);
      // a fitted part must have been paid for
      for (const [slot, opt] of Object.entries(build.parts)) if (!unlocked.includes(`${slot}:${opt}`)) delete build.parts[slot as SlotId];
      owned[id] = { build, unlocked: [...new Set(unlocked)], spent: num(ov.spent, 0) };
    }
    // the Sovereign is only ever a story reward
    if (owned['sovereign-x1'] && !c.story.core) delete owned['sovereign-x1'];
    if (Object.keys(owned).length) c.owned = owned;
  }
  return c;
}
function validKey(spec: VehicleSpec, key: string) {
  const [slot, opt] = key.split(':') as [SlotId, string];
  return !!SLOT_BY_ID[slot] && optionsFor(spec, slot).some(o => o.id === opt);
}

/** Price of fitting an option (0 for factory parts and parts already bought for this vehicle). */
export function partPrice(spec: VehicleSpec, slot: SlotId, option: string, ov?: OwnedVehicle): number {
  if (option === stockOption(spec, slot) || ov?.unlocked.includes(`${slot}:${option}`)) return 0;
  const o = findOption(slot, option);
  return o ? round50(o.price * priceScale(spec.id)) : Infinity;
}
/** Price of a paint-shop job going from `from` to `to`. */
export function paintPrice(spec: VehicleSpec, from: VehicleBuild, to: Pick<VehicleBuild, 'paint' | 'accent' | 'finish' | 'livery'>): number {
  const k = priceScale(spec.id);
  let p = 0;
  if (to.paint !== from.paint && to.paint !== null) p += PAINT_PRICE;
  if (to.finish !== from.finish) p += FINISHES.find(f => f.id === to.finish)?.price ?? 0;
  if (to.accent !== from.accent && to.accent !== null) p += ACCENT_PRICE;
  if (to.livery !== from.livery) p += LIVERIES.find(l => l.id === to.livery)?.price ?? 0;
  // going back to factory paint is a respray too
  if (to.paint === null && from.paint !== null) p += PAINT_PRICE;
  return round50(p * k);
}
export function repairPrice(vid: string, damage: number): number {
  const d = Math.max(0, Math.min(1, damage));
  return d <= 0.001 ? 0 : Math.max(150, round50(vehiclePrice(vid) * 0.03 * d));
}
export function resaleValue(vid: string, ov: OwnedVehicle): number {
  return round50(vehiclePrice(vid) * RESALE.vehicle + ov.spent * RESALE.parts);
}

export type GarageRequest =
  | { op: 'buy-vehicle'; vid: string }
  | { op: 'sell-vehicle'; vid: string }
  | { op: 'fit'; vid: string; slot: SlotId; option: string }
  | { op: 'paint'; vid: string; paint: string | null; accent: string | null; finish: VehicleBuild['finish']; livery: VehicleBuild['livery'] }
  | { op: 'repair'; vid: string; damage: number }
  | { op: 'refuel'; litres: number }
  | { op: 'kits'; count: number }
  | { op: 'discover'; poi: string }
  | StoryRequest;
export type GarageResult = { ok: true; career: Career; delta: number; msg: string } | { ok: false; error: string };

/** Context the caller vouches for: where the player is (for discoveries) and which places exist. */
export interface GarageContext {
  pois?: readonly { id: string; name: string; kind: PoiKind; x: number; z: number }[];
  /** the player's position as the authority knows it */
  at?: { x: number; z: number };
  /** the authority's clock (ms), for mission timing */
  now?: number;
}

const clone = (c: Career): Career => ({ ...c, owned: Object.fromEntries(Object.entries(c.owned).map(([k, v]) => [k, { build: { ...v.build, parts: { ...v.build.parts } }, unlocked: [...v.unlocked], spent: v.spent }])), discovered: [...c.discovered], story: cloneStory(c.story ?? newStory()) });
const fail = (error: string): GarageResult => ({ ok: false, error });
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Check that a request is structurally valid (for anything that arrives over the network). */
export function isGarageRequest(v: unknown): v is GarageRequest {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>, str = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length < 64;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  switch (o.op) {
    case 'buy-vehicle': case 'sell-vehicle': return str(o.vid);
    case 'fit': return str(o.vid) && str(o.slot) && str(o.option);
    case 'paint': return str(o.vid) && (o.paint === null || str(o.paint)) && (o.accent === null || str(o.accent)) && str(o.finish) && str(o.livery);
    case 'repair': return str(o.vid) && num(o.damage);
    case 'refuel': return num(o.litres);
    case 'kits': return num(o.count);
    case 'discover': return str(o.poi);
    default: return STORY_OPS.has(o.op as string) && isStoryRequest(o);
  }
}

/** Apply one garage transaction. Returns the new career, or why it was refused; the input career is never modified. */
export function transact(career: Career, req: GarageRequest, ctx: GarageContext = {}): GarageResult {
  const c = clone(career);
  if (STORY_OPS.has(req.op)) return storyTransact(c, req as StoryRequest, ctx);
  const pay = (cost: number, msg: string): GarageResult => {
    if (!(cost >= 0) || !Number.isFinite(cost)) return fail('Not for sale');
    if (cost > c.cash) return fail(`Not enough money: ${money(cost)} needed, you have ${money(c.cash)}`);
    c.cash -= cost; c.spentTotal += cost;
    return { ok: true, career: c, delta: -cost, msg };
  };
  switch (req.op) {
    case 'buy-vehicle': {
      const spec = VEHICLES.find(s => s.id === req.vid); if (!spec) return fail('Unknown vehicle');
      if (c.owned[spec.id]) return fail(`You already own the ${spec.name}`);
      if (STORY_VEHICLES.has(spec.id)) return fail(`The ${spec.name} is not for sale`);
      const r = pay(vehiclePrice(spec.id), `Bought the ${spec.name}`);
      if (r.ok) c.owned[spec.id] = { build: defaultBuild(), unlocked: [], spent: 0 };
      return r;
    }
    case 'sell-vehicle': {
      const ov = c.owned[req.vid]; if (!ov) return fail('You do not own that vehicle');
      if (Object.keys(c.owned).length <= 1) return fail('You can not sell your only vehicle');
      if (STORY_VEHICLES.has(req.vid)) return fail('Your father\'s vehicle is not for sale');
      const value = resaleValue(req.vid, ov);
      delete c.owned[req.vid]; c.cash += value; c.earned += value;
      return { ok: true, career: c, delta: value, msg: `Sold the ${vehicleById(req.vid).name} for ${money(value)}` };
    }
    case 'fit': {
      const ov = c.owned[req.vid], spec = VEHICLES.find(s => s.id === req.vid);
      if (!ov || !spec) return fail('You do not own that vehicle');
      if (!slotsFor(spec).some(d => d.id === req.slot) || !optionsFor(spec, req.slot).some(o => o.id === req.option)) return fail('That part does not fit this vehicle');
      if (fitted(spec, ov.build, req.slot) === req.option) return fail('Already fitted');
      const cost = partPrice(spec, req.slot, req.option, ov), name = findOption(req.slot, req.option)!.name;
      const r = pay(cost, cost > 0 ? `Fitted ${name} (${money(cost)})` : `Fitted ${name}`);
      if (!r.ok) return r;
      const key = `${req.slot}:${req.option}`;
      if (req.option === stockOption(spec, req.slot)) delete ov.build.parts[req.slot];
      else { ov.build.parts[req.slot] = req.option; if (!ov.unlocked.includes(key)) ov.unlocked.push(key); }
      ov.spent += cost;
      return r;
    }
    case 'paint': {
      const ov = c.owned[req.vid], spec = VEHICLES.find(s => s.id === req.vid);
      if (!ov || !spec) return fail('You do not own that vehicle');
      const next = sanitizeBuild(spec, { ...ov.build, paint: req.paint, accent: req.accent, finish: req.finish, livery: req.livery });
      if (next.paint !== req.paint || next.accent !== req.accent || next.finish !== req.finish || next.livery !== req.livery) return fail('Invalid paint job');
      const cost = paintPrice(spec, ov.build, next);
      if (cost === 0 && next.paint === ov.build.paint && next.accent === ov.build.accent && next.finish === ov.build.finish && next.livery === ov.build.livery) return fail('Nothing to change');
      const r = pay(cost, `Paint shop: ${money(cost)}`);
      if (!r.ok) return r;
      Object.assign(ov.build, { paint: next.paint, accent: next.accent, finish: next.finish, livery: next.livery });
      ov.spent += cost;
      return r;
    }
    case 'repair': {
      if (!c.owned[req.vid]) return fail('You do not own that vehicle');
      const cost = repairPrice(req.vid, req.damage);
      if (cost <= 0) return fail('Nothing to repair');
      // nobody is left stranded: a repair you can't afford takes what you have
      const take = Math.min(cost, c.cash);
      c.cash -= take; c.spentTotal += take;
      return { ok: true, career: c, delta: -take, msg: take < cost ? `Repaired for everything you had (${money(take)} of ${money(cost)})` : `Repaired (${money(take)})` };
    }
    case 'refuel': {
      const l = Math.max(0, Math.min(400, req.litres));
      const cost = Math.round(l * FUEL_PRICE * 100) / 100;
      if (cost <= 0) return fail('No fuel bought');
      return pay(cost, `Fuel ${l.toFixed(1)} L (${money(cost)})`);
    }
    case 'kits': {
      const n = Math.max(0, Math.min(10, Math.floor(req.count)));
      if (n === 0) return fail('No kits bought');
      return pay(n * KIT_PRICE, `${n} repair kit${n === 1 ? '' : 's'} (${money(n * KIT_PRICE)})`);
    }
    case 'discover': {
      const p = ctx.pois?.find(q => q.id === req.poi);
      if (!p) return fail('Unknown place');
      if (c.discovered.includes(p.id)) return fail('Already discovered');
      if (!ctx.at || Math.hypot(ctx.at.x - p.x, ctx.at.z - p.z) > DISCOVERY_RADIUS) return fail('Too far away');
      const reward = discoveryReward(p.kind);
      c.discovered.push(p.id); c.cash += reward; c.earned += reward;
      return { ok: true, career: c, delta: reward, msg: reward > 0 ? `Discovered ${p.name}: +${money(reward)}` : `Discovered ${p.name}` };
    }
    default: return fail('Unknown request');
  }
}

/** Replay protection: each transaction carries a client-chosen id; a repeated id returns the first answer instead of charging twice. */
export class Ledger {
  private seen = new Map<string, GarageResult>();
  constructor(private cap = 512) {}
  run(txn: unknown, apply: () => GarageResult): GarageResult {
    if (typeof txn !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(txn)) return fail('Bad transaction id');
    const prev = this.seen.get(txn); if (prev) return prev;
    const r = apply();
    this.seen.set(txn, r);
    if (this.seen.size > this.cap) this.seen.delete(this.seen.keys().next().value as string);
    return r;
  }
}
export { money as formatMoney };
