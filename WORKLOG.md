# phevere worklog

Running history since project start. Append under today's date.
Diary inbox pushes are **distilled** from this file — do not treat inbox as the only record.

## 2026-08-07

- Settings: OCR region + hover shortcuts editable; sidebar UI restyle (ink/ember, Outfit).
- OCR: grab-under-cursor, read foreground window, clipboard image OCR + watcher, SMTC now-playing, image drop/paste.
- Fix: dual-monitor popup placement via `screenToDipPoint` + nearest display workArea (no primary-only clamp).
- Lexicon: default merged definitions tab (all sources + badges); Wiktionary spelling-lemma pivot; etymology formal restyle; status bar Hover/Audio/OCR.
- Etymology: Youdao/童理民 + fixed Etymonline; Wikipedia tab replaces Wiktionary; shared ink/ember/teal design language across main/settings/popup.
- Lexicon: merge near-identical senses across Datamuse/Free Dictionary/Wiktionary with multi-source cite badges (least-info-loss).
- Translation tab: hide confidence; tighter type/actions; Save → vocabulary notebook.
- Vocabulary notebook: local SQLite (sql.js) Anki-light store; main window list + popup save.
- Offline dictionary: Settings → Offline (download CC-CEDICT with consent, import JSON/CEDICT); sqlite packs feed lookup.
- Smart routing: CJK → Youdao/CEDICT/offline; Latin → FreeDict/Wiktionary/Datamuse; translation prefers Youdao (CJK) / DeepL (Latin).
- Popup: vocab heart on toolstrip (outline ↔ red); Wikipedia thumbs via main-process data URLs + title-based summary; NSIS Setup.exe packaging (electron-builder) with seed folder + sql.js resources.
- Fix: shortcut mode gates hover (no plain-selection popup); vocab DB uses sql-asm + clearer errors; OCR auto pip-installs rapidocr on fresh PCs + Settings Install OCR deps.

## 2026-08-10

- Vocab notebook: dictionary-style rows (headword/reading/POS/langs/full def/badges/note); heart save passes pronunciation as reading.
- Translation tab: calm serif layout; friendly provider labels (Google/DeepL/Youdao); hide coarse lang/provider chrome.
- Etymology: vertical source sidebar tabs + panel (split `---` / `[Label]`).
- Wikipedia: remove toolbar W; keep tab; click hit → in-panel `<webview>` reader (Back / Open in browser); `webviewTag` on popup.
- Native OCR: `@gutenye/ocr-node` + `onnxruntime-node`, vendored PP-OCRv4 mobile under `resources/ocr-models/`; prefer native in Composite; Python RapidOCR last-resort only; Settings status-only (no pip Install).
- Fix: drop Etymonline marketing blurb; Wikipedia single-hit opens article; lemma/form-of links look up in-popup; select-to-lookup inside popup + main window; vocab notebook card padding/layout (no longer crushed by `.selection-item { padding:0 }`).
- Notebook rows collapsed by default (click to expand); OCR model packs selectable (bundled / download PP-OCRv5 / custom folder); lemma pivot saves singular headword + defs; trim trial-sounding hint copy in settings/main.

## 2026-08-11

- Author → thd2020; ship `sql-asm.js` as extraResource + robust resolve for packaged notebook DB; OCR min region 24px with feedback; hover OCR crop 96px + char-weighted token pick; CC-CEDICT SQLite always queried for CJK and enabled after download.

## 2026-08-12

