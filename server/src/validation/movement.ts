import { LIMITS, type PlayerTransform, type Terrain } from '@orl/shared';

export interface Accepted { x: number; y: number; z: number; mode: PlayerTransform['mode']; at: number }
export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Server-side plausibility checks for a client-reported transform. The server is authoritative over
 * what other players see: anything implausible is rejected and the sender is corrected back.
 */
export function validateMove(prev: Accepted | null, next: PlayerTransform, nowMs: number, terrain: Terrain): Verdict {
  if (!terrain.inBounds(next.x, next.z)) return { ok: false, reason: 'out_of_bounds' };
  const ground = terrain.heightAt(next.x, next.z);
  if (next.y < Math.min(ground, terrain.waterLevel - 3) - 2.5) return { ok: false, reason: 'below_ground' };
  if (next.y > ground + 80) return { ok: false, reason: 'too_high' };
  const ql = Math.hypot(next.qx, next.qy, next.qz, next.qw);
  if (Math.abs(ql - 1) > 0.05) return { ok: false, reason: 'bad_rotation' };
  const maxSpeed = next.mode === 'vehicle' ? LIMITS.maxVehicleSpeed : LIMITS.maxFootSpeed;
  if (Math.hypot(next.vx, next.vz) > maxSpeed) return { ok: false, reason: 'reported_speed' };
  if (!prev) return { ok: true };
  const dt = Math.max(0.05, (nowMs - prev.at) / 1000);
  // horizontal: allow the faster of the two modes when switching (entering/exiting a moving vehicle)
  const allowH = Math.max(maxSpeed, prev.mode === 'vehicle' ? LIMITS.maxVehicleSpeed : LIMITS.maxFootSpeed) * dt * 1.25 + 2;
  if (Math.hypot(next.x - prev.x, next.z - prev.z) > allowH) return { ok: false, reason: 'speed' };
  if (Math.abs(next.y - prev.y) > LIMITS.maxVerticalSpeed * dt + 3) return { ok: false, reason: 'vertical_speed' };
  return { ok: true };
}

/** Sliding-window rate limiter (per client). */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(private maxPerSecond: number) {}
  allow(now: number) {
    while (this.stamps.length && now - this.stamps[0] > 1000) this.stamps.shift();
    if (this.stamps.length >= this.maxPerSecond) return false;
    this.stamps.push(now); return true;
  }
}
