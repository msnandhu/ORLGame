import * as THREE from 'three';
import { Vehicle } from '../vehicle/vehicle';
import { makeTreadTexture } from './textures';

/** Original low/mid-poly model of the fictional "Ranger TX4". Origin = vehicle centre of mass. */
export class VehicleModel {
  readonly root = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  private brakeLights: THREE.MeshStandardMaterial;
  private headLights: THREE.MeshStandardMaterial;
  readonly lamps: THREE.SpotLight[] = [];

  constructor(private v: Vehicle) {
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xc2602b, roughness: 0.38, metalness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.7, metalness: 0.2 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.35, metalness: 0.85 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0f1820, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85, clearcoat: 1 });
    this.headLights = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.5 });
    this.brakeLights = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a00, emissiveIntensity: 0.3 });
    const body = new THREE.Group();
    this.root.add(body);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; body.add(m); return m;
    };
    const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    // chassis rails + skid plate
    add(B(1.1, 0.18, 4.2), dark, 0, -0.42, 0);
    add(B(1.0, 0.06, 1.2), steel, 0, -0.53, 1.0);
    // lower body tub
    add(B(1.78, 0.62, 4.3), paint, 0, -0.02, -0.05);
    // hood (slight slope)
    add(B(1.72, 0.14, 1.55), paint, 0, 0.33, 1.38, -0.05);
    // cabin
    const cab = new THREE.Shape();
    cab.moveTo(-1.95, 0); cab.lineTo(0.55, 0); cab.lineTo(0.15, 0.78); cab.lineTo(-1.9, 0.8); cab.lineTo(-1.95, 0);
    const cabGeo = new THREE.ExtrudeGeometry(cab, { depth: 1.66, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
    cabGeo.rotateY(-Math.PI / 2); cabGeo.translate(0.83, 0.29, 0);
    // after rotateY(-90°): shape x -> z, extrude z -> x
    add(cabGeo, paint, 0, 0, 0);
    // windows (thin dark panels slightly outside the cab)
    const ws = new THREE.Mesh(B(1.6, 0.66, 0.04), glass); ws.position.set(0, 0.68, 0.4); ws.rotation.x = -0.47; body.add(ws);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(B(0.04, 0.5, 1.95), glass); side.position.set(sx * 0.875, 0.75, -0.85); body.add(side);
      // fender flares
      for (const z of [this.v.spec.wheelFrontZ, this.v.spec.wheelRearZ]) add(B(0.18, 0.16, 1.15), dark, sx * 0.93, 0.18, z);
      // mirrors
      add(B(0.22, 0.14, 0.06), dark, sx * 1.0, 0.68, 0.25);
      // side steps
      add(B(0.2, 0.06, 1.7), steel, sx * 0.95, -0.36, 0.0);
    }
    const rear = new THREE.Mesh(B(1.5, 0.45, 0.04), glass); rear.position.set(0, 0.8, -1.94); body.add(rear);
    // front: grille, bumper, bull bar, lights
    add(B(1.2, 0.36, 0.06), dark, 0, 0.12, 2.16);
    add(B(1.9, 0.22, 0.28), steel, 0, -0.3, 2.22);
    add(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 8), steel, 0, 0.32, 2.36, 0, 0, Math.PI / 2);
    for (const sx of [-0.55, 0.55]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), steel, sx, 0.0, 2.36);
    for (const sx of [-0.68, 0.68]) add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 16), this.headLights, sx, 0.15, 2.17, Math.PI / 2);
    // rear: bumper, tail lights, spare wheel
    add(B(1.9, 0.22, 0.22), steel, 0, -0.3, -2.25);
    for (const sx of [-0.78, 0.78]) add(B(0.16, 0.26, 0.04), this.brakeLights, sx, 0.08, -2.2);
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 20), dark); spare.rotation.x = Math.PI / 2; spare.position.set(0, 0.25, -2.36); spare.castShadow = true; body.add(spare);
    // roof rack + light bar
    add(B(1.5, 0.05, 1.8), dark, 0, 1.16, -0.9);
    for (const sx of [-0.72, 0.72]) add(B(0.05, 0.12, 1.8), dark, sx, 1.12, -0.9);
    add(B(1.2, 0.1, 0.1), dark, 0, 1.2, 0.05);
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.16, 0.07, 0.02), this.headLights, -0.48 + i * 0.24, 1.2, 0.11);
    // snorkel (right A-pillar; vehicle right is -X)
    add(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 10), dark, -0.95, 0.65, 0.45);
    add(B(0.16, 0.12, 0.2), dark, -0.95, 1.18, 0.5);
    // jerry can rack
    add(B(0.2, 0.5, 0.35), new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.6 }), 0.92, 0.35, -1.7);

    // headlight beams
    for (const sx of [-0.68, 0.68]) {
      const l = new THREE.SpotLight(0xfff2d0, 0, 60, 0.45, 0.5, 1.2);
      l.position.set(sx, 0.15, 2.2); l.target.position.set(sx, -0.5, 12);
      body.add(l); body.add(l.target);
      this.lamps.push(l);
    }

    // wheels
    const tread = makeTreadTexture();
    tread.repeat.set(2, 1);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tread, roughness: 0.95 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.35, metalness: 0.8 });
    const R = v.spec.wheelRadius, W = v.spec.wheelWidth;
    for (let wi = 0; wi < v.wheels.length; wi++) {
      const g = new THREE.Group();
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 28, 1, true), tireMat);
      tire.rotation.z = Math.PI / 2;
      const wallGeo = new THREE.RingGeometry(R * 0.62, R, 28);
      for (const sx of [-1, 1]) { const wall = new THREE.Mesh(wallGeo, sideMat); wall.rotation.y = sx * Math.PI / 2; wall.position.x = sx * W / 2; spin.add(wall); }
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.62, W * 0.8, 16), rimMat); rim.rotation.z = Math.PI / 2;
      for (let k = 0; k < 6; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, R * 1.0, 0.07), rimMat); sp.rotation.x = (k / 6) * Math.PI; spin.add(sp); }
      tire.castShadow = true;
      spin.add(tire, rim);
      g.add(spin);
      g.userData.spin = spin;
      this.root.add(g);
      this.wheels.push(g);
    }
  }

  setHeadlights(on: boolean) {
    for (const l of this.lamps) l.intensity = on ? 40 : 0;
    this.headLights.emissiveIntensity = on ? 3 : 0.6;
  }

  sync() {
    const v = this.v, b = v.body;
    this.root.position.copy(b.pos);
    this.root.quaternion.copy(b.quat);
    const s = v.spec;
    v.wheels.forEach((w, i) => {
      const g = this.wheels[i];
      g.position.set(w.mount.x, w.mount.y - (s.restLength - w.compression) + w.mudSink, w.mount.z);
      g.rotation.y = -w.steer;
      (g.userData.spin as THREE.Group).rotation.x = w.rotation;
    });
    this.brakeLights.emissiveIntensity = v.lastInput.brake > 0.1 && v.gear > 0 || v.lastInput.throttle > 0.1 && v.gear < 0 ? 2.5 : 0.3;
  }
}
