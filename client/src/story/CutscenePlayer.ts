import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Cutscene, Shot, StoryWorld, Terrain } from '@orl/shared';

/**
 * Plays a cutscene: letterbox bars, the speaker's line as a subtitle, and a slow camera orbit around each shot's
 * subject (the player, the boss, a compound, a map place, an underground hall). Flashbacks are graded sepia. Any of
 * Space, Enter or Esc skips a line; holding it skips the scene. Lines are spoken with the browser's speech
 * synthesis when it is available and sound is on.
 */
const $ = (id: string) => document.getElementById(id)!;
export interface CutsceneSubjects { player: () => Vector3; boss: () => Vector3 | null }

export class CutscenePlayer {
  active: Cutscene | null = null;
  private shot = 0; private t = 0; private dur = 0;
  private done: (() => void) | null = null;
  speak = true;

  constructor(private camera: UniversalCamera, private world: StoryWorld, private terrain: Terrain, private canvas: HTMLCanvasElement) {}

  play(c: Cutscene, subjects: CutsceneSubjects): Promise<void> {
    this.stop();
    this.active = c; this.subjects = subjects; this.shot = -1;
    $('cutscene').classList.remove('hidden'); $('hud').classList.add('cinema');
    $('cs-title').textContent = c.title;
    this.canvas.style.filter = c.flashback ? 'sepia(0.75) contrast(1.05) brightness(0.95)' : '';
    this.next();
    return new Promise(res => { this.done = res; });
  }
  private subjects: CutsceneSubjects = { player: () => Vector3.Zero(), boss: () => null };

  private next() {
    const c = this.active!;
    this.shot++;
    if (this.shot >= c.shots.length) { this.finish(); return; }
    const s = c.shots[this.shot];
    this.t = 0; this.dur = s.dur ?? Math.max(3.2, s.line.length / 15);
    $('cs-speaker').textContent = s.speaker; $('cs-line').textContent = s.line;
    try {
      if (this.speak && 'speechSynthesis' in window) {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(s.line.replace(/"/g, '')); u.rate = 1.02; u.pitch = s.speaker === 'Silas Crowe' ? 0.7 : s.speaker.includes('"') ? 0.85 : 1;
        speechSynthesis.speak(u);
      }
    } catch { /* no speech */ }
  }
  private finish() {
    const d = this.done;
    this.stop();
    d?.();
  }
  stop() {
    this.active = null; this.done = null;
    $('cutscene').classList.add('hidden'); $('hud').classList.remove('cinema');
    this.canvas.style.filter = '';
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* ignore */ }
  }
  skipLine() { if (this.active) this.next(); }
  skipAll() { if (this.active) this.finish(); }

  private focus(s: Shot): Vector3 {
    const f = s.focus, T = this.terrain;
    switch (f.at) {
      case 'player': return this.subjects.player();
      case 'boss': return this.subjects.boss() ?? this.subjects.player();
      case 'poi': { const p = T.outer.island.pois.find(q => q.id === f.poi); const x = p?.x ?? 0, z = p?.z ?? 0; return new Vector3(x, T.heightAt(x, z) + (f.height ?? 20) * 0.2, z); }
      case 'compound': { const c = this.world.compound(f.site); return new Vector3(c.x, c.y + 4, c.z); }
      case 'ug': { const c = this.world.chamber(f.ch); return new Vector3(c.x, T.heightAt(c.x, c.z) + 2, c.z); }
    }
  }

  /** Move the camera for this frame. Returns false when nothing is playing. */
  update(dt: number): boolean {
    const c = this.active; if (!c) return false;
    this.t += dt;
    if (this.t >= this.dur) { this.next(); if (!this.active) return false; }
    const s = c.shots[Math.max(0, this.shot)], k = Math.min(1, this.t / this.dur), e = k * k * (3 - 2 * k);
    const f = this.focus(s), yaw = (s.yaw0 ?? 0) + ((s.yaw1 ?? (s.yaw0 ?? 0) + 0.5) - (s.yaw0 ?? 0)) * e;
    const d = s.dist ?? 12, h = s.height ?? (s.focus.at === 'poi' ? (s.focus.height ?? 40) : 3);
    let px = f.x + Math.sin(yaw) * d, pz = f.z + Math.cos(yaw) * d, py = f.y + h;
    // never under the ground (or the cave floor)
    py = Math.max(py, this.terrain.heightAt(px, pz) + 1.5);
    if (s.focus.at === 'ug') py = Math.min(py, this.terrain.underground.ceilingAt(px, pz) - 1.5);
    this.camera.position.set(px, py, pz);
    this.camera.setTarget(f);
    return true;
  }
}
