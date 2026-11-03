/**
 * Where a looked-up word was met, captured at the moment of a selection lookup and attached to
 * the word if the learner saves it (packages/core/src/source-context.ts).
 *
 * Windows: the foreground window's handle, title and process name are read at once with user32
 * (microseconds, before the pop-up appears). A long-lived hidden PowerShell process
 * (scripts/source_context_host.ps1) then reads, through UI Automation, the page URL of a browser,
 * the page number of a PDF reader and the paragraph around the selection. macOS: System Events
 * gives the front app and window title, and Safari or Chrome give the page URL.
 *
 * None of this is on the lookup's critical path: the pop-up never waits for it, and a save that
 * comes before the capture finishes gets its context a moment later. Private and incognito
 * windows are skipped before anything is read from them.
 */
import { execFile, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { lookupTextMatches, parseWindowTitle, sourceFromWindow, type SourceContext, type WindowReading } from '@phevere/core';
import { wrapConsole } from '../logger';

const console = wrapConsole('source-capture');

/** A save matches a lookup made at most this long ago. */
const KEEP_MS = 30 * 60 * 1000;
const HOST_TIMEOUT_MS = 3500;

interface Pending {
  text: string;
  at: number;
  result: Promise<SourceContext | null>;
}

const recent: Pending[] = [];

/* ------------------------------------------------------------ Windows window */

export interface ForegroundWindow {
  hwnd: string;
  pid: number;
  process: string;
  title: string;
}

type Win32 = {
  getForegroundWindow: () => number | bigint;
  getWindowTextW: (hwnd: number | bigint, buf: Buffer, max: number) => number;
  getWindowThreadProcessId: (hwnd: number | bigint, pid: number[]) => number;
  openProcess: (access: number, inherit: boolean, pid: number) => number | bigint;
  queryFullProcessImageNameW: (h: number | bigint, flags: number, buf: Buffer, size: number[]) => boolean;
  closeHandle: (h: number | bigint) => boolean;
};

let win32: Win32 | null | undefined;

function loadWin32(): Win32 | null {
  if (win32 !== undefined) return win32;
  win32 = null;
  if (process.platform !== 'win32') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as { load: (name: string) => { func: (sig: string) => (...args: any[]) => any } };
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    win32 = {
      getForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      getWindowTextW: user32.func('int __stdcall GetWindowTextW(uintptr_t hWnd, void *lpString, int nMaxCount)'),
      getWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'),
      openProcess: kernel32.func('uintptr_t __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'),
      queryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(uintptr_t hProcess, uint32_t dwFlags, void *lpExeName, _Inout_ uint32_t *lpdwSize)'),
      closeHandle: kernel32.func('bool __stdcall CloseHandle(uintptr_t hObject)'),
    };
  } catch (error) {
    console.warn('koffi user32 unavailable', error);
    win32 = null;
  }
  return win32;
}

/** The foreground window right now, or null. Synchronous and cheap. */
export function readForegroundWindow(): ForegroundWindow | null {
  const api = loadWin32();
  if (!api) return null;
  try {
    const hwnd = api.getForegroundWindow();
    if (!hwnd) return null;
    const buf = Buffer.alloc(1024);
    const n = api.getWindowTextW(hwnd, buf, 512);
    const title = buf.toString('utf16le', 0, Math.max(0, n) * 2);
    const pidOut = [0];
    api.getWindowThreadProcessId(hwnd, pidOut);
    const pid = Number(pidOut[0]) || 0;
    let processName = '';
    if (pid) {
      const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
      const h = api.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
      if (h) {
        try {
          const nameBuf = Buffer.alloc(2048);
          const size = [1024];
          if (api.queryFullProcessImageNameW(h, 0, nameBuf, size)) {
            const full = nameBuf.toString('utf16le', 0, Number(size[0]) * 2);
            processName = path.win32.basename(full).replace(/\.exe$/i, '');
          }
        } finally {
          api.closeHandle(h);
        }
      }
    }
    return { hwnd: String(hwnd), pid, process: processName, title };
  } catch (error) {
    console.warn('foreground window read failed', error);
    return null;
  }
}

/* ------------------------------------------------------------- UIA reader */

let host: ChildProcess | null = null;
let hostBuf = '';
let nextId = 1;
let timeouts = 0;
const waiting = new Map<number, (r: WindowReading | null) => void>();

function resolveScript(fileName: string): string {
  let appPath = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    appPath = require('electron').app?.getAppPath?.() || '';
  } catch {
    /* plain Node (the probe): no Electron */
  }
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', fileName),
    path.join(process.resourcesPath || '', fileName),
    path.join(process.resourcesPath || '', 'scripts', fileName),
    appPath ? path.join(appPath, 'scripts', fileName) : '',
    path.join(process.cwd(), 'scripts', fileName),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) || candidates[candidates.length - 1];
}

function powershellExe(): string {
  return process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
}

