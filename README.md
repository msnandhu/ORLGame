# OFF-ROAD LEGENDS

Browser open-world multiplayer off-road game. **Current milestone: Phase 2 (vehicle engine), v0.4.0.** This adds two data-driven vehicles, six driving modes, collision damage and repairs.

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

Single player works without the server. For multiplayer, start the server, then click **Multiplayer free roam** in the main menu (server address is in Settings).

## Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| Move / drive | WASD | Left stick / triggers |
| Camera | Mouse (click to lock), wheel zooms | Right stick |
| Enter / exit vehicle | E | Y |
| Camera mode | V (chase, far, hood, cockpit / on foot: chase, first-person, free) | |
| Handbrake / jump | Space | A |
| Sprint / crouch | Shift / C | |
| Driving mode (Normal, Sport, Off-road, Rock crawl, Snow, Mud) | C | X |
| 2H / 4H / 4L, diff lock, auto/manual, shift | G, L, T, X/Z | LB/RB shift |
| Repair kit (stopped) / workshop repair in the camp shed | K / F | |
| Headlights, recover | N, R | |
| Map, help, pause, quick save | M, H, P or Esc, F5 | Start |

## Repository layout

```
shared/   @orl/shared  deterministic simulation used by client AND server
  math/ terrain/ vehicles/ characters/ constants/ types/ schemas/ events/
client/   @orl/client  Babylon.js game client
  engine/ (WebGPU→WebGL2)  physics/ (Havok)  rendering/  world/  vehicles/  characters/
  cameras/  input/  audio/  ui/  multiplayer/  save/  assets/  config/  core/ (app, logger, errors)
server/   @orl/server  Colyseus server
  rooms/FreeRoamRoom.ts  validation/movement.ts  app.ts  index.ts
tests/    unit/  gameplay/  integration/
documentation/  architecture, known limitations
```

See [documentation/architecture.md](documentation/architecture.md) and [CHANGELOG.md](CHANGELOG.md).

## Assets

Every model, texture and sound is generated in code. There are no third-party art assets. Vehicle and place names are fictional.
