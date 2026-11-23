import { transact, type Career, type GarageRequest, type GarageContext } from '@orl/shared';
import { CareerStore } from '../save/CareerStore';
import type { NetClient } from '../multiplayer/NetClient';

export interface BankResult { ok: boolean; msg: string }

/**
 * Where garage transactions are decided. Offline, the shared economy runs locally on the stored career; online, the
 * request goes to the server, which owns the career, and the answer comes back with the new balance.
 */
export class Bank {
  private local: Career = CareerStore.read();
  onChange: (c: Career) => void = () => {};
  constructor(private net: NetClient, private ctx: () => GarageContext) {
    net.onCareer = c => this.onChange(c);
    net.onCareerLost = () => this.onChange(this.local);
  }
  get online() { return this.net.status === 'online' && !!this.net.career; }
  get career(): Career { return this.online ? this.net.career! : this.local; }

  async request(req: GarageRequest): Promise<BankResult> {
    if (this.net.status === 'online') return this.net.garage(req);
    const r = transact(this.local, req, this.ctx());
    if (!r.ok) return { ok: false, msg: r.error };
    this.local = r.career; CareerStore.write(this.local); this.onChange(this.local);
    return { ok: true, msg: r.msg };
  }
  /** Start a fresh single-player career (New game). */
  resetLocal(c: Career) { this.local = c; CareerStore.write(c); this.onChange(c); }
}
