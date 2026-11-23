import { Scene } from '@babylonjs/core/scene';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vec3, type Vehicle } from '@orl/shared';
import { softDot } from '../assets/proceduralTextures';

/** Steam from a damaged radiator / overheating engine, dark smoke from a failing engine, debris puffs on impacts. */
export class DamageFx {
  private steam: ParticleSystem; private smoke: ParticleSystem; private debris: ParticleSystem;
  private burst = 0;
  private readonly local: Vec3;
  constructor(scene: Scene, private v: Vehicle) {
    const d = softDot();
    const tex = new RawTexture(d.data, d.width, d.height, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    const mk = (n: string, cap: number, c1: Color4, c2: Color4, life: [number, number], size: [number, number], up: number) => {
      const ps = new ParticleSystem(n, cap, scene);
      ps.particleTexture = tex; ps.emitter = new Vector3(); ps.emitRate = 0;
      ps.minLifeTime = life[0]; ps.maxLifeTime = life[1]; ps.minSize = size[0]; ps.maxSize = size[1];
      ps.direction1 = new Vector3(-0.4, up, -0.4); ps.direction2 = new Vector3(0.4, up * 1.6, 0.4);
      ps.minEmitPower = 0.6; ps.maxEmitPower = 1.6; ps.gravity = new Vector3(0, 0.6, 0);
      ps.color1 = c1; ps.color2 = c2; ps.colorDead = new Color4(c2.r, c2.g, c2.b, 0);
      ps.addSizeGradient(0, 0.5); ps.addSizeGradient(1, 2.2);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD; ps.start(); return ps;
    };
    this.steam = mk('steam', 200, new Color4(0.95, 0.95, 0.95, 0.5), new Color4(0.85, 0.87, 0.9, 0.3), [0.8, 1.8], [0.3, 0.7], 1.2);
    this.smoke = mk('smoke', 200, new Color4(0.12, 0.12, 0.12, 0.7), new Color4(0.2, 0.2, 0.2, 0.4), [1.2, 2.6], [0.4, 0.9], 1.0);
    this.debris = mk('debris', 120, new Color4(0.5, 0.45, 0.38, 0.8), new Color4(0.35, 0.32, 0.28, 0.5), [0.4, 0.9], [0.15, 0.4], 0.6);
    this.debris.gravity = new Vector3(0, -6, 0); this.debris.minEmitPower = 2; this.debris.maxEmitPower = 5;
    // engine bay sits under the bonnet, near the front of the hull
    this.local = new Vec3(0, v.spec.hullOffsetY + v.spec.halfExtents[1] * 0.5, v.spec.halfExtents[2] * 0.7);
  }
  /** Puff of dust and paint chips at a hull impact (vehicle-local point). */
  impact(local: Vec3, severity: number) {
    const p = local.clone().applyQuaternion(this.v.body.quat).add(this.v.body.pos);
    (this.debris.emitter as Vector3).set(p.x, p.y, p.z);
    this.burst = 0.15; this.debris.emitRate = 300 * (0.3 + severity);
  }
  update(dt: number, budget: number) {
    const v = this.v, c = v.condition;
    const p = this.local.clone().applyQuaternion(v.body.quat).add(v.body.pos);
    for (const ps of [this.steam, this.smoke]) (ps.emitter as Vector3).set(p.x, p.y, p.z);
    const hot = Math.max(0, (v.engineTemp - 108) / 15);
    const steam = v.engineOn || v.engineTemp > 100 ? Math.max(c.cooling > 0.4 ? (c.cooling - 0.4) * 1.6 : 0, hot) : 0;
    this.steam.emitRate = Math.min(1.5, steam) * 40 * budget;
    this.smoke.emitRate = (c.engine > 0.5 && v.engineOn ? (c.engine - 0.5) * 2 * (0.4 + v.lastInput.throttle) : 0) * 40 * budget;
    if (this.burst > 0) { this.burst -= dt; if (this.burst <= 0) this.debris.emitRate = 0; }
  }
  dispose() { this.steam.dispose(); this.smoke.dispose(); this.debris.dispose(); }
}
