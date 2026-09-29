/**
 * Synthetic speech with the Android app's engines and rules.
 *
 *   IPA chip           → eSpeak NG, IPA passed as phonemes, US or UK voice.
 *   Headword, notebook → recorded clip first (renderer); this service is the fallback.
 *   Text (translation) → the voice picked in Settings → Audio:
 *                        Mechanical = eSpeak NG (built in), Neural = Kokoro v1.0 (download).
 *
 * Engines run in scripts/speech-worker.js (utility process). Kokoro models are the same
 * archives, hashes and folders as apps/mobile/.../SpeechModels.java.
 */

import { app, net, utilityProcess, type UtilityProcess } from 'electron';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { ipaToEspeakPhonemes } from '@phevere/core';
import { log } from '../logger';

export type VoiceId = 'mechanical' | 'compact' | 'full';

export interface AudioPrefs {
  enabled: boolean;
  /** 0.5–2; applies to recorded clips and synthetic speech. */
  speed: number;
  /** 0–1, the audio element's volume (1 = full level; the phone's boost above full needs Android). */
  volume: number;
  voice: VoiceId;
}

const DEFAULT_PREFS: AudioPrefs = { enabled: true, speed: 1, volume: 1, voice: 'mechanical' };

interface Variant {
  id: Exclude<VoiceId, 'mechanical'>;
  name: string;
  dir: string;
  archiveDir: string;
  model: string;
  sha: string;
  downloadMb: number;
}

const VARIANTS: Variant[] = [
  {
    id: 'compact',
    name: 'Neural compact',
    dir: 'kokoro-int8-v1',
    archiveDir: 'kokoro-int8-multi-lang-v1_0',
    model: 'model.int8.onnx',
    sha: '4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e',
    downloadMb: 132,
  },
  {
    id: 'full',
    name: 'Neural full quality',
    dir: 'kokoro-v1',
    archiveDir: 'kokoro-multi-lang-v1_0',
    model: 'model.onnx',
    sha: 'c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298',
    downloadMb: 350,
  },
];

const modelUrl = (v: Variant) => `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${v.archiveDir}.tar.bz2`;

// ---------- prefs ----------

const prefsPath = () => path.join(app.getPath('userData'), 'audio-prefs.json');
let prefsCache: AudioPrefs | null = null;

export function getAudioPrefs(): AudioPrefs {
  if (prefsCache) return prefsCache;
  let saved: Partial<AudioPrefs> = {};
  try {
    saved = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
  } catch {
    /* first run */
  }
  prefsCache = { ...DEFAULT_PREFS, ...saved };
  if (prefsCache.voice !== 'mechanical' && !isInstalled(prefsCache.voice)) prefsCache.voice = 'mechanical';
  return prefsCache;
}

export function setAudioPrefs(patch: Partial<AudioPrefs>): AudioPrefs {
  const next = { ...getAudioPrefs(), ...patch };
  next.speed = Math.min(2, Math.max(0.5, Number(next.speed) || 1));
  next.volume = Math.min(1, Math.max(0, Number(next.volume)));
  if (!['mechanical', 'compact', 'full'].includes(next.voice)) next.voice = 'mechanical';
  prefsCache = next;
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2));
  } catch (err) {
    log.warn('speech', 'could not save audio prefs', { err: String(err) });
  }
  return next;
}

// ---------- engine locations ----------

function firstExisting(candidates: string[]): string {
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }) || '';
}

function devRoot(): string {
  // .webpack/main → project root in `electron-forge start`.
  return path.resolve(__dirname, '..', '..');
}

function engineDirs(): { worker: string; espeak: string; sherpa: string } {
  const res = process.resourcesPath || '';
  const root = devRoot();
  return {
    // Packaged: bundled with its unpack libraries by scripts/stage-speech.js.
    worker: firstExisting([path.join(res, 'speech', 'speech-worker.js'), path.join(root, 'scripts', 'speech-worker.js')]),
    espeak: firstExisting([path.join(res, 'speech', 'espeak-ng'), path.join(root, 'node_modules', 'espeak-ng', 'dist')]),
    sherpa: firstExisting([
      path.join(res, 'speech', 'sherpa-onnx-node'),
      path.join(root, 'node_modules', 'sherpa-onnx-node'),
    ]),
  };
}

