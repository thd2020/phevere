/**
 * Grammatical forms of a word: tenses and participles for verbs, plural and possessive for
 * English nouns, cases for nouns in languages that decline them, degrees for adjectives,
 * and "plural of mouse" when the looked-up word is itself a form.
 *
 * The data is Wiktextract's (kaikki.org) parse of Wiktionary inflection tables, the same
 * tables a reader sees on Wiktionary, already tagged (["past", "participle"], ["genitive",
 * "plural"]). Archaic, dialectal, nonstandard and alternative spellings are left out.
 */

import type { HttpClient } from './http';
import { fetchKaikkiPage, kaikkiDirectory } from './multilingual-sources';

export interface InflectionRow {
  label: string;
  forms: string[];
}

/** A grid such as cases by number or persons by number. */
export interface InflectionGrid {
  caption: string;
  columns: string[];
  rows: Array<{ label: string; cells: string[][] }>;
}

export interface InflectionTable {
  pos: string;
  rows: InflectionRow[];
  grids: InflectionGrid[];
  /** Senses of this part of speech that are not rare, archaic or dialectal. */
  weight: number;
  /** Set when these are the forms of the lemma, not of the looked-up word ("mouse" for "mice"). */
  lemma?: string;
}

export interface WordInflections {
  /** The looked-up word is a form of these lemmas: "mice" → plural of "mouse". */
  formOf: Array<{ lemma: string; label: string; pos: string }>;
  /** Tables for the word itself, or for its lemma when it is a form. */
  tables: InflectionTable[];
  /** Whose tables these are, when they belong to the lemma rather than the word. */
  tablesFor?: string;
  /** The lemma's tables, fetched when the word is a form ("mouse" for "mice"). */
  lemmaTables?: InflectionTable[];
}

interface KaikkiForm {
  form?: string;
  tags?: string[];
}

const SKIP_TAGS = new Set([
  'archaic', 'obsolete', 'dialectal', 'nonstandard', 'rare', 'alternative', 'romanization',
  'table-tags', 'inflection-template', 'class', 'colloquial', 'misspelling', 'proscribed',
  'poetic', 'humorous', 'pronunciation-spelling', 'Ruhrdeutsch', 'Berlinisch', 'error-unrecognized-form',
  'multiword-construction', 'canonical', 'diminutive', 'augmentative', 'pejorative', 'collective',
  'relational', 'adjective', 'masculine', 'feminine', 'neuter', 'informal', 'dated', 'uncommon',
]);

const POS_NAME: Record<string, string> = {
  noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb', name: 'proper noun', pron: 'pronoun', det: 'determiner',
};

