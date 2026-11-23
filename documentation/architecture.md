# Architecture (v0.6.0)

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

## Vehicle engine (Phase 2)

All vehicle behaviour lives in `shared/src/vehicles` and runs at 240 Hz, identically in tests and in the browser.

- **Specs as data** (`spec.ts`, `catalog.ts`): every handling number is a `VehicleSpec` field. These include mass and inertia, hull, wheel positions, tyre size and stiffness, suspension rates and travel, steering lock, torque curve, rev range, gear ratios, final drive and low range. The spec also holds brakes, drag, grip, intake height, fuel, damage resistance, belly height and the visual look. `VEHICLES` lists the drivable vehicles. `vehicleStats()` derives the garage figures from the same numbers the sim uses: power, torque, top speed, ground clearance, wheelbase, crawl ratio and power-to-weight. Adding a vehicle means adding data, not code. The two vehicles are the Ranger TX4 (diesel expedition wagon) and the Bramble RC2 (short V8 rock crawler).
- **Chassis**: raycast suspension per wheel with spring, bump/rebound damping, bump stops and anti-roll. The rigid body carries the weight transfer, and rollover comes from the same body.
- **Tyres**: slip ratio and slip angle with a friction circle. Grip depends on the surface (grass, dirt, mud, rock, gravel), water and tyre wear.
- **Drivetrain**: Ackermann steering, a torque curve, a clutch model, an automatic or manual gearbox, 2H/4H/4L, open diffs with lockers, brakes and a handbrake.
- **Driving modes** (`modes.ts`): Normal, Sport, Off-road, Rock crawl, Snow and Mud. Each mode is a profile that sets:
  - the pedal map;
  - engine traction control (slip target);
  - brake traction control (brakes a spinning wheel so an open diff drives the other);
  - ABS;
  - the shift-point bias and the pull-away gear;
  - crawl control (holds about 9 km/h on full throttle);
  - anti-roll, damping and steering-rate multipliers;
  - the transfer case and lockers it selects.

  Modes never add grip.
- **Damage** (`damage.ts`): condition is wear from 0 to 1 for the engine, the radiator, six body regions, four suspension corners and four tyres.
  - What causes damage:
    - Hull contacts closing faster than 4 m/s, scaled by the spec's `damageResistance`. Several points striking the same wall count once.
    - Front hits, which also damage the radiator and the engine.
    - Side hits, which bend the nearer suspension.
    - Bump-stop strikes faster than 3 m/s, which damage the suspension and the tyre. Rock hurts tyres more.
  - What damage does:
    - Engine wear cuts power, and a destroyed engine won't run.
    - A damaged radiator lets the engine temperature climb under load. Power is cut from about 112 °C and the engine stalls at 125 °C, then restarts below 100 °C.
    - Damaged corners sag, wallow and pull the steering.
    - A punctured tyre runs 7 cm smaller with 60% grip.
  - Repairs: a repair kit is a field fix (2 per trip). The workshop at the camp shed does a full repair and restocks the kits.
  - `Vehicle.onImpact` reports each hit, and the client dents the body panels there (vertex deformation).
- **Collisions with buildings**: each hull point remembers which face of a box it entered through (`BoxContactMemory`). This stops a fast car from punching through the 30 cm shed walls.

## Character engine (Phase 3)

