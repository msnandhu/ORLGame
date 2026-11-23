import * as THREE from 'three';

/** Pooled soft particles for dust, mud and water spray. */
export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array; private col: Float32Array; private vel: Float32Array; private life: Float32Array; private size: Float32Array;
  private next = 0;
  constructor(private max = 1500) {
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      uniforms: { scale: { value: 180 } },
      vertexShader: `attribute float psize; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = clamp(psize, 0.0, 1.0); vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = (0.4 + psize * 2.2) * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d);
        if (r > 0.25) discard; gl_FragColor = vec4(vC, (0.25 - r) * 1.6 * vA); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, life: number) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.col.set([c.r, c.g, c.b], i * 3);
    this.life[i] = life; this.size[i] = life;
  }
  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 3 * dt;
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= 1 - 1.5 * dt; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
      this.size[i] = Math.max(0, this.life[i]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; (g.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }
}
