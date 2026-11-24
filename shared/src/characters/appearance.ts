/**
 * Character appearance as plain data. The client builds the model from it, saves it, and sends it to other
 * players as a short code. Every field is validated, because it arrives from untrusted clients.
 */
export type BodyType = 'male' | 'female';
export const HAIR_STYLES = ['short', 'buzz', 'swept', 'long', 'ponytail', 'bun', 'curly', 'bald'] as const;
export const BEARD_STYLES = ['none', 'stubble', 'short', 'full', 'goatee'] as const;
export const FACE_SHAPES = ['oval', 'square', 'round', 'long'] as const;
export const TOP_STYLES = ['field-jacket', 'hoodie', 'flannel', 'vest', 'tee', 'trail-jacket', 'crop-jacket'] as const;
/** colourways of the lead outfits (trail jacket, crop jacket): classic, yellow, arctic white/grey, camo */
export const OUTFIT_VARIANTS = ['classic', 'yellow', 'arctic', 'camo'] as const;
export const BOOT_STYLES = ['hiking', 'work', 'tall'] as const;
export const GLOVE_STYLES = ['none', 'fingerless', 'work'] as const;
export const HEADWEAR = ['none', 'cap', 'beanie', 'bush-hat', 'helmet'] as const;
export const ACCESSORIES = ['backpack', 'sunglasses', 'scarf', 'watch'] as const;

/** Palettes (sRGB hex). Indices are stored, so palettes can grow without breaking saves. */
export const SKIN_TONES = ['#f3d2bd', '#e6b899', '#cf9a74', '#b07a55', '#8d5a3c', '#6b4129', '#4a2c1c'];
export const HAIR_COLORS = ['#1b1512', '#3a2618', '#6b4426', '#a8743e', '#d8b16a', '#8f8f8f', '#e8e4dc', '#7a2e1d'];
export const CLOTH_COLORS = ['#3d5640', '#55452f', '#2f3d4f', '#7a2f24', '#c2682b', '#8a8a7e', '#1f2224', '#5b6b2f', '#d9cfb8', '#2c5f6f', '#2e2722', '#6b6548', '#8a5a34'];
export const EYE_COLORS = ['#4a3020', '#2f5a7a', '#4d6b3a', '#6b6f73'];

export type HairStyle = typeof HAIR_STYLES[number];
export type BeardStyle = typeof BEARD_STYLES[number];
export type FaceShape = typeof FACE_SHAPES[number];
export type TopStyle = typeof TOP_STYLES[number];
export type BootStyle = typeof BOOT_STYLES[number];
export type GloveStyle = typeof GLOVE_STYLES[number];
export type Headwear = typeof HEADWEAR[number];
export type Accessory = typeof ACCESSORIES[number];
export type OutfitVariant = typeof OUTFIT_VARIANTS[number];

export interface CharacterAppearance {
  body: BodyType;
  height: number;         // 0..1  -> 1.60 .. 1.95 m (male) / 1.52 .. 1.85 m (female)
  build: number;          // 0..1  slim .. heavy
  skin: number;           // SKIN_TONES index
  face: FaceShape;
  eyes: number;           // EYE_COLORS index
  hair: HairStyle;
  hairColor: number;      // HAIR_COLORS index
  beard: BeardStyle;      // always 'none' for the female body
  top: TopStyle;
  topColor: number;       // CLOTH_COLORS index
  variant: number;        // OUTFIT_VARIANTS index (lead outfits)
  pantsColor: number;
  boots: BootStyle;
  gloves: GloveStyle;
  headwear: Headwear;
  headwearColor: number;
  accessories: Accessory[];
}

/** The male lead from the concept sheets: 180 cm, athletic, curly hair, short beard, aviators, bandana, trail jacket. */
export const DEFAULT_MALE: CharacterAppearance = {
  body: 'male', height: 0.571, build: 0.55, skin: 2, face: 'square', eyes: 0, hair: 'curly', hairColor: 1, beard: 'short',
  top: 'trail-jacket', topColor: 1, variant: 0, pantsColor: 10, boots: 'hiking', gloves: 'fingerless', headwear: 'none', headwearColor: 4,
  accessories: ['backpack', 'sunglasses', 'scarf', 'watch'],
};
/** The female lead: 168 cm, athletic, ponytail, aviators, bandana, red cropped jacket, olive cargo pants. */
export const DEFAULT_FEMALE: CharacterAppearance = {
  body: 'female', height: 0.485, build: 0.42, skin: 1, face: 'oval', eyes: 0, hair: 'ponytail', hairColor: 1, beard: 'none',
  top: 'crop-jacket', topColor: 3, variant: 0, pantsColor: 11, boots: 'hiking', gloves: 'fingerless', headwear: 'none', headwearColor: 4,
  accessories: ['backpack', 'sunglasses', 'scarf', 'watch'],
};
/** The previous (v0.5-v0.10) defaults, so saves that never changed them move to the new leads. */
export const LEGACY_DEFAULT_CODES = ['m504521001100100141', 'f503510142023201043'];

