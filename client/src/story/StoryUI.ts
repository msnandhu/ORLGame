import {
  MISSIONS, MISSION_BY_ID, JOURNAL, PAGES, GANGS, GANGSTERS, LEADERS, MASTER, LEGENDS, UG_GUARDS, FAMILY, missionLock, missionPayout, formatMoney, displayName, vehicleById,
  type Career, type MissionDef, type SimHud, type GangId,
} from '@orl/shared';

/**
 * The story's screens: the objective panel on the HUD, the mission briefing, the result card, and the journal
 * (story so far, missions, the four gangs with every member's bounty and status, keys and legendary vehicles, and
 * the underground challenges).
 */
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const CHAPTER: Record<MissionDef['chapter'], string> = { prologue: 'Prologue', gang1: 'The Cragjaws', gang2: 'The Dune Vipers', gang3: 'Frostline', gang4: 'The Bog Kings', underground: 'The Underground', finale: 'Finale' };
export type JournalTab = 'story' | 'missions' | 'gangs' | 'keys' | 'challenges';

export class StoryUI {
  onStart: (id: string) => void = () => {};
  onTrack: (id: string) => void = () => {};
  onClose: () => void = () => {};
  onRetry: () => void = () => {};
  private tab: JournalTab = 'story';
  private briefingId: string | null = null;

