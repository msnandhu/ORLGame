import { sanitizeCareer, newCareer, type Career } from '@orl/shared';
import { log } from '../core/logger';

const KEY = 'orl.career.v1';

/**
 * The single-player career (money, owned vehicles and their builds, discovered places), kept apart from the save slot
 * so the garage works from the main menu. Online play uses the server's career instead (see Bank).
 */
export const CareerStore = {
  read(): Career {
    try { const raw = localStorage.getItem(KEY); return raw ? sanitizeCareer(JSON.parse(raw)) : newCareer(); }
    catch { return newCareer(); }
  },
  write(c: Career): boolean {
    try { localStorage.setItem(KEY, JSON.stringify(c)); return true; }
    catch (e) { log.warn('save', 'Could not store the career (storage blocked)', e); return false; }
  },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};
