import type { VehicleSpec, TyreType } from '../vehicles/spec';

/**
 * The parts catalogue. Every option is data: what it costs, what it looks like (the client reads the fitted option ids
 * from the vehicle's look) and what it does to the vehicle simulation (PartEffect, applied by applyBuild in build.ts).
 * Nothing here is decorative only unless it says so: the paint shop and rim colours are cosmetic by nature.
 */
export type VehicleClass = 'offroad' | 'road';
/** Off-roaders have a transfer case; everything else is a road car. */
export const vehicleClass = (s: VehicleSpec): VehicleClass => (s.drivetrain === 'part-time-4wd' ? 'offroad' : 'road');

export type PartGroup = 'body' | 'wheels' | 'suspension' | 'engine';
export type SlotId =
  | 'bullbar' | 'rack' | 'lights' | 'steps' | 'snorkel' | 'spoiler' | 'splitter'
  | 'rims' | 'rimColor' | 'tyres' | 'tyreSize'
  | 'height' | 'springs' | 'shocks' | 'antiroll'
  | 'ecu' | 'turbo' | 'exhaust' | 'intake' | 'cooling' | 'tank';

/** What a part does to the simulation. Multipliers default to 1, additions to 0. */
export interface PartEffect {
  /** kg added to the vehicle */
  mass?: number;
  /** multiplier on aerodynamic drag */
  drag?: number;
  /** downforce added, N per (m/s)^2 */
  downforce?: number;
  /** multiplier on the whole torque curve */
  torque?: number;
  /** multiplier reached at the redline, ramping up from 40% of the redline (turbo, exhaust) */
  torqueTop?: number;
  /** multiplier below 40% of the redline (turbo lag) */
  torqueLow?: number;
  /** rpm added to the redline (and the top of the torque curve) */
  redline?: number;
  /** multiplier on cooling capacity: < 1 runs hotter, > 1 cooler */
  cooling?: number;
  /** air intake height above the centre of mass (absolute, metres): a snorkel lets the engine breathe in deep water */
  intake?: number;
  /** suspension: added to rest length and travel (metres), multipliers on rates */
  restLength?: number; maxTravel?: number;
  springs?: number; damping?: number; antiRoll?: number;
  /** tyres: added radius and width (metres), multiplier on wheel inertia */
  radius?: number; width?: number; wheelInertia?: number;
  /** tyre compound (absolute) */
  tyre?: TyreType;
  /** multiplier on fuel capacity */
  fuel?: number;
  /** multiplier on damage resistance */
  armour?: number;
  /** engine sound gain (client audio) */
  sound?: number;
  /** extra driving lamps lit with the headlights */
  beams?: number;
}
export interface PartOption {
  id: string; name: string; desc: string;
  /** list price in USD for a $40,000 vehicle (scaled by priceScale) */
  price: number;
  effect: PartEffect;
  /** restrict an option to one vehicle class */
  classes?: VehicleClass[];
  /** purely cosmetic (no effect on the simulation) */
  cosmetic?: boolean;
}
export interface SlotDef { id: SlotId; group: PartGroup; name: string; classes: VehicleClass[]; options: PartOption[] }

export const PART_GROUPS: { id: PartGroup; name: string }[] = [
  { id: 'body', name: 'Body' }, { id: 'wheels', name: 'Wheels & tyres' }, { id: 'suspension', name: 'Suspension' }, { id: 'engine', name: 'Engine' },
];
const OR: VehicleClass[] = ['offroad'], RD: VehicleClass[] = ['road'], ALL: VehicleClass[] = ['offroad', 'road'];

export const RIM_STYLES = ['multi', 'five', 'split', 'mesh', 'turbine', 'steel', 'beadlock'] as const;
export type RimStyleId = typeof RIM_STYLES[number];

