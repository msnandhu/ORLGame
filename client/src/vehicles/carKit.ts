import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import earcut from 'earcut';
import { Body, Greenhouse, buildLoft, stations, type BodySpec, type GreenhouseSpec, type Cell, type Pt } from './loft';

/** Materials shared by every car in a scene (paint and lamps are per car). */
export interface SharedMats {
  trim: PBRMaterial; gloss: PBRMaterial; chrome: PBRMaterial; steel: PBRMaterial; glass: PBRMaterial; interior: PBRMaterial;
  housing: PBRMaterial; grille: PBRMaterial; mesh: PBRMaterial; plate: PBRMaterial; rubber: PBRMaterial; amber: PBRMaterial;
  tyre: PBRMaterial; carbon: PBRMaterial; disc: PBRMaterial;
}
export interface CarMats extends SharedMats {
  paint: PBRMaterial; accent: PBRMaterial; head: PBRMaterial; drl: PBRMaterial; brake: PBRMaterial; reverse: PBRMaterial; caliper: PBRMaterial; rim: PBRMaterial;
}

const shared = new WeakMap<Scene, SharedMats>();

function pbr(scene: Scene, n: string, c: Color3, r: number, m = 0): PBRMaterial {
  const x = new PBRMaterial(n, scene); x.albedoColor = c; x.roughness = r; x.metallic = m; return x;
}

/** Small procedural textures: honeycomb grille mesh, number plate, tyre tread with sidewall. */
function rgbaTex(scene: Scene, w: number, h: number, px: (x: number, y: number) => [number, number, number, number], name: string) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = px(x, y), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]; }
  const t = new RawTexture(d, w, h, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = name; t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE; return t;
}

export function sharedMats(scene: Scene): SharedMats {
  let s = shared.get(scene);
  if (s) return s;
  const trim = pbr(scene, 'car-trim', new Color3(0.035, 0.037, 0.04), 0.62, 0);
  const gloss = pbr(scene, 'car-gloss-black', new Color3(0.012, 0.012, 0.014), 0.12, 0); gloss.clearCoat.isEnabled = true; gloss.clearCoat.roughness = 0.05;
  const chrome = pbr(scene, 'car-chrome', new Color3(0.92, 0.93, 0.95), 0.06, 1);
  const steel = pbr(scene, 'car-steel', new Color3(0.5, 0.51, 0.53), 0.38, 0.85);
  const glass = pbr(scene, 'car-glass', new Color3(0.035, 0.045, 0.055), 0.02, 0);
  glass.alpha = 0.5; glass.useRadianceOverAlpha = true; glass.useSpecularOverAlpha = true; glass.backFaceCulling = false;
  const interior = pbr(scene, 'car-interior', new Color3(0.06, 0.058, 0.055), 0.9, 0);
  const housing = pbr(scene, 'car-lamp-housing', new Color3(0.55, 0.56, 0.58), 0.12, 1);
  // honeycomb grille insert: dark cells with lighter webs
  const hex = rgbaTex(scene, 64, 64, (x, y) => {
    const r = 8, row = Math.floor(y / (r * 0.87)), ox = (row % 2) * r, cx = ((x + ox) % (r * 2)) - r, cy = (y % (r * 0.87 * 2)) - r * 0.87;
    const d = Math.max(Math.abs(cx) * 0.87 + Math.abs(cy) * 0.5, Math.abs(cy)); const web = d > r * 0.66 ? 70 : 8;
    return [web, web, web + 2, 255];
  }, 'grille-mesh');
  const grille = pbr(scene, 'car-grille', Color3.White(), 0.45, 0.3); grille.albedoTexture = hex;
  const mesh = pbr(scene, 'car-mesh', Color3.White(), 0.5, 0.2); mesh.albedoTexture = hex; (mesh.albedoTexture as Texture).uScale = 2;
  const plateTex = rgbaTex(scene, 128, 32, (x, y) => {
    const border = x < 3 || x > 124 || y < 3 || y > 28;
    // block characters in an original plate format: "ORL·4X4"-like glyph blocks
    const glyph = y > 8 && y < 24 && x > 14 && x < 114 && ((x - 14) % 14) < 10 && !(((x - 14) % 14) > 3 && ((x - 14) % 14) < 7 && y > 12 && y < 20) && Math.floor((x - 14) / 14) !== 3;
    const v = border || glyph ? 30 : 236; return [v, v, v + (glyph ? 0 : 4), 255];
  }, 'plate');
  const plate = pbr(scene, 'car-plate', Color3.White(), 0.4, 0); plate.albedoTexture = plateTex;
  const rubber = pbr(scene, 'car-rubber', new Color3(0.03, 0.03, 0.03), 0.85, 0);
  const amber = pbr(scene, 'car-amber', new Color3(0.9, 0.45, 0.05), 0.15, 0); amber.emissiveColor = new Color3(0.6, 0.25, 0); amber.emissiveIntensity = 0.15;
  const carbon = pbr(scene, 'car-carbon', new Color3(0.03, 0.03, 0.035), 0.25, 0.3); carbon.clearCoat.isEnabled = true;
  const disc = pbr(scene, 'car-disc', new Color3(0.38, 0.38, 0.39), 0.45, 0.9);
  const tyre = pbr(scene, 'car-tyre', Color3.White(), 0.9, 0);
  s = { trim, gloss, chrome, steel, glass, interior, housing, grille, mesh, plate, rubber, amber, carbon, disc, tyre };
  shared.set(scene, s);
  return s;
}

