import { Scene } from '@babylonjs/core/scene';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';

Effect.ShadersStore.orlSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

Effect.ShadersStore.orlSkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunColor;
uniform float time;
uniform float cloudCover;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45));
  col = mix(col, horizon * 0.75, smoothstep(0.0, -0.2, h));               // below the horizon: hazy ground haze
  float sd = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 64.0) * 0.6);         // atmospheric glow around the sun
  // clouds on a virtual plane, drifting with time; lit on the sun side, darker underneath
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.08) * 0.9 + vec2(time * 0.006, time * 0.002);
    float c = fbm(p);
    float cov = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.35, c);
    float lit = clamp(0.55 + (fbm(p + sunDir.xz * 0.12) - c) * -4.0, 0.0, 1.0);
    vec3 cloud = mix(vec3(0.52, 0.56, 0.64), vec3(1.05, 1.0, 0.95), lit) * (0.9 + pow(sd, 8.0) * 0.6);
    col = mix(col, cloud, cov * smoothstep(0.0, 0.18, h) * 0.92);
  }
  col += sunColor * smoothstep(0.9993, 0.9997, sd) * 20.0;                 // sun disc
  gl_FragColor = vec4(col, 1.0);
}`;

/** Procedural sky dome: height gradient, sun disc and glow, animated fBm clouds. */
export class Sky {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly horizon = new Color3(0.62, 0.74, 0.86);
  constructor(scene: Scene, sunDir: Vector3) {
    this.mesh = MeshBuilder.CreateSphere('sky-dome', { diameter: 560, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.mesh.infiniteDistance = true; this.mesh.isPickable = false; this.mesh.applyFog = false;
    const m = new ShaderMaterial('sky', scene, 'orlSky', { attributes: ['position'], uniforms: ['worldViewProjection', 'sunDir', 'zenith', 'horizon', 'sunColor', 'time', 'cloudCover'] });
    m.backFaceCulling = false; m.disableDepthWrite = true;
    m.setVector3('sunDir', sunDir);
    m.setColor3('zenith', new Color3(0.16, 0.36, 0.78));
    m.setColor3('horizon', this.horizon);
    m.setColor3('sunColor', new Color3(1.0, 0.86, 0.62));
    m.setFloat('cloudCover', 0.42);
    m.setFloat('time', 0);
    this.mesh.material = m; this.material = m;
    this.mesh.renderingGroupId = 0;
  }
  update(timeSec: number) { this.material.setFloat('time', timeSec); }
}
