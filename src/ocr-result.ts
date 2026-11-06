/**
 * Scanned-text window: the picture with its text in place (packages/core/src/ocr-view.ts).
 * The picture fits the window's width and scrolls; Ctrl+wheel or Ctrl+plus and minus zoom.
 * Selecting words looks them up the way selecting text anywhere in Phevere does.
 */
import './fonts';
import '@phevere/core/ocr-view.css';
import './ocr-result.css';
import { OcrView, ocrBarHtml } from '@phevere/core/ocr-view';
import type { OcrPage } from '@phevere/core/ocr-layout';
import type { UnitResult } from '@phevere/core/ocr-translate';
import { t } from '@phevere/core/i18n/runtime';
import { windowLanguageReady } from './ui-language';

const api = (window as any).ocrResultAPI as {
  data: () => Promise<{ image: string; page: OcrPage } | null>;
  copyText: (text: string) => Promise<void>;
  copyImage: (png: ArrayBuffer) => Promise<void>;
  saveImage: (png: ArrayBuffer) => Promise<{ saved: boolean }>;
  lookup: (x: number, y: number, text: string) => void;
  translateInfo: () => Promise<{ languages: { code: string; name: string }[] }>;
  translateTarget: (sample: string) => Promise<string>;
  setTranslateTarget: (code: string) => Promise<void>;
  translate: (texts: string[], to: string, id: number) => Promise<UnitResult[]>;
  cancelTranslate: (id: number) => void;
};

/**
 * Translation goes through the main process, which cannot see the run's `wanted`. Each request
 * has an id, and a request the page no longer wants is cancelled there, so its queued engine
 * requests are dropped unsent.
 */
const asking = new Map<number, () => boolean>();
let lastAsk = 0;
let watch = 0;
function translateAsked(texts: string[], to: string, wanted: () => boolean): Promise<UnitResult[]> {
  const id = ++lastAsk;
  asking.set(id, wanted);
  if (!watch) {
    watch = window.setInterval(() => {
      for (const [k, w] of asking) {
        if (w()) continue;
        asking.delete(k);
        api.cancelTranslate(k);
      }
      if (!asking.size) {
        window.clearInterval(watch);
        watch = 0;
      }
    }, 200);
  }
  return api.translate(texts, to, id).finally(() => asking.delete(id));
}

const root = document.querySelector<HTMLElement>('.ocr-view')!;
const stage = root.querySelector<HTMLElement>('.ocr-window__stage')!;
const frame = root.querySelector<HTMLElement>('.ocr-frame')!;
const img = frame.querySelector<HTMLImageElement>('img')!;
const toastEl = root.querySelector<HTMLElement>('.ocr-window__toast')!;

let toastTimer = 0;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add('is-on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), 1400);
}

async function start(): Promise<void> {
  // The toolbar and the toasts are built in the interface language, so it loads first.
  await windowLanguageReady();
  const data = await api.data();
  if (!data) return;
  const page = data.page;
  const empty = !page.blocks.length;
  const { languages } = await api.translateInfo().catch(() => ({ languages: [] as { code: string; name: string }[] }));
  root.querySelector('.ocr-window__bar')!.innerHTML = ocrBarHtml({ saveImage: true, copyImage: true, translate: languages.length > 0, empty });
  img.src = data.image;
  await img.decode().catch((): undefined => undefined);

  let zoom = 1;
  const layout = () => {
    const avail = Math.max(120, stage.clientWidth - 32);
    // One picture pixel to one screen pixel at most, so a scanned region shows at the size it had on screen.
    const w = Math.min(page.width / (window.devicePixelRatio || 1), avail) * zoom;
    frame.style.width = `${w}px`;
    frame.style.height = `${(w * page.height) / page.width}px`;
    view.fit();
  };
  const view = new OcrView(root, page, img, {
    copyText: async (text) => {
      await api.copyText(text);
      toast(t('common.copied'));
    },
    copyImage: async (png) => {
      await api.copyImage(await png.arrayBuffer());
      toast(t('common.copied'));
    },
    saveImage: async (png) => {
      const r = await api.saveImage(await png.arrayBuffer());
      if (r.saved) toast(t('popup.scanText.saved'));
    },
    translator: languages.length
      ? {
          languages,
          target: (sample) => api.translateTarget(sample),
          setTarget: (code) => void api.setTranslateTarget(code),
          translate: (texts, to, wanted) => translateAsked(texts, to, wanted),
        }
      : undefined,
  });
  layout();
  new ResizeObserver(layout).observe(stage);

  const setZoom = (next: number) => {
    zoom = Math.max(0.5, Math.min(4, next));
    layout();
  };
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    const editing = (e.target as HTMLElement)?.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) setZoom(zoom * 1.25);
    else if ((e.ctrlKey || e.metaKey) && e.key === '-') setZoom(zoom / 1.25);
    else if ((e.ctrlKey || e.metaKey) && e.key === '0') setZoom(1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !editing && view.mode === 'picture') {
      // Select all: the words of the picture, not the toolbar.
      e.preventDefault();
      const r = document.createRange();
      r.selectNodeContents(root.querySelector('.ocr-layer')!);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    } else return;
    e.preventDefault();
  });

  // Select to look up, as in the main window: a short selection of words opens the pop-up.
  let timer = 0;
  document.addEventListener('mouseup', (e) => {
    if ((e.target as HTMLElement).closest('button, select, [contenteditable]')) return;
    const text = view.selectionText().trim();
    if (!text || text.length > 80 || !/[\p{L}\p{N}]/u.test(text)) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (view.selectionText().trim() !== text) return;
      api.lookup(e.screenX || 0, e.screenY || 0, text);
    }, 280);
  });
}

void start();