const CASES = ['nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'prepositional', 'locative', 'ablative', 'vocative'];
const PERSONS: Array<[string, string]> = [
  ['first-person', '1st'],
  ['second-person', '2nd'],
  ['third-person', '3rd'],
];

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function usable(f: KaikkiForm, word: string): boolean {
  const form = String(f.form || '').trim();
  if (!form || form === '-' || /\+|\bpast participle\b/.test(form)) return false;
  const tags = f.tags || [];
  if (!tags.length) return false;
  if (tags.some((t) => SKIP_TAGS.has(t))) return false;
  // Pronunciation-only rows (IPA in the form slot).
  if (/^[\p{Script=Latin}\p{M}]*[ɑɐɒæɔəɛɪʊʌʃʒθðŋɹɾ]/u.test(form) && !/[ɑɐɒæɔəɛɪʊʌʃʒθðŋɹɾ]/u.test(word)) return false;
  return true;
}

function has(f: KaikkiForm, ...tags: string[]): boolean {
  return tags.every((t) => (f.tags || []).includes(t));
}

function hasNone(f: KaikkiForm, ...tags: string[]): boolean {
  return tags.every((t) => !(f.tags || []).includes(t));
}

function collect(forms: KaikkiForm[], pick: (f: KaikkiForm) => boolean): string[] {
  const out: string[] = [];
  for (const f of forms) if (pick(f) && !out.includes(String(f.form).trim())) out.push(String(f.form).trim());
  return out;
}

/** "mouse's", "mice's", "dogs'": English possessives follow spelling, so they are built here. */
export function englishPossessive(form: string, plural = false): string {
  const f = form.trim();
  if (!f) return '';
  return plural && /s$/i.test(f) ? `${f}'` : `${f}'s`;
}

function caseGrid(forms: KaikkiForm[]): InflectionGrid | null {
  const rows: InflectionGrid['rows'] = [];
  for (const c of CASES) {
    const sg = collect(forms, (f) => has(f, c) && (has(f, 'singular') || hasNone(f, 'plural')));
    const pl = collect(forms, (f) => has(f, c, 'plural'));
    if (sg.length || pl.length) rows.push({ label: cap(c), cells: [sg, pl] });
  }
  return rows.length >= 2 ? { caption: 'Cases', columns: ['Singular', 'Plural'], rows } : null;
}

function personGrid(forms: KaikkiForm[], tense: string, caption: string): InflectionGrid | null {
  const rows: InflectionGrid['rows'] = [];
  for (const [tag, label] of PERSONS) {
    const pick = (num: string) =>
      collect(forms, (f) => has(f, tag, num, tense) && hasNone(f, 'subjunctive', 'conditional', 'imperative', 'participle', 'negative'));
    const sg = pick('singular');
    const pl = pick('plural');
    if (sg.length || pl.length) rows.push({ label, cells: [sg, pl] });
  }
  return rows.length >= 2 ? { caption, columns: ['Singular', 'Plural'], rows } : null;
}

const MINOR_SENSE = /^(rare|obsolete|archaic|dialectal|nonstandard|nonce-word|humorous|slang|uncommon|dated|Internet)$/;

function tableFor(pos: string, forms: KaikkiForm[], word: string, lang: string, weight: number): InflectionTable | null {
  const ok = forms.filter((f) => usable(f, word));
  const rows: InflectionRow[] = [];
  const grids: InflectionGrid[] = [];
  const row = (label: string, list: string[]) => {
    if (list.length) rows.push({ label, forms: list.slice(0, 3) });
  };
  if (pos === 'verb') {
    if (lang === 'en') {
      row('Third-person singular', collect(ok, (f) => has(f, 'present', 'singular', 'third-person')));
      row('Present participle', collect(ok, (f) => has(f, 'present', 'participle')));
      row('Past', collect(ok, (f) => has(f, 'past') && hasNone(f, 'participle', 'first-person', 'second-person', 'third-person')));
      row('Past participle', collect(ok, (f) => has(f, 'past', 'participle')));
    } else {
      row('Present participle', collect(ok, (f) => has(f, 'present', 'participle')));
      row('Past participle', collect(ok, (f) => has(f, 'past', 'participle')));
      const present = personGrid(ok.filter((f) => hasNone(f, 'imperfect', 'future', 'past', 'preterite', 'perfect')), 'present', 'Present');
      if (present) grids.push(present);
      const past =
        personGrid(ok, 'preterite', 'Preterite') ||
        personGrid(ok.filter((f) => hasNone(f, 'perfect')), 'past', 'Past') ||
        personGrid(ok, 'imperfect', 'Imperfect');
      if (past) grids.push(past);
    }
  } else if (pos === 'noun' || pos === 'proper noun') {
    const grid = caseGrid(ok);
    if (grid) grids.push(grid);
    else {
      const plural = collect(ok, (f) => has(f, 'plural') && hasNone(f, ...CASES));
      row('Plural', plural);
      if (lang === 'en') {
        row('Possessive', [englishPossessive(word), ...plural.slice(0, 1).map((p) => englishPossessive(p, true))]);
      } else {
        row('Genitive', collect(ok, (f) => has(f, 'genitive') && hasNone(f, 'plural')));
      }
    }
  } else if (pos === 'adjective' || pos === 'adverb') {
    row('Comparative', collect(ok, (f) => has(f, 'comparative')));
    row('Superlative', collect(ok, (f) => has(f, 'superlative')));
  }
  if (!rows.length && !grids.length) return null;
  return { pos, rows, grids, weight };
}

/** Form-of labels as a reader says them: "past participle", "plural". */
function formLabel(tags: string[]): string {
  let keep = tags.filter((t) => !['form-of', 'alt-of', 'error-unrecognized-form'].includes(t));
  if (keep.includes('participle')) keep = keep.filter((t) => t !== 'gerund');
  const order = ['first-person', 'second-person', 'third-person', 'singular', 'plural', 'present', 'past', 'preterite', 'imperfect', 'participle', 'gerund', 'comparative', 'superlative', ...CASES];
  keep.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return keep.join(' ').replace(/-person/g, ' person').trim();
}

/** Parse a kaikki.org JSON Lines page for one language into forms. */
export function inflectionsFromKaikki(jsonl: string, lang: string, word: string): WordInflections {
  const out: WordInflections = { formOf: [], tables: [] };
  const seenPos = new Set<string>();
  for (const line of (jsonl || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let entry: any;
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    if (lang && entry?.lang_code && entry.lang_code !== lang) continue;
    const pos = POS_NAME[String(entry?.pos || '')] || '';
    const senses: any[] = Array.isArray(entry?.senses) ? entry.senses : [];
    const formSenses = senses.filter((s) => Array.isArray(s?.form_of) && s.form_of.length);
    // A word is a form when its first sense says so ("running": present participle of run).
    if (formSenses.length && senses[0] === formSenses[0]) {
      for (const s of formSenses.slice(0, 3)) {
        const lemma = String(s.form_of[0]?.word || '').trim();
        const label = formLabel(Array.isArray(s.tags) ? s.tags : []);
        if (lemma && lemma !== word && !out.formOf.some((f) => f.lemma === lemma && f.label === label)) {
          out.formOf.push({ lemma, label: label || 'form', pos });
        }
      }
      continue;
    }
    if (!pos || seenPos.has(pos)) continue;
    const weight = senses.filter((x) => !(Array.isArray(x?.tags) ? x.tags : []).some((t: string) => MINOR_SENSE.test(t))).length;
    const table = tableFor(pos, Array.isArray(entry?.forms) ? entry.forms : [], word, lang, weight);
    if (table) {
      out.tables.push(table);
      seenPos.add(pos);
    }
  }
  return out;
}

/**
 * Keep the parts of speech the lookup's own senses have, in their order (the senses are
 * ordered by frequency), so a rare reading (a verb "mice") does not get a table. "Form of"
 * stays only where the word has no table of its own in that part of speech; then the
 * lemma's table stands in.
 */
export function selectInflections(raw: WordInflections | null | undefined, posOrder: string[]): WordInflections | undefined {
  if (!raw) return undefined;
  const order = posOrder.map((p) => (p === 'proper noun' ? 'noun' : p)).filter((p, i, a) => p && a.indexOf(p) === i);
  let tables = order.length
    ? raw.tables.filter((t) => order.includes(t.pos)).sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos))
    : raw.tables.filter((t) => t.weight >= 2);
  // A reading with a single minor sense (a verb "mice") gives way to anything stronger.
  if (tables.length > 1 || raw.formOf.length) {
    const strong = tables.filter((t) => t.weight >= 2);
    if (strong.length || raw.formOf.length) tables = strong;
  }
  const formOf = raw.formOf.filter((f) => !tables.some((t) => t.pos === f.pos));
  // The lemma's table for the part of speech the word is a form in: run's for "running".
  const lemmaPos = new Set(formOf.map((f) => f.pos));
  const lemmaTables = (raw.lemmaTables || [])
    .filter((t) => lemmaPos.has(t.pos))
    .map((t) => ({ ...t, lemma: formOf.find((f) => f.pos === t.pos)?.lemma }));
  const out: WordInflections = { formOf, tables: [...lemmaTables, ...tables] };
  if (lemmaTables.length && !tables.length) out.tablesFor = lemmaTables[0].lemma;
  return hasInflections(out) ? out : undefined;
}

export function hasInflections(i?: WordInflections | null): boolean {
  return !!i && (i.formOf.length > 0 || i.tables.length > 0);
}

/**
 * Forms for a word in one language. When the word is itself a form ("mice"), the lemma's
 * page is read too, so the lemma's table can stand in.
 */
export async function fetchInflections(http: HttpClient, word: string, lang: string): Promise<WordInflections | null> {
  const dir = kaikkiDirectory(lang);
  const w = String(word || '').trim();
  if (!dir || !w || w.length > 48 || /\s{2,}/.test(w)) return null;
  const own = inflectionsFromKaikki(await fetchKaikkiPage(http, w, dir), lang, w);
  const lemma = own.formOf.find((f) => !own.tables.some((t) => t.pos === f.pos && t.weight >= 2))?.lemma;
  if (lemma) {
    try {
      own.lemmaTables = inflectionsFromKaikki(await fetchKaikkiPage(http, lemma, dir), lang, lemma).tables;
    } catch {
      /* the word's own forms still stand */
    }
  }
  return hasInflections(own) || own.lemmaTables?.length ? own : null;
}
