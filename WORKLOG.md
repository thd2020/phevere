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
