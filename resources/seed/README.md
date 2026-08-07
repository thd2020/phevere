# Seed offline dictionary packs (optional)

Place free/open dictionary dumps here before packaging:

- `*.json` / `*.jsonl` — `{ "headword", "definition", "pos?", "language?" }`
- `*.txt` CEDICT — imported via Settings → Offline, or auto-imported on first run when present

Files under this folder are copied into the installer as `resources/seed/` (see `forge.config.js` `extraResource`).
At runtime Phevere may import them into `userData/phevere.sqlite` (writable local DB — not inside asar).

Do not commit large proprietary dumps without a license.
