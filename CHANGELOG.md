# Changelog

## 0.9.0: Cars inspired by real-world cars

Every vehicle has a new model: smooth, curved body panels built the way real car bodies are surfaced (rounded shoulders, tumblehome, tapered noses and tails, true wheel-arch openings) instead of flat-sided boxes. All names and designs are original, with no real makes' badges, logos or signature grilles.

- **Ranger TX4** is a long-wheelbase expedition wagon in the classic Japanese/British 4x4 school: upright glasshouse, round lamps in square bezels, slatted grille, black arch flares, bull bar, winch, snorkel, roof rack and a ladder on the rear door.
- **Bramble RC2** is a short two-door open-top trail crawler: round lamps either side of a bar grille, flat tube fenders over 37-inch tyres, half doors with hinges, roll cage, light bar and a tailgate spare.
- **Vanta GT** is a GT3-class race coupe: wide haunches, splitter, bonnet louvres, side exit vents, swan-neck twin-element wing, diffuser and centre-lock wheels.
- **Strix R2** is a three-door rally hot hatch: bonnet scoop, mesh grille, fog lamps, roof spoiler, mud flaps and gold multi-spoke wheels.
- **Pella 1.4** is a European five-door hatchback, **Corvan 2.0** a mid-size family saloon with chrome window line, **Halcyon Grand** a flagship luxury saloon with an upright chrome grille and full-width light bar, and **Solenne GT** a long-bonnet V12 grand tourer with a fastback, side strakes and quad exhausts.
- **Real glass and pillars.** Tinted, reflective glass between painted A/B/C pillars, a roof, headliner and a proper cabin (seats, dash, console, screen, steering wheel) you can see through the windows.
- **Lamps and lighting.** Headlamps with chrome reflectors and lenses, LED daytime running lights, tail lamps that glow brighter with the headlights on and flare when braking, and reversing lamps that light in reverse.
- **Paint and materials.** Metallic and solid clear-coat paints, chrome, gloss black, carbon fibre, textured trim, mesh grilles and number plates.
- **Wheels.** Rim barrels with polished lips and per-car spoke designs (five twin-spoke, multi-spoke, split-spoke, mesh, turbine, steel and beadlock), lug or centre-lock nuts, brake discs that turn with the wheel and coloured calipers that do not.
- AI traffic uses the same models in a lighter version. Parts are merged by material, so a car costs a handful of draw calls.
- **Showroom page** (`showroom.html`) shows every car on a turntable under the game's sky.
- Physics, handling and collision shapes are unchanged.

## 0.8.2: World map fix and more graphics

- **World map fixed.** The *World map* button on the main menu did nothing (the map only opened once a game had started), and the map was not drawn there. It now opens from the main menu, from a new *World map* button in the pause menu and with M in game; Esc or M closes it.
- **Works where background workers are blocked.** Some embedded pages forbid web workers. The map and the island terrain now fall back to rendering on the main thread (a bit slower to fill in) instead of staying blank.
- **Grass across the whole island,** not just the valley: clumps grow on grassy, gentle, dry ground everywhere, never on roads, trails, snow or sand.
- **Island trees cast shadows** near you.
- Map buttons fit on one row on smaller screens.

## 0.8.1: Island graphics pass

- **Forests read as forests from afar.** Beyond the range where real trees are drawn, woodland is coloured as canopy (dark jungle green in the Deep Forest, blue-green pine in the hills and snow, mixed woods on the plains), so distant forest no longer looks like bare grass.
- **Farmland.** The Plain Region is a patchwork of fields (wheat, pasture, ploughed soil, meadow) on a slightly rotated grid with darker hedgerows along the edges. It fades out near the valley so the valley's own look is unchanged. Fields are colour only: the ground underneath still drives as grass.
- **Better island trees.** The nearest trees have five-tier pines, fuller broadleaf crowns and tall-stemmed jungle trees with broad, flat crowns. A lighter set is used one level further out.
- **Snow, sand and rock.** Snow now meets grass in broad, natural drifts instead of a cell pattern. Beach sand is pale and warm instead of orange. Rock has finer, softer cracks, so cliffs no longer show a large cell pattern.

## 0.8.0: The whole island is drivable (stage 2 of the four-region world)

