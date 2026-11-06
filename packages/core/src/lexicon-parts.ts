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
import { linkHtml, wordLinkHtml } from './text-links';
import { isGrammarLabel, type SenseNotes } from './sense-notes';

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

type FamilyItem = { word: string; label?: string; rare?: boolean };

/** One labelled line of links, the closest `shownMax` first and the rest folded under "All N". */
function familyGroupHtml(label: string, items: FamilyItem[], shownMax: number, links: LexiconLinks): string {
  // In a long list, words with no recorded use ("redundantant") wait under "All".
  const common = items.length > shownMax ? items.filter((i) => !i.rare) : items;
  const shown = (common.length ? common : items).slice(0, shownMax);
  const rest = items.filter((i) => !shown.includes(i));
  return `<div class="lx-fam">
      <h4 class="lx-label">${label}${items.length > shownMax ? ` <span class="lx-count">${items.length}</span>` : ''}</h4>
      <p class="lx-words">${words(shown, links)}</p>
      ${rest.length ? `<details class="lx-more"><summary>All ${items.length}</summary><p class="lx-words">${words(rest, links)}</p></details>` : ''}
    </div>`;
}

function familyByRelation(groups: WordFamilyGroup[] | null | undefined): Map<string, FamilyItem[]> {
  const byRel = new Map<string, FamilyItem[]>();
  for (const g of groups || []) {
    const items = (g.items || []).filter((i) => i && String(i.word || '').trim());
    if (items.length) byRel.set(String(g.relation), [...(byRel.get(String(g.relation)) || []), ...items]);
  }
  return byRel;
}

/**
 * The Word family section, or '' when the word has none. With `phrases: false` the phrases are
 * left to their own section (phrasesHtml).
 */
export function wordFamilyHtml(groups: WordFamilyGroup[] | null | undefined, links: LexiconLinks, opts: { phrases?: boolean } = {}): string {
  const byRel = familyByRelation(groups);
  const parts: string[] = [];
  const built = [...(byRel.get('affixes') || []), ...(byRel.get('roots') || [])];
  if (built.length) {
    parts.push(`<p class="lx-built"><span class="lx-label">Built from</span> ${words(built.slice(0, 6), links)}</p>`);
  }
  for (const f of FAMILY) {
    if (f.relation === 'phrases' && opts.phrases === false) continue;
    const items = byRel.get(f.relation) || [];
    if (items.length) parts.push(familyGroupHtml(f.label, items, f.shown, links));
  }
  return parts.length ? `<div class="lx-family">${parts.join('')}</div>` : '';
}

/** The adverbs and prepositions a phrasal verb is built with ("give up", "look forward to"). */
const PARTICLES = new Set(
  ('about above across after against ahead along apart around aside at away back behind by down for forth forward ' +
    'from in into of off on onto out over past round through to together under up upon with without').split(' '),
);

/**
 * The Phrases section, as learner dictionaries give phrasal verbs and idioms a section of their
 * own after the senses: phrasal verbs (the verb and its particles), idioms and proverbs, and the
 * other set phrases with the word. '' when the word has none. `verb` says whether the word has
 * verb senses, so "run up" is a phrasal verb and "front up" under the noun front is not.
 */
export function phrasesHtml(groups: WordFamilyGroup[] | null | undefined, links: LexiconLinks, headword: string, verb: boolean): string {
  const items = familyByRelation(groups).get('phrases') || [];
  if (!items.length) return '';
  const head = String(headword || '').trim().toLowerCase();
  const phrasal: FamilyItem[] = [];
  const idioms: FamilyItem[] = [];
  const other: FamilyItem[] = [];
  for (const it of items) {
    const parts = it.word.trim().toLowerCase().split(/\s+/);
    if (/idiom|proverb/i.test(it.label || '')) idioms.push(it);
    else if (verb && parts.length > 1 && parts[0] === head && parts.slice(1).every((w) => PARTICLES.has(w))) phrasal.push(it);
    else other.push(it);
  }
  const out = [
    phrasal.length ? familyGroupHtml('Phrasal verbs', phrasal, 12, links) : '',
    idioms.length ? familyGroupHtml('Idioms', idioms, 10, links) : '',
    other.length ? familyGroupHtml(phrasal.length || idioms.length ? 'Other phrases' : 'Phrases', other, 12, links) : '',
  ].join('');
  return `<div class="lx-family lx-phrases">${out}</div>`;
}