/** Neural voices need the sherpa-onnx binary for this OS and CPU (none for Windows on ARM). */
export function neuralSupported(): boolean {
  const { sherpa } = engineDirs();
  if (!sherpa) return false;
  const plat = process.platform === 'win32' ? 'win' : process.platform;
  return fs.existsSync(path.join(sherpa, '..', `sherpa-onnx-${plat}-${process.arch}`, 'sherpa-onnx.node'));
}

// ---------- worker ----------

let worker: UtilityProcess | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

function ensureWorker(): UtilityProcess {
  if (worker) return worker;
  const dirs = engineDirs();
  if (!dirs.worker || !dirs.espeak) throw new Error('Speech engine files are missing');
  const args = ['--espeak', dirs.espeak];
  if (dirs.sherpa && neuralSupported()) args.push('--sherpa', dirs.sherpa);
  const w = utilityProcess.fork(dirs.worker, args, { serviceName: 'Phevere speech', stdio: 'pipe' });
  w.stderr?.on('data', (d) => log.warn('speech', 'worker stderr', { msg: String(d).slice(0, 400) }));
  w.on('message', (msg: { id: number; ok: boolean; wav?: Uint8Array; error?: string }) => {
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    clearTimeout(job.timer);
    if (msg.ok) job.resolve(msg.wav || new Uint8Array(0));
    else job.reject(new Error(msg.error || 'Speech failed'));
  });
  w.on('exit', () => {
    worker = null;
    for (const [id, job] of pending) {
      clearTimeout(job.timer);
      job.reject(new Error('Speech engine stopped'));
      pending.delete(id);
    }
  });
  worker = w;
  return w;
}

function runWorker(job: Record<string, unknown>, timeoutMs: number): Promise<Uint8Array> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Speech timed out'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, ...job });
  });
}

export function stopSpeechWorker(): void {
  try {
    worker?.kill();
  } catch {
    /* ignore */
  }
  worker = null;
}

// ---------- rules ----------

function isChinese(text: string, lang?: string): boolean {
  return /^zh|^cmn/i.test(lang || '') || /[\u3400-\u9fff]/.test(text);
}

/** eSpeak voice for a BCP-47-ish tag. Chinese → cmn, en-GB → en-gb, other English → en-us. */
function espeakVoice(text: string, lang?: string): string {
  const l = String(lang || '').toLowerCase();
  if (isChinese(text, l)) return 'cmn';
  if (/^en[-_](gb|uk)/.test(l) || l === 'uk') return 'en-gb';
  if (!l || l.startsWith('en') || l === 'us' || l === 'other') return 'en-us';
  return l.split(/[-_]/)[0];
}

export interface SpeakRequest {
  text?: string;
  ipa?: string;
  /** us | uk | other (IPA chips) */
  accent?: string;
  /** BCP-47 or ISO code of `text` */
  lang?: string;
}

/** WAV bytes for a request, following the phone's rules. */
export async function synthesize(req: SpeakRequest): Promise<Uint8Array> {
  const prefs = getAudioPrefs();
  const speed = prefs.speed;
  const ipa = String(req.ipa || '').trim();
  if (ipa) {
    const phonemes = ipaToEspeakPhonemes(ipa);
    if (!phonemes) throw new Error('Cannot speak this IPA');
    const voice = req.accent === 'uk' ? 'en-gb' : 'en-us';
    return runWorker({ engine: 'espeak', text: `[[${phonemes}]]`, voice, speed }, 15000);
  }
  const text = String(req.text || '').trim().slice(0, 500);
  if (!text) throw new Error('Nothing to speak');
  const voice = espeakVoice(text, req.lang);
  const variant = VARIANTS.find((v) => v.id === prefs.voice);
  const kokoroLang = voice === 'cmn' || voice.startsWith('en');
  if (variant && kokoroLang && isInstalled(variant.id) && neuralSupported()) {
    const speaker = voice === 'cmn' ? 45 : voice === 'en-gb' ? 20 : 0;
    try {
      return await runWorker(
        { engine: 'kokoro', text, speaker, speed, model: { dir: installDir(variant), file: variant.model } },
        60000,
      );
    } catch (err) {
      log.warn('speech', 'neural voice failed; using eSpeak', { err: String(err) });
    }
  }
  return runWorker({ engine: 'espeak', text, voice, speed }, 15000);
}

