import type { Terrain } from '../terrain/terrain';
import type { OuterRoad } from '../world/outer';
import type { Compound } from './compounds';
import type { Where, Route } from './missions';
import type { UgChamber } from './underground';

export interface Placed { x: number; z: number; heading: number }

/**
 * Puts story data into the world: resolves `Where`s and `Route`s against the terrain (compound roads, compounds,
 * underground halls and map places). Deterministic, so the client, the server and tests agree on every position.
 */
export class StoryWorld {
  private roadCache = new Map<string, { road: OuterRoad; s0: number; L: number }>();
  constructor(readonly terrain: Terrain) {}

  compound(site: string): Compound {
    const c = this.terrain.compounds.find(q => q.id === site);
    if (!c) throw new Error(`unknown story site ${site}`);
    return c;
  }
  /** The road a compound stands beside, and the arc length of the point nearest it. */
  private roadOf(site: string) {
    let r = this.roadCache.get(site);
    if (r) return r;
    const c = this.compound(site), O = this.terrain.outer;
    // the nearest point of a road that is drivable there (at its graded level), not just the nearest line
    let best = Infinity, road = O.roads[0], i0 = 0;
    const T = this.terrain;
    for (const q of O.roads) for (let i = 0; i < q.pts.length; i++) {
      const d = Math.hypot(q.pts[i][0] - c.x, q.pts[i][1] - c.z);
      if (d < best && Math.abs(T.heightAt(q.pts[i][0], q.pts[i][1]) - q.profile[i]) < 1.5) { best = d; road = q; i0 = i; }
    }
    r = { road, s0: road.cum[i0], L: road.cum[road.cum.length - 1] };
    this.roadCache.set(site, r);
    return r;
  }
  /**
   * Arc length on the site's road `along` metres away from the compound. A negative `along` runs against the road's
   * direction; where the road ends too soon on that side (dead-end roads to a compound), the other side is used.
   */
  roadS(site: string, along: number): number {
    const { s0, L } = this.roadOf(site), need = Math.abs(along) + 80;
    let dir = Math.sign(along) || 1;
    if (dir > 0 && L - s0 < need) dir = -1; else if (dir < 0 && s0 < need) dir = 1;
    return Math.max(0, Math.min(L, s0 + dir * Math.abs(along)));
  }
  /** Point and heading on a road at arc length s. */
  roadAt(road: OuterRoad, s: number): Placed {
    const P = road.pts, cum = road.cum;
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])));
    const x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, z = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t;
    return { x, z, heading: Math.atan2(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) };
  }
  chamber(ch: number): UgChamber {
    const U = this.terrain.underground;
    return ch === 0 ? U.entry : ch === 99 ? U.final : U.chamberForChallenge(ch);
  }

  where(w: Where): Placed {
    switch (w.at) {
      case 'road': {
        const r = this.roadOf(w.site), s = this.roadS(w.site, w.along), p = this.roadAt(r.road, s);
        // heading: pointing away from the compound
        const away = s >= r.s0 ? p.heading : p.heading + Math.PI;
        // off to the side where the ground allows (on a mountain road the shoulder may be a cliff)
        const side0 = w.side ?? 0;
        for (const f of [1, 0.6, 0.35, 0.15]) {
          const side = side0 * f, x = p.x + Math.cos(p.heading) * side, z = p.z - Math.sin(p.heading) * side;
          if (side0 === 0 || this.open(x, z)) return { x, z, heading: away };
        }
        return { x: p.x, z: p.z, heading: away };
      }
      case 'compound': {
        const c = this.compound(w.site), ch = Math.cos(c.heading), sh = Math.sin(c.heading);
        return { x: c.x + w.lx * ch + w.lz * sh, z: c.z - w.lx * sh + w.lz * ch, heading: c.heading };
      }
      case 'ug': {
        const c = this.chamber(w.ch), U = this.terrain.underground;
        // the spot asked for, or the nearest open one towards the hall's middle (out of deep water and rock)
        let [x, z] = U.pointIn(c, w.ang, w.rr);
        for (let k = 1; k <= 8 && !this.open(x, z); k++) [x, z] = U.pointIn(c, w.ang + (k % 2 ? 1 : -1) * 0.12 * k, w.rr * (1 - 0.06 * k));
        return { x, z, heading: Math.atan2(c.x - x, c.z - z) };
      }
      case 'poi': {
        const p = this.terrain.outer.island.pois.find(q => q.id === w.poi);
        if (!p) throw new Error(`unknown place ${w.poi}`);
        const [x, z] = this.freeSpot(p.x + (w.dx ?? 0), p.z + (w.dz ?? 0));
        return { x, z, heading: 0 };
      }
    }
  }
  /** Dry, fairly level ground. */
  open(x: number, z: number) { const T = this.terrain; return T.waterDepthAt(x, z) < 0.4 && T.normalAt(x, z)[1] > 0.85; }
  /** The nearest open, dry, level spot (not inside a building) to a point. */
  freeSpot(x: number, z: number): [number, number] {
    const T = this.terrain;
    for (let r = 0; r <= 120; r += 4) for (let a = 0; a < Math.max(1, r); a++) {
      const ang = (a / Math.max(1, r)) * Math.PI * 2, px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
      if (T.waterDepthAt(px, pz) > 0.05 || T.normalAt(px, pz)[1] < 0.93) continue;
      let blocked = false;
      for (const i of T.boxesNear(px, pz)) {
        const b = T.boxes[i], c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = px - b.cx, dz = pz - b.cz;
        if (Math.abs(dx * c - dz * s) < b.hx + 4 && Math.abs(dx * s + dz * c) < b.hz + 4) { blocked = true; break; }
      }
      if (!blocked) return [px, pz];
    }
    return [x, z];
  }

  route(r: Route): [number, number][] {
    const out: [number, number][] = [];
    switch (r.kind) {
      case 'road': {
        const R = this.roadOf(r.site).road, a = this.roadS(r.site, r.from), b = this.roadS(r.site, r.to), step = r.step ?? 20;
        const n = Math.max(2, Math.ceil(Math.abs(b - a) / step));
        for (let k = 0; k <= n; k++) { const p = this.roadAt(R, a + (b - a) * k / n); out.push([p.x, p.z]); }
        return out;
      }
      case 'ring': {
        const c = this.chamber(r.ch), U = this.terrain.underground;
        for (let k = 0; k < r.n; k++) { const ang = (k / r.n) * Math.PI * 2 * (r.reverse ? -1 : 1); out.push(U.pointIn(c, ang, r.rr)); }
        return out;
      }
      case 'slalom': return this.terrain.underground.slalom(this.chamber(r.ch));
      case 'tunnel': {
        const c = this.chamber(r.ch), U = this.terrain.underground;
        return U.route(c.index, c.index + 1);
      }
    }
  }
}
