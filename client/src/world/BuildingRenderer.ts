import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Terrain, mulberry32, type Building } from '@orl/shared';

/** Facade tile styles: one window bay by one storey, repeated over the walls. */
type Facade = 'glass' | 'office' | 'flat' | 'shopfront' | 'house' | 'planks' | 'plain' | 'roof' | 'tiles';
const TILE: Record<Facade, [number, number]> = { // metres per tile (across, up)
  glass: [3, 3.6], office: [3.6, 3.6], flat: [3.2, 3.2], shopfront: [4.5, 4.2], house: [3, 3], planks: [2, 3], plain: [4, 4], roof: [6, 6], tiles: [2, 2],
};

/** Procedural facade textures, 128 px per tile, light where the wall is (vertex colour tints it). */
function facadeTexture(kind: Facade): Uint8Array {
  const S = 128, d = new Uint8Array(S * S * 4), rnd = mulberry32(kind.length * 977 + kind.charCodeAt(0));
  const put = (x: number, y: number, r: number, g: number, b: number) => { const i = (y * S + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, n = rnd() * 10; // v = 0 at the floor line
    let c: [number, number, number];
    const glass = (k: number): [number, number, number] => [40 + k * 30 + v * 30, 58 + k * 30 + v * 40, 72 + k * 34 + v * 50];
    switch (kind) {
      case 'glass': {
        const mull = u < 0.03 || u > 0.97 || (v > 0.9 && v < 0.96);
        c = mull ? [70, 74, 78] : glass(0.6 + (u * 0.3));
        break;
      }
      case 'office': c = v < 0.32 ? [200 + n, 198 + n, 190 + n] : (u % 0.5 < 0.02 ? [60, 64, 66] : glass(0.4)); break;
      case 'flat': {
        const win = u > 0.25 && u < 0.75 && v > 0.3 && v < 0.82, frame = u > 0.22 && u < 0.78 && v > 0.27 && v < 0.85;
        const sill = u > 0.2 && u < 0.8 && v > 0.25 && v < 0.3;
        c = win ? (Math.abs(u - 0.5) < 0.015 ? [220, 220, 215] : glass(0.25)) : sill ? [150, 148, 140] : frame ? [235, 235, 230] : [220 + n, 214 + n, 200 + n];
        break;
      }
      case 'shopfront': {
        const sign = v > 0.78 && v < 0.94, win = u > 0.06 && u < 0.94 && v > 0.08 && v < 0.74;
        c = sign ? [250, 250, 250] : win ? (Math.abs(u - 0.5) < 0.01 ? [50, 50, 50] : glass(0.55)) : [60 + n, 62 + n, 64 + n];
        break;
      }
      case 'house': {
        const win = u > 0.32 && u < 0.68 && v > 0.35 && v < 0.78, frame = u > 0.3 && u < 0.7 && v > 0.33 && v < 0.8;
        c = win ? (Math.abs(u - 0.5) < 0.012 || Math.abs(v - 0.56) < 0.012 ? [240, 240, 235] : glass(0.2)) : frame ? [245, 245, 240] : [225 + n, 218 + n, 200 + n];
        break;
      }
      case 'planks': { const seam = (u * 8) % 1 < 0.06; c = seam ? [120, 110, 100] : [200 + n, 190 + n, 180 + n]; break; }
      case 'roof': c = [120 + n * 2, 118 + n * 2, 112 + n * 2]; break;
      case 'tiles': { const row = (v * 6) % 1, col = (u * 4 + (Math.floor(v * 6) % 2) * 0.5) % 1; c = row < 0.12 || col < 0.05 ? [120, 110, 105] : [205 + n, 200 + n, 195 + n]; break; }
      default: c = [215 + n, 212 + n, 205 + n];
    }
    put(x, y, c[0], c[1], c[2]);
  }
  return d;
}

const WALL_TINTS: Record<string, [number, number, number][]> = {
  flat: [[0.95, 0.9, 0.8], [0.85, 0.78, 0.68], [0.9, 0.88, 0.85], [0.75, 0.62, 0.5], [0.92, 0.84, 0.7]],
  house: [[1, 0.96, 0.86], [0.95, 0.86, 0.72], [0.85, 0.9, 0.86], [0.98, 0.92, 0.9], [0.8, 0.74, 0.66], [0.92, 0.95, 1]],
  shop: [[0.85, 0.2, 0.15], [0.15, 0.4, 0.75], [0.2, 0.6, 0.3], [0.95, 0.65, 0.1], [0.55, 0.25, 0.6]],
};

class Batch {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  constructor(readonly facade: Facade) {}
  /** A quad from p0 (bottom-left seen from outside) along `u` (horizontal) and up `vv`, normal n. */
  quad(p: number[], u: number[], vv: number[], n: number[], c: number[], uv0 = [0, 0]) {
    const [tw, th] = TILE[this.facade], lu = Math.hypot(u[0], u[1], u[2]), lv = Math.hypot(vv[0], vv[1], vv[2]);
    const b = this.pos.length / 3;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [a, e] of corners) {
      this.pos.push(p[0] + u[0] * a + vv[0] * e, p[1] + u[1] * a + vv[1] * e, p[2] + u[2] * a + vv[2] * e);
      this.nrm.push(n[0], n[1], n[2]); this.uv.push(uv0[0] + (a * lu) / tw, uv0[1] + (e * lv) / th); this.col.push(c[0], c[1], c[2], 1);
    }
    // counter-clockwise seen from the outside, in the right-handed scene
    this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  tri(p: number[][], n: number[], c: number[]) {
    const b = this.pos.length / 3;
    for (const q of p) { this.pos.push(q[0], q[1], q[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(q[0] / 4, q[1] / 4); this.col.push(c[0], c[1], c[2], 1); }
    this.idx.push(b, b + 2, b + 1);
  }
}

/**
 * Settlement buildings (original procedural designs): glass towers, offices, apartment blocks, shops, houses and a
 * barn, built from the shared building list so the walls are exactly where the colliders are. Walls of one facade
 * style across the whole map share one mesh and material; vertex colours give each building its own paint.
 */
export class BuildingRenderer {
  readonly meshes: Mesh[] = [];

  constructor(private scene: Scene, private t: Terrain) {
    const batches = new Map<Facade, Batch>();
    const B = (f: Facade) => { let b = batches.get(f); if (!b) { b = new Batch(f); batches.set(f, b); } return b; };
    const rnd = mulberry32(4242);
    for (const b of t.buildings) this.building(b, B, rnd);
    this.lots(B);
    const props: Partial<Record<Facade, { rough: number; metal: number }>> = { glass: { rough: 0.12, metal: 0.55 }, office: { rough: 0.3, metal: 0.25 }, shopfront: { rough: 0.25, metal: 0.2 } };
    for (const [f, b] of batches) {
      const m = new PBRMaterial(`facade-${f}`, this.scene);
      const tex = new RawTexture(facadeTexture(f), 128, 128, Constants.TEXTUREFORMAT_RGBA, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE; tex.anisotropicFilteringLevel = 8;
      m.albedoTexture = tex; m.roughness = props[f]?.rough ?? 0.85; m.metallic = props[f]?.metal ?? 0; m.environmentIntensity = f === 'glass' ? 1 : 0.4;
      m.maxSimultaneousLights = 4;
      const vd = new VertexData(); vd.positions = b.pos; vd.normals = b.nrm; vd.uvs = b.uv; vd.colors = b.col; vd.indices = b.idx;
      const mesh = new Mesh(`buildings-${f}`, this.scene); vd.applyToMesh(mesh); mesh.material = m;
      mesh.receiveShadows = true; mesh.isPickable = false; mesh.freezeWorldMatrix();
      this.meshes.push(mesh);
    }
  }

  /** Four walls of an axis-aligned box from y0 to y1, plus an optional top. */
  private walls(b: Batch, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: number[], top?: Batch, topC?: number[]) {
    const h = y1 - y0;
    b.quad([x1, y0, z0], [x0 - x1, 0, 0], [0, h, 0], [0, 0, -1], c);  // north face (-Z)
    b.quad([x0, y0, z1], [x1 - x0, 0, 0], [0, h, 0], [0, 0, 1], c);   // south face (+Z)
    b.quad([x0, y0, z0], [0, 0, z1 - z0], [0, h, 0], [-1, 0, 0], c);  // west face (-X)
    b.quad([x1, y0, z1], [0, 0, z0 - z1], [0, h, 0], [1, 0, 0], c);   // east face (+X)
    if (top) top.quad([x0, y1, z1], [x1 - x0, 0, 0], [0, 0, z0 - z1], [0, 1, 0], topC ?? c);
  }

  private building(b: Building, B: (f: Facade) => Batch, rnd: () => number) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y - 0.6, y1 = b.y + b.h;
    const grey = [0.78, 0.78, 0.76], white = [1, 1, 1];
    const pick = (list: [number, number, number][]) => list[b.style % list.length];
    const roof = B('roof');
    const parapet = (c: number[]) => {
      const p = 0.35;
      this.walls(B('plain'), x0, z0, x1, z1, y1, y1 + 0.9, c);
      // inner faces of the parapet and the roof deck
      roof.quad([x0 + p, y1 + 0.05, z1 - p], [x1 - x0 - 2 * p, 0, 0], [0, 0, -(z1 - z0 - 2 * p)], [0, 1, 0], [0.9, 0.9, 0.9]);
      roof.quad([x0, y1 + 0.9, z1], [x1 - x0, 0, 0], [0, 0, -(z1 - z0)], [0, 1, 0], [0.75, 0.75, 0.75]);
    };
    switch (b.kind) {
      case 'tower': {
        const tint = [[0.85, 0.95, 1], [0.95, 1, 0.95], [1, 0.95, 0.88], [0.9, 0.9, 1]][b.style % 4];
        this.walls(B('shopfront'), x0, z0, x1, z1, y0, b.y + 4.2, [0.3, 0.32, 0.35]);
        this.walls(B('glass'), x0, z0, x1, z1, b.y + 4.2, y1, tint);
        parapet([0.35, 0.37, 0.4]);
        // rooftop plant room
        const mw = b.w * 0.35, md = b.d * 0.35;
        this.walls(B('plain'), b.x - mw / 2, b.z - md / 2, b.x + mw / 2, b.z + md / 2, y1, y1 + 4, grey, roof, [0.7, 0.7, 0.7]);
        break;
      }
      case 'office': this.walls(B('office'), x0, z0, x1, z1, y0, y1, pick(WALL_TINTS.flat)); parapet(grey); break;
      case 'apartment': this.walls(B('flat'), x0, z0, x1, z1, y0, y1, pick(WALL_TINTS.flat)); if (b.roof === 'gable') this.gable(b, B, pick(WALL_TINTS.flat)); else parapet(pick(WALL_TINTS.flat)); break;
      case 'shop': case 'station': {
        const g = Math.min(b.h, 4.2);
        this.walls(B('shopfront'), x0, z0, x1, z1, y0, b.y + g, pick(WALL_TINTS.shop));
        if (b.h > g + 1) this.walls(B('flat'), x0, z0, x1, z1, b.y + g, y1, pick(WALL_TINTS.flat));
        else this.walls(B('plain'), x0, z0, x1, z1, b.y + g, y1, white);
        if (b.roof === 'gable') this.gable(b, B, pick(WALL_TINTS.flat)); else parapet(white);
        break;
      }
      case 'house': this.walls(B('house'), x0, z0, x1, z1, y0, y1, pick(WALL_TINTS.house)); this.gable(b, B, pick(WALL_TINTS.house)); break;
      case 'barn': this.walls(B('planks'), x0, z0, x1, z1, y0, y1, [0.62, 0.16, 0.12]); this.gable(b, B, [0.62, 0.16, 0.12]); break;
    }
    void rnd;
  }

  /** Pitched roof with the ridge along the longer side, overhanging eaves and walled gables. */
  private gable(b: Building, B: (f: Facade) => Batch, wallC: number[]) {
    const tiles = B('tiles'), plain = B('plain'), y1 = b.y + b.h, o = 0.45;
    const tc = [[0.55, 0.22, 0.16], [0.3, 0.3, 0.32], [0.45, 0.3, 0.22]][b.style % 3];
    const alongX = b.w >= b.d, L = (alongX ? b.w : b.d) / 2, S = (alongX ? b.d : b.w) / 2, rh = Math.min(S * 0.75, 4);
    const P = (a: number, s: number, y: number) => alongX ? [b.x + a, y, b.z + s] : [b.x + s, y, b.z + a];
    const sl = Math.hypot(S + o, rh + o * (rh / S));
    for (const side of [-1, 1]) {
      // eave (outer, low) to ridge (centre, high)
      const eave = P(-(L + o), side * (S + o), y1 - o * (rh / S)), ridge = P(-(L + o), 0, y1 + rh);
      const along = alongX ? [2 * (L + o), 0, 0] : [0, 0, 2 * (L + o)];
      const up = [ridge[0] - eave[0], ridge[1] - eave[1], ridge[2] - eave[2]];
      const nn = alongX ? [0, (S + o) / sl, side * rh / sl] : [side * rh / sl, (S + o) / sl, 0];
      // order the quad so it faces outwards
      if ((alongX ? side > 0 : side < 0)) tiles.quad(eave, along, up, nn, tc);
      else tiles.quad([eave[0] + along[0], eave[1], eave[2] + along[2]], [-along[0], 0, -along[2]], up, nn, tc);
    }
    for (const end of [-1, 1]) {
      const a = end * L, pts = [P(a, -S, y1), P(a, S, y1), P(a, 0, y1 + rh)];
      const n = alongX ? [end, 0, 0] : [0, 0, end];
      // winding: outward normal
      if ((alongX ? end > 0 : end < 0)) plain.tri([pts[0], pts[1], pts[2]], n, wallC); else plain.tri([pts[1], pts[0], pts[2]], n, wallC);
    }
  }

  /** Forecourt canopies over the pumps and painted bays in the car parks. */
  private lots(B: (f: Facade) => Batch) {
    const t = this.t, plain = B('plain'), roof = B('roof');
    for (const l of t.lots) {
      const inLot = (p: { x: number; z: number }) => p.x >= l.x0 && p.x <= l.x1 && p.z >= l.z0 && p.z <= l.z1;
      const pumps = t.fuelPumps.filter(inLot);
      let cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
      if (l.kind === 'fuel' && pumps.length) { cx = pumps.reduce((a, p) => a + p.x, 0) / pumps.length; cz = pumps[0].z; }
      if (l.kind === 'cars') { const sp = t.parking.find(inLot); if (sp) cz = sp.z; }
      const y = t.heightAt(cx, cz);
      if (l.kind === 'fuel') {
        const x0 = cx - 9, x1 = cx + 9, z0 = cz - 4.5, z1 = cz + 4.5, h = 5.2;
        this.walls(plain, x0, z0, x1, z1, y + h, y + h + 0.7, [0.95, 0.95, 0.95], roof, [0.8, 0.8, 0.8]);
        plain.quad([x0, y + h, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0], [0, -1, 0], [0.9, 0.9, 0.88]); // underside
        for (const px of [x0 + 1, x1 - 1]) for (const pz of [z0 + 1, z1 - 1]) this.walls(plain, px - 0.18, pz - 0.18, px + 0.18, pz + 0.18, y - 0.3, y + h, [0.85, 0.85, 0.85]);
      } else {
        // white bay lines between the parking spots of this lot
        const spots = t.parking.filter(p => p.x >= l.x0 && p.x <= l.x1 && p.z >= l.z0 && p.z <= l.z1);
        if (!spots.length) continue;
        const gap = spots.length > 1 ? Math.abs(spots[1].x - spots[0].x) : 5;
        for (const p of [...spots.map(s => s.x - gap / 2), spots[spots.length - 1].x + gap / 2]) {
          const yy = t.heightAt(p, cz) + 0.04;
          plain.quad([p - 0.07, yy, cz + 2.8], [0.14, 0, 0], [0, 0, -5.6], [0, 1, 0], [1.4, 1.4, 1.4]);
        }
      }
    }
  }

  /** Dark paving for the forecourts and car parks (the terrain under them is paved for the physics too). */
  static lotPaving(scene: Scene, t: Terrain): Mesh[] {
    const m = new PBRMaterial('lot-paving', scene); m.albedoColor = new Color3(0.2, 0.2, 0.21); m.roughness = 0.9; m.metallic = 0; m.environmentIntensity = 0.3;
    return t.lots.map(l => {
      const w = l.x1 - l.x0, d = l.z1 - l.z0, K = Math.max(2, Math.round(Math.max(w, d) / 4));
      const g = MeshBuilder.CreateGround('lot', { width: w, height: d, subdivisions: K, updatable: true }, scene);
      const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
      const p = g.getVerticesData('position')!;
      for (let i = 0; i < p.length; i += 3) p[i + 1] = t.heightAt(cx + p[i], cz + p[i + 2]) + 0.03;
      g.updateVerticesData('position', p); g.position.set(cx, 0, cz); g.material = m; g.receiveShadows = true; g.isPickable = false; g.freezeWorldMatrix();
      return g;
    });
  }
}
