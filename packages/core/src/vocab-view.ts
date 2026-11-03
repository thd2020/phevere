/**
 * Notebook rows shared by the desktop window and the phone app. The notebook doubles as a memory
 * check, so a collapsed row shows the word, one pronunciation and the part of speech but never the
 * meaning; expanding it reveals the senses, every pronunciation, the note, sources and Remove.
 * Play and Look up sit at the end of every row, collapsed or not. Recent lookups use the same
 * row, so both lists read alike. Buttons carry `data-act`, which each shell wires.
 */
import { stripGlossText } from './lookup-policy';
import { formatVocabLangPair } from './vocab-lang';
import { findWordInSentence, siteOf, type SourceContext } from './source-context';
import { WORDBOOK_CATALOG } from './wordbook-catalog';

const BOOK_NAMES = new Map(WORDBOOK_CATALOG.map((b) => [b.id, b]));

export interface VocabViewEntry {
  id: string;
  lemma: string;
  reading?: string | null;
  definition?: string | null;
  partOfSpeech?: string | null;
  sourceLang?: string | null;
  targetLang?: string | null;
  sources?: string[] | null;
  note?: string | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
  /** The device the word was first saved on. */
  device?: string | null;
  /** Where the word was first saved (source-context.ts). */
  context?: SourceContext | null;
  reviewDue?: number | null;
  reps?: number | null;
  /** Subscribed word books that list the word, shown as small badges. */
  books?: string[] | null;
}

export interface VocabListOptions {
  sort: 'recent' | 'az';
  expanded: Set<string>;
  now?: number;
  /** Day heading already shown above these rows, when a long list is rendered in chunks. */
  afterGroup?: string;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4zM15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lookup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Senses shown before "Show more". */
const SENSES_SHOWN = 4;

const POS_SHORT: Record<string, string> = {
  noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', preposition: 'prep.', pronoun: 'pron.',
  conjunction: 'conj.', interjection: 'interj.', determiner: 'det.', article: 'art.', numeral: 'num.',
  phrase: 'phr.', idiom: 'idiom', abbreviation: 'abbr.', prefix: 'prefix', suffix: 'suffix',
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function clean(s: unknown): string {
  const t = String(s ?? '').trim();
  return t === 'null' || t === 'None' || t === 'undefined' ? '' : t;
}

/** "US /tʃɝn/ · UK /tʃɜːn/ · /tʃɜː(ɹ)n/" as labelled transcriptions, duplicates dropped. */
export function vocabReadings(reading: unknown): Array<{ label: string; ipa: string }> {
  const out: Array<{ label: string; ipa: string }> = [];
  const seen = new Set<string>();
  for (const part of clean(reading).split(/\s*[·•|]\s*|\s{2,}(?=(?:US|UK)\b)/)) {
    const m = part.trim().match(/^(US|UK|AU|CA)?\s*(.*)$/i);
    if (!m) continue;
    let ipa = m[2].trim().replace(/^\/+|\/+$/g, '');
    if (!ipa) continue;
    ipa = `/${ipa}/`;
    const key = ipa.replace(/[͜͡]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: (m[1] || '').toUpperCase(), ipa });
  }
  return out;
}

/** One sense per line of the saved definition, markup and duplicates removed. */
export function vocabSenses(definition: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of clean(definition).split(/\n+/)) {
    const sense = stripGlossText(line).replace(/^\d+[.)]\s*/, '');
    const key = sense.toLowerCase();
    if (!sense || seen.has(key)) continue;
    seen.add(key);
    out.push(sense);
  }
  return out;
}

/** When the word was saved. Reviews and sync bump updatedAt, which must not reorder the list. */
function at(e: VocabViewEntry): number {
  const n = Number(e.createdAt || e.updatedAt || 0);
  return Number.isFinite(n) ? n : 0;
}

