/**
 * Two Lexicon sections shared by the desktop pop-up and the phone: Forms (tenses,
 * participles, plural, cases, degrees, and "plural of mouse") and Word family
 * (derived and related words, phrases, other spellings, and what the word is built from).
 *
 * The family shows the closest members of each group in a line of plain links, the way a
 * printed dictionary runs on its derivatives, with the rest folded under "All N".
 */
import type { InflectionTable, WordInflections } from './inflections';
import type { WordFamilyGroup } from './word-family';
import { wordLinkHtml } from './text-links';

/** How a word links: the phone's `data-act` targets, or the pop-up's `data-lookup` spans. */
export type LexiconLinks = 'act' | 'lookup';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function link(word: string, links: LexiconLinks, inner = esc(word)): string {
  const w = esc(word);
  return links === 'act'
    ? `<button type="button" class="lx-link" data-act="lookup" data-q="${w}">${inner}</button>`
    : wordLinkHtml(word, inner, links, 'lx-link lemma-link');
}

/** A form in a table or row, linked to its own lookup; the stress mark is not part of the query. */
function formLink(f: string, links: LexiconLinks): string {
  const query = f.normalize('NFD').replace(/́/g, '').normalize('NFC');
  if (!/\p{L}/u.test(query)) return formText(f);
  return wordLinkHtml(query, formText(f), links);
}

/**
 * One form as text. Russian and Ukrainian forms mark stress with a combining acute, which
 * the bundled serif cannot place on a Cyrillic letter, so the stressed vowel is set in bold
 * instead, as learner dictionaries do.
 */
function formText(f: string): string {
  if (!/[\u0400-\u04ff]/.test(f)) return esc(f);
  const marked = f
    .normalize('NFD')
    .replace(/([\u0400-\u04ff])\u0301/g, '\u0000$1\u0001')
    .replace(/\u0301/g, '')
    .normalize('NFC');
  return esc(marked).replace(/\u0000(.)\u0001/g, '<b class="lx-stress">$1</b>');
}

function tableHtml(t: InflectionTable, links: LexiconLinks): string {
  const head = t.lemma
    ? `<h4 class="lx-infl__pos">${esc(t.pos)} <span class="lx-infl__of">· forms of ${link(t.lemma, links)}</span></h4>`
    : `<h4 class="lx-infl__pos">${esc(t.pos)}</h4>`;
  const rows = t.rows.length
    ? `<dl class="lx-infl__rows">${t.rows
        .map((r) => {
          const forms = r.forms.map((f, i) => (r.notes?.[i] ? `${formLink(f, links)} <span class="lx-note">${esc(r.notes[i])}</span>` : formLink(f, links)));
          return `<div><dt>${esc(r.label)}</dt><dd>${forms.join('<span class="lx-comma">, </span>')}</dd></div>`;
        })
        .join('')}</dl>`
    : '';
  const grids = t.grids
    .map(
      (g) => `<table class="lx-grid">
        <caption>${esc(g.caption)}</caption>
        <thead><tr><th scope="col"></th>${g.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${g.rows
          .map((r) => `<tr><th scope="row">${esc(r.label)}</th>${r.cells.map((c) => `<td>${c.map((f) => formLink(f, links)).join(', ') || '—'}</td>`).join('')}</tr>`)
          .join('')}</tbody>
      </table>`,
    )
    .join('');
  return `<section class="lx-infl">${head}${rows}${grids}</section>`;
}

/** The Forms section, or '' when there is nothing to show. */
export function inflectionsHtml(infl: WordInflections | null | undefined, word: string, links: LexiconLinks): string {
  if (!infl || (!infl.formOf.length && !infl.tables.length)) return '';
  const formOf = infl.formOf
    .map((f) => {
      const label = f.label === 'form' ? 'a form' : `the ${esc(f.label)}`;
      return `<p class="lx-formof"><i>${esc(word)}</i> is ${label} of ${link(f.lemma, links)}.</p>`;
    })
    .join('');
  return `<div class="lx-forms">${formOf}${infl.tables.map((t) => tableHtml(t, links)).join('')}</div>`;
}

const FAMILY: Array<{ relation: string; label: string; shown: number }> = [
  { relation: 'derived', label: 'Derived words', shown: 12 },
  { relation: 'related', label: 'Related words', shown: 10 },
  { relation: 'alternatives', label: 'Other spellings', shown: 6 },
  { relation: 'phrases', label: 'Phrases', shown: 8 },
  { relation: 'seeAlso', label: 'See also', shown: 8 },
];

function words(items: Array<{ word: string }>, links: LexiconLinks): string {
  return items.map((i) => link(i.word, links)).join('<span class="lx-sep"> · </span>');
}

/** The Word family section, or '' when the word has none. */
export function wordFamilyHtml(groups: WordFamilyGroup[] | null | undefined, links: LexiconLinks): string {
  const byRel = new Map<string, Array<{ word: string }>>();
  for (const g of groups || []) {
    const items = (g.items || []).filter((i) => i && String(i.word || '').trim());
    if (items.length) byRel.set(String(g.relation), [...(byRel.get(String(g.relation)) || []), ...items]);
  }
  const parts: string[] = [];
  const built = [...(byRel.get('affixes') || []), ...(byRel.get('roots') || [])];
  if (built.length) {
    parts.push(`<p class="lx-built"><span class="lx-label">Built from</span> ${words(built.slice(0, 6), links)}</p>`);
  }
  for (const f of FAMILY) {
    const items = byRel.get(f.relation) || [];
    if (!items.length) continue;
    const shown = items.slice(0, f.shown);
    const rest = items.slice(f.shown);
    parts.push(`<div class="lx-fam">
      <h4 class="lx-label">${f.label}${items.length > f.shown ? ` <span class="lx-count">${items.length}</span>` : ''}</h4>
      <p class="lx-words">${words(shown, links)}</p>
      ${rest.length ? `<details class="lx-more"><summary>All ${items.length}</summary><p class="lx-words">${words(rest, links)}</p></details>` : ''}
    </div>`);
  }
  return parts.length ? `<div class="lx-family">${parts.join('')}</div>` : '';
}
