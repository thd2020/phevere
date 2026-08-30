import type { DictionaryResult, VocabEntry } from '@phevere/core';
import { formatPronunciationLine, saveLemma } from '@phevere/core';

function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderLookup(result: DictionaryResult, saved: VocabEntry | null): string {
  const ipa = formatPronunciationLine(result.pronunciations) || result.pronunciation || '';
  const head = esc(result.word || '');
  const lemma = saveLemma(result);
  const savedMark = saved ? 'saved' : '';
  const defs = (result.definitions || [])
    .map((d) => {
      const src = esc((d.sources && d.sources.length ? d.sources.join(' · ') : d.source) || '');
      const examples = (d.examples || []).map((ex) => `<li>${esc(ex)}</li>`).join('');
      return `<article class="sense">
        <div class="sense-meta">
          ${d.partOfSpeech ? `<span class="pos">${esc(d.partOfSpeech)}</span>` : ''}
          ${src ? `<span class="src">${src}</span>` : ''}
        </div>
        <p class="meaning">${esc(d.meaning)}</p>
        ${examples ? `<ul class="examples">${examples}</ul>` : ''}
      </article>`;
    })
    .join('');
  const translations = (result.translations || [])
    .map((t) => `<li><span class="t-lang">${esc(t.language)}</span> ${esc(t.text)}</li>`)
    .join('');
  const family = (result.wordFamily || [])
    .map((g) => {
      const items = (g.items || [])
        .map((it) => `<button type="button" class="chip" data-lookup="${esc(it.word)}">${esc(it.label || it.word)}</button>`)
        .join('');
      return `<div class="family-group"><span class="rel">${esc(g.relation)}</span><div class="chips">${items}</div></div>`;
    })
    .join('');

  return `
    <header class="lookup-head">
      <div>
        <h1>${head}</h1>
        ${ipa ? `<p class="ipa">${esc(ipa)}</p>` : ''}
      </div>
      <button type="button" class="save-btn ${savedMark}" data-lemma="${esc(lemma)}" aria-label="Save to notebook">${saved ? 'Saved' : 'Save'}</button>
    </header>
    ${result.etymology ? `<section class="card"><h2>Etymology</h2><p class="etym">${esc(result.etymology)}</p></section>` : ''}
    ${defs ? `<section class="card"><h2>Senses</h2>${defs}</section>` : '<section class="card empty">No definitions yet.</section>'}
    ${translations ? `<section class="card"><h2>Translation</h2><ul class="translations">${translations}</ul></section>` : ''}
    ${family ? `<section class="card"><h2>Word family</h2>${family}</section>` : ''}
  `;
}

export function renderNotebook(entries: VocabEntry[], sort: 'recent' | 'az'): string {
  const list = [...entries];
  if (sort === 'az') list.sort((a, b) => a.lemma.localeCompare(b.lemma, undefined, { sensitivity: 'base' }));
  if (list.length === 0) return `<p class="empty">Nothing saved yet. Look up a word and tap Save.</p>`;
  return list
    .map((e) => {
      const def = esc((e.definition || '').slice(0, 180));
      return `<article class="vocab-row" data-id="${esc(e.id)}">
        <div>
          <strong>${esc(e.lemma)}</strong>
          ${e.reading ? `<span class="ipa">${esc(e.reading)}</span>` : ''}
          ${def ? `<p>${def}</p>` : ''}
        </div>
        <button type="button" class="linkish" data-lookup="${esc(e.lemma)}">Open</button>
      </article>`;
    })
    .join('');
}