- **Drive anywhere on the 1,170 km² island.** Leave the valley by any of its four exits (north, west and east onto the island highways, south onto the coast road) and keep going: to the snowfields and Glacier Peak in the north, the Deep Forest in the west, the Hill Region in the east and the farmland and beaches of the Plain Region in the south.
  - The ground outside the valley is generated in 128 m tiles at the same 2 m detail as the valley, from the same island data the world map uses. Physics and graphics read the same tiles, so what you see is what you drive on.
  - **New surfaces:** snow (μ 0.36), ice on the frozen lake (μ 0.12) and beach sand (μ 0.6, soft), each with its own rolling resistance and sinkage, plus grass, dirt, mud, rock and gravel as before. The Snow driving mode now has real snow to drive on.
  - **Water:** the sea all round the island, four lakes (the frozen one is solid ice you can drive on), three rivers with white water where they fall, and fords where trails cross them (no deeper than 0.4 m).
  - **Roads:** 13 island highways and roads are graded to their class (highways at most 9 %, roads 13 %) and cut passes through the hills, with **bridges** (deck, parapets and piers) where they cross water. 17 trails reach the remote places.
- **Graphics:** the island streams in around you in levels of detail, from 2 m near you to coarse terrain out to the far coast (8 km on Low, 25 km on High, 40 km on Ultra), built by background workers so driving stays smooth. Snow and sand blend into the terrain texture, each region has its own colour (lush jungle, golden plains, cool snowfields), trees by region (jungle, broadleaf, pine), and the haze now fades distant ridges into the sky.
- **Minimap** shows the island around you once you are outside the valley.
- **Fast travel to a marker:** on the world map, press **T** (or *Travel to Marker*) to go to the selected or newest marker, in your vehicle if you are driving. It lands on the nearest dry, level ground and waits for the terrain to load. Single player only.

**What is playable now and what is planned.** All of the island's ground, water and roads are playable. The 53 places on the map (villages, gang bases, garages, labs, caves, the cable car and so on) are marked, and their sites are clear of trees, but they are not built in 3D yet. That is stage 3. Traffic, buildings and NPCs are still only in the valley around Plain City.

## 0.7.0: The island and its world map (stage 1 of the four-region world)

- **The island.** The world is now laid out as an island of **1,170 km²** after your reference maps: the **Snow Region** in the north (280 km², LV 20–40), the **Deep Forest Region** in the west (320 km², LV 15–35), the **Hill Region** in the east (120 km², LV 10–20) and the **Plain Region** in the south (450 km², LV 1–20).
  - Region areas are real: the coastline scale and the region borders are fitted so that sampling the island every 220 m gives each region within 0.3% of its stated area (`tools/fit-island.ts`). A test checks this every run.
  - The island has its own elevation model: farmland plains at 10–60 m, rolling jungle hills, a hill massif with a snow cap, and the snow mountains. **Glacier Peak** is exactly 4,872 m. Three rivers flow downhill to the sea (they never run uphill), with waterfalls where they drop steeply, and four lakes (one frozen).
  - **53 places** from your maps are placed in their regions: four gang bases (with their member counts), villages, the city hub, garages, fuel, race tracks and challenges, explorer camp, lookouts, labs, caves, the region gate, cable car station, rescue outpost, ruins, wildlife zone and more. Highways, regional roads and off-road trails connect them, so every place can be reached.
  - **Plain City** (formerly Halden City) is the Main City Hub. The detailed 2.56 km valley with base camp, Millbrook and Ashby Hollow sits in the middle of the Plain Region.
- **World map** (M, or Map in the pause menu). It replaces the old square map.
  - Whole-island view and a view for each region (tabs or keys 0–4), with region outlines that glow in each region's colour.
  - Zoom with the mouse wheel or + / −, and drag to pan. Double-click zooms in. The terrain image is rendered in a background worker from the same elevation and water functions as the world, and sharpens when you zoom in. Inside the detailed valley it shows every street and building.
  - **Markers:** click to set one (up to 9) and right-click or Delete to remove one. The newest marker is your waypoint: the HUD shows its distance and direction under the compass, and the minimap shows it (pinned to the rim when it is out of range).
  - Region details (R): area and elevation range (both measured from the terrain), terrain type, habitat, difficulty, recommended level and key locations counted from the places on the map. Legend (L), world inset with the current view, compass and scale bar.
  - **Exploration progress** is real: the island is divided into 250 m cells, and the cells you pass within 300 m of are marked explored and saved in the browser.
  - Hovering over a place shows its name, kind, region, distance and whether it is built. Places that are not built in 3D yet are drawn with a dashed ring.

