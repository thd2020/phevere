/**
 * Lookup pages for word parts: prefixes ("ob-"), suffixes ("-ant"), classical roots ("-fac-")
 * and reconstructed Proto-Indo-European roots ("*bʰeh₂-").
 *
 * A query's shape says what it is, the way Wiktionary titles them: a trailing hyphen is a
 * prefix, a leading one a suffix, both a root inside a word, and a leading asterisk a
 * reconstructed form. The page carries what Wiktionary, Etymonline and Merriam-Webster show
 * for an affix or a root: its senses, its spellings (ob-, oc-, of-, op-), where it comes from,
 * usage notes, and the words built on it, commonest first. A classical root shows the Latin or
 * Greek word behind it with its principal parts and the PIE root it continues; a PIE root
 * shows Etymonline's English words and the descendants on Wiktionary's reconstruction page.
 *
 * The result is an ordinary DictionaryResult (senses, IPA, etymology tabs), with the
 * morpheme's own data under `metadata.morpheme` for the sections only a word part has.
 */
import { analyzeMorphemes, morphEntry, type Morph, type MorphEtymon } from './morphology';
import { buildEtymology, extractLanguageSection, languageName, scanTemplates } from './etymology';
import { extractIpaFromWikitext, type Pronunciation } from './pronunciation';
import { cmuKnownSync } from './cmu-ipa';
import { getHttp, isCoreConfigured } from './runtime';
import { loadWordbook } from './wordbooks';
import { sectionBody, sectionTerms, sensesUnder, wikiInline, type WikiSense } from './morpheme-wiki';
import { ROOT_LEMMA, parseLemmaPage, principalParts } from './morpheme-roots';
import type { Definition, DictionaryResult } from './dictionary';
import { t, type MessageKey } from './i18n/runtime';

export { wikiInline } from './morpheme-wiki';

export type MorphemeKind = 'prefix' | 'suffix' | 'root' | 'reconstructed';

export interface MorphemeQuery {
  kind: MorphemeKind;
  /** As looked up: "ob-", "-ant", "-fac-", "*bʰeh₂-". */
  form: string;
  /** Without the hyphens and asterisk: "ob", "ant", "fac", "bʰeh₂". */
  bare: string;
}

/** A prefix, suffix or root in Phevere's morpheme tables (morphology.ts). */
export interface TableMorph {
  kind: 'prefix' | 'suffix' | 'root';
  /** The label the analysis uses: "ob-", "-sion", "fac". */
  key: string;
  gloss: string;
  origin: string;
  /** Its spellings with their hyphens, the label first: ["ob-", "oc-", "of-", "op-"]. */
  forms: string[];
  pie?: string;
}

export interface MorphemeDescendant {
  language: string;
  terms: string[];
  /** A reconstructed ancestor (Proto-Germanic *baukną): shown, but it has no page here. */
  proto: boolean;
}

/** One homograph: *bʰeh₂- "shine" and *bʰeh₂- "speak" are two roots with one spelling. */
export interface MorphemeGroup {
  /** Wiktionary's sense id ("shine"), '' when the page has one entry. */
  id: string;
  senses: WikiSense[];
  /** English words built on it, commonest first. */
  derived: string[];
  descendants: MorphemeDescendant[];
  /** Reconstructed formations (*bʰéh₂-ti), which have no page of their own. */
  formations: string[];
  /** Etymonline's "It might also be the source of: …" for a PIE root. */
  sourceOf: string;
}

export interface MorphemeEntry {
  kind: MorphemeKind;
  form: string;
  /** The headword shown: "ob-", "-ant", "fac", "*bʰeh₂-". */
  head: string;
  bare: string;
  /** Source language: "Latin", "Greek", "Old English", "Proto-Indo-European". */
  origin: string;
  /** Short meaning from the tables or Etymonline. */
  gloss: string;
  tableKey: string;
  /** Other spellings, with hyphens for affixes: ["oc-", "op-"], ["fic", "fec", "fect"]. */
  variants: string[];
  usage: string;
  related: string[];
  groups: MorphemeGroup[];
  sources: string[];
  /** A classical root's Latin or Greek word and its principal parts: "faciō, facere, fēcī, factum". */
  source?: { language: string; lemma: string; parts: string; senses: string[] };
  /** The Proto-Indo-European root a classical root continues. */
  pie?: string;
}

const LETTER_RUN = /^[\p{L}\p{M}]+$/u;
const RECONSTRUCTED = /^[\p{L}\p{M}\u02b0-\u02ff\u2080-\u2089()-]+$/u;

/** The word part a query names, or null for an ordinary word or phrase. */
export function parseMorphemeQuery(text: string): MorphemeQuery | null {
  const s = String(text || '')
    .normalize('NFC')
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2212]/g, '-');
  if (!s || s.length > 40 || /\s/.test(s)) return null;
  if (s.startsWith('*')) {
    const bare = s.slice(1).replace(/^-+|-+$/g, '');
    if (bare.length < 2 || !RECONSTRUCTED.test(bare) || !/\p{L}/u.test(bare)) return null;
    return { kind: 'reconstructed', form: s, bare };
  }
  const m = /^(-?)([^-]+)(-?)$/.exec(s);
  if (!m || !LETTER_RUN.test(m[2])) return null;
  const [, lead, bare, trail] = m;
  if (lead && trail) return bare.length >= 2 ? { kind: 'root', form: s, bare } : null;
  if (trail) return { kind: 'prefix', form: s, bare };
  if (lead) return { kind: 'suffix', form: s, bare };
  return null;
}

