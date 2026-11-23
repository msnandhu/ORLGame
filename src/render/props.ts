import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { mulberry32 } from '../core/noise';

/** Instanced trees (conifers + broadleaf) and boulders. */
export function buildVegetation(t: Terrain) {
  const group = new THREE.Group();
  const rnd = mulberry32(42);
  const conifers = t.trees.filter(tr => tr.kind === 0), broad = t.trees.filter(tr => tr.kind === 1);
  const trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
  const coneGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) { const g = new THREE.ConeGeometry(1 - k * 0.22, 0.45, 8); g.translate(0, 0.3 + k * 0.22, 0); parts.push(g); }
    return mergeGeos(parts);
  })();
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x2b4a24, roughness: 0.9, flatShading: true });
  const blobGeo = new THREE.IcosahedronGeometry(1, 1); blobGeo.translate(0, 0.62, 0);
  jitter(blobGeo, 0.18, 7);
  const blobMat = new THREE.MeshStandardMaterial({ color: 0x3f5b25, roughness: 0.9, flatShading: true });

  const make = (geo: THREE.BufferGeometry, mat: THREE.Material, list: typeof t.trees, fn: (tr: typeof t.trees[0], m: THREE.Matrix4) => void) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((tr, i) => { fn(tr, m); im.setMatrixAt(i, m); });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  };
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const all = [...conifers, ...broad];
  make(trunkGeo, trunkMat, all, (tr, m) => { s.set(tr.r, tr.h * 0.45, tr.r); p.set(tr.x, tr.y - 0.3, tr.z); m.compose(p, q.identity(), s); });
  const cim = make(coneGeo, coneMat, conifers, (tr, m) => { const w = tr.h * 0.28; s.set(w, tr.h * 1.1, w); p.set(tr.x, tr.y + tr.h * 0.1, tr.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28); m.compose(p, q, s); });
  const bim = make(blobGeo, blobMat, broad, (tr, m) => { const w = tr.h * 0.33; s.set(w, tr.h * 0.42, w); p.set(tr.x, tr.y + tr.h * 0.38, tr.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28); m.compose(p, q, s); });
  for (let i = 0; i < conifers.length; i++) cim.setColorAt(i, c.setHSL(0.27 + rnd() * 0.05, 0.35 + rnd() * 0.15, 0.17 + rnd() * 0.07));
  for (let i = 0; i < broad.length; i++) bim.setColorAt(i, c.setHSL(0.2 + rnd() * 0.08, 0.4 + rnd() * 0.15, 0.22 + rnd() * 0.08));

  // Boulders
  const rockGeo = new THREE.IcosahedronGeometry(1, 2);
  jitter(rockGeo, 0.12, 3);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x77716b, roughness: 0.92, flatShading: true });
  const rim = new THREE.InstancedMesh(rockGeo, rockMat, t.boulders.length);
  const m = new THREE.Matrix4();
  t.boulders.forEach((b, i) => {
    // render slightly smaller than the collision sphere radius so wheels visibly sit on the surface
    s.set(b.r * (0.98 + rnd() * 0.04), b.r * 0.97, b.r * (0.98 + rnd() * 0.04));
    q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6));
    m.compose(p.set(b.x, b.y, b.z), q, s);
    rim.setMatrixAt(i, m);
    rim.setColorAt(i, c.setHSL(0.07, 0.06 + rnd() * 0.06, 0.36 + rnd() * 0.12));
  });
  rim.castShadow = true; rim.receiveShadow = true;
  rim.computeBoundingSphere();
  group.add(rim);
  return group;
}

/** Base camp visuals built from the Terrain's static colliders. */
export function buildCamp(t: Terrain) {
  const g = new THREE.Group();
  const mats: Record<string, THREE.Material> = {
    wall: new THREE.MeshStandardMaterial({ color: 0x6b4c33, roughness: 0.9 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x5b6168, roughness: 0.5, metalness: 0.6 }),
    pump: new THREE.MeshStandardMaterial({ color: 0xb2342a, roughness: 0.45 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.4, metalness: 0.8 }),
  };
  for (const b of t.boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), mats[b.kind]);
    m.position.set(b.cx, b.cy, b.cz); m.rotation.y = b.yaw; m.castShadow = m.receiveShadow = true; g.add(m);
  }
  const h = t.heightAt(0, 0);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 3), mats.pole); pad.position.set(t.fuelPump.x, h + 0.03, t.fuelPump.z); pad.receiveShadow = true; g.add(pad);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.3), new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0x8a5a00, emissiveIntensity: 1.2 }));
  screen.position.set(t.fuelPump.x, h + 1.4, t.fuelPump.z + 0.31); g.add(screen);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 8), mats.pole); floor.position.set(-18, h + 0.02, 14); floor.receiveShadow = true; g.add(floor);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3, 10, 4), new THREE.MeshStandardMaterial({ color: 0xe0782a, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(5.15, h + 8.2, -8); flag.castShadow = true; flag.name = 'flag'; g.add(flag);
  return g;
}

function jitter(geo: THREE.BufferGeometry, amt: number, seed: number) {
  const r = mulberry32(seed);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const map = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = map.get(k); if (d === undefined) { d = 1 + (r() - 0.5) * 2 * amt; map.set(k, d); }
    pos.setXYZ(i, pos.getX(i) * d, pos.getY(i) * d, pos.getZ(i) * d);
  }
  geo.computeVertexNormals();
}

export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ng = geos.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of ng) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of ng) { pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