**What is playable now and what is planned.** You can drive in the 2.56 km valley around Plain City, as before. The rest of the island is mapped, with real terrain data, places and roads, but it is not yet streamed into the 3D world. That is stage 2 (streamed terrain for the whole island, drivable everywhere). Stage 3 builds the places themselves.

## 0.6.0: Towns, highways and road cars

- **A bigger world.** The map grows from 1 km to 2.56 km across (6.6 km²). The off-road valley, trails and rock-crawl ridge stay in the middle. Farmland plains open up beyond the valley ring, and the mountains now ring the outer edge with passes where the roads go through.
- **Three settlements, each on its own levelled plateau.**
  - **Halden City** (east): a 7 × 7 street grid with glass towers downtown, then offices and apartment blocks further out.
  - **Millbrook** (north-west): a 5 × 5 grid of shops with flats above, plus apartment blocks.
  - **Ashby Hollow** (south-west): a village of gabled houses and a barn.
  - Each has a fuel station (two pumps under a canopy, plus a shop) and a car park.
  - All 179 buildings are solid. Vehicles and people collide with them, and they are placed clear of every road and sidewalk.
- **Roads.**
  - **Highway 1** is a 7.2 km, four-lane loop around the world, with link roads to each settlement.
  - Three valley roads run from base camp to the city, the town and the village.
  - Every road is graded into the terrain with a smoothed profile and a class grade limit (highway 6%, road 9%, street 10%), plus embankments and cuttings. Junctions meet level.
  - Roads have their own Asphalt surface with a gravel shoulder, painted markings per class, plain junction squares where streets cross, raised sidewalks with curbs, and 252 street lamps.
- **Six road cars, all data-driven and drivable**, next to the two off-roaders:

  | Car | Class | Body | Drive | 0–100 km/h (measured) |
  |---|---|---|---|---|
  | Vanta GT | racing | coupe | RWD | 4.4 s |
  | Strix R2 | racing | hot hatch | AWD | 4.2 s |
  | Pella 1.4 | common | hatch | FWD | 12.5 s |
  | Corvan 2.0 | common | saloon | FWD | 10.5 s |
  | Halcyon Grand | luxury | saloon | AWD | 4.2 s (limited to 250 km/h) |
  | Solenne GT | luxury | coupe | RWD | 4.7 s |

  - The drivetrain is real in the simulation. FWD drives the front wheels, RWD the rear, and AWD both through a viscous centre coupling. Limited-slip differentials are set per car.
  - Racing cars get aerodynamic downforce. Tyre compounds (all-terrain, road, performance) change grip by surface: performance tyres grip hardest on asphalt and worst in mud.
  - Road cars have Normal, Sport and Snow modes. G and L tell you they have no transfer case or lockers, and the HUD shows FWD, RWD or AWD.
  - The bodies are new original procedural models. Proportions come from each spec, the cabin is open so the driver shows, and the cockpit camera sits at the driver's eye. Racing cars have stripes, a splitter and a wing; luxury cars have chrome trim.
- **AI traffic.**
  - 70 cars drive the network on their lane: IDM car-following, slowing for curves and junctions, and turning at crossings, highway exits and road ends.
  - They give way to you, your vehicles and pedestrians in their path. They collide with you as solid boxes and stop for a few seconds when hit.
  - The nearest cars within about 400 m are drawn with a pool of 12 simplified models. Each model is merged into one body mesh and four wheel meshes.
- **Gameplay.**
  - Road cars are parked in the car parks: racing and luxury in Halden City, everyday cars in Millbrook and Ashby Hollow.
  - Refuel at any pump.
  - "Tow vehicle home" takes a car back to its own bay or car park.
  - **Fast travel** (pause menu, single player only) goes to camp, Halden City, Millbrook or Ashby Hollow.
  - Parked vehicles far from you sleep until something comes near.
- **Map and minimap.** Both show roads (the highway in gold), buildings, every fuel pump and the settlement names.
- **Streaming.** Full-detail terrain chunks are built around the camera (a few per frame) and dropped when far away. The coarse level covers the whole map.
- **Tests:** 12 new world tests. They cover flat plateaus, road grades and paving, network connectivity, buildings off the roads with colliders, pumps and car parks, the car catalogue, acceleration by class, FWD/RWD/AWD torque split, no off-road modes on road cars, tyre grip by surface, a two-minute traffic run (no NaN, lanes keep their gaps), and traffic stopping for a pedestrian and when hit. Existing tests were updated for the bigger map. The suite is 79 tests.

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
