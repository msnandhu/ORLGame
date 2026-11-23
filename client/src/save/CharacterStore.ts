import { sanitizeAppearance, type CharacterAppearance } from '@orl/shared';
import { log } from '../core/logger';

const KEY = 'orl.character.v1';

/** The player's look, stored apart from the save slot so it survives "New game". */
export const CharacterStore = {
  read(): CharacterAppearance | null {
    try { const raw = localStorage.getItem(KEY); return raw ? sanitizeAppearance(JSON.parse(raw)) : null; }
    catch { return null; }
  },
  write(a: CharacterAppearance): boolean {
    try { localStorage.setItem(KEY, JSON.stringify(sanitizeAppearance(a))); return true; }
    catch (e) { log.warn('save', 'Could not store the character (storage blocked)', e); return false; }
  },
};
