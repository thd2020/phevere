import './platform/configure-core';
import {
  addVocab,
  dictionaryService,
  findByLemma,
  listVocab,
  saveLemma,
  type DictionaryResult,
  type VocabEntry,
} from '@phevere/core';
import { renderLookup, renderNotebook } from './lookup-view';
import { extractLookupQuery, startIncomingText } from './incoming-text';

type Tab = 'lookup' | 'notebook';

const appEl = document.querySelector('#app')!;

let tab: Tab = 'lookup';
let query = '';
let looking = false;
let result: DictionaryResult | null = null;
let saved: VocabEntry | null = null;
let notebook: VocabEntry[] = [];
let notebookSort: 'recent' | 'az' = 'recent';
let status = '';

function html(): string {
  return `
    <div class="app">
      <div class="brand"><h1>Phevere</h1><span>lookup</span></div>
      <form class="search-row">
        <input type="search" enterkeyhint="search" placeholder="Word or phrase" value="${escapeAttr(query)}" />
        <button type="submit">Look up</button>
      </form>
      <nav class="tabs">
        <button type="button" data-tab="lookup" class="${tab === 'lookup' ? 'active' : ''}">Dictionary</button>
        <button type="button" data-tab="notebook" class="${tab === 'notebook' ? 'active' : ''}">Notebook</button>
      </nav>
      <div class="panel">
        ${tab === 'lookup' ? lookupPanel() : notebookPanel()}
      </div>
    </div>
  `;
}

function lookupPanel(): string {
  if (looking) return `<p class="status">Looking up…</p>`;
  if (status && !result) return `<p class="status">${escapeHtml(status)}</p>`;
  if (!result) return `<p class="empty">Select text in another app and share it to Phevere, or search here.</p>`;
  return renderLookup(result, saved);
}

function notebookPanel(): string {
  return `
    <div class="sort-row">
      <button type="button" data-sort="recent" class="${notebookSort === 'recent' ? 'active' : ''}">Recent</button>
      <button type="button" data-sort="az" class="${notebookSort === 'az' ? 'active' : ''}">A–Z</button>
    </div>
    ${renderNotebook(notebook, notebookSort)}
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function bind(): void {
  const form = appEl.querySelector('form');
  const input = appEl.querySelector('input[type="search"]') as HTMLInputElement | null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = extractLookupQuery(input?.value || '');
    if (q) void lookup(q);
  });
  appEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = (btn as HTMLElement).dataset.tab === 'notebook' ? 'notebook' : 'lookup';
      paint();
      if (tab === 'notebook') void refreshNotebook();
    });
  });
  appEl.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      notebookSort = (btn as HTMLElement).dataset.sort === 'az' ? 'az' : 'recent';
      paint();
    });
  });
  appEl.querySelectorAll('[data-lookup]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = (btn as HTMLElement).dataset.lookup || '';
      if (q) void lookup(q);
    });
  });
  appEl.querySelector('.save-btn')?.addEventListener('click', () => void saveCurrent());
}

function paint(): void {
  appEl.innerHTML = html();
  bind();
}

async function refreshNotebook(): Promise<void> {
  try {
    notebook = await listVocab(400);
  } catch (err) {
    status = err instanceof Error ? err.message : String(err);
  }
  if (tab === 'notebook') paint();
}

async function lookup(raw: string): Promise<void> {
  query = extractLookupQuery(raw);
  if (!query) return;
  tab = 'lookup';
  looking = true;
  status = '';
  result = null;
  paint();
  try {
    const next = await dictionaryService.lookup(query, 'auto', undefined, {
      onUpdate: (partial) => {
        result = partial;
        looking = false;
        paint();
      },
    });
    result = next;
    saved = await findByLemma(saveLemma(next)).catch(() => null);
  } catch (err) {
    status = err instanceof Error ? err.message : String(err);
  } finally {
    looking = false;
    paint();
  }
}

async function saveCurrent(): Promise<void> {
  if (!result) return;
  const lemma = saveLemma(result);
  const def = result.definitions[0]?.meaning;
  saved = await addVocab({
    lemma,
    reading: result.pronunciation,
    definition: def,
    partOfSpeech: result.definitions[0]?.partOfSpeech,
    sources: result.sources,
  });
  await refreshNotebook();
  paint();
}

export async function startApp(): Promise<void> {
  paint();
  await sqlReady();
  await refreshNotebook();
  await startIncomingText((text) => {
    void lookup(text);
  });
}

async function sqlReady(): Promise<void> {
  try {
    await listVocab(1);
  } catch {
    /* first paint still works */
  }
}
