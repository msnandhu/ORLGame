# OFF-ROAD LEGENDS: Phase 1 prototype

Browser off-road game prototype in TypeScript + Three.js (WebGL2). Phase 1 of the 7-phase spec: one terrain, one drivable vehicle, character movement, camera, basic HUD.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics + terrain tests (vitest)
npm run build      # static build in dist/ (any static host works)
```

## What is in Phase 1

| System | Status |
|---|---|
| Terrain | Redstone Valley, 1.024 km × 1.024 km heightfield (2 m grid): rolling hills, rocky massif + rim mountains, river with shallow trail fords, mud flats, rock-crawl ridge with ~220 boulders, ~3,000 trees, dirt trail network, base camp. Frustum-culled 128 m chunks. |
| Vehicle | Ranger TX4 (fictional 4x4). Custom rigid-body physics at 240 Hz: raycast suspension (spring, bump/rebound damping, bump stops, anti-roll), slip-ratio / slip-angle tyre model with friction circle, per-surface grip / rolling resistance / mud sinkage, torque curve, 6-speed auto or manual, low range, 2H / 4H / 4L, open vs locked axle diffs, brakes, handbrake, engine braking, rev limiter, aero drag, water buoyancy/drag, engine flooding, fuel use, hull collision with ground / boulders / trees / camp buildings, rollover + recovery. |
| Character | Walk, sprint (stamina), jump, crouch, slopes, wading, collision with trees, boulders, buildings and the vehicle; stand on boulders; procedural walk/run/jump/crouch animation. Enter/exit vehicle with safe exit-point search. |
| Camera | Third-person orbit (mouse / right stick), zoom, auto-recentre behind vehicle, chase / far / hood modes, terrain clamping, speed FOV. |
| HUD | Speedometer, tachometer, gear, AUTO/MANUAL, drive mode, diff lock, handbrake, flood warning, fuel, live wheel load/slip, compass, surface type, rotating minimap, full map (M), context prompts. |
| Menus | Start screen, pause (resume, recover, return to camp, graphics Low/Medium/High, mouse sensitivity, invert Y, volume, FPS), controls help. Settings persist in localStorage. |
| Audio | Procedural WebAudio engine note (RPM/throttle), tyre slip noise, water splash. No sample files. |

All models, textures and sounds are generated in code. No third-party art assets.

## Code layout

```
src/core      noise, input (keyboard / mouse / gamepad)
src/world     terrain data, surfaces, obstacles, raycast
src/physics   rigid body
src/vehicle   vehicle spec (data-driven, for Phase 2 upgrades) + simulation
src/player    character controller
src/render    terrain mesh, props, vehicle & character models, particles, camera
src/ui        HUD, styles
src/audio     engine audio
tests/        vitest physics and terrain tests
```

## Not in Phase 1 (planned per the spec)

Garage and modifications, damage model, economy, more vehicles, biomes, streaming of a large world, NPCs, story, missions, multiplayer, accounts and save games. Rendering is WebGL2 only (no WebGPU path yet).
