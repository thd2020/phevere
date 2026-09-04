/**
 * Speak an IPA string (chip speakers) or fetch a recorded dictionary MP3 (toolbar).
 * Never falls back to spelling the headword.
 */

import { spawn, ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, protocol } from 'electron';
import {
  accentToBcp47,
  buildIpaPhonemeSsml,
  buildSapiPhonemeSsml,
  getHttp,
  ipaToApplePhonemes,
  ipaToEspeakPhonemes,
  normalizePronunciationAudioUrl,
  phonemeIpa,
} from '@phevere/core';
import { log, wrapConsole } from '../logger';

const console = wrapConsole('ipa-speak');

try {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'phevere-audio',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true,
      },
    },
  ]);
} catch {
  /* hot reload */
}

const MAX_AUDIO_BYTES = 2_000_000;
const MAX_MEM_CACHE = 64;
const MAX_DISK_FILES = 80;
const MAX_DISK_BYTES = 40 * 1024 * 1024;
const WIKIMEDIA_UA = 'Phevere/1.5 (https://github.com/thd2020/phevere; desktop dictionary)';
/** url → phevere-audio://clip/<key> */
const audioCache = new Map<string, string>();
const audioFailUntil = new Map<string, number>();
const audioInflight = new Map<string, Promise<PronunciationAudioResult>>();
const FAIL_TTL_NOT_FOUND = 30 * 60 * 1000;
const FAIL_TTL_TIMEOUT = 45 * 1000;
const AUDIO_FETCH_MS = 4000;

export type PronunciationAudioResult =
  | { ok: true; playUrl: string; cached: boolean }
  | { ok: false; error: string };
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

function playableMime(raw?: string): string {
  const m = (raw || '').split(';')[0].trim().toLowerCase();
  if (m === 'application/ogg' || m === 'video/ogg') return 'audio/ogg';
  if (m === 'audio/x-wav' || m === 'audio/wave') return 'audio/wav';
  if (m.startsWith('audio/')) return m;
  if (m === 'application/octet-stream') return 'audio/mpeg';
  return m || 'audio/ogg';
}

function fileNameFromCommonsUrl(url: string): string {
  try {
    const u = new URL(url);
    const fp = u.pathname.match(/Special:FilePath\/(.+)$/i);
    if (fp) return decodeURIComponent(fp[1]).replace(/^File:/i, '').replace(/ /g, '_');
    const redir = u.pathname.match(/Special:Redirect\/file\/(.+)$/i);
    if (redir) return decodeURIComponent(redir[1]).replace(/^File:/i, '').replace(/ /g, '_');
    const up = u.pathname.match(/\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/(.+)$/i);
    if (up) return decodeURIComponent(up[1]);
  } catch {
    /* ignore */
  }
  return '';
}

