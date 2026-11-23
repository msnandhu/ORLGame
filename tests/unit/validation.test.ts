import { describe, it, expect, beforeAll } from 'vitest';
import { Terrain, type PlayerTransform, isPlayerTransform, sanitizeChat } from '@orl/shared';
import { validateMove, RateLimiter } from '../../server/src/validation/movement';

let t: Terrain;
beforeAll(() => { t = new Terrain(); });
const tf = (x: number, z: number, extra: Partial<PlayerTransform> = {}): PlayerTransform =>
  ({ mode: 'foot', x, y: t.heightAt(x, z), z, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, t: 0, ...extra });

describe('server movement validation', () => {
  it('accepts normal walking', () => {
    expect(validateMove({ x: 0, y: t.heightAt(0, 0), z: 0, mode: 'foot', at: 0 }, tf(0.35, 0), 100, t).ok).toBe(true);
  });
  it('rejects teleporting on foot', () => {
    const v = validateMove({ x: 0, y: t.heightAt(0, 0), z: 0, mode: 'foot', at: 0 }, tf(60, 0), 100, t);
    expect(v).toEqual({ ok: false, reason: 'speed' });
  });
  it('allows vehicle speeds only in vehicle mode', () => {
    const prev = { x: 0, y: t.heightAt(0, 0), z: 0, mode: 'vehicle' as const, at: 0 };
    expect(validateMove(prev, tf(2.5, 0, { mode: 'vehicle', vx: 25 }), 100, t).ok).toBe(true);
    expect(validateMove({ ...prev, mode: 'foot' }, tf(2.5, 0, { mode: 'foot', vx: 25 }), 100, t).ok).toBe(false);
  });
  it('rejects positions under the map, out of bounds and broken rotations', () => {
    expect(validateMove(null, tf(0, 0, { y: t.heightAt(0, 0) - 20 }), 0, t).ok).toBe(false);
    expect(validateMove(null, tf(60000, 0), 0, t).ok).toBe(false);
    expect(validateMove(null, tf(0, 0, { qw: 3 }), 0, t).ok).toBe(false);
  });
  it('structural checks reject malformed input and sanitise chat', () => {
    expect(isPlayerTransform({ mode: 'foot', x: 1 })).toBe(false);
    expect(isPlayerTransform({ ...tf(0, 0), x: Number.NaN })).toBe(false);
    expect(isPlayerTransform(tf(0, 0))).toBe(true);
    expect(sanitizeChat('<script>hi</script>')).toBe('scripthi/script');
    expect(sanitizeChat('   ')).toBeNull();
  });
  it('rate limiter caps messages per second', () => {
    const r = new RateLimiter(3);
    expect([r.allow(0), r.allow(10), r.allow(20), r.allow(30)]).toEqual([true, true, true, false]);
    expect(r.allow(1100)).toBe(true);
  });
});

describe('phase 2 vehicle id in player state', () => {
  it('accepts a catalog-style id and rejects junk', async () => {
    const { isPlayerTransform } = await import('@orl/shared');
    const base = { mode: 'vehicle', x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, t: 1 };
    expect(isPlayerTransform({ ...base, vid: 'bramble-rc2' })).toBe(true);
    expect(isPlayerTransform(base)).toBe(true);
    expect(isPlayerTransform({ ...base, vid: '<script>' })).toBe(false);
    expect(isPlayerTransform({ ...base, vid: 42 })).toBe(false);
  });
});
