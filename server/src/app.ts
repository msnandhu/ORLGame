import { Server, defineRoom } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@orl/shared';
import { FreeRoamRoom, getTerrain } from './rooms/FreeRoamRoom';

export function createGameServer() {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define(ROOM_NAME, FreeRoamRoom);
  getTerrain(); // build the deterministic world once at startup
  return server;
}
export { defineRoom };
