# Beyond selectable text — context capture & OCR plan

Status: **active** · Phase 0 in progress  
Audience: implementers extending Phevere past UIAutomation-selectable text  
Related: `src/services/native-selection.ts`, OCR stub `CommandOrControl+Shift+O` in `src/index.ts`

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
- [ ] Optional “grab under cursor” small rect
- [x] Prefer Electron `desktopCapturer` for portability; consider Win32 `PrintWindow` / BitBlt for a single HWND when needed
- [x] Persist capture only in memory / short-lived temp; never upload by default

### Phase 2 — OCR engine

- [ ] Bundle PP-OCRv6 **small** det+rec (+ EN mobile re-rec)
- [ ] `onnxruntime-node` with lazy warm-up at idle
- [x] Cache key via `imageHash` on ContextEvent
- [x] Optional: `Windows.Media.Ocr` when language packs exist (bootstrap path)
- [ ] Budget ~100–300 ms for a small region on CPU

### Phase 3 — Word targeting

- [ ] Map cursor / click into OCR line boxes → token under cursor
- [x] Feed recognized text through `text-normalize` (edge trim + candidate ladder + Datamuse sug) — OCR noise looks like selection punctuation bugs

### Phase 4 — Triggers

- [x] Wire `Ctrl+Shift+O` → region OCR → popup
- [ ] Opt-in hover-OCR dwell (off by default)
- [ ] Explicit “read this window” action

### Phase 5 — Media sessions

- [ ] Windows: `GlobalSystemMediaTransportControlsSessionManager`
- [ ] macOS: `MPNowPlayingInfoCenter` (when native layer exists)
- [ ] Linux: MPRIS / D-Bus  
Solves Spotify-class apps with clean strings and no OCR.

### Phase 6 — Images & PDFs

- [ ] Drag/drop or paste image → OCR → lookup
- [ ] Clipboard watcher: bitmap (e.g. Win+Shift+S) → offer lookup
- [ ] UVDoc dewarp for photographed pages when quality needs it

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
