import { GAME_VERSION, DRIVING_MODES, sanitizeCondition, type Vehicle, type Character, type VehicleCondition, type DrivingMode } from '@orl/shared';
import { log } from '../core/logger';

/** Local single-player progress. (Online progress will be server-owned in Phase 6.) */
export interface SaveData {
  version: string; savedAt: number;
  inVehicle: boolean;
  player: { x: number; z: number; heading: number };
  /** the active vehicle (kept for saves from before 0.4) */
  vehicle: SavedVehicle;
  /** every vehicle at camp, with its condition (0.4+) */
  vehicles?: SavedVehicle[];
  activeVehicle?: string;
  repairKits?: number;
  playTimeSec: number;
}
export interface SavedVehicle {
  id?: string; x: number; z: number; heading: number; fuel: number; driveMode: Vehicle['driveMode']; automatic: boolean; diffLock: boolean;
  drivingMode?: DrivingMode; condition?: VehicleCondition; engineTemp?: number;
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
  vehicleState(v: Vehicle): SavedVehicle {
    return { id: v.spec.id, x: v.body.pos.x, z: v.body.pos.z, heading: v.body.quat.yaw(), fuel: v.fuel, driveMode: v.driveMode, automatic: v.automatic, diffLock: v.diffLock, drivingMode: v.drivingMode, condition: v.condition, engineTemp: v.engineTemp };
  },
  /** Restore a saved vehicle's state onto a sim (tolerant of old or hand-edited saves). */
  apply(v: Vehicle, s: SavedVehicle) {
    v.fuel = Math.min(v.spec.fuelCapacity, Math.max(0, +s.fuel || 0));
    v.condition = sanitizeCondition(s.condition);
    if (typeof s.engineTemp === 'number' && isFinite(s.engineTemp)) v.engineTemp = s.engineTemp;
    v.reset(s.x, s.z, s.heading);
    if (s.drivingMode && DRIVING_MODES.includes(s.drivingMode)) v.setDrivingMode(s.drivingMode);
    v.driveMode = s.driveMode; v.automatic = s.automatic; v.diffLock = s.diffLock;
  },
  capture(fleet: Vehicle[], active: Vehicle, p: Character, inVehicle: boolean, playTimeSec: number, repairKits: number): Omit<SaveData, 'version' | 'savedAt'> {
    return {
      inVehicle, playTimeSec, repairKits,
      player: { x: p.pos.x, z: p.pos.z, heading: p.heading },
      vehicle: this.vehicleState(active),
      vehicles: fleet.map(v => this.vehicleState(v)),
      activeVehicle: active.spec.id,
    };
  },
};
