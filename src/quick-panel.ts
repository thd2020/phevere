/**
 * Quick translation panel: the selection translated by every engine at once. The arrow keys
 * move between engines, Enter pastes the chosen translation over the selection, Esc closes.
 * Changing either language translates again. The main process owns the selection and the paste
 * (src/services/quick-translate.ts); this page only shows and picks.
 */
import './fonts';
import { languageDisplayName, tHtml } from '@phevere/core/i18n/runtime';
import type { QuickPanelOpen } from './quick-panel-preload';
import { windowLanguageReady } from './ui-language';

/** The interface language is in before the panel builds any text. */
const languageReady = windowLanguageReady();

type Result = { state: 'wait' | 'ok' | 'error'; text: string; detected?: string };

const api = (window as any).quickPanelAPI as {
  onOpen: (cb: (p: QuickPanelOpen) => void) => void;
  translate: (from: string, to: string, provider: string) => Promise<{ text: string; language: string; detected?: string } | null>;
  choose: (text: string) => void;
  cancel: () => void;
  resize: (height: number) => void;
};

const fromEl = document.getElementById('qpFrom') as HTMLSelectElement;
const toEl = document.getElementById('qpTo') as HTMLSelectElement;
const swapEl = document.getElementById('qpSwap') as HTMLButtonElement;
const sourceEl = document.getElementById('qpSource') as HTMLElement;
const listEl = document.getElementById('qpList') as HTMLUListElement;

let providers: QuickPanelOpen['providers'] = [];
let results = new Map<string, Result>();
let active = 0;
let generation = 0;
/** Enter pressed while the active engine was still working: paste as soon as it answers. */
let chooseWhenReady = false;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fillLanguages(languages: QuickPanelOpen['languages'], from: string, to: string): void {
  const opts = (auto: string) =>
    languages
      .map((l) => `<option value="${esc(l.code)}">${l.code === 'auto' ? auto : esc(languageDisplayName(l.code) || l.name)}</option>`)
      .join('');
  fromEl.innerHTML = opts(tHtml('popup.quick.detectLanguage'));
  toEl.innerHTML = opts(tHtml('popup.quick.autoTarget'));
  fromEl.value = from;
  toEl.value = to;
}

function render(): void {
  // The translations are in the target language, which the page's own lang (the interface's) is not.
  const target = toEl.value && toEl.value !== 'auto' ? toEl.value : '';
  listEl.innerHTML = providers
    .map((p, i) => {
      const r = results.get(p.id);
      const body =
        !r || r.state === 'wait'
          ? `<span class="qp-item__text is-wait">${tHtml('popup.quick.translating')}</span>`
          : r.state === 'error'
            ? `<span class="qp-item__text is-error">${tHtml('popup.quick.noTranslation')}</span>`
            : `<span class="qp-item__text"${target ? ` lang="${esc(target)}"` : ''}>${esc(r.text)}</span>`;
      return `<li class="qp-item${i === active ? ' is-active' : ''}" role="option" aria-selected="${i === active}" data-i="${i}"><span class="qp-item__name">${esc(p.label)}</span>${body}</li>`;
    })
    .join('');
  listEl.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  requestAnimationFrame(() => api.resize(Math.ceil((document.getElementById('qp') as HTMLElement).getBoundingClientRect().height)));
}

function choose(): void {
  const p = providers[active];
  const r = p ? results.get(p.id) : undefined;
  if (r?.state === 'ok') {
    chooseWhenReady = false;
    api.choose(r.text);
  } else if (r?.state === 'wait') {
    chooseWhenReady = true;
  }
}

function translateAll(): void {
  const gen = ++generation;
  // The selection's language, once it is known, so the page's lang (the interface's) does not apply to it.
  if (fromEl.value && fromEl.value !== 'auto') sourceEl.lang = fromEl.value;
  else sourceEl.removeAttribute('lang');
  results = new Map(providers.map((p) => [p.id, { state: 'wait', text: '' } as Result]));
  render();
  for (const p of providers) {
    void api
      .translate(fromEl.value, toEl.value, p.id)
      .catch((): null => null)
      .then((hit) => {
        if (gen !== generation) return;
        results.set(p.id, hit?.text ? { state: 'ok', text: hit.text, detected: hit.detected } : { state: 'error', text: '' });
        if (fromEl.value === 'auto' && hit?.detected) sourceEl.lang = hit.detected;
        render();
        if (chooseWhenReady && providers[active]?.id === p.id) choose();
      });
  }
}

function move(step: number): void {
  if (!providers.length) return;
  active = (active + step + providers.length) % providers.length;
  chooseWhenReady = false;
  render();
}

api.onOpen((p) => {
  void languageReady.then(() => {
    providers = p.providers;
    active = 0;
    chooseWhenReady = false;
    sourceEl.textContent = p.text;
    fillLanguages(p.languages, p.from, p.to);
    translateAll();
    listEl.focus();
  });
});

fromEl.addEventListener('change', translateAll);
toEl.addEventListener('change', translateAll);
swapEl.addEventListener('click', () => {
  const detected = [...results.values()].find((r) => r.detected)?.detected || '';
  const from = fromEl.value === 'auto' ? detected : fromEl.value;
  const to = toEl.value;
  if (!from || to === 'auto') return;
  fromEl.value = to;
  toEl.value = from;
  translateAll();
});

listEl.addEventListener('click', (ev) => {
  const item = (ev.target as HTMLElement).closest<HTMLElement>('.qp-item');
  if (!item) return;
  active = Number(item.dataset.i) || 0;
  render();
  choose();
});

document.addEventListener('keydown', (ev) => {
  const inSelect = (ev.target as HTMLElement).tagName === 'SELECT';
  if (ev.key === 'Escape') {
    ev.preventDefault();
    api.cancel();
  } else if (!inSelect && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    ev.preventDefault();
    move(ev.key === 'ArrowDown' ? 1 : -1);
  } else if (!inSelect && ev.key === 'Enter') {
    ev.preventDefault();
    choose();
  }
});
