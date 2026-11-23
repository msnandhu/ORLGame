// Fits the island's scale (land = 1,170 km²) and region weights (each region at its stated area).
// Run: npx tsx tools/fit-island.ts   then paste the printed ISLAND_FIT into shared/src/world/island.ts
import { Island, REGIONS, ISLAND_AREA_KM2, ISLAND_FIT, type Fit, type RegionId } from '../shared/src/world/island';

const fit: Fit = { scale: ISLAND_FIT.scale, weights: { ...ISLAND_FIT.weights } };
const cell = Number(process.argv[2] ?? 250);
for (let it = 0; it < 8; it++) {
  const m = new Island(fit).measureAreas(cell);
  fit.scale *= Math.sqrt(ISLAND_AREA_KM2 / m.land);
  console.log('scale', fit.scale.toFixed(3), 'land', m.land.toFixed(1));
  if (Math.abs(m.land - ISLAND_AREA_KM2) < 2) break;
}
for (let it = 0; it < 12; it++) {
  const m = new Island(fit).measureAreas(cell);
  let worst = 0;
  for (const r of REGIONS) {
    const err = (r.area - m.regions[r.id]) / r.area; worst = Math.max(worst, Math.abs(err));
    fit.weights[r.id as RegionId] += err * 3e7;
  }
  // land area drifts a little with the warp; keep scale honest
  fit.scale *= Math.sqrt(ISLAND_AREA_KM2 / m.land);
  console.log(it, m.land.toFixed(1), Object.entries(m.regions).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' '), 'worst', (worst * 100).toFixed(2) + '%');
  if (worst < 0.0012 && Math.abs(m.land - ISLAND_AREA_KM2) < 1.5) break;
}
const r = (v: number) => Math.round(v);
console.log(`export const ISLAND_FIT = { scale: ${fit.scale.toFixed(3)}, weights: { snow: ${r(fit.weights.snow)}, hill: ${r(fit.weights.hill)}, plain: ${r(fit.weights.plain)}, forest: ${r(fit.weights.forest)} } as Record<RegionId, number> };`);
