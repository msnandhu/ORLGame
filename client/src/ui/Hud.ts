import { Terrain, Surface, SURFACE_NAMES, DRIVING_MODE_PROFILES, isPunctured, type Vehicle } from '@orl/shared';

const $ = (id: string) => document.getElementById(id)!;

/** HTML/canvas HUD: compass, minimap, tachometer, speed, gear, drive indicators, fuel, wheel telemetry. */
export class Hud {
  private mapImg: HTMLCanvasElement;
  private mini = ($('minimap') as HTMLCanvasElement).getContext('2d')!;
  private tacho = ($('tacho') as HTMLCanvasElement).getContext('2d')!;
  private big = ($('bigmap-canvas') as HTMLCanvasElement).getContext('2d')!;
  private toastTimer = 0;
  private dmg = ($('damage-canvas') as HTMLCanvasElement).getContext('2d')!;
  private dmgTimer = 0;
  /** repair kits carried (set by the game) */
  kits = 0;
  private compassStrip = $('compass-strip');

  constructor(private terrain: Terrain) {
    this.mapImg = this.renderMap(512);
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    let html = '';
    for (let rep = 0; rep < 3; rep++) for (let i = 0; i < 24; i++) {
      const deg = i * 15; const c = deg % 45 === 0;
      html += `<span class="${c ? 'c' : ''}">${c ? dirs[deg / 45] : '·'}</span>`;
    }
    this.compassStrip.innerHTML = html;
  }

  /** North = -Z in world. Map image: up = north. */
  private renderMap(px: number): HTMLCanvasElement {
    const t = this.terrain;
    const c = document.createElement('canvas'); c.width = c.height = px;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(px, px);
    const col: Record<number, number[]> = { [Surface.Grass]: [70, 96, 44], [Surface.Dirt]: [150, 118, 80], [Surface.Mud]: [84, 62, 40], [Surface.Rock]: [128, 124, 118], [Surface.Gravel]: [150, 144, 130] };
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const wx = (x / px) * t.size - t.half, wz = (y / px) * t.size - t.half;
      const h = t.heightAt(wx, wz);
      const n = t.normalAt(wx, wz);
      const shade = 0.65 + 0.55 * Math.max(0, n[0] * -0.5 + n[1] * 0.7 + n[2] * -0.5);
      let rgb = col[t.surfaceAt(wx, wz)];
      if (h < t.waterLevel) rgb = [40, 80, 100];
      const i = (y * px + x) * 4;
      const contour = Math.abs((h % 10 + 10) % 10) < 0.35 ? 0.85 : 1;
      img.data[i] = rgb[0] * shade * contour; img.data[i + 1] = rgb[1] * shade * contour; img.data[i + 2] = rgb[2] * shade * contour; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(230,200,150,0.9)'; ctx.lineWidth = 2;
    for (const tr of t.trails) { ctx.beginPath(); tr.forEach(([x, z], k) => { const sx = (x + t.half) / t.size * px, sy = (z + t.half) / t.size * px; if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }); ctx.stroke(); }
    return c;
  }

