/**
 * Lookup pages for word parts: prefixes ("ob-"), suffixes ("-ant"), classical roots ("-fac-")
 * and reconstructed Proto-Indo-European roots ("*bʰeh₂-").
 *
 * A query's shape says what it is, the way Wiktionary titles them: a trailing hyphen is a
 * prefix, a leading one a suffix, both a root inside a word, and a leading asterisk a
 * reconstructed form. The page carries what Wiktionary, Etymonline and Merriam-Webster show
 * for an affix or a root: its senses, variants (the assimilated ob-, oc-, of-, op-), where it
 * comes from, usage notes, and the words built on it. For an affix those are Wiktionary's
 * "English terms prefixed with ob-" category; for a PIE root, Etymonline's curated "It might
 * form all or part of" list, with the descendants from Wiktionary's reconstruction page.
 *
 * The result is an ordinary DictionaryResult (senses, IPA, etymology tabs), with the
 * morpheme's own data under `metadata.morpheme` for the sections only a word part has.
 */
import { analyzeMorphemes, type Morph } from './morphology';
import { buildEtymology, extractLanguageSection, languageName, scanTemplates } from './etymology';
import { extractIpaFromWikitext, type Pronunciation } from './pronunciation';
import { cmuKnownSync } from './cmu-ipa';
import { getHttp, isCoreConfigured } from './runtime';
import type { Definition, DictionaryResult } from './dictionary';

type RawTemplate = ReturnType<typeof scanTemplates>[number];

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
  /** The table's canonical form: "ob-", "-sion", "fac". */
  key: string;
  gloss: string;
  origin: string;
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
  senses: Array<{ text: string; examples: string[] }>;
  /** English words built on it, most common first. */
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
  /** Other spellings with their hyphens: ["oc-", "op-"]. */
  variants: string[];
  usage: string;
  related: string[];
  groups: MorphemeGroup[];
  sources: string[];
}

const LETTER_RUN = /^[\p{L}\p{M}]+$/u;
const RECONSTRUCTED = /^[\p{L}\p{M}ʰ-˿₀-₉()-]+$/u;