export const SLOTS: SlotDef[] = [
  // ------------------------------------------------------------------ body
  { id: 'bullbar', group: 'body', name: 'Front protection', classes: OR, options: [
    { id: 'none', name: 'None', desc: 'Bare bumper. Lightest, least protection.', price: 0, effect: {} },
    { id: 'tube', name: 'Tube nudge bar', desc: 'Steel hoop over the bumper. Shrugs off small knocks.', price: 900, effect: { mass: 18, armour: 1.06 } },
    { id: 'full', name: 'Full bull bar', desc: 'Heavy steel bar guarding grille and lamps: much less front damage, but 45 kg on the nose.', price: 2400, effect: { mass: 45, armour: 1.18, drag: 1.02 } },
  ] },
  { id: 'rack', group: 'body', name: 'Roof rack', classes: OR, options: [
    { id: 'none', name: 'None', desc: 'Clean roof, least drag.', price: 0, effect: {} },
    { id: 'expedition', name: 'Expedition rack', desc: 'Full-length platform with a jerrycan. Adds weight up high and a little drag.', price: 1300, effect: { mass: 38, drag: 1.04 } },
    { id: 'basket', name: 'Cargo basket', desc: 'Short basket rack with a spare wheel on top.', price: 950, effect: { mass: 30, drag: 1.03 } },
  ] },
  { id: 'lights', group: 'body', name: 'Driving lights', classes: OR, options: [
    { id: 'none', name: 'None', desc: 'Headlamps only.', price: 0, effect: {} },
    { id: 'bar', name: 'Roof light bar', desc: 'LED bar: lights the trail well ahead of the headlamps at night.', price: 750, effect: { mass: 6, drag: 1.01, beams: 1 } },
    { id: 'pods', name: 'Light bar + bumper pods', desc: 'Light bar plus four spot pods on the bumper for a wide, long beam.', price: 1400, effect: { mass: 10, drag: 1.015, beams: 3 } },
  ] },
  { id: 'steps', group: 'body', name: 'Sills', classes: OR, options: [
    { id: 'none', name: 'None', desc: 'Nothing hanging below the doors.', price: 0, effect: {} },
    { id: 'steps', name: 'Side steps', desc: 'Step boards for climbing in.', price: 600, effect: { mass: 14 } },
    { id: 'sliders', name: 'Rock sliders', desc: 'Frame-mounted steel rails that take the hits on rock instead of the sills.', price: 1100, effect: { mass: 24, armour: 1.08 } },
  ] },
  { id: 'snorkel', group: 'body', name: 'Snorkel', classes: OR, options: [
    { id: 'none', name: 'None', desc: 'Engine breathes from under the bonnet: deep water floods it.', price: 0, effect: { intake: 0.12 } },
    { id: 'snorkel', name: 'Raised air intake', desc: 'Intake at roof height: wade water up to the windscreen.', price: 650, effect: { mass: 4, intake: 1.0 } },
  ] },
  { id: 'spoiler', group: 'body', name: 'Rear wing', classes: RD, options: [
    { id: 'stock', name: 'Factory', desc: 'The car as it left the factory.', price: 0, effect: {} },
    { id: 'none', name: 'Delete', desc: 'No wing: less drag, less rear grip at speed.', price: 250, effect: { downforce: -0.25, drag: 0.98 } },
    { id: 'ducktail', name: 'Ducktail lip', desc: 'Small boot-lid lip: a little rear downforce for almost no drag.', price: 900, effect: { downforce: 0.12, drag: 1.005 } },
    { id: 'wing', name: 'GT wing', desc: 'Swan-neck carbon wing: real rear downforce in fast corners, more drag.', price: 3800, effect: { downforce: 0.55, drag: 1.05, mass: 9 } },
  ] },
  { id: 'splitter', group: 'body', name: 'Front splitter', classes: RD, options: [
    { id: 'none', name: 'None', desc: 'Factory bumper.', price: 0, effect: {} },
    { id: 'carbon', name: 'Carbon splitter', desc: 'Front lip that adds front-end downforce at speed.', price: 1600, effect: { downforce: 0.18, drag: 1.01, mass: 3 } },
  ] },
  // ------------------------------------------------------------------ wheels
  { id: 'rims', group: 'wheels', name: 'Rims', classes: ALL, options: [
    { id: 'stock', name: 'Factory', desc: 'The factory wheel.', price: 0, effect: {} },
    { id: 'five', name: 'Five twin-spoke alloy', desc: 'Light cast alloy.', price: 1400, effect: { wheelInertia: 0.95 } },
    { id: 'multi', name: 'Ten-spoke alloy', desc: 'Light cast alloy.', price: 1400, effect: { wheelInertia: 0.95 } },
    { id: 'mesh', name: 'Forged mesh', desc: 'Forged: the lightest wheel, sharper response.', price: 3200, effect: { wheelInertia: 0.85, mass: -8 } },
    { id: 'turbine', name: 'Forged turbine', desc: 'Forged: the lightest wheel, sharper response.', price: 3200, effect: { wheelInertia: 0.85, mass: -8 } },
    { id: 'split', name: 'Split six-spoke', desc: 'Cast alloy.', price: 1600, effect: { wheelInertia: 0.97 } },
    { id: 'steel', name: 'Steel wheel', desc: 'Heavy and nearly unbreakable.', price: 500, effect: { wheelInertia: 1.08, mass: 10 } },
    { id: 'beadlock', name: 'Beadlock', desc: 'Clamps the tyre bead so you can air down on rock without unseating it.', price: 2600, effect: { wheelInertia: 1.1, mass: 12 }, classes: OR },
  ] },
  { id: 'rimColor', group: 'wheels', name: 'Rim finish', classes: ALL, options: [
    { id: 'stock', name: 'Factory', desc: 'Factory finish.', price: 0, effect: {}, cosmetic: true },
    { id: 'black', name: 'Satin black', desc: 'Powder-coated satin black.', price: 350, effect: {}, cosmetic: true },
    { id: 'silver', name: 'Silver', desc: 'Bright silver.', price: 350, effect: {}, cosmetic: true },
    { id: 'bronze', name: 'Bronze', desc: 'Rally bronze.', price: 450, effect: {}, cosmetic: true },
    { id: 'gunmetal', name: 'Gunmetal', desc: 'Dark grey metallic.', price: 350, effect: {}, cosmetic: true },
  ] },
  { id: 'tyres', group: 'wheels', name: 'Tyres', classes: ALL, options: [
    { id: 'all-terrain', name: 'All-terrain', desc: 'Good everywhere, best nowhere; a little less grip on tarmac.', price: 1100, effect: { tyre: 'all-terrain' } },
    { id: 'mud', name: 'Mud-terrain', desc: 'Open tread that clears itself: far more grip in mud and on grass, noisy and slippery on tarmac.', price: 1500, effect: { tyre: 'mud' }, classes: OR },
    { id: 'rock', name: 'Rock compound', desc: 'Soft sticky rubber: best grip on rock and dirt, wears fast on tarmac.', price: 1700, effect: { tyre: 'rock' }, classes: OR },
    { id: 'snow', name: 'Studded winter', desc: 'Siped, studded tread: real grip on snow and ice, worse on dry tarmac.', price: 1400, effect: { tyre: 'snow' } },
    { id: 'road', name: 'Road', desc: 'Quiet touring tyre: good on tarmac, poor off it.', price: 800, effect: { tyre: 'road' } },
    { id: 'performance', name: 'Performance', desc: 'Semi-slick: huge grip on dry tarmac, hopeless on loose ground.', price: 2200, effect: { tyre: 'performance' }, classes: RD },
  ] },
  { id: 'tyreSize', group: 'wheels', name: 'Tyre size', classes: OR, options: [
    { id: 'stock', name: 'Factory size', desc: 'The size the gearing was designed for.', price: 0, effect: {} },
    { id: 'plus1', name: '+2 inch', desc: 'Taller tyres: +3 cm clearance, taller gearing, heavier wheels.', price: 1300, effect: { radius: 0.03, width: 0.02, mass: 16, wheelInertia: 1.18 } },
    { id: 'plus2', name: '+4 inch', desc: 'Much taller tyres: +6 cm clearance, long gearing, heavy wheels.', price: 2600, effect: { radius: 0.06, width: 0.04, mass: 34, wheelInertia: 1.4 } },
  ] },
  // ------------------------------------------------------------------ suspension
  { id: 'height', group: 'suspension', name: 'Ride height', classes: ALL, options: [
    { id: 'stock', name: 'Factory height', desc: 'Factory ride height.', price: 0, effect: {} },
    { id: 'lift50', name: '50 mm lift kit', desc: 'Longer springs and shocks: more clearance and travel, higher centre of mass.', price: 1800, effect: { restLength: 0.05, maxTravel: 0.03, mass: 8 }, classes: OR },
    { id: 'lift100', name: '100 mm lift kit', desc: 'Big lift: lots of clearance and travel, but the body sits high and rolls.', price: 3400, effect: { restLength: 0.1, maxTravel: 0.06, mass: 16 }, classes: OR },
    { id: 'lower30', name: '30 mm lowering springs', desc: 'Lower centre of mass and less roll; scrapes on rough ground.', price: 1200, effect: { restLength: -0.03, maxTravel: -0.02, springs: 1.12 }, classes: RD },
  ] },
  { id: 'springs', group: 'suspension', name: 'Springs', classes: ALL, options: [
    { id: 'soft', name: 'Soft', desc: 'Soaks up rough ground and articulates further; wallows on the road.', price: 700, effect: { springs: 0.8 } },
    { id: 'stock', name: 'Factory', desc: 'Factory spring rates.', price: 0, effect: {} },
    { id: 'stiff', name: 'Stiff', desc: 'Less body roll and pitch; skips over bumps.', price: 700, effect: { springs: 1.25 } },
  ] },
  { id: 'shocks', group: 'suspension', name: 'Dampers', classes: ALL, options: [
    { id: 'stock', name: 'Factory', desc: 'Factory dampers.', price: 0, effect: {} },
    { id: 'sport', name: 'Sport dampers', desc: 'Firmer valving: the body settles faster after bumps and kerbs.', price: 1500, effect: { damping: 1.25 } },
    { id: 'long', name: 'Long-travel remote reservoir', desc: 'More wheel travel and fade-free damping for big hits.', price: 2900, effect: { maxTravel: 0.06, damping: 1.1, mass: 6 }, classes: OR },
  ] },
  { id: 'antiroll', group: 'suspension', name: 'Anti-roll bars', classes: ALL, options: [
    { id: 'soft', name: 'Soft / disconnect', desc: 'Lets the axles twist further over rocks; leans in corners.', price: 600, effect: { antiRoll: 0.55 } },
    { id: 'stock', name: 'Factory', desc: 'Factory bars.', price: 0, effect: {} },
    { id: 'stiff', name: 'Stiff', desc: 'Flat cornering; lifts a wheel sooner off-road.', price: 600, effect: { antiRoll: 1.45 } },
  ] },
  // ------------------------------------------------------------------ engine
  { id: 'ecu', group: 'engine', name: 'ECU tune', classes: ALL, options: [
    { id: 'stock', name: 'Factory map', desc: 'Factory engine map.', price: 0, effect: {} },
    { id: 'stage1', name: 'Stage 1 map', desc: '+8% torque everywhere; runs a little hotter.', price: 1200, effect: { torque: 1.08, cooling: 0.95 } },
    { id: 'stage2', name: 'Stage 2 map', desc: '+16% torque and +200 rpm redline; runs noticeably hotter.', price: 2800, effect: { torque: 1.16, redline: 200, cooling: 0.88 } },
  ] },
  { id: 'turbo', group: 'engine', name: 'Turbocharger', classes: ALL, options: [
    { id: 'stock', name: 'Factory', desc: 'Factory induction.', price: 0, effect: {} },
    { id: 'hybrid', name: 'Hybrid turbo', desc: 'Bigger compressor: up to +15% torque high in the rev range, a little lag low down, more heat.', price: 3600, effect: { torqueTop: 1.15, torqueLow: 0.95, cooling: 0.92, sound: 1.1 } },
  ] },
  { id: 'exhaust', group: 'engine', name: 'Exhaust', classes: ALL, options: [
    { id: 'stock', name: 'Factory', desc: 'Quiet factory system.', price: 0, effect: {} },
    { id: 'sport', name: 'Sport exhaust', desc: 'Freer-flowing stainless system: +4% top-end torque, 9 kg lighter, much louder.', price: 1500, effect: { torqueTop: 1.04, mass: -9, sound: 1.4 } },
  ] },
  { id: 'intake', group: 'engine', name: 'Air intake', classes: ALL, options: [
    { id: 'stock', name: 'Factory', desc: 'Factory airbox.', price: 0, effect: {} },
    { id: 'cold', name: 'Cold-air intake', desc: 'Cooler, denser air: +2.5% torque.', price: 650, effect: { torque: 1.025 } },
  ] },
  { id: 'cooling', group: 'engine', name: 'Cooling', classes: ALL, options: [
    { id: 'stock', name: 'Factory radiator', desc: 'Factory radiator.', price: 0, effect: {} },
    { id: 'hd', name: 'Heavy-duty radiator', desc: 'Bigger core and fans: 40% more cooling for crawling, towing and tuned engines.', price: 1100, effect: { cooling: 1.4, mass: 6 } },
  ] },
  { id: 'tank', group: 'engine', name: 'Fuel tank', classes: OR, options: [
    { id: 'stock', name: 'Factory tank', desc: 'Factory tank.', price: 0, effect: {} },
    { id: 'long', name: 'Long-range tank', desc: '50% more fuel for long expeditions.', price: 1300, effect: { fuel: 1.5, mass: 22 } },
  ] },
];
export const SLOT_BY_ID = Object.fromEntries(SLOTS.map(s => [s.id, s])) as Record<SlotId, SlotDef>;

