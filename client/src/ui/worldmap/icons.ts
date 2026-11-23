import type { PoiKind } from '@orl/shared';

/** Map icon style per place kind: badge colour and a vector glyph (original drawings, no image assets). */
export const ICON_COLOR: Record<PoiKind, string> = {
  camp: '#e0782a', city: '#2f6fe0', village: '#2f6fe0', gang: '#d8262c', garage: '#2fae3a', fuel: '#d8262c', race: '#7c3fd0',
  explorer: '#f09a1a', lookout: '#1f8fa8', lab: '#5a7fb0', cave: '#18a5c8', gate: '#c89a1a', peak: '#c8262c', cablecar: '#3a5a7a',
  rescue: '#2fae3a', hazard: '#d8262c', lake: '#2f86d0', waterfall: '#2f86d0', ruins: '#a88a2a', wildlife: '#e0a01a',
  resource: '#e08a1a', collectible: '#2fc060', mission: '#f0b020', depot: '#2f6fe0', farm: '#b8402a',
};

/** Legend groups, in the order shown, with the kinds each covers. */
export const LEGEND: { label: string; kinds: PoiKind[] }[] = [
  { label: 'Gang Leader / Gang Camp', kinds: ['gang'] },
  { label: 'Village / Town', kinds: ['village'] },
  { label: 'Main City (Hub)', kinds: ['city'] },
  { label: 'Base Camp', kinds: ['camp'] },
  { label: 'Service Garage', kinds: ['garage'] },
  { label: 'Fuel Station', kinds: ['fuel'] },
  { label: 'Race / Challenge', kinds: ['race'] },
  { label: 'Explorer Camp', kinds: ['explorer'] },
  { label: 'View Point / Lookout', kinds: ['lookout'] },
  { label: 'Research / Lab', kinds: ['lab'] },
  { label: 'Cave / Hidden Area', kinds: ['cave'] },
  { label: 'Region Gate', kinds: ['gate'] },
  { label: 'Peak', kinds: ['peak'] },
  { label: 'Cable Car', kinds: ['cablecar'] },
  { label: 'Rescue / Mission', kinds: ['rescue', 'mission'] },
  { label: 'Hazard', kinds: ['hazard'] },
  { label: 'Lake / Waterfall', kinds: ['lake', 'waterfall'] },
  { label: 'Ruins', kinds: ['ruins'] },
  { label: 'Wildlife Zone', kinds: ['wildlife'] },
  { label: 'Resource / Depot / Farm', kinds: ['resource', 'depot', 'farm'] },
  { label: 'Collectible', kinds: ['collectible'] },
];

