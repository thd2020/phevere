/**
 * The sections a morpheme page adds to the Lexicon, shared by the desktop pop-up and the
 * phone: what the part is and where it comes from (for a classical root, the Latin or Greek
 * word and its principal parts, and the PIE root), the learner's own words built on it
 * (My words first, then word books), the words built on it commonest first, related parts,
 * and for a PIE root its descendants. A plain word that also spells a part ("con", "form")
 * gets a link to that part's page under its headword.
 */
import { analyzeMorphemes, morphBreakdown } from './morphology';
import { cachedEtymon } from './notebook-etymology';
import { warmCmuIpa } from './cmu-ipa';
import { morphemeOf, morphemeOffers, morphemeKindLabel, parseMorphemeQuery, partInWord, type MorphemeEntry } from './morpheme';
import { linkText, wordLinkHtml } from './text-links';
import type { LexiconLinks } from './lexicon-parts';
import { t, tHtml } from './i18n/runtime';

export interface MorphemeSection {
  id: string;
  label: string;
  html: string;
}

/** The learner's words: saved ones and the words of the books they follow. */
export interface OwnWords {
  mine: string[];
  books: string[];
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function link(word: string, links: LexiconLinks, inner = esc(word)): string {
  return wordLinkHtml(word, inner, links, 'lx-link');
}

function wordLine(items: string[], links: LexiconLinks, shown: number, inner?: (w: string) => string): string {
  const html = (list: string[]) =>
    list.map((w) => link(w, links, inner ? inner(w) : esc(w))).join('<span class="lx-sep"> · </span>');
  const head = items.slice(0, shown);
  const rest = items.slice(shown);
  return `<p class="lx-words">${html(head)}</p>${
    rest.length ? `<details class="lx-more"><summary>${tHtml('lexicon.list.all', { count: items.length })}</summary><p class="lx-words">${html(rest)}</p></details>` : ''
  }`;
}

/**
 * Whether a word is built on the part: by Phevere's morpheme analysis with the word's traced
 * origin, by its traced PIE root, or because the sources list it as built on the part.
 */
export function containsMorpheme(entry: MorphemeEntry, word: string): boolean {
  const w = String(word || '').trim().toLowerCase();
  if (!w || w === entry.bare.toLowerCase()) return false;
  if (entry.groups.some((g) => g.derived.some((d) => d.toLowerCase() === w))) return true;
  if (entry.kind === 'reconstructed') return !!cachedEtymon(w)?.roots.includes(entry.form);
  return partInWord(entry, w, cachedEtymon(w));
}

/** "ob·struct" when the tables can split the word, else the word. */
function breakdown(word: string): string {
  const parts = morphBreakdown(word, analyzeMorphemes(word, cachedEtymon(word.toLowerCase())));
  return parts.length > 1 ? parts.map(esc).join('<span class="lx-dot">·</span>') : esc(word);
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((w) => {
    const k = w.toLowerCase();
    if (!w || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The PIE roots most of the learner's words with this classical root trace back to. */
function deepRoots(words: string[]): string[] {
  const count = new Map<string, number>();
  for (const w of words) for (const r of cachedEtymon(w)?.roots || []) count.set(r, (count.get(r) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => r);
}

/**
 * Each page's sections, kept while the same words are passed in: matching 20,000 book words
 * takes a noticeable fraction of a second, and a lookup repaints many times.
 */
const cache = new WeakMap<object, { sig: string; out: MorphemeSection[] }>();

function signature(own: OwnWords, links: LexiconLinks): string {
  const m = own.mine || [];
  const b = own.books || [];
  return `${links}|${m.length}|${m[0] || ''}|${m[m.length - 1] || ''}|${b.length}|${b[0] || ''}|${b[b.length - 1] || ''}`;
}

/** The Lexicon sections of a morpheme page; [] for an ordinary word. */
export function morphemeSections(
  result: { metadata?: Record<string, any> } | null | undefined,
  own: OwnWords,
  links: LexiconLinks,
): MorphemeSection[] {
  const entry = morphemeOf(result);
  if (!entry) return [];
  const sig = signature(own, links);
  const hit = cache.get(entry);
  if (hit && hit.sig === sig) return hit.out;
  // A suffix needs a whole word in front of it, which the pronouncing dictionary knows.
  warmCmuIpa();
  const out = buildSections(entry, own, links);
  cache.set(entry, { sig, out });
  return out;
}

function buildSections(entry: MorphemeEntry, own: OwnWords, links: LexiconLinks): MorphemeSection[] {
  const sections: MorphemeSection[] = [];
  const mine = uniq((own.mine || []).filter((w) => containsMorpheme(entry, w)));
  const mineKeys = new Set(mine.map((w) => w.toLowerCase()));
  const books = uniq((own.books || []).filter((w) => !mineKeys.has(w.toLowerCase()) && containsMorpheme(entry, w)));

  // About: what kind of part, from which language, its spellings and how it is used.
  const rows: string[] = [];
  const kind =
    entry.kind === 'reconstructed'
      ? t('lexicon.morpheme.pieRootKind')
      : entry.origin
        ? t('lexicon.morpheme.kindFrom', { origin: entry.origin, kind: morphemeKindLabel(entry.kind) })
        : morphemeKindLabel(entry.kind);
  rows.push(`<div><dt>${tHtml('lexicon.morpheme.type')}</dt><dd>${linkText(kind, links)}</dd></div>`);
  if (entry.source) {
    rows.push(`<div><dt>${esc(entry.source.language)}</dt><dd>${linkText(entry.source.parts, links)}</dd></div>`);
  }
  if (entry.gloss) rows.push(`<div><dt>${tHtml('lexicon.morpheme.meaning')}</dt><dd>${linkText(entry.gloss, links)}</dd></div>`);
  const variants = uniq(entry.variants).filter((v) => v.toLowerCase() !== entry.form.toLowerCase() && v.toLowerCase() !== entry.head.toLowerCase());
  if (variants.length) {
    const asQuery = (v: string) => (entry.kind === 'root' ? `-${v}-` : v);
    rows.push(
      `<div><dt>${tHtml('lexicon.morpheme.spellings')}</dt><dd>${[entry.head, ...variants]
        .map((v) => (v === entry.head ? `<span class="lx-self">${esc(v)}</span>` : wordLinkHtml(asQuery(v), esc(v), links, 'lx-link')))
        .join('<span class="lx-comma">, </span>')}</dd></div>`,
    );
  }
  if (entry.kind === 'root') {
    const roots = entry.pie ? [entry.pie] : deepRoots([...mine, ...books]);
    if (roots.length) rows.push(`<div><dt>${tHtml('lexicon.morpheme.pieRoot')}</dt><dd>${roots.map((r) => link(r, links)).join('<span class="lx-comma">, </span>')}</dd></div>`);
  }
  if (entry.usage) rows.push(`<div><dt>${tHtml('lexicon.morpheme.usage')}</dt><dd>${linkText(entry.usage, links)}</dd></div>`);
  sections.push({ id: 'morph-about', label: t('lexicon.morpheme.section.about'), html: `<dl class="lx-morph">${rows.join('')}</dl>` });

  if (mine.length) sections.push({ id: 'morph-mine', label: t('lexicon.morpheme.section.myWords'), html: wordLine(mine, links, 16, breakdown) });
  if (books.length) sections.push({ id: 'morph-books', label: t('lexicon.morpheme.section.wordBooks'), html: wordLine(books, links, 16, breakdown) });

  const several = entry.groups.filter((g) => g.derived.length).length > 1;
  const derivedHtml = entry.groups
    .filter((g) => g.derived.length)
    .map((g) => `${several && g.id ? `<h4 class="lx-label">${esc(g.id)}</h4>` : ''}${wordLine(g.derived, links, 24)}`)
    .join('');
  if (derivedHtml) sections.push({ id: 'morph-derived', label: t('lexicon.morpheme.section.derived'), html: `<div class="lx-fam">${derivedHtml}</div>` });

  if (entry.kind === 'reconstructed') {
    const withDesc = entry.groups.filter((g) => g.descendants.length || g.sourceOf || g.formations.length);
    const desc = withDesc
      .map((g) => {
        const lines = g.descendants
          .slice(0, 14)
          .map(
            (d) =>
              `<div><dt>${esc(d.language)}</dt><dd>${d.terms
                .slice(0, 6)
                .map((t) => (d.proto ? `<span class="lx-recon">${esc(t)}</span>` : link(t, links)))
                .join('<span class="lx-comma">, </span>')}</dd></div>`,
          )
          .join('');
        const formations = g.formations.length
          ? `<div><dt>${tHtml('lexicon.morpheme.formations')}</dt><dd>${g.formations.slice(0, 8).map((f) => `<span class="lx-recon">${esc(f)}</span>`).join('<span class="lx-comma">, </span>')}</dd></div>`
          : '';
        const sourceOf = g.sourceOf ? `<p class="lx-morph-note">${linkText(g.sourceOf, links)}</p>` : '';
        return `${withDesc.length > 1 && g.id ? `<h4 class="lx-label">${esc(g.id)}</h4>` : ''}${
          lines || formations ? `<dl class="lx-morph">${lines}${formations}</dl>` : ''
        }${sourceOf}`;
      })
      .join('');
    if (desc) sections.push({ id: 'morph-descendants', label: t('lexicon.morpheme.section.descendants'), html: `<div class="lx-fam">${desc}</div>` });
  }

  const related = entry.related.filter((w) => w !== entry.form);
  if (related.length) sections.push({ id: 'morph-related', label: t('lexicon.morpheme.section.related'), html: wordLine(related, links, 12) });
  return sections;
}

/**
 * The link under a plain word's headword to the part it also spells, or '' for none.
 * Not shown on a morpheme page itself.
 */
export function morphemeOfferHtml(result: { word?: string; metadata?: Record<string, any> } | null | undefined, links: LexiconLinks): string {
  if (!result || morphemeOf(result) || parseMorphemeQuery(result.word || '')) return '';
  const offers = morphemeOffers(String(result.word || '').trim().toLowerCase());
  if (!offers.length) return '';
  return `<p class="lx-offer">${offers
    .map((o) => `${wordLinkHtml(o.form, esc(o.kind === 'root' ? o.bare : o.form), links, 'lx-link')} <span class="lx-label">${esc(morphemeKindLabel(o.kind))}</span>`)
    .join('<span class="lx-sep"> · </span>')}</p>`;
}
