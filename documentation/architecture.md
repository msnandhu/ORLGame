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

## Island and world map (v0.7)

- **Island** (`shared/src/world/island.ts`) is authored in the pixel space of the reference world map (north up) and mapped into world metres, with Plain City on the detailed valley. The vertical axis is stretched by 1.3 because the reference is drawn in perspective.
- **Regions** are a power diagram of seed points per region, with borders warped by low-frequency noise. The coastline is the authored polygon plus fractal noise, read from a 160 m signed-distance grid. `tools/fit-island.ts` fits the overall scale (land = 1,170 km²) and the per-region weights (each region at its stated area) and prints `ISLAND_FIT`.
- **Elevation** (`landHeight`) blends a landform per region by soft region weights: farmland plains, ridged jungle hills, a hill massif with a cone peak, and snow mountains rising inland. Glacier Peak is a ridged cone pinned to 4,872 m. Lakes take a level just under their lowest shore. Rivers sample the land along their course, smooth it and take a running minimum, so the water never rises downstream. A drop steeper than 1 in 3 of 12 m or more becomes a waterfall. `heightAt` cuts the lakes and river channels in, and `waterAt` gives the water surface (sea, lake or river).
- **Places** carry kind, region, gang size and a `built` flag. A place that lands across a fitted border is walked into its region. Places off the road network get a winding trail to the nearest road.
- Everything is a pure function of position, so the client, the server, the map worker and the terrain workers all build the same island.
- **World map** (`client/src/ui/worldmap/`): `mapWorker.ts` renders shaded-relief imagery for any rectangle, coloured from region weights, land cover, snow line, water and coast. It also computes region outlines (marching squares), region statistics and a 250 m region grid. `WorldMap.ts` draws the imagery, a viewport-sized detail render when zoomed in, and the valley's own detailed map. On top it draws vector rivers, roads, outlines, places, labels, markers and the player. Markers and explored cells persist in `localStorage`.

## Streamed island (v0.8)