/** Draw a round badge icon centred at (x, y) with radius r. `dim` draws a planned (not yet built) place. */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: PoiKind, x: number, y: number, r: number, dim = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = dim ? 0.78 : 1;
  // badge
  ctx.beginPath();
  if (kind === 'gang') { ctx.moveTo(0, -r * 1.15); ctx.lineTo(r, -r * 0.7); ctx.lineTo(r * 0.85, r * 0.45); ctx.lineTo(0, r * 1.15); ctx.lineTo(-r * 0.85, r * 0.45); ctx.lineTo(-r, -r * 0.7); ctx.closePath(); }
  else ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = ICON_COLOR[kind]; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4; ctx.fill(); ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1.2, r * 0.14); ctx.strokeStyle = dim ? 'rgba(255,255,255,0.55)' : '#fff';
  if (dim) ctx.setLineDash([r * 0.35, r * 0.25]);
  ctx.stroke(); ctx.setLineDash([]);
  // glyph
  const s = r * 0.55; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, r * 0.13); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const B = () => ctx.beginPath();
  switch (kind) {
    case 'gang': B(); ctx.arc(0, -s * 0.15, s * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-s * 0.35, s * 0.3, s * 0.7, s * 0.35);
      ctx.fillStyle = ICON_COLOR.gang; B(); ctx.arc(-s * 0.25, -s * 0.15, s * 0.17, 0, 7); ctx.arc(s * 0.25, -s * 0.15, s * 0.17, 0, 7); ctx.fill(); break;
    case 'village': case 'camp': B(); ctx.moveTo(-s, 0); ctx.lineTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(s * 0.7, 0); ctx.lineTo(s * 0.7, s * 0.8); ctx.lineTo(-s * 0.7, s * 0.8); ctx.lineTo(-s * 0.7, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = ICON_COLOR[kind]; ctx.fillRect(-s * 0.2, s * 0.25, s * 0.4, s * 0.55); break;
    case 'city': ctx.fillRect(-s * 0.9, -s * 0.2, s * 0.5, s); ctx.fillRect(-s * 0.3, -s * 0.9, s * 0.6, s * 1.7); ctx.fillRect(s * 0.4, -s * 0.45, s * 0.5, s * 1.25); break;
    case 'garage': B(); ctx.moveTo(-s * 0.8, s * 0.8); ctx.lineTo(s * 0.8, -s * 0.8); ctx.moveTo(-s * 0.8, -s * 0.8); ctx.lineTo(s * 0.8, s * 0.8); ctx.stroke();
      B(); ctx.arc(s * 0.8, -s * 0.8, s * 0.28, 0, 7); ctx.arc(-s * 0.8, -s * 0.8, s * 0.28, 0, 7); ctx.fill(); break;
    case 'fuel': ctx.fillRect(-s * 0.7, -s * 0.8, s * 1.0, s * 1.6); ctx.fillStyle = ICON_COLOR.fuel; ctx.fillRect(-s * 0.5, -s * 0.6, s * 0.6, s * 0.45);
      B(); ctx.moveTo(s * 0.3, -s * 0.3); ctx.lineTo(s * 0.8, 0); ctx.lineTo(s * 0.8, s * 0.6); ctx.stroke(); break;
    case 'race': for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if ((a + b) % 2 === 0) ctx.fillRect(-s * 0.8 + a * s * 0.55, -s * 0.8 + b * s * 0.55, s * 0.55, s * 0.55);
      ctx.strokeRect(-s * 0.8, -s * 0.8, s * 1.65, s * 1.65); break;
    case 'explorer': B(); ctx.moveTo(0, -s); ctx.lineTo(s, s * 0.8); ctx.lineTo(-s, s * 0.8); ctx.closePath(); ctx.fill(); ctx.fillStyle = ICON_COLOR.explorer; B(); ctx.moveTo(0, -s * 0.1); ctx.lineTo(s * 0.35, s * 0.8); ctx.lineTo(-s * 0.35, s * 0.8); ctx.fill(); break;
    case 'lookout': B(); ctx.moveTo(-s * 0.5, s); ctx.lineTo(-s * 0.2, -s * 0.4); ctx.moveTo(s * 0.5, s); ctx.lineTo(s * 0.2, -s * 0.4); ctx.moveTo(-s * 0.4, s * 0.3); ctx.lineTo(s * 0.4, s * 0.3); ctx.stroke(); ctx.fillRect(-s * 0.55, -s, s * 1.1, s * 0.6); break;
    case 'lab': B(); ctx.moveTo(-s * 0.25, -s); ctx.lineTo(s * 0.25, -s); ctx.lineTo(s * 0.25, -s * 0.2); ctx.lineTo(s * 0.8, s * 0.85); ctx.lineTo(-s * 0.8, s * 0.85); ctx.lineTo(-s * 0.25, -s * 0.2); ctx.closePath(); ctx.fill(); break;
    case 'cave': case 'gate': B(); ctx.moveTo(-s, s * 0.9); ctx.lineTo(-s, -s * 0.1); ctx.arc(0, -s * 0.1, s, Math.PI, 0); ctx.lineTo(s, s * 0.9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = ICON_COLOR[kind]; B(); ctx.moveTo(-s * 0.45, s * 0.9); ctx.lineTo(-s * 0.45, s * 0.1); ctx.arc(0, s * 0.1, s * 0.45, Math.PI, 0); ctx.lineTo(s * 0.45, s * 0.9); ctx.fill(); break;
    case 'peak': B(); ctx.moveTo(-s, s * 0.8); ctx.lineTo(-s * 0.1, -s * 0.8); ctx.lineTo(s * 0.35, 0); ctx.lineTo(s * 0.55, -s * 0.3); ctx.lineTo(s, s * 0.8); ctx.closePath(); ctx.fill(); break;
    case 'cablecar': B(); ctx.moveTo(-s, -s * 0.7); ctx.lineTo(s, -s * 0.2); ctx.stroke(); ctx.fillRect(-s * 0.5, -s * 0.05, s, s * 0.8); B(); ctx.moveTo(0, -s * 0.45); ctx.lineTo(0, 0); ctx.stroke(); break;
    case 'rescue': ctx.font = `bold ${s * 2}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', 0, s * 0.1); break;
    case 'mission': case 'hazard': if (kind === 'hazard') { B(); ctx.moveTo(0, -s); ctx.lineTo(s, s * 0.8); ctx.lineTo(-s, s * 0.8); ctx.closePath(); ctx.fill(); ctx.fillStyle = ICON_COLOR.hazard; }
      ctx.fillRect(-s * 0.11, -s * (kind === 'hazard' ? 0.45 : 0.85), s * 0.22, s * (kind === 'hazard' ? 0.7 : 1.1)); B(); ctx.arc(0, s * (kind === 'hazard' ? 0.55 : 0.6), s * 0.14, 0, 7); ctx.fill(); break;
    case 'lake': for (const dy of [-0.35, 0.3]) { B(); for (let k = 0; k <= 8; k++) { const xx = -s + k * s / 4, yy = dy * s + Math.sin(k * Math.PI / 2) * s * 0.2; if (k) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); } ctx.stroke(); } break;
    case 'waterfall': ctx.fillRect(-s * 0.9, -s * 0.9, s * 1.8, s * 0.35); for (const dx of [-0.5, 0, 0.5]) { B(); ctx.moveTo(dx * s, -s * 0.5); ctx.lineTo(dx * s, s * 0.9); ctx.stroke(); } break;
    case 'ruins': ctx.fillRect(-s, -s * 0.9, s * 2, s * 0.3); for (const dx of [-0.75, -0.1, 0.55]) ctx.fillRect(dx * s, -s * 0.5, s * 0.25, s * 1.3); break;
    case 'wildlife': B(); ctx.ellipse(0, s * 0.35, s * 0.5, s * 0.42, 0, 0, 7); ctx.fill(); for (const [dx, dy] of [[-0.62, -0.25], [-0.22, -0.7], [0.22, -0.7], [0.62, -0.25]]) { B(); ctx.arc(dx * s, dy * s, s * 0.2, 0, 7); ctx.fill(); } break;
    case 'resource': ctx.fillRect(-s * 0.9, -s * 0.1, s * 1.8, s * 0.45); ctx.fillRect(-s * 0.7, -s * 0.65, s * 1.4, s * 0.45); ctx.fillRect(-s * 0.9, s * 0.45, s * 1.8, s * 0.45); break;
    case 'collectible': B(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, -s * 0.2); ctx.lineTo(0, s); ctx.lineTo(-s * 0.8, -s * 0.2); ctx.closePath(); ctx.fill(); break;
    case 'depot': ctx.fillRect(-s, -s * 0.5, s * 1.2, s); ctx.fillRect(s * 0.25, -s * 0.15, s * 0.7, s * 0.65); B(); ctx.arc(-s * 0.55, s * 0.6, s * 0.22, 0, 7); ctx.arc(s * 0.55, s * 0.6, s * 0.22, 0, 7); ctx.fill(); break;
    case 'farm': ctx.fillRect(-s * 0.9, -s * 0.2, s * 1.1, s * 1.1); B(); ctx.moveTo(-s, -s * 0.2); ctx.lineTo(-s * 0.35, -s * 0.8); ctx.lineTo(s * 0.3, -s * 0.2); ctx.fill(); ctx.fillRect(s * 0.4, -s * 0.9, s * 0.5, s * 1.8); break;
  }
  ctx.restore();
}

/** Region badge glyphs for labels and panels. */
export function drawRegionGlyph(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, s: number, color: string) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.5, s * 0.12); ctx.lineCap = 'round';
  ctx.beginPath();
  if (id === 'snow') for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); ctx.moveTo(Math.cos(a) * s * 0.55 + Math.cos(a + 0.8) * s * 0.25, Math.sin(a) * s * 0.55 + Math.sin(a + 0.8) * s * 0.25); ctx.lineTo(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55); ctx.lineTo(Math.cos(a) * s * 0.55 + Math.cos(a - 0.8) * s * 0.25, Math.sin(a) * s * 0.55 + Math.sin(a - 0.8) * s * 0.25); }
  if (id === 'hill') { ctx.moveTo(-s, s * 0.7); ctx.lineTo(-s * 0.3, -s * 0.5); ctx.lineTo(0, 0); ctx.lineTo(s * 0.35, -s * 0.8); ctx.lineTo(s, s * 0.7); ctx.closePath(); ctx.fill(); }
  if (id === 'plain') { ctx.moveTo(0, s); ctx.lineTo(0, -s); for (let k = 0; k < 4; k++) { const yy = -s * 0.7 + k * s * 0.42; ctx.moveTo(0, yy + s * 0.2); ctx.lineTo(-s * 0.45, yy - s * 0.1); ctx.moveTo(0, yy + s * 0.2); ctx.lineTo(s * 0.45, yy - s * 0.1); } }
  if (id === 'forest') { for (const dx of [-0.5, 0.5]) { ctx.moveTo(dx * s, -s); ctx.lineTo(dx * s + s * 0.45, s * 0.3); ctx.lineTo(dx * s - s * 0.45, s * 0.3); ctx.closePath(); } ctx.fill(); ctx.beginPath(); ctx.moveTo(-s * 0.5, s * 0.3); ctx.lineTo(-s * 0.5, s); ctx.moveTo(s * 0.5, s * 0.3); ctx.lineTo(s * 0.5, s); }
  ctx.stroke(); ctx.restore();
}