function onHostData(chunk: Buffer): void {
  hostBuf += chunk.toString('utf8');
  for (let nl = hostBuf.indexOf('\n'); nl >= 0; nl = hostBuf.indexOf('\n')) {
    const line = hostBuf.slice(0, nl).trim();
    hostBuf = hostBuf.slice(nl + 1);
    if (!line) continue;
    try {
      const reply = JSON.parse(line) as WindowReading & { id?: number; error?: string };
      const done = reply.id != null ? waiting.get(Number(reply.id)) : undefined;
      if (!done) continue;
      waiting.delete(Number(reply.id));
      done(reply.error ? null : reply);
    } catch {
      /* a stray line from PowerShell */
    }
  }
}

function stopHost(): void {
  const child = host;
  host = null;
  hostBuf = '';
  for (const done of waiting.values()) done(null);
  waiting.clear();
  try {
    child?.stdin?.end('QUIT\n');
    child?.kill();
  } catch {
    /* already gone */
  }
}

function ensureHost(): ChildProcess | null {
  if (host && host.exitCode == null) return host;
  const script = resolveScript('source_context_host.ps1');
  if (!fs.existsSync(script)) {
    console.warn('source_context_host.ps1 missing');
    return null;
  }
  const child = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  child.stdout?.on('data', onHostData);
  child.on('error', () => {
    if (host === child) stopHost();
  });
  child.on('exit', () => {
    if (host === child) stopHost();
  });
  host = child;
  return child;
}

/** Asks the UIA reader about one window; null on any failure or after the timeout. */
export function readWindow(hwnd: string, kind: string): Promise<WindowReading | null> {
  const child = ensureHost();
  if (!child?.stdin) return Promise.resolve(null);
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!waiting.delete(id)) return;
      resolve(null);
      // A reader stuck on one window (a hung app) is restarted rather than left to queue.
      timeouts += 1;
      if (timeouts >= 2) {
        timeouts = 0;
        stopHost();
      }
    }, HOST_TIMEOUT_MS);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      timeouts = 0;
      resolve(r);
    });
    child.stdin!.write(`${JSON.stringify({ id, hwnd, kind })}\n`);
  });
}

/* ------------------------------------------------------------------- macOS */

/** Runs AppleScript without blocking the main process; '' on any failure. */
function osa(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { encoding: 'utf8', timeout: 2500 }, (_err, stdout) => resolve(String(stdout || '').trim()));
  });
}

/** Front app, window title, and the page URL for Safari and Chrome. Null for a private window. */
async function captureDarwin(text: string): Promise<SourceContext | null> {
  const front = await osa(`tell application "System Events"
    set p to first application process whose frontmost is true
    set t to ""
    try
      set t to name of front window of p
    end try
    return (name of p) & tab & t
  end tell`);
  const [app = '', title = ''] = front.split('\t');
  if (!app || /phevere/i.test(app)) return null;
  let url = '';
  let pageTitle = title;
  // Each app is asked only while it is in front, so the script never names an app that is not installed.
  if (app === 'Safari') {
    // Safari leaves private windows out of its documents; a front tab that is not the front
    // document is a private window.
    const r = (await osa(`tell application "Safari"
      set u to URL of current tab of front window
      set n to name of current tab of front window
      set d to ""
      try
        set d to URL of front document
      end try
      return u & tab & n & tab & d
    end tell`)).split('\t');
    if (!r[0] || r[0] !== r[2]) return null;
    [url, pageTitle] = r;
  } else if (app === 'Google Chrome' || app === 'Microsoft Edge' || app === 'Brave Browser') {
    const r = (await osa(`tell application "${app}"
      return (mode of front window) & tab & (URL of active tab of front window) & tab & (title of active tab of front window)
    end tell`)).split('\t');
    if (r[0] !== 'normal') return null;
    url = r[1] || '';
    pageTitle = r[2] || title;
  }
  return sourceFromWindow(app, pageTitle, { url }, text);
}

/* ------------------------------------------------------------------ public */

/**
 * Starts capturing where `text` is being looked up. Call it when a selection or hover lookup
 * opens the pop-up, before the pop-up is shown. Returns at once.
 */
export function noteLookupSource(text: string, now = Date.now()): void {
  const t = String(text || '').trim();
  if (!t) return;
  let result: Promise<SourceContext | null> | null = null;
  if (process.platform === 'win32') {
    const fg = readForegroundWindow();
    if (!fg || fg.pid === process.pid || !fg.process) return;
    const parsed = parseWindowTitle(fg.process, fg.title);
    if (parsed.private) return;
    result = readWindow(fg.hwnd, parsed.kind)
      .catch((): null => null)
      .then((reading) => sourceFromWindow(fg.process, fg.title, reading, t));
  } else if (process.platform === 'darwin') {
    result = captureDarwin(t).catch((): null => null);
  }
  if (!result) return;
  recent.unshift({ text: t, at: now, result });
  recent.length = Math.min(recent.length, 8);
}

/** The context of the most recent lookup that matches a word being saved, or null. */
export async function sourceForSavedWord(lemma: string, now = Date.now()): Promise<SourceContext | null> {
  const hit = recent.find((p) => now - p.at < KEEP_MS && lookupTextMatches(p.text, lemma));
  if (!hit) return null;
  try {
    return await hit.result;
  } catch {
    return null;
  }
}

/** Forgets pending captures (the setting was switched off) and stops the reader. */
export function clearLookupSources(): void {
  recent.length = 0;
  stopHost();
}

export function disposeSourceCapture(): void {
  stopHost();
}
