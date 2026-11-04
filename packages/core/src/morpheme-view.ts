/**
 * The sections a morpheme page adds to the Lexicon, shared by the desktop pop-up and the
 * phone: variants and origin, the learner's own words built on the part (My words first,
 * then word books), the words Wiktionary or Etymonline list, related parts, and for a PIE
 * root its descendants. A plain word that also spells a part ("con", "form") gets a link to
 * that part's page under its headword.
 */
import { analyzeMorphemes, morphBreakdown } from './morphology';
import { cachedEtymon } from './notebook-etymology';
import { morphemeOf, morphemeOffers, morphemeKindLabel, parseMorphemeQuery, type MorphemeEntry } from './morpheme';
import { linkText, wordLinkHtml } from './text-links';
import type { LexiconLinks } from './lexicon-parts';

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
    rest.length ? `<details class="lx-more"><summary>All ${items.length}</summary><p class="lx-words">${html(rest)}</p></details>` : ''
  }`;
}

/** Whether a word is built on the part, by the tables, by its traced PIE root, or by spelling. */
export function containsMorpheme(entry: MorphemeEntry, word: string): boolean {
  const w = String(word || '').trim().toLowerCase();
  if (!w || w === entry.bare.toLowerCase()) return false;
  if (entry.kind === 'reconstructed') return !!cachedEtymon(w)?.roots.includes(entry.form);
  if (entry.tableKey) {
    const hit = analyzeMorphemes(w).find((m) => m.kind === entry.kind && m.label === entry.tableKey);
    if (hit && entry.kind !== 'suffix') return true;
    // A suffix's table entry joins endings that are separate pages (-ant and -ent), and the
    // analysis splits "moment" as mom·ent, so only the page's own spelling counts.
    if (hit) {
      const surface = w.slice(hit.start, hit.end);
      return surface === entry.bare || entry.variants.some((v) => v.replace(/^-/, '') === surface);
    }
  }
  if (!/^[a-z]+$/.test(w)) return false;
  if (entry.kind === 'root') {
    // The tables miss some spellings inside longer words ("ef·fic·ient"): a four-letter form
    // anywhere counts, a three-letter one after the first letter ("fiction" is not built on fac).
    return [entry.head, ...entry.variants].some((v) => {
      const at = w.indexOf(v.toLowerCase());
      return at >= 0 && w.length - v.length >= 3 && (v.length >= 4 || at >= 1);
    });
  }
  // Parts the tables do not list are matched by spelling, with a stem long enough to be a word.
  if (entry.kind === 'prefix') return w.startsWith(entry.bare) && w.length - entry.bare.length >= 4 && !entry.tableKey;
  if (entry.kind === 'suffix') return w.endsWith(entry.bare) && w.length - entry.bare.length >= 4 && !entry.tableKey;
  return false;
}

/** "ob·struct" when the tables can split the word, else the word. */
function breakdown(word: string): string {
  const parts = morphBreakdown(word);
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

/** Spellings of the part seen in the learner's words ("oc" in "occur" for ob-), with marks. */
function seenVariants(entry: MorphemeEntry, words: string[]): string[] {
  if (!entry.tableKey || entry.kind === 'reconstructed' || entry.kind === 'suffix') return [];
  const out: string[] = [];
  for (const w of words) {
    const m = analyzeMorphemes(w).find((x) => x.kind === entry.kind && x.label === entry.tableKey);
    if (!m) continue;
    const s = w.slice(m.start, m.end).toLowerCase();
    out.push(entry.kind === 'prefix' ? `${s}-` : s);
  }
  return out;
}

/** The PIE roots most of the learner's words with this classical root trace back to. */
function deepRoots(words: string[]): string[] {
  const count = new Map<string, number>();
  for (const w of words) for (const r of cachedEtymon(w)?.roots || []) count.set(r, (count.get(r) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => r);
}

/** The Lexicon sections of a morpheme page; [] for an ordinary word. */
export function morphemeSections(
  result: { metadata?: Record<string, any> } | null | undefined,
  own: OwnWords,
  links: LexiconLinks,
): MorphemeSection[] {
  const entry = morphemeOf(result);
  if (!entry) return [];
  const sections: MorphemeSection[] = [];
  // A word the sources list as built on the part counts too, traced or not.
  const listed = new Set(entry.groups.flatMap((g) => g.derived.map((w) => w.toLowerCase())));
  const has = (w: string) => listed.has(String(w || '').trim().toLowerCase()) || containsMorpheme(entry, w);
  const mine = uniq((own.mine || []).filter(has));
  const mineKeys = new Set(mine.map((w) => w.toLowerCase()));
  const books = uniq((own.books || []).filter((w) => !mineKeys.has(w.toLowerCase()) && has(w)));

  // About: what kind of part, from which language, its spellings and how it is used.
  const rows: string[] = [];
  const kind = entry.kind === 'reconstructed' ? 'Proto-Indo-European root' : `${entry.origin ? `${entry.origin} ` : ''}${morphemeKindLabel(entry.kind)}`;
  rows.push(`<div><dt>Type</dt><dd>${linkText(kind, links)}</dd></div>`);
  if (entry.gloss) rows.push(`<div><dt>Meaning</dt><dd>${linkText(entry.gloss, links)}</dd></div>`);
  const variants = uniq([...entry.variants, ...seenVariants(entry, [...mine, ...books])]).filter(
    (v) => v.toLowerCase() !== entry.form.toLowerCase() && v.toLowerCase() !== entry.head.toLowerCase(),
  );
  if (variants.length) {
    const asQuery = (v: string) => (entry.kind === 'root' ? `-${v}-` : v);
    rows.push(
      `<div><dt>Variants</dt><dd>${variants
        .map((v) => wordLinkHtml(asQuery(v), esc(v), links, 'lx-link'))
        .join('<span class="lx-comma">, </span>')}</dd></div>`,
    );
  }
  if (entry.kind === 'root') {
    const roots = deepRoots([...mine, ...books]);
    if (roots.length) rows.push(`<div><dt>Deep root</dt><dd>${roots.map((r) => link(r, links)).join('<span class="lx-comma">, </span>')}</dd></div>`);
  }
  if (entry.usage) rows.push(`<div><dt>Usage</dt><dd>${linkText(entry.usage, links)}</dd></div>`);
  sections.push({ id: 'morph-about', label: 'about', html: `<dl class="lx-morph">${rows.join('')}</dl>` });

  if (mine.length) {
    sections.push({ id: 'morph-mine', label: 'my words', html: wordLine(mine, links, 16, breakdown) });
  }
  if (books.length) {
    sections.push({ id: 'morph-books', label: 'word books', html: wordLine(books, links, 16, breakdown) });
  }

  const several = entry.groups.length > 1;
  const derivedHtml = entry.groups
    .filter((g) => g.derived.length)
    .map((g) => `${several && g.id ? `<h4 class="lx-label">${esc(g.id)}</h4>` : ''}${wordLine(g.derived, links, 24)}`)
    .join('');
  if (derivedHtml) sections.push({ id: 'morph-derived', label: 'derived words', html: `<div class="lx-fam">${derivedHtml}</div>` });

  if (entry.kind === 'reconstructed') {
    const desc = entry.groups
      .filter((g) => g.descendants.length || g.sourceOf || g.formations.length)
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
          ? `<div><dt>Formations</dt><dd>${g.formations.slice(0, 8).map((f) => `<span class="lx-recon">${esc(f)}</span>`).join('<span class="lx-comma">, </span>')}</dd></div>`
          : '';
        const sourceOf = g.sourceOf ? `<p class="lx-morph-note">${linkText(g.sourceOf, links)}</p>` : '';
        return `${several && g.id ? `<h4 class="lx-label">${esc(g.id)}</h4>` : ''}${
          lines || formations ? `<dl class="lx-morph">${lines}${formations}</dl>` : ''
        }${sourceOf}`;
      })
      .join('');
    if (desc) sections.push({ id: 'morph-descendants', label: 'descendants', html: `<div class="lx-fam">${desc}</div>` });
  }

  const related = entry.related.filter((w) => w !== entry.form);
  if (related.length) sections.push({ id: 'morph-related', label: 'related', html: wordLine(related, links, 12) });
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
