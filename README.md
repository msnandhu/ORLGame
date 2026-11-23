# OFF-ROAD LEGENDS

Browser open-world multiplayer off-road game. **Current version: v0.6.0, towns, highways and road cars.** The world is now 2.56 km across. It has a city, a town and a village with solid buildings, a four-lane highway loop with link roads, six drivable road cars (racing, common and luxury) and AI traffic. Phase 3 (v0.5) added the character engine, and Phase 2 (v0.4) the data-driven off-road vehicles, driving modes and damage.

Stack: TypeScript (strict) · Babylon.js 9 (WebGPU, falling back to WebGL2) · Havok physics + custom 240 Hz drivetrain/tyre simulation · Colyseus 0.18 server-authoritative multiplayer · Vite · Vitest.

## Install and run

Requires Node.js 20+.

```bash
npm install
npm run dev            # client at http://localhost:5173
npm run dev:server     # multiplayer server at ws://localhost:2567 (optional)
npm test               # unit, gameplay, Havok and multiplayer integration tests
npm run build          # typecheck + client build (client/dist) + server bundle (server/dist)
npm run preview        # serve the production client build
npm run start:server   # run the bundled server
```

Character: the main menu's **Character** button opens the creator (the first New game opens it too).

Vehicles: the two off-roaders are at base camp. The road cars are in the town car parks, and **Pause → Fast travel** takes you there.

Single player works without the server. For multiplayer, start the server, then click **Multiplayer free roam** in the main menu (server address is in Settings).

## Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| Move / drive | WASD | Left stick / triggers |
| Camera | Mouse (click to lock), wheel zooms | Right stick |
| Interact: enter / exit vehicle, talk | E | Y |
| Walk (hold) | Alt | Light stick tilt |
| Pick a reply in a conversation | 1 – 5 or click | |
| Camera mode | V (chase, far, hood, cockpit / on foot: chase, first-person, free) | |
| Handbrake / jump | Space | A |
| Sprint / crouch | Shift / C | |
| Driving mode (Normal, Sport, Off-road, Rock crawl, Snow, Mud; road cars Normal, Sport, Snow) | C | X |
| 2H / 4H / 4L, diff lock (off-roaders), auto/manual, shift | G, L, T, X/Z | LB/RB shift |
| Refuel (hold, at any pump) | F | |
| Repair kit (stopped) / workshop repair in the camp shed | K / F | |
| Headlights, recover | N, R | |
| World map, help, pause, quick save | M, H, P or Esc, F5 | Start |
| On the world map: zoom, pan, set / remove marker | Wheel or + / −, drag, click / right-click or Delete | |
| On the world map: whole island / regions, legend, region details, centre on me | 0, 1–4, L, R, C | |

## Repository layout

```
shared/   @orl/shared  deterministic simulation used by client AND server
  math/ terrain/ vehicles/ characters/ (controller, appearance, enter/exit)  gameplay/ (interaction)  npc/ (NPCs, dialogue)
  world/ (island: regions, places, roads, rivers, elevation; valley road network and settlements; AI traffic)
  constants/ types/ schemas/ events/
client/   @orl/client  Babylon.js game client
  engine/ (WebGPU→WebGL2)  physics/ (Havok)  rendering/  world/ (terrain, roads, buildings, traffic)  vehicles/  characters/
  cameras/  input/  audio/  ui/ (HUD, world map + map worker)  multiplayer/  save/  assets/  config/  core/ (app, logger, errors)
server/   @orl/server  Colyseus server
  rooms/FreeRoamRoom.ts  validation/movement.ts  app.ts  index.ts
tests/    unit/  gameplay/  integration/
tools/    fit-island.ts (fits island scale and region areas)
documentation/  architecture, known limitations
```

See [documentation/architecture.md](documentation/architecture.md) and [CHANGELOG.md](CHANGELOG.md).

## Assets

Every model, texture and sound is generated in code. There are no third-party art assets. Vehicle and place names are fictional.