export function carMats(scene: Scene, paint: Color3, accent: Color3, opts: { metallic: number; rim: Color3; rimMetal: number; caliper: Color3 }): CarMats {
  const s = sharedMats(scene);
  const p = pbr(scene, 'paint', paint, 0.32, opts.metallic);
  p.clearCoat.isEnabled = true; p.clearCoat.intensity = 1; p.clearCoat.roughness = 0.04;
  const accentM = pbr(scene, 'accent', accent, 0.3, 0.4); accentM.clearCoat.isEnabled = true;
  const head = pbr(scene, 'headlamp', new Color3(0.95, 0.96, 1), 0.08, 0); head.emissiveColor = new Color3(1, 0.97, 0.9); head.emissiveIntensity = 0.35;
  const drl = pbr(scene, 'drl', new Color3(0.9, 0.92, 0.95), 0.1, 0); drl.emissiveColor = new Color3(0.9, 0.95, 1); drl.emissiveIntensity = 1.4;
  const brake = pbr(scene, 'brakelamp', new Color3(0.32, 0.01, 0.01), 0.12, 0); brake.emissiveColor = new Color3(1, 0.04, 0.02); brake.emissiveIntensity = 0.35;
  const reverse = pbr(scene, 'reverselamp', new Color3(0.8, 0.8, 0.82), 0.1, 0); reverse.emissiveColor = new Color3(1, 1, 1); reverse.emissiveIntensity = 0;
  const caliper = pbr(scene, 'caliper', opts.caliper, 0.35, 0.2);
  const rim = pbr(scene, 'rim', opts.rim, 0.22, opts.rimMetal);
  return { ...s, paint: p, accent: accentM, head, drl, brake, reverse, caliper, rim };
}

type V3 = [number, number, number];

/** Building blocks for the car designs: primitives, surface-placed panels and the lofted body itself. */
export class Kit {
  readonly meshes: Mesh[] = [];
  readonly loose: { mesh: Mesh; region: 'front' | 'rear'; base: number }[] = [];
  body!: Body;
  gh?: Greenhouse;
  constructor(readonly scene: Scene, readonly root: TransformNode, readonly m: CarMats, readonly lite: boolean) {}

  add<T extends Mesh>(mesh: T): T { mesh.parent = this.root; this.meshes.push(mesh); return mesh; }

