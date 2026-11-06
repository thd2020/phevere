# Beyond selectable text — context capture & OCR plan

**2026-11-06:** Whole images (pasted, dropped or clipboard images, Scan active window, and a scanned region with more than one line) open the scanned-text window: the picture with its recognised text in place. See "Text in place" below. A one-line region is still looked up straight away, and hover and Scan under pointer are unchanged.

**2026-09-04:** Hover OCR uses one probe for every PP-OCR pack (v5 is no longer a rigid mid-word box). Packaged screen crop uses the thumbnail’s real pixel size (not `display.scaleFactor` alone) so image OCR does not emit `c e n t r i f i c`. PP-OCRv5 must use `ppocrv5_dict.txt` (~18k classes), not v4 `ppocr_keys_v1.txt`.

Status: **active** · Selection + OCR ROI/hover/grab/window/clipboard/media shipped; packaging & cross-platform media open  
Audience: implementers extending Phevere past UIAutomation-selectable text  
Related: `src/services/native-selection.ts`, `src/services/hover-lookup.ts`, `src/services/ocr-engine.ts`, `resources/ocr-models/`

## Access modes

| Mode | How | Shortcut |
|------|-----|----------|
| Drag / double-click select | UIA + gesture gate | — |
| Shortcut + hold | Monitor mode `shortcut` | cycle / trigger (settings) |
| **Hover dwell** | ~450 ms idle → UIA `RangeFromPoint`, else OCR under cursor | **editable** (default Ctrl+Shift+H) |
| Region OCR | Drag rectangle → RapidOCR | **editable** (default Ctrl+Shift+O) |
| Scan under pointer | Small rect OCR at cursor | Ctrl+Shift+G |
| Scan active window | Foreground HWND bounds → OCR | Ctrl+Shift+W |
| Clipboard image | Win+Shift+S / copy image → OCR | Ctrl+Shift+I |
| Now playing | Windows SMTC media session | Ctrl+Shift+P |
| Translate and replace | Synthetic copy, translate, synthetic paste; clipboard restored | **editable**, off by default (default Ctrl+Alt+T) |
| Choose a translation | Same copy, then a panel of every engine; Enter pastes | **editable**, off by default (default Ctrl+Alt+Shift+T) |

## Principle

**OCR is the last resort, not the first.** For cases like Spotify titles, prefer:

1. Accessibility / selection text (existing UIA path)
2. Domain APIs (OS media session, etc.)
3. Screen capture + OCR

Multiple producers feed one consumer: `lookup(query, meta)`.

## Local OCR inventory (verified 2026-08)

| Asset | Notes |
|-------|--------|
| **Shipping:** `onnxruntime-node` 1.23.2 + `@gutenye/ocr-node` | In-process; models come from the OCR pack (`src/services/ocr-pack.ts`), downloaded into `userData/ocr-packs/pp-ocrv4`; `resources/ocr-models/` serves development only. 1.23.2 is the last npm that includes Intel Mac (`darwin/x64`) binaries. Packaged apps load these from `app.asar.unpacked` (see `scripts/packager-ignore.js`); no end-user Python. |
| PP-OCRv4 mobile det / rec / cls + `ppocr_keys_v1.txt` | ~16 MB ONNX set (Apache-2.0) |
| Python RapidOCR worker | Dev (`npm start`) only; packaged builds never spawn Python |
| `Windows.Media.Ocr` | Present; only `zh-Hans-CN` pack installed here |
| Tesseract | **Not** installed |

Prefer **`onnxruntime-node`** in-process (no end-user Python) so the same weights work on Win / macOS / Linux / arm64.

Reuse scoring from the frame-table-ocr skill: CH vs EN on the same crop; no glyph rewrite maps.

## Capture contract (Phase 0)

Generalize selection into a shared event:

```ts
interface ContextEvent {
  text: string;
  x: number;
  y: number;
  timestamp: number;
  origin: 'selection' | 'ocr' | 'media' | 'clipboard' | 'manual';
  confidence?: number;       // OCR / fuzzy
  bounds?: { x: number; y: number; width: number; height: number };
  imageHash?: string;        // OCR cache key
}
```