/** A grammar note that names a pattern ("with on or upon", "+ to-infinitive"): its words are set bold. */
const PATTERN_NOTE = /^(?:with|\+|followed by|construed with|used with|takes?)\b/i;
/** The words of a pattern note that are not the pattern itself. */
const PATTERN_PLAIN = new Set(
  ('with or and also formerly usually often sometimes chiefly mainly mostly especially typically generally now rarely ' +
    'followed by construed used take takes a an the + object infinitive to-infinitive bare gerund clause noun verb ' +
    'preposition pronoun adjective adverb phrase direct indirect plural singular that-clause').split(' '),
);

function grammarNoteHtml(note: string): string {
  if (!PATTERN_NOTE.test(note)) return esc(note);
  return note
    .split(/(\s+|,)/)
    .map((w) => (!w.trim() || w === ',' || PATTERN_PLAIN.has(w.toLowerCase()) ? esc(w) : `<b>${esc(w)}</b>`))
    .join('');
}

/** The sense fields this file reads. */
export type SenseNoteFields = SenseNotes;

/**
 * A sense's grammar codes and labels as learner dictionaries print them, before the gloss on its
 * own line. Grammar comes first in square brackets, upright: "[countable]", "[intransitive; with
 * on or upon]", the words of a pattern in bold, as Oxford Learner's and Longman set them. Usage
 * labels follow in round brackets, the labels in italic: "(informal, chiefly UK)", as Wiktionary
 * and Oxford set register, region and subject. `hide` names codes the part-of-speech heading
 * already gives ("[uncountable]" on the noun heading of advice).
 *
 * `html` is the sense's escaped HTML. A plain-text bracket at its start is a label too, as the
 * Free Dictionary writes them ("(transitive) To…"); one that only repeats the notes is dropped.
 */
export function senseLabelLead(html: string, notes?: SenseNoteFields | null, hide: string[] = []): string {
  let rest = String(html || '');
  const grammar = [...(notes?.grammar || [])];
  const labels = [...(notes?.labels || [])];
  const known = new Set([...grammar, ...labels].map((x) => x.toLowerCase()));
  const lead = /^\s*\(([^()<]{1,80})\)\s*/.exec(rest);
  if (lead) {
    // "(with on or upon, formerly also with in)" may be one note with a comma of its own.
    const whole = lead[1].trim().toLowerCase();
    const repeats = known.has(whole) || [...known].join(', ') === whole;
    const items = repeats ? [] : lead[1].split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
    rest = rest.slice(lead[0].length);
    for (const item of items) {
      if (known.has(item.toLowerCase())) continue;
      // Already escaped: it goes in as it is.
      (isGrammarLabel(item) ? grammar : labels).push(item);
      known.add(item.toLowerCase());
    }
  }
  const hidden = new Set(hide.map((h) => h.toLowerCase()));
  const codes = grammar.filter((g) => !hidden.has(g.toLowerCase()));
  const fromNotes = new Set([...(notes?.grammar || []), ...(notes?.labels || [])]);
  const text = (x: string) => (fromNotes.has(x) ? esc(x) : x);
  let out = '';
  if (codes.length) {
    const inner = codes.map((g, i) => `${i ? (PATTERN_NOTE.test(g) || g.includes(',') ? '; ' : ', ') : ''}${fromNotes.has(g) ? grammarNoteHtml(g) : g}`).join('');
    out += `<span class="sense-gram lx-nolink">[${inner}]</span> `;
  }
  if (labels.length) out += `<span class="sense-label lx-nolink">(${labels.map((l) => `<i>${text(l)}</i>`).join(', ')})</span> `;
  return out + rest;
}

/**
 * Synonyms, opposites and collocations under a sense, one labelled line each, as Oxford
 * Learner's prints "SYN" and "OPP" under a definition and Longman its collocations. The words
 * link to their own lookups; in a collocation the looked-up word is set bold. '' when the sense
 * has none.
 */
