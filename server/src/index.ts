import { createGameServer } from './app';
import { GAME_VERSION } from '@orl/shared';

const port = Number(process.env.PORT ?? 2567);
const server = createGameServer();
await server.listen(port);
console.log(`[server] Off-Road Legends ${GAME_VERSION} listening on ws://localhost:${port}`);
const stop = async () => { await server.gracefullyShutdown(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
