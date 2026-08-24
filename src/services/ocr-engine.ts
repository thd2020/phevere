/**
 * OCR engine facade (docs/OCR_CONTEXT_CAPTURE.md Phase 2).
 *
 * Primary: in-process onnxruntime-node + PP-OCR ONNX (via @gutenye/ocr-node)
 * Fallback (dev / last resort): Python RapidOCR worker — not advertised in Settings
 */

import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { app, net } from 'electron';
import { wrapConsole } from '../logger';
import {
  findProfile,
  getOcrPackRoot,
  loadOcrSettings,
  OCR_PROFILES,
  OcrProfileMeta,
  OcrSettings,
  saveOcrSettings,
} from './ocr-settings-store';

const console = wrapConsole('ocr-engine');

export interface OcrLine {
  text: string;
  /** Axis-aligned box in image pixels. */
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  confidence?: number;
  engine: 'windows-media-ocr' | 'onnx-native' | 'onnx-rapidocr' | 'none';
  language?: string;
}

export interface OcrEngine {
  isAvailable(): Promise<boolean>;
  recognize(png: Buffer): Promise<OcrResult>;
  /** Warm the worker so the first interactive OCR is fast. */
  warmUp?(): Promise<void>;
  dispose?(): void;
}

export type OcrStatus = {
  engine: 'onnx-native' | 'python-fallback' | 'none';
  modelsPath: string;
  available: boolean | null;
  lastError: string | null;
  activeProfileId?: string;
  profiles?: { id: string; label: string; kind: string; installed: boolean }[];
  /** Dev-only Python fallback metadata (omit from Settings copy). */
  python?: string;
  script?: string;
  modelRoot?: string;
};

type Pending = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

function resolveBundledModelsRoot(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'ocr-models'),
    path.join(app.getAppPath(), 'resources', 'ocr-models'),
    path.join(process.cwd(), 'resources', 'ocr-models'),
    path.join(__dirname, '..', '..', 'resources', 'ocr-models'),
  ];
  for (const c of candidates) {
    if (
      c &&
      fs.existsSync(path.join(c, 'ch_PP-OCRv4_det_infer.onnx')) &&
      fs.existsSync(path.join(c, 'ch_PP-OCRv4_rec_infer.onnx')) &&
      fs.existsSync(path.join(c, 'ppocr_keys_v1.txt'))
    ) {
      return c;
    }
  }
  return candidates[0] || path.join(process.cwd(), 'resources', 'ocr-models');
}

