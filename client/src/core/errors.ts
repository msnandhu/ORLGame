import { log } from './logger';

/** Global error capture: logs, keeps a report, and shows a recoverable overlay instead of a frozen black screen. */
export function installErrorHandling() {
  const show = (title: string, detail: string) => {
    let el = document.getElementById('fatal');
    if (!el) {
      el = document.createElement('div'); el.id = 'fatal'; el.className = 'overlay panel';
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const h = document.createElement('h2'); h.textContent = title;
    const p = document.createElement('pre'); p.textContent = detail.slice(0, 2000);
    const b = document.createElement('button'); b.textContent = 'Reload'; b.onclick = () => location.reload();
    el.append(h, p, b);
  };
  window.addEventListener('error', e => { log.error('runtime', e.message, e.error); if (!started()) show('Something went wrong while loading', `${e.message}`); });
  window.addEventListener('unhandledrejection', e => { log.error('runtime', `Unhandled promise rejection: ${String(e.reason)}`); if (!started()) show('Something went wrong while loading', String(e.reason?.stack || e.reason)); });
  return { fatal: (title: string, err: unknown) => { log.error('fatal', title, err); show(title, String((err as Error)?.stack || err)); } };
}
let _started = false;
export const started = () => _started;
export const markStarted = () => { _started = true; };
