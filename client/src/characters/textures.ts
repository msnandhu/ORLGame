import { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

/**
 * Procedural textures for the characters, drawn once per scene on canvases: tileable detail normal maps
 * (fabric weave, leather grain, skin pores, hair strands, boot tread), and albedo patterns (weathered canvas,
 * leather, camouflage, bandana print, flannel check, patches) plus the per-character face map.
 * All patterns are original; no external image files.
 */
const cache = new WeakMap<Scene, Map<string, Texture>>();
function cached(scene: Scene, key: string, make: () => Texture) {
  let m = cache.get(scene);
  if (!m) { m = new Map(); cache.set(scene, m); }
  let t = m.get(key);
  if (!t) { t = make(); m.set(key, t); }
  return t;
}

/** Tileable value noise on an S x S lattice (period `cells`). */
function tnoise(S: number, cells: number, seed: number) {
  const g = new Float32Array(cells * cells);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < g.length; i++) { s = (s * 9301 + 49297) % 233280; g[i] = s / 233280; }
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = (x / S) * cells, fy = (y / S) * cells, xi = Math.floor(fx), yi = Math.floor(fy), u = fx - xi, v = fy - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const at = (a: number, b: number) => g[((b + cells) % cells) * cells + ((a + cells) % cells)];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    out[y * S + x] = a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  }
  return out;
}
function fbm2(S: number, base: number, oct: number, seed: number) {
  const out = new Float32Array(S * S); let amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) { const n = tnoise(S, base << o, seed + o * 17); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; tot += amp; amp *= 0.5; }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function canvasTexture(scene: Scene, name: string, S: number, draw: (img: ImageData, ctx: CanvasRenderingContext2D) => void, W = S, H = S, srgb = true) {
  const t = new DynamicTexture(name, { width: W, height: H }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  draw(img, ctx);
  ctx.putImageData(img, 0, 0);
  t.update(false);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.gammaSpace = srgb;
  t.anisotropicFilteringLevel = 4;
  return t;
}

/** Normal map (tangent space) from a tileable height field. */
function normalTexture(scene: Scene, name: string, S: number, h: Float32Array, strength: number) {
  return canvasTexture(scene, name, S, img => {
    const at = (x: number, y: number) => h[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
  }, S, S, false);
}

export function fabricNormal(scene: Scene) {
  return cached(scene, 'n-fabric', () => {
    const S = 256, n = fbm2(S, 8, 3, 3), h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // twill: diagonal ribs plus fine weave and slubs
      const rib = Math.sin(((x + y) / S) * Math.PI * 2 * 48), weave = Math.sin((x / S) * Math.PI * 2 * 96) * Math.sin((y / S) * Math.PI * 2 * 96);
      h[y * S + x] = rib * 0.35 + weave * 0.2 + n[y * S + x] * 1.4;
    }
    return normalTexture(scene, 'fabric-n', S, h, 1.4);
  });
}

export function leatherNormal(scene: Scene) {
  return cached(scene, 'n-leather', () => {
    const S = 256, grain = fbm2(S, 32, 3, 11), big = fbm2(S, 4, 3, 5), h = new Float32Array(S * S);
    for (let i = 0; i < h.length; i++) {
      const c = Math.abs(big[i] - 0.5); // creases along the zero crossings of a coarse noise
      h[i] = grain[i] * 0.9 + Math.min(0.08, c) * 6;
    }
    return normalTexture(scene, 'leather-n', S, h, 3);
  });
}

export function skinNormal(scene: Scene) {
  return cached(scene, 'n-skin', () => {
    const S = 256, a = fbm2(S, 64, 2, 21), b = fbm2(S, 16, 2, 23), h = new Float32Array(S * S);
    for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.6 + b[i] * 0.4;
    return normalTexture(scene, 'skin-n', S, h, 1.6);
  });
}

export function hairNormal(scene: Scene) {
  return cached(scene, 'n-hair', () => {
    const S = 256, h = new Float32Array(S * S), n = tnoise(S, 64, 31), m = fbm2(S, 4, 2, 37);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // strands run along v: noise stretched 32x along the strand direction
      const sx = x, sy = Math.floor(y / 32) % (S / 32);
      h[y * S + x] = n[(sy % S) * S + sx] * 0.8 + Math.sin((x / S) * Math.PI * 2 * 40 + m[y * S + x] * 8) * 0.25;
    }
    return normalTexture(scene, 'hair-n', S, h, 2.2);
  });
}