function resolveWorkerScript(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', 'ocr_worker.py'),
    path.join(process.resourcesPath || '', 'ocr_worker.py'),
    path.join(process.resourcesPath || '', 'scripts', 'ocr_worker.py'),
    path.join(app.getAppPath(), 'scripts', 'ocr_worker.py'),
    path.join(process.cwd(), 'scripts', 'ocr_worker.py'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

function commandOnPath(cmd: string): boolean {
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function resolvePython(): string {
  const fromEnv = process.env.PHEVERE_PYTHON || process.env.PYTHON;
  if (fromEnv) {
    if (fromEnv.includes(path.sep) || fromEnv.includes('/')) {
      if (fs.existsSync(fromEnv)) return fromEnv;
    } else {
      return fromEnv;
    }
  }

  if (process.platform === 'win32') {
    const guesses = [
      path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'anaconda3', 'python.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'anaconda3', 'python.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
    ];
    for (const g of guesses) {
      if (g && fs.existsSync(g)) return g;
    }
    if (commandOnPath('py')) return 'py';
    return 'python';
  }

  if (commandOnPath('python3')) return 'python3';
  if (commandOnPath('python')) return 'python';
  return 'python3';
}

function nodeModuleCandidates(...parts: string[]): string[] {
  const candidates = [
    path.join(process.cwd(), 'node_modules', ...parts),
    path.join(__dirname, '..', '..', 'node_modules', ...parts),
  ];
  try {
    const appPath = app.getAppPath();
    candidates.push(path.join(appPath, 'node_modules', ...parts));
    if (appPath.includes('app.asar')) {
      candidates.push(
        path.join(appPath.replace('app.asar', 'app.asar.unpacked'), 'node_modules', ...parts)
      );
    }
  } catch {
    /* app not ready */
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', ...parts));
  }
  return candidates;
}

function resolveNodeModuleFile(...parts: string[]): string | null {
  for (const c of nodeModuleCandidates(...parts)) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/** Last onnxruntime-node that ships darwin/x64 (Intel Mac); 1.24+ is arm64-only on macOS. */
function onnxNativeBindingPath(): string {
  return (
    resolveNodeModuleFile(
      'onnxruntime-node',
      'bin',
      'napi-v6',
      process.platform,
      process.arch,
      'onnxruntime_binding.node'
    ) ||
    path.join(
      process.cwd(),
      'node_modules',
      'onnxruntime-node',
      'bin',
      'napi-v6',
      process.platform,
      process.arch,
      'onnxruntime_binding.node'
    )
  );
}

function assertOnnxNativeBinding(): void {
  const binding = onnxNativeBindingPath();
  if (!fs.existsSync(binding)) {
    throw new Error(
      `onnxruntime-node has no native binary for ${process.platform}/${process.arch} (${binding}). ` +
        'Intel Mac needs onnxruntime-node 1.23.x; 1.24+ dropped darwin/x64.'
    );
  }
}

/**
 * @gutenye/ocr-node is ESM. Webpack's require.resolve() of the external
 * returns the bare specifier, so pathToFileURL() pointed at
 * <cwd>/@gutenye/ocr-node. Resolve the file on disk and import() it
 * through Function so webpack cannot rewrite the load.
 */
async function loadGutenOcr(): Promise<{ create: (opts: unknown) => Promise<any> }> {
  assertOnnxNativeBinding();
  const entry = resolveNodeModuleFile('@gutenye', 'ocr-node', 'build', 'index.js');
  if (!entry) {
    throw new Error('Cannot find @gutenye/ocr-node/build/index.js under node_modules');
  }
  const href = pathToFileURL(entry).href;
  const mod = await (new Function('u', 'return import(u)') as (u: string) => Promise<any>)(href);
  return mod.default || mod;
}

function resolveModelRoot(): string {
  try {
    return path.join(app.getPath('userData'), 'ocr-models');
  } catch {
    return path.join(os.tmpdir(), 'phevere-ocr-models');
  }
}

function boxToBounds(pts: number[][]): OcrLine['bounds'] | undefined {
  if (!pts || pts.length < 2) return undefined;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function listOnnxTriplet(dir: string): { det: string; rec: string; dict: string } | null {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const det =
    files.find((f) => /det/i.test(f) && /\.onnx$/i.test(f)) ||
    files.find((f) => /\.onnx$/i.test(f));
  const rec =
    files.find((f) => /rec/i.test(f) && /\.onnx$/i.test(f) && f !== det) ||
    files.filter((f) => /\.onnx$/i.test(f) && f !== det)[0];
  const dict =
    files.find((f) => /keys|dict/i.test(f) && /\.txt$/i.test(f)) ||
    files.find((f) => /\.txt$/i.test(f));
  if (!det || !rec || !dict) return null;
  return {
    det: path.join(dir, det),
    rec: path.join(dir, rec),
    dict: path.join(dir, dict),
  };
}

async function downloadFile(url: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'PhevereOCR/1.0' },
  });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

/** In-process PP-OCR via onnxruntime-node (no Python). */
class OnnxNativeOcrEngine implements OcrEngine {
  private ocr: any = null;
  private initPromise: Promise<void> | null = null;
  private available: boolean | null = null;
  private lastError: string | null = null;
  private modelsPath = resolveBundledModelsRoot();
  private modelFiles: { det: string; rec: string; dict: string } | null = null;
  private settings: OcrSettings = loadOcrSettings();

  getActiveProfileId(): string {
    return this.settings.activeProfileId;
  }

  getStatus(): Pick<OcrStatus, 'modelsPath' | 'available' | 'lastError' | 'activeProfileId'> {
    return {
      modelsPath: this.modelsPath,
      available: this.available,
      lastError: this.lastError,
      activeProfileId: this.settings.activeProfileId,
    };
  }

  listProfiles(): { id: string; label: string; kind: string; installed: boolean }[] {
    return OCR_PROFILES.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      installed: this.isProfileInstalled(p),
    }));
  }

  private isProfileInstalled(p: OcrProfileMeta): boolean {
    if (p.kind === 'bundled') return !!listOnnxTriplet(resolveBundledModelsRoot());
    if (p.kind === 'custom') {
      return !!(this.settings.customModelsPath && listOnnxTriplet(this.settings.customModelsPath));
    }
    if (p.kind === 'download' && p.packDir && p.files) {
      const root = getOcrPackRoot(p.packDir);
      return (
        fs.existsSync(path.join(root, p.files.det)) &&
        fs.existsSync(path.join(root, p.files.rec)) &&
        fs.existsSync(path.join(root, p.files.dict))
      );
    }
    return false;
  }

  async setProfile(profileId: string, customPath?: string | null): Promise<{ ok: boolean; detail: string }> {
    const profile = findProfile(profileId);
    if (!profile) return { ok: false, detail: 'Unknown OCR profile' };

    if (profile.kind === 'custom') {
      if (!customPath || !listOnnxTriplet(customPath)) {
        return {
          ok: false,
          detail: 'Custom folder needs det*.onnx, rec*.onnx, and a keys/dict .txt',
        };
      }
      this.settings = { activeProfileId: 'custom', customModelsPath: customPath };
    } else if (profile.kind === 'download') {
      try {
        await this.ensureDownloaded(profile);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { ok: false, detail: msg };
      }
      this.settings = {
        activeProfileId: profile.id,
        customModelsPath: this.settings.customModelsPath,
      };
    } else {
      this.settings = {
        activeProfileId: profile.id,
        customModelsPath: this.settings.customModelsPath,
      };
    }

    saveOcrSettings(this.settings);
    this.dispose();
    this.available = null;
    this.lastError = null;
    try {
      await this.ensureReady();
      this.available = true;
      return { ok: true, detail: `Using ${profile.label}` };
    } catch (error) {
      this.available = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: this.lastError };
    }
  }

  private async ensureDownloaded(profile: OcrProfileMeta): Promise<void> {
    if (!profile.files || !profile.packDir) throw new Error('Invalid download profile');
    const root = getOcrPackRoot(profile.packDir);
    fs.mkdirSync(root, { recursive: true });
    const targets: { url?: string; dest: string }[] = [
      { url: profile.files.detUrl, dest: path.join(root, profile.files.det) },
      { url: profile.files.recUrl, dest: path.join(root, profile.files.rec) },
      { url: profile.files.dictUrl, dest: path.join(root, profile.files.dict) },
    ];
    for (const t of targets) {
      if (fs.existsSync(t.dest) && fs.statSync(t.dest).size > 100) continue;
      if (!t.url) throw new Error(`Missing download URL for ${t.dest}`);
      console.log('Downloading OCR model', t.url);
      await downloadFile(t.url, t.dest);
    }
    // Prefer bundled dict if download failed size-wise — already required above.
  }

  private resolveModelFiles(): { det: string; rec: string; dict: string; root: string } {
    this.settings = loadOcrSettings();
    const profile = findProfile(this.settings.activeProfileId) || OCR_PROFILES[0];

    if (profile.kind === 'custom' && this.settings.customModelsPath) {
      const trip = listOnnxTriplet(this.settings.customModelsPath);
      if (!trip) throw new Error('Custom OCR folder incomplete');
      return { ...trip, root: this.settings.customModelsPath };
    }

    if (profile.kind === 'download' && profile.packDir && profile.files) {
      const root = getOcrPackRoot(profile.packDir);
      const det = path.join(root, profile.files.det);
      const rec = path.join(root, profile.files.rec);
      const dict = path.join(root, profile.files.dict);
      if (!fs.existsSync(det) || !fs.existsSync(rec) || !fs.existsSync(dict)) {
        throw new Error(`OCR pack not installed: ${profile.label}`);
      }
      return { det, rec, dict, root };
    }

    const root = resolveBundledModelsRoot();
    const det = path.join(root, 'ch_PP-OCRv4_det_infer.onnx');
    const rec = path.join(root, 'ch_PP-OCRv4_rec_infer.onnx');
    const dict = path.join(root, 'ppocr_keys_v1.txt');
    return { det, rec, dict, root };
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await this.ensureReady();
      this.available = true;
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn('Native OCR unavailable', this.lastError);
      this.available = false;
    }
    return this.available;
  }

  async warmUp(): Promise<void> {
    if (!(await this.isAvailable())) return;
    const tiny = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    await this.recognize(tiny).catch((): undefined => undefined);
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    try {
      await this.ensureReady();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return { text: '', lines: [], engine: 'none' };
    }

    const tmp = path.join(
      os.tmpdir(),
      `phevere-onnx-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
    );
    try {
      fs.writeFileSync(tmp, png);
      const linesRaw: any[] = await this.ocr.detect(tmp);
      const lines: OcrLine[] = (Array.isArray(linesRaw) ? linesRaw : [])
        .map((row) => {
          const frame = row?.frame || {};
          const left = Number(frame.left) || 0;
          const top = Number(frame.top) || 0;
          const width = Number(frame.width) || 0;
          const height = Number(frame.height) || 0;
          return {
            text: String(row?.text || ''),
            bounds: width > 0 || height > 0 ? { x: left, y: top, width, height } : undefined,
          };
        })
        .filter((l) => l.text.trim());

      const scores = (Array.isArray(linesRaw) ? linesRaw : [])
        .map((r) => Number(r?.score))
        .filter((n) => Number.isFinite(n));
      const text = lines
        .map((l) => l.text)
        .join('\n')
        .trim();
      const confidence =
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : text ? 0.8 : 0;

      return {
        text,
        lines,
        confidence,
        engine: text ? 'onnx-native' : 'none',
        language: 'multi',
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn('Native OCR recognize failed', this.lastError);
      return { text: '', lines: [], engine: 'none' };
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.ocr) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const files = this.resolveModelFiles();
      this.modelsPath = files.root;
      this.modelFiles = { det: files.det, rec: files.rec, dict: files.dict };
      for (const p of [files.det, files.rec, files.dict]) {
        if (!fs.existsSync(p)) {
          throw new Error(`Missing OCR model: ${p}`);
        }
      }

      // ESM package; do not require() it (ERR_REQUIRE_ESM under webpack/Electron).
      const Ocr = await loadGutenOcr();
      console.log('Loading native OCR models', { modelsPath: this.modelsPath, files: this.modelFiles });
      this.ocr = await Ocr.create({
        models: {
          detectionPath: files.det,
          recognitionPath: files.rec,
          dictionaryPath: files.dict,
        },
      });
    })();

    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      this.ocr = null;
      throw error;
    }
  }

  dispose(): void {
    this.ocr = null;
    this.initPromise = null;
  }
}

class RapidOcrWorkerEngine implements OcrEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private starting: Promise<void> | null = null;
  private available: boolean | null = null;
  private ensuredDeps = false;
  private lastError: string | null = null;
  private readonly script = resolveWorkerScript();
  private readonly python = resolvePython();
  private readonly modelRoot = resolveModelRoot();

  getStatus(): {
    python: string;
    script: string;
    modelRoot: string;
    available: boolean | null;
    lastError: string | null;
  } {
    return {
      python: this.python,
      script: this.script,
      modelRoot: this.modelRoot,
      available: this.available,
      lastError: this.lastError,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await this.ensureChild();
      const pong = await this.request({ cmd: 'ping' }, 8000);
      this.available = !!(pong && pong.ok);
    } catch (error) {
      console.warn('RapidOCR worker unavailable', error);
      this.lastError = error instanceof Error ? error.message : String(error);
      this.available = false;
    }
    return this.available;
  }

  /** pip install rapidocr/onnxruntime — last-resort / dev only. */
  async ensureDeps(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.ensureChild();
      const resp = await this.request({ cmd: 'ensure_deps' }, 600000);
      this.ensuredDeps = !!(resp && resp.ok);
      if (!resp?.ok) {
        this.lastError = String(resp?.error || 'ensure_deps failed');
        return { ok: false, detail: this.lastError };
      }
      this.available = true;
      this.lastError = null;
      return { ok: true, detail: 'RapidOCR ready' };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: this.lastError };
    }
  }

  async warmUp(): Promise<void> {
    if (!(await this.isAvailable())) return;
    const tiny = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    await this.recognize(tiny).catch((): undefined => undefined);
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    if (!(await this.isAvailable())) {
      return { text: '', lines: [], engine: 'none' };
    }

    const tmp = path.join(
      os.tmpdir(),
      `phevere-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
    );
    try {
      fs.writeFileSync(tmp, png);
      const resp = await this.request({ path: tmp }, 120000);
      if (!resp || !resp.ok) {
        const err = String(resp?.error || 'RapidOCR failed');
        console.warn('RapidOCR failed', err);
        this.lastError = err;
        if (!this.ensuredDeps && /No module named|rapidocr|onnxruntime|Download|model/i.test(err)) {
          this.ensuredDeps = true;
          const ensured = await this.ensureDeps();
          if (ensured.ok) {
            const retry = await this.request({ path: tmp }, 120000);
            if (retry?.ok) {
              return this.mapResponse(retry);
            }
            this.lastError = String(retry?.error || err);
          }
        }
        return { text: '', lines: [], engine: 'none' };
      }

      return this.mapResponse(resp);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  private mapResponse(resp: any): OcrResult {
    const txts: string[] = Array.isArray(resp.txts) ? resp.txts.map(String) : [];
    const scores: number[] = Array.isArray(resp.scores) ? resp.scores.map(Number) : [];
    const boxes: number[][][] = Array.isArray(resp.boxes) ? resp.boxes : [];

    const lines: OcrLine[] = txts.map((text, i) => ({
      text,
      bounds: boxToBounds(boxes[i]),
    }));

    const text = txts.join('\n').trim();
    const confidence =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : text ? 0.8 : 0;

    return {
      text,
      lines,
      confidence,
      engine: text ? 'onnx-rapidocr' : 'none',
      language: 'multi',
    };
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('OCR worker disposed'));
    }
    this.pending.clear();
    if (this.child) {
      const pid = this.child.pid;
      try {
        this.child.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
      } catch {
        /* ignore */
      }
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
      // Windows: kill the whole process tree (onnxruntime children).
      if (process.platform === 'win32' && pid) {
        try {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
            detached: true,
          }).unref();
        } catch {
          /* ignore */
        }
      }
      this.child = null;
    }
  }

  private async ensureChild(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;

    this.starting = new Promise<void>((resolve, reject) => {
      try {
        try {
          fs.mkdirSync(this.modelRoot, { recursive: true });
        } catch {
          /* ignore */
        }
        console.log('Starting RapidOCR worker', {
          python: this.python,
          script: this.script,
          modelRoot: this.modelRoot,
        });
        const child = spawn(this.python, ['-u', this.script], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
            PHEVERE_OCR_MODEL_ROOT: this.modelRoot,
          },
        });
        this.child = child;
        this.buffer = '';

        const onReady = (line: string) => {
          try {
            const msg = JSON.parse(line);
            if (msg.ready) {
              child.stdout.off('data', bootHandler);
              child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
              resolve();
            }
          } catch {
            /* keep waiting */
          }
        };

        const bootHandler = (chunk: Buffer) => {
          this.buffer += chunk.toString('utf8');
          let idx: number;
          while ((idx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (line) onReady(line);
          }
        };

        child.stdout.on('data', bootHandler);
        child.stderr.on('data', (chunk: Buffer) => {
          const msg = chunk.toString('utf8').trim();
          if (msg) console.warn('ocr_worker stderr:', msg.slice(0, 400));
        });
        child.on('error', (err) => {
          this.child = null;
          this.available = false;
          this.lastError = err.message;
          reject(err);
        });
        child.on('exit', (code) => {
          console.warn('ocr_worker exited', { code });
          this.child = null;
          for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error(`OCR worker exited (${code})`));
          }
          this.pending.clear();
        });

        setTimeout(() => {
          if (this.starting) {
            // Ready line may have been missed if models printed first; still allow use.
            child.stdout.off('data', bootHandler);
            child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
            resolve();
          }
        }, 15000);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  private onStdout(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line || line[0] !== '{') continue;
      try {
        const msg = JSON.parse(line);
        const id = msg.id;
        if (typeof id === 'number' && this.pending.has(id)) {
          const p = this.pending.get(id)!;
          this.pending.delete(id);
          clearTimeout(p.timer);
          p.resolve(msg);
        }
      } catch {
        /* ignore non-JSON chatter */
      }
    }
  }

  private async request(payload: Record<string, unknown>, timeoutMs: number): Promise<any> {
    await this.ensureChild();
    if (!this.child || !this.child.stdin.writable) {
      throw new Error('OCR worker not running');
    }
    const id = this.nextId++;
    const body = { ...payload, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OCR worker timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify(body) + '\n', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }
}

