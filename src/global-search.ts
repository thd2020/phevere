/**
 * The main window's search field. Typing still filters the notebook below, and a panel under
 * the field offers everything else the query can mean: look it up, saved words, recent
 * lookups, and the Settings page that holds a matching option. Arrow keys move through the
 * rows, Enter opens the highlighted one (looking the query up by default), Escape closes.
 */

export interface SearchEntry {
  id: string;
  lemma: string;
  definition?: string | null;
  reading?: string | null;
}

export interface GlobalSearchSources {
  notebook(): SearchEntry[];
  recent(): Array<{ q: string; at: number }>;
  lookup(q: string): void;
  /** Show every notebook match in the list (the field already filters it). */
  showNotebook(): void;
  openSettings(section: string): void;
}

interface Row {
  kind: 'lookup' | 'word' | 'recent' | 'setting' | 'all';
  label: string;
  hint?: string;
  run: () => void;
}

/** Settings pages and the words people use for what is on them. */
const SETTINGS: Array<{ section: string; label: string; words: string[] }> = [
  { section: 'shortcuts', label: 'Shortcuts', words: ['shortcut', 'hotkey', 'keyboard', 'accelerator', 'key binding'] },
  { section: 'capture', label: 'Capture', words: ['selection', 'select', 'hover', 'ocr', 'scan', 'clipboard', 'popup', 'pop-up', 'region', 'screen', 'remember', 'source', 'where', 'page', 'pdf', 'book'] },
  { section: 'notifications', label: 'Notifications', words: ['notification', 'toast', 'banner', 'tray', 'alert'] },
  { section: 'sources', label: 'Sources', words: ['source', 'dictionary', 'wiktionary', 'datamuse', 'jisho', 'kaikki', 'translation engine', 'google translate', 'mymemory', 'youdao', 'deepl', 'images', 'pictures'] },
  { section: 'offline', label: 'Offline', words: ['offline', 'pack', 'download', 'wordnet', 'cedict', 'jmdict', 'freedict', 'kengdic', 'webster'] },
  { section: 'api', label: 'API keys', words: ['api', 'key', 'token', 'deepl', 'google cloud', 'youdao'] },
  { section: 'audio', label: 'Audio', words: ['audio', 'voice', 'speech', 'speak', 'pronunciation', 'kokoro', 'espeak', 'tts', 'sound'] },
];

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function firstSense(def: unknown): string {
  const text = String(def ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*(\d+[.)]|[-•])\s*/, '')
    .split(/\n|(?<=\.)\s|;\s/)[0]
    .trim();
  return text.length > 70 ? `${text.slice(0, 68)}…` : text;
}

/** Saved words first by how the lemma matches (exact, prefix, inside), then by the meaning. */
function notebookMatches(entries: SearchEntry[], q: string): SearchEntry[] {
  const scored: Array<{ e: SearchEntry; s: number }> = [];
  for (const e of entries) {
    const lemma = String(e.lemma || '').toLowerCase();
    let s = 0;
    if (lemma === q) s = 4;
    else if (lemma.startsWith(q)) s = 3;
    else if (lemma.includes(q)) s = 2;
    else if (String(e.definition || '').toLowerCase().includes(q)) s = 1;
    if (s) scored.push({ e, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.e.lemma.length - b.e.lemma.length).map((x) => x.e);
}

export function searchRows(q: string, src: GlobalSearchSources): Row[] {
  const query = q.trim();
  if (!query) return [];
  const lower = query.toLowerCase();
  const rows: Row[] = [{ kind: 'lookup', label: query, run: () => src.lookup(query) }];
  const words = notebookMatches(src.notebook(), lower);
  const saved = new Set(words.map((w) => w.lemma.toLowerCase()));
  for (const w of words.slice(0, 5)) {
    rows.push({ kind: 'word', label: w.lemma, hint: firstSense(w.definition), run: () => src.lookup(w.lemma) });
  }
  if (words.length > 5) rows.push({ kind: 'all', label: `All ${words.length} saved words`, run: () => src.showNotebook() });
  const recent = src
    .recent()
    .filter((r) => r.q.toLowerCase().includes(lower) && !saved.has(r.q.toLowerCase()) && r.q.toLowerCase() !== lower)
    .slice(0, 3);
  for (const r of recent) rows.push({ kind: 'recent', label: r.q, run: () => src.lookup(r.q) });
  for (const s of SETTINGS) {
    const hit = s.label.toLowerCase().includes(lower) || s.words.some((w) => w.includes(lower) || (lower.length > 3 && lower.includes(w)));
    if (hit && lower.length >= 2) rows.push({ kind: 'setting', label: s.label, run: () => src.openSettings(s.section) });
  }
  return rows;
}

const HEADING: Record<Row['kind'], string> = {
  lookup: '',
  word: 'My words',
  all: 'My words',
  recent: 'Recent',
  setting: 'Settings',
};

const ICON: Record<Row['kind'], string> = {
  lookup: '<path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8"/>',
  word: '<path d="M6 4h10a2 2 0 0 1 2 2v14l-7-3.5L4 20V6a2 2 0 0 1 2-2z"/>',
  all: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  recent: '<path d="M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v4h-4"/>',
  setting: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
};

export function wireGlobalSearch(input: HTMLInputElement, src: GlobalSearchSources): void {
  const panel = document.createElement('div');
  panel.className = 'gsearch';
  panel.id = 'globalSearchPanel';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;
  input.insertAdjacentElement('afterend', panel);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-controls', panel.id);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  input.parentElement?.classList.add('gsearch-host');

  let rows: Row[] = [];
  let active = 0;

  const close = () => {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const paint = () => {
    rows = searchRows(input.value, src);
    if (!rows.length) {
      close();
      return;
    }
    active = Math.min(active, rows.length - 1);
    let last = '';
    panel.innerHTML = rows
      .map((r, i) => {
        const head = HEADING[r.kind];
        const title = head && head !== last ? `<p class="gsearch__head">${head}</p>` : '';
        last = head || last;
        const label = r.kind === 'lookup' ? `Look up <b>${esc(r.label)}</b>` : esc(r.label);
        return `${title}<div class="gsearch__row gsearch__row--${r.kind}${i === active ? ' is-active' : ''}" role="option" id="gsearch-${i}" data-i="${i}" aria-selected="${i === active}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${ICON[r.kind]}</svg>
          <span class="gsearch__label">${label}</span>
          ${r.hint ? `<span class="gsearch__hint">${esc(r.hint)}</span>` : ''}
          ${i === active ? '<kbd>Enter</kbd>' : ''}
        </div>`;
      })
      .join('');
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `gsearch-${active}`);
  };

  const run = (i: number) => {
    const row = rows[i];
    if (!row) return;
    close();
    row.run();
  };

  input.addEventListener('input', () => {
    active = 0;
    paint();
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) paint();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (panel.hidden) {
        paint();
        return;
      }
      ev.preventDefault();
      active = (active + (ev.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      paint();
    } else if (ev.key === 'Enter') {
      if (panel.hidden) return;
      ev.preventDefault();
      run(active);
    } else if (ev.key === 'Escape') {
      if (!panel.hidden) {
        ev.preventDefault();
        ev.stopPropagation();
        close();
      }
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  // Keep focus in the field while a row is clicked.
  panel.addEventListener('mousedown', (ev) => ev.preventDefault());
  panel.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('.gsearch__row');
    if (row) run(Number(row.dataset.i));
  });
  panel.addEventListener('mousemove', (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('.gsearch__row');
    const i = row ? Number(row.dataset.i) : -1;
    if (i >= 0 && i !== active) {
      active = i;
      paint();
    }
  });
}
