import { describe, it, expect, beforeAll } from 'vitest';
import { Island, REGIONS, ISLAND_AREA_KM2, Terrain } from '@orl/shared';

describe('island: four regions after the reference world map', () => {
  let isl: Island;
  beforeAll(() => { isl = new Island(); });

  it('the land is 1,170 km² and each region has its stated area (sampled every 250 m)', () => {
    const m = isl.measureAreas(250);
    expect(ISLAND_AREA_KM2).toBe(1170);
    expect(Math.abs(m.land - 1170) / 1170).toBeLessThan(0.01);
    for (const r of REGIONS) expect(Math.abs(m.regions[r.id] - r.area) / r.area, r.id).toBeLessThan(0.02);
  });

  it('regions sit where the reference map has them: snow north, forest west, hill east, plain south', () => {
    const c = (id: string) => { const ps = isl.pois.filter(p => p.region === id); return [ps.reduce((a, p) => a + p.x, 0) / ps.length, ps.reduce((a, p) => a + p.z, 0) / ps.length]; };
    const [sx, sz] = c('snow'), [fx] = c('forest'), [hx] = c('hill'), [, pz] = c('plain');
    expect(sz).toBeLessThan(pz - 8000);    // north = -z
    expect(fx).toBeLessThan(hx - 15000);   // west of the hills
    expect(Math.abs(sx - (fx + hx) / 2)).toBeLessThan(8000);
  });

  it('every place lies inside its region, and the detailed valley is in the Plain region', () => {
    for (const p of isl.pois) expect(isl.regionAt(p.x, p.z), p.id).toBe(p.region);
    for (let x = -1250; x <= 1250; x += 250) for (let z = -1250; z <= 1250; z += 250) expect(isl.regionAt(x, z)).toBe('plain');
    const city = isl.pois.find(p => p.id === 'plain-city')!;
    expect(city.built).toBe(true);
    expect(new Terrain().settlements.find(s => s.kind === 'city')!.name).toBe('Plain City');
  });

  it('Glacier Peak summit is 4,872 m and the snow region is the highest', () => {
    const pk = isl.pois.find(p => p.id === 'glacier-peak')!;
    expect(isl.heightAt(pk.x, pk.z)).toBeCloseTo(4872, 0);
    const avg = (id: string) => { const ps = isl.pois.filter(p => p.region === id && p.kind !== 'lake'); return ps.reduce((a, p) => a + isl.heightAt(p.x, p.z), 0) / ps.length; };
    expect(avg('snow')).toBeGreaterThan(avg('hill'));
    expect(avg('hill')).toBeGreaterThan(avg('plain'));
  });

  it('rivers never flow uphill and reach the sea; lakes hold water below their shore', () => {
    for (const r of isl.rivers) {
      for (let i = 1; i < r.level.length; i++) expect(r.level[i]).toBeLessThanOrEqual(r.level[i - 1] + 1e-6);
      const [mx, mz] = r.pts[r.pts.length - 1];
      expect(isl.coastDist(mx, mz), r.id).toBeLessThan(600);
    }
    for (const l of isl.lakes) {
      expect(isl.heightAt(l.x, l.z)).toBeLessThan(l.level);
      expect(isl.waterAt(l.x, l.z)).toBe(l.level);
    }
  });

  it('every place is reachable: on a road, or at the end of an off-road trail', () => {
    for (const p of isl.pois) {
      if (p.built) continue;
      let best = Infinity;
      for (const r of isl.roads) for (const [x, z] of r.pts) best = Math.min(best, Math.hypot(x - p.x, z - p.z));
      expect(best, p.id).toBeLessThan(150);
    }
  });

  it('is deterministic', () => {
    const b = new Island();
    for (const [x, z] of [[0, 0], [-9000, -4000], [12000, -6000], [3000, 9000]]) expect(b.heightAt(x, z)).toBe(isl.heightAt(x, z));
  });
});