| Module | Role |
|---|---|
| `shared/characters/appearance.ts` | `CharacterAppearance` data, option lists and palettes, `sanitizeAppearance`, a 19-character network code (`encodeAppearance` / `decodeAppearance`), `randomAppearance`, `statureOf`. |
| `shared/characters/character.ts` | Kinematic controller over the heightfield. It handles collision with trees, boulders, buildings and vehicles, plus stamina with exhaustion, landing recovery and `LocomotionState`. Stride scales with stature. |
| `shared/characters/vehicleTransition.ts` | Enter and exit sequence: approach the door (with a 2.5 s timeout), face the cab, climb in or out. `progress` drives the client animation. |
| `shared/gameplay/interaction.ts` | `pickInteractable`: the nearest thing in reach, with a penalty for things behind you. |
| `shared/npc/npc.ts` | `Npc` (same controller as the player, waypoint routine, skips blocked waypoints, faces the speaker), dialogue graph + `validateDialogue`, `DialogueSession` with game actions that can divert, `CAMP_MECHANIC`. |
| `client/characters/CharacterView.ts` | Builds the figure from an appearance under a skeleton of transform nodes (hips, spine, neck, shoulders, elbows, thighs, knees, ankles) scaled to stature. Animation blends 12 named poses with exponentially smoothed weights, then plants the lower foot and levels the soles. `attach()` parents the figure to a vehicle for the seated and climbing poses. |
| `client/ui/CharacterCreator.ts`, `client/save/CharacterStore.ts` | Creator panel (live preview through `onChange`) and the stored look. |

The vehicle spec's `look.seat` gives the driver's hip point. The door used for entering is level with it, 0.45 m outside the hull.

## World: roads, settlements and traffic (v0.6)

- **Layout** (`shared/src/world/layout.ts`) is data. It holds three settlements (centre, extent, street grid), road definitions (control points, class, closed or open) and the road classes: width, lanes, lane width, speed limit, embankment and maximum grade. Link roads are snapped onto the highway spline when the module loads. `planSettlements(seed)` fills the blocks between streets with buildings (kind, footprint, height, roof). It also reserves a fuel-station block and a car-park block, and returns pumps and parking spots. Everything is deterministic from the seed, so the server builds the same town.
- **Terrain** (`shared/src/terrain/terrain.ts`) builds a road-edge distance field first. That field opens passes through the mountains and keeps mud, rivers and scatter off the roads. Settlement plateaus are levelled to the average height of their footprint and blended out over 120 m.
- **Grading** (`gradeRoads`) runs after the trails: highway first, then roads, then streets. Each road gets a smoothed longitudinal profile, limited to its class grade going forwards and backwards. Open ends, and points on a carriageway graded earlier, are pinned, so junctions meet level. Graded carriageways are locked so lesser roads can't reshape them. The land is blended in with shoulders and embankments.
- **Surfaces:** Asphalt on carriageways, fuel forecourts and car parks; Gravel on the shoulders; Grass inside settlements.
- **Colliders:** buildings and pumps go in `Terrain.boxes`, indexed on a 32 m grid (`boxesNear`). Traffic cars near the player go in `Terrain.dynamicBoxes` every frame. Vehicles and characters collide with both.
- **Road cars** are ordinary `VehicleSpec`s with a drivetrain (fwd, rwd or awd), tyre compound, LSD, downforce, optional speed limiter and allowed modes. The vehicle simulation distributes torque by drivetrain, couples AWD axles through a viscous centre and applies downforce along the body's up axis. `TYRE_GRIP` scales friction per compound and surface.
- **Traffic** (`shared/src/world/traffic.ts`) is kinematic and runs on the shared road data. Each car keeps a lane and an arc length. It uses the Intelligent Driver Model for following, curve speed from a lateral-acceleration limit, and junction and road-end speed limits. At junctions (crossings and side roads, found from the road geometry) a car may turn, and at road ends it takes a linked road. A cone check yields to obstacles and crossing cars, a stand-off breaker clears junction deadlocks, and `bump()` stops a car that was hit. Traffic is simulated on each client and is not synchronised in multiplayer.
- **Rendering** (`client/src/world/`):
  - `RoadRenderer` drapes ribbons on the graded ground. Lesser roads stop where a higher-class carriageway covers them. It also draws per-class marking textures, junction squares, sidewalks with curbs and thin-instanced lamps.
  - `BuildingRenderer` batches all walls of one facade style into one mesh, tinted with vertex colours. Roofs are flat with a parapet or gabled, and it also draws the fuel canopies and parking bays.
  - `TrafficRenderer` keeps a small pool of merged, lite car models and assigns them to the nearest cars.
  - `TerrainRenderer` keeps the coarse LOD for every chunk and streams full-detail chunks near the camera.