/** The query that opens a morpheme's page from a card chip or a word breakdown. */
export function morphemeLookupQuery(m: Pick<Morph, 'kind' | 'label' | 'start' | 'end'>, word = ''): string {
  if (m.kind === 'prefix') return m.label.endsWith('-') ? m.label : `${m.label}-`;
  if (m.kind === 'suffix') {
    const surface = word ? word.slice(m.start, m.end).toLowerCase() : '';
    return surface && /^[a-z]+$/.test(surface) ? `-${surface}` : m.label;
  }
  if (m.kind === 'root') return `-${m.label.replace(/^-|-$/g, '')}-`;
  return m.label;
}

/** The table's entry for a part, or null when Phevere's tables do not list it. */
export function tableMorph(kind: TableMorph['kind'], bare: string): TableMorph | null {
  const b = String(bare || '').toLowerCase();
  if (!/^[a-z]{1,14}$/.test(b)) return null;
  const e = morphEntry(kind === 'prefix' ? `${b}-` : kind === 'suffix' ? `-${b}` : b);
  if (!e || e.kind !== kind) return null;
  return { kind, key: e.key, gloss: e.gloss, origin: e.origin, forms: e.forms, ...(e.pie ? { pie: e.pie } : {}) };
}

/**
 * Word parts a plain word also spells, offered as a link on its page: "con" is a prefix,
 * "form" a Latin root, "able" a suffix. Roots first, then prefixes, then suffixes.
 */
export function morphemeOffers(word: string): MorphemeQuery[] {
  const w = String(word || '').trim();
  if (!/^[a-z]{2,8}$/.test(w)) return [];
  const out: MorphemeQuery[] = [];
  const root = tableMorph('root', w);
  if (root) out.push({ kind: 'root', form: `-${root.key}-`, bare: root.key });
  if (tableMorph('prefix', w)) out.push({ kind: 'prefix', form: `${w}-`, bare: w });
  if (w.length >= 3 && tableMorph('suffix', w)) out.push({ kind: 'suffix', form: `-${w}`, bare: w });
  return out;
}

/** The kind as the result's part of speech: English, as dictionaries give it ("root", "prefix"). */
function morphemeKindPos(kind: MorphemeKind): string {
  return kind === 'reconstructed' ? 'root' : kind;
}

const KIND_KEY: Record<MorphemeKind, MessageKey> = {
  prefix: 'notebook.morpheme.kind.prefix',
  suffix: 'notebook.morpheme.kind.suffix',
  root: 'notebook.morpheme.kind.root',
  reconstructed: 'notebook.morpheme.kind.root',
};

/** The kind's name in the interface language, for headings and labels ("root", "prefix"). */
export function morphemeKindLabel(kind: MorphemeKind): string {
  return t(KIND_KEY[kind] || KIND_KEY.root);
}

/* ------------------------------------------------------------------ membership */

/** Whether a stem is an English word on its own ("assist" in assistant), when that is known. */
function isWord(stem: string): boolean {
  if (stem.length < 3) return false;
  const known = (w: string) => cmuKnownSync(w) === true;
  return known(stem) || known(`${stem}e`) || (/i$/.test(stem) && known(`${stem.slice(0, -1)}y`)) || (/(.)\1$/.test(stem) && known(stem.slice(0, -1)));
}

/** The part a membership test needs: its kind, table key and the spellings the page stands for. */
export type PartRef = Pick<MorphemeEntry, 'kind' | 'tableKey' | 'bare' | 'variants'>;

/**
 * Whether a word is built on the part, by Phevere's morpheme analysis (with the word's traced
 * origin when known). A suffix also needs the word to end in the page's own spelling and to
 * keep a root or a whole word in front of it, so "elephant" and "enchant" are not -ant, and
 * "moment" is not -ant either. A part the tables do not list needs a whole word beside it.
 */
export function partInWord(part: PartRef, word: string, etymon?: MorphEtymon | null): boolean {
  const w = String(word || '').trim().toLowerCase();
  if (!/^[a-z]{3,}$/.test(w) || part.kind === 'reconstructed') return false;
  const spellings = [part.bare, ...part.variants.map((v) => v.replace(/^-|-$/g, ''))].filter(Boolean);
  if (w === part.bare) return false;
  if (part.tableKey) {
    const parts = analyzeMorphemes(w, etymon);
    const hit = parts.find((m) => m.kind === part.kind && m.label === part.tableKey);
    if (!hit) return false;
    if (part.kind !== 'suffix') return true;
    // A suffix page stands for its own spelling: "moment" ends in the -ent the tables join with -ant.
    if (!w.endsWith(part.bare)) return false;
    return parts.some((m) => m.kind === 'root') || isWord(w.slice(0, w.length - part.bare.length));
  }
  if (part.kind === 'prefix') return spellings.some((s) => w.startsWith(s) && isWord(w.slice(s.length)));
  if (part.kind === 'suffix') return spellings.some((s) => w.endsWith(s) && isWord(w.slice(0, w.length - s.length)));
  return false;
}

/* ------------------------------------------------------------------ affix pages */

