import {
  VEHICLES, PART_GROUPS, slotsFor, optionsFor, fitted, findOption, applyBuild, defaultBuild, vehicleStats, vehiclePrice, partPrice,
  paintPrice, resaleValue, formatMoney, FINISHES, LIVERIES, PAINT_SWATCHES, SURFACE_PROPS, TYRE_GRIP, Surface, linearToHex, stockOption,
  type VehicleSpec, type VehicleBuild, type SlotId, type PartGroup, type Career, type GarageRequest,
} from '@orl/shared';

type Tab = 'overview' | 'paint' | PartGroup;
const CATEGORY: Record<string, string> = { expedition: 'Expedition 4x4', 'rock-crawler': 'Rock crawler', racing: 'Racing', common: 'Everyday', luxury: 'Luxury' };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const TYRE_NAME: Record<string, string> = { 'all-terrain': 'All-terrain', mud: 'Mud-terrain', rock: 'Rock compound', snow: 'Studded winter', road: 'Road', performance: 'Performance' };
/** Surfaces shown in the grip chart. */
const GRIP_SURFACES: [Surface, string][] = [[Surface.Asphalt, 'Tarmac'], [Surface.Dirt, 'Dirt'], [Surface.Gravel, 'Gravel'], [Surface.Mud, 'Mud'], [Surface.Rock, 'Rock'], [Surface.Sand, 'Sand'], [Surface.Snow, 'Snow'], [Surface.Ice, 'Ice']];

export interface GarageHost {
  career(): Career;
  request(req: GarageRequest): Promise<{ ok: boolean; msg: string }>;
  /** show this vehicle as built on the turntable */
  preview(spec: VehicleSpec): void;
  lights(on: boolean): void;
  close(): void;
}

/**
 * The garage panel: vehicle catalogue (buy, sell), paint shop and the four groups of parts. Choosing an option previews it
 * on the turntable and in the figures straight away; nothing is paid for until the player confirms, and the money side
 * goes through the Bank (local economy offline, the server online).
 */
export class GarageUI {
  private vid = VEHICLES[0].id;
  private tab: Tab = 'overview';
  /** option being previewed (not yet bought) */
  private trial: { slot: SlotId; option: string } | null = null;
  /** paint shop draft */
  private paint: Pick<VehicleBuild, 'paint' | 'accent' | 'finish' | 'livery'> | null = null;
  private busy = false; private msg = ''; private msgOk = true; private lightsOn = false;
  where = 'Base camp workshop';

  constructor(private el: HTMLElement, private host: GarageHost) {
    el.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    el.addEventListener('click', e => this.onClick(e));
    el.addEventListener('input', e => this.onInput(e));
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }
  open(vid?: string) {
    const c = this.host.career();
    this.vid = vid && VEHICLES.some(v => v.id === vid) ? vid : Object.keys(c.owned)[0] ?? VEHICLES[0].id;
    this.tab = c.owned[this.vid] ? 'overview' : 'overview'; this.trial = null; this.paint = null; this.msg = '';
    this.el.classList.remove('hidden');
    this.refresh();
  }
  close() { this.el.classList.add('hidden'); this.trial = null; this.paint = null; }
  /** the career changed (a transaction, or the server sent a new one) */
  refresh() { if (!this.isOpen) return; this.host.preview(this.previewSpec()); this.render(); }

  private get spec() { return VEHICLES.find(v => v.id === this.vid)!; }
  private owned() { return this.host.career().owned[this.vid]; }
  private currentBuild(): VehicleBuild { return this.owned()?.build ?? defaultBuild(); }
  private draftBuild(): VehicleBuild {
    const b = this.currentBuild();
    const d: VehicleBuild = { ...b, parts: { ...b.parts } };
    if (this.trial) d.parts[this.trial.slot] = this.trial.option;
    if (this.paint) Object.assign(d, this.paint);
    return d;
  }
  private previewSpec() { return applyBuild(this.spec, this.draftBuild()); }

