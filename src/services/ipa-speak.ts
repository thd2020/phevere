/**
 * Speak an IPA string (chip speakers) or fetch a recorded dictionary MP3 (toolbar).
 * Never falls back to spelling the headword.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import {
  accentToBcp47,
  buildIpaPhonemeSsml,
  buildSapiPhonemeSsml,
  bytesToBase64,
  getHttp,
  ipaToApplePhonemes,
  ipaToEspeakPhonemes,
  phonemeIpa,
} from '@phevere/core';
import { wrapConsole } from '../logger';

const console = wrapConsole('ipa-speak');

const MAX_AUDIO_BYTES = 2_000_000;
const WIKIMEDIA_UA = 'Phevere/1.5 (https://github.com/thd2020/phevere; desktop dictionary)';
const audioCache = new Map<string, string>();
let spawnChild: ChildProcess | null = null;
let sapiHost: ChildProcess | null = null;
let hostAcc = '';
let hostWaiter: ((line: string) => void) | null = null;
let hostCulture = '';
let speakTail: Promise<void> = Promise.resolve();
const ssmlPath = path.join(os.tmpdir(), `phevere-ipa-${process.pid}.ssml`);

function resolveScript(fileName: string): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', fileName),
    path.join(process.resourcesPath || '', fileName),
    path.join(process.resourcesPath || '', 'scripts', fileName),
    path.join(app.getAppPath(), 'scripts', fileName),
    path.join(process.cwd(), 'scripts', fileName),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

function powershellExe(): string {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function killSpawn(): void {
  if (!spawnChild) return;
  try {
    spawnChild.kill();
  } catch {
    /* already gone */
  }
  spawnChild = null;
}

function killSapiHost(): void {
  const child = sapiHost;
  sapiHost = null;
  hostAcc = '';
  hostWaiter = null;
  hostCulture = '';
  if (!child) return;
  try {
    child.stdin?.write('QUIT\n');
  } catch {
    /* ignore */
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
}

export function cancelIpaSpeak(): void {
  killSpawn();
  killSapiHost();
}

function onHostData(buf: Buffer): void {
  hostAcc += buf.toString('utf8');
  while (hostWaiter) {
    const nl = hostAcc.indexOf('\n');
    if (nl < 0) return;
    const line = hostAcc.slice(0, nl).replace(/\r$/, '');
    hostAcc = hostAcc.slice(nl + 1);
    if (!line.trim()) continue;
    const fn = hostWaiter;
    hostWaiter = null;
    fn(line);
  }
}

function waitHostLine(timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (hostWaiter) hostWaiter = null;
      reject(new Error('SAPI host timeout'));
    }, timeoutMs);
    hostWaiter = (line) => {
      clearTimeout(timer);
      resolve(line);
    };
    onHostData(Buffer.alloc(0));
  });
}

