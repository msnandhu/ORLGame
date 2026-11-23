import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Character } from '@orl/shared';

/**
 * Placeholder explorer character built from primitives with procedural animation.
 * Animation is blended: walk ↔ run by speed, plus crouch and airborne poses eased over time.
 */
export class CharacterView {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private hips: TransformNode; private torso: TransformNode;
  private legs: TransformNode[] = []; private knees: TransformNode[] = [];
  private arms: TransformNode[] = []; private elbows: TransformNode[] = [];
  private crouchBlend = 0; private airBlend = 0;

  constructor(scene: Scene) {
    const mat = (n: string, c: Color3) => { const m = new PBRMaterial(n, scene); m.albedoColor = c; m.roughness = 0.8; m.metallic = 0; return m; };
    const skin = mat('skin', new Color3(0.72, 0.54, 0.42)), jacket = mat('jacket', new Color3(0.24, 0.34, 0.25));
    const pants = mat('pants', new Color3(0.33, 0.29, 0.21)), boots = mat('boots', new Color3(0.2, 0.13, 0.09));
    const belt = mat('belt', new Color3(0.12, 0.09, 0.07)), hair = mat('hair', new Color3(0.16, 0.11, 0.08));
    const cap = mat('cap', new Color3(0.76, 0.38, 0.17)), pack = mat('pack', new Color3(0.17, 0.23, 0.29));
    const node = (n: string, parent: TransformNode | null, y = 0, x = 0) => { const t = new TransformNode(n, scene); t.parent = parent; t.position.set(x, y, 0); return t; };
    const add = (m: Mesh, mt: PBRMaterial, parent: TransformNode, x = 0, y = 0, z = 0) => { m.parent = parent; m.position.set(x, y, z); m.material = mt; this.meshes.push(m); return m; };
    this.root = node('player', null);
    this.hips = node('hips', this.root, 0.95);
    this.torso = node('torso', this.hips);
    const chest = add(MeshBuilder.CreateCapsule('chest', { radius: 0.21, height: 0.8 }, scene), jacket, this.torso, 0, 0.38); chest.scaling.set(1.12, 1, 0.82);
    add(MeshBuilder.CreateCylinder('belt', { diameter: 0.4, height: 0.07, tessellation: 16 }, scene), belt, this.torso, 0, 0.04).scaling.z = 0.78;
    add(MeshBuilder.CreateTorus('collar', { diameter: 0.2, thickness: 0.06, tessellation: 16 }, scene), jacket, this.torso, 0, 0.76);
    for (const sx of [-1, 1]) add(MeshBuilder.CreateBox('strap', { width: 0.05, height: 0.5, depth: 0.03 }, scene), pack, this.torso, sx * 0.1, 0.48, 0.17).rotation.x = 0.1;
    add(MeshBuilder.CreateBox('pack', { width: 0.32, height: 0.4, depth: 0.16 }, scene), pack, this.torso, 0, 0.42, -0.24);
    const head = node('head', this.torso, 0.86);
    add(MeshBuilder.CreateCylinder('neck', { diameter: 0.11, height: 0.12, tessellation: 10 }, scene), skin, head, 0, -0.1);
    add(MeshBuilder.CreateSphere('head', { diameterX: 0.22, diameterY: 0.27, diameterZ: 0.24, segments: 14 }, scene), skin, head, 0, 0.03);
    add(MeshBuilder.CreateSphere('hair', { diameterX: 0.23, diameterY: 0.2, diameterZ: 0.25, segments: 12, slice: 0.5 }, scene), hair, head, 0, 0.06, -0.01);
    add(MeshBuilder.CreateBox('nose', { width: 0.03, height: 0.05, depth: 0.04 }, scene), skin, head, 0, 0.02, 0.12);
    add(MeshBuilder.CreateCylinder('cap', { diameter: 0.28, height: 0.07 }, scene), cap, head, 0, 0.1);
    add(MeshBuilder.CreateBox('brim', { width: 0.2, height: 0.02, depth: 0.12 }, scene), cap, head, 0, 0.075, 0.12);
    for (const sx of [-1, 1]) {
      const leg = node('leg', this.hips, 0, sx * 0.11);
      add(MeshBuilder.CreateCapsule('thigh', { radius: 0.085, height: 0.47 }, scene), pants, leg, 0, -0.22);
      const knee = node('knee', leg, -0.45);
      add(MeshBuilder.CreateCapsule('shin', { radius: 0.075, height: 0.45 }, scene), pants, knee, 0, -0.2);
      const boot = add(MeshBuilder.CreateCapsule('boot', { radius: 0.07, height: 0.28, orientation: new Vector3(0, 0, 1) }, scene), boots, knee, 0, -0.45, 0.05); boot.scaling.set(1, 0.85, 1);
      add(MeshBuilder.CreateCylinder('sole', { diameter: 0.14, height: 0.03, tessellation: 10 }, scene), belt, knee, 0, -0.5, 0.05).scaling.z = 2;
      this.legs.push(leg); this.knees.push(knee);
      const arm = node('arm', this.torso, 0.62, sx * 0.27);
      add(MeshBuilder.CreateCapsule('upper-arm', { radius: 0.065, height: 0.35 }, scene), jacket, arm, 0, -0.15);
      const elbow = node('elbow', arm, -0.32);
      add(MeshBuilder.CreateCapsule('forearm', { radius: 0.055, height: 0.31 }, scene), jacket, elbow, 0, -0.13);
      add(MeshBuilder.CreateSphere('hand', { diameter: 0.12, segments: 6 }, scene), skin, elbow, 0, -0.29);
      this.arms.push(arm); this.elbows.push(elbow);
    }
  }

  setVisible(v: boolean) { this.root.setEnabled(v); }

  sync(c: Character, dt: number) {
    this.root.position.set(c.pos.x, c.pos.y, c.pos.z);
    this.root.rotation.y = c.heading;
    const k = Math.min(1, dt * 10);
    this.crouchBlend += ((c.crouching ? 1 : 0) - this.crouchBlend) * k;
    this.airBlend += ((c.grounded ? 0 : 1) - this.airBlend) * k;
    const run = Math.min(1, c.speed / 7), moving = c.speed > 0.2 ? 1 : 0;
    const amp = moving * (0.45 + run * 0.5) * (1 - this.airBlend);
    const ph = c.animPhase, cr = this.crouchBlend, air = this.airBlend;
    this.hips.position.y = 0.95 - cr * 0.35 - Math.abs(Math.sin(ph)) * 0.04 * moving;
    this.torso.rotation.x = run * 0.25 + cr * 0.3;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const walkLeg = Math.sin(ph) * amp * s, walkKnee = Math.max(0, -Math.cos(ph) * s) * amp * 1.3;
      const airLeg = i === 0 ? -0.6 : 0.3;
      const idleCrouchLeg = -0.9 * (1 - moving), idleCrouchKnee = 1.5 * (1 - moving);
      const legA = walkLeg * (1 - air) + airLeg * air + idleCrouchLeg * cr;
      const knee = walkKnee * (1 - air) + 0.9 * air + idleCrouchKnee * cr;
      this.legs[i].rotation.x = -legA - cr * 0.4;
      this.knees[i].rotation.x = knee + cr * 0.6;
      this.arms[i].rotation.x = legA * 0.8 * (1 - 2 * air);
      this.arms[i].rotation.z = s * (0.08 + air * 0.4);
      this.elbows[i].rotation.x = -0.25 - run * 0.9;
    }
  }
}
