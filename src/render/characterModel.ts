import * as THREE from 'three';
import { Character } from '../player/character';

/** Original stylised explorer character with procedural walk/run/crouch/jump animation. */
export class CharacterModel {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private legs: THREE.Group[] = [];
  private knees: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private elbows: THREE.Group[] = [];

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xb98a6a, roughness: 0.7 });
    const jacket = new THREE.MeshStandardMaterial({ color: 0x3e5641, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x5c5346, roughness: 0.9 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.8 });
    const cap = new THREE.MeshStandardMaterial({ color: 0xc2602b, roughness: 0.7 });
    const pack = new THREE.MeshStandardMaterial({ color: 0x2c3a4a, roughness: 0.85 });
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
    };
    this.root.add(this.hips);
    this.hips.position.y = 0.95;
    this.hips.add(this.torso);
    mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), jacket, this.torso, 0, 0.36, 0);
    mesh(new THREE.BoxGeometry(0.32, 0.4, 0.16), pack, this.torso, 0, 0.42, -0.24);
    const head = new THREE.Group(); head.position.y = 0.86; this.torso.add(head);
    mesh(new THREE.SphereGeometry(0.13, 16, 12), skin, head, 0, 0.02, 0);
    mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 16), cap, head, 0, 0.1, 0);
    mesh(new THREE.BoxGeometry(0.2, 0.02, 0.12), cap, head, 0, 0.075, 0.12);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(sx * 0.11, 0, 0); this.hips.add(leg);
      mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 8), pants, leg, 0, -0.22, 0);
      const knee = new THREE.Group(); knee.position.y = -0.45; leg.add(knee);
      mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), pants, knee, 0, -0.2, 0);
      mesh(new THREE.BoxGeometry(0.13, 0.1, 0.26), boots, knee, 0, -0.44, 0.04);
      this.legs.push(leg); this.knees.push(knee);
      const arm = new THREE.Group(); arm.position.set(sx * 0.27, 0.62, 0); this.torso.add(arm);
      mesh(new THREE.CapsuleGeometry(0.065, 0.22, 4, 8), jacket, arm, 0, -0.15, 0);
      const elbow = new THREE.Group(); elbow.position.y = -0.32; arm.add(elbow);
      mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), jacket, elbow, 0, -0.13, 0);
      mesh(new THREE.SphereGeometry(0.06, 8, 6), skin, elbow, 0, -0.29, 0);
      this.arms.push(arm); this.elbows.push(elbow);
    }
  }

  sync(c: Character, dt: number) {
    this.root.position.copy(c.pos);
    this.root.rotation.y = c.heading;
    const run = Math.min(1, c.speed / 7);
    const amp = c.speed > 0.2 ? 0.45 + run * 0.5 : 0;
    const ph = c.animPhase;
    const crouch = c.crouching ? 1 : 0;
    const tgtHip = 0.95 - crouch * 0.35 - Math.abs(Math.sin(ph)) * 0.04 * (c.speed > 0.2 ? 1 : 0);
    this.hips.position.y += (tgtHip - this.hips.position.y) * Math.min(1, dt * 12);
    this.torso.rotation.x = run * 0.25 + crouch * 0.3;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      let legA = Math.sin(ph) * amp * s;
      let knee = Math.max(0, -Math.cos(ph) * s) * amp * 1.3;
      if (!c.grounded) { legA = i === 0 ? -0.6 : 0.3; knee = 0.9; }
      if (crouch && c.speed < 0.2) { legA = -0.9; knee = 1.5; }
      this.legs[i].rotation.x = -legA - crouch * 0.4;
      this.knees[i].rotation.x = knee + crouch * 0.6;
      this.arms[i].rotation.x = legA * 0.8 * (c.grounded ? 1 : -1);
      this.arms[i].rotation.z = s * (0.08 + (c.grounded ? 0 : 0.4));
      this.elbows[i].rotation.x = -0.25 - run * 0.9;
    }
  }
}
