/**
 * OCR engine facade (docs/OCR_CONTEXT_CAPTURE.md Phase 2).
 *
 * Today: Windows.Media.Ocr via PowerShell when language packs exist.
 * Next: onnxruntime-node + bundled PP-OCRv6 small models (see plan).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { wrapConsole } from '../logger';

const execFileAsync = promisify(execFile);
const console = wrapConsole('ocr-engine');

export interface OcrLine {
  text: string;
  /** Relative to the cropped image, DIP-ish pixels. */
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
}

const WIN_OCR_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = $args[0]

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } |
  Select-Object -First 1)

function Await-WinRT($asyncOp) {
  $resultType = $asyncOp.GetType().GenericTypeArguments[0]
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($asyncOp))
  $task.GetAwaiter().GetResult()
}

$null = [Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]

$file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path))
$stream = Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read))
$decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))
$bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync())

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
  $langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
  if ($langs -and $langs.Count -gt 0) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langs[0])
  }
}

if (-not $engine) {
  Write-Output '{"text":"","lines":[],"engine":"none"}'
  exit 0
}

$result = Await-WinRT ($engine.RecognizeAsync($bitmap))
$lineObjs = @()
foreach ($line in $result.Lines) {
  $lineObjs += @{ text = [string]$line.Text }
}

$payload = @{
  text = [string]$result.Text
  lines = $lineObjs
  language = [string]$engine.RecognizerLanguage.LanguageTag
  engine = 'windows-media-ocr'
}
($payload | ConvertTo-Json -Compress -Depth 6)
`;

class WindowsMediaOcrEngine implements OcrEngine {
  private available: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'win32') {
      this.available = false;
      return false;
    }
    if (this.available !== null) return this.available;
    try {
      const ps = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null; [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages.Count`,
        ],
        { timeout: 8000, windowsHide: true, encoding: 'utf8' }
      );
      const count = parseInt(String(ps.stdout).trim(), 10);
      this.available = Number.isFinite(count) && count > 0;
    } catch (error) {
      console.warn('Windows.Media.Ocr probe failed', error);
      this.available = false;
    }
    return this.available;
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    if (!(await this.isAvailable())) {
      return { text: '', lines: [], engine: 'none' };
    }

    const tmp = path.join(os.tmpdir(), `phevere-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    const scriptPath = path.join(os.tmpdir(), `phevere-ocr-${Date.now()}.ps1`);

    try {
      fs.writeFileSync(tmp, png);
      fs.writeFileSync(scriptPath, WIN_OCR_SCRIPT, 'utf8');

      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, tmp],
        { timeout: 20000, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
      );

      const raw = String(stdout).trim();
      const jsonStart = raw.indexOf('{');
      if (jsonStart < 0) {
        console.warn('OCR produced no JSON', raw.slice(0, 200));
        return { text: '', lines: [], engine: 'none' };
      }

      const parsed = JSON.parse(raw.slice(jsonStart));
      const lines: OcrLine[] = Array.isArray(parsed.lines)
        ? parsed.lines.map((l: any) => ({ text: String(l.text || '') })).filter((l: OcrLine) => l.text)
        : [];
      const text = String(parsed.text || lines.map((l) => l.text).join('\n')).trim();

      return {
        text,
        lines,
        engine: parsed.engine === 'windows-media-ocr' ? 'windows-media-ocr' : 'none',
        language: parsed.language,
        confidence: text ? 0.7 : 0,
      };
    } catch (error) {
      console.error('Windows OCR failed', error);
      return { text: '', lines: [], engine: 'none' };
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Placeholder until onnxruntime-node + PP-OCRv6 are bundled. */
class UnavailableOnnxEngine implements OcrEngine {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async recognize(_png: Buffer): Promise<OcrResult> {
    return { text: '', lines: [], engine: 'none' };
  }
}

class CompositeOcrEngine implements OcrEngine {
  private readonly windows = new WindowsMediaOcrEngine();
  private readonly onnx = new UnavailableOnnxEngine();

  async isAvailable(): Promise<boolean> {
    return (await this.windows.isAvailable()) || (await this.onnx.isAvailable());
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    if (await this.windows.isAvailable()) {
      const result = await this.windows.recognize(png);
      if (result.text.trim()) return result;
    }
    if (await this.onnx.isAvailable()) {
      return this.onnx.recognize(png);
    }
    return { text: '', lines: [], engine: 'none' };
  }
}

export const ocrEngine: OcrEngine = new CompositeOcrEngine();

/**
 * Pick the OCR line / token nearest to a point inside the crop (Phase 3 hook).
 * For now returns the full text; word targeting lands with box geometry.
 */
export function textNearPoint(result: OcrResult, _relX: number, _relY: number): string {
  return (result.text || '').trim();
}
