/** Things the player can use on foot. The client lists them every frame; the nearest one in front wins. */
export type InteractKind = 'vehicle' | 'npc' | 'fuel' | 'workshop';
export interface Interactable { id: string; kind: InteractKind; x: number; z: number; radius: number; label: string }

/**
 * Pick the best interactable for a character at (x, z) facing `heading` (0 = +Z).
 * Within reach, closer is better and things behind the character cost extra, so turning towards
 * something selects it.
 */
export function pickInteractable(x: number, z: number, heading: number, list: readonly Interactable[]): Interactable | null {
  let best: Interactable | null = null, bestScore = Infinity;
  const fx = Math.sin(heading), fz = Math.cos(heading);
  for (const it of list) {
    const dx = it.x - x, dz = it.z - z, d = Math.hypot(dx, dz);
    if (d > it.radius) continue;
    const facing = d > 1e-3 ? (dx * fx + dz * fz) / d : 1; // 1 = straight ahead, -1 = behind
    const score = d / it.radius + (1 - facing) * 0.35;
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}
