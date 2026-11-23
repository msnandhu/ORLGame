import { describe, it, expect, beforeAll } from 'vitest';
import { Terrain, Vehicle, Surface, RANGER_TX4, VALLEY_EXITS, S_SNOW, S_SAND, S_ICE, OuterWorld } from '@orl/shared';
import { NodeBuilder, NODE_N } from '../../client/src/world/island/islandNode';

/** The island beyond the valley: streamed tiles, seams, surfaces, water, bridges and driving out of the valley. */
let t: Terrain;
beforeAll(() => { t = new Terrain(); });

describe('island terrain beyond the valley', () => {
  it('meets the valley without a step anywhere along its edge', () => {
    let worst = 0;
    for (let s = -1278; s <= 1278; s += 6) for (const [x, z] of [[s, -1279.9], [s, 1279.9], [-1279.9, s], [1279.9, s]]) {
      const inner = t.heightAt(x, z), outer = t.outer.heightAt(x + Math.sign(x) * (Math.abs(x) > 1279 ? 0.2 : 0), z + Math.sign(z) * (Math.abs(z) > 1279 ? 0.2 : 0));
      worst = Math.max(worst, Math.abs(inner - outer));
    }
    expect(worst).toBeLessThan(0.15);
  });

  it('the renderer draws exactly the ground the physics drives on (finest level = physics tile)', () => {
    const nb = new NodeBuilder(t.outer);
    const ti = 40, tj = -20, d = nb.build({ id: 1, level: 0, ix: ti, iz: tj, trees: true });
    const tile = t.outer.tile(ti, tj);
    let worst = 0;
    for (let k = 0; k < NODE_N * NODE_N; k++) worst = Math.max(worst, Math.abs(d.pos[k * 3 + 1] - tile.h[k]));
    expect(worst).toBeLessThan(1e-3);
    // same trees, same places
    expect(d.trees.length / 6).toBe(tile.trees.length);
    if (tile.trees.length) { expect(d.trees[0]).toBeCloseTo(tile.trees[0].x, 3); expect(d.trees[1]).toBeCloseTo(tile.trees[0].y, 2); }
  });

  it('has snow in the north, sand on the beaches, ice on the frozen lake and sea all round', () => {
    const I = t.outer.island;
    const lake = I.lakes.find(l => l.frozen)!;
    expect(t.surfaceAt(lake.x, lake.z)).toBe(Surface.Ice);
    expect(t.waterAt(lake.x, lake.z)).toBe(-Infinity); // solid ice, not water
    let snow = 0, sand = 0, n = 0;
    for (let x = I.minX; x < I.maxX; x += 997) for (let z = I.minZ; z < I.maxZ; z += 997) {
      if (t.inCore(x, z)) continue;
      const s = t.surfaceAt(x, z); n++;
      if (s === S_SNOW && I.regionAt(x, z) === 'snow') snow++;
      if (s === S_SAND) sand++;
    }
    expect(snow).toBeGreaterThan(40);
    expect(sand).toBeGreaterThan(0);
    expect(S_ICE).toBe(Surface.Ice);
    // far out to sea
    expect(t.waterAt(I.minX + 400, I.minZ + 400)).toBe(0);
    expect(t.waterDepthAt(I.minX + 400, I.minZ + 400)).toBeGreaterThan(1);
  });

  it('bridges carry roads over water at deck height', () => {
    const r = t.outer.roads.find(q => q.bridge.some(b => b))!;
    expect(r).toBeTruthy();
    // the middle of the first bridge
    const i0 = r.bridge.findIndex(b => !!b); let i1 = i0; while (r.bridge[i1 + 1]) i1++;
    const i = Math.floor((i0 + i1) / 2);
    const [x, z] = r.pts[i];
    expect(t.heightAt(x, z)).toBeCloseTo(r.profile[i], 1);
    expect(t.heightAt(x, z)).toBeGreaterThan(t.waterAt(x, z) + 2);
    expect(t.surfaceAt(x, z)).toBe(Surface.Asphalt);
  });

  it('a vehicle drives out of the valley through the west exit onto the island highway', () => {
    const v = new Vehicle(RANGER_TX4, t);
    const e = VALLEY_EXITS.west;
    v.reset(e.x + 120, e.z, -Math.PI / 2); // facing west (-x)
    for (let i = 0; i < 480; i++) v.step(1 / 240, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    const x0 = v.body.pos.x;
    for (let i = 0; i < 240 * 25; i++) {
      v.step(1 / 240, { throttle: 0.7, brake: 0, steer: 0, handbrake: 0 });
      expect(Number.isFinite(v.body.pos.x)).toBe(true);
    }
    expect(v.body.pos.x).toBeLessThan(-OuterWorld.TILE * 10 - 200); // well outside the valley
    expect(x0 - v.body.pos.x).toBeGreaterThan(250);
    expect(v.body.pos.y).toBeGreaterThan(t.heightAt(v.body.pos.x, v.body.pos.z) - 0.5);
  });

  it('keeps players inside the world: the sea margin, not the old valley edge', () => {
    const p = { x: 5000, z: -9000 }; t.clampToWorld(p); expect(p).toEqual({ x: 5000, z: -9000 });
    const q = { x: 1e6, z: -1e6 }; t.clampToWorld(q);
    expect(q.x).toBe(t.outer.island.maxX - 200); expect(q.z).toBe(t.outer.island.minZ + 200);
  });
});