class CompositeOcrEngine implements OcrEngine {
  private readonly native = new OnnxNativeOcrEngine();
  private readonly rapid = new RapidOcrWorkerEngine();
  private preferred: 'onnx-native' | 'python-fallback' | 'none' = 'none';

  async isAvailable(): Promise<boolean> {
    if (await this.native.isAvailable()) {
      this.preferred = 'onnx-native';
      return true;
    }
    if (await this.rapid.isAvailable()) {
      this.preferred = 'python-fallback';
      return true;
    }
    this.preferred = 'none';
    return false;
  }

  async warmUp(): Promise<void> {
    if (await this.native.isAvailable()) {
      this.preferred = 'onnx-native';
      return this.native.warmUp();
    }
    // Do not auto-pip; only warm Python if already runnable.
    if (await this.rapid.isAvailable()) {
      this.preferred = 'python-fallback';
      return this.rapid.warmUp();
    }
  }

  async ensureDeps(): Promise<{ ok: boolean; detail: string }> {
    if (await this.native.isAvailable()) {
      this.preferred = 'onnx-native';
      await this.native.warmUp();
      return { ok: true, detail: 'Embedded OCR ready' };
    }
    const n = this.native.getStatus();
    return {
      ok: false,
      detail: n.lastError || `Embedded OCR failed to load (models: ${n.modelsPath})`,
    };
  }

