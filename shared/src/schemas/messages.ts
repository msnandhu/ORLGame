import type { PlayerTransform } from '../types/game';

/** Client → server messages. */
export interface ClientMessages {
  state: PlayerTransform;
  chat: { text: string };
}
/** Server → client messages. */
export interface ServerMessages {
  correction: { x: number; y: number; z: number; reason: string };
  chat: { from: string; text: string };
}
export const MESSAGE = { STATE: 'state', CHAT: 'chat', CORRECTION: 'correction' } as const;

/** Structural validation for untrusted input (no throwing). */
export function isPlayerTransform(v: unknown): v is PlayerTransform {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const nums = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'vx', 'vy', 'vz', 't'];
  return (o.mode === 'foot' || o.mode === 'vehicle') && nums.every(k => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
}
export function sanitizeChat(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 200);
  return t.length ? t : null;
}
