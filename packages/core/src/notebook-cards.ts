/** Cards view: a picture, the word split into its parts, the note, and the meaning on the back. */
import { vocabReadings, vocabSenses } from './vocab-view';
import { clean, esc, type NotebookAnalysis, type NotebookEntry } from './notebook-shared';

export function cardsHtml(entries: NotebookEntry[], a: NotebookAnalysis, flipped: Set<string>): string {
  if (!entries.length) return `<p class="nbv-empty">No saved words.</p>`;
  return `<div class="nbv-cards">${entries
    .map((e) => {
      const w = a.words.get(e.id);
      const lemma = clean(e.lemma);
      const reading = vocabReadings(e.reading)[0];
      const senses = vocabSenses(e.definition).slice(0, 3);
      const morphs = (w?.morphs || []).filter((m) => m.kind !== 'char' || m.gloss);
      const parts = w && w.parts.length > 1 ? w.parts : [];
      const note = clean(e.note);
      const open = flipped.has(e.id);
      return `<article class="nbv-card${open ? ' is-flipped' : ''}" data-id="${esc(e.id)}">
        <div class="nbv-card__pic" data-img-lemma="${esc(lemma)}" data-img-lang="${esc(clean(e.sourceLang))}" data-img-gloss="${esc(senses[0] || '')}" aria-hidden="true"><span>${esc(lemma.charAt(0))}</span></div>
        <div class="nbv-card__body" data-act="nb-flip" data-id="${esc(e.id)}" role="button" tabindex="0" aria-pressed="${open}">
          <h3 class="nbv-card__word">${parts.length ? parts.map((p, i) => `<span>${esc(p)}</span>${i < parts.length - 1 ? '<i>·</i>' : ''}`).join('') : esc(lemma)}</h3>
          ${reading ? `<p class="nbv-card__ipa">${esc(reading.ipa)}</p>` : ''}
          ${morphs.length ? `<ul class="nbv-card__morphs">${morphs
            .map((m) => `<li><span class="nbv-morph nbv-morph--${m.kind}">${esc(m.label)}</span>${esc(m.gloss)}</li>`)
            .join('')}</ul>` : ''}
          ${note ? `<p class="nbv-card__note">${esc(note)}</p>` : ''}
          <div class="nbv-card__back">${senses.length ? `<ol>${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p>No definition saved.</p>'}</div>
          <span class="nbv-card__flip">${open ? 'Hide meaning' : 'Show meaning'}</span>
        </div>
      </article>`;
    })
    .join('')}</div>`;
}