  getStatus(): OcrStatus {
    const n = this.native.getStatus();
    const r = this.rapid.getStatus();
    const engine =
      this.preferred !== 'none'
        ? this.preferred
        : n.available
          ? 'onnx-native'
          : r.available
            ? 'python-fallback'
            : 'none';
    return {
      engine,
      modelsPath: n.modelsPath,
      available: engine === 'none' ? (n.available === null && r.available === null ? null : false) : true,
      lastError: n.lastError || r.lastError,
      activeProfileId: n.activeProfileId || this.native.getActiveProfileId(),
      profiles: this.native.listProfiles(),
      python: r.python,
      script: r.script,
      modelRoot: r.modelRoot,
    };
  }

  async setProfile(profileId: string, customPath?: string | null): Promise<{ ok: boolean; detail: string }> {
    const r = await this.native.setProfile(profileId, customPath);
    if (r.ok) this.preferred = 'onnx-native';
    return r;
  }

  listProfiles() {
    return this.native.listProfiles();
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    if (await this.native.isAvailable()) {
      this.preferred = 'onnx-native';
      const result = await this.native.recognize(png);
      if (result.engine !== 'none' || result.text.trim()) return result;
      if (!this.native.getStatus().lastError) return result;
    }

    if (await this.rapid.isAvailable()) {
      this.preferred = 'python-fallback';
      console.warn('Falling back to Python RapidOCR worker');
      return this.rapid.recognize(png);
    }

    return { text: '', lines: [], engine: 'none' };
  }

