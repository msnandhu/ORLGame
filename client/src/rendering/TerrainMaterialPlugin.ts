import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';

export const SPLAT_KIND = 'splat';

/**
 * Splat-mapped terrain shading for a PBRMaterial: four tiling layers (grass, dirt, rock, mud) blended per pixel by
 * per-vertex weights and each layer's height (alpha), with two-scale sampling against visible tiling and
 * tri-planar projection for rock on steep slopes. Lighting, shadows and fog stay Babylon's own PBR pipeline.
 */
export class TerrainMaterialPlugin extends MaterialPluginBase {
  constructor(material: Material, private layers: BaseTexture[]) {
    super(material, 'TerrainSplat', 200, { TERRAIN_SPLAT: false });
    this._enable(true);
  }
  override getClassName() { return 'TerrainMaterialPlugin'; }
  override isCompatible(lang: ShaderLanguage) { return lang === ShaderLanguage.GLSL || lang === ShaderLanguage.WGSL; }
  override prepareDefines(defines: Record<string, unknown>, _scene: Scene, mesh: AbstractMesh) {
    defines.TERRAIN_SPLAT = mesh.isVerticesDataPresent(SPLAT_KIND);
  }
  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh) {
    if (mesh.isVerticesDataPresent(SPLAT_KIND)) attributes.push(SPLAT_KIND);
  }
  override getSamplers(samplers: string[]) { samplers.push('terrainL0', 'terrainL1', 'terrainL2', 'terrainL3'); }
  override getActiveTextures(active: BaseTexture[]) { active.push(...this.layers); }
  override hasTexture(t: BaseTexture) { return this.layers.includes(t); }
  override isReadyForSubMesh() { return this.layers.every(t => t.isReady()); }
  override bindForSubMesh(ubo: UniformBuffer) {
    this.layers.forEach((t, i) => ubo.setTexture(`terrainL${i}`, t));
  }
  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Record<string, string> | null {
    if (shaderLanguage === ShaderLanguage.WGSL) return wgslCode(shaderType);
    if (shaderType === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: `
#ifdef TERRAIN_SPLAT
attribute vec4 splat;
varying vec4 vSplat;
varying vec3 vTerrainPos;
varying vec3 vTerrainNrm;
#endif`,
      CUSTOM_VERTEX_MAIN_END: `
#ifdef TERRAIN_SPLAT
vSplat = splat;
vTerrainPos = (finalWorld * vec4(position, 1.0)).xyz;
vTerrainNrm = normal;
#endif`,
    };
    if (shaderType === 'fragment') return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
#ifdef TERRAIN_SPLAT
varying vec4 vSplat;
varying vec3 vTerrainPos;
varying vec3 vTerrainNrm;
uniform sampler2D terrainL0;
uniform sampler2D terrainL1;
uniform sampler2D terrainL2;
uniform sampler2D terrainL3;
// two scales, offset and rotated, blended by a low-frequency mask: hides texture repetition
vec4 tSample(sampler2D s, vec2 p, float scale) {
  vec4 a = texture2D(s, p / scale);
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p / (scale * 2.7) + 0.37;
  vec4 b = texture2D(s, q);
  float m = smoothstep(0.35, 0.65, texture2D(terrainL3, p / 211.0).a * 1.6 - 0.15);
  return mix(a, b, m * 0.55);
}
vec4 tTriplanar(sampler2D s, vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(s, p.zy / scale) * w.x + tSample(s, p.xz, scale) * w.y + texture2D(s, p.xy / scale) * w.z;
}
vec3 terrainAlbedo() {
  vec3 n = normalize(vTerrainNrm);
  vec4 l0 = tSample(terrainL0, vTerrainPos.xz, 3.2);
  vec4 l1 = tSample(terrainL1, vTerrainPos.xz, 4.5);
  vec4 l2 = tTriplanar(terrainL2, vTerrainPos, n, 7.0);
  vec4 l3 = tSample(terrainL3, vTerrainPos.xz, 5.0);
  vec4 w = max(vSplat, vec4(0.0));
  // height-based blending: the taller texel of overlapping layers wins, giving natural ragged borders
  vec4 h = vec4(l0.a, l1.a, l2.a, l3.a) + w * 1.2;
  float mx = max(max(h.x, h.y), max(h.z, h.w)) - 0.22;
  vec4 b = max(h - mx, vec4(0.0)) * step(vec4(0.001), w);
  b /= max(b.x + b.y + b.z + b.w, 1e-4);
  vec3 c = l0.rgb * b.x + l1.rgb * b.y + l2.rgb * b.z + l3.rgb * b.w;
  return pow(c, vec3(2.2));
}
#endif`,
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
#ifdef TERRAIN_SPLAT
surfaceAlbedo *= terrainAlbedo();
#endif`,
    };
    return null;
  }
}

