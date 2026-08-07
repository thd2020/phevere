/**
 * OCR engine facade (docs/OCR_CONTEXT_CAPTURE.md Phase 2).
 *
 * Primary: persistent RapidOCR (PP-OCRv6 ONNX) via scripts/ocr_worker.py
 * Fallback: Windows.Media.Ocr when a language pack exists and WinRT await works
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
  engine: 'windows-media-ocr' | 'onnx-rapidocr' | 'none';
  language?: string;
}

export interface OcrEngine {
  isAvailable(): Promise<boolean>;
  recognize(png: Buffer): Promise<OcrResult>;
  /** Warm the worker so the first interactive OCR is fast. */
  warmUp?(): Promise<void>;
  dispose?(): void;
}

type Pending = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

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

  // Prefer the Anaconda install that already has RapidOCR on this machine.
  const guesses = [
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'anaconda3', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'anaconda3', 'python.exe'),
    'python',
    'py',
  ];
  for (const g of guesses) {
    if (g === 'python' || g === 'py') return g;
    if (fs.existsSync(g)) return g;
  }
  return 'python';
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

class RapidOcrWorkerEngine implements OcrEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private starting: Promise<void> | null = null;
  private available: boolean | null = null;
  private readonly script = resolveWorkerScript();
  private readonly python = resolvePython();

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    if (!fs.existsSync(this.script) && this.script.includes('ocr_worker')) {
      // Still try — resolveWorkerScript may point at cwd that exists at runtime.
    }
    try {
      await this.ensureChild();
      const pong = await this.request({ cmd: 'ping' }, 8000);
      this.available = !!(pong && pong.ok);
    } catch (error) {
      console.warn('RapidOCR worker unavailable', error);
      this.available = false;
    }
    return this.available;
  }

  async warmUp(): Promise<void> {
    if (!(await this.isAvailable())) return;
    // Loading models happens on first real recognize; send a 1×1 PNG to force it.
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
      const resp = await this.request({ path: tmp }, 45000);
      if (!resp || !resp.ok) {
        console.warn('RapidOCR failed', resp?.error);
        return { text: '', lines: [], engine: 'none' };
      }

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
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
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
        console.log('Starting RapidOCR worker', { python: this.python, script: this.script });
        const child = spawn(this.python, ['-u', this.script], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
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
  private readonly rapid = new RapidOcrWorkerEngine();

  async isAvailable(): Promise<boolean> {
    return this.rapid.isAvailable();
  }

  async warmUp(): Promise<void> {
    return this.rapid.warmUp();
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    const result = await this.rapid.recognize(png);
    if (result.text.trim()) return result;
    return { text: '', lines: [], engine: 'none' };
  }

  dispose(): void {
    this.rapid.dispose();
  }
}

export const ocrEngine: OcrEngine = new CompositeOcrEngine();

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

  // CJK-heavy: treat each character as a token.
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
