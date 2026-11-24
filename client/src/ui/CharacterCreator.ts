import {
  HAIR_STYLES, BEARD_STYLES, FACE_SHAPES, TOP_STYLES, BOOT_STYLES, GLOVE_STYLES, HEADWEAR, ACCESSORIES,
  OUTFIT_VARIANTS, SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, EYE_COLORS, DEFAULT_MALE, DEFAULT_FEMALE, sanitizeAppearance, randomAppearance, statureOf,
  type CharacterAppearance, type Accessory,
} from '@orl/shared';

type Key = keyof CharacterAppearance;
const label = (s: string) => s.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

/**
 * Character creator panel. Every change is applied live to the 3D model (through `onChange`); the
 * caller orbits the camera around the player while the panel is open.
 */
export class CharacterCreator {
  readonly el: HTMLElement;
  private a: CharacterAppearance;
  private tab = 0;
  /** the player's drag on the 3D view turns the model */
  spin = 0;
  onChange: (a: CharacterAppearance) => void = () => {};
  onDone: (a: CharacterAppearance | null) => void = () => {};

  constructor(host: HTMLElement, initial: CharacterAppearance) {
    this.a = sanitizeAppearance(initial);
    this.el = host;
    host.addEventListener('keydown', e => e.stopPropagation()); // keep typing/arrow keys out of the game
    this.render();
  }

  get value() { return this.a; }

  open(a: CharacterAppearance) { this.a = sanitizeAppearance(a); this.tab = 0; this.render(); this.el.classList.remove('hidden'); }
  close() { this.el.classList.add('hidden'); }

  private set<K extends Key>(k: K, v: CharacterAppearance[K]) {
    const next = { ...this.a, [k]: v };
    // switching body keeps the choices that still apply, and drops the beard for the female body
    this.a = sanitizeAppearance(next);
    this.onChange(this.a);
    this.render();
  }

  private render() {
    const a = this.a, tabs = ['Body', 'Face & hair', 'Clothing', 'Gear'];
    const h: string[] = [];
    h.push(`<h2>Character</h2><div class="cc-tabs">${tabs.map((t, i) => `<button data-tab="${i}" class="${i === this.tab ? 'on' : ''}">${t}</button>`).join('')}</div><div class="cc-body">`);
    const seg = (k: Key, title: string, opts: readonly string[]) =>
      h.push(`<div class="cc-row"><div class="cc-label">${title}</div><div class="cc-seg">${opts.map(o => `<button data-k="${k}" data-v="${o}" class="${a[k] === o ? 'on' : ''}">${label(o)}</button>`).join('')}</div></div>`);
    const swatch = (k: Key, title: string, colors: readonly string[]) =>
      h.push(`<div class="cc-row"><div class="cc-label">${title}</div><div class="cc-swatches">${colors.map((c, i) => `<button aria-label="${title} ${i + 1}" data-k="${k}" data-i="${i}" class="sw ${a[k] === i ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>`);
    const slider = (k: 'height' | 'build', title: string, text: string) =>
      h.push(`<div class="cc-row"><div class="cc-label">${title} <span class="cc-val">${text}</span></div><input type="range" min="0" max="1" step="0.01" data-k="${k}" value="${a[k]}"></div>`);
    if (this.tab === 0) {
      seg('body', 'Body', ['male', 'female']);
      slider('height', 'Height', `${statureOf(a).toFixed(2)} m`);
      slider('build', 'Build', a.build < 0.33 ? 'slim' : a.build < 0.66 ? 'medium' : 'heavy');
      swatch('skin', 'Skin tone', SKIN_TONES);
    } else if (this.tab === 1) {
      seg('face', 'Face shape', FACE_SHAPES);
      swatch('eyes', 'Eyes', EYE_COLORS);
      seg('hair', 'Hairstyle', HAIR_STYLES);
      swatch('hairColor', 'Hair colour', HAIR_COLORS);
      if (a.body === 'male') seg('beard', 'Beard', BEARD_STYLES);
    } else if (this.tab === 2) {
      seg('top', 'Top', TOP_STYLES);
      if (a.top === 'trail-jacket' || a.top === 'crop-jacket')
        h.push(`<div class="cc-row"><div class="cc-label">Outfit</div><div class="cc-seg">${OUTFIT_VARIANTS.map((o, i) => `<button data-k="variant" data-i="${i}" class="${a.variant === i ? 'on' : ''}">${label(o)}</button>`).join('')}</div></div>`);
      else swatch('topColor', 'Top colour', CLOTH_COLORS);
      swatch('pantsColor', 'Trousers', CLOTH_COLORS);
      seg('boots', 'Boots', BOOT_STYLES);
    } else {
      seg('headwear', 'Headwear', HEADWEAR);
      if (a.headwear !== 'none') swatch('headwearColor', 'Headwear colour', CLOTH_COLORS);
      seg('gloves', 'Gloves', GLOVE_STYLES);
      h.push(`<div class="cc-row"><div class="cc-label">Accessories</div><div class="cc-seg">${ACCESSORIES.map(o => `<button data-acc="${o}" class="${a.accessories.includes(o) ? 'on' : ''}">${label(o)}</button>`).join('')}</div></div>`);
    }
    h.push(`</div><div class="cc-actions"><button id="cc-random">Randomize</button><button id="cc-reset">Default</button></div>
      <div class="cc-actions"><button id="cc-cancel">Cancel</button><button id="cc-save" class="primary">Save character</button></div>
      <p class="hint">Drag on the view to turn your character</p>`);
    this.el.innerHTML = h.join('');
    this.wire();
  }

  private wire() {
    const q = <T extends HTMLElement>(sel: string) => [...this.el.querySelectorAll<T>(sel)];
    q('[data-tab]').forEach(b => b.addEventListener('click', () => { this.tab = +b.dataset.tab!; this.render(); }));
    q('button[data-k]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.k as Key;
      this.set(k, (b.dataset.i !== undefined ? +b.dataset.i : b.dataset.v) as never);
    }));
    q<HTMLInputElement>('input[data-k]').forEach(inp => inp.addEventListener('input', () => {
      const k = inp.dataset.k as 'height' | 'build';
      this.a = { ...this.a, [k]: +inp.value };
      this.onChange(this.a);
      const v = inp.parentElement!.querySelector('.cc-val');
      if (v) v.textContent = k === 'height' ? `${statureOf(this.a).toFixed(2)} m` : this.a.build < 0.33 ? 'slim' : this.a.build < 0.66 ? 'medium' : 'heavy';
    }));
    q('[data-acc]').forEach(b => b.addEventListener('click', () => {
      const x = b.dataset.acc as Accessory, has = this.a.accessories.includes(x);
      this.set('accessories', has ? this.a.accessories.filter(y => y !== x) : [...this.a.accessories, x]);
    }));
    this.el.querySelector('#cc-random')!.addEventListener('click', () => { this.a = randomAppearance(Math.random); this.onChange(this.a); this.render(); });
    this.el.querySelector('#cc-reset')!.addEventListener('click', () => { this.a = this.a.body === 'female' ? { ...DEFAULT_FEMALE } : { ...DEFAULT_MALE }; this.onChange(this.a); this.render(); });
    this.el.querySelector('#cc-cancel')!.addEventListener('click', () => this.onDone(null));
    this.el.querySelector('#cc-save')!.addEventListener('click', () => this.onDone(this.a));
  }
}