  dispose(): void {
    this.native.dispose();
    this.rapid.dispose();
  }
}

export const ocrEngine: OcrEngine = new CompositeOcrEngine();

export async function ensureOcrDeps(): Promise<{ ok: boolean; detail: string }> {
  return (ocrEngine as CompositeOcrEngine).ensureDeps();
}

export function getOcrStatus(): OcrStatus {
  return (ocrEngine as CompositeOcrEngine).getStatus();
}

export async function setOcrProfile(
  profileId: string,
  customPath?: string | null,
): Promise<{ ok: boolean; detail: string }> {
  return (ocrEngine as CompositeOcrEngine).setProfile(profileId, customPath);
}

export function listOcrProfiles() {
  return (ocrEngine as CompositeOcrEngine).listProfiles();
}

/**
 * Prefer the line / token whose box contains (relX, relY); else nearest box;
 * else full joined text. Coordinates are in image-pixel space.
 */
export function textNearPoint(result: OcrResult, relX: number, relY: number): string {
  const lined = result.lines.filter((l) => l.text && l.bounds);
  if (lined.length === 0) return (result.text || '').trim();

  const containing = lined.find((l) => {
    const b = l.bounds!;
    return relX >= b.x && relX <= b.x + b.width && relY >= b.y && relY <= b.y + b.height;
  });
  if (containing) return pickTokenAt(containing.text, containing.bounds!, relX);

  let best = lined[0];
  let bestDist = Infinity;
  for (const line of lined) {
    const b = line.bounds!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const d = (cx - relX) ** 2 + (cy - relY) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = line;
    }
  }
  return pickTokenAt(best.text, best.bounds!, relX);
}

