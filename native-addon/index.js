const path = require('path');

function loadMonitorClass() {
  if (process.platform === 'darwin') {
    const binding = require('./build/Release/ax_selection_monitor.node');
    return binding.AXSelectionMonitor;
  }
  if (process.platform === 'linux') {
    const binding = require('./build/Release/linux_selection_monitor.node');
    return binding.LinuxSelectionMonitor;
  }
  const binding = require('./build/Release/uiautomation_selection_monitor.node');
  return binding.UIAutomationSelectionMonitor;
}

const METHOD = { darwin: 'accessibility', linux: 'xfixes-atspi' }[process.platform] || 'uiautomation';
const BINDING_FILE =
  { darwin: 'ax_selection_monitor.node', linux: 'linux_selection_monitor.node' }[process.platform] ||
  'uiautomation_selection_monitor.node';

const MonitorClass = loadMonitorClass();

/**
 * Linux AT-SPI must not run inside Electron's process: Chromium's ATK bridge uses
 * the same libatspi and crashes when we drive it too. Load this addon again in a
 * child (Electron as plain Node) and ask it for the word under the pointer.
 */
const ATSPI_HELPER_SRC = `
const binding = require(process.argv[process.argv.length - 1]);
const monitor = new binding.LinuxSelectionMonitor();
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let q;
  try { q = JSON.parse(line); } catch { return; }
  let r;
  try { r = monitor.getWordAtPoint(q.x, q.y); } catch { r = { text: '', x: q.x, y: q.y }; }
  process.stdout.write(JSON.stringify(Object.assign({ id: q.id }, r)) + '\\n');
});
rl.on('close', () => process.exit(0));
`;

class AtspiHelper {
  constructor(modulePath) {
    this.modulePath = modulePath;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.failures = 0;
  }

