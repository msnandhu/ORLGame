import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import HavokPhysics from '@babylonjs/havok';
import { Terrain } from '@orl/shared';
import { HavokWorld } from '../../client/src/physics/HavokWorld';

const require = createRequire(import.meta.url);
let world: HavokWorld, scene: Scene, terrain: Terrain;

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'));
  const hk = await HavokPhysics({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  scene = new Scene(new NullEngine());
  scene.useRightHandedSystem = true;
  terrain = new Terrain();
  world = new HavokWorld(scene, hk);
  world.buildStatic(terrain);
});

describe('Havok world', () => {
  it('heightfield matches the shared terrain heights', () => {
    const pts = [[0, 0], [100, -200], [-300, 150], [250, 250], [-400, -380], [37, 411]];
    for (const [x, z] of pts) {
      const top = 400;
      const d = world.raycast(new Vector3(x, top, z), new Vector3(x, -100, z));
      const hit = top - d;
      // trees / boulders may be hit first; only compare when we hit the ground itself
      const h = terrain.heightAt(x, z);
      if (Math.abs(hit - h) > 0.05) console.log('mismatch', x, z, hit.toFixed(2), h.toFixed(2));
      expect(hit).toBeGreaterThanOrEqual(h - 0.05);
      expect(hit - h).toBeLessThan(25);
    }
    // a point well away from obstacles must match closely
    const d = world.raycast(new Vector3(3, 300, 3), new Vector3(3, -100, 3));
    expect(300 - d).toBeCloseTo(terrain.heightAt(3, 3), 1);
  });
  it('dynamic crate falls and rests on the terrain', () => {
    const node = new TransformNode('crate', scene);
    node.position.set(5, terrain.heightAt(5, -3) + 6, -3);
    world.addDynamicBox('crate', node, new Vector3(1, 1, 1), 40);
    for (let i = 0; i < 240; i++) world.step(1 / 60);
    const rest = node.position.y - terrain.heightAt(5, -3);
    expect(rest).toBeGreaterThan(0.3); expect(rest).toBeLessThan(0.8);
  });
  it('kinematic proxy pushes a dynamic crate', () => {
    const node = new TransformNode('crate2', scene);
    const h = terrain.heightAt(-20, 0);
    node.position.set(-20, h + 0.55, 0);
    world.addDynamicBox('crate2', node, new Vector3(1, 1, 1), 40);
    world.addProxy('veh', new Vector3(1.9, 1.4, 4.6));
    for (let i = 0; i < 60; i++) world.step(1 / 60);
    const x0 = node.position.x;
    for (let i = 0; i < 120; i++) {
      const px = -30 + i * 0.12; // proxy drives +X through the crate at 7.2 m/s
      world.moveProxy('veh', px, terrain.heightAt(px, 0) + 0.9, 0, { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) }, 1 / 60);
      world.step(1 / 60);
    }
    console.log('crate moved', (node.position.x - x0).toFixed(2), 'm');
    expect(node.position.x - x0).toBeGreaterThan(1);
  });
});
