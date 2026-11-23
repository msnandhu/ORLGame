# Changelog

## 0.3.0 — Polish pass: graphics and feel (2026-11-23)

### Graphics
- Terrain: four procedural PBR layers (grass, dirt, rock, mud) blended per pixel by splat weights and texture height, two-scale sampling against tiling, tri-planar rock on steep slopes, macro colour variation and wet banks.
- Procedural sky dome with sun disc, atmospheric glow and drifting clouds; higher sun, rebalanced sun / ambient light and matched fog.
- Grass clumps (alpha-tested thin instances) streamed in 24 m cells around the camera, density per quality preset.
- New Ranger TX4 body built from extruded side profiles with wheel arches, flares, grille, winch, roof rack; lathe-modelled tyres and six-spoke rims.
- Five-tier pines and lumpy broadleaf trees; animated ripples on water; more detailed explorer character.

### Feel and fixes
- Automatic hold: with no pedal input at a standstill the brakes hold the vehicle (no idle creep or rolling back).
- Braked, stopped wheels use static tyre grip instead of a viscous low-speed model, so parked vehicles stay put on slopes.
- Fixed terrain triangle winding (ground was culled up close), sky clipped by the far plane, cockpit camera blocked by the cab, own body visible in on-foot first person.
- Multiplayer defaults to `wss://` when the page is served over HTTPS.
- Renderer defaults to WebGL2; WebGPU stays available as an option in Settings.
- `vercel.json` builds the client and serves `client/dist`; `vite build --mode single` makes a one-file build.
- New gameplay glitch-sweep tests (spawn settle, parked on slope, idle creep, acceleration, walking). 29 tests.

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
