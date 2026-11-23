import { Scene } from '@babylonjs/core/scene';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Surface, type Vehicle } from '@orl/shared';
import { softDot } from '../assets/proceduralTextures';

const SURF: Record<number, [number, number, number]> = {
  [Surface.Asphalt]: [0.36, 0.35, 0.34], [Surface.Grass]: [0.42, 0.38, 0.27], [Surface.Dirt]: [0.6, 0.51, 0.38], [Surface.Mud]: [0.24, 0.17, 0.11], [Surface.Rock]: [0.55, 0.53, 0.5], [Surface.Gravel]: [0.64, 0.61, 0.55],
};

/** Dust, mud and water spray per wheel, emission driven by the tyre model (slip, surface, speed, water). */
export class WheelParticles {
  private systems: ParticleSystem[] = [];
  budget = 1;
  constructor(scene: Scene, public v: Vehicle) {
    const d = softDot();
    const tex = new RawTexture(d.data, d.width, d.height, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    for (let i = 0; i < 4; i++) {
      const ps = new ParticleSystem(`wheel-fx-${i}`, 300, scene);
      ps.particleTexture = tex; ps.emitter = new Vector3();
      ps.minSize = 0.25; ps.maxSize = 0.8; ps.minLifeTime = 0.5; ps.maxLifeTime = 1.4;
      ps.minEmitPower = 0.5; ps.maxEmitPower = 2.2; ps.gravity = new Vector3(0, -3, 0);
      ps.direction1 = new Vector3(-0.6, 1, -0.6); ps.direction2 = new Vector3(0.6, 2, 0.6);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD; ps.emitRate = 0;
      ps.addSizeGradient(0, 0.4); ps.addSizeGradient(1, 1.6);
      ps.start();
      this.systems.push(ps);
    }
  }
  update() {
    const v = this.v;
    v.wheels.forEach((w, i) => {
      const ps = this.systems[i];
      if (!w.contact) { ps.emitRate = 0; return; }
      const slip = Math.abs(w.slipRatio) + Math.abs(w.slipAngle), sp = v.speedKmh;
      const rate = (w.inWater ? 0.6 + sp / 20 : 0) + (w.surface === Surface.Mud ? 0.25 + slip : 0)
        + ((w.surface === Surface.Dirt || w.surface === Surface.Gravel) && sp > 15 ? 0.35 : 0) + (slip > 0.3 ? 0.4 : 0);
      ps.emitRate = rate * 60 * this.budget;
      (ps.emitter as Vector3).set(w.contactPoint.x, w.contactPoint.y + 0.1, w.contactPoint.z);
      const c = w.inWater ? [0.88, 0.92, 0.93] : SURF[w.surface];
      ps.color1 = new Color4(c[0], c[1], c[2], 0.75); ps.color2 = new Color4(c[0] * 0.85, c[1] * 0.85, c[2] * 0.85, 0.55); ps.colorDead = new Color4(c[0], c[1], c[2], 0);
    });
  }
}
