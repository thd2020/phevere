/**
 * Notebook rows shared by the desktop window and the phone app. The notebook doubles as a memory
 * check, so a collapsed row shows the word, one pronunciation and the part of speech but never the
 * meaning; expanding it reveals the senses, every pronunciation, the note, sources and actions.
 * Buttons carry both the desktop classes and the phone's `data-act`, so each shell wires them.
 */
import { stripGlossText } from './lookup-policy';
import { formatVocabLangPair } from './vocab-lang';

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
}

export interface VocabListOptions {
  sort: 'recent' | 'az';
  expanded: Set<string>;
  now?: number;
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

function at(e: VocabViewEntry): number {
  const n = Number(e.updatedAt || e.createdAt || 0);
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
  const play = `<button type="button" class="vocab-play" data-act="nb-play" data-lemma="${esc(lemma)}" title="Play pronunciation" aria-label="Play ${esc(lemma)}">${ICON.play}</button>`;
  const head = `<div class="vocab-row__head">
        <h3 class="vocab-lemma">${esc(lemma)}</h3>
        ${readings[0] ? `<span class="vocab-reading">${esc(readings[0].ipa)}</span>` : ''}
        ${posTag(pos)}
        ${langs ? `<span class="vocab-langs">${esc(langs)}</span>` : ''}
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
      ${note ? `<p class="vocab-note">${esc(note)}</p>` : ''}
      <div class="vocab-foot">
        <span class="vocab-provenance">${esc([...(e.sources || []).map(clean).filter(Boolean).slice(0, 3), t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''].filter(Boolean).join(' · '))}</span>
        <span class="vocab-actions">
          <button type="button" class="vocab-action vocab-open" data-act="lookup" data-q="${esc(lemma)}" data-lemma="${esc(lemma)}">${ICON.lookup}<span>Look up</span></button>
          <button type="button" class="vocab-action vocab-remove" data-act="nb-del" data-id="${id}">${ICON.remove}<span>Remove</span></button>
        </span>
      </div>
    </div>`;
  return `<article class="vocab-item ${open ? 'is-expanded' : 'is-collapsed'}" data-id="${id}" data-az="${vocabAzLetter(lemma)}">
    <div class="vocab-entry__toggle" data-act="nb-toggle" data-id="${id}" role="button" tabindex="0" aria-expanded="${open}">
      <div class="vocab-row__main">${head}</div>
      <span class="vocab-row__end">
        ${play}
        <time class="vocab-when" datetime="${t ? new Date(t).toISOString() : ''}">${esc(vocabWhen(t, now))}</time>
        <span class="vocab-chevron" aria-hidden="true">${ICON.chevron}</span>
      </span>
    </div>
    ${details}
  </article>`;
}

/** Rows in the given order, with day headings for the Recent sort. */
export function vocabListHtml(entries: VocabViewEntry[], opts: VocabListOptions): string {
  const now = opts.now ?? Date.now();
  let group = '';
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