  constructor(private career: () => Career) {
    $('jr-tabs').addEventListener('click', e => { const t = (e.target as HTMLElement).dataset.tab as JournalTab | undefined; if (t) { this.tab = t; this.renderJournal(); } });
    $('jr-close').addEventListener('click', () => this.onClose());
    $('jr-body').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
      if (b.dataset.track) this.onTrack(b.dataset.track);
    });
    $('br-start').addEventListener('click', () => { if (this.briefingId) this.onStart(this.briefingId); });
    $('br-cancel').addEventListener('click', () => this.closeBriefing());
    $('res-ok').addEventListener('click', () => $('mission-result').classList.add('hidden'));
    $('res-retry').addEventListener('click', () => { $('mission-result').classList.add('hidden'); this.onRetry(); });
  }

  // ------------------------------------------------------------------ objective panel
  hud(h: SimHud | null) {
    const el = $('objective');
    if (!h) { el.classList.add('hidden'); $('banner').classList.add('hidden'); return; }
    el.classList.remove('hidden');
    $('obj-title').textContent = h.title;
    $('obj-text').textContent = h.objective;
    const extra: string[] = [];
    if (h.count) extra.push(h.count);
    if (h.rank) extra.push(`Position ${h.rank}`);
    if (h.timer !== undefined) extra.push(`${Math.floor(h.timer / 60)}:${String(Math.floor(h.timer % 60)).padStart(2, '0')}`);
    $('obj-extra').textContent = extra.join(' · ');
    const m = $('obj-meter');
    if (h.meter) { m.classList.remove('hidden'); $('obj-meter-label').textContent = h.meter.label; ($('obj-meter-fill') as HTMLElement).style.width = `${Math.round(h.meter.value * 100)}%`; m.classList.toggle('danger', !!h.meter.danger); }
    else m.classList.add('hidden');
    const b = $('obj-boss');
    b.innerHTML = (h.boss ?? []).map(x => `<div class="boss"><span>${esc(x.name)}</span><div class="bar"><i style="width:${Math.round(x.hp * 100)}%"></i></div></div>`).join('');
    const bn = $('banner');
    if (h.banner) { bn.textContent = h.banner; bn.classList.remove('hidden'); } else bn.classList.add('hidden');
  }

  // ------------------------------------------------------------------ briefing and result
  briefing(m: MissionDef) {
    this.briefingId = m.id;
    const c = this.career(), first = !c.story.done.includes(m.id);
    $('br-chapter').textContent = CHAPTER[m.chapter];
    $('br-title').textContent = m.title;
    $('br-giver').textContent = `From ${m.giver}`;
    $('br-brief').textContent = m.brief;
    const rewards: string[] = [];
    if (first) {
      rewards.push(formatMoney(missionPayout(m)));
      if (m.key) rewards.push(GANGS[m.key].key.name);
      if (m.legend) rewards.push(`${LEGENDS.find(l => l.id === m.legend)!.name} (legendary vehicle)`);
      if (m.core) rewards.push('The Sovereign X1');
    } else rewards.push('Replay: no reward (bounties are paid once)');
    $('br-reward').textContent = rewards.join(' · ');
    const targets = m.defeats.map(id => GANGSTERS.find(g => g.id === id) ?? Object.values(LEADERS).find(l => l.id === id) ?? UG_GUARDS.find(g => g.id === id) ?? (id === MASTER.id ? MASTER : null)).filter(Boolean);
    $('br-targets').innerHTML = targets.map(g => `<li><b>${esc(displayName(g!))}</b> · ${esc(g!.role)} · ${esc(vehicleById(g!.vehicle).name)} · bounty ${formatMoney(g!.bounty)}</li>`).join('');
    $('briefing').classList.remove('hidden');
  }
  closeBriefing() { this.briefingId = null; $('briefing').classList.add('hidden'); }
  get briefingOpen() { return !$('briefing').classList.contains('hidden'); }
  result(won: boolean, title: string, msg: string, canRetry: boolean) {
    $('res-head').textContent = won ? 'Mission complete' : 'Mission failed';
    $('res-head').className = won ? 'won' : 'lost';
    $('res-title').textContent = title; $('res-msg').textContent = msg;
    $('res-retry').classList.toggle('hidden', !canRetry);
    $('mission-result').classList.remove('hidden');
  }
  get resultOpen() { return !$('mission-result').classList.contains('hidden'); }

  // ------------------------------------------------------------------ journal
  openJournal(tab?: JournalTab) { if (tab) this.tab = tab; this.renderJournal(); $('journal').classList.remove('hidden'); }
  closeJournal() { $('journal').classList.add('hidden'); }
  get journalOpen() { return !$('journal').classList.contains('hidden'); }

  renderJournal() {
    for (const b of Array.from($('jr-tabs').querySelectorAll('button'))) b.classList.toggle('on', (b as HTMLElement).dataset.tab === this.tab);
    const s = this.career().story, body = $('jr-body');
    const keys = `${s.keys.length} / 4 keys`;
    $('jr-summary').textContent = `${s.done.length} / ${MISSIONS.length} missions · ${s.defeated.length} defeated · ${keys} · ${s.legends.length} / 4 legends${s.core ? ' · Sovereign recovered' : ''}`;
    switch (this.tab) {
      case 'story': {
        const entries = [{ title: 'My father', text: `${FAMILY.father.name}: ${FAMILY.father.title}. That is all anyone at camp would tell me.` }, ...s.journal.map(k => JOURNAL[k]).filter(Boolean)];
        const pages = PAGES.filter(p => s.pages.includes(p.id));
        body.innerHTML = entries.map(e => `<article><h4>${esc(e.title)}</h4><p>${esc(e.text)}</p></article>`).join('')
          + `<h3>Father's journal pages (${pages.length} / ${PAGES.length})</h3>`
          + (pages.length ? pages.map(p => `<article class="page"><h4>${esc(p.title)}</h4><p>${esc(p.text)}</p></article>`).join('') : '<p class="muted">None found yet. Ezra says they are hidden beside places across the island.</p>');
        break;
      }
      case 'missions': {
        const rows = MISSIONS.filter(m => m.chapter !== 'underground' || m.id === 'ug-descent').map(m => this.missionRow(m));
        body.innerHTML = `<p class="muted">Track a mission to put its start on your HUD arrow, then drive into the yellow beam and press <b>Y</b>.</p><table>${rows.join('')}</table>`;
        break;
      }
      case 'challenges': {
        body.innerHTML = `<p class="muted">Twenty-one of Crowe's tests, in order, under the Snow Region. Each opens the gate to the next hall. Repair bays after the 7th, 13th and 19th halls fix your vehicle for free.</p><table>${MISSIONS.filter(m => m.chapter === 'underground' && m.id !== 'ug-descent' || m.chapter === 'finale').map(m => this.missionRow(m)).join('')}</table>`;
        break;
      }
      case 'gangs': {
        body.innerHTML = ([1, 2, 3, 4] as GangId[]).map(g => {
          const G = GANGS[g], L = LEADERS[g], members = GANGSTERS.filter(m => m.gang === g);
          const down = members.filter(m => s.defeated.includes(m.id)).length;
          return `<section class="gang"><h3 style="border-color:${G.paint}">${esc(G.name)} <small>${esc(G.terrain)} · ${down} / ${G.size} down</small></h3><p class="muted">"${esc(G.motto)}" · ${esc(G.specialty)}</p>
            <table><tr class="${s.defeated.includes(L.id) ? 'done' : ''}"><td><b>${esc(displayName(L))}</b><br><small>${esc(L.title)}</small></td><td>Leader</td><td>${esc(vehicleById(L.vehicle).name)}</td><td>${formatMoney(L.bounty)}</td><td>${s.defeated.includes(L.id) ? 'Defeated' : 'At large'}</td></tr>
            ${members.map(m => `<tr class="${s.defeated.includes(m.id) ? 'done' : ''}" title="${esc(m.bio)}"><td>${esc(displayName(m))}</td><td>${esc(m.role)} · ${'★'.repeat(m.difficulty)}</td><td>${esc(vehicleById(m.vehicle).name)}</td><td>${formatMoney(m.bounty)}</td><td>${s.defeated.includes(m.id) ? 'Defeated' : 'At large'}</td></tr>`).join('')}</table></section>`;
        }).join('') + `<section class="gang"><h3>${esc(displayName(MASTER))} <small>${esc(MASTER.title)}</small></h3><p>${esc(MASTER.bio)} Bounty ${formatMoney(MASTER.bounty)} · ${s.defeated.includes(MASTER.id) ? 'Defeated' : 'In the underground'}</p></section>`;
        break;
      }
      case 'keys': {
        body.innerHTML = `<div class="keys">${([1, 2, 3, 4] as GangId[]).map(g => `<div class="key ${s.keys.includes(g) ? 'held' : ''}"><b>${esc(GANGS[g].key.name)}</b><small>${s.keys.includes(g) ? 'Held' : `Held by ${esc(LEADERS[g].name)}`}</small></div>`).join('')}</div>
          <h3>Legendary vehicles</h3>${LEGENDS.map(l => `<article class="${s.legends.includes(l.id) ? '' : 'locked'}"><h4>${esc(l.name)} <small>${esc(vehicleById(l.vehicle).name)} · ${s.legends.includes(l.id) ? 'Recovered: its build is in your garage' : `held by ${esc(Object.values(LEADERS).find(x => x.id === l.holder)?.name ?? '')}`}</small></h4><p>${esc(l.story)}</p></article>`).join('')}
          <article class="${s.core ? '' : 'locked'}"><h4>Sovereign X1 <small>${s.core ? 'Recovered: parked at base camp' : 'held by Silas Crowe'}</small></h4><p>Elias Kade's core vehicle: twin turbos, armour all round. Not for sale at any price.</p></article>`;
        break;
      }
    }
  }
  private missionRow(m: MissionDef) {
    const s = this.career().story, done = s.done.includes(m.id), lock = missionLock(s, m);
    const state = done ? 'Complete' : lock ? esc(lock) : 'Available';
    const btn = !lock ? `<button data-track="${m.id}">${done ? 'Replay' : 'Track'}</button>` : '';
    return `<tr class="${done ? 'done' : lock ? 'locked' : 'open'}"><td><small>${CHAPTER[m.chapter]}</small><br><b>${esc(m.title)}</b></td><td>${esc(m.brief)}</td><td>${done ? '' : formatMoney(missionPayout(m))}</td><td>${state}</td><td>${btn}</td></tr>`;
  }
  static missionTitle(id: string) { return MISSION_BY_ID[id]?.title ?? id; }
}
