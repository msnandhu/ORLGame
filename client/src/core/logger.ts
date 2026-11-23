/** Structured, level-filtered logger with an in-memory ring buffer (shown in the debug overlay, attached to error reports). */
export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export interface LogEntry { t: number; level: Level; scope: string; msg: string }

class Logger {
  level: Level = 'info';
  readonly buffer: LogEntry[] = [];
  private listeners = new Set<(e: LogEntry) => void>();
  private write(level: Level, scope: string, msg: string, extra?: unknown) {
    if (ORDER[level] < ORDER[this.level]) return;
    const e: LogEntry = { t: Date.now(), level, scope, msg };
    this.buffer.push(e); if (this.buffer.length > 300) this.buffer.shift();
    const line = `[${scope}] ${msg}`;
    const c = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'debug' ? console.debug : console.info;
    extra === undefined ? c(line) : c(line, extra);
    this.listeners.forEach(l => l(e));
  }
  debug(s: string, m: string, x?: unknown) { this.write('debug', s, m, x); }
  info(s: string, m: string, x?: unknown) { this.write('info', s, m, x); }
  warn(s: string, m: string, x?: unknown) { this.write('warn', s, m, x); }
  error(s: string, m: string, x?: unknown) { this.write('error', s, m, x); }
  subscribe(fn: (e: LogEntry) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
export const log = new Logger();