## Coordinate frame

Right-handed, Y up, +Z forward for vehicles. The Babylon scene uses `useRightHandedSystem = true` so simulation values are used without conversion. The Havok heightfield expects `data[(N-1-z)*N + x]`.

## Rendering

`createEngine` tries `WebGPUEngine.IsSupportedAsync` and falls back to `Engine` (WebGL2). Quality presets live in `client/src/config/settings.ts` (`PRESETS`): resolution scale, shadow type and size, SSAO, bloom, FXAA, MSAA, fog, view distance, tree density, particle budget. Adaptive mode raises the render scale when frame rate drops below 45 fps and recovers above 58 fps.

## Networking and anti-cheat

Clients send `state` messages (`PlayerTransform`). The server (`server/src/validation/movement.ts`) rejects: non-finite values, unnormalised quaternions, positions outside the world, positions below the terrain, horizontal speed above the mode limit (foot 9 m/s, vehicle 100 m/s), vertical speed above 40 m/s, reported velocity that disagrees with displacement, and more than 30 messages per second. A rejected move sends a `correction` back to the last accepted position; more than 40 violations disconnects the client. Chat is sanitised and length-limited. A player's look arrives as a join option and is decoded and re-encoded by the server before it reaches the shared state.

## Persistence

Saves go to browser `localStorage` (`orl.save.slot1`, `orl.settings.v2`, and the character in `orl.character.v1`). From v0.4 a save holds every camp vehicle with its position, fuel, modes and condition, plus which one you were driving and your repair kits. Older saves still load. PostgreSQL (accounts, garages, economy) and Redis (sessions, presence, room routing) are specified but not implemented yet.

## Known limitations

- Art is placeholder geometry built from primitives; no Blender models yet. Characters are primitive-built figures with procedural (code) animation, not skinned meshes with motion-captured clips.
- Remote players' animation is inferred from their motion: crouching and landing recovery are not sent over the network.
- Hands do not grip the steering wheel exactly (the seated pose approximates it). Climbing in passes through the door rather than opening it, because the doors are not separate parts.
- Only one NPC (the camp mechanic) exists. Garage and mission interactions arrive with Phase 4 (garage) and Phase 5 (missions); the interaction system and dialogue actions are where they plug in.
- The world is one 2.56 km region. Full-detail terrain is streamed around the camera, but the heightfield, colliders and coarse terrain for the whole region are built at load. There is no floating origin. The spec's 500 km world needs world-chunk streaming of the data itself.
- Traffic is local to each client: in multiplayer every player sees their own traffic, and remote players' cars pass through it. Traffic cars are kinematic, so hitting one is like hitting a wall. It stops but is not pushed. They switch lanes instantly at junctions instead of following a turning arc, and there are no traffic lights.
- Fast travel is off in multiplayer (the server would reject the jump).
- Buildings are boxes with procedural facade textures and cannot be entered. Interiors, shops, garages and NPCs in town are not built yet.
- World generation takes about 5–6 s on a desktop CPU (measured in Node), and the browser builds the road and building meshes on top. Loading the game in headless SwiftShader took about 56 s.
- No PostgreSQL, Redis, accounts or authentication yet.
- Server validates movement plausibility but does not re-simulate vehicle physics. Damage is client-side only and is not synced to other players.
- Contacts with walls and rocks are soft penalty springs, so a nose can sink up to about 1 m into a wall in a 60 km/h crash before the car stops. This reads as crumple, but it is not a real crumple-zone model.
- There is no snow terrain yet. Snow mode works on any surface, but it was tuned against mud and grass.
- Dents move the existing body vertices. The procedural bodies are low-poly, so dents look like a pushed-in nose or corner, not fine creases.
- Unreal Engine and Unity cannot run in this cloud workspace and are not part of the browser stack; Blender is not used yet.
- Performance has only been measured with software rendering (SwiftShader) in a headless browser, not on real GPUs.
