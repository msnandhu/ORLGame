import { sanitizeAppearance, encodeAppearance, LEGACY_DEFAULT_CODES, DEFAULT_MALE, DEFAULT_FEMALE, type CharacterAppearance } from '@orl/shared';
import { log } from '../core/logger';

const KEY = 'orl.character.v1';

/** The player's look, stored apart from the save slot so it survives "New game". */
export const CharacterStore = {
  read(): CharacterAppearance | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const a = sanitizeAppearance(JSON.parse(raw));
      // a look that was never changed from the old default becomes the new lead character
      const i = LEGACY_DEFAULT_CODES.indexOf(encodeAppearance(a).slice(0, 19));
      return i < 0 ? a : { ...(i === 0 ? DEFAULT_MALE : DEFAULT_FEMALE) };
    }
    catch { return null; }
  },
  write(a: CharacterAppearance): boolean {
    try { localStorage.setItem(KEY, JSON.stringify(sanitizeAppearance(a))); return true; }
    catch (e) { log.warn('save', 'Could not store the character (storage blocked)', e); return false; }
  },
};
