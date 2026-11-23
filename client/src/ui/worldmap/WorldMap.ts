import { REGIONS, REGION_BY_ID, type Island, type Poi, type RegionId } from '@orl/shared';
import MapWorker from './mapWorker?worker&inline';
import type { MapMeta } from './mapCore';
import { log } from '../../core/logger';
import { ICON_COLOR, LEGEND, drawIcon, drawRegionGlyph } from './icons';

interface View { cx: number; cz: number; mpp: number }
interface Img { canvas: HTMLCanvasElement; x0: number; z0: number; x1: number; z1: number }
export interface MapMarker { id: number; x: number; z: number }

const REG_ORDER: RegionId[] = ['snow', 'hill', 'plain', 'forest'];
const KIND_LABEL: Record<string, string> = {
  camp: 'Base camp', city: 'Main city', village: 'Village / Town', gang: 'Gang base', garage: 'Service garage', fuel: 'Fuel station', race: 'Race / Challenge',
  explorer: 'Explorer camp', lookout: 'View point', lab: 'Research / Lab', cave: 'Cave / Hidden area', gate: 'Region gate', peak: 'Peak', cablecar: 'Cable car',
  rescue: 'Rescue outpost', hazard: 'Hazard', lake: 'Lake', waterfall: 'Waterfall', ruins: 'Ruins', wildlife: 'Wildlife zone', resource: 'Resource',
  collectible: 'Collectible', mission: 'Mission', depot: 'Depot', farm: 'Farm',
};
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const km = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km` : `${Math.round(m)} m`;
const store = { get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

/**
 * Full-screen world map: the whole island or one region, with zoom and pan, map markers, legend, region details,
 * a world inset and a compass. Terrain imagery is rendered in a worker from the island's own elevation and water,
 * so the map is the world rather than a picture of it. Places that are not built in 3D yet are drawn dashed.
 */
export class WorldMap {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private inset: HTMLCanvasElement;
  private worker: Worker | null = null;
  /** main-thread renderer, used when background workers are blocked (some embedded pages forbid them) */
  private local: Promise<typeof import('./mapCore')> | null = null;
  private localQueue: Record<string, unknown>[] = [];
  private gotReply = false;
  private meta: MapMeta | null = null;
  private base: Img | null = null;
  private detail: Img | null = null;
  private detailReq = 0;
  /** imagery around the player for the HUD minimap outside the valley (4 m per pixel, 2 km across) */
  localImg: Img | null = null;
  private localReq: { x: number; z: number } | null = null;
  /** wall-clock time at which to render detail for the current view (0 = none pending) */
  private settleAt = 0;
  private view: View = { cx: 0, cz: 0, mpp: 60 };
  private target: View | null = null;
  private region: RegionId | null = null;
  private legendOn = true;
  private detailsOn = true;
  private dpr = 1;
  private hover: Poi | null = null;
  private selected: MapMarker | null = null;
  markers: MapMarker[] = [];
  private explored: Uint8Array | null = null;
  private exploreTimer = 0;
  private player = { x: 0, z: 0, bearing: 0, vx: 0, vz: 0, inVeh: true };
  private regionMask: Partial<Record<RegionId, HTMLCanvasElement>> = {};
  private labelAnchor: Partial<Record<RegionId, [number, number]>> = {};
  /** set when the map has changed something the HUD shows (markers) */
  onMarkersChanged: () => void = () => {};
  isOpen = false;

  constructor(private island: Island, private core: { img: HTMLCanvasElement; half: number }) {
    this.root = document.createElement('div');
    this.root.id = 'worldmap'; this.root.className = 'hidden';
    this.root.innerHTML = `
      <canvas id="wm-canvas"></canvas>
      <div id="wm-title" class="wm-panel"></div>
      <div id="wm-tabs">${['World', ...REG_ORDER.map(r => REGION_BY_ID[r].name.replace(' Region', ''))].map((n, i) => `<button data-reg="${i}">${n}</button>`).join('')}</div>
      <div id="wm-side"><div id="wm-info" class="wm-panel"></div><div id="wm-legend" class="wm-panel"></div></div>
      <canvas id="wm-inset" width="240" height="196"></canvas>
      <canvas id="wm-compass" width="120" height="120"></canvas>
      <div id="wm-bar">
        <button data-act="in"><b>Wheel ↑</b> Zoom In</button><button data-act="out"><b>Wheel ↓</b> Zoom Out</button>
        <button data-act="set"><b>Click</b> Set Marker</button><button data-act="del"><b>Right click</b> Remove Marker</button>
        <button data-act="travel"><b>T</b> Travel to Marker</button><button data-act="legend"><b>L</b> Legend</button><button data-act="details"><b>R</b> Region Details</button><button data-act="close"><b>M</b> Close</button>
      </div>
      <div id="wm-tip" class="wm-panel hidden"></div>
      <div id="wm-flash" class="wm-panel hidden"></div>
      <div id="wm-loading">Rendering map…</div>`;
    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector('#wm-canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.inset = this.root.querySelector('#wm-inset')!;
    this.drawCompass();
    this.loadState();
    try {
      const w = new MapWorker();
      w.onmessage = e => { this.gotReply = true; this.onWorker(e.data); };
      w.onerror = e => this.useMainThread(e);
      this.worker = w;
    } catch (e) { this.useMainThread(e); }
    this.post({ type: 'meta' });
    // a worker that never answers (blocked without an error) also falls back
    setTimeout(() => { if (!this.gotReply && this.worker) this.useMainThread('no reply from the map worker'); }, 10000);
    this.bindInput();
  }

  // ------------------------------------------------------------------ state
  private loadState() {
    try { const m = JSON.parse(store.get('orl.map.markers') ?? '[]'); if (Array.isArray(m)) this.markers = m.filter(q => Number.isFinite(q.x) && Number.isFinite(q.z)).slice(0, 9); } catch { /* ignore */ }
  }
  private saveMarkers() { store.set('orl.map.markers', JSON.stringify(this.markers)); this.onMarkersChanged(); }
  /** Send a request to the map renderer (worker, or main thread fallback). */
  private post(m: Record<string, unknown>) {
    if (this.worker) { this.worker.postMessage(m); return; }
    this.localQueue.push(m);
    if (this.localQueue.length === 1) this.drainLocal();
  }
  private useMainThread(reason: unknown) {
    if (this.local) return;
    log.warn('map', 'Map worker unavailable; rendering the map on the main thread', reason);
    this.worker?.terminate(); this.worker = null;
    this.local = import('./mapCore');
    this.localReq = null;
    if (!this.meta) this.post({ type: 'meta' });
    else if (!this.base) { const b = this.meta.bounds, W = 1000; this.post({ type: 'render', id: -1, x0: b.minX, z0: b.minZ, x1: b.maxX, z1: b.maxZ, w: W, h: Math.round(W * (b.maxZ - b.minZ) / (b.maxX - b.minX)) }); }
  }
  /** One request at a time, yielding between them so the page stays responsive. */
  private drainLocal() {
    setTimeout(async () => {
      const m = this.localQueue[0];
      if (!m) return;
      try {
        const core = await this.local!;
        const r = core.handleMapRequest(m as Parameters<typeof core.handleMapRequest>[0]);
        if (r) this.onWorker(r.msg as Parameters<WorldMap['onWorker']>[0]);
      } catch (e) { log.warn('map', 'Map render failed', e); }
      this.localQueue.shift();
      // stale detail renders are skipped: only the newest one matters
      this.localQueue = this.localQueue.filter((q, i, all) => !(q.type === 'render' && typeof q.id === 'number' && q.id > 0 && all.some((o, j) => j > i && o.type === 'render' && typeof o.id === 'number' && (o.id as number) > 0)));
      if (this.localQueue.length) this.drainLocal();
    }, 0);
  }

  /** The marker the HUD guides to: the most recently set one. */
  get waypoint(): MapMarker | null { return this.markers[this.markers.length - 1] ?? null; }

  private onWorker(m: { type: string; meta?: MapMeta; id?: number; w?: number; h?: number; x0?: number; z0?: number; x1?: number; z1?: number; px?: Uint8ClampedArray }) {
    if (m.type === 'meta' && m.meta) {
      this.meta = m.meta;
      this.initExplored();
      this.buildMasks();
      const b = m.meta.bounds, W = 1000, H = Math.round(W * (b.maxZ - b.minZ) / (b.maxX - b.minX));
      this.post({ type: 'render', id: -1, x0: b.minX, z0: b.minZ, x1: b.maxX, z1: b.maxZ, w: W, h: H });
      if (this.isOpen) { this.fitView(this.region, true); this.renderPanels(); }
    } else if (m.type === 'render' && m.px) {
      const c = document.createElement('canvas'); c.width = m.w!; c.height = m.h!;
      c.getContext('2d')!.putImageData(new ImageData(m.px as unknown as Uint8ClampedArray<ArrayBuffer>, m.w!, m.h!), 0, 0);
      const img = { canvas: c, x0: m.x0!, z0: m.z0!, x1: m.x1!, z1: m.z1! };
      if (m.id === -1) { this.base = img; this.root.querySelector('#wm-loading')!.classList.add('hidden'); this.drawInsetBase(); }
      else if (m.id === -2) this.localImg = img;
      else if (m.id === this.detailReq) this.detail = img;
    }
  }

  /** Keep minimap imagery centred near the player (re-rendered after 600 m of travel). */
  ensureLocal(x: number, z: number) {
    if (this.localReq && Math.hypot(this.localReq.x - x, this.localReq.z - z) < 600) return;
    this.localReq = { x, z };
    const R = 1024;
    this.post({ type: 'render', id: -2, x0: x - R, z0: z - R, x1: x + R, z1: z + R, w: 512, h: 512 });
  }

  // ------------------------------------------------------------------ exploration
  private initExplored() {
    const M = this.meta!, n = M.cols * M.rows;
    this.explored = new Uint8Array(Math.ceil(n / 8));
    const s = store.get('orl.map.explored');
    if (s) try { const raw = atob(s); if (raw.length === this.explored.length) for (let i = 0; i < raw.length; i++) this.explored[i] = raw.charCodeAt(i); } catch { /* ignore */ }
  }
  /** Mark the cells around the player explored (called every frame; samples twice a second). */
  trackExploration(x: number, z: number, dt: number) {
    this.exploreTimer -= dt;
    if (this.exploreTimer > 0 || !this.meta || !this.explored) return;
    this.exploreTimer = 0.5;
    const M = this.meta, r = 300, c0 = Math.floor((x - r - M.x0) / M.cell), c1 = Math.floor((x + r - M.x0) / M.cell);
    const r0 = Math.floor((z - r - M.z0) / M.cell), r1 = Math.floor((z + r - M.z0) / M.cell);
    let changed = false;
    for (let j = Math.max(0, r0); j <= Math.min(M.rows - 1, r1); j++) for (let i = Math.max(0, c0); i <= Math.min(M.cols - 1, c1); i++) {
      const cx = M.x0 + (i + 0.5) * M.cell, cz = M.z0 + (j + 0.5) * M.cell;
      if (Math.hypot(cx - x, cz - z) > r) continue;
      const k = j * M.cols + i;
      if (!(this.explored[k >> 3] & (1 << (k & 7)))) { this.explored[k >> 3] |= 1 << (k & 7); changed = true; }
    }
    if (changed) { let s = ''; for (const b of this.explored) s += String.fromCharCode(b); store.set('orl.map.explored', btoa(s)); }
  }
  /** Explored fraction of a region (or the whole island). */
  exploredFraction(region: RegionId | null): number {
    const M = this.meta, E = this.explored; if (!M || !E) return 0;
    const want = region ? REG_ORDER.indexOf(region) : -2;
    let tot = 0, got = 0;
    for (let k = 0; k < M.grid.length; k++) {
      const g = M.grid[k]; if (g < 0 || (want !== -2 && g !== want)) continue;
      tot++; if (E[k >> 3] & (1 << (k & 7))) got++;
    }
    return tot ? got / tot : 0;
  }

  // ------------------------------------------------------------------ open / close
  open(p: { x: number; z: number; bearing: number; vx: number; vz: number; inVeh: boolean }) {
    this.player = { ...p };
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.resize();
    this.region = null;
    // open on the player's region, zoomed to it
    const r = this.island.regionAt(p.x, p.z);
    this.setRegion(r, true);
  }
  close() { this.isOpen = false; this.root.classList.add('hidden'); this.root.querySelector('#wm-tip')!.classList.add('hidden'); }

  private resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr); this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  private setRegion(r: RegionId | null, snap = false) {
    this.region = r;
    this.root.querySelectorAll('#wm-tabs button').forEach((b, i) => b.classList.toggle('on', i === (r ? REG_ORDER.indexOf(r) + 1 : 0)));
    this.fitView(r, snap);
    this.renderPanels();
  }
  private fitView(r: RegionId | null, snap: boolean) {
    const W = this.canvas.width, H = this.canvas.height;
    let x0: number, z0: number, x1: number, z1: number;
    if (r && this.meta) { const s = this.meta.stats[r]; ({ x0, z0, x1, z1 } = s); }
    else if (this.meta) {
      x0 = Math.min(...REG_ORDER.map(q => this.meta!.stats[q].x0)); z0 = Math.min(...REG_ORDER.map(q => this.meta!.stats[q].z0));
      x1 = Math.max(...REG_ORDER.map(q => this.meta!.stats[q].x1)); z1 = Math.max(...REG_ORDER.map(q => this.meta!.stats[q].z1));
    } else { x0 = this.island.minX; z0 = this.island.minZ; x1 = this.island.maxX; z1 = this.island.maxZ; }
    // leave room for the side panels
    const usableW = W * (W > 900 * this.dpr ? 0.62 : 0.92), usableH = H * 0.8;
    const mpp = Math.max((x1 - x0) / usableW, (z1 - z0) / usableH) * 1.08;
    const shift = W > 900 * this.dpr ? (W * 0.5 - (W * 0.06 + usableW / 2)) * mpp : 0;
    const v = { cx: (x0 + x1) / 2 + shift, cz: (z0 + z1) / 2 + (r ? 0 : H * 0.01 * mpp), mpp };
    if (snap) { this.view = v; this.target = null; } else this.target = v;
    this.scheduleDetail();
  }
  private get fullMpp() { const b = this.island; return Math.max((b.maxX - b.minX) / this.canvas.width, (b.maxZ - b.minZ) / this.canvas.height) * 1.2; }

  // ------------------------------------------------------------------ input
  private bindInput() {
    const c = this.canvas;
    let down: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
    c.addEventListener('mousedown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false }; });
    window.addEventListener('mousemove', e => {
      if (!this.isOpen) return;
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 4) down.moved = true;
        if (down.moved) { this.target = null; this.view.cx = down.cx - dx * this.dpr * this.view.mpp; this.view.cz = down.cz - dy * this.dpr * this.view.mpp; this.scheduleDetail(); }
      }
      this.updateHover(e.clientX * this.dpr, e.clientY * this.dpr, e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', e => {
      if (!this.isOpen || !down || e.button !== 0) { down = null; return; }
      const moved = down.moved; down = null;
      if (moved) return;
      const [x, z] = this.toWorld(e.clientX * this.dpr, e.clientY * this.dpr);
      const hit = this.markerAt(e.clientX * this.dpr, e.clientY * this.dpr);
      if (hit) { this.selected = hit; return; }
      this.addMarker(x, z);
    });
    c.addEventListener('contextmenu', e => { e.preventDefault(); const hit = this.markerAt(e.clientX * this.dpr, e.clientY * this.dpr); if (hit) this.removeMarker(hit); });
    c.addEventListener('dblclick', e => { const [x, z] = this.toWorld(e.clientX * this.dpr, e.clientY * this.dpr); this.zoomAt(x, z, 0.4); });
    c.addEventListener('wheel', e => { e.preventDefault(); const [x, z] = this.toWorld(e.clientX * this.dpr, e.clientY * this.dpr); this.zoomAt(x, z, Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    window.addEventListener('resize', () => { if (this.isOpen) { this.resize(); this.scheduleDetail(); } });
    window.addEventListener('keydown', e => {
      if (!this.isOpen) return;
      const k = e.code;
      if (k === 'KeyL') this.toggleLegend();
      else if (k === 'KeyT') this.travel();
      else if (k === 'KeyR') this.toggleDetails();
      else if (k === 'Equal' || k === 'NumpadAdd') this.zoomAt(this.view.cx, this.view.cz, 0.7);
      else if (k === 'Minus' || k === 'NumpadSubtract') this.zoomAt(this.view.cx, this.view.cz, 1 / 0.7);
      else if (k === 'Delete' || k === 'Backspace') this.removeMarker(this.selected ?? this.waypoint);
      else if (k === 'KeyC') this.centreOnPlayer();
      else if (/^(Digit|Numpad)[0-4]$/.test(k)) { const n = Number(k.slice(-1)); this.setRegion(n ? REG_ORDER[n - 1] : null); }
      else return;
      e.preventDefault();
    });
    this.root.querySelector('#wm-tabs')!.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      const n = Number(b.dataset.reg); this.setRegion(n ? REG_ORDER[n - 1] : null);
    });
    this.root.querySelector('#wm-bar')!.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'in') this.zoomAt(this.view.cx, this.view.cz, 0.6);
      else if (a === 'out') this.zoomAt(this.view.cx, this.view.cz, 1 / 0.6);
      else if (a === 'set') this.addMarker(this.view.cx, this.view.cz);
      else if (a === 'del') this.removeMarker(this.selected ?? this.waypoint);
      else if (a === 'legend') this.toggleLegend();
      else if (a === 'details') this.toggleDetails();
      else if (a === 'close') this.onCloseRequest();
      else if (a === 'travel') this.travel();
    });
    this.root.querySelector('#wm-info')!.addEventListener('click', e => {
      const el = (e.target as HTMLElement).closest('[data-region]') as HTMLElement | null; if (el) this.setRegion(el.dataset.region as RegionId);
    });
  }
  /** Fast travel to the selected marker (or the latest one); the game decides whether it is allowed. */
  private travel() {
    const m = this.selected ?? this.waypoint;
    if (!m) { this.flash('Set a marker first (click the map)'); return; }
    this.onTravelRequest(m.x, m.z);
  }
  private flashTimer = 0;
  /** A short message across the top of the map. */
  flash(msg: string) {
    const el = this.root.querySelector('#wm-flash') as HTMLElement;
    el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(this.flashTimer); this.flashTimer = window.setTimeout(() => el.classList.add('hidden'), 2600);
  }
  /** Set by the game: fast travel to a point. */
  onTravelRequest: (x: number, z: number) => void = () => {};
  /** Set by the game so the Close button behaves like the M key. */
  onCloseRequest: () => void = () => this.close();

  private toggleLegend() { this.legendOn = !this.legendOn; this.renderPanels(); }
  private toggleDetails() { this.detailsOn = !this.detailsOn; this.renderPanels(); }
  centreOnPlayer() { this.target = { cx: this.player.x, cz: this.player.z, mpp: Math.min(this.view.mpp, 12) }; this.scheduleDetail(); }

  addMarker(x: number, z: number) {
    if (this.markers.length >= 9) this.markers.shift();
    const used = new Set(this.markers.map(m => m.id));
    let id = 1; while (used.has(id)) id++;
    const m = { id, x, z }; this.markers.push(m); this.selected = m; this.saveMarkers();
  }
  removeMarker(m: MapMarker | null) {
    if (!m) return;
    this.markers = this.markers.filter(q => q !== m); if (this.selected === m) this.selected = null; this.saveMarkers();
  }
  private markerAt(sx: number, sy: number): MapMarker | null {
    for (const m of [...this.markers].reverse()) { const [x, y] = this.toScreen(m.x, m.z); if (Math.hypot(sx - x, sy - (y - 16 * this.dpr)) < 16 * this.dpr) return m; }
    return null;
  }
  private zoomAt(x: number, z: number, f: number) {
    const v = this.target ?? this.view;
    const mpp = Math.min(this.fullMpp, Math.max(1.5, v.mpp * f));
    const k = mpp / v.mpp;
    this.target = { cx: x + (v.cx - x) * k, cz: z + (v.cz - z) * k, mpp };
    this.scheduleDetail();
  }
  private toWorld(sx: number, sy: number): [number, number] { const v = this.view; return [v.cx + (sx - this.canvas.width / 2) * v.mpp, v.cz + (sy - this.canvas.height / 2) * v.mpp]; }
  private toScreen(x: number, z: number): [number, number] { const v = this.view; return [(x - v.cx) / v.mpp + this.canvas.width / 2, (z - v.cz) / v.mpp + this.canvas.height / 2]; }

  private updateHover(sx: number, sy: number, cx: number, cy: number) {
    const r = this.iconSize() + 3 * this.dpr;
    let best: Poi | null = null, bd = r;
    for (const p of this.island.pois) { const [x, y] = this.toScreen(p.x, p.z); const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = p; } }
    this.hover = best;
    const tip = this.root.querySelector('#wm-tip') as HTMLElement;
    if (!best) { tip.classList.add('hidden'); return; }
    const dist = Math.hypot(best.x - this.player.x, best.z - this.player.z);
    tip.innerHTML = `<b>${best.name}</b>${best.sub ? `<small>${best.sub}</small>` : ''}
      <div>${KIND_LABEL[best.kind]}${best.members ? ` · ${best.members} members` : ''}</div>
      <div>${REGION_BY_ID[best.region].name} · ${km(dist)} away</div>
      <div class="${best.built ? 'built' : 'planned'}">${best.built ? 'Built: you can drive here now' : 'Planned: on the map, not built in 3D yet'}</div>`;
    tip.style.left = `${Math.min(cx + 16, window.innerWidth - 260)}px`; tip.style.top = `${cy + 12}px`;
    tip.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ detail imagery
  private scheduleDetail() { this.settleAt = performance.now() + 250; }
  private requestDetail() {
    if (!this.base) return;
    const v = this.view, W = this.canvas.width, H = this.canvas.height;
    const baseMpp = (this.base.x1 - this.base.x0) / this.base.canvas.width;
    if (v.mpp > baseMpp * 0.7) { this.detail = null; return; }
    // render the visible area (plus a margin) at up to ~0.5 megapixels
    const x0 = v.cx - W / 2 * v.mpp * 1.15, x1 = v.cx + W / 2 * v.mpp * 1.15, z0 = v.cz - H / 2 * v.mpp * 1.15, z1 = v.cz + H / 2 * v.mpp * 1.15;
    const k = Math.min(1, Math.sqrt(520000 / (W * H * 1.32)));
    this.detailReq++;
    this.post({ type: 'render', id: this.detailReq, x0, z0, x1, z1, w: Math.round(W * 1.15 * k), h: Math.round(H * 1.15 * k) });
  }

  private buildMasks() {
    const M = this.meta!;
    for (const r of REG_ORDER) {
      const c = document.createElement('canvas'); c.width = M.cols; c.height = M.rows;
      const g = c.getContext('2d')!, img = g.createImageData(M.cols, M.rows), want = REG_ORDER.indexOf(r);
      let sx = 0, sz = 0, n = 0;
      for (let k = 0; k < M.grid.length; k++) {
        const inside = M.grid[k] === want;
        img.data[k * 4 + 3] = inside ? 0 : 150;
        if (inside) { sx += k % M.cols; sz += Math.floor(k / M.cols); n++; }
      }
      g.putImageData(img, 0, 0);
      this.regionMask[r] = c;
      this.labelAnchor[r] = [M.x0 + (sx / n + 0.5) * M.cell, M.z0 + (sz / n + 0.5) * M.cell];
    }
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number, p: { x: number; z: number; bearing: number; vx: number; vz: number; inVeh: boolean }) {
    if (!this.isOpen) return;
    this.player = { ...p };
    if (this.target) {
      const t = 1 - Math.exp(-dt * 9), v = this.view, g = this.target;
      v.cx += (g.cx - v.cx) * t; v.cz += (g.cz - v.cz) * t; v.mpp = Math.exp(Math.log(v.mpp) + (Math.log(g.mpp) - Math.log(v.mpp)) * t);
      if (Math.abs(Math.log(v.mpp / g.mpp)) < 0.002 && Math.hypot(g.cx - v.cx, g.cz - v.cz) < v.mpp * 0.5) { this.view = { ...g }; this.target = null; }
    }
    if (this.settleAt && !this.target && performance.now() >= this.settleAt) { this.settleAt = 0; this.requestDetail(); }
    this.draw();
    this.drawInset();
  }

  private iconSize() { return (this.view.mpp < 30 || this.region ? 12 : 9) * this.dpr; }

  private draw() {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, v = this.view, d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.region ? '#071933' : '#0c2a56'; ctx.fillRect(0, 0, W, H);
    const blit = (im: Img) => { const [a, b] = this.toScreen(im.x0, im.z0), [c, e] = this.toScreen(im.x1, im.z1); ctx.drawImage(im.canvas, a, b, c - a, e - b); };
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (this.base) blit(this.base);
    if (this.detail) blit(this.detail);
    // the detailed valley: its own map, with buildings and every street
    if (v.mpp < 14) { const h = this.core.half; const [a, b] = this.toScreen(-h, -h), [c, e] = this.toScreen(h, h); ctx.globalAlpha = Math.min(1, (14 - v.mpp) / 6) * 0.92; ctx.drawImage(this.core.img, a, b, c - a, e - b); ctx.globalAlpha = 1; }
    // other regions dimmed in a region view
    if (this.region && this.meta && this.regionMask[this.region] && v.mpp > 12) {
      const M = this.meta; const [a, b] = this.toScreen(M.x0, M.z0), [c, e] = this.toScreen(M.x0 + M.cols * M.cell, M.z0 + M.rows * M.cell);
      ctx.drawImage(this.regionMask[this.region]!, a, b, c - a, e - b);
    }
    const line = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, z], k) => { const [sx, sy] = this.toScreen(x, z); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }); };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // rivers
    for (const r of this.island.rivers) {
      const w = Math.max(1.6 * d, (r.hw[r.hw.length - 1] * 2) / v.mpp);
      line(r.pts); ctx.strokeStyle = '#2f8fd8'; ctx.lineWidth = w; ctx.stroke();
      ctx.setLineDash([6 * d, 6 * d]); ctx.strokeStyle = 'rgba(160,220,255,0.85)'; ctx.lineWidth = Math.max(1, w * 0.3); ctx.stroke(); ctx.setLineDash([]);
    }
    // roads: trails, then regional roads, then highways
    const z = Math.max(0.6, Math.min(2.2, 30 / v.mpp));
    for (const kind of ['trail', 'road', 'highway'] as const) for (const r of this.island.roads) {
      if (r.kind !== kind) continue;
      line(r.pts);
      if (kind === 'trail') { ctx.setLineDash([5 * d, 4 * d]); ctx.strokeStyle = '#f0a040'; ctx.lineWidth = 1.6 * d * Math.min(1.4, z); ctx.stroke(); ctx.setLineDash([]); continue; }
      ctx.strokeStyle = 'rgba(20,20,20,0.75)'; ctx.lineWidth = (kind === 'highway' ? 4.5 : 3.2) * d * z; ctx.stroke();
      ctx.strokeStyle = kind === 'highway' ? '#f5a623' : '#d9d4ca'; ctx.lineWidth = (kind === 'highway' ? 3 : 2) * d * z; ctx.stroke();
    }
    // region outlines
    if (this.meta) for (const r of REG_ORDER) {
      const B = this.meta.borders[r], col = REGION_BY_ID[r].color, on = !this.region || this.region === r;
      ctx.beginPath();
      for (let k = 0; k < B.length; k += 4) { const [a, b] = this.toScreen(B[k], B[k + 1]), [c, e] = this.toScreen(B[k + 2], B[k + 3]); ctx.moveTo(a, b); ctx.lineTo(c, e); }
      ctx.strokeStyle = col; ctx.globalAlpha = on ? 1 : 0.35; ctx.lineWidth = (on ? 2.6 : 1.4) * d; ctx.shadowColor = col; ctx.shadowBlur = on ? 12 * d : 0; ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    // waterfalls and lakes
    if (v.mpp < 45) {
      const shown: [number, number][] = [];
      for (const f of [...this.island.waterfalls].sort((a, b) => (b.top - b.bottom) - (a.top - a.bottom))) {
        const [x, y] = this.toScreen(f.x, f.z);
        if (shown.some(([a, b]) => Math.hypot(a - x, b - y) < 60 * d)) continue;
        shown.push([x, y]); drawIcon(ctx, 'waterfall', x, y, 7 * d);
      }
    }
    // places
    const placed: [number, number, number, number][] = [];
    const overlaps = (r: [number, number, number, number]) => placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const S = this.iconSize();
    const showAll = !!this.region || v.mpp < 30;
    const important = new Set(['gang', 'city', 'peak', 'gate']);
    const pois = [...this.island.pois].sort((a, b) => Number(important.has(b.kind)) - Number(important.has(a.kind)));
    const vis = pois.filter(p => { if (this.region && p.region !== this.region && v.mpp > 20) return false; const [x, y] = this.toScreen(p.x, p.z); return x > -40 && y > -40 && x < W + 40 && y < H + 40; });
    for (const p of vis) { const [x, y] = this.toScreen(p.x, p.z); drawIcon(ctx, p.kind, x, y, p === this.hover ? S * 1.25 : S, !p.built); placed.push([x - S, y - S, x + S, y + S]); }
    for (const p of vis) {
      const [x, y] = this.toScreen(p.x, p.z);
      if (!showAll && !important.has(p.kind)) continue;
      const title = p.kind === 'gang' && p.members ? `${p.name} (${p.members})` : p.name;
      ctx.font = `600 ${12 * d}px "Segoe UI", system-ui, sans-serif`;
      const tw = ctx.measureText(title).width, sub = showAll && p.sub ? p.sub : '';
      ctx.font = `${10 * d}px "Segoe UI", system-ui, sans-serif`; const sw = sub ? ctx.measureText(sub).width : 0;
      const bw = Math.max(tw, sw) + 10 * d, bh = (sub ? 30 : 18) * d;
      const rect: [number, number, number, number] = [x + S + 2 * d, y - bh / 2, x + S + 2 * d + bw, y + bh / 2];
      if (overlaps(rect)) continue;
      placed.push(rect);
      ctx.fillStyle = 'rgba(8,12,18,0.78)'; this.roundRect(rect[0], rect[1], bw, bh, 4 * d); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `600 ${12 * d}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(title, rect[0] + 5 * d, sub ? y - 6 * d : y);
      if (sub) { ctx.fillStyle = '#c8d0d8'; ctx.font = `${10 * d}px "Segoe UI", system-ui, sans-serif`; ctx.fillText(sub, rect[0] + 5 * d, y + 7 * d); }
    }
    // region badges in the world view
    if (!this.region && this.meta) for (const r of REG_ORDER) {
      const a = this.labelAnchor[r]; if (!a) continue;
      const info = REGION_BY_ID[r], st = this.meta.stats[r];
      const cx = (this.island.minX + this.island.maxX) / 2, cz = (this.island.minZ + this.island.maxZ) / 2;
      const out = r === 'plain' ? 0.75 : r === 'snow' ? 0.35 : r === 'hill' ? 0.8 : 0.55;
      let [x, y] = this.toScreen(a[0] + (a[0] - cx) * out, a[1] + (a[1] - cz) * out);
      x = Math.max(160 * d, Math.min(W - 160 * d, x)); y = Math.max(80 * d, Math.min(H - 130 * d, y));
      ctx.font = `800 ${17 * d}px "Segoe UI", system-ui, sans-serif`;
      const name = info.name.toUpperCase(), line2 = `${fmt(st.area)} km²  |  LV. ${info.lv[0]} – ${info.lv[1]}`;
      const bw = Math.max(ctx.measureText(name).width, 150 * d) + 60 * d, bh = 46 * d;
      ctx.fillStyle = 'rgba(6,12,20,0.82)'; ctx.strokeStyle = info.color; ctx.lineWidth = 2 * d; ctx.shadowColor = info.color; ctx.shadowBlur = 10 * d;
      this.roundRect(x - bw / 2, y - bh / 2, bw, bh, bh / 2); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      drawRegionGlyph(ctx, r, x - bw / 2 + 24 * d, y, 12 * d, info.color);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(name, x - bw / 2 + 44 * d, y - 8 * d);
      ctx.font = `600 ${11 * d}px "Segoe UI", system-ui, sans-serif`; ctx.fillStyle = '#dfe6ee'; ctx.fillText(line2, x - bw / 2 + 44 * d, y + 11 * d);
    }
    // markers
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const m of this.markers) {
      const [x, y] = this.toScreen(m.x, m.z), sel = m === this.selected, top = m === this.waypoint;
      ctx.fillStyle = top ? '#ffd23a' : '#f2f2f2'; ctx.strokeStyle = sel ? '#e0782a' : '#111'; ctx.lineWidth = (sel ? 3 : 1.5) * d;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9 * d, y - 18 * d); ctx.arc(x, y - 20 * d, 10 * d, Math.PI * 0.85, Math.PI * 0.15); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.font = `800 ${11 * d}px sans-serif`; ctx.fillText(String(m.id), x, y - 20 * d);
      if (sel || top) { ctx.fillStyle = '#fff'; ctx.font = `600 ${11 * d}px sans-serif`; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3 * d; const t = km(Math.hypot(m.x - this.player.x, m.z - this.player.z)); ctx.strokeText(t, x, y + 10 * d); ctx.fillText(t, x, y + 10 * d); }
    }
    // vehicle and player
    if (!this.player.inVeh) { const [a, b] = this.toScreen(this.player.vx, this.player.vz); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * d; ctx.fillRect(a - 4 * d, b - 4 * d, 8 * d, 8 * d); ctx.strokeRect(a - 4 * d, b - 4 * d, 8 * d, 8 * d); }
    const [px, py] = this.toScreen(this.player.x, this.player.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(this.player.bearing * Math.PI / 180);
    ctx.shadowColor = '#5cff6a'; ctx.shadowBlur = 12 * d; ctx.fillStyle = '#5cff6a'; ctx.strokeStyle = '#0a2a0a'; ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.moveTo(0, -14 * d); ctx.lineTo(10 * d, 10 * d); ctx.lineTo(0, 4 * d); ctx.lineTo(-10 * d, 10 * d); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
    ctx.restore();
    // scale bar
    const nice = [50, 100, 200, 500, 1000, 2000, 5000, 10000], target = 140 * d * v.mpp, len = nice.find(n => n >= target * 0.6) ?? 10000;
    const bx = 285 * d, by = H - 104 * d;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx - 8 * d, by - 16 * d, len / v.mpp + 16 * d, 26 * d);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * d; ctx.beginPath(); ctx.moveTo(bx, by - 4 * d); ctx.lineTo(bx, by + 2 * d); ctx.lineTo(bx + len / v.mpp, by + 2 * d); ctx.lineTo(bx + len / v.mpp, by - 4 * d); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `600 ${11 * d}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(km(len), bx + len / v.mpp / 2, by - 7 * d);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ------------------------------------------------------------------ inset and compass
  private insetBase: HTMLCanvasElement | null = null;
  private drawInsetBase() {
    if (!this.base || !this.meta) return;
    const c = document.createElement('canvas'); c.width = this.inset.width; c.height = this.inset.height;
    const g = c.getContext('2d')!, b = this.base, s = Math.min(c.width / (b.x1 - b.x0), c.height / (b.z1 - b.z0));
    const ox = (c.width - (b.x1 - b.x0) * s) / 2, oz = (c.height - (b.z1 - b.z0) * s) / 2;
    g.fillStyle = '#0d2a4a'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(b.canvas, ox, oz, (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
    for (const r of REG_ORDER) {
      const B = this.meta.borders[r]; g.beginPath();
      for (let k = 0; k < B.length; k += 4) { g.moveTo(ox + (B[k] - b.x0) * s, oz + (B[k + 1] - b.z0) * s); g.lineTo(ox + (B[k + 2] - b.x0) * s, oz + (B[k + 3] - b.z0) * s); }
      g.strokeStyle = REGION_BY_ID[r].color; g.globalAlpha = 0.8; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1;
    }
    this.insetBase = c; (this as unknown as { insetT: number[] }).insetT = [ox, oz, s];
  }
  private drawInset() {
    if (!this.insetBase || !this.base) return;
    const g = this.inset.getContext('2d')!, [ox, oz, s] = (this as unknown as { insetT: number[] }).insetT, b = this.base;
    g.drawImage(this.insetBase, 0, 0);
    const W = this.canvas.width, H = this.canvas.height, v = this.view;
    const x0 = ox + (v.cx - W / 2 * v.mpp - b.x0) * s, z0 = oz + (v.cz - H / 2 * v.mpp - b.z0) * s;
    g.strokeStyle = '#ffc62a'; g.lineWidth = 2; g.strokeRect(x0, z0, W * v.mpp * s, H * v.mpp * s);
    g.fillStyle = '#5cff6a'; g.beginPath(); g.arc(ox + (this.player.x - b.x0) * s, oz + (this.player.z - b.z0) * s, 3, 0, 7); g.fill();
  }
  private drawCompass() {
    const c = this.root.querySelector('#wm-compass') as HTMLCanvasElement, g = c.getContext('2d')!, R = 52, X = 60, Y = 60;
    g.clearRect(0, 0, 120, 120);
    g.fillStyle = 'rgba(8,14,22,0.75)'; g.beginPath(); g.arc(X, Y, R + 4, 0, 7); g.fill();
    g.strokeStyle = '#8fb8d8'; g.lineWidth = 2; g.beginPath(); g.arc(X, Y, R, 0, 7); g.stroke();
    for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, l = k % 4 === 0 ? 10 : 5; g.beginPath(); g.moveTo(X + Math.sin(a) * R, Y - Math.cos(a) * R); g.lineTo(X + Math.sin(a) * (R - l), Y - Math.cos(a) * (R - l)); g.stroke(); }
    const star = (a: number, len: number, col: string) => { g.fillStyle = col; g.beginPath(); g.moveTo(X + Math.sin(a) * len, Y - Math.cos(a) * len); g.lineTo(X + Math.sin(a + Math.PI / 2) * 7, Y - Math.cos(a + Math.PI / 2) * 7); g.lineTo(X, Y); g.closePath(); g.fill(); g.beginPath(); g.moveTo(X + Math.sin(a) * len, Y - Math.cos(a) * len); g.lineTo(X + Math.sin(a - Math.PI / 2) * 7, Y - Math.cos(a - Math.PI / 2) * 7); g.lineTo(X, Y); g.closePath(); g.fill(); };
    star(Math.PI / 2, 30, '#c9d3dc'); star(-Math.PI / 2, 30, '#c9d3dc'); star(Math.PI, 38, '#e8eef2'); star(0, 42, '#e23b2e');
    g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', X, Y - R + 16); g.fillText('S', X, Y + R - 14); g.fillText('E', X + R - 14, Y); g.fillText('W', X - R + 14, Y);
  }

  // ------------------------------------------------------------------ panels
  renderPanels() {
    const title = this.root.querySelector('#wm-title') as HTMLElement, info = this.root.querySelector('#wm-info') as HTMLElement, leg = this.root.querySelector('#wm-legend') as HTMLElement;
    const M = this.meta, pct = (f: number) => `${(f * 100).toFixed(f > 0 && f < 0.1 ? 1 : 0)}%`;
    const bar = (f: number) => `<div class="wm-bar"><div style="width:${Math.max(1, f * 100)}%"></div></div>`;
    const builtPois = this.island.pois.filter(p => p.built).length;
    if (!this.region) {
      const total = M ? REG_ORDER.reduce((a, r) => a + M.stats[r].area, 0) : 0, ex = this.exploredFraction(null);
      title.innerHTML = `<div class="wm-h1">WORLD MAP</div>
        <div class="wm-row"><span>Total World Area</span><b>${M ? fmt(total) : '…'} km²</b></div>
        <div class="wm-row"><span>Exploration Progress</span><b class="gold">${pct(ex)}</b></div>${bar(ex)}`;
      info.innerHTML = `<div class="wm-h2">REGIONS OVERVIEW</div>` + REG_ORDER.map(r => {
        const g = REGION_BY_ID[r], s = M?.stats[r];
        return `<div class="wm-reg" data-region="${r}"><canvas data-glyph="${r}" width="34" height="34"></canvas><div><b style="color:${g.color}">${g.name}</b><small>${s ? fmt(s.area) : g.area} km² | LV. ${g.lv[0]} – ${g.lv[1]}</small></div></div>`;
      }).join('') + `<div class="wm-note">${builtPois} of ${this.island.pois.length} places are built in 3D. The rest are on the map (dashed ring) and are coming in later updates.</div>`;
    } else {
      const g = REGION_BY_ID[this.region], s = M?.stats[this.region], ex = this.exploredFraction(this.region);
      title.innerHTML = `<div class="wm-h1" style="color:${g.color}">${g.name.toUpperCase()}</div>
        <div class="wm-row"><span>Exploration Progress</span><b class="gold">${pct(ex)}</b></div>${bar(ex)}`;
      const pois = this.island.poisIn(this.region);
      const rows = LEGEND.map(l => { const ps = pois.filter(p => l.kinds.includes(p.kind)); return ps.length ? { l, n: ps.length, built: ps.filter(p => p.built).length } : null; }).filter(Boolean) as { l: typeof LEGEND[0]; n: number; built: number }[];
      info.innerHTML = `<div class="wm-h2">REGION INFO</div>
        <div class="wm-kv"><span>Area Size</span><b>${s ? fmt(s.area) : g.area} km²</b></div>
        <div class="wm-kv"><span>Elevation</span><b>${s ? `${fmt(s.minH)} – ${fmt(s.maxH)} m` : '…'}</b></div>
        <div class="wm-kv"><span>Terrain Type</span><b>${g.terrain}</b></div>
        <div class="wm-kv"><span>Major Habitat</span><b>${g.habitat}</b></div>
        <div class="wm-kv"><span>Difficulty</span><b class="gold">${g.difficulty}</b></div>
        <div class="wm-kv"><span>Recommended LV</span><b>${g.lv[0]} – ${g.lv[1]}</b></div>
        ${this.detailsOn ? `<div class="wm-h2" style="margin-top:12px">KEY LOCATIONS (${pois.length})</div>` + rows.map(r => `<div class="wm-key"><canvas data-icon="${r.l.kinds[0]}" width="26" height="26"></canvas><span>${r.l.label}</span><b>${r.n}</b></div>`).join('')
          + `<div class="wm-note">${pois.filter(p => p.built).length ? `${pois.filter(p => p.built).length} built in 3D, ${pois.filter(p => !p.built).length} planned.` : 'Planned: this region is mapped but not built in 3D yet.'}</div>` : ''}`;
    }
    leg.classList.toggle('hidden', !this.legendOn);
    leg.innerHTML = `<div class="wm-h2">MAP LEGEND</div>` + LEGEND.filter(l => this.island.pois.some(p => l.kinds.includes(p.kind))).map(l => `<div class="wm-key"><canvas data-icon="${l.kinds[0]}" width="22" height="22"></canvas><span>${l.label}</span></div>`).join('') +
      `<div class="wm-key"><i class="ln hw"></i><span>Main Highway</span></div><div class="wm-key"><i class="ln rd"></i><span>Regional Road</span></div><div class="wm-key"><i class="ln tr"></i><span>Off-Road Trail</span></div><div class="wm-key"><i class="ln rv"></i><span>River / Water Route</span></div><div class="wm-key"><i class="ln bd"></i><span>Region Boundary</span></div>
      <div class="wm-key"><canvas data-icon="village" data-dim="1" width="22" height="22"></canvas><span>Dashed ring: planned, not built yet</span></div>`;
    this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-icon]').forEach(c => { const g = c.getContext('2d')!; g.clearRect(0, 0, c.width, c.height); drawIcon(g, c.dataset.icon as Poi['kind'], c.width / 2, c.height / 2, c.width / 2 - 2, !!c.dataset.dim); });
    this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-glyph]').forEach(c => { const g = c.getContext('2d')!; drawRegionGlyph(g, c.dataset.glyph!, 17, 17, 12, REGION_BY_ID[c.dataset.glyph as RegionId].color); });
    void ICON_COLOR; void REGIONS;
  }
}
