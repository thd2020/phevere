/** Lightweight logger for the shared core (no Electron `app`). */
export function wrapConsole(scope: string): Pick<Console, 'log' | 'warn' | 'error'> {
  const prefix = `[${scope}]`;
  return {
    log: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}
