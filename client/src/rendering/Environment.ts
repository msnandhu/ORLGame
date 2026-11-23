import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Sky } from './Sky';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import type { QualityPreset } from '../config/settings';
import { log } from '../core/logger';

/** Sky, sun, ambient light, reflections, fog, shadows and post-processing, all driven by the quality preset. */
export class Environment {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphericLight;
  readonly sunDir: Vector3;
  readonly sky: Sky;
  shadow: ShadowGenerator | null = null;
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private casters: AbstractMesh[] = [];

  constructor(private scene: Scene, private camera: Camera) {
    // afternoon sun (elevation ~38°, from the south-west)
    const el = (38 * Math.PI) / 180, az = (215 * Math.PI) / 180;
    this.sunDir = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    scene.clearColor = new Color4(0.72, 0.78, 0.82, 1);
    scene.ambientColor = new Color3(0.25, 0.27, 0.3);

    this.sky = new Sky(scene, this.sunDir);
    const skybox = this.sky.mesh;
    scene.clearColor = new Color4(this.sky.horizon.r, this.sky.horizon.g, this.sky.horizon.b, 1);

    this.sun = new DirectionalLight('sun', this.sunDir.negate(), scene);
    this.sun.intensity = 3.6; this.sun.diffuse = new Color3(1, 0.93, 0.82);
    this.hemi = new HemisphericLight('sky-ambient', new Vector3(0, 1, 0), scene);
    this.hemi.intensity = 0.7; this.hemi.diffuse = new Color3(0.7, 0.8, 1); this.hemi.groundColor = new Color3(0.32, 0.27, 0.2);

    // image-based lighting captured from the procedural sky (for PBR reflections on paint, glass, water)
    const probe = new ReflectionProbe('sky-probe', 128, scene);
    probe.renderList!.push(skybox);
    probe.refreshRate = 0; // render once
    scene.environmentTexture = probe.cubeTexture;
    scene.environmentIntensity = 0.8;

    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.6, 0.7, 0.8);
    scene.fogStart = 160; scene.fogEnd = 1000;

    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.0;
  }

  addShadowCaster(m: AbstractMesh) { this.casters.push(m); this.shadow?.addShadowCaster(m, false); }
  removeShadowCaster(m: AbstractMesh) { const i = this.casters.indexOf(m); if (i >= 0) this.casters.splice(i, 1); this.shadow?.removeShadowCaster(m, false); }

  apply(p: QualityPreset) {
    this.scene.fogEnd = p.fogEnd;
    this.camera.maxZ = p.viewDistance;
    // shadows
    this.shadow?.dispose(); this.shadow = null;
    if (p.shadows === 'cascaded') {
      const csm = new CascadedShadowGenerator(p.shadowMapSize, this.sun);
      csm.numCascades = 3; csm.lambda = 0.85; csm.shadowMaxZ = 260; csm.stabilizeCascades = true;
      csm.usePercentageCloserFiltering = true; csm.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      csm.bias = 0.002; csm.normalBias = 0.02; csm.autoCalcDepthBounds = false;
      this.shadow = csm;
    } else if (p.shadows === 'basic') {
      const sg = new ShadowGenerator(p.shadowMapSize, this.sun);
      sg.usePercentageCloserFiltering = true; sg.bias = 0.0015; sg.normalBias = 0.03;
      this.sun.shadowMinZ = 1; this.sun.shadowMaxZ = 400; this.sun.autoUpdateExtends = false;
      this.shadow = sg;
    }
    if (this.shadow) for (const c of this.casters) this.shadow.addShadowCaster(c, false);
    // post-processing
    this.pipeline?.dispose(); this.pipeline = null;
    this.ssao?.dispose(); this.ssao = null;
    try {
      const pl = new DefaultRenderingPipeline('post', true, this.scene, [this.camera]);
      pl.samples = p.msaaSamples; pl.fxaaEnabled = p.fxaa;
      pl.bloomEnabled = p.bloom; pl.bloomThreshold = 0.85; pl.bloomWeight = 0.25; pl.bloomKernel = 48;
      pl.imageProcessingEnabled = true;
      pl.imageProcessing.toneMappingEnabled = true; pl.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      pl.imageProcessing.vignetteEnabled = true; pl.imageProcessing.vignetteWeight = 1.2;
      this.pipeline = pl;
      if (p.ssao && SSAO2RenderingPipeline.IsSupported) {
        this.ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.camera]);
        this.ssao.radius = 1.5; this.ssao.totalStrength = 1.1; this.ssao.samples = 16; this.ssao.maxZ = 250;
      }
    } catch (e) { log.warn('render', 'Post-processing unavailable on this device', e); }
  }

  /** Keep the sun's shadow frustum around the action (for the non-cascaded generator). */
  follow(focus: Vector3) {
    if (this.shadow && !(this.shadow instanceof CascadedShadowGenerator)) {
      this.sun.position = focus.add(this.sunDir.scale(200));
      const l = this.sun; l.orthoLeft = -70; l.orthoRight = 70; l.orthoTop = 70; l.orthoBottom = -70;
    }
  }
}
