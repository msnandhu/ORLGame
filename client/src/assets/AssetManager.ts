import { log } from '../core/logger';

type Job<T> = { name: string; weight: number; run: () => Promise<T> | T };

/**
 * Loads and caches assets with weighted progress reporting for the loading screen.
 * Every asset in this build is generated procedurally or shipped as a WASM module; the manager is
 * the single place where future file-based assets (glTF vehicles, KTX2 textures, audio) plug in.
 */
export class AssetManager {
  private cache = new Map<string, unknown>();
  private queue: Job<unknown>[] = [];
  onProgress: (fraction: number, label: string) => void = () => {};

  add<T>(name: string, run: () => Promise<T> | T, weight = 1) { this.queue.push({ name, run, weight }); }
  get<T>(name: string): T {
    if (!this.cache.has(name)) throw new Error(`Asset not loaded: ${name}`);
    return this.cache.get(name) as T;
  }
  has(name: string) { return this.cache.has(name); }

  async loadAll() {
    const total = this.queue.reduce((a, j) => a + j.weight, 0) || 1;
    let done = 0;
    for (const job of this.queue) {
      this.onProgress(done / total, job.name);
      await new Promise(r => setTimeout(r, 0)); // let the loading screen paint
      const t0 = performance.now();
      const v = await job.run();
      this.cache.set(job.name, v);
      done += job.weight;
      log.info('assets', `${job.name} ready in ${Math.round(performance.now() - t0)} ms`);
    }
    this.queue = [];
    this.onProgress(1, 'Ready');
  }
  dispose(name: string) { const v = this.cache.get(name) as { dispose?: () => void } | undefined; v?.dispose?.(); this.cache.delete(name); }
}