- Fix installer vocab wipe: single-flight DB init, atomic persist (tmp→rename + .bak), no save-on-open race, flushPersist on quit (`src/services/local-db.ts`).
- Pronunciation: keep FreeDict IPA across merge; after plural→lemma pivot, re-fetch FreeDict for singular (vagaries/vicissitudes) (`src/services/dictionary.ts`).
- Quit: orderly tray/OS quit awaits UIA stop, disposes OCR with Windows process-tree kill, then `app.exit` (`src/index.ts`, `ocr-engine.ts`).
- Popup home-PC harden: `sandbox: false`, one retry on did-fail-load / render-process-gone; optional `userData/.disable-gpu` flag.
- Installer branding: default `Program Files\Phevere` (`menuCategory: false`); LICENSE/copyright publisher **thd2020** (removed xiangyuxiao); components page for shortcuts/OCR; ink/teal/ember icon + sidebar/header BMPs (`packaging/*`, `electron-builder.yml`).
- Single Setup.exe re-bundles OCR models via `extraResources`; uncheck OCR removes `resources\ocr-models` after extract (`packaging/installer.nsh`).
- `npm run make:win` → `scripts/make-win.js` sets npmmirror Electron / electron-builder-binaries mirrors (fixes `github.com` / `20.205.243.166` ETIMEDOUT during package).
- NSIS: drop `MUI_FUNCTION_DESCRIPTION_*` (include runs before MUI macros; was failing makensis).
- **Uninstaller / ghost installs:** reinforce Apps & Features registry in `customInstall`; Start menu **Uninstall Phevere** shortcut; `customUnInstall` clears shortcuts + legacy `thd2020`/`xiangyuxiao` Start Menu folders; `preInit` only seeds InstallLocation when empty (avoid orphan keys); add `scripts/remove-ghost-phevere.ps1` for stuck Program Files folders with no Control Panel entry.
- Docs: rewrite `README.md` (NSIS not MSI; install/uninstall/ghost cleanup; current features); refresh `PACKAGING.md` + `docs/RELEASE.md`.
- Process: project rule `.cursor/rules/update-docs-and-worklog.mdc` + user rule `update-docs-on-changes.mdc` — always update docs + granular WORKLOG on feat/fix.
- Release **1.2.1**: bump `package.json`, CHANGELOG, tag `v1.2.1`, GitHub release with NSIS Setup.
- Post-1.2.1 hotfix: dictionary/etymology `net.fetch` hard timeouts (lookup no longer hangs forever; toolstrip stays usable); forge packs `packaging/icon` into exe; `requestSingleInstanceLock` + focus on second launch; AppUserModelId → `com.phevere.app`.
- Follow-up: Electron `net.fetch` SSL hangs despite normal browser network — switch dictionary HTTP to **node-fetch** with `timeout`; defer etymology off critical path; remove Wiktionary nested multi-source etymology await; **single-instance lock only when packaged** (Forge relaunch was exiting into a wedged first instance); popup expands strip before IPC and uses 10s client timeout.
- Root cause of “frozen toolstrip”: unsafe `Promise.race([fetch, timeout])` left late fetch rejections **unhandled** → Electron process exit → Forge “Locating application” relaunch. Fixed `withTimeout` to always attach rejection handlers; catch `unhandledRejection`; stop background Etymonline; log lookup ms at IPC.
- **Root cause (higher-level):** popup webpack entry was `renderer.ts` + `index.css`, which overrode popup-new `.loading { display:none }` → permanent “Looking up…” and fought the toolstrip. Switched popup entry to `src/popup-entry.ts` (no main CSS). History/saves no longer `await recall` before `open-full-lookup` (that blocked the window on hung IPC). `window-resize` now targets the **sender** BrowserWindow. Externalize `node-fetch` in main webpack; wrap fetch in `withTimeout`; budget Latin offline sql.js; log `Dictionary lookup start`.

## 2026-08-14