// ---------- neural voice downloads ----------

const speechRoot = () => path.join(app.getPath('userData'), 'speech');
const installDir = (v: Variant) => path.join(speechRoot(), v.dir);

function isInstalled(id: VoiceId): boolean {
  const v = VARIANTS.find((x) => x.id === id);
  return !!v && fs.existsSync(path.join(installDir(v), '.ready'));
}

interface DownloadState {
  progress: number;
  error?: string;
  abort: AbortController;
}
const downloads = new Map<string, DownloadState>();

export interface VoiceRow {
  id: VoiceId;
  name: string;
  detail: string;
  installed: boolean;
  downloading: boolean;
  progress: number;
  error?: string;
}

export function listVoices(): VoiceRow[] {
  const rows: VoiceRow[] = [
    { id: 'mechanical', name: 'Mechanical', detail: 'Built in', installed: true, downloading: false, progress: 1 },
  ];
  if (!neuralSupported()) return rows;
  for (const v of VARIANTS) {
    const d = downloads.get(v.id);
    rows.push({
      id: v.id,
      name: v.name,
      detail: `${v.downloadMb} MB`,
      installed: isInstalled(v.id),
      downloading: !!d && !d.error,
      progress: d ? d.progress : 0,
      error: d?.error,
    });
  }
  return rows;
}

/** Picks a voice; a neural voice not yet downloaded starts downloading and is picked once ready. */
export function selectVoice(id: VoiceId): void {
  if (id === 'mechanical' || isInstalled(id)) {
    setAudioPrefs({ voice: id });
    return;
  }
  const v = VARIANTS.find((x) => x.id === id);
  if (!v || !neuralSupported() || (downloads.has(id) && !downloads.get(id)?.error)) return;
  void downloadVariant(v).then(
    () => setAudioPrefs({ voice: id }),
    (err) => log.warn('speech', 'voice download failed', { id, err: String(err) }),
  );
}

export function cancelVoiceDownload(id: VoiceId): void {
  const d = downloads.get(id);
  d?.abort.abort();
  downloads.delete(id);
}

async function downloadVariant(v: Variant): Promise<void> {
  const state: DownloadState = { progress: 0, abort: new AbortController() };
  downloads.set(v.id, state);
  const root = speechRoot();
  const archive = path.join(root, `${v.archiveDir}.tar.bz2.part`);
  const staging = path.join(root, `${v.dir}.staging`);
  try {
    fs.mkdirSync(root, { recursive: true });
    const res = await net.fetch(modelUrl(v), { signal: state.abort.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || v.downloadMb * 1024 * 1024;
    const hash = createHash('sha256');
    const out = fs.createWriteStream(archive);
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      // Unpacking takes the last few percent.
      state.progress = Math.min(0.95, (got / total) * 0.95);
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (hash.digest('hex') !== v.sha) throw new Error('Download verification failed. Please retry.');
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    await runWorker({ engine: 'unpack', archive, dest: staging }, 10 * 60 * 1000);
    const unpacked = path.join(staging, v.archiveDir);
    const dest = installDir(v);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(unpacked, dest);
    fs.writeFileSync(path.join(dest, '.ready'), new Date().toISOString());
    state.progress = 1;
    downloads.delete(v.id);
  } catch (err) {
    const aborted = state.abort.signal.aborted;
    state.error = aborted ? undefined : err instanceof Error ? err.message : String(err);
    if (aborted) downloads.delete(v.id);
    throw err;
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
