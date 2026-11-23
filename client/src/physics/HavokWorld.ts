import { Scene } from '@babylonjs/core/scene';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import { PhysicsShapeHeightField, PhysicsShapeSphere, PhysicsShapeBox, PhysicsShapeCylinder, PhysicsShapeContainer } from '@babylonjs/core/Physics/v2/physicsShape';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import type { Terrain } from '@orl/shared';
import { log } from '../core/logger';

/** Minimal surface of the Havok WASM module we depend on. */
export type HavokModule = ConstructorParameters<typeof HavokPlugin>[1];

/**
 * Havok-backed world physics. The off-road vehicle and the character keep their own tested,
 * deterministic simulation (shared package, also used by the server); Havok provides:
 *  - static world colliders (terrain heightfield, boulders, trees, camp structures),
 *  - dynamic props (crates, barrels, loose rocks) that react to the player,
 *  - kinematic proxies that let the custom-simulated vehicle and character push props,
 *  - world raycasts for gameplay queries (camera collision, line of sight).
 */
export class HavokWorld {
  readonly plugin: HavokPlugin;
  private proxies = new Map<string, { node: TransformNode; body: PhysicsBody }>();
  readonly dynamics: { node: TransformNode; body: PhysicsBody; kind: string }[] = [];
  private ray = new PhysicsRaycastResult();

  constructor(private scene: Scene, havok: HavokModule) {
    this.plugin = new HavokPlugin(true, havok);
    scene.enablePhysics(new Vector3(0, -9.81, 0), this.plugin);
  }

  /** Builds static colliders for the whole terrain region. */
  buildStatic(t: Terrain) {
    const N = t.n;
    // Babylon's heightfield data is row-major with the Z axis reversed (verified by tests/integration/havok-world.test.ts).
    const data = new Float32Array(N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) data[(N - 1 - z) * N + x] = t.heights[z * N + x];
    const ground = new TransformNode('hk-ground', this.scene);
    const shape = new PhysicsShapeHeightField(t.size, t.size, N, N, data, this.scene);
    const body = new PhysicsBody(ground, PhysicsMotionType.STATIC, false, this.scene);
    shape.material = { friction: 0.8, restitution: 0.05 };
    body.shape = shape;

    // Boulders, trees and buildings in one static compound
    const holder = new TransformNode('hk-static', this.scene);
    const container = new PhysicsShapeContainer(this.scene);
    for (const b of t.boulders) container.addChildFromParent(holder, new PhysicsShapeSphere(new Vector3(b.x, b.y, b.z), b.r, this.scene), holder);
    for (const tr of t.trees) {
      const top = new Vector3(tr.x, tr.y + tr.h * 0.6, tr.z), base = new Vector3(tr.x, tr.y - 0.5, tr.z);
      container.addChildFromParent(holder, new PhysicsShapeCylinder(base, top, tr.r, this.scene), holder);
    }
    for (const bx of t.boxes) {
      container.addChildFromParent(holder, new PhysicsShapeBox(new Vector3(bx.cx, bx.cy, bx.cz), Quaternion.RotationAxis(Vector3.Up(), bx.yaw), new Vector3(bx.hx * 2, bx.hy * 2, bx.hz * 2), this.scene), holder);
    }
    const sb = new PhysicsBody(holder, PhysicsMotionType.STATIC, false, this.scene);
    sb.shape = container;
    log.info('physics', `Havok static world: heightfield ${N}x${N}, ${t.boulders.length} boulders, ${t.trees.length} trees, ${t.boxes.length} structures`);
  }

  /** Adds a dynamic box prop. */
  addDynamicBox(name: string, node: TransformNode, size: Vector3, mass: number, kind = 'crate') {
    const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, this.scene);
    body.shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), size, this.scene);
    body.shape.material = { friction: 0.7, restitution: 0.1 };
    body.setMassProperties({ mass });
    body.setLinearDamping(0.05); body.setAngularDamping(0.1);
    this.dynamics.push({ node, body, kind });
    node.name = name;
    return body;
  }
  addDynamicCylinder(name: string, node: TransformNode, radius: number, height: number, mass: number, kind = 'barrel') {
    const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, this.scene);
    body.shape = new PhysicsShapeCylinder(new Vector3(0, -height / 2, 0), new Vector3(0, height / 2, 0), radius, this.scene);
    body.shape.material = { friction: 0.6, restitution: 0.15 };
    body.setMassProperties({ mass });
    this.dynamics.push({ node, body, kind });
    node.name = name;
    return body;
  }

  /** Kinematic box that follows an externally simulated object (vehicle hull, character). */
  addProxy(id: string, size: Vector3) {
    const node = new TransformNode(`hk-proxy-${id}`, this.scene);
    node.rotationQuaternion = Quaternion.Identity();
    const body = new PhysicsBody(node, PhysicsMotionType.ANIMATED, false, this.scene);
    body.shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), size, this.scene);
    body.setMassProperties({ mass: 0 });
    body.disablePreStep = false;
    this.proxies.set(id, { node, body });
  }
  /** Drive a kinematic proxy toward a target transform for the next step (so contacts get proper velocity). */
  moveProxy(id: string, x: number, y: number, z: number, q: { x: number; y: number; z: number; w: number }, dt: number) {
    const p = this.proxies.get(id);
    if (!p || dt <= 0) return;
    const body = p.body;
    const target = new Vector3(x, y, z);
    const cur = p.node.position;
    // snap if teleported, otherwise use velocity-driven kinematic motion
    if (Vector3.Distance(cur, target) > 5) { p.node.position.copyFrom(target); p.node.rotationQuaternion!.set(q.x, q.y, q.z, q.w); return; }
    body.setTargetTransform(target, new Quaternion(q.x, q.y, q.z, q.w));
  }

  step(dt: number) {
    // Babylon steps physics in scene.render(); this is for headless/tests or manual stepping
    this.plugin.executeStep(dt, this.allBodies());
  }
  private allBodies() { return this.scene.transformNodes.concat(this.scene.meshes as never).map(n => n.physicsBody).filter((b): b is PhysicsBody => !!b); }

  /** World raycast against Havok colliders; returns hit distance or -1. */
  raycast(from: Vector3, to: Vector3): number {
    this.plugin.raycast(from, to, this.ray);
    return this.ray.hasHit ? Vector3.Distance(from, this.ray.hitPointWorld) : -1;
  }
  hitPoint() { return this.ray.hitPointWorld; }
}