  ensure() {
    if (this.child) return this.child;
    if (this.failures > 3) return null;
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e', ATSPI_HELPER_SRC, this.modulePath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          const done = this.pending.get(msg.id);
          if (done) {
            this.pending.delete(msg.id);
            delete msg.id;
            done(msg);
          }
        } catch {
          /* partial or noise */
        }
      }
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      this.failures += 1;
      for (const done of this.pending.values()) done(null);
      this.pending.clear();
    });
    child.unref();
    child.stdout.unref?.();
    child.stdin.unref?.();
    this.child = child;
    return child;
  }

  query(x, y, timeoutMs = 400) {
    return new Promise((resolve) => {
      const child = this.ensure();
      if (!child) {
        resolve(null);
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ id, x, y })}\n`);
    });
  }

  stop() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}

class NativeSelectionMonitor {
  constructor() {
    this.monitor = new MonitorClass();
    this.isRunning = false;
    this.callbacks = [];
    this.method = METHOD;
  }

  /**
   * Start monitoring for text selections (UIA on Windows, AX on macOS, XFixes PRIMARY on Linux).
   */
  start() {
    if (this.isRunning) {
      console.log('[NATIVE-ADDON] Already running');
      return false;
    }

    try {
      // Linux adds a 4th arg: 'physical' | 'dip' | 'none' (where x, y came from).
      this.monitor.setCallback((text, x, y, space) => {
        console.log(`[NATIVE-ADDON] Selection detected: "${text}" @ (${x}, ${y})`);
        this.notifyCallbacks(space ? { text, x, y, space } : { text, x, y });
      });

      const result = this.monitor.start();
      if (result) {
        this.isRunning = true;
        console.log(`[NATIVE-ADDON] ${this.method} selection monitoring started`);
        return true;
      }
      console.error(`[NATIVE-ADDON] Failed to start ${this.method} monitoring`);
      return false;
    } catch (error) {
      console.error('[NATIVE-ADDON] Error starting monitoring:', error);
      return false;
    }
  }

  stop() {
    if (this.atspi) {
      this.atspi.stop();
      this.atspi = null;
    }
    if (!this.isRunning) {
      return;
    }

    try {
      this.monitor.stop();
      this.isRunning = false;
      console.log(`[NATIVE-ADDON] ${this.method} selection monitoring stopped`);
    } catch (error) {
      console.error('[NATIVE-ADDON] Error stopping monitoring:', error);
    }
  }

  getCurrentSelection() {
    try {
      return this.monitor.getCurrentSelection();
    } catch (error) {
      console.error('[NATIVE-ADDON] Error getting current selection:', error);
      return null;
    }
  }

  onSelection(callback) {
    if (typeof callback === 'function') {
      this.callbacks.push(callback);
    }
  }

  notifyCallbacks(payload) {
    this.callbacks.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('[NATIVE-ADDON] Error in callback:', error);
      }
    });
  }

  getWordAtPoint(x, y) {
    if (process.platform === 'linux') return this.getWordAtPointLinux(x, y);
    try {
      if (!this.monitor || typeof this.monitor.getWordAtPoint !== 'function') {
        return { text: '', x, y };
      }
      const result = this.monitor.getWordAtPoint(x, y);
      return result || { text: '', x, y };
    } catch (error) {
      console.error('[NATIVE-ADDON] Error getWordAtPoint:', error);
      return { text: '', x, y };
    }
  }

  /** Linux: same answer as UIA/AX getWordAtPoint, but async (helper process). */
  getWordAtPointLinux(x, y) {
    if (!this.atspi) {
      let modulePath = null;
      try {
        modulePath = this.monitor.getModulePath();
      } catch {
        modulePath = null;
      }
      if (!modulePath || process.env.PHEVERE_DISABLE_ATSPI === '1') return Promise.resolve({ text: '', x, y });
      this.atspi = new AtspiHelper(modulePath);
    }
    return this.atspi.query(x, y).then((r) => r || { text: '', x, y });
  }

  /** Linux: which producer runs ({ backend: 'wayland' | 'x11' | 'none', protocol }). */
  getBackend() {
    if (!this.monitor || typeof this.monitor.getBackend !== 'function') return null;
    try {
      return this.monitor.getBackend();
    } catch {
      return null;
    }
  }

  /** Linux (Plasma Wayland): pointer in DIP from KWin, or null. */
  getCursorPos(timeoutMs = 150) {
    if (!this.monitor || typeof this.monitor.getCursorPos !== 'function') return null;
    try {
      return this.monitor.getCursorPos(timeoutMs);
    } catch {
      return null;
    }
  }

  isTrusted(prompt = false) {
    if (!this.monitor || typeof this.monitor.isTrusted !== 'function') {
      return process.platform !== 'darwin';
    }
    try {
      return !!this.monitor.isTrusted(prompt);
    } catch (error) {
      return false;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      platform: process.platform,
      method: this.method,
      callbacksCount: this.callbacks.length,
      binding: path.basename(BINDING_FILE),
    };
  }
}

/**
 * Linux desktop queries that need no running monitor (read-this-window, pointer).
 * KWin answers in DIP on Plasma Wayland; EWMH answers in X root pixels elsewhere.
 */
let desktopProbe = null;
NativeSelectionMonitor.getActiveWindow = function getActiveWindow() {
  if (process.platform !== 'linux') return null;
  try {
    if (!desktopProbe) desktopProbe = new MonitorClass();
    return desktopProbe.getActiveWindow();
  } catch (error) {
    console.error('[NATIVE-ADDON] getActiveWindow failed:', error);
    return null;
  }
};

/**
 * Linux (Plasma Wayland): silent screenshot of a DIP rect through KWin ScreenShot2,
 * as { width, height, data: BGRA Buffer } at physical resolution, or null when KWin
 * has not authorized this executable (dev runs, AppImage).
 */
NativeSelectionMonitor.captureArea = function captureArea(x, y, width, height) {
  if (process.platform !== 'linux') return null;
  try {
    if (!desktopProbe) desktopProbe = new MonitorClass();
    return desktopProbe.captureArea(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  } catch {
    return null;
  }
};

/** Linux (Plasma Wayland): keep KWin reporting the pointer while hover lookup runs. */
NativeSelectionMonitor.watchCursor = function watchCursor(on) {
  if (process.platform !== 'linux') return false;
  try {
    if (!desktopProbe) desktopProbe = new MonitorClass();
    return desktopProbe.watchCursor(!!on);
  } catch {
    return false;
  }
};

/** Last pointer (DIP) from watchCursor, or null. Never blocks. */
NativeSelectionMonitor.getWatchedCursor = function getWatchedCursor() {
  if (process.platform !== 'linux' || !desktopProbe) return null;
  try {
    return desktopProbe.getWatchedCursor();
  } catch {
    return null;
  }
};

module.exports = NativeSelectionMonitor;
