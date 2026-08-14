# Seed offline dictionary packs (optional)

Place free/open dictionary dumps here before packaging:

- `*.json` / `*.jsonl` — `{ "headword", "definition", "pos?", "language?" }`
- `*.txt` CEDICT — imported via Settings → Offline, or auto-imported on first run when present

End users can also **download** catalog packs from Settings → Offline (not shipped in the installer):

| Pack | Direction | Source |
|---|---|---|
| Princeton WordNet 3.1 | en→en | wordnetcode.princeton.edu |
| Webster’s Unabridged 1913 (GNU GCIDE) | en→en | ftp.gnu.org/gnu/gcide |
| CC-CEDICT | zh→en | mdbg.net |
| FreeDict English–Chinese | en→zh | download.freedict.org |

Do not commit Oxford / Collegiate Webster / Collins dumps (publisher copyright). Licensed JSON can be imported by the user.

Files under this folder are copied into the installer as `resources/seed/` (see `forge.config.js` `extraResource`).
At runtime Phevere may import them into `userData/phevere.sqlite` (writable local DB — not inside asar).

