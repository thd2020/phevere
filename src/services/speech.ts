/**
 * Synthetic speech with the Android app's engines and rules.
 *
 *   IPA chip           → eSpeak NG, IPA passed as phonemes, US or UK voice.
 *   Headword, notebook → recorded clip first (renderer); this service is the fallback.
 *   Text (translation) → the voice picked in Settings → Audio:
 *                        Mechanical = eSpeak NG (built in), Neural = Kokoro v1.0 (download).
 *
 * Long text (the Translation tab) is spoken as a stream of sentence chunks, so the
 * first sentence plays while the next one synthesizes; see startSpeechStream.
 *
 * Engines run in scripts/speech-worker.js (utility process). Kokoro models are the same
 * archives, hashes and folders as apps/mobile/.../SpeechModels.java.
 */

import { app, net, utilityProcess, type UtilityProcess } from 'electron';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ipaToEspeakPhonemes, ipaToKokoroPhonemes, splitSpeechText } from '@phevere/core';
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
    name: 'Neural (standard)',
    dir: 'kokoro-int8-v1',
    archiveDir: 'kokoro-int8-multi-lang-v1_0',
    model: 'model.int8.onnx',
    sha: '72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653',
    downloadMb: 132,
  },
  {
    id: 'full',
    name: 'Neural (high quality)',
    dir: 'kokoro-v1',
    archiveDir: 'kokoro-multi-lang-v1_0',
    model: 'model.onnx',
    sha: '60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4',
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

function engineDirs(): { worker: string; espeak: string; sherpa: string; ort: string } {
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
    // Shipped unpacked for OCR (forge.config.js); the IPA chip engine reuses it.
    ort: firstExisting([
      path.join(res, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node'),
      path.join(root, 'node_modules', 'onnxruntime-node'),
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

/** 'main' runs eSpeak and sherpa-onnx; 'ipa' runs Kokoro from IPA on onnxruntime-node. */
type WorkerKind = 'main' | 'ipa';
const workers: Record<WorkerKind, UtilityProcess | null> = { main: null, ipa: null };
const ownedJobs = new WeakMap<UtilityProcess, Set<number>>();
let seq = 0;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

function ensureWorker(kind: WorkerKind): UtilityProcess {
  const existing = workers[kind];
  if (existing) return existing;
  const dirs = engineDirs();
  if (!dirs.worker || !dirs.espeak) throw new Error('Speech engine files are missing');
  const args = ['--espeak', dirs.espeak];
  if (kind === 'ipa') {
    if (!dirs.ort) throw new Error('Neural IPA voice is not available on this system');
    args.push('--ort', dirs.ort);
  } else if (dirs.sherpa && neuralSupported()) {
    args.push('--sherpa', dirs.sherpa);
  }
  const w = utilityProcess.fork(dirs.worker, args, { serviceName: kind === 'ipa' ? 'Phevere IPA speech' : 'Phevere speech', stdio: 'pipe' });
  w.stderr?.on('data', (d) => log.warn('speech', 'worker stderr', { msg: String(d).slice(0, 400) }));
  w.on('message', (msg: { id: number; ok: boolean; wav?: Uint8Array; error?: string }) => {
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    clearTimeout(job.timer);
    if (msg.ok) job.resolve(msg.wav || new Uint8Array(0));
    else job.reject(new Error(msg.error || 'Speech failed'));
  });
  const owned = new Set<number>();
  w.on('exit', () => {
    workers[kind] = null;
    for (const id of owned) {
      const job = pending.get(id);
      if (!job) continue;
      clearTimeout(job.timer);
      job.reject(new Error('Speech engine stopped'));
      pending.delete(id);
    }
  });
  ownedJobs.set(w, owned);
  workers[kind] = w;
  return w;
}


function sendToWorker(job: Record<string, unknown>, timeoutMs: number, kind: WorkerKind): Promise<Uint8Array> {
  const w = ensureWorker(kind);
  const id = ++seq;
  const owned = ownedJobs.get(w);
  owned?.add(id);
  return new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Speech timed out'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, ...job });
  }).finally(() => owned?.delete(id));
}

/**
 * Synthesis jobs go to each worker one at a time. A job waiting here can still be
 * cancelled, and its timeout only starts once the worker takes it, so a long queue
 * no longer turns into timeouts and an eSpeak fallback stuck behind a neural job.
 */
interface QueuedJob {
  job: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  resolve: (b: Uint8Array) => void;
  reject: (e: Error) => void;
}
const queues: Record<WorkerKind, QueuedJob[]> = { main: [], ipa: [] };
const busy: Record<WorkerKind, boolean> = { main: false, ipa: false };

const cancelledError = () => Object.assign(new Error('Speech cancelled'), { cancelled: true });
export const isCancelled = (err: unknown): boolean => !!(err && (err as { cancelled?: boolean }).cancelled);

function pump(kind: WorkerKind): void {
  if (busy[kind]) return;
  let next = queues[kind].shift();
  while (next && next.signal?.aborted) {
    next.reject(cancelledError());
    next = queues[kind].shift();
  }
  if (!next) return;
  const item = next;
  busy[kind] = true;
  let run: Promise<Uint8Array>;
  try {
    run = sendToWorker(item.job, item.timeoutMs, kind);
  } catch (err) {
    run = Promise.reject(err);
  }
  run
    .then(
      (wav) => (item.signal?.aborted ? item.reject(cancelledError()) : item.resolve(wav)),
      (err) => item.reject(item.signal?.aborted ? cancelledError() : err),
    )
    .finally(() => {
      busy[kind] = false;
      pump(kind);
    });
}

function runWorker(job: Record<string, unknown>, timeoutMs: number, kind: WorkerKind = 'main', signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) return Promise.reject(cancelledError());
  return new Promise<Uint8Array>((resolve, reject) => {
    const item: QueuedJob = { job, timeoutMs, signal, resolve, reject };
    queues[kind].push(item);
    signal?.addEventListener(
      'abort',
      () => {
        const i = queues[kind].indexOf(item);
        if (i >= 0) {
          queues[kind].splice(i, 1);
          reject(cancelledError());
        }
      },
      { once: true },
    );
    pump(kind);
  });
}

export function stopSpeechWorker(): void {
  for (const kind of ['main', 'ipa'] as const) {
    // Drop queued jobs first, or the exit of the running one would start a new worker.
    for (const item of queues[kind].splice(0)) item.reject(cancelledError());
    try {
      workers[kind]?.kill();
    } catch {
      /* ignore */
    }
    workers[kind] = null;
  }
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
    const gb = req.accent === 'uk';
    // A chosen neural voice reads the chip's own IPA, so the chip sounds like the
    // rest of the app instead of always falling back to the mechanical voice.
    const variant = VARIANTS.find((v) => v.id === prefs.voice);
    const kokoro = ipaToKokoroPhonemes(ipa, req.accent);
    if (variant && kokoro && isInstalled(variant.id)) {
      try {
        return await runWorker(
          { engine: 'kokoro-ipa', text: kokoro, speaker: gb ? 20 : 0, speed, model: { dir: installDir(variant), file: variant.model } },
          30000,
          'ipa',
        );
      } catch (err) {
        log.warn('speech', 'neural IPA voice failed; using eSpeak', { err: String(err) });
      }
    }
    const phonemes = ipaToEspeakPhonemes(ipa);
    if (!phonemes) throw new Error('Cannot speak this IPA');
    return runWorker({ engine: 'espeak', text: `[[${phonemes}]]`, voice: gb ? 'en-gb' : 'en-us', speed }, 15000);
  }
  const text = String(req.text || '').trim().slice(0, 500);
  if (!text) throw new Error('Nothing to speak');
  return synthesizeText(text, req.lang);
}

/**
 * One piece of text with the chosen voice. When the neural voice fails, eSpeak speaks
 * instead and `onNeuralFailed` runs, so a stream can stay on eSpeak for later chunks.
 */
function synthesizeText(
  text: string,
  lang: string | undefined,
  signal?: AbortSignal,
  allowNeural = true,
  onNeuralFailed?: () => void,
): Promise<Uint8Array> {
  const prefs = getAudioPrefs();
  const speed = prefs.speed;
  const voice = espeakVoice(text, lang);
  const variant = VARIANTS.find((v) => v.id === prefs.voice);
  const kokoroLang = voice === 'cmn' || voice.startsWith('en');
  const espeak = () => runWorker({ engine: 'espeak', text, voice, speed }, 15000, 'main', signal);
  if (!(allowNeural && variant && kokoroLang && isInstalled(variant.id) && neuralSupported())) return espeak();
  const speaker = voice === 'cmn' ? 45 : voice === 'en-gb' ? 20 : 0;
  return runWorker(
    { engine: 'kokoro', text, speaker, speed, model: { dir: installDir(variant), file: variant.model } },
    60000,
    'main',
    signal,
  ).catch((err) => {
    if (isCancelled(err)) throw err;
    log.warn('speech', 'neural voice failed; using eSpeak', { err: String(err) });
    onNeuralFailed?.();
    return espeak();
  });
}

/**
 * Loads the neural voice in the worker before anyone presses a speaker. The first load
 * and run take about 4 s on a desktop CPU, which otherwise lands on top of the first
 * sentence. Called when a translation is shown; it runs once per worker and voice.
 */
const warmedWorkers = new WeakMap<UtilityProcess, string>();
export function warmSpeech(): void {
  const variant = VARIANTS.find((v) => v.id === getAudioPrefs().voice);
  if (!variant || !isInstalled(variant.id) || !neuralSupported()) return;
  let w: UtilityProcess;
  try {
    w = ensureWorker('main');
  } catch {
    return;
  }
  if (warmedWorkers.get(w) === variant.id) return;
  warmedWorkers.set(w, variant.id);
  runWorker({ engine: 'kokoro-warm', model: { dir: installDir(variant), file: variant.model } }, 60000).catch((err) => {
    log.warn('speech', 'neural voice warm-up failed', { err: String(err) });
  });
}

// ---------- long text: sentence streaming ----------

/**
 * A paragraph is spoken chunk by chunk (see splitSpeechText). The renderer asks for
 * chunk i when it needs it; that also starts chunk i + 1, so one chunk synthesizes
 * while the previous one plays and nothing further ahead is computed. Stopping,
 * starting another stream or closing the window cancels whatever is still queued.
 */
interface SpeechStream {
  owner: number;
  chunks: string[];
  lang?: string;
  abort: AbortController;
  results: Array<Promise<Uint8Array> | undefined>;
  neural: boolean;
}
const streams = new Map<number, SpeechStream>();
let streamSeq = 0;
const MAX_STREAM_CHARS = 5000;

export function startSpeechStream(owner: number, req: { text?: string; lang?: string }): { id: number; count: number } {
  stopSpeech(owner);
  // Each eSpeak call starts a fresh WebAssembly instance (about 0.2 s of CPU), and eSpeak
  // runs far faster than real time, so after the first sentence it gets one large chunk.
  // Kokoro is slow on a CPU and reads at most about 500 phonemes, so it gets small ones
  // that grow by at most half each time: each chunk synthesizes while the previous one
  // plays. Measured with the full model on an i5-10500, this took a 23-character sentence
  // followed by a 97-character one from a 10.6 s silence to none.
  const variant = VARIANTS.find((v) => v.id === getAudioPrefs().voice);
  const neural = !!variant && isInstalled(variant.id) && neuralSupported();
  const chunks = splitSpeechText(String(req.text || '').slice(0, MAX_STREAM_CHARS), neural ? { max: 300, growth: 1.5 } : { max: 1500 });
  if (!chunks.length) throw new Error('Nothing to speak');
  const id = ++streamSeq;
  streams.set(id, { owner, chunks, lang: req.lang, abort: new AbortController(), results: [], neural: true });
  scheduleChunk(id, 0);
  return { id, count: chunks.length };
}

function scheduleChunk(id: number, index: number): Promise<Uint8Array> | undefined {
  const s = streams.get(id);
  if (!s || index < 0 || index >= s.chunks.length) return undefined;
  const have = s.results[index];
  if (have) return have;
  const prev = index > 0 ? s.results[index - 1] : undefined;
  // Wait for the previous chunk so a neural failure there switches this one to eSpeak.
  const start: Promise<void> = prev ? prev.then((): void => undefined, (): void => undefined) : Promise.resolve();
  const run = start.then(() => {
    if (s.abort.signal.aborted) throw cancelledError();
    return synthesizeText(s.chunks[index], s.lang, s.abort.signal, s.neural, () => {
      s.neural = false;
    });
  });
  run.catch(() => { /* surfaced through speechStreamChunk */ });
  s.results[index] = run;
  return run;
}

export async function speechStreamChunk(id: number, index: number): Promise<Uint8Array> {
  const s = streams.get(id);
  if (!s || s.abort.signal.aborted) throw cancelledError();
  const run = scheduleChunk(id, index);
  if (!run) throw new Error('No such speech chunk');
  scheduleChunk(id, index + 1);
  // Played chunks are not needed again.
  if (index > 0) s.results[index - 1] = Promise.resolve(new Uint8Array(0));
  const wav = await run;
  if (index === s.chunks.length - 1) streams.delete(id);
  return wav;
}

/** Cancels every stream the window started, including chunks waiting for the worker. */
export function stopSpeech(owner: number): void {
  for (const [id, s] of streams) {
    if (s.owner !== owner) continue;
    s.abort.abort();
    streams.delete(id);
  }
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
const downloadJobs = new Map<VoiceId, Promise<void>>();

export interface VoiceRow {
  id: VoiceId;
  name: string;
  detail: string;
  /** The voice to suggest on desktop: full precision keeps up on CPUs where int8 does not. */
  recommended?: boolean;
  installed: boolean;
  downloading: boolean;
  progress: number;
  error?: string;
}

export function listVoices(): VoiceRow[] {
  const rows: VoiceRow[] = [
    { id: 'mechanical', name: 'Mechanical', detail: 'Built-in', installed: true, downloading: false, progress: 1 },
  ];
  if (!neuralSupported()) return rows;
  for (const v of VARIANTS) {
    const d = downloads.get(v.id);
    rows.push({
      id: v.id,
      name: v.name,
      detail: `${v.downloadMb} MB`,
      recommended: v.id === 'full',
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
  void installAndSelectVoice(id).catch((err) => log.warn('speech', 'voice download failed', { id, err: String(err) }));
}

/** Awaitable selection used by installer provisioning and the settings download flow. */
export async function installAndSelectVoice(id: VoiceId): Promise<void> {
  if (id === 'mechanical' || isInstalled(id)) {
    setAudioPrefs({ voice: id });
    return;
  }
  const v = VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error('Unknown pronunciation voice');
  if (!neuralSupported()) throw new Error('Neural speech engine is unavailable on this computer');
  let job = downloadJobs.get(id);
  if (!job) {
    job = downloadVariant(v);
    downloadJobs.set(id, job);
  }
  try {
    await job;
    setAudioPrefs({ voice: id });
  } finally {
    if (downloadJobs.get(id) === job) downloadJobs.delete(id);
  }
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
    const chunks = async function* () {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
          got += value.length;
          // Unpacking takes the last few percent.
          state.progress = Math.min(0.95, (got / total) * 0.95);
          yield value;
        }
      } finally {
        await reader.cancel().catch(() => { /* network may already have stopped */ });
        reader.releaseLock();
      }
    };
    // pipeline owns errors and closes the file before cleanup, including disk-full failures.
    await pipeline(Readable.from(chunks()), out);
    if (hash.digest('hex') !== v.sha) throw new Error('Download verification failed. Please retry.');
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    // Straight to the worker: unpacking must not hold up speech queued behind it.
    await sendToWorker({ engine: 'unpack', archive, dest: staging }, 10 * 60 * 1000, 'main');
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
