/**
 * Translation language choice in the pattern of Google Translate / DeepL mobile: a language
 * bar with two buttons and a swap, and a full-height sheet with search, recent and all
 * languages. In-page (not <select>): the pop-up is a WebView in an overlay window, where
 * Android cannot open a native select list.
 */
export type LangSide = 'from' | 'to';
export type Lang = { code: string; name: string; nativeName: string };

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>';
const SWAP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.99 11 3 15l3.99 4v-3H14v-2H6.99zM21 9l-3.99-4v3H10v2h7.01v3z"/></svg>';

function label(langs: Lang[], code: string): string {
  const l = langs.find((x) => x.code === code);
  return l ? (l.code === 'auto' ? 'Detect language' : l.nativeName) : code;
}

export function langBarHtml(langs: Lang[], from: string, to: string): string {
  return `<div class="lang-bar">
    <button type="button" class="lang-bar__side" data-act="pick-open" data-picker="from" aria-haspopup="dialog" aria-label="Translate from: ${esc(label(langs, from))}">${esc(label(langs, from))}</button>
    <button type="button" class="lang-bar__swap" data-act="swap" aria-label="Swap languages" ${from === 'auto' ? 'disabled' : ''}>${SWAP}</button>
    <button type="button" class="lang-bar__side" data-act="pick-open" data-picker="to" aria-haspopup="dialog" aria-label="Translate to: ${esc(label(langs, to))}">${esc(label(langs, to))}</button>
  </div>`;
}

export function langSheetHtml(side: LangSide, langs: Lang[], selected: string, recent: string[]): string {
  const choices = langs.filter((l) => side === 'from' || l.code !== 'auto');
  const row = (l: Lang) => {
    const on = l.code === selected;
    const title = l.code === 'auto' ? 'Detect language' : l.nativeName;
    const sub = l.code === 'auto' ? '' : l.name;
    return `<button type="button" role="option" aria-selected="${on}" class="lang-row${on ? ' is-on' : ''}" data-act="pick" data-picker="${side}" data-value="${esc(l.code)}" data-search="${esc(`${l.nativeName} ${l.name} ${l.code}`.toLowerCase())}">
      <span class="lang-row__text"><span>${esc(title)}</span>${sub && sub !== title ? `<small>${esc(sub)}</small>` : ''}</span>
      ${on ? `<span class="lang-row__check">${CHECK}</span>` : ''}
    </button>`;
  };
  const recentRows = recent
    .map((code) => choices.find((l) => l.code === code))
    .filter((l): l is Lang => !!l && l.code !== 'auto');
  return `<div class="lang-sheet" role="dialog" aria-modal="true" aria-label="${side === 'from' ? 'Translate from' : 'Translate to'}">
    <div class="lang-sheet__head">
      <button type="button" class="icon-btn" data-act="pick-close" aria-label="Close">${BACK}</button>
      <h2>${side === 'from' ? 'Translate from' : 'Translate to'}</h2>
    </div>
    <input id="lang-q" class="lang-sheet__search" type="search" placeholder="Search languages" autocomplete="off" />
    <div class="lang-sheet__list" role="listbox">
      ${side === 'from' ? row(choices.find((l) => l.code === 'auto') || { code: 'auto', name: 'Auto', nativeName: 'Auto' }) : ''}
      ${recentRows.length ? `<h3 class="lang-sheet__section">Recent languages</h3>${recentRows.map(row).join('')}` : ''}
      <h3 class="lang-sheet__section">All languages</h3>
      ${choices.filter((l) => l.code !== 'auto').map(row).join('')}
    </div>
  </div>`;
}