export function hairAlbedo(scene: Scene) {
  return cached(scene, 'a-hair', () => {
    const S = 256, n = tnoise(S, 128, 41), m = fbm2(S, 8, 3, 43);
    return canvasTexture(scene, 'hair-a', S, img => {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const strand = n[(Math.floor(y / 64) % 4) * S + x];
        const v = 0.75 + strand * 0.3 + (m[y * S + x] - 0.5) * 0.3;
        const i = (y * S + x) * 4, c = Math.max(0, Math.min(255, v * 230));
        img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
      }
    });
  });
}

export function treadNormal(scene: Scene) {
  return cached(scene, 'n-tread', () => {
    const S = 128, h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const cx = (x % 32) - 16, cy = (y % 32) - 16 + ((Math.floor(x / 32) % 2) * 16);
      const lug = Math.max(Math.abs(cx) / 11, Math.abs(((cy + 48) % 32) - 16) / 9);
      h[y * S + x] = lug < 1 ? 1 : 0;
    }
    return normalTexture(scene, 'tread-n', S, h, 2);
  });
}

/** Weathered canvas / waxed cotton: near-white mottling, tinted by the vertex colour. */
export function canvasAlbedo(scene: Scene) {
  return cached(scene, 'a-canvas', () => {
    const S = 256, big = fbm2(S, 4, 4, 51), fine = fbm2(S, 32, 2, 53), scuff = fbm2(S, 16, 2, 57);
    return canvasTexture(scene, 'canvas-a', S, img => {
      for (let i = 0; i < S * S; i++) {
        let v = 0.84 + (big[i] - 0.5) * 0.2 + (fine[i] - 0.5) * 0.12;
        if (scuff[i] > 0.68) v += (scuff[i] - 0.68) * 0.9; // worn, lighter scuffs
        const c = Math.max(0, Math.min(255, v * 255));
        img.data[i * 4] = c; img.data[i * 4 + 1] = c * 0.985; img.data[i * 4 + 2] = c * 0.95; img.data[i * 4 + 3] = 255;
      }
    });
  });
}

export function leatherAlbedo(scene: Scene) {
  return cached(scene, 'a-leather', () => {
    const S = 256, big = fbm2(S, 4, 4, 61), fine = fbm2(S, 32, 3, 63);
    return canvasTexture(scene, 'leather-a', S, img => {
      for (let i = 0; i < S * S; i++) {
        const crease = Math.abs(big[i] - 0.5) < 0.025 ? 0.78 : 1;
        const v = (0.8 + (big[i] - 0.5) * 0.5 + (fine[i] - 0.5) * 0.18) * crease;
        const c = Math.max(0, Math.min(255, v * 255));
        img.data[i * 4] = c; img.data[i * 4 + 1] = c; img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255;
      }
    });
  });
}

/** Woodland-style four colour camouflage (original blob pattern). */
export function camoAlbedo(scene: Scene) {
  return cached(scene, 'a-camo', () => {
    const S = 256, a = fbm2(S, 4, 3, 71), b = fbm2(S, 4, 3, 73), c = fbm2(S, 8, 2, 79), f = fbm2(S, 32, 2, 83);
    const cols = [[74, 82, 52], [44, 52, 34], [98, 82, 55], [26, 28, 22]];
    return canvasTexture(scene, 'camo-a', S, img => {
      for (let i = 0; i < S * S; i++) {
        const k = c[i] > 0.6 ? 3 : a[i] > 0.55 ? 1 : b[i] > 0.56 ? 2 : 0;
        const d = 0.92 + (f[i] - 0.5) * 0.3;
        img.data[i * 4] = cols[k][0] * d; img.data[i * 4 + 1] = cols[k][1] * d; img.data[i * 4 + 2] = cols[k][2] * d; img.data[i * 4 + 3] = 255;
      }
    });
  });
}

