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

/**
 * A form in a table or row, linked to its own lookup; the stress mark is not part of the query.
 * Only a single word is a link: "more redundant" and "will have gone" are phrases built from other
 * words, not entries, as the Forms tables of Wiktionary and the learner dictionaries print them.
 */
function formLink(f: string, links: LexiconLinks): string {
  const query = f.normalize('NFD').replace(/́/g, '').normalize('NFC');
  if (!/\p{L}/u.test(query) || /\s/u.test(query.trim())) return formText(f);
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

/**
 * The word a form belongs to, linked. Wiktextract names two lemmas in one string ("good and
 * well" for better, "ax and axe" for axes); each is linked on its own and "and" stays text.
 * A lemma of several words with no "and" or "or" ("look up") stays one link.
 */
function lemmaLinks(lemma: string, links: LexiconLinks): string {
  const parts = String(lemma || '').split(/(\s+(?:and|or)\s+|\s*,\s*)/);
  const names = parts.filter((_, i) => i % 2 === 0);
  if (parts.length < 3 || names.some((p) => !p.trim() || /\s/.test(p.trim()))) return link(lemma, links);
  return parts.map((p, i) => (i % 2 ? esc(p) : link(p.trim(), links))).join('');
}

/** The Forms section, or '' when there is nothing to show. */
export function inflectionsHtml(infl: WordInflections | null | undefined, word: string, links: LexiconLinks): string {
  if (!infl || (!infl.formOf.length && !infl.tables.length)) return '';
  const formOf = infl.formOf
    .map((f) => {
      const label = f.label === 'form' ? 'a form' : `the ${esc(f.label)}`;
      return `<p class="lx-formof"><i>${esc(word)}</i> is ${label} of ${lemmaLinks(f.lemma, links)}.</p>`;
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
  const byRel = new Map<string, Array<{ word: string; rare?: boolean }>>();
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
    // In a long list, words with no recorded use ("redundantant") wait under "All".
    const common = items.length > f.shown ? items.filter((i) => !i.rare) : items;
    const shown = (common.length ? common : items).slice(0, f.shown);
    const rest = items.filter((i) => !shown.includes(i));
    parts.push(`<div class="lx-fam">
      <h4 class="lx-label">${f.label}${items.length > f.shown ? ` <span class="lx-count">${items.length}</span>` : ''}</h4>
      <p class="lx-words">${words(shown, links)}</p>
      ${rest.length ? `<details class="lx-more"><summary>All ${items.length}</summary><p class="lx-words">${words(rest, links)}</p></details>` : ''}
    </div>`);
  }
  return parts.length ? `<div class="lx-family">${parts.join('')}</div>` : '';
}

/**
 * A sense's leading labels as dictionaries print them: "(uncountable, politics)" on the
 * definition's own line and in its own type, the labels in italic and the brackets and commas
 * upright, in a quieter colour. This is how Wiktionary renders {{lb}} and close to Oxford
 * Learner's grammar and register labels. `html` is the sense's escaped HTML; only a plain-text
 * bracket at its start is a label.
 */
export function senseLabelLead(html: string): string {
  return String(html || '').replace(/^\s*\(([^()<]{1,80})\)\s*/, (_m, raw: string) => {
    const labels = raw
      .split(/\s*,\s*/)
      .filter(Boolean)
      .map((l) => `<i>${l}</i>`);
    return `<span class="sense-label lx-nolink">(${labels.join(', ')})</span> `;
  });
}

/**
 * Where the senses came from, said once under them as Cambridge, Collins and Dictionary.com do
 * for each dictionary they quote, rather than under every sense: "Definitions from Wiktionary,
 * Free Dictionary and Datamuse". `names` are display names in the senses' order; repeats drop.
 */
export function definitionSourcesHtml(names: string[]): string {
  const list: string[] = [];
  for (const n of names.map((x) => String(x || '').trim())) if (n && !list.includes(n)) list.push(n);
  if (!list.length) return '';
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
  return `<p class="lx-sources">Definitions from ${esc(joined)}</p>`;
}

/**
 * "Did you mean governess?" under a lookup that found nothing, with up to three spellings to
 * try, the closest first, as Oxford and Merriam-Webster offer them instead of guessing.
 */
export function didYouMeanHtml(result: { metadata?: Record<string, unknown> } | null | undefined, links: LexiconLinks): string {
  const raw = result?.metadata?.suggestions;
  // A spelling that only extends an earlier one (governesses, governessy after governess) and a
  // phrase add nothing to the choice.
  const words: string[] = [];
  for (const w of (Array.isArray(raw) ? raw : []).map((x) => String(x || '').trim())) {
    if (!w || /\s/.test(w) || words.some((x) => w.toLowerCase().startsWith(x.toLowerCase()))) continue;
    words.push(w);
    if (words.length === 3) break;
  }
  if (!words.length) return '';
  const linksHtml = words.map((w) => wordLinkHtml(w, esc(w), links, 'lx-link'));
  const list = linksHtml.length > 1 ? `${linksHtml.slice(0, -1).join(', ')} or ${linksHtml[linksHtml.length - 1]}` : linksHtml[0];
  return `<p class="lx-didyoumean">Did you mean ${list}?</p>`;
}

/**
 * "ran /ræn/ · past tense of run", above the entry an irregular form opens. Learner dictionaries
 * give such forms a short entry of their own; here the line says the same and the entry follows.
 */
export function formLineHtml(result: { metadata?: Record<string, unknown> } | null | undefined): string {
  const line = result?.metadata?.formLine as { form?: string; ipa?: string; label?: string } | undefined;
  if (!line?.form || !line.label) return '';
  return `<p class="lx-formline"><span class="lx-formline__form">${esc(line.form)}</span>${
    line.ipa ? `<span class="lx-formline__ipa">${esc(line.ipa)}</span>` : ''
  }<span class="lx-formline__label">${esc(line.label)}</span></p>`;
}
