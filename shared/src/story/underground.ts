import { Noise2D, clamp, lerp, smoothstep } from '../math/noise';

/**
 * The underground world: a chain of caverns joined by tunnels, under the island and reached through the entrance in
 * the Snow Region. It lives in its own patch of world coordinates beyond the island's sea (x > UG_X0), so the same
 * vehicle and character physics run on it: Terrain hands every query inside UG_RECT to this heightfield.
 *
 * The floor is a 2 m heightfield (same triangle split as the island), built once from the chamber/tunnel layout.
 * Outside the caverns the ground rises into rock walls; the renderer closes the space with a ceiling. Every chamber
 * has a theme that sets its surface (sand, mud, ice, rock, concrete), water and props, so the underground mixes all
 * the island's terrain types. Each challenge chamber has an exit gate (a collider) that opens when its encounter is won.
 */

export type UgTheme = 'rock' | 'ruins' | 'river' | 'desert' | 'mud' | 'ice' | 'industrial' | 'lab' | 'garage' | 'arena' | 'throne';
export type UgKind = 'entry' | 'challenge' | 'repair' | 'final';
export interface UgChamber {
  index: number; kind: UgKind; theme: UgTheme; name: string;
  x: number; z: number; r: number;
  /** floor height at the centre */
  floor: number;
  /** challenge number 1..21 (challenge chambers only) */
  challenge?: number;
}
export interface UgTunnel { from: number; to: number; pts: [number, number][]; cum: number[]; hw: number }
export interface UgGate { chamber: number; x: number; z: number; yaw: number; w: number }
export interface UgProp { kind: 'container' | 'pipe' | 'pillar' | 'lift' | 'console' | 'tank' | 'rack' | 'crate' | 'pylon'; x: number; z: number; y: number; w: number; h: number; d: number; yaw: number; chamber: number }
export interface UgBoulder { x: number; y: number; z: number; r: number }

/** The underground's patch of world space (well outside the island's playable bounds). */
export const UG_RECT = { x0: 25000, z0: -6600, x1: 27200, z1: -4700 };
export const UG_X0 = UG_RECT.x0;
export const UG_CELL = 2;
/** surface ids (numerically the same as terrain.ts's Surface enum) */
const S = { grass: 0, dirt: 1, mud: 2, rock: 3, gravel: 4, asphalt: 5, snow: 6, sand: 7, ice: 8 } as const;

/** The chain, in driving order: entry hall, 21 challenge halls, 3 repair bays and the master's arena. */
const CHAIN: { kind: UgKind; theme: UgTheme; name: string }[] = [
  { kind: 'entry', theme: 'rock', name: 'Iron Gate Hall' },
  { kind: 'challenge', theme: 'rock', name: 'Boulder Run' },
  { kind: 'challenge', theme: 'ruins', name: 'Sentry Vault' },
  { kind: 'challenge', theme: 'river', name: 'Black River' },
  { kind: 'challenge', theme: 'rock', name: 'Scout Den' },
  { kind: 'challenge', theme: 'desert', name: 'Sand Hall' },
  { kind: 'challenge', theme: 'mud', name: 'Pump Station' },
  { kind: 'challenge', theme: 'ice', name: 'Ice Gallery' },
  { kind: 'repair', theme: 'garage', name: 'Old Service Bay' },
  { kind: 'challenge', theme: 'industrial', name: 'Ore Works' },
  { kind: 'challenge', theme: 'rock', name: 'Wedge Hall' },
  { kind: 'challenge', theme: 'arena', name: 'Crusher Pit' },
  { kind: 'challenge', theme: 'lab', name: 'Vehicle Laboratory' },
  { kind: 'challenge', theme: 'industrial', name: 'Freight Line' },
  { kind: 'challenge', theme: 'garage', name: 'Secret Garage' },
  { kind: 'repair', theme: 'garage', name: 'Hidden Workshop' },
  { kind: 'challenge', theme: 'river', name: 'Flooded Cistern' },
  { kind: 'challenge', theme: 'industrial', name: 'Collapsing Shaft' },
  { kind: 'challenge', theme: 'desert', name: 'Dust Gauntlet' },
  { kind: 'challenge', theme: 'mud', name: 'Sump Arena' },
  { kind: 'challenge', theme: 'ice', name: 'Frozen Keep' },
  { kind: 'challenge', theme: 'ruins', name: 'Twin Pillars' },
  { kind: 'repair', theme: 'garage', name: 'Last Refuge' },
  { kind: 'challenge', theme: 'lab', name: 'Reactor Hall' },
  { kind: 'challenge', theme: 'arena', name: 'Throne Gate' },
  { kind: 'final', theme: 'throne', name: 'The Sovereign Arena' },
];
const RADIUS: Record<UgKind, number> = { entry: 40, challenge: 66, repair: 30, final: 105 };
const THEME_RADIUS: Partial<Record<UgTheme, number>> = { arena: 80, desert: 74, ice: 72 };
const SURFACE: Record<UgTheme, number> = { rock: S.rock, ruins: S.gravel, river: S.gravel, desert: S.sand, mud: S.mud, ice: S.ice, industrial: S.asphalt, lab: S.asphalt, garage: S.asphalt, arena: S.dirt, throne: S.asphalt };
const WALL = 26;
const PER_ROW = 6, COL = 345, ROW = 360;

