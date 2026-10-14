import { app, crashReporter, powerMonitor } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** Keep exit evidence on disk even when a packaged app has no console. */
export function installDesktopDiagnostics(): void {
  const directory = path.join(app.getPath('userData'), 'diagnostics');
  const journal = path.join(directory, 'lifecycle.jsonl');
  const record = (event: string, details: Record<string, unknown> = {}) => {
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(journal) && fs.statSync(journal).size > 256 * 1024) {
        const previous = `${journal}.previous`;
        if (fs.existsSync(previous)) fs.unlinkSync(previous);
        fs.renameSync(journal, previous);
      }
      fs.appendFileSync(journal, `${JSON.stringify({ time: new Date().toISOString(), pid: process.pid, event, ...details })}\n`);
    } catch {
      // An unwritable diagnostics directory must not prevent the app from running.
    }
  };

  record('startup', { version: app.getVersion(), electron: process.versions.electron });
  try {
    fs.mkdirSync(directory, { recursive: true });
    const dumps = path.join(directory, 'crashes');
    fs.mkdirSync(dumps, { recursive: true });
    app.setPath('crashDumps', dumps);
    crashReporter.start({ uploadToServer: false });
  } catch (error) {
    record('crash-reporter-unavailable', { error: error instanceof Error ? error.message : String(error) });
  }

  app.on('render-process-gone', (_event, contents, details) => {
    record('renderer-exit', { webContentsId: contents.id, reason: details.reason, exitCode: details.exitCode });
  });
  app.on('child-process-gone', (_event, details) => {
    record('child-exit', { type: details.type, reason: details.reason, exitCode: details.exitCode });
  });
  app.on('before-quit', () => record('before-quit'));
  app.on('will-quit', () => record('will-quit'));
  process.on('exit', (code) => record('process-exit', { code }));
  // Observe fatal exceptions without changing Node's exit behavior.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    record('uncaught-exception', { name: error.name, message: error.message, origin });
  });
  void app.whenReady().then(() => {
    powerMonitor.on('suspend', () => record('suspend'));
    powerMonitor.on('resume', () => record('resume'));
    powerMonitor.on('shutdown', () => record('shutdown'));
  });
}