- Dead popup + history lookup: `%APPDATA%/phevere/phevere.sqlite` is **43MB** (CC-CEDICT in sql.js). Opening it on the Electron **main thread** froze IPC (no `dictionary-lookup start`, no window-resize) so the toolstrip looked infinitely loading and unexpandable. Moved sql.js into `src/services/local-db-worker.cjs`; live lookup skips offline packs until the worker is ready.
- Popup HTML no longer loads Google Fonts (a hung `fonts.googleapis.com` stylesheet blocks inline scripts). Boot `initialize()` if `document.readyState` is already past `loading`; register `onPopupText` before `getLastSelection`. Show popup on `did-finish-load` if `ready-to-show` is late.
- **Shared freeze (popup + history window):** renderer `preload.ts` webpack-bundled `dlopen` of `uiautomation_selection_monitor.node` in every BrowserWindow. Second UIA instance in the popup/lookup renderer deadlocks while main already owns the hook — window never finishes loading (infinite spinner, no clicks, no `dictionary-lookup`). Removed native addon from preload; UIA stays in main only.
- Fix: `createPopupWindow` logged `textForPopup` before it was declared (TDZ) — selection threw and the popup never opened. Log moved after the const.
- **Still frozen after those fixes** (terminal 14 Aug 10:20): `Create popup window` fires, then **no** `Dictionary lookup start` / load events — renderer never reaches IPC. Added `lookup-trace` ladder (loadURL, did-start/dom-ready/did-finish, preload-error, renderer console, 1.5s/4s `executeJavaScript` probe, `phevere-trace` from preload + popup `initialize`/`lookupText`). Removed leftover webpack `rendererConfig.entry = renderer.ts` that can merge main CSS/JS into the popup bundle.
- **Exact break:** `8fcee3d` (11 Aug) duplicated `const msg` in `popup-new.html` vocab-save catch. The whole inline popup script failed to parse (`Identifier 'msg' has already been declared`), so `initialize()` never ran — dictionary icon had no click handler (`booted: false` with APIs present). Removed the duplicate line.
- **Fake-fix audit after lookup recovered:** keep popup-entry isolation, sql.js worker, preload without UIA, sender `window-resize`, no-await-recall, safe `withTimeout` / `unhandledRejection`. Reverted: Google Fonts (restored, non-blocking `media=print`), etymology skip (that dropped Etymonline/童理民), blur 150→400, and the `lookup-trace` / `phevere-trace` probe scaffolding.
- Restore multi-source etymology (Wiktionary + Etymonline + Youdao/童理民, 6s budget) so the Etymology tab shows several sources again. Dedupe example sentences across merge/UI. Fetch IPA from wink lemmas so plurals like *vicissitudes* get `/…/` from the singular.
- Quiet hunt-time logging: etymology/DBG dumps gone; popup create + lookup-start back to debug; clipboard DEBUG routed through wrapConsole (hidden at default info).
- Offline catalog: Settings → Offline now offers Princeton WordNet 3.1 and Webster 1913 (GNU GCIDE) for en→en, CC-CEDICT for zh→en, and FreeDict English–Chinese for en→zh. Living Oxford / Collegiate Webster / Collins stay out of the dump list (copyright); JSON import remains for licensed files. Pack import uses batched sql.js writes.
- Fix `make:win`: duplicate `'WordNet'` key in `getDictionaryIcon` (TS1117) blocked webpack.
- Packaged launch crash `Cannot find module 'node-fetch'`: stop externalizing `node-fetch` in `webpack.main.config.js` so Forge webpack bundles it into `app.asar` (pure-JS externals are not copied).
- Heart save no longer waits on lookup (collapsed strip could hang forever after a silent timeout). Saves the lemma immediately; fills the notebook row when lookup returns.
- Offline packs (Webster/WordNet) now query wink lemmas (`gleaned`→`glean`), skip hung etymology/IPA when only local packs answered, and return those defs if the 12s deadline fires. Timeout stubs are not cached (and old timeout cache hits are ignored).
- Notebook later-lookup rows never filled: `enrichSavedVocab` required `savedVocabId`, which a new Open popup does not have until `find()` returns (and the two ran in parallel). Enrich now finds by lemma; main `dictionary-lookup` also fills empty vocab rows. `addVocab` uses `NULLIF` so an empty string does not block a later definition.
- POS: GCIDE/Webster stored raw `n` / `v. t.` / `adj.` and skipped `normalizePartOfSpeech`, so they never merged with Free Dictionary `noun`. `canonicalPos()` in `definition-merge.ts` maps those aliases (and FreeDict TEI / WordNet leftovers) at lookup; existing packs do not need re-download.
- Lookup latency: offline sqlite was awaited (~2s) before FreeDict/Wiktionary started, and `lookupOffline` waited 1.5s for sql.js. Offline now overlaps network APIs; cold DB returns `[]` immediately. Etymology budget 2.5s when defs already exist; one lemma IPA retry instead of a 3s×N loop. Popup client race 14s → 12s.
- Notebook fill is a **main-process queue** (`src/services/vocab-enrich.ts`), not a popup side-effect: heart-save enqueues the lemma; startup/2 min scan picks leftover empty rows; worker looks up (no etymology) and patches SQLite; `vocab-updated` refreshes the notebook list. Popup can close. Open is not required.
- Lookup first-paint was ~7.5s with Webster already ready: `Promise.allSettled` waited for Google Translate + Tatoeba 5s timeouts, then etymology another 2.5s. First paint now returns local packs after a 450ms coalesce (2.5s only if offline missed). Translation/Tatoeba/etymology continue in the background and patch the open popup via `dictionary-lookup-update`.

## 2026-08-17

