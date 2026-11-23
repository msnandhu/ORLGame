import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { OuterWorld } from '@orl/shared';
import { SPLAT_KIND, SPLAT2_KIND } from '../../rendering/TerrainMaterialPlugin';
import { log } from '../../core/logger';
import IslandWorker from './islandWorker?worker&inline';
import { NodeBuilder, nodeIndices, BASE_SIZE, TREE_LEVEL, type NodeData, type NodeRequest } from './islandNode';

interface Node {
  key: number; level: number; ix: number; iz: number; x0: number; z0: number; size: number;
  state: 'none' | 'pending' | 'ready';
  mesh: Mesh | null; trees: Mesh[]; used: number; minY: number; maxY: number;
}

const ROOT_LEVEL = 8;
const MAX_NODES = 700;

/**
 * Streams the whole island's terrain around the camera as a quadtree of 65 x 65 nodes: 128 m at 2 m spacing near
 * the camera, doubling in size and spacing with distance out to the far coast. Nodes are built by a pool of
 * workers, coarse ones first; a node is split only once all four of its children are ready, so the ground never
 * has holes. Nodes inside the detailed valley are left to its own renderer; trees come with the nearest levels.
 */
export class IslandRenderer {
  private nodes = new Map<number, Node>();
  private workers: { w: Worker; busy: number; ready: boolean }[] = [];
  private fallback: NodeBuilder | null = null;
  private queue: Node[] = [];
  private shown = new Set<Node>();
  private indices = nodeIndices();
  private frame = 0;
  private nextId = 1;
  private byId = new Map<number, Node>();
  private treeTpl: { trunk: Mesh; pine: Mesh; leaf: Mesh; jungle: Mesh };
  /** distance (in node sizes) inside which a node splits */
  splitFactor = 2.3;
  treeDensity = 1;
  /** nodes built so far (stats, tests) */
  built = 0;
  enabled = true;