  toast(msg: string) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); this.toastTimer = 2; }
  prompt(msg: string | null) { const el = $('prompt'); if (msg) { el.textContent = msg; el.classList.remove('hidden'); } else el.classList.add('hidden'); }

  update(dt: number, s: { px: number; pz: number; viewYaw: number; inVehicle: boolean; v: Vehicle; vx: number; vz: number; vHeading: number; stamina: number; surface: Surface }) {
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) $('toast').classList.remove('show'); }
    // compass: viewYaw is looking direction (0 = +Z = south). bearing clockwise from north
    const bearing = ((180 - (s.viewYaw * 180) / Math.PI) % 360 + 360) % 360;
    this.compassStrip.style.transform = `translateX(${160 - 20 - (bearing / 15) * 40 - 24 * 40}px)`;
    $('surface').textContent = SURFACE_NAMES[s.surface];
    this.drawMini(s.px, s.pz, bearing, s.vx, s.vz, s.inVehicle);
    $('veh-hud').classList.toggle('hidden', !s.inVehicle);
    $('foot-hud').classList.toggle('hidden', s.inVehicle);
    ($('stamina-fill') as HTMLElement).style.width = `${s.stamina * 100}%`;
    if (s.inVehicle) this.drawVehicle(s.v);
    if (!$('bigmap').classList.contains('hidden')) this.drawBig(s.px, s.pz, bearing, s.vx, s.vz);
  }

  private drawMini(px: number, pz: number, bearing: number, vx: number, vz: number, inVeh: boolean) {
    const ctx = this.mini, t = this.terrain, W = 200, range = 260; // metres across
    const scale = this.mapImg.width / t.size; // image px per metre
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); ctx.clip();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-bearing * Math.PI / 180);
    const k = W / range;
    ctx.scale(k / scale, k / scale);
    ctx.translate(-(px + t.half) * scale, -(pz + t.half) * scale);
    ctx.drawImage(this.mapImg, 0, 0);
    // fuel pump & vehicle markers
    const pt = (x: number, z: number) => [(x + t.half) * scale, (z + t.half) * scale];
    const [fx, fz] = pt(t.fuelPump.x, t.fuelPump.z);
    ctx.fillStyle = '#ff4a3a'; ctx.fillRect(fx - 2, fz - 2, 4, 4);
    if (!inVeh) { const [a, b] = pt(vx, vz); ctx.fillStyle = '#fff'; ctx.fillRect(a - 2.5, b - 2.5, 5, 5); }
    ctx.restore();
    // player arrow (always points up = view direction)
    ctx.fillStyle = '#e0782a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W / 2, W / 2 - 9); ctx.lineTo(W / 2 + 6, W / 2 + 7); ctx.lineTo(W / 2, W / 2 + 3); ctx.lineTo(W / 2 - 6, W / 2 + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    const a = -bearing * Math.PI / 180; ctx.fillText('N', W / 2 + Math.sin(a) * -88 * -1, W / 2 - Math.cos(a) * 88 + 4);
  }

  private drawBig(px: number, pz: number, bearing: number, vx: number, vz: number) {
    const ctx = this.big, t = this.terrain, W = 720;
    ctx.drawImage(this.mapImg, 0, 0, W, W);
    const pt = (x: number, z: number) => [(x + t.half) / t.size * W, (z + t.half) / t.size * W];
    const [fx, fz] = pt(t.fuelPump.x, t.fuelPump.z); ctx.fillStyle = '#ff4a3a'; ctx.fillRect(fx - 4, fz - 4, 8, 8);
    const [cx, cz] = pt(0, 0); ctx.strokeStyle = '#fff'; ctx.strokeRect(cx - 14, cz - 14, 28, 28); ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.fillText('Base camp', cx + 18, cz + 4);
    const [rx, rz] = pt(190, -60); ctx.fillText('Rock-crawl ridge', rx - 40, rz - 75);
    const [a, b] = pt(vx, vz); ctx.fillStyle = '#fff'; ctx.fillRect(a - 4, b - 4, 8, 8);
    const [x, z] = pt(px, pz);
    ctx.save(); ctx.translate(x, z); ctx.rotate(bearing * Math.PI / 180);
    ctx.fillStyle = '#e0782a'; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private drawVehicle(v: Vehicle) {
    const ctx = this.tacho, W = 230, cx = W / 2, cy = W / 2, r = 100;
    ctx.clearRect(0, 0, W, W);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, maxRpm = Math.ceil((v.spec.redlineRpm + 500) / 1000) * 1000;
    ctx.lineWidth = 10; ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(14,17,20,0.75)'; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    const red = a0 + (a1 - a0) * (v.spec.redlineRpm / maxRpm);
    ctx.strokeStyle = 'rgba(255,60,40,0.5)'; ctx.beginPath(); ctx.arc(cx, cy, r, red, a1); ctx.stroke();
    const f = Math.min(1, v.rpm / maxRpm);
    ctx.strokeStyle = v.rpm > v.spec.redlineRpm - 100 ? '#ff5a3c' : '#e0782a';
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * f); ctx.stroke();
    ctx.fillStyle = '#9aa3a0'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    const ticks = maxRpm / 1000;
    for (let k = 0; k <= ticks; k++) { const a = a0 + (a1 - a0) * (k / ticks); ctx.fillText(String(k), cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20) + 4); }
    ctx.fillText('x1000 rpm', cx, cy + 62);
    $('speed-val').textContent = String(Math.round(v.speedKmh));
    $('gear').textContent = !v.engineOn ? '—' : v.gear < 0 ? 'R' : v.gear === 0 ? 'N' : String(v.gear);
    $('trans').textContent = v.automatic ? 'AUTO' : 'MANUAL';
    $('ind-drive').textContent = v.driveMode;
    $('ind-lock').classList.toggle('on', v.diffLock);
    $('ind-hb').classList.toggle('on', v.lastInput.handbrake > 0.5);
    $('ind-flood').classList.toggle('on', v.flooded);
    const mode = DRIVING_MODE_PROFILES[v.drivingMode];
    $('ind-mode').textContent = mode.label.toUpperCase();
    $('ind-tc').textContent = mode.tcSlip === null && !mode.brakeTc ? 'TC OFF' : 'TC';
    $('ind-tc').classList.toggle('on', v.tcActive);
    $('ind-abs').textContent = mode.abs ? 'ABS' : 'ABS OFF';
    $('ind-abs').classList.toggle('on', v.absActive);
    $('ind-crawl').classList.toggle('on', v.crawlActive);
    $('ind-hot').classList.toggle('on', v.engineTemp > 110 || v.overheated);
    $('temp-val').textContent = String(Math.round(v.engineTemp));
    const tf = $('temp-fill') as HTMLElement;
    tf.style.width = `${Math.max(0, Math.min(1, (v.engineTemp - 40) / 90)) * 100}%`;
    tf.style.background = v.engineTemp > 115 ? '#ff5a3c' : v.engineTemp > 104 ? '#e0a02a' : '#6fb3d9';
    this.dmgTimer -= 1;
    if (this.dmgTimer <= 0) { this.dmgTimer = 10; this.drawCondition(v); }
    ($('fuel-fill') as HTMLElement).style.width = `${(v.fuel / v.spec.fuelCapacity) * 100}%`;
    ($('fuel-fill') as HTMLElement).style.background = v.fuel / v.spec.fuelCapacity < 0.15 ? '#ff5a3c' : '';
    v.wheels.forEach((w, i) => {
      const el = $('w' + i) as HTMLElement;
      const load = Math.min(1, w.load / 9000);
      const slip = Math.min(1, Math.abs(w.slipRatio) * 1.5 + Math.abs(w.slipAngle) * 2);
      el.style.background = !w.contact ? '#111' : `rgb(${Math.round(60 + slip * 195)},${Math.round(60 + load * 150 * (1 - slip))},60)`;
    });
  }

  /** Top-down condition diagram: panels, wheels (tyre + suspension), engine and radiator. Green = fine, red = broken. */
  private drawCondition(v: Vehicle) {
    const ctx = this.dmg, c = v.condition, W = 96, H = 150;
    const col = (d: number) => `rgb(${Math.round(90 + 165 * Math.min(1, d * 1.4))},${Math.round(200 - 160 * d)},${Math.round(90 - 50 * d)})`;
    ctx.clearRect(0, 0, W, H);
    const bx = 26, by = 14, bw = 44, bh = 122;
    ctx.globalAlpha = 0.9;
    // panels: front, rear, left, right, roof (centre), under shown as an outline
    ctx.fillStyle = col(c.body.front); ctx.fillRect(bx, by, bw, 22);
    ctx.fillStyle = col(c.body.rear); ctx.fillRect(bx, by + bh - 20, bw, 20);
    ctx.fillStyle = col(c.body.left); ctx.fillRect(bx, by + 24, 8, bh - 46);   // vehicle's left is the screen's left (top view, nose up)
    ctx.fillStyle = col(c.body.right); ctx.fillRect(bx + bw - 8, by + 24, 8, bh - 46);
    ctx.fillStyle = col(c.body.roof); ctx.fillRect(bx + 10, by + 34, bw - 20, bh - 70);
    ctx.strokeStyle = col(c.body.under); ctx.lineWidth = 2; ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);
    // wheels: FL FR RL RR -> screen positions (nose up, so vehicle left = screen left)
    const pos = [[bx - 16, by + 14], [bx + bw + 4, by + 14], [bx - 16, by + bh - 40], [bx + bw + 4, by + bh - 40]];
    pos.forEach(([x, y], i) => {
      ctx.fillStyle = isPunctured(c, i) ? '#ff3a2a' : col(c.tyres[i]); ctx.fillRect(x, y, 12, 26);
      ctx.fillStyle = col(c.suspension[i]); ctx.fillRect(x + (i % 2 ? -4 : 12), y + 8, 4, 10);
    });
    // engine and radiator markers on the bonnet
    ctx.globalAlpha = 1; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#111'; ctx.fillText('RAD', bx + bw / 2, by + 9); ctx.fillText('ENG', bx + bw / 2, by + 19);
    ctx.fillStyle = col(c.cooling); ctx.fillRect(bx + 4, by + 1, 6, 9);
    ctx.fillStyle = col(c.engine); ctx.fillRect(bx + 4, by + 12, 6, 9);
    $('kits').textContent = `REPAIR KITS ${this.kits}`;
  }
}
