import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@colyseus/sdk';
import { ROOM_NAME, MESSAGE, encodeAppearance, DEFAULT_FEMALE, DEFAULT_MALE, type PlayerTransform } from '@orl/shared';
import { createGameServer, } from '../../server/src/app';
import { getTerrain } from '../../server/src/rooms/FreeRoamRoom';

const PORT = 25670 + Math.floor(Math.random() * 100);
let server: ReturnType<typeof createGameServer>;
beforeAll(async () => { server = createGameServer(); await server.listen(PORT); });
afterAll(async () => { await server.gracefullyShutdown(false); });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('multiplayer free roam (real WebSocket server)', () => {
  it('syncs one player to another and corrects a teleport', async () => {
    const t = getTerrain();
    const a = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name: 'Alice' });
    const b = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name: 'Bob' });
    expect(a.roomId).toBe(b.roomId);
    const msg = (x: number, z: number, mode: 'foot' | 'vehicle' = 'foot'): PlayerTransform => ({ mode, x, y: t.heightAt(x, z), z, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, t: Date.now() });
    a.send(MESSAGE.STATE, msg(1, 1));
    await wait(200);
    a.send(MESSAGE.STATE, msg(1.5, 1.2));
    await wait(300);
    const seen = (b.state as any).players.get(a.sessionId);
    expect(seen.name).toBe('Alice');
    expect(seen.x).toBeCloseTo(1.5, 3);
    // teleport attempt is rejected and corrected
    const corrections: any[] = [];
    a.onMessage(MESSAGE.CORRECTION, (m: any) => corrections.push(m));
    a.send(MESSAGE.STATE, msg(200, 50));
    await wait(300);
    expect(corrections[0]?.reason).toBe('speed');
    expect((b.state as any).players.get(a.sessionId).x).toBeCloseTo(1.5, 3);
    // chat is sanitised and broadcast
    const chats: any[] = [];
    b.onMessage(MESSAGE.CHAT, (m: any) => chats.push(m));
    a.send(MESSAGE.CHAT, { text: '<b>hello</b>' });
    await wait(200);
    expect(chats[0]).toEqual({ from: 'Alice', text: 'bhello/b' });
    await a.leave(); await wait(150);
    expect((b.state as any).players.has(a.sessionId)).toBe(false);
    await b.leave();
  });
  it('shares each player\'s look, re-validated by the server', async () => {
    const look = encodeAppearance({ ...DEFAULT_FEMALE, hair: 'curly', accessories: ['scarf'] });
    const a = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name: 'Cara', look });
    const b = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name: 'Dev', look: '<img src=x onerror=alert(1)>' });
    await wait(250);
    const players = (a.state as any).players;
    expect(players.get(a.sessionId).look).toBe(look);
    expect(players.get(b.sessionId).look).toBe(encodeAppearance(DEFAULT_MALE)); // hostile code -> default look
    await a.leave(); await b.leave();
  });
});