- `make:win` failed TS7011 in `dictionary.ts` background etymology `.catch` (implicit `any`). Annotated `(error: unknown): undefined`.
- **Installer:** real 24-bpp BMP sidebar/header (NSIS was given PNG-in-`.bmp` → blank left pane); Segoe UI + Per-Monitor v2 DPI; Win11 `F3F3F3` page colors (`scripts/prepare-installer-assets.js`, `packaging/installer.nsh`).
- **Signing:** `CSC_LINK` / `CSC_KEY_PASSWORD` + DigiCert timestamp in `electron-builder.yml`; `make:win` warns when unsigned. Self-signed does not bypass SmartScreen.
- **Fluent UI:** Mica on main/settings/clipboard/dict, Acrylic on popup; sticky titlebars (scroll no longer hides Close); Segoe UI Variable.
- **Quit:** UIA `join()` timed/detach (was blocking the main thread 10s+); destroy tray last; terminate sql.js worker; `process.exit` fallback so phevere.exe does not linger.
- **Etymonline:** parse `prose-lg` `<p>` bodies instead of truncated `og:description` (“…”).
- **Senses:** keep Free Dictionary / Wiktionary native order (`senseOrder`) after merge.
- **Notebook:** above Recent selections; IPA + play; search bar.
- `make:win` failed TS7011 on quit `.catch(() => undefined)`, duplicate `backgroundColor` in `withWin11Chrome`, and `Definition.sources` missing from the interface. Annotated catch callbacks, single backgroundColor, added `sources?` on `Definition`.
- `make:win` makensis: `MUI_BGCOLOR already defined` in `customHeader` — electron-builder predefines it. Use `!define /redef` for Win11 page colors.
- Lookup cache is per-source: a Datamuse hit + Free Dictionary timeout is no longer a 24h whole-result freeze. Failed sources retry; 404s stay empty. Latin queries fold to lowercase first (Marionette, plurals, trailing punct). US+UK IPA from Free Dictionary phonetics + Wiktionary `{{IPA|en}}`.
- Cache completeness now requires every **expected** source (Free Dictionary, Wiktionary, Datamuse) to report ok/empty — a first-paint Datamuse-only blob no longer counts as a hit. Timeouts retry after 8s; 404s stay empty 6h.
- IPA: Wiktionary wikitext parse (US/UK when tagged `a=RP,GA`); skip narrow `[…]` transcriptions; derived heads without a Pronunciation section fall back to the stem (`intensionality` → `intensional`). Restart the app so the old in-memory whole-result cache is dropped.
- Selecting a word with a trailing comma (or similar punct) no longer flips the panel between the real entry and a “no definition” miss: same-lemma punct is not a second query, empty fallbacks are not merged over a hit, and a worse `dictionary-lookup-update` cannot replace a better card.
- Notebook “IPA pending” after the panel already showed IPA: fill empty `reading` when pronunciation arrives (definition already saved no longer blocks it); one-shot scan of cards that have a definition but no reading.
- `make:win` TS7011 in `vocab-enrich.ts`: notebook IPA `onUpdate` `.catch(() => undefined)` needs an explicit `(): undefined` (same noImplicitAny trap as etymology/quit).
- Lookup panel was jammed against the frameless top edge (26px sticky toolbar, `results-section` padding-top 0). Toolbar is 36px with vertical padding; tabs/results sit in the flex column (not sticky overlay); results get 12px inset.

## 2026-08-18

- Looking up **fluff** showed **roleplaying**: Wiktionary sense “a form of roleplaying …” matched a greedy `form of` inflection pivot and replaced the headword. Grammatical form-of only (`plural of`, `alternative form of`, …); pivot only if the *first* gloss is that kind of inflection.
- In-app select-to-lookup ignored monitor mode (always opened). It now follows Off / Shortcut / On like UIA.
- Select in the main UI or an open lookup must match selecting elsewhere: popup a **toolstrip**, leave the existing lookup alone. Reuse only a collapsed strip; an expanded panel is never moved, resized, or sent `popup-text` (that was wiping the card to blank). Expanded windows also ignore later `popup-text`.
- Cut **1.2.2**: gather post-1.2.1 changelog (offline catalog, lookup speed, notebook queue, in-app toolstrip, installer/tray/IPA fixes), bump `package.json`, NSIS Setup + GitHub release.
- Published **v1.2.2** — `Phevere-Setup-1.2.2-x64.exe` (~82 MB, unsigned), SHA-256 `0B46A098…126243FB`, https://github.com/thd2020/phevere/releases/tag/v1.2.2
- Global Cursor: skill/rule **cicd-framework** (GitHub Actions floor, OIDC, `actions/attest`, language stacks). Skill/rule **migrate-cursor** (data map + PC-to-PC copy; chats are local SQLite, not account-synced — staff Aug 2026).
- GitHub Actions on phevere: `ci.yml` (Windows `electron-forge package` on PR/`main`), `release.yml` (NSIS + Release + attest on `v*` tags, unsigned unless `CSC_LINK`), Dependabot for Actions/npm. No Environment reviewers. `npm test` / `npm run lint` not in CI yet (`test-integration.js` missing; eslint import plugin missing).
- Settings: compact grouped lists, 800×600 initial size, switch thumb vertically centered (`border: none` + 18px knob), stylized P mark in titlebars (replaced magnifying glass).
- Main window: drop 640px content cap so lists use the window width; extra right padding/margin so notebook/recent inner scrollbars sit away from the window scrollbar.
- Notebook: expand/collapse only from the headword metadata row so definition text can be selected; Recent vs A–Z sort; A–Z index overlay with scrub + letter HUD; Export JSON/CSV (`vocab-export` save dialog).
- Installer art: generate 164×314 / 150×57 24-bpp BMPs from the P mark (`fill`, not cover of `assets/installer-sidebar.png`); light `#F3F3F3` inner header; `MUI_*_BITMAP_NOSTRETCH` in `installer.nsh`.