/** Bandana print: deep red cotton with an original teardrop-and-dot motif. */
export function bandanaAlbedo(scene: Scene) {
  return cached(scene, 'a-bandana', () => {
    const S = 256;
    return canvasTexture(scene, 'bandana-a', S, (img, ctx) => {
      const n = fbm2(S, 16, 2, 91);
      for (let i = 0; i < S * S; i++) { const d = 0.88 + n[i] * 0.2; img.data[i * 4] = 132 * d; img.data[i * 4 + 1] = 24 * d; img.data[i * 4 + 2] = 22 * d; img.data[i * 4 + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      const drop = (x: number, y: number, s: number, rot: number, col: string) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.moveTo(-s * 0.85, -s * 0.5); ctx.quadraticCurveTo(-s * 0.2, -s * 2.6, s * 1.4, -s * 2.4); ctx.quadraticCurveTo(s * 0.4, -s * 1.4, s * 0.9, -s * 0.4); ctx.fill();
        ctx.fillStyle = '#961a18'; ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
        const x = gx * 64 + (gy % 2) * 32 + 16, y = gy * 64 + 30;
        for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
          drop(x + dx, y + dy, 7, (gx + gy) * 0.9, '#e9e1d4');
          ctx.fillStyle = '#e9e1d4'; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(x + dx + 22 * Math.cos(k * 1.26), y + dy + 14 + 8 * Math.sin(k * 1.26), 1.6, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = '#1c1414'; ctx.beginPath(); ctx.arc(x + dx - 18, y + dy + 22, 2.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      img.data.set(ctx.getImageData(0, 0, S, S).data);
    });
  });
}

/** Flannel check in a given colour. */
export function plaidAlbedo(scene: Scene, hex: string) {
  return cached(scene, `a-plaid-${hex}`, () => {
    const S = 128, n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return canvasTexture(scene, `plaid-${hex}`, S, img => {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const bx = (x % 64) < 22, by = (y % 64) < 22, lx = (x % 64) === 44 || (x % 64) === 45, ly = (y % 64) === 44 || (y % 64) === 45;
        let k = 1; if (bx) k *= 0.55; if (by) k *= 0.55; let w = 0;
        if (lx || ly) w = 0.55;
        const tw = ((x + y) % 2) * 0.04;
        const i = (y * S + x) * 4;
        img.data[i] = (r * k * (1 - w) + 232 * w) * (1 - tw); img.data[i + 1] = (g * k * (1 - w) + 224 * w) * (1 - tw); img.data[i + 2] = (b * k * (1 - w) + 204 * w) * (1 - tw); img.data[i + 3] = 255;
      }
    });
  });
}

/** Sew-on patch atlas: left half = shoulder patch, right half = backpack patch (original mountain emblem). */
export function patchAlbedo(scene: Scene) {
  return cached(scene, 'a-patch', () => canvasTexture(scene, 'patch-a', 256, (img, ctx) => {
    const emblem = (x: number, w: number, bg: string, border: string) => {
      ctx.fillStyle = border; ctx.fillRect(x, 0, w, 128);
      ctx.fillStyle = bg; ctx.fillRect(x + 7, 7, w - 14, 114);
      ctx.strokeStyle = '#ece6da'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x + 18, 96); ctx.lineTo(x + 50, 40); ctx.lineTo(x + 64, 62); ctx.lineTo(x + 80, 30); ctx.lineTo(x + w - 18, 96); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#ece6da'; ctx.beginPath(); ctx.moveTo(x + 80, 30); ctx.lineTo(x + 90, 48); ctx.lineTo(x + 82, 44); ctx.lineTo(x + 74, 52); ctx.lineTo(x + 72, 44); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 50, 40); ctx.lineTo(x + 57, 52); ctx.lineTo(x + 44, 51); ctx.closePath(); ctx.fill();
      ctx.fillRect(x + 24, 104, w - 48, 5);
    };
    emblem(0, 128, '#2b2a27', '#57514a');
    emblem(128, 128, '#8f6e3c', '#5d4626');
    img.data.set(ctx.getImageData(0, 0, 256, 128).data);
    for (let y = 128; y < 256; y++) for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 200; img.data[i + 3] = 255; }
  }));
}

/** Face map layout (equirectangular head UVs, u = longitude with the face at 0.5, v = colatitude). */
export interface FacePaint {
  skin: string; lips: string; brow: string; iris: string;
  /** 0 none, 1 stubble shadow, 2 beard shadow under a beard shell */
  beard: number; female: boolean;
  /** head-local (x, y) -> canvas (px, py) */
  toUv: (x: number, y: number) => [number, number] | null;
  /** canvas (px, py) -> head-local (x, y) on the front of the head, or null */
  fromUv: (px: number, py: number) => [number, number] | null;
  /** 0..1 coverage of beard hair at head-local (x, y) */
  beardMask: (x: number, y: number) => number;
}
export const FACE_W = 1024, FACE_H = 512;
/** atlas squares in the unused bottom band of the face map (under the chin, inside the neck) */
export const EYE_UV = { u0: 8 / FACE_W, v0: 1 - 72 / FACE_H, size: 64 };
export const PLAIN_UV: [number, number] = [120 / FACE_W, 1 - 40 / FACE_H];

export function faceAlbedo(scene: Scene, key: string, f: FacePaint) {
  return cached(scene, `face-${key}`, () => canvasTexture(scene, `face-${key}`, FACE_W, (img, ctx) => {
    const W = FACE_W, H = FACE_H;
    ctx.fillStyle = f.skin; ctx.fillRect(0, 0, W, H);
    // mottling and tone variation
    const n = fbm2(256, 16, 3, 101);
    const id = ctx.getImageData(0, 0, W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = 0.95 + (n[((y >> 1) % 256) * 256 + ((x >> 2) % 256)] - 0.5) * 0.12, i = (y * W + x) * 4;
      id.data[i] *= v; id.data[i + 1] *= v; id.data[i + 2] *= v * 0.99;
    }
    ctx.putImageData(id, 0, 0);
    const P = (x: number, y: number) => f.toUv(x, y) ?? [0, 0];
    const blob = (x: number, y: number, rx: number, ry: number, col: string, a: number) => {
      const [px, py] = P(x, y), [qx, qy] = P(x + rx, y - ry);
      const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(2, Math.abs(qx - px)));
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.globalAlpha = a; ctx.translate(px, py); ctx.scale(1, Math.max(0.2, Math.abs(qy - py) / Math.max(2, Math.abs(qx - px)))); ctx.translate(-px, -py);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, Math.max(2, Math.abs(qx - px)), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    };
    // warm cheeks, nose and ears; cooler darker eye sockets
    for (const s of [-1, 1]) {
      blob(s * 0.045, -0.025, 0.03, 0.025, '#c0584a', f.female ? 0.22 : 0.14);
      blob(s * 0.032, 0.008, 0.022, 0.012, '#5a3a35', 0.28);
    }
    blob(0, -0.03, 0.012, 0.02, '#b85a4c', 0.2);
    // stubble / beard shadow, per texel from the same mask as the beard geometry
    if (f.beard > 0) {
      const id2 = ctx.getImageData(0, 0, W, H), n2 = fbm2(256, 64, 2, 107);
      const n = parseInt(f.brow.slice(1), 16), br = (n >> 16) & 255, bg = (n >> 8) & 255, bb = n & 255;
      for (let py = Math.floor(H * 0.42); py < H * 0.92; py++) for (let px = Math.floor(W * 0.22); px < W * 0.78; px++) {
        const q = f.fromUv(px, py); if (!q) continue;
        const m = f.beardMask(q[0], q[1]); if (m <= 0.002) continue;
        const speck = n2[(py % 256) * 256 + (px % 256)];
        const a = Math.min(1, m * (f.beard === 2 ? 0.9 : 0.55) * (0.65 + speck * 0.7)), i = (py * W + px) * 4;
        id2.data[i] += (br - id2.data[i]) * a; id2.data[i + 1] += (bg - id2.data[i + 1]) * a; id2.data[i + 2] += (bb - id2.data[i + 2]) * a;
      }
      ctx.putImageData(id2, 0, 0);
    }
    // lips
    const lipPath = (top: boolean) => {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 16; i++) { const t = i / 16, x = -0.024 + t * 0.048, k = Math.sin(t * Math.PI); pts.push([x, -0.062 + (top ? 0.008 * k + 0.002 * Math.cos(t * Math.PI * 4) * k : -0.01 * k)]); }
      for (let i = 16; i >= 0; i--) { const t = i / 16, x = -0.024 + t * 0.048; pts.push([x, -0.062]); }
      ctx.beginPath(); pts.map(([x, y]) => P(x, y)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
    };
    ctx.fillStyle = f.lips; ctx.globalAlpha = f.female ? 0.9 : 0.6; lipPath(true); lipPath(false); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#3a221d'; ctx.lineWidth = 1.5; ctx.beginPath(); { const a = P(-0.024, -0.062), b = P(0.024, -0.062), c = P(0, -0.063); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1] + 1, b[0], b[1]); } ctx.stroke();
    // eyebrows
    ctx.fillStyle = f.brow;
    for (const s of [-1, 1]) {
      const pts: [number, number][] = [];
      const th = f.female ? 0.0045 : 0.0065;
      for (let i = 0; i <= 12; i++) { const t = i / 12, x = s * (0.012 + t * 0.04); pts.push([x, 0.036 + Math.sin(t * Math.PI * 0.9) * 0.006 - t * 0.004 + th * (1 - t * 0.6)]); }
      for (let i = 12; i >= 0; i--) { const t = i / 12, x = s * (0.012 + t * 0.04); pts.push([x, 0.036 + Math.sin(t * Math.PI * 0.9) * 0.006 - t * 0.004 - th * 0.3]); }
      ctx.fillStyle = f.brow; ctx.beginPath(); pts.map(([x, y]) => P(x, y)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      // the eye: almond opening with sclera, iris, pupil and a lid line
      const ex0 = s * 0.0175, ex1 = s * 0.0465, eyC = 0.0135;
      const lid: [number, number][] = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; lid.push([ex0 + (ex1 - ex0) * t, eyC + 0.0072 * Math.sin(Math.PI * Math.pow(t, 0.85)) + 0.0012 * t]); }
      for (let i = 14; i >= 0; i--) { const t = i / 14; lid.push([ex0 + (ex1 - ex0) * t, eyC - 0.0046 * Math.sin(Math.PI * t) + 0.0012 * t]); }
      const lp = lid.map(([x, y]) => P(x, y));
      ctx.save(); ctx.beginPath(); lp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = '#ddd4c8'; ctx.fill(); ctx.clip();
      const [ix, iy] = P(s * 0.032, eyC + 0.0008), [rx2] = P(s * 0.032 + 0.0062, eyC);
      const ir = Math.abs(rx2 - ix);
      const ig = ctx.createRadialGradient(ix, iy, ir * 0.2, ix, iy, ir); ig.addColorStop(0, f.iris); ig.addColorStop(1, '#1a120d');
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(ix, iy, ir, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#080605'; ctx.beginPath(); ctx.arc(ix, iy, ir * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(ix - ir * 0.3, iy - ir * 0.35, ir * 0.16, 0, Math.PI * 2); ctx.fill();
      // upper lid shadow
      ctx.fillStyle = 'rgba(40,20,15,0.35)'; ctx.fillRect(Math.min(lp[0][0], lp[14][0]), Math.min(...lp.map(q => q[1])) - 2, Math.abs(lp[14][0] - lp[0][0]), 5);
      ctx.restore();
      ctx.strokeStyle = '#1d120d'; ctx.lineWidth = f.female ? 3 : 2; ctx.beginPath(); lp.slice(0, 15).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.strokeStyle = 'rgba(60,30,25,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); lp.slice(15).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      // crease above the lid
      ctx.strokeStyle = 'rgba(70,40,30,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i <= 10; i++) { const t = i / 10, [px, py] = P(ex0 + (ex1 - ex0) * t, eyC + 0.0115 * Math.sin(Math.PI * t) + 0.002); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.stroke();
    }
    // atlas: eye (sclera, iris, pupil) and a plain skin square
    const ex = EYE_UV.u0 * W, ey = EYE_UV.v0 * H, es = EYE_UV.size;
    ctx.fillStyle = '#e9e3da'; ctx.fillRect(ex, ey, es, es);
    ctx.fillStyle = f.iris; ctx.beginPath(); ctx.arc(ex + es / 2, ey + es / 2, es * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0908'; ctx.beginPath(); ctx.arc(ex + es / 2, ey + es / 2, es * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(ex + es * 0.42, ey + es * 0.42, es * 0.04, 0, Math.PI * 2); ctx.fill();
    img.data.set(ctx.getImageData(0, 0, W, H).data);
  }, FACE_W, FACE_H));
}