/** Standing height in metres. */
export function statureOf(a: CharacterAppearance): number {
  return a.body === 'female' ? 1.52 + a.height * 0.33 : 1.6 + a.height * 0.35;
}

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : fallback);
const idx = (n: number, v: unknown, fallback: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? v as number : fallback);
const unit = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Accepts anything (a save, a network message) and returns a valid appearance. */
export function sanitizeAppearance(raw: unknown): CharacterAppearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const body: BodyType = r.body === 'female' ? 'female' : 'male';
  const d = body === 'female' ? DEFAULT_FEMALE : DEFAULT_MALE;
  const acc = Array.isArray(r.accessories) ? [...new Set(r.accessories.filter((x): x is Accessory => typeof x === 'string' && (ACCESSORIES as readonly string[]).includes(x)))] : d.accessories;
  return {
    body, height: unit(r.height, d.height), build: unit(r.build, d.build), skin: idx(SKIN_TONES.length, r.skin, d.skin),
    face: pick(FACE_SHAPES, r.face, d.face), eyes: idx(EYE_COLORS.length, r.eyes, d.eyes),
    hair: pick(HAIR_STYLES, r.hair, d.hair), hairColor: idx(HAIR_COLORS.length, r.hairColor, d.hairColor),
    beard: body === 'female' ? 'none' : pick(BEARD_STYLES, r.beard, d.beard),
    top: pick(TOP_STYLES, r.top, d.top), topColor: idx(CLOTH_COLORS.length, r.topColor, d.topColor), variant: idx(OUTFIT_VARIANTS.length, r.variant, 0), pantsColor: idx(CLOTH_COLORS.length, r.pantsColor, d.pantsColor),
    boots: pick(BOOT_STYLES, r.boots, d.boots), gloves: pick(GLOVE_STYLES, r.gloves, d.gloves),
    headwear: pick(HEADWEAR, r.headwear, d.headwear), headwearColor: idx(CLOTH_COLORS.length, r.headwearColor, d.headwearColor),
    accessories: acc,
  };
}

/**
 * Compact text code for the network (about 20 characters): one base-36 digit per choice, two for the sliders.
 * Decoding goes through sanitizeAppearance, so a hostile code can only produce a valid look.
 */
export function encodeAppearance(a: CharacterAppearance): string {
  const b36 = (n: number) => n.toString(36);
  const s2 = (v: number) => Math.round(v * 99).toString(10).padStart(2, '0');
  const accMask = ACCESSORIES.reduce((m, k, i) => m | (a.accessories.includes(k) ? 1 << i : 0), 0);
  return [
    a.body === 'female' ? 'f' : 'm', s2(a.height), s2(a.build), b36(a.skin), b36(FACE_SHAPES.indexOf(a.face)), b36(a.eyes),
    b36(HAIR_STYLES.indexOf(a.hair)), b36(a.hairColor), b36(BEARD_STYLES.indexOf(a.beard)), b36(TOP_STYLES.indexOf(a.top)), b36(a.topColor),
    b36(a.pantsColor), b36(BOOT_STYLES.indexOf(a.boots)), b36(GLOVE_STYLES.indexOf(a.gloves)), b36(HEADWEAR.indexOf(a.headwear)), b36(a.headwearColor), b36(accMask), b36(a.variant),
  ].join('');
}

export function decodeAppearance(code: unknown): CharacterAppearance {
  if (typeof code !== 'string' || !/^[mf][0-9]{4}[0-9a-z]{14,15}$/.test(code)) return sanitizeAppearance(null);
  const c = code, d = (i: number) => parseInt(c[i], 36);
  const mask = d(18);
  return sanitizeAppearance({
    body: c[0] === 'f' ? 'female' : 'male', height: +c.slice(1, 3) / 99, build: +c.slice(3, 5) / 99, skin: d(5), face: FACE_SHAPES[d(6)], eyes: d(7),
    hair: HAIR_STYLES[d(8)], hairColor: d(9), beard: BEARD_STYLES[d(10)], top: TOP_STYLES[d(11)], topColor: d(12), pantsColor: d(13),
    boots: BOOT_STYLES[d(14)], gloves: GLOVE_STYLES[d(15)], headwear: HEADWEAR[d(16)], headwearColor: d(17),
    accessories: ACCESSORIES.filter((_, i) => mask & (1 << i)), variant: c.length > 19 ? d(19) : 0,
  });
}

/** A random but tasteful look (used by Randomize and for NPCs). rnd() returns 0..1. */
export function randomAppearance(rnd: () => number, body?: BodyType): CharacterAppearance {
  const r = <T>(l: readonly T[]) => l[Math.floor(rnd() * l.length)];
  const b: BodyType = body ?? (rnd() < 0.5 ? 'male' : 'female');
  return sanitizeAppearance({
    body: b, height: rnd(), build: rnd() * 0.8, skin: Math.floor(rnd() * SKIN_TONES.length), face: r(FACE_SHAPES), eyes: Math.floor(rnd() * EYE_COLORS.length),
    hair: r(HAIR_STYLES), hairColor: Math.floor(rnd() * HAIR_COLORS.length), beard: b === 'male' ? r(BEARD_STYLES) : 'none',
    top: r(TOP_STYLES), variant: Math.floor(rnd() * OUTFIT_VARIANTS.length), topColor: Math.floor(rnd() * CLOTH_COLORS.length), pantsColor: [0, 1, 2, 10, 11][Math.floor(rnd() * 5)], boots: r(BOOT_STYLES), gloves: r(GLOVE_STYLES),
    headwear: r(HEADWEAR), headwearColor: Math.floor(rnd() * CLOTH_COLORS.length), accessories: ACCESSORIES.filter(() => rnd() < 0.35),
  });
}