- **OuterWorld** (`shared/src/world/outer.ts`) turns the island into drivable ground outside the valley, in 128 m tiles of 2 m samples (the valley's own grid), generated on first use and kept in an LRU cache.
  - Every island road is graded once at start-up: a smoothed longitudinal profile, a grade limit per class (highway 9 %, road 13 %, trail 30 %), bridge decks 4 m above any water it crosses, and pins where it joins the valley.
  - `groundAt` pulls the land to every nearby road over a band that widens with the height difference, so roads run through passes and cuttings instead of over cliffs. Trails ford rivers no deeper than 0.4 m. Under a bridge the valley stays open, and only banks that rise above the deck are cut back.
  - Each sample gets a surface (grass, dirt, mud, rock, gravel, asphalt, plus the new **snow**, **sand** and **ice**) and a mud depth. Trees are scattered on a jittered 8 m grid by land cover.
  - `heightAt` is the max of the ground, bridge decks and frozen-lake ice. `waterAt` covers the sea (level 0), lakes and rivers; a frozen lake is ice, not water.
- **Terrain** (`shared/src/terrain/terrain.ts`) keeps the detailed 2.56 km valley and hands every query outside it to OuterWorld. The outer 240 m of the valley blends into the island's ground and the last 22 m meet it exactly (worst step 0.035 m). Four valley exits connect Highway 1 to the island highways and the south road; their carriageways are graded to meet the island road at the edge. Characters and vehicles are kept inside the island's bounds (with a sea margin) instead of the valley's.
- **Physics** reads the same tiles: vehicle wheels, characters, tree collisions and the server's below-ground check all go through `Terrain`, so the island is solid everywhere. The new surfaces have their own friction, rolling resistance and sinkage: snow μ 0.36, sand 0.6, ice 0.12, scaled per tyre type (road and performance tyres lose more on them).
- **IslandRenderer** (`client/src/world/island/`) draws the island as a quadtree of 65 × 65 nodes. The finest level is a 128 m node at 2 m spacing, exactly the physics tile; each level up doubles size and spacing, out to four 32.8 km roots. A node splits when the camera is within `islandDetail` node sizes of it, and only once all four children are built, so there are never holes. Nodes inside the valley are skipped (the valley renders itself), and along the valley edge nodes split down to 256 m so none crosses it.
  - Nodes are built by a pool of up to three workers (`islandWorker.ts`, falling back to the main thread), nearest and coarsest first. A node carries positions, normals, splat weights, snow and sand cover, a regional tint and a skirt. The two finest levels carry their trees, rendered as thin instances.
  - The terrain material is the valley's splat material with a second weight set (`splat2`): sand is the dirt layer bleached and warmed, snow fills the hollows first. Both GLSL and WGSL are provided.
- **IslandFeatures** adds the sea (one plane at level 0), lakes (frozen ones as ice), river ribbons with white water where they drop faster than 12 %, paved ribbons for island highways and roads, and bridges (deck underside, parapets, piers down to the bed).
- **Far view:** each preset sets the island's far clip (8 km low to 40 km ultra) and an exponential haze matched to the sky's horizon colour. The camera's near plane is 0.3 m (0.08 m in first person) to keep depth precision over that range.
- **Minimap and fast travel:** outside the valley the minimap shows 2 km of island imagery rendered by the map worker (re-rendered every 600 m). On the world map, T fast travels to the selected or newest marker in single player: it picks the nearest dry, level ground within 400 m and waits for the terrain there to stream in.

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
- The whole island is drivable, but the places on it (villages, gang bases, garages, labs, caves, the cable car and so on) are not built in 3D yet. That is stage 3. Only the valley around Plain City has buildings, traffic and NPCs.
- Island trees are drawn only within the two finest terrain levels (roughly 600–900 m), so distant forest reads as green ground rather than canopy. Island trees and bridge parapets are visual: trees collide like the valley's trees, but parapets do not stop a vehicle.
- There is no floating origin. At the far corners of the island (about 27 km out), 32-bit positions are good to about 2 mm, which is fine for driving, but the camera's depth precision is limited on WebGL, so distant shorelines can flicker.
- Generating island terrain is CPU work: a node takes about 50–60 ms in a worker. Fast travel and the first view at start-up wait for it, and driving very fast across the island can outrun the finest level for a moment (the coarser level is shown meanwhile).
- Multiplayer: the server validates positions anywhere on the island, but fast travel stays off online.
- The reference map gives the total area as 1,370 km², but its four regions add up to 1,170 km². The island uses 1,170 km².
- Region elevation ranges are measured, so they include coastline. For example, the Snow Region reads 2–4,872 m because its cliffs reach the sea, not 1,800–4,872 m as on the reference.
- Traffic is local to each client: in multiplayer every player sees their own traffic, and remote players' cars pass through it. Traffic cars are kinematic, so hitting one is like hitting a wall. It stops but is not pushed. They switch lanes instantly at junctions instead of following a turning arc, and there are no traffic lights.
- Fast travel is off in multiplayer (the server would reject the jump).
- Buildings are boxes with procedural facade textures and cannot be entered. Interiors, shops, garages and NPCs in town are not built yet.
- World generation takes about 8–9 s on this CPU (measured in Node; the valley blends into the island and every island road is graded at start-up), and the browser builds the road and building meshes and streams the first island view on top. Loading the game in headless SwiftShader took about 80 s.
- No PostgreSQL, Redis, accounts or authentication yet.
- Server validates movement plausibility but does not re-simulate vehicle physics. Damage is client-side only and is not synced to other players.
- Contacts with walls and rocks are soft penalty springs, so a nose can sink up to about 1 m into a wall in a 60 km/h crash before the car stops. This reads as crumple, but it is not a real crumple-zone model.
- There is no snow terrain yet. Snow mode works on any surface, but it was tuned against mud and grass.
- Dents move the existing body vertices. The procedural bodies are low-poly, so dents look like a pushed-in nose or corner, not fine creases.
- Unreal Engine and Unity cannot run in this cloud workspace and are not part of the browser stack; Blender is not used yet.
- Performance has only been measured with software rendering (SwiftShader) in a headless browser, not on real GPUs.
