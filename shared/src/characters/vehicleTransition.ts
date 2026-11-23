import { Character, type MoveInput } from './character';

/** Where a character gets in: a point beside the driver's door and the vehicle's heading. */
export interface DoorPose { x: number; z: number; vehicleYaw: number }
export type TransitionPhase = 'approach' | 'climb-in' | 'climb-out' | 'done';
type Obstacles = Parameters<Character['update']>[2];

export const APPROACH_TIMEOUT = 2.5;  // s: if the walk to the door is blocked, the character steps there anyway
export const CLIMB_IN_TIME = 0.85;
export const CLIMB_OUT_TIME = 0.7;

/**
 * Enter/exit vehicle sequence. Entering: walk to the driver's door, turn to face the cab, climb in.
 * Exiting: climb out to the door. `progress` (0..1) drives the client's climb animation and the blend
 * between the door and the seat.
 */
export class VehicleTransition {
  phase: TransitionPhase;
  t = 0;
  constructor(readonly kind: 'enter' | 'exit') { this.phase = kind === 'enter' ? 'approach' : 'climb-out'; }

  get progress(): number {
    if (this.phase === 'climb-in') return Math.min(1, this.t / CLIMB_IN_TIME);
    if (this.phase === 'climb-out') return Math.min(1, this.t / CLIMB_OUT_TIME);
    return this.phase === 'done' ? 1 : 0;
  }
  get done() { return this.phase === 'done'; }

  /** Heading that faces into the cab from a door on the vehicle's +X side. */
  static faceCab(vehicleYaw: number) { return Math.atan2(-Math.cos(vehicleYaw), Math.sin(vehicleYaw)); }

  update(dt: number, ch: Character, door: DoorPose, obstacles: Obstacles): TransitionPhase {
    this.t += dt;
    if (this.phase === 'approach') {
      const dx = door.x - ch.pos.x, dz = door.z - ch.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.3 || this.t > APPROACH_TIMEOUT) {
        ch.place(door.x, door.z); ch.vel.set(0, 0, 0);
        this.phase = 'climb-in'; this.t = 0;
      } else {
        const inp: MoveInput = { forward: Math.min(1, d / 0.6), right: 0, sprint: false, jump: false, crouch: false, camYaw: Math.atan2(dx, dz) };
        ch.update(dt, inp, obstacles);
      }
    } else if (this.phase === 'climb-in' || this.phase === 'climb-out') {
      const target = VehicleTransition.faceCab(door.vehicleYaw) + (this.phase === 'climb-out' ? Math.PI : 0);
      let d = target - ch.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      ch.heading += d * Math.min(1, dt * 10);
      if (this.progress >= 1) this.phase = 'done';
    }
    return this.phase;
  }
}