Producers (selection, OCR, media, clipboard) emit `ContextEvent`.  
Orchestration in `index.ts` stays mode-aware (`off` / `on` / `shortcut`) and opens the same popup → `dictionaryService.lookup`.

This interface is also the target for the **macOS AX draft** (`docs/MACOS_SELECTION.md`) and a future Linux AT-SPI backend.

## Phased roadmap

### Phase 0 — Contract + wiring

- [x] Define `ContextEvent` (and optional `ContextProducer` interface)
- [x] Adapt `SelectionEvent` → `ContextEvent` (`origin: 'selection'`)
- [x] Route popup / IPC through the shared handler without behavior change
- [x] Keep OCR shortcut wired to region capture (Phases 1–2)

### Phase 1 — Screen capture

- [x] Transparent overlay for region select
- [x] Optional “grab under cursor” small rect (`Ctrl+Shift+G`)
- [x] Prefer Electron `desktopCapturer` for portability; crop in the **returned bitmap’s** pixel space (`getSize()` / display DIP). Packaged Electron often ignores `thumbnailSize`, so using `display.scaleFactor` alone sliced glyphs.
- [x] Persist capture only in memory / short-lived temp; never upload by default

### Phase 2 — OCR engine

- [x] **Primary:** in-process `onnxruntime-node` + PP-OCRv4 mobile ONNX under `resources/ocr-models/` (via `@gutenye/ocr-node`). Optional download: PP-OCRv5 + RapidOCR `ppocrv5_dict.txt` (v4 keys file yields empty rec). No end-user Python.
- [x] Packaging (2026-11-03): no models in packages; the OCR pack is a release asset installed from Settings → Capture or by Windows Setup. Packager ignore keeps webpack externals; `asar.unpackDir` so `@gutenye` ESM and ONNX/sharp `.node` live in `app.asar.unpacked`. `ensure-ocr-natives` + `verify-ocr-pack`. CI: darwin x64 + arm64.
- [x] Settings → Capture: status only (“Embedded OCR ready” / error). No pip Install UX.
- [x] Python RapidOCR worker (`scripts/ocr_worker.py`) kept as **dev-only** fallback when `npm start` cannot load natives (packaged Electron never uses it).
- [x] Cache key via `imageHash` on ContextEvent
- [ ] Windows.Media.Ocr (WinRT await still unreliable from PowerShell — deprioritized)
- [x] Warm-up on app ready

### Phase 3 — Word targeting

- [x] Map cursor into OCR boxes → token / CJK char under cursor (hover path). Gutenye `Line.box` polygons (not `frame`). Same probe for v4 and v5: line strip to measure glyph height, recrop ~8em (Latin) / ~2em (CJK), then pick the token. DB unclip is 2.2 (Gutenye default 1.5 clips v5 rec). Adjacent letter boxes and tight fragments merge; whole-word boxes do not.
- [x] Feed recognized text through `text-normalize`

### Phase 4 — Triggers

- [x] Wire OCR region shortcut (editable in settings; default `Ctrl+Shift+O`) → region OCR → popup
- [x] Hover dwell lookup (UIA first, OCR fallback); toggle shortcut editable in settings. Popup anchor is the Electron DIP cursor (`coordSpace: 'dip'`). Win32 UIA `GetWordAtPoint` is called with physical pixels; its bounding rect is **not** used for placement (HiDPI `screenToDipPoint` on DIP points pinned the strip to one workArea corner).
- [x] Explicit “read this window” action (`Ctrl+Shift+W` / `⌘⇧W`, foreground HWND or macOS System Events bounds + OCR)

### Phase 5 — Media sessions

- [x] Windows: `GlobalSystemMediaTransportControlsSessionManager` via `scripts/media_now_playing.ps1` (`Ctrl+Shift+P`)
- [x] macOS: Music.app / Spotify via `scripts/media_now_playing.applescript` (`⌘⇧P`). Browser sessions need private MediaRemote (blocked in app bundles on 15.4+)
- [ ] Linux: MPRIS / D-Bus  
Solves Spotify-class apps with clean strings and no OCR.

### Phase 6 — Images & PDFs