export function senseNotesHtml(notes: SenseNoteFields | null | undefined, links: LexiconLinks, headword = ''): string {
  if (!notes) return '';
  const line = (label: string, inner: string, cls = '') =>
    `<p class="sense-notes__line${cls}"><span class="sense-notes__k">${label}</span> ${inner}</p>`;
  const list = (xs: string[] | undefined) => (xs || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8);
  const syn = list(notes.synonyms);
  const ant = list(notes.antonyms);
  const coll = list(notes.collocations).slice(0, 4);
  const head = String(headword || '').trim().toLowerCase();
  const stem = head && !/\s/.test(head) ? head.slice(0, Math.max(3, head.length - 2)) : '';
  const bold = (phrase: string) =>
    phrase
      .split(/(\s+)/)
      .map((w) => (stem && w.toLowerCase().replace(/[^\p{L}'-]/gu, '').startsWith(stem) ? `<b>${esc(w)}</b>` : esc(w)))
      .join('');
  const lines = [
    syn.length ? line(syn.length > 1 ? 'Synonyms' : 'Synonym', words(syn.map((word) => ({ word })), links)) : '',
    ant.length ? line(ant.length > 1 ? 'Opposites' : 'Opposite', words(ant.map((word) => ({ word })), links)) : '',
    coll.length ? line('Collocations', coll.map((c) => `<span class="sense-notes__coll">${linkHtml(bold(c), links)}</span>`).join('<span class="lx-sep"> · </span>')) : '',
  ].join('');
  return lines ? `<div class="sense-notes">${lines}</div>` : '';
}

/**
 * The countability a part of speech has as a whole, after its heading: "noun [uncountable]", as
 * Oxford Learner's prints it when every sense shares it. Nothing when the senses differ
 * ("countable and uncountable"); those carry their own. Returns the HTML and the code the
 * senses then need not repeat.
 */
export function posGrammarHtml(codes: string[] | null | undefined): { html: string; hide: string[] } {
  const list = (codes || []).filter(Boolean);
  if (list.length !== 1) return { html: '', hide: [] };
  return { html: `<span class="lx-poscode">[${esc(list[0])}]</span>`, hide: list };
}

/**
 * The languages Wiktionary has the word in: a row of buttons under the headword that opens the
 * word in another language, as Wiktionary's contents list leads to each language's section.
 * English comes first, then the language shown, then the rest in the page's order; past the
 * first seven the rest fold under "+N", unless `fold` is false (the phone's row scrolls
 * sideways instead). '' for a word in one language only.
 */
export function languageSwitchHtml(
  result: { word?: string; languages?: Array<{ code: string; name: string; current?: boolean }> } | null | undefined,
  links: LexiconLinks,
  opts: { fold?: boolean } = {},
): string {
  const langs = (result?.languages || []).filter((l) => l && l.code && l.name);
  if (langs.length < 2 || !langs.some((l) => l.current)) return '';
  const rank = (l: { code: string; current?: boolean }) => (l.code === 'en' ? 0 : l.current ? 1 : 2);
  const ordered = langs
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i)
    .map((x) => x.l);
  const word = esc(result?.word || '');
  const chip = (l: { code: string; name: string; current?: boolean }) => {
    if (l.current) return `<span class="lx-lang is-current" aria-current="true">${esc(l.name)}</span>`;
    const target = links === 'act' ? `data-act="lookup-lang" data-q="${word}" data-lang="${esc(l.code)}"` : `data-lookup-lang="${esc(l.code)}" data-q="${word}"`;
    return `<button type="button" class="lx-lang" ${target}>${esc(l.name)}</button>`;
  };
  const shown = opts.fold !== false && ordered.length > 8 ? ordered.slice(0, 7) : ordered;
  const rest = ordered.slice(shown.length);
  const more = rest.length
    ? `<details class="lx-langs__all"><summary class="lx-lang">+${rest.length}</summary><div class="lx-langs__rest">${rest.map(chip).join('')}</div></details>`
    : '';
  return `<nav class="lx-langs" aria-label="Languages">${shown.map(chip).join('')}${more}</nav>`;
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
