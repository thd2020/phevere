import { execFile } from 'child_process';

/**
 * Linux tray host probe.
 *
 * Electron's Linux Tray (Chromium StatusIconLinuxDbus) asks the session bus once,
 * when the Tray is constructed, whether org.kde.StatusNotifierWatcher exists and
 * reports IsStatusNotifierHostRegistered. If not, it falls back to a GTK XEmbed
 * icon for good; there is no retry. On Wayland panels XEmbed icons never show, so
 * a Tray created before the panel's watcher is up stays invisible.
 */

export type TrayHostState = 'ready' | 'absent' | 'unknown';

const WATCHER = 'org.kde.StatusNotifierWatcher';
const WATCHER_PATH = '/StatusNotifierWatcher';
const HOST_PROP = 'IsStatusNotifierHostRegistered';

type Probe = { cmd: string; args: string[]; parse: (out: string) => boolean };

const PROBES: Probe[] = [
  {
    cmd: 'gdbus',
    args: ['call', '--session', '--dest', WATCHER, '--object-path', WATCHER_PATH, '--method', 'org.freedesktop.DBus.Properties.Get', WATCHER, HOST_PROP],
    parse: (out) => /true/.test(out),
  },
  {
    cmd: 'busctl',
    args: ['--user', 'get-property', WATCHER, WATCHER_PATH, WATCHER, HOST_PROP],
    parse: (out) => /\btrue\b/.test(out),
  },
  {
    cmd: 'dbus-send',
    args: ['--session', '--print-reply', `--dest=${WATCHER}`, WATCHER_PATH, 'org.freedesktop.DBus.Properties.Get', `string:${WATCHER}`, `string:${HOST_PROP}`],
    parse: (out) => /boolean true/.test(out),
  },
];

function run(probe: Probe): Promise<{ ok: boolean; out: string; missing: boolean }> {
  return new Promise((resolve) => {
    execFile(probe.cmd, probe.args, { timeout: 3000, windowsHide: true }, (err, stdout) => {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      resolve({ ok: !err, out: String(stdout || ''), missing: code === 'ENOENT' });
    });
  });
}

/** 'unknown' when no D-Bus client tool is installed. */
export async function probeTrayHost(): Promise<TrayHostState> {
  for (const probe of PROBES) {
    const r = await run(probe);
    if (r.missing) continue;
    // A call error means the watcher name has no owner.
    return r.ok && probe.parse(r.out) ? 'ready' : 'absent';
  }
  return 'unknown';
}

export function linuxSessionInfo(): Record<string, string> {
  return {
    sessionType: process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : process.env.DISPLAY ? 'x11' : ''),
    desktop: process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '',
    arch: process.arch,
  };
}

/**
 * When the host is missing at startup, poll until it appears and call
 * `onReady` so the caller can rebuild the Tray on the D-Bus backend.
 * `onSlow` runs once if no host has shown up after `slowMs`; polling continues
 * every 15 s after that, since a GNOME user may turn on AppIndicator later.
 */
export function watchTrayHost(opts: { onReady: () => void; onSlow: () => void; slowMs?: number }): () => void {
  const slowAt = Date.now() + (opts.slowMs ?? 60_000);
  let warned = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    if (stopped) return;
    const state = await probeTrayHost();
    if (stopped) return;
    if (state === 'ready') {
      stopped = true;
      opts.onReady();
      return;
    }
    if (state === 'unknown') {
      stopped = true;
      return;
    }
    if (!warned && Date.now() >= slowAt) {
      warned = true;
      opts.onSlow();
    }
    timer = setTimeout(() => void tick(), warned ? 15_000 : 2000);
  };
  timer = setTimeout(() => void tick(), 2000);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