- [x] Drag/drop or paste image → OCR → scanned-text window with the text in place (main window + settings dropzone)
- [x] Clipboard watcher: bitmap (e.g. Win+Shift+S / ⌘⌃⇧4) → balloon or Notification + `Ctrl+Shift+I` / `⌘⇧I` OCR
- [ ] UVDoc dewarp for photographed pages when quality needs it
- [ ] PDF page raster → OCR (deferred)

## Text in place (2026-11-06)

The model follows hOCR and ALTO: page, block, paragraph, line and word, each word with a box and a confidence. Every engine maps its output to `OcrRawPage` in `packages/core/src/ocr-layout.ts`: lines as four corners in the text's own reading direction (start-top, end-top, end-bottom, start-bottom) in image pixels, with the engine's words where it gives them.

| Engine | Where | What it gives |
|---|---|---|
| PP-OCRv4 or v5 (onnxruntime) | `src/services/ocr-page-onnx.ts` | Rotated line boxes; word boxes from the recogniser's CTC time steps, as RapidOCR's `return_word_box` does; mean character probability. GutenYe's `Ocr.detect()` is not used for pages, because it drops lines under 0.5 and joins boxes across the whole width. |
| RapidOCR worker (development only) | `scripts/ocr_worker.py` | Line boxes and, with RapidOCR 3, word boxes. |
| ML Kit (Android) | `apps/mobile/android/.../Ocr.java` | Blocks, lines and elements with corner points and confidence. |
| Vision (iOS) | `PhevereViewController.swift` | Lines with corners and confidence; a box for each space-separated word. |

There is no system OCR (Windows.Media.Ocr, macOS Vision) in the desktop build; the desktop uses PP-OCR on every platform.

`buildOcrPage` then lays the page out the same way for every engine:

1. Deskew: the length-weighted dominant line direction defines the page frame, so a photo at an angle groups like a flat scan, and a page of vertical lines reads its columns right to left.
2. Rows: fragments of one visual line are joined unless the gap is a column gutter that the nearest lines above and below do not cross either.
3. Blocks and paragraphs: lines stacked with ordinary pitch, overlapping horizontally and of similar size (box height and character pitch) form a block. A block splits into paragraphs at extra pitch, a first-line indent, a list mark, a short line ending a sentence, a line after which the next line's first word would have fitted, or a block where every line starts with a capital.
4. Reading order: full-width white bands cut the page as an XY-cut does; within each band, Breuel's rule from OCRopus orders blocks (A before B when they overlap horizontally and A is above, or A is left of B and nothing between them spans both).
5. Text: words keep the engine's own spacing, CJK joins without spaces, a hyphen at a line end rejoins the word unless the page writes that compound with its hyphen elsewhere, and paragraphs are one line each.

The view (`packages/core/src/ocr-view.ts`) places every word over its pixels like pdf.js's text layer and OCRmyPDF's invisible text: font size from the box height, stretched to the box width, turned to the box angle. Edit paints a changed line over the picture in colours sampled from the line's box. `scripts/test-ocr-layout.js` checks the layout against saved outputs of both PP-OCR and RapidOCR on six rendered pages (`scripts/fixtures/ocr-layout/`).

## Packaging & platform notes

| Concern | Approach |
|---------|----------|
| Installer size | ~30–40 MB for small ONNX pair; medium optional download |
| Arch | Ship `onnxruntime-node` **1.23.2** per OS/arch (x64 + arm64). 1.24+ dropped Intel Mac (`darwin/x64`) prebuilds. Darwin AX addon is compiled for the package arch (`node-gyp --arch`, including Intel → arm64). |
| Wayland | Capture via portals; expect more friction than X11/Win |
| Privacy | Local-only by default; AI enrichment is a later opt-in |

## Explicit non-goals (for now)

- Continuous full-desktop OCR
- Requiring end-user Python for OCR (Python worker is `npm start` only)
- Scraping etymonline / Forvo as redistributed data
- Android in the same product as a separate native WebView app — [`docs/MOBILE.md`](MOBILE.md)

## Success criteria

1. Selecting normal text behaves as today (selection producer unchanged in UX).
2. Region OCR on unselectable UI yields a lookup-worthy string and opens the popup.
3. Spotify “what’s playing” works via media session without OCR when the OS exposes it.
4. No image leaves the machine unless the user opts into a cloud path later.
