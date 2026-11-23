# Changelog

## 0.2.0 — Phase 0 technical foundation (2026-11-23)

### Architecture
- Split into npm workspaces: `shared` (simulation), `client` (Babylon.js), `server` (Colyseus).
- Shared simulation no longer depends on a renderer: own `Vec3`/`Quat` math. Physics results are identical to 0.1.0 (braking 7.9 m/s², trail drive reaches the same waypoint).
- Strict TypeScript across all packages, path alias `@orl/shared`, single `npm run typecheck`.

### Client (renderer moved from Three.js to Babylon.js 9.35)
- WebGPU engine with automatic WebGL2 fallback; renderer preference in Settings.
- Right-handed scene matching the simulation frame; PBR materials, procedural sky, cascaded shadows, SSAO (ultra), bloom, FXAA/MSAA, ACES tone mapping, fog.
- Terrain in 64-cell chunks with two LODs and skirts; trees/rocks as per-chunk thin instances with LOD and distance culling.
- Quality presets Low/Medium/High/Ultra plus adaptive resolution scaling.
- Camera rig: chase, far, hood, cockpit (driver seat), on-foot first person, free camera.
- Asset manager with weighted loading progress; structured logger; global error handler with a fatal-error screen.
- Main menu (continue, new game, multiplayer, map, settings), pause menu (resume, save, recover, return to camp, settings, help, quit), local save game (F5 or pause menu).

### Physics
- Havok (1.3.14) world: static heightfield + boulders/trees/buildings, dynamic crates and barrels, kinematic proxies so the vehicle and player push props. The vehicle itself still runs the custom 240 Hz drivetrain/tyre model.

### Server
- Colyseus 0.18 `free_roam` room, 20 Hz patches, up to 16 players.
- Server-authoritative validation: speed, vertical speed, world bounds, below-ground, quaternion and reported-speed checks, message rate limit, chat sanitising, position corrections, kick after repeated violations.
- Client interpolation buffer (100 ms) for remote players.

### Tests
- 24 tests: vehicle physics, math, movement validation, trail drive, Havok world (NullEngine), multiplayer over a real WebSocket.

## 0.1.0 — Phase 1 prototype (2026-11-23)
- Three.js prototype: Redstone Valley terrain, Ranger TX4 with custom suspension/tyre physics, character, HUD.