function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Heading for the Recent sort. */
export function vocabDayGroup(t: number, now = Date.now()): string {
  if (!t) return 'Earlier';
  const days = Math.round((dayStart(now) - dayStart(t)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

/** Short time at the end of a row: a clock time today, a weekday this week, otherwise a date. */
export function vocabWhen(t: number, now = Date.now()): string {
  if (!t) return '';
  const d = new Date(t);
  const days = Math.round((dayStart(now) - dayStart(t)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

export function vocabAzLetter(lemma: string): string {
  const up = (lemma || '').trim().charAt(0).toLocaleUpperCase('en');
  return up >= 'A' && up <= 'Z' ? up : '#';
}

function posTag(pos: string): string {
  if (!pos) return '';
  const short = POS_SHORT[pos.toLowerCase()] || pos;
  return `<span class="vocab-pos" title="${esc(pos)}">${esc(short)}</span>`;
}

function playButton(lemma: string): string {
  return `<button type="button" class="vocab-play" data-act="nb-play" data-lemma="${esc(lemma)}" title="Play pronunciation" aria-label="Play ${esc(lemma)}">${ICON.play}</button>`;
}

function lookupButton(lemma: string): string {
  return `<button type="button" class="vocab-open" data-act="lookup" data-q="${esc(lemma)}" data-lemma="${esc(lemma)}" title="Look up" aria-label="Look up ${esc(lemma)}">${ICON.lookup}</button>`;
}

/** When the next review is, in words: "Due now", "Tomorrow", "In 5 days". */
function dueIn(due: number, now: number): string {
  const day = (x: number) => {
    const d = new Date(x);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((day(due) - day(now)) / 86_400_000);
  if (days <= 0) return 'Due now';
  if (days === 1) return 'Tomorrow';
  return days < 60 ? `In ${days} days` : `In ${Math.round(days / 30)} months`;
}

/** Saved when and on which device, where the senses came from, and where review stands. */
/**
 * Where the word was saved, as Kindle's Vocabulary Builder and Readlang show it: the book or page
 * title, the page number, and the site, linked to the page when there is an address. The app is
 * named only when there is nothing better.
 */
export function sourceFactHtml(ctx: SourceContext | null | undefined): string {
  if (!ctx) return '';
  const site = siteOf(ctx.url);
  const name = clean(ctx.doc) || clean(ctx.title) || site || clean(ctx.app);
  if (!name) return '';
  const label = ctx.url ? `<a href="${esc(ctx.url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>` : esc(name);
  const extra: string[] = [];
  if (ctx.page) extra.push(`p. ${ctx.page}`);
  if (site && name !== site && !ctx.doc) extra.push(site);
  else if (!ctx.url && !ctx.doc && ctx.app && name !== clean(ctx.app)) extra.push(clean(ctx.app));
  return `${label}${extra.map((x) => `<span class="vocab-source__more">${esc(x)}</span>`).join('')}`;
}

/** The captured sentence as a quote, with the saved word (or the form used there) marked. */
export function sourceSentenceHtml(ctx: SourceContext | null | undefined, lemma: string): string {
  const s = clean(ctx?.sentence);
  if (!s) return '';
  const at = findWordInSentence(s, lemma);
  const body = at ? `${esc(s.slice(0, at.index))}<mark>${esc(s.slice(at.index, at.index + at.length))}</mark>${esc(s.slice(at.index + at.length))}` : esc(s);
  return `<blockquote class="vocab-context">${body}</blockquote>`;
}

function factsHtml(e: VocabViewEntry, t: number, now: number): string {
  const facts: Array<[string, string]> = [];
  if (t) facts.push(['Saved', esc(new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))]);
  const source = sourceFactHtml(e.context);
  if (source) facts.push(['Source', source]);
  const device = clean(e.device);
  if (device) facts.push(['On', esc(device)]);
  const sources = (e.sources || []).map(clean).filter(Boolean).slice(0, 3);
  if (sources.length) facts.push(['Dictionary', esc(sources.join(', '))]);
  const reps = Number(e.reps || 0);
  if (e.reviewDue != null && reps > 0) facts.push(['Review', esc(`${dueIn(Number(e.reviewDue), now)}, ${reps} ${reps === 1 ? 'review' : 'reviews'} so far`)]);
  else facts.push(['Review', 'New']);
  return `<dl class="vocab-facts">${facts.map(([k, v]) => `<div${k === 'Source' ? ' class="vocab-source"' : ''}><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

export function vocabEntryHtml(e: VocabViewEntry, open: boolean, now = Date.now()): string {
  const lemma = clean(e.lemma);
  const readings = vocabReadings(e.reading);
  const senses = vocabSenses(e.definition);
  const pos = clean(e.partOfSpeech);
  const note = clean(e.note);
  const t = at(e);
  // The language pair only matters for a translation.
  const pair = formatVocabLangPair({
    sourceLang: clean(e.sourceLang) || undefined,
    targetLang: clean(e.targetLang) || undefined,
    definition: clean(e.definition),
    sources: e.sources || [],
  });
  const [from, to] = pair.split(/\s*→\s*/);
  const langs = from && to && from !== to ? pair : '';
  const id = esc(e.id);
  const play = playButton(lemma);
  const head = `<div class="vocab-row__head">
        <h3 class="vocab-lemma">${esc(lemma)}</h3>
        ${readings[0] ? `<span class="vocab-reading">${esc(readings[0].ipa)}</span>` : ''}
        ${posTag(pos)}
        ${langs ? `<span class="vocab-langs">${esc(langs)}</span>` : ''}
        ${e.books?.length ? `<span class="wb-badges">${e.books
          .map((b) => `<span class="wb-badge" title="${esc(BOOK_NAMES.get(b)?.title || b)}">${esc(BOOK_NAMES.get(b)?.short || b)}</span>`)
          .join('')}</span>` : ''}
      </div>`;
  const more = senses.length > SENSES_SHOWN;
  const details = `<div class="vocab-entry__details">
      ${readings.length ? `<div class="vocab-ipas">${readings
        .map((r) => `<span class="vocab-ipa-chip">${r.label ? `<b>${esc(r.label)}</b>` : ''}${esc(r.ipa)}</span>`)
        .join('')}</div>` : ''}
      ${senses.length
        ? `<ol class="vocab-def vocab-senses${more ? ' is-clamped' : ''}">${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${more
          ? `<button type="button" class="vocab-more btn-link" data-act="nb-more">Show more</button>` : ''}`
        : '<p class="vocab-empty-def">No definition saved.</p>'}
      ${sourceSentenceHtml(e.context, lemma)}
      ${note ? `<p class="vocab-note">${esc(note)}</p>` : ''}
      <div class="vocab-foot">
        ${factsHtml(e, t, now)}
        <span class="vocab-actions">
          <button type="button" class="vocab-action vocab-remove" data-act="nb-del" data-id="${id}">${ICON.remove}<span>Remove</span></button>
        </span>
      </div>
    </div>`;
  return `<article class="vocab-item ${open ? 'is-expanded' : 'is-collapsed'}" data-id="${id}" data-az="${vocabAzLetter(lemma)}">
    <div class="vocab-entry__toggle" data-act="nb-toggle" data-id="${id}" role="button" tabindex="0" aria-expanded="${open}">
      <div class="vocab-row__main">${head}</div>
      <span class="vocab-row__end">
        ${play}
        ${lookupButton(lemma)}
        <time class="vocab-when" datetime="${t ? new Date(t).toISOString() : ''}">${esc(vocabWhen(t, now))}</time>
        <span class="vocab-chevron" aria-hidden="true">${ICON.chevron}</span>
      </span>
    </div>
    ${details}
  </article>`;
}

/** Day heading the Recent sort puts above this entry. */
export function vocabEntryGroup(e: VocabViewEntry, now = Date.now()): string {
  return vocabDayGroup(at(e), now);
}

/** Rows in the given order, with day headings for the Recent sort. */
export function vocabListHtml(entries: VocabViewEntry[], opts: VocabListOptions): string {
  const now = opts.now ?? Date.now();
  let group = opts.afterGroup || '';
  return entries
    .map((e) => {
      let heading = '';
      if (opts.sort === 'recent') {
        const g = vocabDayGroup(at(e), now);
        if (g !== group) {
          group = g;
          heading = `<h4 class="vocab-group">${esc(g)}</h4>`;
        }
      }
      return heading + vocabEntryHtml(e, opts.expanded.has(e.id), now);
    })
    .join('');
}

export interface RecentLookup {
  q: string;
  /** Milliseconds since epoch; 0 when an old entry kept only a clock time. */
  at: number;
}

/**
 * Recent lookups as notebook rows: the word, and when it is in the notebook its first
 * pronunciation and part of speech, then Play, Look up and the time. The row itself looks up.
 */
export function recentListHtml(
  items: RecentLookup[],
  saved: (q: string) => VocabViewEntry | undefined,
  now = Date.now(),
): string {
  let group = '';
  return items
    .map((item) => {
      const q = clean(item.q);
      if (!q) return '';
      const g = vocabDayGroup(item.at, now);
      const heading = g !== group ? `<h4 class="vocab-group">${esc(g)}</h4>` : '';
      group = g;
      const e = saved(q);
      const reading = e ? vocabReadings(e.reading)[0] : undefined;
      const pos = e ? clean(e.partOfSpeech) : '';
      return `${heading}<article class="vocab-item recent-item is-collapsed${e ? ' is-saved' : ''}" data-q="${esc(q)}">
    <div class="vocab-entry__toggle" data-act="lookup" data-q="${esc(q)}" role="button" tabindex="0" aria-label="Look up ${esc(q)}">
      <div class="vocab-row__main"><div class="vocab-row__head">
        <h3 class="vocab-lemma">${esc(q)}</h3>
        ${reading ? `<span class="vocab-reading">${esc(reading.ipa)}</span>` : ''}
        ${posTag(pos)}
        ${e ? '<span class="vocab-saved-mark" title="In notebook" aria-label="In notebook"></span>' : ''}
      </div></div>
      <span class="vocab-row__end">
        ${playButton(q)}
        ${lookupButton(q)}
        <time class="vocab-when"${item.at ? ` datetime="${new Date(item.at).toISOString()}"` : ''}>${esc(vocabWhen(item.at, now))}</time>
      </span>
    </div>
  </article>`;
    })
    .join('');
}
