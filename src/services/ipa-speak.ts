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

const MAX_AUDIO_BYTES = 1_500_000;
const audioCache = new Map<string, string>();
let currentChild: ChildProcess | null = null;
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

function killCurrent(): void {
  if (!currentChild) return;
  try {
    currentChild.kill();
  } catch {
    /* already gone */
  }
  currentChild = null;
}

export function cancelIpaSpeak(): void {
  killCurrent();
}

function runChild(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    killCurrent();
    const child = spawn(command, args, { windowsHide: true });
    currentChild = child;
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
      if (currentChild === child) currentChild = null;
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (currentChild === child) currentChild = null;
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

function speakWinSsml(ssml: string, culture: string): Promise<void> {
  const script = resolveScript('speak_ipa.ps1');
  if (!fs.existsSync(script)) {
    return Promise.reject(new Error('speak_ipa.ps1 missing'));
  }
  fs.writeFileSync(ssmlPath, ssml, 'utf8');
  const ps =
    process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
  return runChild(
    ps,
    [
      '-NoProfile',
      '-NonInteractive',
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
  if (ipaSsml) {
    try {
      await speakWinSsml(ipaSsml, lang);
      return;
    } catch (err) {
      console.warn('IPA SSML failed', err);
    }
  }
  const sapi = buildSapiPhonemeSsml(ipa, lang);
  if (sapi) {
    try {
      await speakWinSsml(sapi, lang);
      return;
    } catch (err) {
      console.warn('SAPI phonemes failed', err);
    }
  }
  await speakEspeak(ipa, accent);
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
  if (process.platform === 'win32') {
    await speakWindows(ipa, accent);
    return;
  }
  if (process.platform === 'darwin') {
    await speakMac(ipa, accent);
    return;
  }
  await speakEspeak(ipa, accent);
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
  return 'https://en.wiktionary.org/';
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
  cancelIpaSpeak();
  try {
    const http = getHttp();
    const res = await http.requestBytes(trimmed, {
      timeoutMs: 8000,
      headers: { Referer: refererFor(trimmed) },
    });
    if (!res.ok || !res.bytes || res.bytes.byteLength < 64) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    if (res.bytes.byteLength > MAX_AUDIO_BYTES) {
      return { ok: false, error: 'Audio too large' };
    }
    const mime = (res.contentType || 'audio/mpeg').split(';')[0].trim() || 'audio/mpeg';
    if (!/^audio\//i.test(mime) && mime !== 'application/octet-stream') {
      return { ok: false, error: 'Not audio' };
    }
    const dataUrl = `data:${mime};base64,${bytesToBase64(res.bytes)}`;
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