function startSapiHost(hideWindow: boolean): ChildProcess {
  const script = resolveScript('speak_ipa_host.ps1');
  if (!fs.existsSync(script)) {
    throw new Error('speak_ipa_host.ps1 missing');
  }
  const child = spawn(
    powershellExe(),
    ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: hideWindow, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stdout?.on('data', onHostData);
  child.stderr?.on('data', (d) => {
    console.warn('SAPI host stderr', d.toString('utf8').slice(0, 300));
  });
  child.on('exit', () => {
    if (sapiHost === child) {
      sapiHost = null;
      hostCulture = '';
    }
    if (hostWaiter) {
      const fn = hostWaiter;
      hostWaiter = null;
      fn('ERR host exit');
    }
  });
  return child;
}

async function ensureSapiHost(): Promise<ChildProcess> {
  if (sapiHost && sapiHost.exitCode == null) return sapiHost;
  killSapiHost();
  hostAcc = '';
  let child = startSapiHost(true);
  sapiHost = child;
  await new Promise((r) => setTimeout(r, 250));
  if (child.exitCode != null) {
    console.warn('SAPI host exited with hidden window, retrying visible');
    child = startSapiHost(false);
    sapiHost = child;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (child.exitCode != null) {
    sapiHost = null;
    throw new Error(`SAPI host exited ${child.exitCode}`);
  }
  return child;
}

async function hostCommand(cmd: string, timeoutMs: number): Promise<string> {
  const child = await ensureSapiHost();
  if (!child.stdin) throw new Error('SAPI host has no stdin');
  try {
    child.stdin.write(`${cmd}\n`);
    return await waitHostLine(timeoutMs);
  } catch (err) {
    killSapiHost();
    throw err;
  }
}

async function speakWinSsml(ssml: string, culture: string): Promise<void> {
  fs.writeFileSync(ssmlPath, ssml, 'utf8');
  if (hostCulture !== culture) {
    const cult = await hostCommand(`CULTURE ${culture}`, 8000);
    if (!/^OK\b/i.test(cult)) throw new Error(cult);
    hostCulture = culture;
  }
  const reply = await hostCommand(`SPEAK ${ssmlPath}`, 15000);
  if (!/^OK\b/i.test(reply)) throw new Error(reply);
}

function runChild(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    killSpawn();
    const child = spawn(command, args, { windowsHide: false });
    spawnChild = child;
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error('IPA speak timeout'));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (spawnChild === child) spawnChild = null;
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (spawnChild === child) spawnChild = null;
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exit ${code}`));
        return;
      }
      resolve();
    });
  });
}

function whichSync(bin: string): string | null {
  const pathEnv = process.env.PATH || '';
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];
  const names = process.platform === 'win32' ? exts.map((e) => bin + e) : [bin];
  for (const dir of pathEnv.split(path.delimiter)) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  const extras = [
    'C:\\Program Files\\eSpeak NG\\espeak-ng.exe',
    'C:\\Program Files (x86)\\eSpeak NG\\espeak-ng.exe',
    '/opt/homebrew/bin/espeak-ng',
    '/usr/local/bin/espeak-ng',
    '/usr/bin/espeak-ng',
    '/opt/homebrew/bin/espeak',
    '/usr/local/bin/espeak',
    '/usr/bin/espeak',
  ];
  for (const extra of extras) {
    if (fs.existsSync(extra)) return extra;
  }
  return null;
}

async function speakEspeak(ipa: string, accent?: string): Promise<void> {
  const bin = whichSync('espeak-ng') || whichSync('espeak');
  if (!bin) throw new Error('espeak not found');
  const ph = ipaToEspeakPhonemes(ipa);
  if (!ph) throw new Error('Cannot map this IPA');
  const voice = accent === 'uk' ? 'en-gb' : 'en-us';
  await runChild(bin, ['-v', voice, `[[${ph}]]`], 12000);
}

function speakWinSsmlOneshot(ssml: string, culture: string): Promise<void> {
  const script = resolveScript('speak_ipa.ps1');
  if (!fs.existsSync(script)) {
    return Promise.reject(new Error('speak_ipa.ps1 missing'));
  }
  fs.writeFileSync(ssmlPath, ssml, 'utf8');
  return runChild(
    powershellExe(),
    [
      '-NoProfile',
      '-STA',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-SsmlPath',
      ssmlPath,
      '-Culture',
      culture,
    ],
    15000,
  );
}

async function speakWindows(ipa: string, accent?: string): Promise<void> {
  const lang = accentToBcp47(accent);
  const ipaSsml = buildIpaPhonemeSsml(ipa, lang);
  const sapiSsml = buildSapiPhonemeSsml(ipa, lang);
  const attempts: string[] = [];
  if (ipaSsml) attempts.push(ipaSsml);
  if (sapiSsml) attempts.push(sapiSsml);
  let lastErr: unknown;
  for (const ssml of attempts) {
    try {
      await speakWinSsml(ssml, lang);
      return;
    } catch (err) {
      lastErr = err;
      console.warn('SAPI host speak failed', err);
    }
  }
  for (const ssml of attempts) {
    try {
      await speakWinSsmlOneshot(ssml, lang);
      return;
    } catch (err) {
      lastErr = err;
      console.warn('SAPI oneshot failed', err);
    }
  }
  try {
    await speakEspeak(ipa, accent);
  } catch (err) {
    throw lastErr || err;
  }
}

async function speakMac(ipa: string, accent?: string): Promise<void> {
  const ph = ipaToApplePhonemes(ipa);
  if (!ph) throw new Error('Cannot map this IPA');
  const spoken = `[[inpt PHON]]${ph}`;
  const preferred = accent === 'uk' ? ['Daniel', 'Kate', 'Samantha'] : ['Samantha', 'Alex', 'Daniel'];
  for (const voice of preferred) {
    try {
      await runChild('say', ['-v', voice, spoken], 12000);
      return;
    } catch {
      /* try next voice */
    }
  }
  try {
    await runChild('say', [spoken], 12000);
    return;
  } catch (err) {
    console.warn('say PHON failed', err);
  }
  await speakEspeak(ipa, accent);
}

export async function speakIpa(ipaRaw: string, accent?: string): Promise<void> {
  const ipa = phonemeIpa(ipaRaw);
  if (!ipa) throw new Error('Empty IPA');
  const job = speakTail.then(async () => {
    if (process.platform === 'win32') {
      await speakWindows(ipa, accent);
      return;
    }
    if (process.platform === 'darwin') {
      await speakMac(ipa, accent);
      return;
    }
    await speakEspeak(ipa, accent);
  });
  speakTail = job.then(
    (): void => undefined,
    (): void => undefined,
  );
  return job;
}

function isAllowedAudioUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  if (host.includes(':')) return false;
  return true;
}

function refererFor(url: string): string {
  if (/gstatic\.com/i.test(url)) return 'https://www.google.com/';
  if (/dictionaryapi\.dev/i.test(url)) return 'https://api.dictionaryapi.dev/';
  if (/wikimedia\.org|wiktionary\.org/i.test(url)) return 'https://en.wiktionary.org/';
  return 'https://en.wiktionary.org/';
}

function audioHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { Referer: refererFor(url) };
  if (/wikimedia\.org|wiktionary\.org/i.test(url)) {
    headers['User-Agent'] = WIKIMEDIA_UA;
  }
  return headers;
}

function isPlayableAudioMime(mime: string): boolean {
  const m = (mime || '').split(';')[0].trim().toLowerCase();
  if (!m) return true;
  if (m.startsWith('audio/')) return true;
  if (m === 'application/ogg' || m === 'application/octet-stream') return true;
  if (m === 'video/ogg') return true;
  return false;
}

function fileNameFromCommonsUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/Special:FilePath\/(.+)$/i);
    if (!m) return '';
    return decodeURIComponent(m[1]);
  } catch {
    return '';
  }
}

async function resolveCommonsDirectUrl(fileName: string): Promise<string> {
  const title = `File:${fileName.replace(/^File:/i, '')}`;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(title)}`;
  try {
    const res = await getHttp().requestText(api, {
      timeoutMs: 8000,
      headers: { 'User-Agent': WIKIMEDIA_UA },
    });
    if (!res.ok) return '';
    const data = JSON.parse(res.text) as {
      query?: { pages?: Record<string, { imageinfo?: Array<{ url?: string }> }> };
    };
    const pages = data.query?.pages || {};
    for (const page of Object.values(pages)) {
      const raw = page?.imageinfo?.[0]?.url || '';
      if (raw) return raw.split('?')[0];
    }
  } catch {
    /* missing file or network */
  }
  return '';
}

export async function fetchPronunciationAudio(
  url: string,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const trimmed = String(url || '').trim();
  if (!isAllowedAudioUrl(trimmed)) {
    return { ok: false, error: 'Blocked audio URL' };
  }
  const hit = audioCache.get(trimmed);
  if (hit) return { ok: true, dataUrl: hit };

  const tryFetch = async (target: string) => {
    const http = getHttp();
    const res = await http.requestBytes(target, {
      timeoutMs: 12000,
      headers: audioHeaders(target),
    });
    if (!res.ok || !res.bytes || res.bytes.byteLength < 64) {
      return { ok: false as const, error: `HTTP ${res.status}` };
    }
    if (res.bytes.byteLength > MAX_AUDIO_BYTES) {
      return { ok: false as const, error: 'Audio too large' };
    }
    const mime = (res.contentType || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
    if (!isPlayableAudioMime(mime)) {
      return { ok: false as const, error: 'Not audio' };
    }
    return { ok: true as const, mime, bytes: res.bytes };
  };

  try {
    let got = await tryFetch(trimmed);
    if (!got.ok) {
      const fileName = fileNameFromCommonsUrl(trimmed);
      if (fileName) {
        const direct = await resolveCommonsDirectUrl(fileName);
        if (direct && direct !== trimmed) got = await tryFetch(direct);
      }
    }
    if (!got.ok) return { ok: false, error: got.error };
    const dataUrl = `data:${got.mime};base64,${bytesToBase64(got.bytes)}`;
    if (audioCache.size > 24) {
      const first = audioCache.keys().next().value;
      if (first) audioCache.delete(first);
    }
    audioCache.set(trimmed, dataUrl);
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
