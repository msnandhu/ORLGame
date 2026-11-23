import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, MESSAGE, NETWORK_TICK_HZ, type PlayerTransform } from '@orl/shared';
import { log } from '../core/logger';

export interface RemotePlayer {
  id: string; name: string; mode: 'foot' | 'vehicle';
  /** buffered server snapshots for interpolation */
  buf: { at: number; s: PlayerTransform }[];
}

/**
 * Online free-roam client. Sends the local player's transform at the network tick rate, keeps an
 * interpolation buffer for each remote player (rendered ~100 ms in the past for smoothness), and applies
 * server corrections when the server rejects an update.
 */
export class NetClient {
  room: Room | null = null;
  readonly remotes = new Map<string, RemotePlayer>();
  status: 'offline' | 'connecting' | 'online' | 'error' = 'offline';
  onCorrection: (c: { x: number; y: number; z: number; reason: string }) => void = () => {};
  onChat: (c: { from: string; text: string }) => void = () => {};
  private sendAcc = 0;
  readonly interpDelayMs = 100;

  async connect(url: string, name: string) {
    this.status = 'connecting';
    try {
      const room = await new Client(url).joinOrCreate(ROOM_NAME, { name });
      this.room = room; this.status = 'online';
      log.info('net', `Joined ${ROOM_NAME} ${room.roomId} as ${room.sessionId}`);
      room.onMessage(MESSAGE.CORRECTION, (c: { x: number; y: number; z: number; reason: string }) => { log.warn('net', `Server correction: ${c.reason}`); this.onCorrection(c); });
      room.onMessage(MESSAGE.CHAT, (c: { from: string; text: string }) => this.onChat(c));
      room.onStateChange((state: { players: Map<string, PlayerTransform & { name: string }> }) => {
        const now = performance.now();
        const seen = new Set<string>();
        state.players.forEach((p, id) => {
          if (id === room.sessionId) return;
          seen.add(id);
          let r = this.remotes.get(id);
          if (!r) { r = { id, name: p.name, mode: p.mode, buf: [] }; this.remotes.set(id, r); }
          r.name = p.name; r.mode = p.mode;
          const last = r.buf[r.buf.length - 1];
          if (!last || last.s.t !== p.t) r.buf.push({ at: now, s: { mode: p.mode, x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw, vx: p.vx, vy: p.vy, vz: p.vz, t: p.t } });
          if (r.buf.length > 30) r.buf.shift();
        });
        for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remotes.delete(id);
      });
      room.onLeave((code: number) => { log.warn('net', `Left room (code ${code})`); this.status = 'offline'; this.room = null; this.remotes.clear(); });
      return true;
    } catch (e) {
      this.status = 'error';
      log.warn('net', `Could not connect to ${url}`, e);
      return false;
    }
  }

  update(dt: number, local: PlayerTransform) {
    if (!this.room) return;
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / NETWORK_TICK_HZ) { this.sendAcc = 0; this.room.send(MESSAGE.STATE, local); }
  }

  /** Interpolated remote transform at render time. */
  sample(r: RemotePlayer): PlayerTransform | null {
    const t = performance.now() - this.interpDelayMs, b = r.buf;
    if (!b.length) return null;
    if (t <= b[0].at) return b[0].s;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].at <= t) {
        const a = b[i - 1], c = b[i];
        if (t >= c.at) return c.s; // newest: hold (no wild extrapolation)
        const k = (t - a.at) / (c.at - a.at || 1), l = (x: number, y: number) => x + (y - x) * k;
        // nlerp rotation
        let qx = c.s.qx, qy = c.s.qy, qz = c.s.qz, qw = c.s.qw;
        if (a.s.qx * qx + a.s.qy * qy + a.s.qz * qz + a.s.qw * qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
        const rx = l(a.s.qx, qx), ry = l(a.s.qy, qy), rz = l(a.s.qz, qz), rw = l(a.s.qw, qw), n = Math.hypot(rx, ry, rz, rw) || 1;
        return { ...c.s, x: l(a.s.x, c.s.x), y: l(a.s.y, c.s.y), z: l(a.s.z, c.s.z), qx: rx / n, qy: ry / n, qz: rz / n, qw: rw / n };
      }
    }
    return b[b.length - 1].s;
  }

  disconnect() { this.room?.leave(); this.room = null; this.status = 'offline'; this.remotes.clear(); }
}
