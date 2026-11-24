/** Keyboard + mouse + gamepad input with edge detection. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0; mouseDY = 0; wheel = 0;
  /** a mouse button is held on the canvas */
  mouseDown = false;
  locked = false;
  /** false while a menu needs the cursor (character creator, conversations) */
  allowLock = true;
  gamepad: Gamepad | null = null;
  private padPrev: boolean[] = [];
  padPressed = new Set<number>();

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    // Alt (hold to walk) must not open the browser menu bar on release
    window.addEventListener('keyup', e => { this.down.delete(e.code); if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); });
    window.addEventListener('blur', () => this.down.clear());
    el.addEventListener('click', () => { if (!this.locked && this.allowLock) el.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    window.addEventListener('mousemove', e => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    // drag-to-orbit fallback when pointer lock is unavailable
    let dragging = false, lx = 0, ly = 0;
    el.addEventListener('mousedown', e => { dragging = true; this.mouseDown = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => { dragging = false; this.mouseDown = false; });
    window.addEventListener('mousemove', e => { if (!this.locked && dragging) { this.mouseDX += e.clientX - lx; this.mouseDY += e.clientY - ly; lx = e.clientX; ly = e.clientY; } });
    el.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  isDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }
  /** a key used by one system is not seen by the others this frame */
  consume(code: string) { this.pressed.delete(code); }
  axis(neg: string[], pos: string[]) { return (pos.some(c => this.down.has(c)) ? 1 : 0) - (neg.some(c => this.down.has(c)) ? 1 : 0); }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.gamepad = null;
    for (const p of pads) if (p && p.connected) { this.gamepad = p; break; }
    this.padPressed.clear();
    if (this.gamepad) {
      this.gamepad.buttons.forEach((b, i) => { if (b.pressed && !this.padPrev[i]) this.padPressed.add(i); this.padPrev[i] = b.pressed; });
    }
  }
  padAxis(i: number) { const v = this.gamepad?.axes[i] ?? 0; return Math.abs(v) < 0.15 ? 0 : v; }
  padButton(i: number) { return this.gamepad?.buttons[i]?.value ?? 0; }

  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
}
