import { app } from 'electron';

type Level = 'debug' | 'info' | 'warn' | 'error';

function allowVerbose(): boolean {
  if (process.env.PHEVERE_LOG === '1') return true;
  try {
    return !app.isPackaged;
  } catch {
    return process.env.NODE_ENV !== 'production';
  }
}

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  if ((level === 'debug' || level === 'info') && !allowVerbose()) return;

  const payload: Record<string, unknown> = {
    t: new Date().toISOString(),
    lvl: level,
    scope,
    msg: message,
  };
  if (meta && Object.keys(meta).length > 0) {
    payload.meta = meta;
  }

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** Main-process structured logger: JSON lines; debug/info only when unpackaged (or PHEVERE_LOG=1). */
export const log = {
  debug: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit('debug', scope, msg, meta),
  info: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit('info', scope, msg, meta),
  warn: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit('warn', scope, msg, meta),
  error: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit('error', scope, msg, meta),
};

function sanitizeLogArg(v: unknown): unknown {
  if (v === undefined || v === null) return v;
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Error) return { name: v.name, message: v.message };
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      return s.length > 500 ? `${s.slice(0, 500)}…` : JSON.parse(s);
    } catch {
      return '[Object]';
    }
  }
  return String(v);
}

/**
 * Route legacy console.log/warn/error through structured logger for a service module.
 * debug logs are omitted when packaged; warn/error always emit one JSON line.
 */
export function wrapConsole(scope: string): Pick<Console, 'log' | 'warn' | 'error'> {
  return {
    log: (...args: unknown[]) => {
      if (args.length === 0) return;
      const [first, ...rest] = args;
      const msg = typeof first === 'string' ? first : String(first);
      const meta = rest.length ? { rest: rest.map(sanitizeLogArg) } : undefined;
      log.debug(scope, msg, meta);
    },
    warn: (...args: unknown[]) => {
      const [first, ...rest] = args;
      const msg = typeof first === 'string' ? first : String(first);
      log.warn(scope, msg, rest.length ? { rest: rest.map(sanitizeLogArg) } : undefined);
    },
    error: (...args: unknown[]) => {
      const [first, ...rest] = args;
      const msg = typeof first === 'string' ? first : String(first);
      log.error(scope, msg, rest.length ? { rest: rest.map(sanitizeLogArg) } : undefined);
    },
  };
}
