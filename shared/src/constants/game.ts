/** Values both client and server must agree on. */
export const GAME_VERSION = '0.6.0';
export const WORLD_SEED = 20261123;
export const PHYSICS_HZ = 240;
export const NETWORK_TICK_HZ = 20;
/** Plausibility limits used by server-side validation (generous headroom over the simulation's real maxima). */
export const LIMITS = {
  maxFootSpeed: 9,          // m/s (sprint is 7.5)
  maxVehicleSpeed: 100,     // m/s (360 km/h; the fastest road car tops out near 330 km/h)
  maxVerticalSpeed: 40,     // m/s (falls)
  maxStateRateHz: 30,       // client state messages per second
} as const;
export const ROOM_NAME = 'free_roam';
export const MAX_PLAYERS_PER_ROOM = 16;