/** The same shading in WGSL for the WebGPU backend (Babylon's PBR runs native WGSL there). */
function wgslCode(shaderType: string): Record<string, string> | null {
  if (shaderType === 'vertex') return {
    CUSTOM_VERTEX_DEFINITIONS: `
#ifdef TERRAIN_SPLAT
attribute splat: vec4f;
varying vSplat: vec4f;
varying vTerrainPos: vec3f;
varying vTerrainNrm: vec3f;
#endif`,
    CUSTOM_VERTEX_MAIN_END: `
#ifdef TERRAIN_SPLAT
vertexOutputs.vSplat = vertexInputs.splat;
vertexOutputs.vTerrainPos = (finalWorld * vec4f(vertexInputs.position, 1.0)).xyz;
vertexOutputs.vTerrainNrm = vertexInputs.normal;
#endif`,
  };
  if (shaderType === 'fragment') return {
    CUSTOM_FRAGMENT_DEFINITIONS: `
#ifdef TERRAIN_SPLAT
varying vSplat: vec4f;
varying vTerrainPos: vec3f;
varying vTerrainNrm: vec3f;
var terrainL0Sampler: sampler;
var terrainL0: texture_2d<f32>;
var terrainL1Sampler: sampler;
var terrainL1: texture_2d<f32>;
var terrainL2Sampler: sampler;
var terrainL2: texture_2d<f32>;
var terrainL3Sampler: sampler;
var terrainL3: texture_2d<f32>;
fn tSample(t: texture_2d<f32>, s: sampler, p: vec2f, scale: f32) -> vec4f {
  let a = textureSample(t, s, p / scale);
  let q = mat2x2f(0.8, -0.6, 0.6, 0.8) * p / (scale * 2.7) + vec2f(0.37);
  let b = textureSample(t, s, q);
  let m = smoothstep(0.35, 0.65, textureSample(terrainL3, terrainL3Sampler, p / 211.0).a * 1.6 - 0.15);
  return mix(a, b, m * 0.55);
}
fn tTriplanar(t: texture_2d<f32>, s: sampler, p: vec3f, n: vec3f, scale: f32) -> vec4f {
  var w = pow(abs(n), vec3f(4.0)); w = w / (w.x + w.y + w.z);
  return textureSample(t, s, p.zy / scale) * w.x + tSample(t, s, p.xz, scale) * w.y + textureSample(t, s, p.xy / scale) * w.z;
}
fn terrainAlbedo(splat: vec4f, pos: vec3f, nrm: vec3f) -> vec3f {
  let n = normalize(nrm);
  let l0 = tSample(terrainL0, terrainL0Sampler, pos.xz, 3.2);
  let l1 = tSample(terrainL1, terrainL1Sampler, pos.xz, 4.5);
  let l2 = tTriplanar(terrainL2, terrainL2Sampler, pos, n, 7.0);
  let l3 = tSample(terrainL3, terrainL3Sampler, pos.xz, 5.0);
  let w = max(splat, vec4f(0.0));
  let h = vec4f(l0.a, l1.a, l2.a, l3.a) + w * 1.2;
  let mx = max(max(h.x, h.y), max(h.z, h.w)) - 0.22;
  var b = max(h - vec4f(mx), vec4f(0.0)) * step(vec4f(0.001), w);
  b = b / max(b.x + b.y + b.z + b.w, 1e-4);
  let c = l0.rgb * b.x + l1.rgb * b.y + l2.rgb * b.z + l3.rgb * b.w;
  return pow(c, vec3f(2.2));
}
#endif`,
    // WGSL PBR has no UPDATE_ALBEDO hook; UPDATE_ALPHA sits directly after surfaceAlbedo is declared
    CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#ifdef TERRAIN_SPLAT
surfaceAlbedo = surfaceAlbedo * terrainAlbedo(fragmentInputs.vSplat, fragmentInputs.vTerrainPos, fragmentInputs.vTerrainNrm);
#endif`,
  };
  return null;
}
