import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@colyseus/sdk';
import { ROOM_NAME, MESSAGE, encodeAppearance, DEFAULT_FEMALE, DEFAULT_MALE, STARTING_CASH, partPrice, RANGER_TX4, type PlayerTransform } from '@orl/shared';
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
  it('runs the garage on the server: real prices, no double charges, builds shared with everyone', async () => {
    const t = getTerrain();
    const a = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name: 'Eve' });
    const b = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name: 'Finn' });
    const careers: any[] = [], results: any[] = [];
    a.onMessage(MESSAGE.CAREER, (m: any) => careers.push(m));
    a.onMessage(MESSAGE.GARAGE_RESULT, (m: any) => results.push(m));
    a.send(MESSAGE.CAREER, {});
    await wait(250);
    expect(careers[0]?.cash).toBe(STARTING_CASH);
    const fit = { op: 'fit', vid: 'ranger-tx4', slot: 'ecu', option: 'stage2' };
    // the same transaction sent three times (a flaky connection resending) is charged once
    for (let i = 0; i < 3; i++) a.send(MESSAGE.GARAGE, { txn: 'eve-fit-0001', req: fit });
    // a client can't name its own price or hand itself money
    a.send(MESSAGE.GARAGE, { txn: 'eve-cheat-001', req: { op: 'fit', vid: 'ranger-tx4', slot: 'turbo', option: 'hybrid', price: 0 } });
    a.send(MESSAGE.GARAGE, { txn: 'eve-cheat-002', req: { op: 'give', cash: 1e9 } });
    a.send(MESSAGE.GARAGE, { txn: 'eve-cheat-003', req: { op: 'buy-vehicle', vid: 'vanta-gt' } });
    a.send(MESSAGE.GARAGE, { txn: 'eve-cheat-004', req: { op: 'discover', poi: 'glacier-peak' } }); // far away
    await wait(400);
    const last = results[results.length - 1];
    const cash = last.career.cash;
    expect(results.filter(r => r.txn === 'eve-fit-0001').every(r => r.ok)).toBe(true);
    expect(results.find(r => r.txn === 'eve-cheat-002')?.ok).toBe(false);
    expect(results.find(r => r.txn === 'eve-cheat-003')?.ok).toBe(false);
    expect(results.find(r => r.txn === 'eve-cheat-004')?.ok).toBe(false);
    expect(cash).toBe(STARTING_CASH - partPrice(RANGER_TX4, 'ecu', 'stage2') - partPrice(RANGER_TX4, 'turbo', 'hybrid'));
    // the other player sees the tuned Ranger's build, derived by the server
    a.send(MESSAGE.STATE, { mode: 'vehicle', vid: 'ranger-tx4', x: 1, y: t.heightAt(1, 1), z: 1, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, t: Date.now() });
    await wait(300);
    const seen = (b.state as any).players.get(a.sessionId);
    expect(seen.bld).toContain('ecu:stage2'); expect(seen.bld).toContain('turbo:hybrid');
    await a.leave(); await b.leave();
  });
});
