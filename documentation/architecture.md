# Architecture (v0.2.0, Phase 0)

## Packages

| Package | Role | Depends on |
|---|---|---|
| `@orl/shared` | Deterministic game rules: terrain generation and queries, vehicle and character simulation, constants, network message types and guards, event bus. No DOM, no renderer. | nothing |
| `@orl/client` | Babylon.js rendering, Havok props, input, camera, HUD/menus, audio, save, multiplayer client. | shared, @babylonjs/core, @babylonjs/materials, @babylonjs/havok, @colyseus/sdk |
| `@orl/server` | Colyseus rooms and server-side validation. Rebuilds the same terrain from the shared seed to check positions. | shared, @colyseus/core, @colyseus/schema, @colyseus/ws-transport |

`shared` is consumed as TypeScript source (Vite alias on the client, esbuild bundling on the server).

## Frame loop (client)

1. Input is polled once per rendered frame.
2. The simulation runs in fixed 1/240 s steps (accumulator, capped per frame): vehicle drivetrain and tyres, character controller.
3. Havok steps once per frame. The vehicle and player are kinematic proxies (`setTargetTransform`), so they push crates and barrels; Havok never drives the vehicle.
4. Views copy simulation state to Babylon nodes; the camera rig updates; terrain/prop LODs update from the camera position.
5. The network client sends the local transform at 20 Hz and renders remote players 100 ms in the past with interpolation.

## Coordinate frame

Right-handed, Y up, +Z forward for vehicles. The Babylon scene uses `useRightHandedSystem = true` so simulation values are used without conversion. The Havok heightfield expects `data[(N-1-z)*N + x]`.

## Rendering

`createEngine` tries `WebGPUEngine.IsSupportedAsync` and falls back to `Engine` (WebGL2). Quality presets live in `client/src/config/settings.ts` (`PRESETS`): resolution scale, shadow type and size, SSAO, bloom, FXAA, MSAA, fog, view distance, tree density, particle budget. Adaptive mode raises the render scale when frame rate drops below 45 fps and recovers above 58 fps.

## Networking and anti-cheat

Clients send `state` messages (`PlayerTransform`). The server (`server/src/validation/movement.ts`) rejects: non-finite values, unnormalised quaternions, positions outside the world, positions below the terrain, horizontal speed above the mode limit (foot 9 m/s, vehicle 55 m/s), vertical speed above 40 m/s, reported velocity that disagrees with displacement, and more than 30 messages per second. A rejected move sends a `correction` back to the last accepted position; more than 40 violations disconnects the client. Chat is sanitised and length-limited.

## Persistence

Phase 0 saves to browser `localStorage` (`orl.save.slot1`, `orl.settings.v2`). PostgreSQL (accounts, garages, economy) and Redis (sessions, presence, room routing) are specified but not implemented yet.

## Known limitations

- Art is placeholder geometry built from primitives; no Blender models yet.
- World is one 1 km² region with no streaming or floating origin; the spec's 500 km world needs both.
- No PostgreSQL, Redis, accounts or authentication yet.
- Server validates movement plausibility but does not re-simulate vehicle physics.
- Unreal Engine and Unity cannot run in this cloud workspace and are not part of the browser stack; Blender is not used yet.
- Performance has only been measured with software rendering (SwiftShader) in a headless browser, not on real GPUs.
