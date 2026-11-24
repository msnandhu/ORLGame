import type { OuterWorld } from '../world/outer';
import type { StaticBox } from '../terrain/terrain';

/**
 * Story places built on the island: the four gang compounds and the underground entrance. Each is placed on the
 * nearest flat, dry ground beside its map place (off the carriageway), so the same placement comes out on every
 * client and on the server. The walls, sheds and towers are colliders like the towns' buildings.
 */
export interface CompoundPart { kind: 'wall' | 'shed' | 'container' | 'tower' | 'pole' | 'pillar' | 'lintel' | 'barrier'; x: number; z: number; y: number; w: number; h: number; d: number; yaw: number; color: number }
export interface Compound {
  id: string; poi: string;
  /** gang number 1..4, or 0 for the underground entrance */
  gang: number;
  x: number; z: number; y: number;
  /** direction the entrance faces (radians, 0 = +Z) */
  heading: number;
  parts: CompoundPart[];
  boxes: StaticBox[];
  /** parking spots inside (x, z, heading) for the gang's vehicles */
  parking: [number, number, number][];
  /** where guards stand */
  posts: [number, number][];
}

export const COMPOUND_SITES: { id: string; poi: string; gang: number }[] = [
  { id: 'gang1-hq', poi: 'gang-1', gang: 1 },
  { id: 'gang2-hq', poi: 'gang-camp', gang: 2 },
  { id: 'gang3-hq', poi: 'gang-3', gang: 3 },
  { id: 'gang4-hq', poi: 'gang-4', gang: 4 },
  { id: 'ug-entrance', poi: 'underground', gang: 0 },
];

export function buildCompounds(O: OuterWorld): Compound[] {
  const out: Compound[] = [];
  for (const s of COMPOUND_SITES) {
    const pad = O.pads.find(p => p.poi === s.poi);
    if (!pad) continue;
    const cx = pad.x, cz = pad.z, cy = pad.y, heading = pad.heading;
    const c: Compound = { id: s.id, poi: s.poi, gang: s.gang, x: cx, z: cz, y: cy, heading, parts: [], boxes: [], parking: [], posts: [] };
    const ch = Math.cos(heading), sh = Math.sin(heading);
    /** local (right, forward) → world; forward = towards the entrance */
    const W = (lx: number, lz: number): [number, number] => [cx + lx * ch + lz * sh, cz - lx * sh + lz * ch];
    const part = (kind: CompoundPart['kind'], lx: number, lz: number, w: number, h: number, d: number, yawOff = 0, color = 0, solid = true) => {
      const [x, z] = W(lx, lz), y = O.heightAt(x, z);
      c.parts.push({ kind, x, z, y, w, h, d, yaw: heading + yawOff, color });
      // colliders reach a metre below the ground so a slope never leaves a gap under them
      if (solid) c.boxes.push({ kind: `compound-${kind}`, cx: x, cy: y + h / 2 - 0.5, cz: z, hx: w / 2, hy: h / 2 + 0.5, hz: d / 2, yaw: heading + yawOff });
    };
    if (s.gang) {
      const R = 24, gap = 7;
      // perimeter: three solid sides, the front split around the gate
      for (let k = -R + 4; k <= R - 4; k += 8) { part('wall', -R, k, 0.6, 3.2, 8.2); part('wall', R, k, 0.6, 3.2, 8.2); part('wall', k, -R, 8.2, 3.2, 0.6); }
      for (let k = -R + 4; k <= R - 4; k += 8) if (Math.abs(k) > gap) part('wall', k, R, 8.2, 3.2, 0.6);
      part('barrier', 0, R + 3, 1, 1.1, 1, 0, 1, false);
      part('shed', -14, -15, 14, 5, 9, 0, s.gang);
      part('container', 15, -16, 2.5, 2.6, 6.1, 0, s.gang);
      part('container', 15, -9, 2.5, 2.6, 6.1, 0, 2);
      part('tower', -19, 18, 3, 9, 3, 0, s.gang);
      part('pole', 6, -6, 0.2, 10, 0.2, 0, s.gang, false);
      for (let k = 0; k < 4; k++) { const [x, z] = W(-12 + k * 7, 6); c.parking.push([x, z, heading + Math.PI]); }
      for (const [lx, lz] of [[-5, R + 4], [5, R + 4], [-19, 14], [10, -4], [0, -10]] as const) c.posts.push(W(lx, lz));
    } else {
      // the underground entrance: a rock-cut portal with a steel frame
      part('pillar', -9, 0, 4, 12, 5); part('pillar', 9, 0, 4, 12, 5);
      part('lintel', 0, 0, 22, 3, 5.5, 0, 0, false);
      const [x, z] = W(0, 0); c.parts[c.parts.length - 1].y = O.heightAt(x, z) + 10;
      for (const [lx, lz] of [[-5, 10], [5, 10]] as const) c.posts.push(W(lx, lz));
    }
    out.push(c);
  }
  return out;
}