/** The word part a query names, or null for an ordinary word or phrase. */
export function parseMorphemeQuery(text: string): MorphemeQuery | null {
  const s = String(text || '')
    .normalize('NFC')
    .trim()
    .replace(/[‐‑‒–−]/g, '-');
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

/*
 * morphology.ts exports the analysis, not its tables, so the tables are read through it:
 * the part is placed in a carrier word where nothing else matches, and the analysis must
 * return exactly that span. Replace with a direct table export when one exists.
 */
const PROBE_STEM = 'struct';

function probe(word: string, kind: TableMorph['kind'], start: number, end: number): TableMorph | null {
  const hit = analyzeMorphemes(word).find((x) => x.kind === kind && x.start === start && x.end === end);
  return hit ? { kind, key: hit.label, gloss: hit.gloss, origin: hit.origin } : null;
}

/** The table's entry for a part, or null when Phevere's tables do not list it. */
export function tableMorph(kind: TableMorph['kind'], bare: string): TableMorph | null {
  const b = String(bare || '').toLowerCase();
  if (!/^[a-z]{1,12}$/.test(b)) return null;
  if (kind === 'prefix') return probe(b + PROBE_STEM, 'prefix', 0, b.length);
  if (kind === 'suffix') return probe(PROBE_STEM + b, 'suffix', PROBE_STEM.length, PROBE_STEM.length + b.length);
  if (b.length < 2) return null;
  return probe(`x${b}x`, 'root', 1, b.length + 1) || probe(`${b}xxx`, 'root', 0, b.length);
}

/**
 * Other spellings the tables give one prefix or root: the assimilated oc- and op- of ob-, the
 * fic and fact of fac. Found by trying every spelling one letter away; suffix entries are
 * left out because the tables join endings that are separate pages (-ant and -ent).
 */
export function tableVariants(kind: TableMorph['kind'], bare: string): string[] {
  const b = String(bare || '').toLowerCase();
  if (kind === 'suffix' || !/^[a-z]{2,12}$/.test(b)) return [];
  const key = tableMorph(kind, b)?.key;
  if (!key) return [];
  const seen = new Set<string>([b]);
  const out: string[] = [];
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const tryForm = (c: string) => {
    if (seen.has(c) || c.length < 2) return;
    seen.add(c);
    if (tableMorph(kind, c)?.key === key) out.push(c);
  };
  for (let i = 0; i <= b.length; i++) {
    for (const ch of letters) {
      if (i < b.length) tryForm(b.slice(0, i) + ch + b.slice(i + 1));
      tryForm(b.slice(0, i) + ch + b.slice(i));
    }
    if (i < b.length) tryForm(b.slice(0, i) + b.slice(i + 1));
  }
  const keyBare = key.replace(/^-|-$/g, '');
  if (keyBare !== b && !out.includes(keyBare)) out.unshift(keyBare);
  return out;
}

/**
 * Word parts a plain word also spells, offered as a link on its page: "con" is a form of
 * co-, "form" a Latin root, "able" a suffix. Roots first, then prefixes, then suffixes.
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

export function morphemeKindLabel(kind: MorphemeKind): string {
  return kind === 'reconstructed' ? 'root' : kind;
}

/* ------------------------------------------------------------------ wikitext */

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const LINK_TEMPLATES = new Set(['l', 'm', 'll', 'l-self', 'm-self', 'mention', 'link', 'alter', 'alt', 'll-lite']);

function templateText(t: RawTemplate): string {
  const p = t.positional;
  switch (t.name) {
    case 'lb':
    case 'lbl':
    case 'label': {
      const labels = p.slice(1).filter((x) => x && x !== '_' && x !== 'and' && x !== 'or');
      return labels.length ? `(${labels.join(', ')})` : '';
    }
    case 'n-g':
    case 'ng':
    case 'non-gloss':
    case 'non-gloss definition':
    case 'gloss':
    case 'gl':
      return wikiInline(p[0] || '');
    case 'q':
    case 'qual':
    case 'qualifier':
    case 'i':
    case 'sense':
    case 's':
      return p.length ? `(${p.map(wikiInline).join(', ')})` : '';
    case 'w':
      return wikiInline(t.named.alt || p[1] || p[0] || '');
    case 'ux':
    case 'uxi':
    case 'usex':
    case 'eg':
      return wikiInline(p[1] || '') + (t.named.t ? ` (${wikiInline(t.named.t)})` : '');
    case 'suffixusex':
    case 'prefixusex':
    case 'affixusex':
    case 'afex':
      return p.slice(1).filter(Boolean).slice(-2).join(' → ');
    default:
      if (LINK_TEMPLATES.has(t.name)) return wikiInline(t.named.alt || p[2] || p[1] || '');
      if (/ of$/.test(t.name) && p[1]) return `${capitalize(t.name)} ${p[1]}`;
      return '';
  }
}

/** One line of wikitext as reading text: templates rendered, links and markup dropped. */
export function wikiInline(s: string): string {
  let out = String(s || '');
  for (const t of scanTemplates(out)) out = out.split(t.source).join(templateText(t));
  return out
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?(?:<\/ref>|$)/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#45;/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim();
}

/** The body under a heading (any level), up to the next heading of the same or higher level. */
function sectionBody(text: string, name: string): string {
  const re = new RegExp(`^(={3,6})\\s*${name}\\s*\\1\\s*$`, 'im');
  const m = re.exec(text);
  if (!m) return '';
  const level = m[1].length;
  const rest = text.slice(m.index + m[0].length);
  const next = new RegExp(`^={2,${level}}[^=\\n][^\\n]*$`, 'm').exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/**
 * Terms linked in a section ({{l|en|-ion}}, {{alter|la|obs-|op-}}, [[-ize]]), in order. With
 * `firstPerLine`, only the bullet's own term counts, not the "(as in {{m|en|complexion}})" after it.
 */
function sectionTerms(body: string, lang: string, firstPerLine = false): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    const term = wikiInline(w).replace(/#.*$/, '').trim();
    if (term && !out.includes(term) && !/[|=:]/.test(term)) out.push(term);
  };
  for (const line of firstPerLine ? body.split('\n') : [body]) {
    for (const t of scanTemplates(line)) {
      if (!LINK_TEMPLATES.has(t.name) || t.positional[0] !== lang) continue;
      if (t.name === 'alter' || t.name === 'alt') {
        for (const x of t.positional.slice(1)) {
          if (!x) break;
          add(x);
        }
      } else if (t.positional[1]) {
        add(t.positional[1]);
      }
      if (firstPerLine) break;
    }
  }
  for (const m of body.replace(/\{\{[\s\S]*?\}\}/g, '').matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) add(m[1]);
  return out;
}

/** Whether a term is spelled as the same kind of part: "oc-" for a prefix, "-ion" for a suffix. */
function sameShape(term: string, kind: MorphemeKind): boolean {
  if (kind === 'prefix') return /^\p{L}[\p{L}\p{M}]*-$/u.test(term);
  if (kind === 'suffix') return /^-\p{L}[\p{L}\p{M}]*$/u.test(term);
  return true;
}

/** Senses ("# …") under the first heading named one of `pos`, with their "#:" examples. */
function sensesUnder(text: string, pos: string[]): Array<{ text: string; examples: string[] }> {
  const re = new RegExp(`^(={3,6})\\s*(?:${pos.join('|')})(?:\\s+\\d+)?\\s*\\1\\s*$`, 'gim');
  const out: Array<{ text: string; examples: string[] }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length);
    const next = /^=+[^=\n][^\n]*$/m.exec(rest);
    const body = next ? rest.slice(0, next.index) : rest;
    for (const line of body.split('\n')) {
      if (/^#\s*[^:*#]/.test(line)) {
        const sense = wikiInline(line.replace(/^#\s*/, ''));
        if (sense) out.push({ text: sense, examples: [] });
      } else if (/^#:\s*/.test(line) && out.length) {
        const ex = wikiInline(line.replace(/^#:\s*/, ''));
        if (ex && ex.length < 160) out[out.length - 1].examples.push(ex);
      }
    }
  }
  return out;
}

const AFFIX_POS = ['Prefix', 'Suffix', 'Infix', 'Interfix', 'Circumfix', 'Combining form', 'Affix', 'Root'];

export interface AffixPage {
  senses: Array<{ text: string; examples: string[] }>;
  pronunciations: Pronunciation[];
  etymology: string;
  variants: string[];
  usage: string;
  related: string[];
  /** Category of words built on it, from {{prefixsee}} / {{suffixsee}}. */
  category: string;
}

/** The English entry of an affix page ("ob-", "-ant"); null when the page has none. */
export function parseAffixPage(wikitext: string, q: MorphemeQuery): AffixPage | null {
  if (!/^==\s*English\s*==\s*$/m.test(wikitext || '')) return null;
  const en = extractLanguageSection(wikitext, 'English');
  const senses = sensesUnder(en, AFFIX_POS);
  if (!senses.length) return null;
  const latin = extractLanguageSection(wikitext, 'Latin');
  const fromLatin = /\{\{\s*(?:der|bor|lbor|inh)\+?\s*\|\s*en\s*\|\s*la\s*\|/.test(en) || /\{\{\s*etymon\|en\|[^}]*\bla:/.test(en);
  const variants = sectionTerms(sectionBody(en, 'Alternative forms'), 'en', true);
  if (fromLatin && latin) {
    for (const v of sectionTerms(sectionBody(latin, 'Alternative forms'), 'la', true)) if (!variants.includes(v)) variants.push(v);
  }
  const usageRaw = sectionBody(en, 'Usage notes') || (fromLatin ? sectionBody(latin, 'Usage notes') : '');
  const usage = usageRaw
    .split('\n')
    .map((l) => wikiInline(l.replace(/^[*#:]+\s*/, '')))
    .filter(Boolean)
    .join(' ')
    .slice(0, 480);
  const related = [
    ...sectionTerms(sectionBody(en, 'Related terms'), 'en'),
    ...sectionTerms(sectionBody(en, 'Synonyms'), 'en'),
    ...sectionTerms(sectionBody(en, 'See also'), 'en'),
  ].filter((w, i, all) => all.indexOf(w) === i && w !== q.form);
  let category = '';
  for (const t of scanTemplates(en)) {
    if (t.name !== 'prefixsee' && t.name !== 'suffixsee' && t.name !== 'affixsee') continue;
    const id = t.named.id ? ` (${t.named.id})` : '';
    category = `English terms ${t.name === 'prefixsee' ? 'prefixed' : 'suffixed'} with ${q.form}${id}`;
    break;
  }
  if (!category) category = `English terms ${q.kind === 'prefix' ? 'prefixed' : 'suffixed'} with ${q.form}`;
  return {
    senses,
    pronunciations: extractIpaFromWikitext(en),
    etymology: buildEtymology(wikitext)?.text || '',
    variants: variants.filter((v) => v !== q.form && sameShape(v, q.kind)),
    usage,
    related,
    category,
  };
}

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

/** Common words before rare ones (the pronouncing dictionary lists common words), then shorter. */
export function rankDerived(words: string[], limit = 48): string[] {
  const seen = new Set<string>();
  const scored = words
    .filter((w) => {
      const k = w.toLowerCase();
      if (seen.has(k) || /^\p{Lu}/u.test(w) || /\d/.test(w)) return false;
      seen.add(k);
      return true;
    })
    .map((w, i) => ({ w, i, s: (cmuKnownSync(w.toLowerCase()) ? 0 : 100) + w.length }));
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.w);
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
    .replace(/[̀-ͯ]/g, '')
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
      const gloss = ((text.match(/root meaning "([^"]+)"/) || text.match(/meaning "([^"]+)"/) || [])[1] || '').replace(/[.,;:]+$/, '');
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

function reconstructionTitle(q: MorphemeQuery): string {
  return `Reconstruction:Proto-Indo-European/${q.form.replace(/^\*/, '')}`;
}

/** What the page needs, fetched in parallel. Pure assembly lives in buildMorphemeEntry. */
export interface MorphemeSources {
  wikitext?: string | null;
  categories?: Record<string, string[]>;
  etymonline?: EtymonlineEntry[];
}

function emptyEntry(q: MorphemeQuery): MorphemeEntry {
  const table = q.kind === 'reconstructed' ? null : tableMorph(q.kind, q.bare);
  return {
    kind: q.kind,
    form: q.form,
    head: q.kind === 'root' ? q.bare : q.form,
    bare: q.bare,
    origin: q.kind === 'reconstructed' ? 'Proto-Indo-European' : table?.origin || '',
    gloss: table?.gloss || '',
    tableKey: table?.key || '',
    variants:
      q.kind === 'prefix' ? tableVariants('prefix', q.bare).map((v) => `${v}-`) : q.kind === 'root' ? tableVariants('root', q.bare) : [],
    usage: '',
    related: [],
    groups: [],
    sources: [],
  };
}

/** The page, from what the sources returned. */
export function buildMorphemeEntry(
  q: MorphemeQuery,
  src: MorphemeSources,
): { entry: MorphemeEntry; pronunciations: Pronunciation[]; etymology: string } {
  const entry = emptyEntry(q);
  let pronunciations: Pronunciation[] = [];
  const etymologyParts: string[] = [];
  const ety = src.etymonline || [];
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
      if (!g.derived.length && cat) g.derived = rankDerived(cat);
    });
    // Etymonline knows the root although Wiktionary's page could not be read.
    if (!groups.length) {
      for (const e of ety) {
        groups.push({
          id: e.property.replace(/[()]/g, ''),
          senses: e.gloss ? [{ text: e.gloss, examples: [] }] : [],
          derived: e.formsPartOf,
          descendants: [],
          formations: [],
          sourceOf: e.sourceOf,
        });
      }
    }
    if (ety.length) entry.sources.push('Etymonline');
    // Homographs (*bʰeh₂- "shine" and "speak") each give their meaning.
    const glosses = ety.map((e) => e.gloss).filter((g, i, all) => g && all.indexOf(g) === i);
    entry.gloss = glosses.join('; ') || groups.map((g) => g.senses[0]?.text || '').filter(Boolean).join('; ');
    entry.groups = groups;
    for (const e of ety) etymologyParts.push(`[Etymonline]\n${[e.word, e.property].filter(Boolean).join(' ')}: ${e.text}`);
  } else if (q.kind === 'root') {
    // Classical roots have no Wiktionary entry of their own; the tables give the meaning.
    if (entry.gloss) entry.groups.push({ id: '', senses: [{ text: entry.gloss, examples: [] }], derived: [], descendants: [], formations: [], sourceOf: '' });
  } else {
    const page = src.wikitext ? parseAffixPage(src.wikitext, q) : null;
    const group: MorphemeGroup = { id: '', senses: [], derived: [], descendants: [], formations: [], sourceOf: '' };
    if (page) {
      entry.sources.push('Wiktionary');
      group.senses = page.senses;
      for (const v of page.variants) if (!entry.variants.includes(v)) entry.variants.push(v);
      entry.usage = page.usage;
      entry.related = page.related;
      pronunciations = page.pronunciations;
      if (page.etymology) etymologyParts.push(`[Wiktionary]\n${page.etymology}`);
      const cat = src.categories?.[page.category];
      if (cat) group.derived = rankDerived(cat.filter((w) => w.toLowerCase() !== q.form));
    }
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
  const pos = morphemeKindLabel(entry.kind);
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

const pages = new Map<string, { at: number; result: DictionaryResult }>();
const PAGE_TTL_MS = 30 * 60_000;

/** Fetch and assemble the page. Results with something on them are kept for half an hour. */
export async function lookupMorpheme(q: MorphemeQuery): Promise<DictionaryResult> {
  const key = `${q.kind}:${q.form}`;
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
  } else if (q.kind !== 'root') {
    const [wikitext, ety] = await Promise.all([wikitextOf(q.form), etymonline(q.form)]);
    src.wikitext = wikitext;
    src.etymonline = ety;
    const page = wikitext ? parseAffixPage(wikitext, q) : null;
    if (page) src.categories![page.category] = await categoryWords(page.category);
  }
  const result = morphemeResult(q, buildMorphemeEntry(q, src));
  if (result.definitions.length) pages.set(key, { at: Date.now(), result });
  return result;
}