/** Split a line into words / CJK chars and pick the token under the x offset. */
function pickTokenAt(line: string, bounds: NonNullable<OcrLine['bounds']>, relX: string | number): string {
  const x = typeof relX === 'number' ? relX : 0;
  const text = line.trim();
  if (!text) return '';

  const cjk = (text.match(/[\u3400-\u9FFF]/g) || []).length;
  if (cjk >= text.replace(/\s/g, '').length / 2) {
    const chars = [...text.replace(/\s+/g, '')];
    if (chars.length === 0) return text;
    const ratio = bounds.width > 0 ? (x - bounds.x) / bounds.width : 0.5;
    const idx = Math.min(chars.length - 1, Math.max(0, Math.floor(ratio * chars.length)));
    return chars[idx];
  }

  // Prefer whole word tokens; weight by character length (not equal-width slots).
  const words = text.match(/[A-Za-z\u00C0-\u024F]+(?:['’-][A-Za-z\u00C0-\u024F]+)*/g);
  if (!words || words.length === 0) return text;
  if (words.length === 1) return words[0];

  const widths = words.map((w) => Math.max(1, [...w].length));
  const total = widths.reduce((a, b) => a + b, 0);
  const ratio = bounds.width > 0 ? Math.min(1, Math.max(0, (x - bounds.x) / bounds.width)) : 0.5;
  let pos = ratio * total;
  for (let i = 0; i < words.length; i++) {
    pos -= widths[i];
    if (pos <= 0) return words[i];
  }
  return words[words.length - 1];
}
