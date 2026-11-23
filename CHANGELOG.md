# Changelog

## 0.5.0: Phase 3 character engine

- **Male and female characters, built from data.**
  - A `CharacterAppearance` holds body, height (1.52–1.95 m), build, skin tone, face shape, eye colour, hairstyle and colour, beard, top and colour, trousers, boots, gloves, headwear and accessories.
  - Every field is validated (`sanitizeAppearance`), so a hand-edited save or a hostile network message can only produce a valid look.
  - The model is rebuilt from that data: separate male and female body shapes, 4 face shapes, 8 hairstyles, 5 beard styles, 5 tops, 3 boots, 3 glove types, 5 headwear options, and a backpack, sunglasses, scarf and watch. Height scales the whole skeleton and stride length; build widens the torso and limbs.
- **Character creator.** Open it with Character on the main menu. The first New game opens it too. It has tabs for Body, Face & hair, Clothing and Gear, with live preview, drag-to-turn, Randomize, Default and Save. The look is stored in `orl.character.v1` and survives New game.
- **Animation.** Twelve procedural poses are blended with smoothed weights: idle (breathing), walk, run, sprint, crouch, crouch-walk, jump, fall, land, climb, seated and talk. Walk, run and sprint blend by speed. Feet are planted automatically, and soles stay level.
- **Controller.**
  - New locomotion states: idle, walk, run, sprint, crouch, crouch-walk, jump, fall and land.
  - Hold Alt to walk. A light stick tilt walks on a gamepad.
  - Sprinting to empty leaves you winded until stamina is back to 30%.
  - Hard landings cost a short recovery that scales with the fall.
- **Enter and exit vehicles.**
  - Pressing E walks you to the driver's door, turns you to the cab and climbs you in. A blocked path times out after 2.5 s and steps you to the door.
  - Exiting climbs out of the driver's door. If that side is in deep water, you jump out of a safe side instead.
  - The driver is visible in the seat and steers with the wheel. In both camp vehicles the figure is hidden in the cockpit camera.
- **Interaction.** E now picks the best thing in reach, preferring what you face: a vehicle or a person. The prompt says what E will do.
- **Camp mechanic NPC.**
  - Marta Kell walks a routine around the shed and stops to face you when you talk.
  - Her branching dialogue uses keys 1–5 or a click, and E or Esc ends it.
  - She can repair a vehicle in or near the shed (the same full repair as the workshop) and restock repair kits. She also explains the driving modes, diff lock and routes.
- **Multiplayer:** your look is sent when you join. The server decodes and re-encodes it, so other players see your character, seated in the vehicle when you drive.
- **Tests:** 19 new Phase 3 tests, plus a multiplayer test for appearance sync. They cover appearance round-trips and hostile input, every locomotion state, the enter and exit sequence including the blocked-path timeout, interaction picking, the NPC routine, and dialogue actions and diverts. The suite is 67 tests.

## 0.4.0: Phase 2 vehicle engine

- **Two vehicles, defined as data.**
  - Each `VehicleSpec` now carries an id, category, description, drivetrain, damage resistance, belly height and visual look.
  - `VEHICLES` and `vehicleStats()` give the garage figures, derived from the same numbers the simulation uses.
  - New: the **Bramble RC2**, a short open-top V8 rock crawler. It has 39" tyres, a 78:1 crawl ratio, 0.6 m of belly clearance and a 7 m turning circle (the Ranger's is 9 m).
  - Both vehicles park at camp. Walk up to either one and press E.
- **Six driving modes** on C: Normal, Sport, Off-road, Rock crawl, Snow and Mud.
  - Each mode sets the pedal map, engine and brake traction control, ABS, shift points, the pull-away gear (Snow uses 2nd), crawl control (Rock crawl), anti-roll, damping and steering rate.
  - Each mode also selects its transfer case and lockers.
  - The HUD shows the active mode and lights TC, ABS or CRAWL CONTROL when they intervene.
- **Collision damage.**
  - Hull impacts above 4 m/s damage six body regions. Front hits also damage the radiator and engine, and side hits damage the suspension.
  - Hard landings damage the suspension and tyres, and tyres can puncture.
  - Damage changes the driving: less power, a running-hot engine that cuts power and then stalls, sagging corners, steering pull, and a flat tyre that is smaller and loses grip.
  - The body panels dent where you hit. A damaged radiator steams and a failing engine smokes.
  - A HUD diagram shows the condition, plus engine temperature.
- **Repairs.** K uses a field repair kit (2 per trip). Pressing F in the camp shed (the workshop) restores everything and restocks the kits. "Return to base camp" now tows you there and keeps your damage, so the workshop is the fix.
- **Saves** store both vehicles, their condition and modes, and which one you were driving. Older saves still load.
- **Multiplayer** now syncs which vehicle each player drives, and the server checks the id against the catalog.
- **Fixed:** a fast vehicle could punch through the thin camp shed walls. Contacts now remember the face they entered by.
- **Tests:** 17 new Phase 2 tests cover the catalog, both vehicles, every mode, damage, repairs and thin walls, plus a vehicle-id validation test. The suite is 47 tests.

## 0.3.1 — WebGPU start-up hotfix

- Fixed: the game failed to start with "The plugin TerrainSplat can't be added to the material terrain" when the browser ran the WebGPU renderer. The terrain splat shader now has a WGSL version as well as GLSL.
- Saved settings from older builds had "Prefer WebGPU" switched on; they are reset once so WebGL2 is the default again (you can still opt in under Settings).
- If start-up fails on WebGPU for any reason, the game switches to WebGL2 and reloads once instead of stopping on an error screen.
- If the splat shader can't attach on some future backend, the terrain falls back to a plain textured material instead of crashing.

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