  constructor(private scene: Scene, private material: Material, private outer: OuterWorld) {
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new IslandWorker(), slot = { w, busy: 0, ready: false };
        w.onmessage = (e: MessageEvent<{ type: string; d?: NodeData }>) => {
          if (e.data.type === 'ready') { slot.ready = true; return; }
          slot.busy--; this.receive(e.data.d!);
        };
        w.onerror = ev => { log.warn('island', 'Island worker failed; building on the main thread', ev); this.workers = []; };
        this.workers.push(slot);
      }
    } catch (e) {
      log.warn('island', 'Workers unavailable; island terrain builds on the main thread', e);
      this.workers = [];
    }
    // tree templates (low poly: the island's trees are seen from a vehicle, mostly at speed)
    const mat = (name: string, c: Color3) => { const m = new PBRMaterial(name, scene); m.albedoColor = c; m.metallic = 0; m.roughness = 0.95; m.environmentIntensity = 0.3; return m; };
    const bark = mat('island-bark', new Color3(0.29, 0.21, 0.15)), leaves = mat('island-leaves', new Color3(1, 1, 1));
    const trunk = MeshBuilder.CreateCylinder('it-trunk', { diameterTop: 1.1, diameterBottom: 2, height: 1, tessellation: 5 }, scene); trunk.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    const pine = Mesh.MergeMeshes([0, 1, 2].map(k => {
      const c = MeshBuilder.CreateCylinder('pc', { diameterTop: 0.05, diameterBottom: 2 * (1 - k * 0.25), height: 0.45, tessellation: 8 }, scene);
      c.position.y = 0.25 + k * 0.25; c.rotation.y = k; return c;
    }), true)!;
    const leaf = MeshBuilder.CreateIcoSphere('it-leaf', { radius: 1, subdivisions: 1, flat: true }, scene); leaf.bakeTransformIntoVertices(Matrix.Translation(0, 0.62, 0));
    const jungle = Mesh.MergeMeshes([[0, 0.75, 0, 0.8], [0.5, 0.6, 0.2, 0.55], [-0.45, 0.62, -0.2, 0.55]].map(([x, y, z, r]) => {
      const b = MeshBuilder.CreateIcoSphere('jb', { radius: r, subdivisions: 1, flat: true }, scene); b.position.set(x, y, z); return b;
    }), true)!;
    for (const [m, mm] of [[trunk, bark], [pine, leaves], [leaf, leaves], [jungle, leaves]] as const) { m.material = mm; m.setEnabled(false); m.isPickable = false; }
    this.treeTpl = { trunk, pine, leaf, jungle };
    for (let iz = -1; iz <= 0; iz++) for (let ix = -1; ix <= 0; ix++) this.node(ROOT_LEVEL, ix, iz);
  }

  private key(level: number, ix: number, iz: number) { return (level * 1024 + (ix + 512)) * 1024 + (iz + 512); }
  private node(level: number, ix: number, iz: number): Node {
    const k = this.key(level, ix, iz);
    let n = this.nodes.get(k);
    if (!n) {
      const size = BASE_SIZE << level;
      n = { key: k, level, ix, iz, x0: ix * size, z0: iz * size, size, state: 'none', mesh: null, trees: [], used: 0, minY: 0, maxY: 0 };
      this.nodes.set(k, n);
    }
    n.used = this.frame;
    return n;
  }
  /** Entirely inside the detailed valley: drawn by the valley's own renderer. */
  private insideCore(n: Node) {
    const c = this.outer.coreHalf;
    return n.x0 >= -c && n.x0 + n.size <= c && n.z0 >= -c && n.z0 + n.size <= c;
  }
  private straddlesCore(n: Node) {
    const c = this.outer.coreHalf;
    return !this.insideCore(n) && n.x0 < c && n.x0 + n.size > -c && n.z0 < c && n.z0 + n.size > -c;
  }
  /** Island land is only within these bounds (plus sea): nodes entirely outside are skipped. */
  private offIsland(n: Node) {
    const I = this.outer.island;
    return n.x0 > I.maxX || n.x0 + n.size < I.minX || n.z0 > I.maxZ || n.z0 + n.size < I.minZ;
  }
  private request(n: Node, cam: Vector3) {
    if (n.state !== 'none') return;
    n.state = 'pending';
    (n as Node & { prio: number }).prio = Math.hypot(n.x0 + n.size / 2 - cam.x, n.z0 + n.size / 2 - cam.z) / n.size - n.level * 0.5;
    this.queue.push(n);
  }

  /** Pick the nodes to draw for this camera, request missing ones and swap meshes. */
  update(cam: Vector3) {
    if (!this.enabled) { for (const n of this.shown) this.show(n, false); this.shown.clear(); return; }
    this.frame++;
    const want = new Set<Node>();
    const visit = (n: Node) => {
      if (this.insideCore(n) || this.offIsland(n)) return;
      if (n.state !== 'ready') { this.request(n, cam); return; }
      const dx = Math.max(n.x0 - cam.x, 0, cam.x - n.x0 - n.size), dz = Math.max(n.z0 - cam.z, 0, cam.z - n.z0 - n.size);
      const dy = Math.max(0, cam.y - n.maxY, n.minY - cam.y);
      const d = Math.hypot(dx, dz, dy * 0.5);
      // split near the camera, and down to 256 m along the valley edge when it is in sight (coarse nodes would cross it)
      const split = n.level > 0 && (d < n.size * this.splitFactor || (this.straddlesCore(n) && n.level > 1 && d < 5000));
      if (split) {
        const kids: Node[] = [];
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) kids.push(this.node(n.level - 1, n.ix * 2 + i, n.iz * 2 + j));
        const live = kids.filter(k => !this.insideCore(k) && !this.offIsland(k));
        live.forEach(k => this.request(k, cam));
        if (live.every(k => k.state === 'ready')) { live.forEach(visit); return; }
      }
      want.add(n);
    };
    for (let iz = -1; iz <= 0; iz++) for (let ix = -1; ix <= 0; ix++) visit(this.node(ROOT_LEVEL, ix, iz));
    for (const n of this.shown) if (!want.has(n)) this.show(n, false);
    for (const n of want) if (!this.shown.has(n)) this.show(n, true);
    this.shown = want;
    this.pump(cam);
    if (this.nodes.size > MAX_NODES) this.evict();
  }

  private show(n: Node, on: boolean) {
    n.mesh?.setEnabled(on);
    for (const t of n.trees) t.setEnabled(on);
  }

  /** Hand queued nodes to idle workers, nearest and coarsest first. */
  private pump(cam: Vector3) {
    if (!this.queue.length) return;
    // drop requests for nodes that are no longer wanted
    this.queue = this.queue.filter(n => { if (this.frame - n.used > 30) { n.state = 'none'; return false; } return true; });
    for (const n of this.queue) (n as Node & { prio: number }).prio = Math.hypot(n.x0 + n.size / 2 - cam.x, n.z0 + n.size / 2 - cam.z) / n.size - n.level * 0.5;
    this.queue.sort((a, b) => (a as Node & { prio: number }).prio - (b as Node & { prio: number }).prio);
    if (this.workers.length) {
      for (const w of this.workers) {
        while (w.busy < 2 && this.queue.length) { const n = this.queue.shift()!; w.busy++; w.w.postMessage(this.req(n)); }
      }
    } else {
      // no workers: one node per frame on the main thread
      this.fallback ??= new NodeBuilder(this.outer);
      const n = this.queue.shift();
      if (n) this.receive(this.fallback.build(this.req(n)));
    }
  }
  private req(n: Node): NodeRequest {
    const id = this.nextId++; this.byId.set(id, n);
    return { id, level: n.level, ix: n.ix, iz: n.iz, trees: n.level <= TREE_LEVEL };
  }

  private receive(d: NodeData) {
    const n = this.byId.get(d.id); this.byId.delete(d.id);
    if (!n || n.state !== 'pending') return;
    const m = new Mesh(`island-${n.level}-${n.ix}-${n.iz}`, this.scene);
    const vd = new VertexData();
    vd.positions = d.pos; vd.normals = d.nrm; vd.colors = d.col; vd.indices = this.indices;
    vd.applyToMesh(m);
    m.setVerticesData(SPLAT_KIND, d.splat, false, 4);
    m.setVerticesData(SPLAT2_KIND, d.extra, false, 2);
    m.position.set(n.x0, 0, n.z0);
    m.material = this.material; m.receiveShadows = true; m.isPickable = false;
    m.freezeWorldMatrix(); m.setEnabled(false);
    n.mesh = m; n.minY = d.minY; n.maxY = d.maxY; n.state = 'ready'; this.built++;
    if (d.trees.length) n.trees = this.treeMeshes(n, d.trees);
  }

  /** Thin-instanced trunks and crowns for one node. */
  private treeMeshes(n: Node, t: Float32Array): Mesh[] {
    const buckets: Record<string, { m: number[]; c: number[] }> = { trunk: { m: [], c: [] }, pine: { m: [], c: [] }, leaf: { m: [], c: [] }, jungle: { m: [], c: [] } };
    const q = new Quaternion(), up = Vector3.Up(), mtx = new Matrix(), s = new Vector3(), p = new Vector3();
    const put = (b: string, sx: number, sy: number, yaw: number, x: number, y: number, z: number, c: Color3) => {
      s.set(sx, sy, sx); p.set(x, y, z); Quaternion.RotationAxisToRef(up, yaw, q);
      Matrix.ComposeToRef(s, q, p, mtx); mtx.copyToArray(buckets[b].m, buckets[b].m.length);
      buckets[b].c.push(c.r, c.g, c.b, 1);
    };
    const keep = Math.max(0, Math.min(1, this.treeDensity));
    for (let i = 0; i < t.length; i += 6) {
      const x = t[i], y = t[i + 1], z = t[i + 2], h = t[i + 3], r = t[i + 4], kind = t[i + 5];
      const hsh = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      if (hsh > keep) continue;
      const yaw = hsh * 37;
      put('trunk', r, h * 0.45, 0, x, y - 0.3, z, Color3.White());
      if (kind === 0) put('pine', h * 0.28, h * 1.05, yaw, x, y + h * 0.12, z, Color3.FromHSV(100 + hsh * 20, 0.45 + hsh * 0.1, 0.22 + hsh * 0.08));
      else if (kind === 1) put('leaf', h * 0.33, h * 0.42, yaw, x, y + h * 0.4, z, Color3.FromHSV(78 + hsh * 26, 0.5 + hsh * 0.12, 0.3 + hsh * 0.08));
      else put('jungle', h * 0.36, h * 0.38, yaw, x, y + h * 0.5, z, Color3.FromHSV(105 + hsh * 25, 0.62, 0.2 + hsh * 0.09));
    }
    const out: Mesh[] = [];
    for (const [k, b] of Object.entries(buckets)) {
      if (!b.m.length) continue;
      const tpl = this.treeTpl[k as keyof IslandRenderer['treeTpl']];
      const m = tpl.clone(`${k}-${n.key}`, null, true, false) as Mesh;
      m.makeGeometryUnique();
      m.thinInstanceSetBuffer('matrix', new Float32Array(b.m), 16, true);
      m.thinInstanceSetBuffer(VertexBuffer.ColorKind, new Float32Array(b.c), 4, true);
      m.thinInstanceRefreshBoundingInfo(false);
      m.receiveShadows = true; m.isPickable = false; m.setEnabled(false);
      out.push(m);
    }
    return out;
  }

  /** Free the least recently used nodes that are not on screen. */
  private evict() {
    const idle = [...this.nodes.values()].filter(n => !this.shown.has(n) && n.state === 'ready' && n.level < ROOT_LEVEL).sort((a, b) => a.used - b.used);
    for (const n of idle.slice(0, Math.max(0, this.nodes.size - MAX_NODES * 0.8))) {
      n.mesh?.dispose(); for (const t of n.trees) t.dispose();
      this.nodes.delete(n.key);
    }
  }

  /** Waits until the nodes around a point are on screen (spawn, fast travel), up to `timeoutMs`. */
  async prime(at: Vector3, timeoutMs = 20000) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      this.update(at);
      if (!this.queue.length && this.byId.size === 0 && this.shown.size > 0) return;
      await new Promise(r => setTimeout(r, 30));
    }
  }

  /** Counts for the stats line and tests. */
  stats() { return { nodes: this.nodes.size, shown: this.shown.size, queued: this.queue.length, inFlight: this.byId.size, built: this.built }; }
}
