# Beyond selectable text — context capture & OCR plan

Status: **active** · Selection + OCR ROI/hover/grab/window/clipboard/media shipped; packaging & cross-platform media open  
Audience: implementers extending Phevere past UIAutomation-selectable text  
Related: `src/services/native-selection.ts`, `src/services/hover-lookup.ts`, `scripts/ocr_worker.py`

## Access modes

| Mode | How | Shortcut |
|------|-----|----------|
| Drag / double-click select | UIA + gesture gate | — |
| Shortcut + hold | Monitor mode `shortcut` | cycle / trigger (settings) |
| **Hover dwell** | ~450 ms idle → UIA `RangeFromPoint`, else OCR under cursor | **editable** (default Ctrl+Shift+H) |
| Region OCR | Drag rectangle → RapidOCR | **editable** (default Ctrl+Shift+O) |
| Grab under cursor | Small rect OCR at cursor | Ctrl+Shift+G |
| Read this window | Foreground HWND bounds → OCR | Ctrl+Shift+W |
| Clipboard image | Win+Shift+S / copy image → OCR | Ctrl+Shift+I |
| Now playing | Windows SMTC media session | Ctrl+Shift+P |

## Principle

**OCR is the last resort, not the first.** For cases like Spotify titles, prefer:

1. Accessibility / selection text (existing UIA path)
2. Domain APIs (OS media session, etc.)
3. Screen capture + OCR

Multiple producers feed one consumer: `lookup(query, meta)`.

## Local OCR inventory (verified 2026-08)

| Asset | Notes |
|-------|--------|
| RapidOCR 3.x + onnxruntime 1.28 | CPU only (`CPUExecutionProvider`); no CUDA/DirectML |
| `PP-OCRv6_det_small` / `rec_small` | ~9.5 MB + ~20.3 MB ONNX — preferred ship set |
| Medium det/rec | ~59 / ~73 MB — quality option, larger bundle |
| `en_PP-OCRv5_rec_mobile` + latin | ~7.5 MB each — Latin/Roman re-rec |
| PaddleX UVDoc + orientation | Dewarp / doc orientation; available locally |
| `Windows.Media.Ocr` | Present; only `zh-Hans-CN` pack installed here |
| Tesseract | **Not** installed |

Models are portable `.onnx`. Prefer **`onnxruntime-node`** in-process (no Python sidecar) so the same weights work on Win / macOS / Linux / arm64.

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

This interface is also the target for future macOS AX / Linux AT-SPI backends.

## Phased roadmap

### Phase 0 — Contract + wiring

- [x] Define `ContextEvent` (and optional `ContextProducer` interface)
- [x] Adapt `SelectionEvent` → `ContextEvent` (`origin: 'selection'`)
- [x] Route popup / IPC through the shared handler without behavior change
- [x] Keep OCR shortcut wired to region capture (Phases 1–2)

### Phase 1 — Screen capture

- [x] Transparent overlay for region select
- [x] Optional “grab under cursor” small rect (`Ctrl+Shift+G`)
- [x] Prefer Electron `desktopCapturer` for portability; consider Win32 `PrintWindow` / BitBlt for a single HWND when needed
- [x] Persist capture only in memory / short-lived temp; never upload by default

### Phase 2 — OCR engine

- [x] RapidOCR PP-OCRv6 via persistent `scripts/ocr_worker.py` (uses local ONNX)
- [x] Bundle / first-run OCR models: worker auto `pip install rapidocr onnxruntime` when missing; models cache under `%APPDATA%/phevere/ocr-models` via `PHEVERE_OCR_MODEL_ROOT`. Settings → Capture → Install OCR deps.
- [ ] `onnxruntime-node` in-process (optional later; Python worker is the shipping path for now)
- [x] Cache key via `imageHash` on ContextEvent
- [ ] Windows.Media.Ocr (WinRT await still unreliable from PowerShell — deprioritized)
- [x] Warm-up on app ready

### Phase 3 — Word targeting

- [x] Map cursor into OCR boxes → token / CJK char under cursor (hover path)
- [x] Feed recognized text through `text-normalize`

### Phase 4 — Triggers

- [x] Wire OCR region shortcut (editable in settings; default `Ctrl+Shift+O`) → region OCR → popup
- [x] Hover dwell lookup (UIA first, OCR fallback); toggle shortcut editable in settings
- [x] Explicit “read this window” action (`Ctrl+Shift+W`, foreground HWND bounds + OCR)

### Phase 5 — Media sessions

- [x] Windows: `GlobalSystemMediaTransportControlsSessionManager` via `scripts/media_now_playing.ps1` (`Ctrl+Shift+P`)
- [ ] macOS: `MPNowPlayingInfoCenter` (when native layer exists)
- [ ] Linux: MPRIS / D-Bus  
Solves Spotify-class apps with clean strings and no OCR.

### Phase 6 — Images & PDFs

- [x] Drag/drop or paste image → OCR → lookup (main window + settings dropzone)
- [x] Clipboard watcher: bitmap (e.g. Win+Shift+S) → balloon + `Ctrl+Shift+I` OCR
- [ ] UVDoc dewarp for photographed pages when quality needs it
- [ ] PDF page raster → OCR (deferred)

## Packaging & platform notes

| Concern | Approach |
|---------|----------|
| Installer size | ~30–40 MB for small ONNX pair; medium optional download |
| Arch | Ship `onnxruntime-node` per OS/arch (x64 + arm64) |
| Wayland | Capture via portals; expect more friction than X11/Win |
| Privacy | Local-only by default; AI enrichment is a later opt-in |

## Explicit non-goals (for now)

- Continuous full-desktop OCR
- Shipping a Python OCR sidecar
- Scraping etymonline / Forvo as redistributed data
- Android in the same Electron binary (separate product surface)

## Success criteria

1. Selecting normal text behaves as today (selection producer unchanged in UX).
2. Region OCR on unselectable UI yields a lookup-worthy string and opens the popup.
3. Spotify “what’s playing” works via media session without OCR when the OS exposes it.
4. No image leaves the machine unless the user opts into a cloud path later.
