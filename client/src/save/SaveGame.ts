import { GAME_VERSION, type Vehicle, type Character } from '@orl/shared';
import { log } from '../core/logger';

/** Local single-player progress. (Online progress will be server-owned in Phase 6.) */
export interface SaveData {
  version: string; savedAt: number;
  inVehicle: boolean;
  player: { x: number; z: number; heading: number };
  vehicle: { x: number; z: number; heading: number; fuel: number; driveMode: Vehicle['driveMode']; automatic: boolean; diffLock: boolean };
  playTimeSec: number;
}
const KEY = 'orl.save.slot1';

export const SaveGame = {
  write(d: Omit<SaveData, 'version' | 'savedAt'>): boolean {
    try { localStorage.setItem(KEY, JSON.stringify({ ...d, version: GAME_VERSION, savedAt: Date.now() })); return true; }
    catch (e) { log.warn('save', 'Could not write save game (storage blocked or full)', e); return false; }
  },
  read(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      if (!d || typeof d.player?.x !== 'number' || typeof d.vehicle?.x !== 'number') return null;
      return d;
    } catch { return null; }
  },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  capture(v: Vehicle, p: Character, inVehicle: boolean, playTimeSec: number): Omit<SaveData, 'version' | 'savedAt'> {
    return {
      inVehicle, playTimeSec,
      player: { x: p.pos.x, z: p.pos.z, heading: p.heading },
      vehicle: { x: v.body.pos.x, z: v.body.pos.z, heading: v.body.quat.yaw(), fuel: v.fuel, driveMode: v.driveMode, automatic: v.automatic, diffLock: v.diffLock },
    };
  },
};