export class Underground {
  readonly chambers: UgChamber[] = [];
  readonly tunnels: UgTunnel[] = [];
  readonly gates: UgGate[] = [];
  readonly props: UgProp[] = [];
  readonly boulders: UgBoulder[] = [];
  /** heightfield over UG_RECT */
  readonly nx: number; readonly nz: number;
  readonly heights: Float32Array; readonly surface: Uint8Array; readonly mud: Float32Array;
  /** ceiling height per sample (for the renderer) */
  readonly ceiling: Float32Array;
  /** water surface per sample (-Infinity where dry) */
  readonly water: Float32Array;
  readonly rect = UG_RECT;
  private noise = new Noise2D(9091);
  /** coarse index: features near each 64 m cell */
  private idx = new Map<number, number[]>();

  constructor() {
    // serpentine layout, floors stepping down into the earth
    let floor = 60;
    CHAIN.forEach((c, i) => {
      const row = Math.floor(i / PER_ROW), k = i % PER_ROW, col = row % 2 ? PER_ROW - 1 - k : k;
      let x = UG_RECT.x0 + 200 + col * COL, z = UG_RECT.z0 + 190 + row * ROW;
      if (c.kind === 'final') { x += row % 2 ? -40 : 40; z += 40; }
      const r = c.kind === 'challenge' ? THEME_RADIUS[c.theme] ?? RADIUS.challenge : RADIUS[c.kind];
      if (i > 0) floor += [-4, -2.5, -5, 1.5, -3, -1][i % 6];
      this.chambers.push({ index: i, kind: c.kind, theme: c.theme, name: c.name, x, z, r, floor, challenge: undefined });
    });
    let ch = 0;
    for (const c of this.chambers) if (c.kind === 'challenge') c.challenge = ++ch;
    // tunnels: a gentle S-bend between consecutive chambers
    for (let i = 0; i < this.chambers.length - 1; i++) {
      const a = this.chambers[i], b = this.chambers[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;
      const bend = ((i * 37) % 5 - 2) * 16;
      const pts: [number, number][] = [];
      for (let s = 0; s <= 16; s++) {
        const t = s / 16, w = Math.sin(t * Math.PI) * bend * Math.sin(t * Math.PI * 2 + 0.6);
        pts.push([a.x + dx * t + nx * w, a.z + dz * t + nz * w]);
      }
      const cum = [0]; for (let s = 1; s < pts.length; s++) cum.push(cum[s - 1] + Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]));
      this.tunnels.push({ from: i, to: i + 1, pts, cum, hw: 9 });
    }
    this.buildIndex();
    this.nx = Math.round((UG_RECT.x1 - UG_RECT.x0) / UG_CELL) + 1;
    this.nz = Math.round((UG_RECT.z1 - UG_RECT.z0) / UG_CELL) + 1;
    const n = this.nx * this.nz;
    this.heights = new Float32Array(n); this.surface = new Uint8Array(n); this.mud = new Float32Array(n);
    this.ceiling = new Float32Array(n); this.water = new Float32Array(n).fill(-Infinity);
    this.bnx = Math.ceil(this.nx / 32); this.ready = new Uint8Array(this.bnx * Math.ceil(this.nz / 32));
    this.buildProps();
  }

  // ------------------------------------------------------------------ layout queries
  private buildIndex() {
    const add = (f: number, x0: number, z0: number, x1: number, z1: number) => {
      for (let cx = Math.floor(x0 / 64); cx <= Math.floor(x1 / 64); cx++) for (let cz = Math.floor(z0 / 64); cz <= Math.floor(z1 / 64); cz++) {
        const k = cx * 65536 + cz; let l = this.idx.get(k); if (!l) this.idx.set(k, l = []); if (!l.includes(f)) l.push(f);
      }
    };
    const M = 90;
    this.chambers.forEach((c, i) => add(i, c.x - c.r - M, c.z - c.r - M, c.x + c.r + M, c.z + c.r + M));
    this.tunnels.forEach((t, i) => { for (const [x, z] of t.pts) add(1000 + i, x - t.hw - M, z - t.hw - M, x + t.hw + M, z + t.hw + M); });
  }
  /**
   * The open space nearest a point: signed distance to its edge (negative inside), the floor height there, and which
   * chamber it belongs to (a tunnel counts as the chamber it leads from).
   */
  feature(x: number, z: number): { d: number; floor: number; chamber: number; tunnel: number; t: number } {
    let best = { d: 400, floor: this.chambers[0].floor, chamber: 0, tunnel: -1, t: 0 };
    const near = this.idx.get(Math.floor(x / 64) * 65536 + Math.floor(z / 64));
    if (!near) {
      // far from everything: the nearest chamber's floor
      let bd = Infinity; for (const c of this.chambers) { const d = Math.hypot(x - c.x, z - c.z) - c.r; if (d < bd) { bd = d; best = { d, floor: c.floor, chamber: c.index, tunnel: -1, t: 0 }; } }
      return best;
    }
    for (const f of near) {
      if (f < 1000) {
        const c = this.chambers[f], d = Math.hypot(x - c.x, z - c.z) - c.r * (1 + 0.06 * this.noise.noise(Math.atan2(z - c.z, x - c.x) * 2.2, f * 3.1));
        if (d < best.d) best = { d, floor: c.floor, chamber: f, tunnel: -1, t: 0 };
      } else {
        const ti = f - 1000, t = this.tunnels[ti], a = this.chambers[t.from], b = this.chambers[t.to];
        for (let s = 0; s < t.pts.length - 1; s++) {
          const [ax, az] = t.pts[s], [bx, bz] = t.pts[s + 1];
          const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
          const u = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
          const d = Math.hypot(x - ax - ex * u, z - az - ez * u) - t.hw;
          if (d < best.d) {
            // the ramp runs between the two chamber rims, so each chamber floor stays flat
            const sAlong = t.cum[s] + Math.sqrt(l2) * u, L = t.cum[t.cum.length - 1];
            const k = smoothstep(a.r * 0.9, L - b.r * 0.9, sAlong);
            best = { d, floor: lerp(a.floor, b.floor, k), chamber: k < 0.5 ? t.from : t.to, tunnel: ti, t: sAlong / L };
          }
        }
      }
    }
    return best;
  }

  /** Heightfield blocks (32 x 32 samples) are filled on first use: the caverns cost nothing until someone goes down. */
  private ready: Uint8Array; readonly bnx: number;
  /** Fill the block holding sample (i, j). */
  ensure(i: number, j: number) {
    const b = (j >> 5) * this.bnx + (i >> 5);
    if (this.ready[b]) return;
    this.ready[b] = 1;
    const i0 = (i >> 5) * 32, j0 = (j >> 5) * 32;
    for (let jj = j0; jj < Math.min(this.nz, j0 + 32); jj++) for (let ii = i0; ii < Math.min(this.nx, i0 + 32); ii++) this.sample(ii, jj);
  }
  /** Fill the whole heightfield now (the renderer needs all of it). */
  ensureAll() { for (let j = 0; j < this.nz; j += 32) for (let i = 0; i < this.nx; i += 32) this.ensure(i, j); }

  /** Distance from a point to the lines from a chamber's centre out through its tunnel mouths. */
  private lanes = new Map<number, [number, number][]>();
  private laneDist(c: UgChamber, x: number, z: number): number {
    let ends = this.lanes.get(c.index);
    if (!ends) {
      ends = [];
      for (const t of this.tunnels) {
        if (t.from === c.index) ends.push(t.pts.find(p => Math.hypot(p[0] - c.x, p[1] - c.z) > c.r + 12) ?? t.pts[t.pts.length - 1]);
        if (t.to === c.index) ends.push([...t.pts].reverse().find(p => Math.hypot(p[0] - c.x, p[1] - c.z) > c.r + 12) ?? t.pts[0]);
      }
      this.lanes.set(c.index, ends);
    }
    let best = Infinity;
    for (const [ex, ez] of ends) {
      const dx = ex - c.x, dz = ez - c.z, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - c.x) * dx + (z - c.z) * dz) / L2));
      best = Math.min(best, Math.hypot(x - c.x - dx * t, z - c.z - dz * t));
    }
    return best;
  }
  private sample(i: number, j: number) {
    const x = UG_RECT.x0 + i * UG_CELL, z = UG_RECT.z0 + j * UG_CELL, k = j * this.nx + i;
    const f = this.feature(x, z), c = this.chambers[f.chamber], N = this.noise;
    if (f.d > 10) {
      // solid rock: no detail needed beyond the wall's own roughness
      this.heights[k] = f.floor + WALL + N.noise(x / 31, z / 31) * 3; this.surface[k] = S.rock; this.ceiling[k] = this.heights[k];
      return;
    }
    let h = f.floor + N.fbm(x / 23, z / 23, 3) * 0.35;
    let surf = f.tunnel >= 0 ? (N.noise(x / 40, z / 40) > 0.2 ? S.rock : S.gravel) : SURFACE[c.theme];
    let mud = 0;
    if (f.tunnel < 0 && f.d < 4) {
      const lx = x - c.x, lz = z - c.z, rr = Math.hypot(lx, lz) / c.r;
      // the driving lanes to the tunnel mouths stay level: no banks or ridges across the way in and out
      const lane = smoothstep(7, 15, this.laneDist(c, x, z));
      switch (c.theme) {
        case 'desert': h += (N.fbm(x / 18, z / 30, 3) * 1.6 + Math.sin(x / 9 + N.noise(x / 60, z / 60) * 3) * 0.35) * smoothstep(1, 0.6, rr); break;
        case 'mud': { const m = smoothstep(0.85, 0.3, rr) * (0.6 + 0.4 * N.noise(x / 14, z / 14)); mud = clamp(m, 0, 1); h -= mud * 0.6; break; }
        case 'river': {
          // a river runs across the hall; the ford is shallow in the middle third
          const across = Math.abs(lx * 0.8 + lz * 0.6) , band = smoothstep(16, 6, across);
          h -= band * (1.3 - 0.75 * smoothstep(c.r * 0.45, 0, Math.abs(-lx * 0.6 + lz * 0.8)));
          if (across < 18) this.water[k] = c.floor - 0.35;
          if (band > 0.2) surf = S.gravel;
          break;
        }
        case 'rock': case 'ruins': h += Math.max(0, N.ridged(x / 25, z / 25, 3) - 0.55) * 4 * smoothstep(0.95, 0.5, rr) * (c.theme === 'rock' ? 1 : 0.4) * lane; break;
        case 'arena': h += smoothstep(0.75, 0.98, rr) * 3.2 * lane; break; // banked rim
        case 'throne': h += smoothstep(0.8, 1, rr) * 4 * lane + (rr < 0.12 ? 1.2 * smoothstep(0.12, 0.08, rr) : 0); break; // banked, with a dais
        case 'ice': break;
        default: break;
      }
    } else if (f.tunnel >= 0 && f.d < 0) h += Math.max(0, -f.d - 6) * -0.05; // slight dish in the tunnel middle
    // walls: steep rock rising from the edge of the open space
    const wall = smoothstep(-1.5, 7, f.d);
    h = lerp(h, f.floor + WALL + N.fbm(x / 31, z / 31, 3) * 4, wall);
    if (wall > 0.25) surf = S.rock;
    this.heights[k] = h; this.surface[k] = surf; this.mud[k] = wall > 0.1 ? 0 : mud;
    // ceiling: a dome over chambers, a vault over tunnels
    const span = f.tunnel >= 0 ? 12 : c.kind === 'final' ? 34 : c.kind === 'repair' ? 13 : 22;
    const rr = f.tunnel >= 0 ? 0 : Math.min(1, Math.hypot(x - c.x, z - c.z) / c.r);
    this.ceiling[k] = f.floor + span * (1 - 0.45 * rr * rr) + N.fbm(x / 17, z / 17, 3) * 1.6;
  }

  private buildProps() {
    const N = this.noise;
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const c of this.chambers) {
      const at = (ang: number, rr: number) => [c.x + Math.cos(ang) * c.r * rr, c.z + Math.sin(ang) * c.r * rr] as const;
      const prop = (kind: UgProp['kind'], ang: number, rr: number, w: number, h: number, d: number, yawOff = 0) => {
        const [x, z] = at(ang, rr); this.props.push({ kind, x, z, y: this.heightAt(x, z), w, h, d, yaw: -ang + yawOff, chamber: c.index });
      };
      // exit gate: where the tunnel to the next chamber leaves this one (challenge halls only)
      const t = this.tunnels.find(q => q.from === c.index);
      if (t && c.kind === 'challenge') {
        let s = 1; while (s < t.pts.length - 1 && Math.hypot(t.pts[s][0] - c.x, t.pts[s][1] - c.z) < c.r + 6) s++;
        const [ax, az] = t.pts[s - 1], [bx, bz] = t.pts[s];
        const u = clamp((c.r + 6 - Math.hypot(ax - c.x, az - c.z)) / Math.max(1, Math.hypot(bx - ax, bz - az)), 0, 1);
        const gx = lerp(ax, bx, u), gz = lerp(az, bz, u);
        this.gates.push({ chamber: c.index, x: gx, z: gz, yaw: Math.atan2(bx - ax, bz - az), w: t.hw * 2 + 6 });
      }
      switch (c.theme) {
        case 'rock': for (let n = 0; n < 16; n++) { const a = rnd() * Math.PI * 2, rr = 0.25 + rnd() * 0.6; const [x, z] = at(a, rr); if (this.clearOfPath(c, x, z, 12)) this.boulders.push({ x, z, y: this.heightAt(x, z) - 0.3, r: 0.8 + rnd() * 1.6 }); } break;
        case 'ruins': for (let n = 0; n < 10; n++) { const a = (n / 10) * Math.PI * 2 + 0.3, rr = n % 2 ? 0.55 : 0.78; const [x, z] = at(a, rr); if (this.clearOfPath(c, x, z, 10)) prop('pillar', a, rr, 2.2, 9 + (n % 3) * 3, 2.2); } break;
        case 'industrial': for (let n = 0; n < 8; n++) { const a = n * 0.8 + 0.4, rr = 0.68 + (n % 2) * 0.14; const [x, z] = at(a, rr); if (this.clearOfPath(c, x, z, 10)) prop(n % 3 ? 'container' : 'tank', a, rr, n % 3 ? 2.5 : 4, n % 3 ? 2.6 : 5, n % 3 ? 6.1 : 4, Math.PI / 2); } break;
        case 'lab': for (let n = 0; n < 6; n++) { const a = n * 1.05 + 0.2; const [x, z] = at(a, 0.82); if (this.clearOfPath(c, x, z, 10)) prop(n % 2 ? 'console' : 'rack', a, 0.82, 3, 2.4, 1.2, Math.PI / 2); } break;
        case 'garage': for (let n = 0; n < (c.kind === 'repair' ? 3 : 6); n++) { const a = n * 1.1 + 0.5; const [x, z] = at(a, 0.72); if (this.clearOfPath(c, x, z, 9)) prop(n % 2 ? 'rack' : 'lift', a, 0.72, n % 2 ? 4 : 3.2, n % 2 ? 3 : 0.25, n % 2 ? 1 : 5.5, Math.PI / 2); } break;
        case 'desert': for (let n = 0; n < 6; n++) { const a = rnd() * Math.PI * 2; const [x, z] = at(a, 0.85); if (this.clearOfPath(c, x, z, 12)) this.boulders.push({ x, z, y: this.heightAt(x, z) - 0.6, r: 1.6 + rnd() }); } break;
        case 'ice': for (let n = 0; n < 8; n++) { const a = n * 0.785; const [x, z] = at(a, 0.5); if (this.clearOfPath(c, x, z, 12)) prop('pillar', a, 0.5, 1.6, 12, 1.6); } break;
        default: break;
      }
      void N;
    }
  }
  /** Keep props off the straight line between a chamber's entrance and exit, so the way through stays open. */
  /** The Boulder Run's slalom gates: zig-zagging across the hall from its entrance side to its exit side. */
  slalom(c: UgChamber): [number, number][] {
    const [ex, ez] = this.pointIn(c, 0, 1), ux = (ex - c.x) / c.r, uz = (ez - c.z) / c.r, vx = -uz, vz = ux, out: [number, number][] = [];
    for (let k = 0; k <= 6; k++) {
      const along = (-0.82 + 1.64 * (k / 6)) * c.r, lat = (k === 0 || k === 6 ? 0 : k % 2 ? 0.2 : -0.2) * c.r;
      out.push([c.x + ux * along + vx * lat, c.z + uz * along + vz * lat]);
    }
    return out;
  }
  private clearOfPath(c: UgChamber, x: number, z: number, margin: number) {
    const tin = this.tunnels.find(q => q.to === c.index), tout = this.tunnels.find(q => q.from === c.index);
    const lines: [number, number, number, number][] = [];
    // the slalom line through the Boulder Run stays clear too (its boulders flank the gates)
    if (c.challenge === 1) { const S = this.slalom(c); for (let k = 1; k < S.length; k++) lines.push([S[k - 1][0], S[k - 1][1], S[k][0], S[k][1]]); }
    if (tin) { const p = tin.pts[tin.pts.length - 3]; lines.push([p[0], p[1], c.x, c.z]); }
    if (tout) { const p = tout.pts[2]; lines.push([c.x, c.z, p[0], p[1]]); }
    for (const [ax, az, bx, bz] of lines) {
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1, u = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
      if (Math.hypot(x - ax - ex * u, z - az - ez * u) < margin) return false;
    }
    return Math.hypot(x - c.x, z - c.z) > 8;
  }

  // ------------------------------------------------------------------ heightfield queries (Terrain delegates here)
  contains(x: number, z: number) { return x >= UG_RECT.x0 && x <= UG_RECT.x1 && z >= UG_RECT.z0 && z <= UG_RECT.z1; }
  private cellOf(x: number, z: number) {
    const fx = clamp((x - UG_RECT.x0) / UG_CELL, 0, this.nx - 1.0001), fz = clamp((z - UG_RECT.z0) / UG_CELL, 0, this.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    this.ensure(i, j); this.ensure(i + 1, j); this.ensure(i, j + 1); this.ensure(i + 1, j + 1);
    return { i, j, u: fx - i, v: fz - j };
  }
  heightAt(x: number, z: number): number {
    const { i, j, u, v } = this.cellOf(x, z), N = this.nx, H = this.heights;
    const h00 = H[j * N + i], h10 = H[j * N + i + 1], h01 = H[(j + 1) * N + i], h11 = H[(j + 1) * N + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }
  normalAt(x: number, z: number): [number, number, number] {
    const { i, j, u, v } = this.cellOf(x, z), N = this.nx, H = this.heights, C = UG_CELL;
    const h00 = H[j * N + i], h10 = H[j * N + i + 1], h01 = H[(j + 1) * N + i], h11 = H[(j + 1) * N + i + 1];
    let dx: number, dz: number;
    if (u + v <= 1) { dx = (h10 - h00) / C; dz = (h01 - h00) / C; } else { dx = (h11 - h01) / C; dz = (h11 - h10) / C; }
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  }
  private near(x: number, z: number) {
    const i = clamp(Math.round((x - UG_RECT.x0) / UG_CELL), 0, this.nx - 1), j = clamp(Math.round((z - UG_RECT.z0) / UG_CELL), 0, this.nz - 1);
    this.ensure(i, j);
    return j * this.nx + i;
  }
  surfaceAt(x: number, z: number): number { return this.surface[this.near(x, z)]; }
  mudAt(x: number, z: number): number { return this.mud[this.near(x, z)]; }
  waterAt(x: number, z: number): number { return this.water[this.near(x, z)]; }
  ceilingAt(x: number, z: number): number { return this.ceiling[this.near(x, z)]; }

  /** The chamber a point is in (or whose tunnel it is in), or null outside the caverns. */
  chamberAt(x: number, z: number): UgChamber | null {
    if (!this.contains(x, z)) return null;
    const f = this.feature(x, z);
    return f.d < 2 ? this.chambers[f.chamber] : null;
  }
  chamberForChallenge(n: number): UgChamber { return this.chambers.find(c => c.challenge === n)!; }
  get entry(): UgChamber { return this.chambers[0]; }
  get final(): UgChamber { return this.chambers[this.chambers.length - 1]; }
  /** Point inside a chamber, at a fraction of its radius, `ang` radians from the direction of the next chamber. */
  pointIn(c: UgChamber, ang: number, rr: number): [number, number] {
    const next = this.chambers[c.index + 1], prev = this.chambers[c.index - 1];
    const base = next ? Math.atan2(next.z - c.z, next.x - c.x) : Math.atan2(c.z - prev.z, c.x - prev.x);
    return [c.x + Math.cos(base + ang) * c.r * rr, c.z + Math.sin(base + ang) * c.r * rr];
  }
  /** Heading (radians, 0 = +Z) from a chamber towards the next one (or away from the previous one). */
  headingOut(c: UgChamber): number {
    const t = this.tunnels.find(q => q.from === c.index);
    if (!t) { const p = this.chambers[c.index - 1]; return Math.atan2(c.x - p.x, c.z - p.z); }
    return Math.atan2(t.pts[3][0] - c.x, t.pts[3][1] - c.z);
  }
  /** Points along the way from chamber a to chamber b through its tunnel (centre line). */
  route(from: number, to: number): [number, number][] {
    const out: [number, number][] = [];
    for (let i = from; i < to; i++) { const t = this.tunnels[i]; out.push(...t.pts.slice(i === from ? 0 : 1)); }
    return out;
  }
}