const AFFIX_POS = ['Prefix', 'Suffix', 'Infix', 'Interfix', 'Circumfix', 'Combining form', 'Affix', 'Root'];

/** Wiktionary language codes for the origins the tables name. */
const ORIGIN_CODES: Record<string, string[]> = {
  Latin: ['la', 'la-lat', 'la-med', 'la-new', 'itc-pro'],
  Greek: ['grc', 'el', 'grk-pro'],
  'Old English': ['ang', 'enm', 'gem-pro', 'gmw-pro'],
  French: ['fr', 'fro', 'frm', 'xno'],
};

const CLIPPED = /\{\{\s*(?:clipping|clip|abbreviation|abbrev|initialism|acronym|back-form|bf|blend|short for)\s*\|/;

/**
 * The parts of the English entry that are this word part, when the page holds homographs
 * ("ob-" from Latin, and "ob-" clipped from "obligatory"): the etymology sections whose
 * origin matches the tables, else every section that is not a clipping or an abbreviation.
 */
export function affixSections(english: string, origin: string): string[] {
  const heads = [...english.matchAll(/^===\s*Etymology\s+\d+\s*===\s*$/gm)];
  if (heads.length < 2) return [english];
  const blocks = heads.map((h, i) => english.slice(h.index!, i + 1 < heads.length ? heads[i + 1].index! : undefined));
  const codes = ORIGIN_CODES[origin] || [];
  const ofOrigin = (b: string) => {
    const ety = b.split(/\n={4,}/)[0];
    return codes.some((c) => new RegExp(`\\|\\s*${c.replace('-', '\\-')}\\s*[|:}]`).test(ety) || ety.includes(`${c}:`));
  };
  const matching = codes.length ? blocks.filter(ofOrigin) : [];
  if (matching.length) return matching;
  const plain = blocks.filter((b) => !CLIPPED.test(b.split(/\n={4,}/)[0]));
  return plain.length ? plain : [blocks[0]];
}

export interface AffixPage {
  senses: WikiSense[];
  pronunciations: Pronunciation[];
  etymology: string;
  variants: string[];
  usage: string;
  related: string[];
  /** Category of words built on it, from {{prefixsee}} / {{suffixsee}}. */
  category: string;
}

/** Whether a term is spelled as the same kind of part: "oc-" for a prefix, "-ion" for a suffix. */
function sameShape(term: string, kind: MorphemeKind): boolean {
  if (kind === 'prefix') return /^\p{L}[\p{L}\p{M}]*-$/u.test(term);
  if (kind === 'suffix') return /^-\p{L}[\p{L}\p{M}]*$/u.test(term);
  return true;
}

/** The English entry of an affix page ("ob-", "-ant"); null when the page has none. */
export function parseAffixPage(wikitext: string, q: MorphemeQuery, origin = ''): AffixPage | null {
  if (!/^==\s*English\s*==\s*$/m.test(wikitext || '')) return null;
  const en = extractLanguageSection(wikitext, 'English');
  const kept = affixSections(en, origin);
  const scope = kept.join('\n');
  const senses = sensesUnder(scope, AFFIX_POS);
  if (!senses.length) return null;
  const latin = extractLanguageSection(wikitext, 'Latin');
  const fromLatin = /\{\{\s*(?:der|bor|lbor|inh)\+?\s*\|\s*en\s*\|\s*la\s*\|/.test(scope) || /\{\{\s*etymon\|en\|[^}]*\bla:/.test(scope);
  const variants = sectionTerms(sectionBody(en, 'Alternative forms'), 'en', true);
  if (fromLatin && latin) {
    for (const v of sectionTerms(sectionBody(latin, 'Alternative forms'), 'la', true)) if (!variants.includes(v)) variants.push(v);
  }
  const usageRaw = sectionBody(scope, 'Usage notes') || (fromLatin ? sectionBody(latin, 'Usage notes') : '');
  const usage = usageRaw
    .split('\n')
    .map((l) => wikiInline(l.replace(/^[*#:]+\s*/, '')))
    .filter(Boolean)
    .join(' ')
    .slice(0, 480);
  // Related parts only: a phrase such as "thread tax" belongs to another homograph's page.
  const related = [
    ...sectionTerms(sectionBody(scope, 'Related terms'), 'en'),
    ...sectionTerms(sectionBody(scope, 'Synonyms'), 'en'),
    ...sectionTerms(sectionBody(scope, 'See also'), 'en'),
  ].filter((w, i, all) => all.indexOf(w) === i && w !== q.form && !/\s/.test(w));
  let category = '';
  for (const t of scanTemplates(scope)) {
    if (t.name !== 'prefixsee' && t.name !== 'suffixsee' && t.name !== 'affixsee') continue;
    const id = t.named.id ? ` (${t.named.id})` : '';
    category = `English terms ${t.name === 'prefixsee' ? 'prefixed' : 'suffixed'} with ${q.form}${id}`;
    break;
  }
  if (!category) category = `English terms ${q.kind === 'prefix' ? 'prefixed' : 'suffixed'} with ${q.form}`;
  const etyText = kept.length === 1 && kept[0] === en ? buildEtymology(wikitext)?.text || '' : buildEtymology(`==English==\n${scope}`)?.text || '';
  return {
    senses,
    pronunciations: extractIpaFromWikitext(en),
    etymology: etyText.replace(/^Etymology \d+:\s*/gm, ''),
    variants: variants.filter((v) => v !== q.form && sameShape(v, q.kind)),
    usage,
    related,
    category,
  };
}

/* ------------------------------------------------------------------ PIE roots */

const RECON_POS = ['Root', 'Noun', 'Verb', 'Adjective', 'Suffix', 'Prefix', 'Adverb', 'Pronoun', 'Numeral', 'Particle', 'Preposition'];

/** {{desc}} and {{l|ine-pro}} lines of a Derived terms or Descendants list. */
function descendantsFrom(body: string, descendants: MorphemeDescendant[], formations: string[]): void {
  for (const line of body.split('\n')) {
    if (!/^\*/.test(line)) continue;
    for (const t of scanTemplates(line)) {
      if (t.name === 'desc' || t.name === 'desctree' || t.name === 'descendant') {
        const code = t.positional[0] || '';
        const terms = t.positional
          .slice(1)
          .map((x) => wikiInline(x).replace(/#.*$/, '').trim())
          .filter((x) => x && !/[=[{]/.test(x));
        if (t.named.alt && !terms.length) terms.push(t.named.alt);
        const language = languageName(code);
        // A language Phevere has no name for would show as its code ("sqj-pro", "Proto-INE-BSL").
        if (!language || language === code || /^Proto-[A-Z]{2,}/.test(language) || !terms.length) continue;
        const proto = /-pro$/.test(code) || terms.every((x) => x.startsWith('*'));
        const at = descendants.find((d) => d.language === language);
        if (at) {
          for (const x of terms) if (!at.terms.includes(x)) at.terms.push(x);
        } else {
          descendants.push({ language, terms, proto });
        }
      } else if ((t.name === 'l' || t.name === 'm') && t.positional[0] === 'ine-pro') {
        const term = wikiInline(t.positional[2] || t.positional[1] || '')
          .replace(/#.*$/, '')
          .split('~')[0]
          .trim();
        if (term && !formations.includes(term)) formations.push(term);
      }
    }
  }
}

/** Wiktionary's Reconstruction:Proto-Indo-European page: each homograph's senses and descendants. */
export function parseReconstructionPage(wikitext: string): MorphemeGroup[] {
  const text = extractLanguageSection(wikitext || '', 'Proto-Indo-European');
  if (!text) return [];
  const re = new RegExp(`^(={3,4})\\s*(?:${RECON_POS.join('|')})(?:\\s+\\d+)?\\s*\\1\\s*$`, 'gim');
  const heads: Array<{ at: number; end: number; level: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) heads.push({ at: m.index, end: m.index + m[0].length, level: m[1].length });
  const groups: MorphemeGroup[] = [];
  heads.forEach((h, i) => {
    const stop = heads.slice(i + 1).find((n) => n.level <= h.level);
    let block = text.slice(h.end, stop ? stop.at : undefined);
    const refs = /^===\s*References\s*===\s*$/m.exec(block);
    if (refs) block = block.slice(0, refs.index);
    let id = '';
    for (const t of scanTemplates(block)) {
      if ((t.name === 'etymon' || t.name === 'rootsee') && t.named.id) {
        id = t.named.id;
        break;
      }
    }
    const senses = sensesUnder(`=== Root ===\n${block.split(/^=+[^=\n]/m)[0]}`, ['Root']);
    const descendants: MorphemeDescendant[] = [];
    const formations: string[] = [];
    descendantsFrom(sectionBody(block, 'Derived terms'), descendants, formations);
    descendantsFrom(sectionBody(block, 'Descendants'), descendants, formations);
    descendantsFrom(sectionBody(block, 'Extensions'), descendants, formations);
    if (senses.length || descendants.length) {
      // Attested languages first (Latin faveō, Greek φῶς), then the reconstructed stages between.
      const ordered = [...descendants.filter((d) => !d.proto), ...descendants.filter((d) => d.proto)];
      groups.push({ id, senses, derived: [], descendants: ordered, formations: formations.slice(0, 12), sourceOf: '' });
    }
  });
  return groups;
}

/** Page titles from a list=categorymembers response, words only. */
export function parseCategoryMembers(json: string): string[] {
  try {
    const data = JSON.parse(json);
    return (data?.query?.categorymembers || [])
      .map((m: { title?: string; ns?: number }) => (m && m.ns === 0 ? String(m.title || '') : ''))
      .filter((t: string) => t && !/\s/.test(t));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ word frequency */

/** Words with Datamuse's frequency (uses per million words) from a `sp=…&md=f` response. */
export function parseDatamuse(json: string): Array<{ word: string; freq: number }> {
  try {
    const rows = JSON.parse(json);
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r: { word?: string; tags?: string[] }) => {
        const f = (r?.tags || []).find((t) => /^f:/.test(t));
        return { word: String(r?.word || ''), freq: f ? Number(f.slice(2)) || 0 : 0 };
      })
      .filter((r) => /^[a-z]+$/.test(r.word));
  } catch {
    return [];
  }
}

/**
 * Words built on the part, commonest first: the frequency-ranked candidates that pass
 * `keep`, then the listed words (Wiktionary's category, Etymonline's list) that are not
 * among them, in their own order.
 */
export function rankDerived(
  candidates: Array<{ word: string; freq: number }>,
  listed: string[],
  keep: (w: string) => boolean,
  limit = 48,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const freq = new Map<string, number>();
  for (const c of candidates) freq.set(c.word.toLowerCase(), Math.max(freq.get(c.word.toLowerCase()) || 0, c.freq));
  const all = new Set([...candidates.map((c) => c.word.toLowerCase()), ...listed.map((w) => w.toLowerCase())]);
  // "effects", "obtained" and "significantly" stand under effect, obtain and significant.
  const inflected = (w: string) =>
    [w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y'), w.replace(/ed$/, ''), w.replace(/d$/, ''), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/([a-z])\1(?:ed|ing)$/, '$1'), w.replace(/ly$/, '')].some(
      (b) => b !== w && b.length >= 3 && all.has(b),
    );
  const ranked = [...freq]
    .map(([word, f]) => ({ word, freq: f }))
    .filter((c) => keep(c.word) && !inflected(c.word))
    .sort((a, b) => b.freq - a.freq);
  for (const c of ranked) {
    const k = c.word.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c.word);
  }
  const rest = listed
    .filter((w) => !/^\p{Lu}/u.test(w) && !/\d/.test(w) && !seen.has(w.toLowerCase()) && !inflected(w.toLowerCase()))
    .map((w, i) => ({ w, i, f: freq.get(w.toLowerCase()) ?? (cmuKnownSync(w.toLowerCase()) ? 0.5 : 0) }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  for (const r of rest) {
    if (seen.has(r.w.toLowerCase())) continue;
    seen.add(r.w.toLowerCase());
    out.push(r.w);
  }
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ Etymonline */

/** Etymonline's spelling of a PIE root, which follows Watkins: *bʰeh₂- → *bha-, *h₂eǵ- → *ag-. */
export function etymonlineRootKey(form: string): string {
  const s = String(form || '')
    .replace(/^\*/, '')
    .replace(/-+$/, '')
    .normalize('NFC')
    .replace(/ʰ/g, 'h')
    .replace(/ʷ/g, 'w')
    .replace(/ḱ/g, 'k')
    .replace(/ǵ/g, 'g')
    .replace(/eh₂|h₂e/g, 'a')
    .replace(/eh₃|h₃e/g, 'o')
    .replace(/eh₁|h₁e/g, 'e')
    .replace(/h[₁₂₃]|H/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z-]/g, '');
  return s ? `*${s}-` : '';
}

export interface EtymonlineEntry {
  word: string;
  property: string;
  text: string;
  gloss: string;
  formsPartOf: string[];
  sourceOf: string;
}

/** Entries from Etymonline's /api/etymology JSON, with a root's word list split out. */
export function parseEtymonlineJson(json: string): EtymonlineEntry[] {
  let payload: any;
  try {
    payload = JSON.parse(json);
  } catch {
    return [];
  }
  if (payload?.code !== 200 || !Array.isArray(payload?.data?.items)) return [];
  const out: EtymonlineEntry[] = [];
  for (const item of payload.data.items) {
    for (const v of item?.vocabularies || []) {
      const text = String(v?.etymology_plain || '').replace(/\s+/g, ' ').trim();
      if (text.length < 12) continue;
      const gloss = ((text.match(/root meaning "([^"]+)"/) || text.match(/meaning "([^"]+)"/) || [])[1] || '').replace(/[.,;:\s]+$/, '');
      const list = (text.match(/It might form all or part of:\s*([\s\S]*?)(?:\.\s*It might also be the source of:|\.?\s*$)/) || [])[1] || '';
      // A gloss in quotes holds the separator ('ban (n.1) "proclamation or edict;" ban (v.)').
      const formsPartOf = list
        .replace(/"([^"]*)"/g, (_m, inner: string) => (/;\s*$/.test(inner) ? ';' : ''))
        .split(/;\s*/)
        .map((x) => x.replace(/\([^)]*\)/g, '').replace(/[.;]+$/, '').trim())
        .filter((x, i, all) => x && !/\s/.test(x) && all.indexOf(x) === i);
      const sourceOf = ((text.match(/It might also be the source of:\s*([\s\S]*)$/) || [])[1] || '').trim();
      out.push({ word: String(v.word || ''), property: String(v.property || ''), text, gloss, formsPartOf, sourceOf });
    }
  }
  return out;
}

function words(s: string): Set<string> {
  return new Set(
    String(s || '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2 && w !== 'the'),
  );
}

/** Which Etymonline entry describes a Wiktionary homograph: the one whose gloss shares a word. */
function matchEtymonline(group: MorphemeGroup, entries: EtymonlineEntry[], index: number, total: number): EtymonlineEntry | undefined {
  const mine = words(`${group.id} ${group.senses.map((s) => s.text).join(' ')}`);
  const hit = entries.find((e) => [...words(e.gloss)].some((w) => mine.has(w)));
  if (hit) return hit;
  return entries.length === total ? entries[index] : total === 1 ? entries[0] : undefined;
}

/* ------------------------------------------------------------------ assembly */

/** What the page needs, fetched in parallel. Pure assembly lives in buildMorphemeEntry. */
export interface MorphemeSources {
  wikitext?: string | null;
  categories?: Record<string, string[]>;
  etymonline?: EtymonlineEntry[];
  /** Candidate words with their frequency, from Datamuse spelling searches. */
  frequent?: Array<{ word: string; freq: number }>;
  /** A classical root's Latin or Greek entry, and its expanded headword line. */
  lemma?: { title: string; wikitext: string | null; headline?: string | null };
}

function emptyEntry(q: MorphemeQuery): MorphemeEntry {
  const table = q.kind === 'reconstructed' ? null : tableMorph(q.kind, q.bare);
  // A root's page is the same for each of its spellings: "-fic-" opens fac.
  const head = q.kind === 'root' ? table?.key || q.bare : q.form;
  return {
    kind: q.kind,
    form: q.form,
    head,
    bare: q.kind === 'root' ? table?.key || q.bare : q.bare,
    origin: q.kind === 'reconstructed' ? 'Proto-Indo-European' : table?.origin || '',
    gloss: table?.gloss || '',
    tableKey: table?.key || '',
    variants: (table?.forms || []).filter((f) => f !== head && f !== q.form),
    usage: '',
    related: [],
    groups: [],
    sources: [],
    ...(table?.pie ? { pie: table.pie } : {}),
  };
}

const emptyGroup = (): MorphemeGroup => ({ id: '', senses: [], derived: [], descendants: [], formations: [], sourceOf: '' });

/** The page, from what the sources returned. */
export function buildMorphemeEntry(
  q: MorphemeQuery,
  src: MorphemeSources,
): { entry: MorphemeEntry; pronunciations: Pronunciation[]; etymology: string } {
  const entry = emptyEntry(q);
  let pronunciations: Pronunciation[] = [];
  const etymologyParts: string[] = [];
  const ety = src.etymonline || [];
  const keep = (w: string) => partInWord(entry, w);
  if (q.kind === 'reconstructed') {
    const groups = src.wikitext ? parseReconstructionPage(src.wikitext) : [];
    if (groups.length) entry.sources.push('Wiktionary');
    groups.forEach((g, i) => {
      const e = matchEtymonline(g, ety, i, groups.length);
      if (e) {
        g.derived = e.formsPartOf;
        g.sourceOf = e.sourceOf;
      }
      const cat = src.categories?.[g.id ? `${q.form} (${g.id})` : q.form];
      if (!g.derived.length && cat) g.derived = rankDerived([], cat, () => true);
    });
    // Etymonline knows the root although Wiktionary's page could not be read.
    if (!groups.length) {
      for (const e of ety) {
        groups.push({ ...emptyGroup(), id: e.property.replace(/[()]/g, ''), senses: e.gloss ? [{ text: e.gloss, examples: [] }] : [], derived: e.formsPartOf, sourceOf: e.sourceOf });
      }
    }
    if (ety.length) entry.sources.push('Etymonline');
    // Homographs (*bʰeh₂- "shine" and "speak") each give their meaning.
    const glosses = ety.map((e) => e.gloss).filter((g, i, all) => g && all.indexOf(g) === i);
    entry.gloss = glosses.join('; ') || groups.map((g) => g.senses[0]?.text || '').filter(Boolean).join('; ');
    entry.groups = groups;
    for (const e of ety) etymologyParts.push(`[Etymonline]\n${[e.word, e.property].filter(Boolean).join(' ')}: ${e.text}`);
  } else if (q.kind === 'root') {
    const group = emptyGroup();
    const lemma = src.lemma?.wikitext ? parseLemmaPage(src.lemma.wikitext, src.lemma.title) : null;
    if (lemma) {
      entry.sources.push('Wiktionary');
      const parts = principalParts(src.lemma?.headline || '') || src.lemma!.title;
      entry.source = { language: lemma.language === 'Ancient Greek' ? 'Greek' : 'Latin', lemma: src.lemma!.title, parts, senses: lemma.senses };
      if (lemma.pie && !entry.pie) entry.pie = lemma.pie;
      if (lemma.etymology) etymologyParts.push(`[Wiktionary]\n${parts.split(',')[0]}: ${lemma.etymology}`);
    }
    // The root's meaning first, then what the Latin or Greek word means.
    group.senses = <WikiSense[]>[
      ...(entry.gloss ? [{ text: entry.gloss, examples: [] as string[] }] : []),
      ...(lemma ? lemma.senses.slice(0, 4).map((s) => ({ text: `${entry.source!.parts.split(',')[0]}: ${s}`, examples: [] as string[] })) : []),
    ];
    // English words: the frequency-ranked spellings, then Etymonline's list for the PIE root.
    const listed = ety.flatMap((e) => e.formsPartOf).filter(keep);
    group.derived = rankDerived(src.frequent || [], listed, keep);
    if (ety.length) {
      entry.sources.push('Etymonline');
      for (const e of ety) etymologyParts.push(`[Etymonline]\n${[e.word, e.property].filter(Boolean).join(' ')}: ${e.text}`);
    }
    if (group.senses.length || group.derived.length) entry.groups.push(group);
  } else {
    const page = src.wikitext ? parseAffixPage(src.wikitext, q, entry.origin) : null;
    const group = emptyGroup();
    let listed: string[] = [];
    if (page) {
      entry.sources.push('Wiktionary');
      group.senses = page.senses;
      for (const v of page.variants) if (!entry.variants.includes(v)) entry.variants.push(v);
      entry.usage = page.usage;
      entry.related = page.related;
      pronunciations = page.pronunciations;
      if (page.etymology) etymologyParts.push(`[Wiktionary]\n${page.etymology}`);
      listed = (src.categories?.[page.category] || []).filter((w) => w.toLowerCase() !== q.form);
    }
    // Common words built on it first; Wiktionary's category, mostly rare formations, after them.
    group.derived = rankDerived(src.frequent || [], listed.slice(0, 60), keep);
    const e = ety[0];
    if (e) {
      entry.sources.push('Etymonline');
      etymologyParts.push(`[Etymonline]\n${e.word}: ${e.text}`);
      if (!entry.gloss) entry.gloss = ((e.text.match(/meaning "([^"]+)"/) || [])[1] || '').replace(/[.,;:\s]+$/, '');
      if (!entry.origin) entry.origin = (e.text.match(/\bfrom (Latin|Greek|Old English|Old French|French|Germanic)\b/) || [])[1] || '';
    }
    if (!group.senses.length && entry.gloss) group.senses.push({ text: entry.gloss, examples: [] });
    if (group.senses.length || group.derived.length) entry.groups.push(group);
  }
  return { entry, pronunciations, etymology: etymologyParts.join('\n\n--- Alternative etymology ---\n\n') };
}

/** The lookup result a morpheme page renders from. */
export function morphemeResult(q: MorphemeQuery, built: ReturnType<typeof buildMorphemeEntry>): DictionaryResult {
  const { entry } = built;
  const pos = morphemeKindPos(entry.kind);
  const source = entry.sources.includes('Wiktionary') ? 'Wiktionary' : entry.sources[0] || '';
  const definitions: Definition[] = [];
  for (const g of entry.groups) {
    for (const s of g.senses) {
      definitions.push({ partOfSpeech: pos, meaning: s.text, examples: s.examples, source, ...(source ? { sources: [source] } : {}) });
    }
  }
  return {
    word: entry.head,
    pronunciations: built.pronunciations,
    pronunciation: built.pronunciations[0]?.ipa,
    definitions,
    translations: [],
    examples: [],
    etymology: built.etymology || undefined,
    language: 'en',
    detectedLanguage: 'en',
    sources: entry.sources,
    metadata: { isSentence: false, morpheme: entry, sourceLanguage: 'en' },
  };
}

/** The morpheme data of a result, when it is a morpheme page. */
export function morphemeOf(result: { metadata?: Record<string, any> } | null | undefined): MorphemeEntry | null {
  const m = result?.metadata?.morpheme;
  return m && typeof m === 'object' && typeof m.kind === 'string' ? (m as MorphemeEntry) : null;
}

/* ------------------------------------------------------------------ fetching */

const UA = 'Phevere/4.0 (https://github.com/thd2020/phevere)';

async function getText(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    if (isCoreConfigured()) {
      const res = await getHttp().requestText(url, { headers, timeoutMs: 8000 });
      return res.ok ? res.text : null;
    }
    const res = await fetch(url, { headers });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const WIKI_API = 'https://en.wiktionary.org/w/api.php?format=json&formatversion=2&origin=*';

async function wikitextOf(title: string): Promise<string | null> {
  const text = await getText(
    `${WIKI_API}&action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&titles=${encodeURIComponent(title)}`,
    { 'Api-User-Agent': UA },
  );
  if (text == null) return null;
  try {
    const page = JSON.parse(text)?.query?.pages?.[0];
    return typeof page?.revisions?.[0]?.slots?.main?.content === 'string' ? page.revisions[0].slots.main.content : '';
  } catch {
    return null;
  }
}

/** A headword template rendered by Wiktionary, for the principal parts it computes. */
async function expandTemplate(title: string, template: string): Promise<string | null> {
  if (!template) return null;
  const text = await getText(
    `${WIKI_API}&action=expandtemplates&prop=wikitext&title=${encodeURIComponent(title)}&text=${encodeURIComponent(template)}`,
    { 'Api-User-Agent': UA },
  );
  try {
    return text ? String(JSON.parse(text)?.expandtemplates?.wikitext || '') : null;
  } catch {
    return null;
  }
}

async function categoryWords(category: string): Promise<string[]> {
  const text = await getText(
    `${WIKI_API}&action=query&list=categorymembers&cmnamespace=0&cmlimit=200&cmtitle=${encodeURIComponent(`Category:${category}`)}`,
    { 'Api-User-Agent': UA },
  );
  return text ? parseCategoryMembers(text) : [];
}

async function etymonline(word: string): Promise<EtymonlineEntry[]> {
  const text = await getText(`https://www.etymonline.com/api/etymology?word=${encodeURIComponent(word)}`, {
    Accept: 'application/json',
  });
  return text ? parseEtymonlineJson(text) : [];
}

/** Words matching Datamuse spelling patterns ("ob*", "*tion", "*fic*"), with frequencies. */
async function frequentWords(patterns: string[]): Promise<Array<{ word: string; freq: number }>> {
  const lists = await Promise.all(
    patterns.slice(0, 8).map(async (p) => {
      const text = await getText(`https://api.datamuse.com/words?sp=${encodeURIComponent(p)}&md=f&max=1000`);
      return text ? parseDatamuse(text) : [];
    }),
  );
  return lists.flat();
}

let bookWords: Promise<Array<{ word: string; freq: number }>> | null = null;

/**
 * The shipped frequency-ordered word lists (NGSL, then the academic list) as candidates with
 * an estimated frequency, so the commonest words built on a part come first offline too.
 * A word in place r of the general list is used about 60000 / r times per million.
 */
function bookCandidates(): Promise<Array<{ word: string; freq: number }>> {
  if (!bookWords) {
    bookWords = Promise.all([loadWordbook('ngsl'), loadWordbook('nawl')])
      .then(([general, academic]) => [
        ...general.map((word, i) => ({ word: word.toLowerCase(), freq: 60000 / (i + 30) })),
        ...academic.map((word, i) => ({ word: word.toLowerCase(), freq: 60000 / (3000 + i * 6) })),
      ])
      .catch((): Array<{ word: string; freq: number }> => []);
  }
  return bookWords;
}

/** Candidates matching the Datamuse patterns, from the shipped lists. */
async function bookMatches(patterns: string[]): Promise<Array<{ word: string; freq: number }>> {
  const res = patterns.map((p) => new RegExp(`^${p.replace(/\*/g, '[a-z]*')}$`));
  return (await bookCandidates()).filter((c) => /^[a-z]+$/.test(c.word) && res.some((r) => r.test(c.word)));
}

/** The Datamuse patterns for a part's spellings. */
export function spellingPatterns(entry: Pick<MorphemeEntry, 'kind' | 'bare' | 'variants'>): string[] {
  const bare = (v: string) => v.replace(/^-|-$/g, '');
  if (entry.kind === 'prefix') return [entry.bare, ...entry.variants.map(bare)].filter((s, i, all) => s.length >= 2 && all.indexOf(s) === i).map((s) => `${s}*`);
  // A suffix page stands for its own spelling: -tion, not every ending the tables join with it.
  if (entry.kind === 'suffix') return [`*${entry.bare}`];
  if (entry.kind === 'root') return [entry.bare, ...entry.variants.map(bare)].filter((s, i, all) => s.length >= 3 && all.indexOf(s) === i).map((s) => `*${s}*`);
  return [];
}

/** Datamuse's frequencies, with the shipped lists for the words it does not return or when it is unreachable. */
async function frequentAndListed(patterns: string[]): Promise<Array<{ word: string; freq: number }>> {
  const [remote, local] = await Promise.all([frequentWords(patterns), bookMatches(patterns)]);
  return [...remote, ...local];
}

function reconstructionTitle(q: MorphemeQuery): string {
  return `Reconstruction:Proto-Indo-European/${q.form.replace(/^\*/, '')}`;
}

const pages = new Map<string, { at: number; result: DictionaryResult }>();
const PAGE_TTL_MS = 30 * 60_000;

/** Fetch and assemble the page. Results with something on them are kept for half an hour. */
export async function lookupMorpheme(q: MorphemeQuery): Promise<DictionaryResult> {
  const base = emptyEntry(q);
  // "-fic-" and "-fac-" are one page.
  const key = q.kind === 'root' && base.tableKey ? `root:${base.tableKey}` : `${q.kind}:${q.form}`;
  const hit = pages.get(key);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.result;
  const src: MorphemeSources = { categories: {} };
  if (q.kind === 'reconstructed') {
    const ekey = etymonlineRootKey(q.form);
    const [wikitext, ety] = await Promise.all([wikitextOf(reconstructionTitle(q)), ekey ? etymonline(ekey) : Promise.resolve([])]);
    src.wikitext = wikitext;
    src.etymonline = ety;
    // Wiktionary's category is the fallback word list when Etymonline has none for a homograph.
    const groups = wikitext ? parseReconstructionPage(wikitext) : [];
    const lacking = groups.filter((g, i) => !matchEtymonline(g, ety, i, groups.length)?.formsPartOf.length);
    await Promise.all(
      lacking.slice(0, 3).map(async (g) => {
        const label = g.id ? `${q.form} (${g.id})` : q.form;
        src.categories![label] = await categoryWords(`English terms derived from the Proto-Indo-European root ${label}`);
      }),
    );
  } else if (q.kind === 'root') {
    const title = ROOT_LEMMA[base.tableKey] || '';
    const ekey = base.pie ? etymonlineRootKey(base.pie) : '';
    const [wikitext, ety, frequent] = await Promise.all([
      title ? wikitextOf(title) : Promise.resolve(null),
      ekey ? etymonline(ekey) : Promise.resolve([]),
      frequentAndListed(spellingPatterns(base)),
    ]);
    const lemma = wikitext ? parseLemmaPage(wikitext, title) : null;
    const headline = lemma ? await expandTemplate(title, lemma.headTemplate) : null;
    src.lemma = { title, wikitext, headline };
    src.etymonline = ety;
    src.frequent = frequent;
    // The PIE root Wiktionary names, when the tables have none.
    if (!ekey && lemma?.pie) src.etymonline = await etymonline(etymonlineRootKey(lemma.pie));
  } else {
    const [wikitext, ety, frequent] = await Promise.all([wikitextOf(q.form), etymonline(q.form), frequentAndListed(spellingPatterns(base))]);
    src.wikitext = wikitext;
    src.etymonline = ety;
    src.frequent = frequent;
    const page = wikitext ? parseAffixPage(wikitext, q, base.origin) : null;
    if (page) src.categories![page.category] = await categoryWords(page.category);
  }
  const result = morphemeResult(q, buildMorphemeEntry(q, src));
  if (result.definitions.length) pages.set(key, { at: Date.now(), result });
  return result;
}

