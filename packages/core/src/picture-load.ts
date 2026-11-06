/**
 * Sense and card pictures are loaded before they are shown, the way image libraries such as
 * Glide, Coil and SDWebImage do it: the box a picture will take stays blank (no frame, no grey or
 * dark fill) until the bytes are decoded, and then the picture fades in. A picture whose request
 * fails is asked for again after one and after three seconds. On the phone a last try goes through
 * the app's own HTTP client (the native bridge), which keeps its connections pooled and retries a
 * dropped connection itself, and the bytes are shown from a blob URL. Only when every try has
 * failed is the picture dropped, and a later paint tries it again after a minute.
 *
 * A picture that is slow is never cut off: an image request has no timeout of its own, so it
 * keeps loading for as long as the connection lasts.
 *
 * Markup: an `<img data-pic="URL">` without `src` is filled in by `hydratePictures`; one whose
 * picture is already here gets `src` straight away (`pictureSrc`), so a repaint never blanks it.
 */
import { getHttp, isCoreConfigured } from './runtime';

/** Waits before the second and the third try. */
const RETRY_DELAYS_MS = [1000, 3000];
/** A picture that failed every try is not asked for again until this has passed. */
const FAILED_FOR_MS = 60_000;
/** The last try through the app's HTTP client may take this long. */
const BYTES_TIMEOUT_MS = 30_000;

/**
 * Blob URLs kept at once. Each holds a thumbnail's bytes; older ones are revoked, so scrolling a
 * book of thousands of cards on a weak connection does not keep every picture in memory. An
 * `<img>` that already shows a revoked blob keeps showing it; a repaint loads the picture again.
 */
const BLOB_MAX = 48;
/** Loaded pictures remembered at once (URLs only, apart from the blobs above). */
const READY_MAX = 2000;

/** Pictures that have loaded in this page: URL to the `src` that shows it (the URL or a blob URL). */
const ready = new Map<string, string>();
/** The URLs in `ready` whose `src` is a blob URL, oldest first. */
const blobs: string[] = [];
const loading = new Map<string, Promise<string | null>>();
const failedAt = new Map<string, number>();

const isBlob = (src: string) => src.startsWith('blob:');

function revoke(src: string): void {
  const g = globalThis as unknown as { URL?: { revokeObjectURL?: (u: string) => void } };
  try {
    g.URL?.revokeObjectURL?.(src);
  } catch {
    /* already gone */
  }
}

function forget(url: string): void {
  const src = ready.get(url);
  ready.delete(url);
  if (!src || !isBlob(src)) return;
  revoke(src);
  const i = blobs.indexOf(url);
  if (i >= 0) blobs.splice(i, 1);
}

function remember(url: string, src: string): void {
  if (ready.has(url)) forget(url);
  ready.set(url, src);
  if (isBlob(src)) blobs.push(url);
  while (blobs.length > BLOB_MAX) forget(blobs[0]);
  while (ready.size > READY_MAX) forget(ready.keys().next().value as string);
}

/** What to put in `src` for a picture that has already loaded here, or '' when it has not. */
export function pictureSrc(url: string): string {
  return ready.get(url) || '';
}

type ImageCtor = new () => HTMLImageElement;

function imageCtor(): ImageCtor | null {
  const g = globalThis as unknown as { Image?: ImageCtor };
  return typeof g.Image === 'function' ? g.Image : null;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One try with an off-screen image element: true when the picture loaded and decoded. */
function tryImage(Ctor: ImageCtor, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const im = new Ctor();
    try {
      im.referrerPolicy = 'no-referrer';
      im.decoding = 'async';
    } catch {
      /* older engines */
    }
    im.onload = () => {
      // decode() makes sure the first frame paints whole; a loaded picture counts even if it fails.
      const done = () => resolve(im.naturalWidth > 0 || im.complete);
      if (typeof im.decode === 'function') im.decode().then(done, done);
      else done();
    };
    im.onerror = () => resolve(false);
    im.src = url;
  });
}

/** The last try: the bytes through the app's HTTP client, shown from a blob URL. */
async function tryBytes(url: string): Promise<string> {
  const g = globalThis as unknown as { URL?: { createObjectURL?: (b: Blob) => string }; Blob?: typeof Blob };
  if (!isCoreConfigured() || !g.URL?.createObjectURL || !g.Blob) return '';
  try {
    const res = await getHttp().requestBytes(url, { timeoutMs: BYTES_TIMEOUT_MS });
    if (!res.ok || !res.bytes?.length) return '';
    const type = /^image\//.test(res.contentType || '') ? res.contentType : 'image/jpeg';
    const src = g.URL.createObjectURL(new g.Blob([res.bytes as BlobPart], { type }));
    const Ctor = imageCtor();
    if (!Ctor || (await tryImage(Ctor, src))) return src;
    revoke(src);
    return '';
  } catch {
    return '';
  }
}

/**
 * Loads a picture and resolves with the `src` that shows it, or null when every try failed. Calls
 * for the same URL share one load.
 */
export function loadPicture(url: string): Promise<string | null> {
  const u = String(url || '');
  if (!u) return Promise.resolve(null);
  const hit = ready.get(u);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(u);
  if (pending) return pending;
  const failed = failedAt.get(u);
  if (failed && Date.now() - failed < FAILED_FOR_MS) return Promise.resolve(null);
  const Ctor = imageCtor();
  // Without an image element (a test, a worker) there is nothing to load ahead: show the URL.
  if (!Ctor) return Promise.resolve(u);
  const p = (async (): Promise<string | null> => {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt) await wait(RETRY_DELAYS_MS[attempt - 1]);
      if (await tryImage(Ctor, u)) return u;
    }
    return (await tryBytes(u)) || null;
  })().then((src) => {
    loading.delete(u);
    if (src) {
      remember(u, src);
      failedAt.delete(u);
    } else failedAt.set(u, Date.now());
    return src;
  });
  loading.set(u, p);
  return p;
}

/**
 * Fills every `img[data-pic]` under `root` that has no `src` yet once its picture has loaded, and
 * calls `onLoad` for it (to fade it in), or `onFail` when every try failed (to drop its box).
 * Elements a repaint put in since are filled too, so a picture never loads twice into a gap.
 */
export function hydratePictures(
  root: ParentNode | null | undefined,
  hooks: { onLoad?: (img: HTMLImageElement) => void; onFail?: (img: HTMLImageElement) => void } = {},
): void {
  if (!root?.querySelectorAll) return;
  const urls = new Set<string>();
  root.querySelectorAll<HTMLImageElement>('img[data-pic]').forEach((img) => {
    if (!img.getAttribute('src')) urls.add(img.getAttribute('data-pic') || '');
  });
  for (const url of urls) {
    if (!url) continue;
    void loadPicture(url).then((src) => {
      const doc = (root as Node).ownerDocument || (root as unknown as Document);
      const scope: ParentNode = (doc as Document)?.querySelectorAll ? (doc as Document) : root;
      scope.querySelectorAll<HTMLImageElement>('img[data-pic]').forEach((img) => {
        if (img.getAttribute('data-pic') !== url || img.getAttribute('src')) return;
        if (src) {
          img.src = src;
          hooks.onLoad?.(img);
        } else hooks.onFail?.(img);
      });
    });
  }
}

/** For tests: forget every loaded and failed picture. */
export function clearPictureLoads(): void {
  for (const url of Array.from(ready.keys())) forget(url);
  loading.clear();
  failedAt.clear();
}