/** Factory fitment where it differs from each slot's default (its 'stock' option, or 'none'). */
const STOCK_FIT: Record<string, Partial<Record<SlotId, string>>> = {
  'ranger-tx4': { bullbar: 'tube', rack: 'expedition', lights: 'bar', steps: 'steps', snorkel: 'snorkel', tyres: 'all-terrain' },
  'bramble-rc2': { bullbar: 'tube', lights: 'bar', steps: 'sliders', tyres: 'all-terrain' },
  'sovereign-x1': { bullbar: 'full', lights: 'pods', steps: 'sliders', snorkel: 'snorkel', tyres: 'all-terrain', shocks: 'long' },
  'vanta-gt': { spoiler: 'wing' },
};

/** The slots a vehicle can modify. */
export function slotsFor(s: VehicleSpec): SlotDef[] {
  const c = vehicleClass(s);
  return SLOTS.filter(d => d.classes.includes(c));
}
/** Options a vehicle may fit in a slot. */
export function optionsFor(s: VehicleSpec, slot: SlotId): PartOption[] {
  const c = vehicleClass(s), d = SLOT_BY_ID[slot];
  if (!d || !d.classes.includes(c)) return [];
  // a 'Factory' entry only where the factory part is that entry (a car whose factory part is, say, a GT wing lists the wing)
  const stock = stockOption(s, slot);
  return d.options.filter(o => (!o.classes || o.classes.includes(c)) && !(o.id === 'stock' && stock !== 'stock'));
}
/** The factory fitment of every slot (what a vehicle that never visited the garage has). */
export function stockFit(s: VehicleSpec): Record<string, string> {
  return Object.fromEntries(slotsFor(s).map(d => [d.id, stockOption(s, d.id)]));
}
/** The factory option in a slot. */
export function stockOption(s: VehicleSpec, slot: SlotId): string {
  const f = STOCK_FIT[s.id]?.[slot];
  if (f) return f;
  if (slot === 'tyres') return s.tyre ?? 'all-terrain';
  if (slot === 'snorkel') return s.look.snorkel ? 'snorkel' : 'none';
  const d = SLOT_BY_ID[slot];
  return d.options.some(o => o.id === 'stock') ? 'stock' : 'none';
}
export function findOption(slot: SlotId, id: string): PartOption | undefined {
  return SLOT_BY_ID[slot]?.options.find(o => o.id === id);
}
