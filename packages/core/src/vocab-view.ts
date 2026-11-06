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
import { bookName } from './book-names';

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
  /** The learner has books of their own: rows offer "Add to word book". */
  bookPick?: boolean;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4zM15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lookup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bookAdd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5H7.5A2.5 2.5 0 0 1 5 17V4.5h9.5A2.5 2.5 0 0 1 17 7v5M5 17a2.5 2.5 0 0 1 2.5-2.5H12M18 15v6M15 18h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
};

/**
 * "Add to word book": opens the list of the learner's own books (made or imported) with a tick
 * on those that hold the word (hook ub-pick, data-q). `cls` is the button's class in its row.
 */
export function addToBookButtonHtml(lemma: string, cls = 'vocab-open vocab-tobook'): string {
  const q = esc(clean(lemma));
  return `<button type="button" class="${cls}" data-act="ub-pick" data-q="${q}" aria-haspopup="menu" aria-expanded="false" title="Add to word book" aria-label="Add ${q} to a word book">${ICON.bookAdd}</button>`;
}

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

/** The rail letter a word files under; an accented Latin letter files under its base letter. */
export function vocabAzLetter(lemma: string): string {
  const up = (lemma || '').trim().normalize('NFD').charAt(0).toLocaleUpperCase('en');
  return up >= 'A' && up <= 'Z' ? up : '#';
}

/**
 * The A–Z rail's entries. Words that do not start with a Latin letter (digits, symbols, other
 * scripts) share "#", which comes after Z, as in iOS Contacts and Android's contacts index.
 */
export const AZ_INDEX: readonly string[] = [...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)), '#'];

/** A to Z order with the "#" words last, matching the rail. */
export function compareAz(a: string, b: string): number {
  const ha = vocabAzLetter(a) === '#' ? 1 : 0;
  const hb = vocabAzLetter(b) === '#' ? 1 : 0;
  return ha - hb || String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
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

export function vocabEntryHtml(e: VocabViewEntry, open: boolean, now = Date.now(), opts: { bookPick?: boolean } = {}): string {
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
          .map((b) => `<span class="wb-badge" title="${esc(bookName(b)?.title || b)}">${esc(bookName(b)?.short || b)}</span>`)
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
          ${opts.bookPick ? `<button type="button" class="vocab-action vocab-tobook" data-act="ub-pick" data-q="${esc(lemma)}" aria-haspopup="menu" aria-expanded="false">${ICON.bookAdd}<span>Add to word book</span></button>` : ''}
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
      return heading + vocabEntryHtml(e, opts.expanded.has(e.id), now, { bookPick: opts.bookPick });
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
 * pronunciation and part of speech, then Play, Look up, the same save control a lookup has
 * (the heart for My words and, with books of your own, "Add to word book"), and the time.
 * The row itself looks up. The heart saves with wb-save (data-q) and removes with nb-del
 * (data-id), as Google Translate's history rows star a word in place.
 */
/**
 * Recent lookups that contain the search text, in their stored order, the way a browser's
 * history page filters as you type. An empty search keeps every entry.
 */
export function filterRecentLookups(items: RecentLookup[], query: string): RecentLookup[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => clean(item.q).toLowerCase().includes(q));
}

export function recentListHtml(
  items: RecentLookup[],
  saved: (q: string) => VocabViewEntry | undefined,
  now = Date.now(),
  opts: { bookPick?: boolean } = {},
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
      </div></div>
      <span class="vocab-row__end">
        ${playButton(q)}
        ${lookupButton(q)}
        ${e
          ? `<button type="button" class="vocab-open vocab-save is-on" data-act="nb-del" data-id="${esc(e.id)}" aria-pressed="true" title="Remove from My words" aria-label="Remove ${esc(q)} from My words">${ICON.heart}</button>`
          : `<button type="button" class="vocab-open vocab-save" data-act="wb-save" data-q="${esc(q)}" aria-pressed="false" title="Save to My words" aria-label="Save ${esc(q)} to My words">${ICON.heart}</button>`}
        ${opts.bookPick ? addToBookButtonHtml(q) : ''}
        <time class="vocab-when"${item.at ? ` datetime="${new Date(item.at).toISOString()}"` : ''}>${esc(vocabWhen(item.at, now))}</time>
      </span>
    </div>
  </article>`;
    })
    .join('');
}