  box(n: string, w: number, h: number, d: number, mat: PBRMaterial, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    const b = MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, this.scene);
    b.position.set(x, y, z); b.rotation.set(rx, ry, rz); b.material = mat; return this.add(b);
  }
  cyl(n: string, r: number, len: number, mat: PBRMaterial, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', tess = 18, r2?: number) {
    const c = MeshBuilder.CreateCylinder(n, { diameterTop: (r2 ?? r) * 2, diameterBottom: r * 2, height: len, tessellation: this.lite ? Math.min(tess, 10) : tess }, this.scene);
    c.position.set(x, y, z); if (axis === 'x') c.rotation.z = Math.PI / 2; if (axis === 'z') c.rotation.x = Math.PI / 2;
    c.material = mat; return this.add(c);
  }
  tube(n: string, pts: V3[], r: number, mat: PBRMaterial, tess = 10) {
    const t = MeshBuilder.CreateTube(n, { path: pts.map(p => new Vector3(...p)), radius: r, tessellation: this.lite ? 6 : tess, cap: Mesh.CAP_ALL }, this.scene);
    t.material = mat; return this.add(t);
  }
  sphere(n: string, sx: number, sy: number, sz: number, mat: PBRMaterial, x: number, y: number, z: number) {
    const s = MeshBuilder.CreateSphere(n, { diameterX: sx, diameterY: sy, diameterZ: sz, segments: this.lite ? 6 : 12 }, this.scene);
    s.position.set(x, y, z); s.material = mat; return this.add(s);
  }

  /** Flat panel from a 2D outline in local XY, `depth` thick along local Z (centred). */
  shape(n: string, pts: Pt[], depth: number, mat: PBRMaterial): Mesh {
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; area += x0 * y1 - x1 * y0; }
    const p = area < 0 ? [...pts].reverse() : pts;
    const e = MeshBuilder.ExtrudePolygon(n, { shape: p.map(([x, y]) => new Vector3(-x, 0, y)), depth, sideOrientation: Mesh.DEFAULTSIDE }, this.scene, earcut);
    e.bakeTransformIntoVertices(Matrix.FromValues(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, depth / 2, 1));
    e.material = mat; return this.add(e);
  }

  /** Orient a mesh so its local +Z is the normal n (local +Y stays as close to `up` as possible). */
  orient(mesh: Mesh, p: V3, n: V3, up: V3 = [0, 1, 0]) {
    const nz = new Vector3(...n).normalize();
    let nx = Vector3.Cross(new Vector3(...up), nz);
    if (nx.lengthSquared() < 1e-6) nx = Vector3.Cross(new Vector3(0, 0, 1), nz);
    nx.normalize();
    const ny = Vector3.Cross(nz, nx).normalize();
    mesh.rotation = Vector3.RotationFromAxis(nx, ny, nz);
    mesh.position.set(...p);
    return mesh;
  }

  /**
   * A panel that hugs the body surface: the 2D outline (u, v) is sampled row by row and every sample is projected onto
   * the surface and lifted `out` along the normal, so lamps, grilles and vents follow a curved nose or flank.
   * Outlines must be convex along rows (rects, trapezoids, circles, lamp shapes).
   */
  private conform(n: string, at: (u: number, v: number) => V3, normal: V3, pts: Pt[], mat: PBRMaterial, out: number) {
    let v0 = Infinity, v1 = -Infinity;
    for (const [, v] of pts) { v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const rows = this.lite ? 3 : 8, cols = this.lite ? 4 : 12, eps = (v1 - v0) * 0.002;
    const paths: Vector3[][] = [];
    for (let r = 0; r <= rows; r++) {
      const v = v0 + eps + (v1 - v0 - 2 * eps) * (r / rows);
      let u0 = Infinity, u1 = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= v && by >= v) || (by <= v && ay >= v)) { const t = by === ay ? 0 : (v - ay) / (by - ay), x = ax + (bx - ax) * t; u0 = Math.min(u0, x); u1 = Math.max(u1, x); }
      }
      if (!isFinite(u0)) continue;
      const row: Vector3[] = [];
      for (let c = 0; c <= cols; c++) { const u = u0 + (u1 - u0) * (c / cols), p = at(u, v); row.push(new Vector3(p[0] + normal[0] * out, p[1] + normal[1] * out, p[2] + normal[2] * out)); }
      paths.push(row);
    }
    const m = MeshBuilder.CreateRibbon(n, { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    m.material = mat; return this.add(m);
  }

  /** Panel on the nose (dir 1) or tail (dir -1): outline in (u = world x offset, v = up) around (x, y). */
  onEnd(n: string, dir: 1 | -1, x: number, y: number, pts: Pt[], _depth: number, mat: PBRMaterial, out = 0.0) {
    const c = this.body.endPoint(x, y, dir);
    return this.conform(n, (u, v) => { const yy = y + v, xx = x + u; return [xx, yy, this.body.endZ(xx, yy, dir)]; }, c.n, pts, mat, out + 0.004);
  }
  /** Panel on the side sx at (z, y): outline in (u = world z offset, v = up). */
  onSide(n: string, sx: number, z: number, y: number, pts: Pt[], _depth: number, mat: PBRMaterial, out = 0.0) {
    const c = this.body.sidePoint(sx, z, y);
    return this.conform(n, (u, v) => { const zz = z + u, yy = y + v, xx = this.body.xAt(zz, yy); return [sx * Math.max(0, xx), yy, zz]; }, c.n, pts, mat, out + 0.003);
  }

  /** A lamp: bright housing with the lens inset, on the nose or tail. Pass the outline for the right-hand (+x) lamp. */
  lamp(n: string, dir: 1 | -1, x: number, y: number, pts: Pt[], lens: PBRMaterial, opts: { housing?: PBRMaterial; inset?: number; depth?: number; out?: number } = {}) {
    const sx = Math.sign(x) || 1, mp: Pt[] = pts.map(([u, v]) => [u * sx, v]);
    const d = opts.depth ?? 0.05, out = opts.out ?? 0.0;
    this.onEnd(n + '-housing', dir, x, y, mp, d, opts.housing ?? this.m.housing, out);
    const k = opts.inset ?? 0.82, cx = mp.reduce((s, p) => s + p[0], 0) / mp.length, cy = mp.reduce((s, p) => s + p[1], 0) / mp.length;
    return this.onEnd(n, dir, x, y, mp.map(([u, v]) => [cx + (u - cx) * k, cy + (v - cy) * k]), d, lens, out + 0.005);
  }

  /** The lofted body: paint shell, interior well, optional lower cladding. */
  buildBody(spec: BodySpec, opts: { step: number; detail: number; cladY?: number; dent: boolean; stripes?: [number, number] }) {
    this.body = new Body(spec);
    const extra: number[] = [];
    for (const a of spec.arches) extra.push(a.z - a.r - 0.004, a.z - a.r + 0.004, a.z + a.r - 0.004, a.z + a.r + 0.004);
    const zs = stations(spec.zr, spec.zf, opts.step, extra);
    const rings = zs.map(z => this.body.ring(z, opts.detail));
    const cladY = opts.cladY;
    const cab = spec.cabin, st = opts.stripes;
    const meshes = buildLoft(this.scene, 'body', zs, rings, true, (c: Cell) => {
      if (c.kind === 'inner' && cab && c.z > cab[0] && c.z < cab[1]) return 'int';
      if (cladY !== undefined && c.y < cladY && c.kind === 'lower') return 'clad';
      if (st && c.kind !== 'lower' && Math.abs(c.x) > st[0] && Math.abs(c.x) < st[1]) return 'stripe';
      return 'paint';
    }, { paint: this.m.paint, int: this.m.interior, clad: this.m.trim, stripe: this.m.accent }, { paint: 'tub', int: 'tub-int', clad: 'clad', stripe: 'tub' }, opts.dent);
    for (const mm of meshes) this.add(mm);
    return meshes;
  }

  /**
   * The glasshouse: roof, pillars and glass from one loft. `solid` lists z ranges of the side that are body (C/D pillars),
   * `bpillar` z ranges in gloss black. `roofKey` sets what the roof is made of (paint, accent, glass).
   */
  buildGreenhouse(spec: GreenhouseSpec, opts: { step: number; detail: number; solid: [number, number][]; bpillar: [number, number][]; seal: 'chrome' | 'trim'; roofMat?: PBRMaterial; pillarMat?: PBRMaterial; railA?: number; truck: boolean; stripes?: [number, number] }) {
    this.gh = new Greenhouse(spec, this.body);
    const zs = stations(spec.z1, spec.z0, opts.step);
    const rings = zs.map(z => this.gh!.ring(z, opts.detail));
    const rail = opts.railA ?? 0.6, roofA = 0.74;
    const st = opts.stripes, stripe = (c: Cell) => !!st && Math.abs(c.x) > st[0] && Math.abs(c.x) < st[1];
    const cls = (c: Cell): string => {
      const a = Math.abs(c.a);
      if (a < 0.03) return 'seal';
      if (c.z >= spec.zr0 - 0.02) {
        // windscreen: glass between the A-pillars
        if (a > 0.6) return 'glass';
        if (a > 0.47) return 'pillar';
      } else if (c.z <= spec.zr1 + 0.02) {
        // backlight / tailgate glass between the C (or D) pillars
        if (a > 0.58) return 'glass';
        if (a > 0.46) return 'pillar';
      } else {
        if (a > roofA) return stripe(c) ? 'stripe' : 'roof';
        if (a > rail) return 'pillar';
      }
      for (const [z0, z1] of opts.solid) if (c.z >= z0 && c.z <= z1) return 'pillar';
      for (const [z0, z1] of opts.bpillar) if (c.z >= z0 && c.z <= z1) return 'bpillar';
      return 'glass';
    };
    const shell = opts.truck ? 'cab' : 'roof';
    const meshes = buildLoft(this.scene, 'gh', zs, rings, false, cls, {
      roof: opts.roofMat ?? this.m.paint, pillar: opts.pillarMat ?? this.m.paint, seal: opts.seal === 'chrome' ? this.m.chrome : this.m.trim,
      bpillar: this.m.gloss, glass: this.m.glass, stripe: this.m.accent,
    }, { roof: shell, pillar: shell, seal: 'seal', bpillar: 'bpillar', glass: 'side-glass', stripe: shell }, true, true);
    for (const mm of meshes) this.add(mm);
    // headliner: the inside of the roof and pillars, so the cabin reads from inside and through the glass
    const inner = buildLoft(this.scene, 'gh-in', zs, rings, false, c => (cls(c) === 'glass' || cls(c) === 'seal' ? null : 'in'), { in: this.m.interior }, { in: 'headliner' }, false, false);
    for (const mm of inner) this.add(mm);
  }
}
