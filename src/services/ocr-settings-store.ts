/**
 * OCR profile preferences (userData/ocr-settings.json).
 * Profiles: bundled PP-OCRv4, downloadable packs, or a custom model folder.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type OcrProfileKind = 'bundled' | 'download' | 'custom';

export interface OcrProfileMeta {
  id: string;
  label: string;
  kind: OcrProfileKind;
  /** Relative pack folder under userData/ocr-packs when downloaded. */
  packDir?: string;
  files?: {
    det: string;
    rec: string;
    dict: string;
    detUrl?: string;
    recUrl?: string;
    dictUrl?: string;
  };
}

export interface OcrSettings {
  activeProfileId: string;
  /** Absolute path to a user-chosen folder (custom profile). */
  customModelsPath: string | null;
}

const FILE_NAME = 'ocr-settings.json';

export const OCR_PROFILES: OcrProfileMeta[] = [
  {
    id: 'bundled-pp-ocrv4',
    label: 'PP-OCRv4 mobile (optional install / local)',
    kind: 'bundled',
  },
  {
    id: 'pp-ocrv5-mobile',
    label: 'PP-OCRv5 mobile',
    kind: 'download',
    packDir: 'pp-ocrv5-mobile',
    files: {
      det: 'ch_PP-OCRv5_det_mobile.onnx',
      rec: 'ch_PP-OCRv5_rec_mobile.onnx',
      dict: 'ppocr_keys_v1.txt',
      detUrl:
        'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx',
      recUrl:
        'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx',
      dictUrl:
        'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/paddle/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile/ppocr_keys_v1.txt',
    },
  },
  {
    id: 'custom',
    label: 'Custom model folder…',
    kind: 'custom',
  },
];

export const ocrSettingsDefaults: OcrSettings = {
  activeProfileId: 'bundled-pp-ocrv4',
  customModelsPath: null,
};

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

export function loadOcrSettings(): OcrSettings {
  try {
    const p = resolvePath();
    if (!fs.existsSync(p)) return { ...ocrSettingsDefaults };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const id =
      typeof raw?.activeProfileId === 'string' && OCR_PROFILES.some((x) => x.id === raw.activeProfileId)
        ? raw.activeProfileId
        : ocrSettingsDefaults.activeProfileId;
    const custom =
      typeof raw?.customModelsPath === 'string' && raw.customModelsPath.trim()
        ? raw.customModelsPath.trim()
        : null;
    return { activeProfileId: id, customModelsPath: custom };
  } catch {
    return { ...ocrSettingsDefaults };
  }
}

export function saveOcrSettings(next: OcrSettings): void {
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
}

export function getOcrPackRoot(packDir: string): string {
  try {
    return path.join(app.getPath('userData'), 'ocr-packs', packDir);
  } catch {
    return path.join(process.cwd(), 'ocr-packs', packDir);
  }
}

export function findProfile(id: string): OcrProfileMeta | undefined {
  return OCR_PROFILES.find((p) => p.id === id);
}