  // ------------------------------------------------------------------ events
  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t || this.busy) return;
    const a = t.dataset.act!, v = t.dataset.v ?? '';
    switch (a) {
      case 'close': this.host.close(); return;
      case 'veh': this.vid = v; this.trial = null; this.paint = null; this.msg = ''; if (!this.owned()) this.tab = 'overview'; break;
      case 'tab': this.tab = v as Tab; this.trial = null; this.paint = null; break;
      case 'opt': {
        const slot = t.dataset.slot as SlotId;
        this.trial = fitted(this.spec, this.currentBuild(), slot) === v ? null : { slot, option: v };
        break;
      }
      case 'swatch': this.paint = { ...this.paintDraft(), paint: v || null }; break;
      case 'accent': this.paint = { ...this.paintDraft(), accent: v || null }; break;
      case 'finish': this.paint = { ...this.paintDraft(), finish: v as VehicleBuild['finish'] }; break;
      case 'livery': this.paint = { ...this.paintDraft(), livery: v as VehicleBuild['livery'] }; break;
      case 'lights': this.lightsOn = !this.lightsOn; this.host.lights(this.lightsOn); break;
      case 'cancel': this.trial = null; this.paint = null; break;
      case 'buy': void this.run({ op: 'buy-vehicle', vid: this.vid }); return;
      case 'sell': void this.run({ op: 'sell-vehicle', vid: this.vid }); return;
      case 'fit': if (this.trial) void this.run({ op: 'fit', vid: this.vid, slot: this.trial.slot, option: this.trial.option }); return;
      case 'paint': if (this.paint) void this.run({ op: 'paint', vid: this.vid, ...this.paint }); return;
    }
    this.refresh();
  }
  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act === 'custom') { this.paint = { ...this.paintDraft(), paint: t.value.toLowerCase() }; this.host.preview(this.previewSpec()); this.renderActions(); }
  }
  private paintDraft() { const b = this.currentBuild(); return this.paint ?? { paint: b.paint, accent: b.accent, finish: b.finish, livery: b.livery }; }

  private async run(req: GarageRequest) {
    this.busy = true; this.render();
    const r = await this.host.request(req);
    this.busy = false; this.msg = r.msg; this.msgOk = r.ok;
    if (r.ok) { this.trial = null; this.paint = null; if (req.op === 'sell-vehicle') this.tab = 'overview'; }
    this.refresh();
  }

  // ------------------------------------------------------------------ view
  private render() {
    const c = this.host.career(), spec = this.spec, own = this.owned();
    const tabs: [Tab, string][] = [['overview', 'Overview'], ['paint', 'Paint'], ...PART_GROUPS.map(g => [g.id, g.name] as [Tab, string])];
    const list = VEHICLES.map(v => {
      const o = c.owned[v.id];
      return `<button class="gr-veh ${v.id === this.vid ? 'on' : ''}" data-act="veh" data-v="${v.id}"><b>${esc(v.name)}</b><span>${CATEGORY[v.category] ?? v.category}</span><em class="${o ? 'own' : ''}">${o ? 'Owned' : formatMoney(vehiclePrice(v.id))}</em></button>`;
    }).join('');
    this.el.innerHTML = `
      <div class="gr-top"><div class="gr-title">Garage<small>${esc(this.where)}</small></div><div class="gr-cash" title="Your money">${formatMoney(c.cash)}</div><button class="gr-close" data-act="close">Leave garage</button></div>
      <div class="gr-left"><div class="gr-h">Vehicles</div>${list}</div>
      <div class="gr-right">
        <div class="gr-name">${esc(spec.name)}<small>${esc(spec.description)}</small></div>
        <div class="gr-tabs">${tabs.map(([id, n]) => `<button data-act="tab" data-v="${id}" class="${id === this.tab ? 'on' : ''}" ${!own && id !== 'overview' ? 'disabled' : ''}>${n}</button>`).join('')}</div>
        <div class="gr-body">${this.tab === 'overview' ? this.overview() : this.tab === 'paint' ? this.paintTab() : this.partsTab(this.tab)}</div>
        <div class="gr-stats">${this.stats()}</div>
        <div class="gr-actions"></div>
        <div class="gr-msg ${this.msgOk ? '' : 'bad'}">${esc(this.msg)}</div>
      </div>
      <div class="gr-hint">Drag to look around · wheel to zoom · <button class="gr-mini" data-act="lights">${this.lightsOn ? 'Lights off' : 'Lights on'}</button></div>`;
    this.renderActions();
  }

  private overview() {
    const own = this.owned(), spec = this.spec;
    const fittedParts = own ? slotsFor(spec).filter(d => fitted(spec, own.build, d.id) !== stockOption(spec, d.id)).map(d => `${d.name}: ${findOption(d.id, fitted(spec, own.build, d.id))?.name}`) : [];
    return `<div class="gr-ov">
      <p>${own ? `You own this ${CATEGORY[spec.category]?.toLowerCase() ?? 'vehicle'}.` : `For sale: ${formatMoney(vehiclePrice(spec.id))}. Buy it to drive and modify it; it waits for you where it is parked.`}</p>
      <p class="gr-dim">${spec.drivetrain === 'part-time-4wd' ? 'Part-time 4WD with low range and lockers' : `Permanent ${spec.drivetrain.toUpperCase()}`} · ${spec.gears.length}-speed · ${spec.fuelCapacity} L tank</p>
      ${own ? `<p><b>Modifications</b><br>${fittedParts.length ? fittedParts.map(esc).join('<br>') : '<span class="gr-dim">Factory specification</span>'}</p>
      <p class="gr-dim">Spent on this vehicle: ${formatMoney(own.spent)} · resale value ${formatMoney(resaleValue(spec.id, own))}</p>` : ''}
    </div>`;
  }

  private paintTab() {
    const d = this.paintDraft(), spec = this.spec;
    const cur = d.paint ?? linearToHex(spec.look.paint);
    const sw = (act: string, sel: string | null, extra = '') => `<div class="gr-sw">${extra}${PAINT_SWATCHES.map(h => `<button aria-label="${h}" data-act="${act}" data-v="${h}" class="sw ${sel === h ? 'on' : ''}" style="background:${h}"></button>`).join('')}</div>`;
    return `<div class="gr-row"><div class="gr-label">Body colour</div>${sw('swatch', d.paint, `<button data-act="swatch" data-v="" class="sw fac ${d.paint === null ? 'on' : ''}" title="Factory colour" style="background:${linearToHex(spec.look.paint)}"></button>`)}
        <label class="gr-custom">Any colour <input type="color" data-act="custom" value="${cur}"></label></div>
      <div class="gr-row"><div class="gr-label">Finish</div><div class="gr-seg">${FINISHES.map(f => `<button data-act="finish" data-v="${f.id}" class="${d.finish === f.id ? 'on' : ''}">${f.name}</button>`).join('')}</div></div>
      <div class="gr-row"><div class="gr-label">Accent colour <span class="gr-dim">(stripes, trim panels)</span></div>${sw('accent', d.accent, `<button data-act="accent" data-v="" class="sw fac ${d.accent === null ? 'on' : ''}" title="Factory accent" style="background:${linearToHex(spec.look.accent)}"></button>`)}</div>
      <div class="gr-row"><div class="gr-label">Livery</div><div class="gr-seg">${LIVERIES.map(l => `<button data-act="livery" data-v="${l.id}" class="${d.livery === l.id ? 'on' : ''}">${l.name}</button>`).join('')}</div></div>`;
  }

  private partsTab(g: PartGroup) {
    const spec = this.spec, own = this.owned()!, b = this.currentBuild();
    return slotsFor(spec).filter(d => d.group === g).map(d => {
      const cur = fitted(spec, b, d.id), sel = this.trial?.slot === d.id ? this.trial.option : cur;
      const opts = optionsFor(spec, d.id).map(o => {
        const price = partPrice(spec, d.id, o.id, own);
        const tag = o.id === cur ? 'Fitted' : price === 0 ? 'Owned' : formatMoney(price);
        return `<button class="gr-opt ${o.id === sel ? 'on' : ''} ${o.id === cur ? 'cur' : ''}" data-act="opt" data-slot="${d.id}" data-v="${o.id}" title="${esc(o.desc)}"><b>${esc(o.name)}</b><em>${tag}</em></button>`;
      }).join('');
      const desc = findOption(d.id, sel)?.desc ?? '';
      return `<div class="gr-row"><div class="gr-label">${esc(d.name)}</div><div class="gr-opts">${opts}</div><div class="gr-desc">${esc(desc)}</div></div>`;
    }).join('');
  }

  /** Performance figures of the vehicle as previewed, with the change from how it is built now. */
  private stats() {
    const now = applyBuild(this.spec, this.currentBuild()), next = this.previewSpec();
    const a = vehicleStats(now), b = vehicleStats(next);
    const row = (label: string, x: number, y: number, unit: string, digits = 0, better: 1 | -1 = 1) => {
      const d = y - x, show = Math.abs(d) > Math.pow(10, -digits) / 2;
      const cls = !show ? '' : (d > 0) === (better > 0) ? 'up' : 'down';
      return `<div class="gr-stat"><span>${label}</span><b>${y.toFixed(digits)}<small>${unit}</small></b>${show ? `<i class="${cls}">${d > 0 ? '+' : ''}${d.toFixed(digits)}</i>` : ''}</div>`;
    };
    const grip = (s: VehicleSpec, surf: Surface) => SURFACE_PROPS[surf].mu * s.tireGrip * TYRE_GRIP[s.tyre ?? 'all-terrain'][surf];
    const bars = GRIP_SURFACES.map(([surf, n]) => {
      const g0 = grip(now, surf), g1 = grip(next, surf), w = Math.min(100, g1 / 1.6 * 100);
      const cls = g1 > g0 + 1e-6 ? 'up' : g1 < g0 - 1e-6 ? 'down' : '';
      return `<div class="gr-grip ${cls}"><span>${n}</span><div><div style="width:${w.toFixed(0)}%"></div></div></div>`;
    }).join('');
    return `<div class="gr-statgrid">
      ${row('Power', a.powerKw, b.powerKw, ' kW')}${row('Torque', a.peakTorqueNm, b.peakTorqueNm, ' Nm')}${row('Top speed', a.topSpeedKmh, b.topSpeedKmh, ' km/h')}
      ${row('Weight', now.mass, next.mass, ' kg', 0, -1)}${row('Clearance', a.groundClearanceM * 100, b.groundClearanceM * 100, ' cm')}${row('Tyres', a.tyreDiameterIn, b.tyreDiameterIn, '″')}
      ${row('Fuel', now.fuelCapacity, next.fuelCapacity, ' L')}${row('Toughness', now.damageResistance * 100, next.damageResistance * 100, '%')}${row('Cooling', (now.coolingCapacity ?? 1) * 100, (next.coolingCapacity ?? 1) * 100, '%')}
      ${row('Downforce', (now.downforce ?? 0) * 100, (next.downforce ?? 0) * 100, '')}${row('Wading', (now.intakeHeight + 0.9) * 100, (next.intakeHeight + 0.9) * 100, ' cm')}${row('Springs', now.springRate / 1000, next.springRate / 1000, ' kN/m', 1)}
    </div><div class="gr-gripchart"><div class="gr-label">Grip · ${esc(TYRE_NAME[next.tyre ?? 'all-terrain'] ?? '')} tyres</div>${bars}</div>`;
  }

  private renderActions() {
    const el = this.el.querySelector('.gr-actions') as HTMLElement | null; if (!el) return;
    const c = this.host.career(), spec = this.spec, own = this.owned();
    const dis = this.busy ? 'disabled' : '';
    let h = '';
    if (!own) {
      const p = vehiclePrice(spec.id);
      h = `<button class="primary" data-act="buy" ${dis} ${p > c.cash ? 'disabled' : ''}>Buy for ${formatMoney(p)}</button>${p > c.cash ? `<span class="gr-dim">You need ${formatMoney(p - c.cash)} more</span>` : ''}`;
    } else if (this.trial) {
      const p = partPrice(spec, this.trial.slot, this.trial.option, own), name = findOption(this.trial.slot, this.trial.option)?.name ?? '';
      h = `<button class="primary" data-act="fit" ${dis} ${p > c.cash ? 'disabled' : ''}>${p > 0 ? `Buy & fit ${esc(name)} · ${formatMoney(p)}` : `Fit ${esc(name)} · free`}</button><button data-act="cancel">Cancel</button>`;
    } else if (this.paint) {
      const p = paintPrice(spec, own.build, this.paint);
      h = `<button class="primary" data-act="paint" ${dis} ${p > c.cash ? 'disabled' : ''}>Paint · ${formatMoney(p)}</button><button data-act="cancel">Cancel</button>`;
    } else if (this.tab === 'overview' && Object.keys(c.owned).length > 1) {
      h = `<button data-act="sell" ${dis}>Sell for ${formatMoney(resaleValue(spec.id, own))}</button>`;
    }
    el.innerHTML = h;
  }
}
