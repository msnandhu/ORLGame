import type { PlayerTransform } from '../types/game';
import type { Career, GarageRequest } from '../garage/economy';

/** Client → server messages. */
export interface ClientMessages {
  state: PlayerTransform;
  chat: { text: string };
  /** a garage transaction; txn is a unique id so a resend is never charged twice */
  garage: { txn: string; req: GarageRequest };
  /** ask for the authoritative career */
  career: Record<string, never>;
}
/** Server → client messages. */
export interface ServerMessages {
  correction: { x: number; y: number; z: number; reason: string };
  chat: { from: string; text: string };
  /** the server's answer to a garage transaction, with the authoritative career */
  garageResult: { txn: string; ok: boolean; msg: string; career: Career };
  /** the authoritative career (on join) */
  career: Career;
}
export const MESSAGE = { STATE: 'state', CHAT: 'chat', CORRECTION: 'correction', GARAGE: 'garage', GARAGE_RESULT: 'garage-result', CAREER: 'career' } as const;

/** Structural validation for untrusted input (no throwing). */
export function isPlayerTransform(v: unknown): v is PlayerTransform {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const nums = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'vx', 'vy', 'vz', 't'];
  if (o.vid !== undefined && (typeof o.vid !== 'string' || !/^[a-z0-9-]{1,32}$/.test(o.vid))) return false;
  return (o.mode === 'foot' || o.mode === 'vehicle') && nums.every(k => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
}
export function sanitizeChat(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 200);
  return t.length ? t : null;
}
