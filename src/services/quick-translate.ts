/**
 * Quick translation: replace the selection in any app with its translation.
 *
 * Two shortcuts, both off until the feature is switched on in Settings → Shortcuts:
 * - Translate and replace: copies the selection, translates it with the default pair and the
 *   Translation engine from Settings → Sources, and pastes the result over the selection.
 * - Choose a translation: copies the selection and opens a small panel near the pointer where
 *   the pair can be changed and the arrow keys move between engines; Enter pastes the chosen one.
 *
 * Settings live in userData/quick-translate.json. The clipboard is borrowed for the copy and the
 * paste and put back afterwards (text, HTML, RTF and image).
 */
import { app, clipboard } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { sendCopy, sendPaste } from './key-synth';

export interface QuickTranslatePrefs {
  enabled: boolean;
  replaceShortcut: string;
  panelShortcut: string;
  /** Source language code, or 'auto' to detect. */
  from: string;
  /** Target language code, or 'auto' for the usual pairing (English to Chinese, else English). */
  to: string;
}

const FILE_NAME = 'quick-translate.json';

export const quickTranslateDefaults: QuickTranslatePrefs = {
  enabled: false,
  replaceShortcut: 'CommandOrControl+Alt+T',
  panelShortcut: 'CommandOrControl+Alt+Shift+T',
  from: 'auto',
  to: 'auto',
};

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

function asLang(raw: unknown, fallback: string): string {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^(auto|[a-z]{2,3}(-[a-z0-9]{2,8})?)$/.test(v) ? v : fallback;
}

function asAccel(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
}

export function normalizeQuickTranslatePrefs(raw: Partial<QuickTranslatePrefs> | null | undefined): QuickTranslatePrefs {
  const d = quickTranslateDefaults;
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : d.enabled,
    replaceShortcut: asAccel(raw?.replaceShortcut, d.replaceShortcut),
    panelShortcut: asAccel(raw?.panelShortcut, d.panelShortcut),
    from: asLang(raw?.from, d.from),
    to: asLang(raw?.to, d.to),
  };
}

export function loadQuickTranslatePrefs(): QuickTranslatePrefs {
  try {
    const p = resolvePath();
    if (!fs.existsSync(p)) return { ...quickTranslateDefaults };
    return normalizeQuickTranslatePrefs(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    return { ...quickTranslateDefaults };
  }
}

export function saveQuickTranslatePrefs(next: Partial<QuickTranslatePrefs>, base = loadQuickTranslatePrefs()): QuickTranslatePrefs {
  const prefs = normalizeQuickTranslatePrefs({ ...base, ...next });
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(prefs, null, 2), 'utf8');
  return prefs;
}

/* ------------------------------------------------------------- clipboard */

interface ClipboardBackup {
  text: string;
  html: string;
  rtf: string;
  image: Electron.NativeImage | null;
}

function backupClipboard(): ClipboardBackup {
  const formats = clipboard.availableFormats();
  const image = formats.some((f) => f.startsWith('image/')) ? clipboard.readImage() : null;
  return {
    text: clipboard.readText(),
    html: formats.includes('text/html') ? clipboard.readHTML() : '',
    rtf: formats.includes('text/rtf') ? clipboard.readRTF() : '',
    image: image && !image.isEmpty() ? image : null,
  };
}

function restoreClipboard(b: ClipboardBackup): void {
  const data: Electron.Data = {};
  if (b.text) data.text = b.text;
  if (b.html) data.html = b.html;
  if (b.rtf) data.rtf = b.rtf;
  if (b.image) data.image = b.image;
  if (Object.keys(data).length) clipboard.write(data);
  else clipboard.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Copy the selection of the focused app and return it, with the clipboard as it was before.
 * Empty when nothing is selected (the copy left the clipboard unchanged).
 */
export async function copySelection(): Promise<{ text: string; backup: ClipboardBackup }> {
  const backup = backupClipboard();
  // A marker shows whether the copy landed: apps with no selection leave the clipboard alone.
  const marker = `\u2063phevere-${Date.now()}`;
  clipboard.writeText(marker);
  await sendCopy();
  let text = '';
  for (let i = 0; i < 30; i++) {
    await sleep(20);
    const now = clipboard.readText();
    if (now !== marker) {
      text = now;
      break;
    }
  }
  restoreClipboard(backup);
  return { text: text.trim() ? text : '', backup };
}

/** Paste `text` over the selection of the focused app, then put the clipboard back. */
export async function pasteText(text: string, backup: ClipboardBackup): Promise<void> {
  clipboard.writeText(text);
  await sendPaste();
  // The target reads the clipboard when it handles the paste; give it time before restoring.
  await sleep(350);
  if (clipboard.readText() === text) restoreClipboard(backup);
}

/** Keep the paragraph breaks and outer spacing of the selection around the translation. */
export function shapeLike(original: string, translated: string): string {
  const lead = original.match(/^\s*/)?.[0] || '';
  const tail = original.match(/\s*$/)?.[0] || '';
  return `${lead}${translated.trim()}${tail}`;
}
