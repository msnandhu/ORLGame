/** Small typed event bus used to decouple systems. */
export class EventBus<E extends Record<string, unknown>> {
  private handlers = new Map<keyof E, Set<(p: never) => void>>();
  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    let s = this.handlers.get(k);
    if (!s) { s = new Set(); this.handlers.set(k, s); }
    s.add(fn as (p: never) => void);
    return () => s!.delete(fn as (p: never) => void);
  }
  emit<K extends keyof E>(k: K, p: E[K]) {
    this.handlers.get(k)?.forEach(fn => { try { (fn as (p: E[K]) => void)(p); } catch (e) { console.error(`[event:${String(k)}]`, e); } });
  }
}
