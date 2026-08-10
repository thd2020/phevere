/**
 * OCR engine facade (docs/OCR_CONTEXT_CAPTURE.md Phase 2).
 *
 * Primary: in-process onnxruntime-node + PP-OCR ONNX (via @gutenye/ocr-node)
 * Fallback (dev / last resort): Python RapidOCR worker — not advertised in Settings
 */

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { wrapConsole } from '../logger';

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

function resolvePython(): string {
  const fromEnv = process.env.PHEVERE_PYTHON || process.env.PYTHON;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const guesses = [
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'anaconda3', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'anaconda3', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
    'python',
    'py',
  ];
  for (const g of guesses) {
    if (g === 'python' || g === 'py') return g;
    if (fs.existsSync(g)) return g;
  }
  return 'python';
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

/** In-process PP-OCR via onnxruntime-node (no Python). */
class OnnxNativeOcrEngine implements OcrEngine {
  private ocr: any = null;
  private initPromise: Promise<void> | null = null;
  private available: boolean | null = null;
  private lastError: string | null = null;
  private readonly modelsPath = resolveBundledModelsRoot();

  getStatus(): Pick<OcrStatus, 'modelsPath' | 'available' | 'lastError'> {
    return {
      modelsPath: this.modelsPath,
      available: this.available,
      lastError: this.lastError,
    };
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
      const det = path.join(this.modelsPath, 'ch_PP-OCRv4_det_infer.onnx');
      const rec = path.join(this.modelsPath, 'ch_PP-OCRv4_rec_infer.onnx');
      const dict = path.join(this.modelsPath, 'ppocr_keys_v1.txt');
      for (const p of [det, rec, dict]) {
        if (!fs.existsSync(p)) {
          throw new Error(`Missing OCR model: ${p}`);
        }
      }

      // Externalized package; resolved from node_modules at runtime.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@gutenye/ocr-node');
      const Ocr = mod.default || mod;
      console.log('Loading native OCR models', { modelsPath: this.modelsPath });
      this.ocr = await Ocr.create({
        models: {
          detectionPath: det,
          recognitionPath: rec,
          dictionaryPath: dict,
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
      python: r.python,
      script: r.script,
      modelRoot: r.modelRoot,
    };
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

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return text;
  const ratio = bounds.width > 0 ? (x - bounds.x) / bounds.width : 0.5;
  const idx = Math.min(words.length - 1, Math.max(0, Math.floor(ratio * words.length)));
  return words[idx];
}