function md5UploadUrl(fileName: string): string {
  const f = fileName.replace(/^File:/i, '').trim().replace(/ /g, '_');
  const md5 = createHash('md5').update(f).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5.slice(0, 2)}/${encodeURIComponent(f)}`;
}

function wikiFileNameVariants(fileName: string): string[] {
  const f = fileName.replace(/^File:/i, '').trim().replace(/ /g, '_');
  if (!f) return [];
  const cap = f.charAt(0).toUpperCase() + f.slice(1);
  return [...new Set([cap, f])];
}

/** Direct Commons bytes. Skip Special:FilePath — each 302 was 2–3s on this network. */
function commonsFetchTargets(requestUrl: string): string[] {
  const name = fileNameFromCommonsUrl(requestUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const c = canonicalAudioUrl(raw);
    if (!c || seen.has(c) || !isAllowedAudioUrl(c)) return;
    seen.add(c);
    out.push(c);
  };
  if (name) {
    for (const v of wikiFileNameVariants(name)) push(md5UploadUrl(v));
  } else {
    push(requestUrl);
  }
  return out;
}

async function resolveCommonsDirectUrl(fileName: string): Promise<string> {
  const title = `File:${fileName.replace(/^File:/i, '')}`;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(title)}`;
  try {
    const res = await getHttp().requestText(api, {
      timeoutMs: 4000,
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

function audioCacheDir(): string {
  return path.join(app.getPath('userData'), 'pronunciation-cache');
}

function canonicalAudioUrl(raw: string): string {
  let s = normalizePronunciationAudioUrl(raw) || String(raw || '').trim();
  if (s.startsWith('http://')) s = `https://${s.slice(7)}`;
  return s;
}

function failUntil(url: string): number | undefined {
  const until = audioFailUntil.get(url);
  if (!until) return undefined;
  if (Date.now() > until) {
    audioFailUntil.delete(url);
    return undefined;
  }
  return until;
}

function rememberFail(url: string, ttlMs: number): void {
  audioFailUntil.set(url, Date.now() + ttlMs);
}

function audioCacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

function rememberAudio(url: string, playUrl: string): void {
  if (audioCache.size >= MAX_MEM_CACHE) {
    const first = audioCache.keys().next().value;
    if (first) audioCache.delete(first);
  }
  audioCache.set(url, playUrl);
}

function playUrlForKey(key: string): string {
  return `phevere-audio://clip/${key}`;
}

function diskPlayUrl(url: string): string {
  try {
    const key = audioCacheKey(url);
    const binPath = path.join(audioCacheDir(), `${key}.bin`);
    if (!fs.existsSync(binPath)) return '';
    const st = fs.statSync(binPath);
    if (!st.size || st.size > MAX_AUDIO_BYTES) return '';
    try {
      fs.utimesSync(binPath, new Date(), new Date());
    } catch {
      /* ignore */
    }
    return playUrlForKey(key);
  } catch {
    return '';
  }
}

function writeDiskAudio(url: string, mime: string, bytes: Buffer | Uint8Array): string {
  const key = audioCacheKey(url);
  const dir = audioCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.bin`), bytes);
  fs.writeFileSync(
    path.join(dir, `${key}.json`),
    JSON.stringify({ mime: playableMime(mime), url, savedAt: Date.now() }),
  );
  pruneDiskAudio(dir);
  return playUrlForKey(key);
}

export function installPronunciationAudioProtocol(): void {
  try {
    protocol.handle('phevere-audio', (request) => {
      let key = '';
      try {
        key = new URL(request.url).pathname.replace(/^\//, '');
      } catch {
        return new Response('Bad URL', { status: 400 });
      }
      if (!/^[a-f0-9]{32}$/.test(key)) {
        return new Response('Bad key', { status: 400 });
      }
      const dir = audioCacheDir();
      const binPath = path.join(dir, `${key}.bin`);
      const metaPath = path.join(dir, `${key}.json`);
      if (!fs.existsSync(binPath)) return new Response('Missing', { status: 404 });
      let mime = 'audio/ogg';
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { mime?: string };
        mime = playableMime(meta.mime || mime);
      } catch {
        /* default */
      }
      const bytes = fs.readFileSync(binPath);
      return new Response(bytes, {
        headers: {
          'content-type': mime,
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    });
  } catch (err) {
    log.warn('ipa-speak', 'pronunciation protocol already installed', { err: String(err) });
  }
}

function pruneDiskAudio(dir: string): void {
  try {
    const bins = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.bin'))
      .map((name) => {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        return { name, full, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => a.mtime - b.mtime);
    let total = bins.reduce((n, f) => n + f.size, 0);
    while (bins.length > MAX_DISK_FILES || total > MAX_DISK_BYTES) {
      const oldest = bins.shift();
      if (!oldest) break;
      total -= oldest.size;
      try {
        fs.unlinkSync(oldest.full);
        fs.unlinkSync(oldest.full.replace(/\.bin$/, '.json'));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export async function fetchPronunciationAudio(url: string): Promise<PronunciationAudioResult> {
  const t0 = Date.now();
  const trimmed = canonicalAudioUrl(url);
  if (!isAllowedAudioUrl(trimmed)) {
    return { ok: false as const, error: 'Blocked audio URL' };
  }
  const hit = audioCache.get(trimmed);
  if (hit) {
    log.info('ipa-speak', 'pronunciation audio', { source: 'mem', ms: Date.now() - t0, host: hostOf(trimmed) });
    return { ok: true as const, playUrl: hit, cached: true };
  }
  const disk = diskPlayUrl(trimmed);
  if (disk) {
    rememberAudio(trimmed, disk);
    log.info('ipa-speak', 'pronunciation audio', { source: 'disk', ms: Date.now() - t0, host: hostOf(trimmed) });
    return { ok: true as const, playUrl: disk, cached: true };
  }
  if (failUntil(trimmed)) {
    return { ok: false as const, error: 'Known missing clip' };
  }
  const pending = audioInflight.get(trimmed);
  if (pending) return pending;

  const work = (async (): Promise<PronunciationAudioResult> => {
    const tryFetch = async (target: string) => {
      const started = Date.now();
      const http = getHttp();
      const res = await http.requestBytes(target, {
        timeoutMs: AUDIO_FETCH_MS,
        headers: audioHeaders(target),
      });
      const ms = Date.now() - started;
      if (!res.ok || !res.bytes || res.bytes.byteLength < 64) {
        log.info('ipa-speak', 'pronunciation fetch miss', { host: hostOf(target), status: res.status, ms });
        return { ok: false as const, error: `HTTP ${res.status}` };
      }
      if (res.bytes.byteLength > MAX_AUDIO_BYTES) {
        return { ok: false as const, error: 'Audio too large' };
      }
      const mime = (res.contentType || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
      if (!isPlayableAudioMime(mime)) {
        log.info('ipa-speak', 'pronunciation not audio', { host: hostOf(target), mime, ms });
        return { ok: false as const, error: 'Not audio' };
      }
      log.info('ipa-speak', 'pronunciation fetch hit', {
        host: hostOf(target),
        bytes: res.bytes.byteLength,
        mime,
        ms,
      });
      return { ok: true as const, mime, bytes: res.bytes, target };
    };

    try {
      const targets = commonsFetchTargets(trimmed);
      let got: Awaited<ReturnType<typeof tryFetch>> = { ok: false as const, error: 'No audio URL' };
      for (const target of targets) {
        if (failUntil(target)) continue;
        got = await tryFetch(target);
        if (got.ok) break;
      }
      if (!got.ok) {
        const fileName = fileNameFromCommonsUrl(trimmed);
        for (const v of fileName ? wikiFileNameVariants(fileName) : []) {
          const direct = await resolveCommonsDirectUrl(v);
          const canonDirect = direct ? canonicalAudioUrl(direct) : '';
          if (canonDirect && !targets.includes(canonDirect)) {
            got = await tryFetch(canonDirect);
            if (got.ok) break;
          }
        }
      }
      if (!got.ok) {
        const timeout = /timed out|timeout|TIMEOUT/i.test(got.error);
        rememberFail(trimmed, timeout ? FAIL_TTL_TIMEOUT : FAIL_TTL_NOT_FOUND);
        log.info('ipa-speak', 'pronunciation audio', {
          source: 'fail',
          ms: Date.now() - t0,
          host: hostOf(trimmed),
          error: got.error,
        });
        return { ok: false as const, error: got.error };
      }
      let playUrl = '';
      try {
        playUrl = writeDiskAudio(trimmed, got.mime, got.bytes);
      } catch (err) {
        console.warn('pronunciation disk cache write failed', err);
        return { ok: false as const, error: 'Cache write failed' };
      }
      rememberAudio(trimmed, playUrl);
      const fetched = canonicalAudioUrl(got.target);
      if (fetched && fetched !== trimmed) rememberAudio(fetched, playUrl);
      log.info('ipa-speak', 'pronunciation audio', {
        source: 'net',
        ms: Date.now() - t0,
        bytes: got.bytes.byteLength,
        host: hostOf(got.target),
      });
      return { ok: true as const, playUrl, cached: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const timeout = /timed out|timeout|TIMEOUT/i.test(msg);
      rememberFail(trimmed, timeout ? FAIL_TTL_TIMEOUT : FAIL_TTL_NOT_FOUND);
      log.info('ipa-speak', 'pronunciation audio', {
        source: 'error',
        ms: Date.now() - t0,
        host: hostOf(trimmed),
        error: msg,
      });
      return { ok: false as const, error: msg };
    }
  })();

  audioInflight.set(trimmed, work);
  try {
    return await work;
  } finally {
    audioInflight.delete(trimmed);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function prefetchPronunciationUrls(urls: string[]): void {
  const seen = new Set<string>();
  for (const raw of urls) {
    const u = canonicalAudioUrl(raw);
    if (!u || seen.has(u) || failUntil(u)) continue;
    if (seen.size >= 4) break;
    seen.add(u);
    void fetchPronunciationAudio(u);
  }
}
