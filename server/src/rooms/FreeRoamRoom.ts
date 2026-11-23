import { Room, type Client } from '@colyseus/core';
import { schema, t as ty, MapSchema } from '@colyseus/schema';
import {
  Terrain, vehicleById, decodeAppearance, encodeAppearance, WORLD_SEED, LIMITS, MAX_PLAYERS_PER_ROOM, MESSAGE, isPlayerTransform, sanitizeChat,
  newCareer, transact, isGarageRequest, encodeBuild, Ledger, type PlayerTransform, type Career,
} from '@orl/shared';
import { validateMove, RateLimiter, type Accepted } from '../validation/movement';

export const PlayerState = schema({
  name: ty.string(), mode: ty.string(), vid: ty.string(),
  /** appearance code, re-encoded by the server so every client receives a valid look */
  look: ty.string(),
  /** the vehicle's build code, derived by the server from what this player owns and paid for */
  bld: ty.string(),
  x: ty.number(), y: ty.number(), z: ty.number(),
  qx: ty.number(), qy: ty.number(), qz: ty.number(), qw: ty.number(),
  vx: ty.number(), vy: ty.number(), vz: ty.number(),
  t: ty.number(),
}, 'PlayerState');
export const WorldState = schema({ players: ty.map(PlayerState) }, 'WorldState');
type PlayerInstance = InstanceType<typeof PlayerState>;

let sharedTerrain: Terrain | null = null;
/** The terrain is deterministic from the seed, so server and clients agree on every height. */
export const getTerrain = () => (sharedTerrain ??= new Terrain(WORLD_SEED));

/**
 * Per-session state. Online careers are server-owned: the client asks for a transaction and the server decides, using the
 * same catalogue prices as single-player. (They last for the session; persistent accounts arrive with Phase 6.)
 */
interface Session { accepted: Accepted | null; limiter: RateLimiter; chat: RateLimiter; garage: RateLimiter; violations: number; career: Career; ledger: Ledger }

/** Shared exploration room: players see each other's characters and vehicles; the server validates every update. */
export class FreeRoamRoom extends Room {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  private sessions = new Map<string, Session>();
  private terrain!: Terrain;

  override onCreate() {
    this.terrain = getTerrain();
    this.setState(new WorldState());
    this.setPatchRate(50); // 20 Hz
    this.onMessage(MESSAGE.STATE, (client: Client, msg: unknown) => this.handleState(client, msg));
    this.onMessage(MESSAGE.CHAT, (client: Client, msg: unknown) => {
      const s = this.sessions.get(client.sessionId); if (!s || !s.chat.allow(Date.now())) return;
      const text = sanitizeChat((msg as { text?: unknown })?.text); if (!text) return;
      const p = (this.state as { players: MapSchema<PlayerInstance> }).players.get(client.sessionId);
      this.broadcast(MESSAGE.CHAT, { from: p?.name ?? 'Player', text });
    });
    this.onMessage(MESSAGE.GARAGE, (client: Client, msg: unknown) => this.handleGarage(client, msg));
    // the client asks for its career once its handlers are in place
    this.onMessage(MESSAGE.CAREER, (client: Client) => { const s = this.sessions.get(client.sessionId); if (s && s.garage.allow(Date.now())) client.send(MESSAGE.CAREER, s.career); });
  }

  /** Garage and economy transactions: validated here, prices from the shared catalogue, replays answered once. */
  private handleGarage(client: Client, msg: unknown) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const m = (msg ?? {}) as { txn?: unknown; req?: unknown };
    const txn = typeof m.txn === 'string' ? m.txn.slice(0, 40) : '';
    if (!s.garage.allow(Date.now())) { client.send(MESSAGE.GARAGE_RESULT, { txn, ok: false, msg: 'Too many requests', career: s.career }); return; }
    if (!isGarageRequest(m.req)) { this.flag(client, s, 'bad_garage_request'); client.send(MESSAGE.GARAGE_RESULT, { txn, ok: false, msg: 'Invalid request', career: s.career }); return; }
    const req = m.req;
    const r = s.ledger.run(m.txn, () => transact(s.career, req, { pois: this.terrain.outer.island.pois, at: s.accepted ?? undefined }));
    if (r.ok) s.career = r.career;
    client.send(MESSAGE.GARAGE_RESULT, { txn, ok: r.ok, msg: r.ok ? r.msg : r.error, career: s.career });
    const p = (this.state as { players: MapSchema<PlayerInstance> }).players.get(client.sessionId);
    if (p) p.bld = this.buildCode(s, p.vid);
  }
  private buildCode(s: Session, vid: string) { const o = s.career.owned[vid]; return o ? encodeBuild(o.build) : ''; }

  override onJoin(client: Client, options?: { name?: unknown; look?: unknown }) {
    const name = (sanitizeChat(options?.name) ?? `Driver-${client.sessionId.slice(0, 4)}`).slice(0, 24);
    const p = new PlayerState();
    const sx = 0, sz = 0;
    Object.assign(p, { name, look: encodeAppearance(decodeAppearance(options?.look)), bld: '', mode: 'foot', vid: 'ranger-tx4', x: sx, y: this.terrain.heightAt(sx, sz), z: sz, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, t: 0 });
    (this.state as { players: MapSchema<PlayerInstance> }).players.set(client.sessionId, p);
    this.sessions.set(client.sessionId, { accepted: null, limiter: new RateLimiter(Math.ceil(LIMITS.maxStateRateHz * 1.5)), chat: new RateLimiter(3), garage: new RateLimiter(8), violations: 0, career: newCareer(), ledger: new Ledger() });
  }

  override onLeave(client: Client) {
    (this.state as { players: MapSchema<PlayerInstance> }).players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
  }

  private handleState(client: Client, msg: unknown) {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    const now = Date.now();
    if (!s.limiter.allow(now)) { this.flag(client, s, 'rate_limited'); return; }
    if (!isPlayerTransform(msg)) { this.flag(client, s, 'malformed'); return; }
    const t = msg as PlayerTransform;
    const verdict = validateMove(s.accepted, t, now, this.terrain);
    if (!verdict.ok) {
      this.flag(client, s, verdict.reason);
      const a = s.accepted;
      if (a) client.send(MESSAGE.CORRECTION, { x: a.x, y: a.y, z: a.z, reason: verdict.reason });
      return;
    }
    s.accepted = { x: t.x, y: t.y, z: t.z, mode: t.mode, at: now };
    s.violations = Math.max(0, s.violations - 0.05);
    const p = (this.state as { players: MapSchema<PlayerInstance> }).players.get(client.sessionId);
    if (p) { const vid = vehicleById(t.vid).id; if (vid !== p.vid || !p.bld) p.bld = this.buildCode(s, vid); }
    if (p) Object.assign(p, { mode: t.mode, vid: vehicleById(t.vid).id, x: t.x, y: t.y, z: t.z, qx: t.qx, qy: t.qy, qz: t.qz, qw: t.qw, vx: t.vx, vy: t.vy, vz: t.vz, t: t.t });
  }

  private flag(client: Client, s: Session, reason: string) {
    s.violations++;
    if (s.violations > 40) { console.warn(`[room] disconnecting ${client.sessionId}: repeated violations (${reason})`); client.leave(4001); }
  }
}
