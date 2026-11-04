/**
 * Grammatical forms of a word: tenses and participles for verbs, the plural of English nouns,
 * cases for nouns in languages that decline them, degrees for adjectives, and "plural of mouse"
 * when the looked-up word is itself a form. A word that is itself a form gets no forms of its
 * own ("paparazzi" has no plural "paparazzis"); its lemma's stand in.
 *
 * The data is Wiktextract's (kaikki.org) parse of Wiktionary inflection tables, the same
 * tables a reader sees on Wiktionary, already tagged (["past", "participle"], ["genitive",
 * "plural"]). Archaic, dialectal, nonstandard and alternative spellings are left out; a form
 * Wiktionary marks rare, uncommon, dated or hypercorrect is shown with that label. Possessives
 * are not listed, as learner dictionaries do not list them. When Wiktionary gives two forms
 * without a label (paparazzi and paparazzos), Datamuse's word frequencies decide: a form under
 * half as common as the first is marked "less common", and one Datamuse barely knows is dropped.
 */

import type { HttpClient } from './http';
import { fetchKaikkiPage, kaikkiDirectory } from './multilingual-sources';
import { wordFrequencies } from './form-of';

export interface InflectionRow {
  label: string;
  forms: string[];
  /** A label per form, '' for none: "rare", "less common". */
  notes?: string[];
  /** The forms belong to different persons ("am, are"), so they are not weighed against each other. */
  distinct?: boolean;
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
  'archaic', 'obsolete', 'dialectal', 'nonstandard', 'alternative', 'romanization',
  'table-tags', 'inflection-template', 'class', 'colloquial', 'misspelling', 'proscribed',
  'poetic', 'humorous', 'pronunciation-spelling', 'Ruhrdeutsch', 'Berlinisch', 'error-unrecognized-form',
  'multiword-construction', 'canonical', 'diminutive', 'augmentative', 'pejorative', 'collective',
  'relational', 'adjective', 'masculine', 'feminine', 'neuter', 'informal',
]);
/** Tags shown beside an English form rather than hiding it, in the order they are named. */
const NOTE_TAGS = ['rare', 'uncommon', 'dated', 'hypercorrect'];

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

/** `noted`: a form Wiktionary marks rare, dated and the like may stay, to be shown with its label. */
function usable(f: KaikkiForm, word: string, noted = false): boolean {
  const form = String(f.form || '').trim();
  // Contractions ("'s", "'re") are not forms a dictionary lists.
  if (!form || form === '-' || /^['’]/.test(form) || /\+|\bpast participle\b/.test(form)) return false;
  const tags = f.tags || [];
  if (!tags.length) return false;
  if (tags.some((t) => SKIP_TAGS.has(t))) return false;
  if (!noted && tags.some((t) => NOTE_TAGS.includes(t))) return false;
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

/**
 * An English row: forms Wiktionary gives without a label first, then those it marks rare, dated
 * and the like, each with its label.
 */
function notedRow(label: string, forms: KaikkiForm[], pick: (f: KaikkiForm) => boolean): InflectionRow | null {
  const plain: string[] = [];
  const marked: Array<[string, string]> = [];
  for (const f of forms) {
    if (!pick(f)) continue;
    const form = String(f.form).trim();
    const notes = NOTE_TAGS.filter((t) => (f.tags || []).includes(t));
    // Marked twice over ("octopii": hypercorrect and rare) is not worth a learner's attention.
    if (notes.length > 1) continue;
    const note = notes[0] || '';
    if (!note) {
      if (!plain.includes(form)) plain.push(form);
      const i = marked.findIndex(([m]) => m === form);
      if (i >= 0) marked.splice(i, 1);
    } else if (!plain.includes(form) && !marked.some(([m]) => m === form)) {
      marked.push([form, note]);
    }
  }
  const all = [...plain.map((f): [string, string] => [f, '']), ...marked].slice(0, 3);
  if (!all.length) return null;
  const out: InflectionRow = { label, forms: all.map(([f]) => f) };
  if (all.some(([, n]) => n)) out.notes = all.map(([, n]) => n);
  return out;
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
  const okNoted = forms.filter((f) => usable(f, word, true));
  const rows: InflectionRow[] = [];
  const grids: InflectionGrid[] = [];
  const row = (label: string, list: string[]) => {
    if (list.length) rows.push({ label, forms: list.slice(0, 3) });
  };
  const en = (label: string, pick: (f: KaikkiForm) => boolean) => {
    const r = notedRow(label, okNoted, pick);
    if (r) rows.push(r);
  };
  const finite = (f: KaikkiForm) => hasNone(f, 'participle', 'subjunctive', 'imperative', 'negative');
  if (pos === 'verb') {
    if (lang === 'en') {
      // "be" alone has present forms other than its own: am, are.
      const present = collect(ok, (f) => has(f, 'present') && finite(f) && (has(f, 'first-person', 'singular') || (has(f, 'plural') && hasNone(f, 'first-person', 'second-person', 'third-person'))))
        .filter((f) => f.toLowerCase() !== word.toLowerCase());
      if (present.length) rows.push({ label: 'Present', forms: present.slice(0, 3), distinct: true });
      en('Third-person singular', (f) => has(f, 'present', 'singular', 'third-person') && finite(f));
      en('Present participle', (f) => has(f, 'present', 'participle'));
      en('Past', (f) => has(f, 'past') && finite(f));
      // "was, were" are different persons, not two spellings of one form.
      const personal = (f: KaikkiForm) => ['first-person', 'second-person', 'third-person', 'plural'].some((t) => has(f, t));
      const past = rows.find((r) => r.label === 'Past');
      if (past && past.forms.some((form) => !okNoted.some((f) => String(f.form).trim() === form && has(f, 'past') && finite(f) && !personal(f)))) past.distinct = true;
      en('Past participle', (f) => has(f, 'past', 'participle'));
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
    else if (lang === 'en') {
      // A plural spelt like the singular counts when Wiktionary gives it first ("fish, fishes"), not
      // when it trails the others ("cactus" after cacti and cactuses).
      const plural = (f: KaikkiForm) => has(f, 'plural') && hasNone(f, ...CASES);
      const first = okNoted.find(plural);
      const zeroFirst = !!first && String(first.form).trim().toLowerCase() === word.toLowerCase();
      en('Plural', (f) => plural(f) && (zeroFirst || String(f.form).trim().toLowerCase() !== word.toLowerCase()));
    } else {
      row('Plural', collect(ok, (f) => has(f, 'plural') && hasNone(f, ...CASES)));
      row('Genitive', collect(ok, (f) => has(f, 'genitive') && hasNone(f, 'plural')));
    }
  } else if (pos === 'adjective' || pos === 'adverb') {
    if (lang === 'en') {
      en('Comparative', (f) => has(f, 'comparative'));
      en('Superlative', (f) => has(f, 'superlative'));
    } else {
      row('Comparative', collect(ok, (f) => has(f, 'comparative')));
      row('Superlative', collect(ok, (f) => has(f, 'superlative')));
    }
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
  let nounHint = '';
  const entries: any[] = [];
  for (const line of (jsonl || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const entry = JSON.parse(t);
      if (!(lang && entry?.lang_code && entry.lang_code !== lang)) entries.push(entry);
    } catch {
      /* skip the line */
    }
  }
  const isForm = (s: any) => Array.isArray(s?.form_of) && s.form_of.length > 0;
  // A sense a learner dictionary leaves out: obsolete, dialectal, or limited to a region ("Geordie").
  const minor = (s: any) => (s?.tags || []).some((t: string) => MINOR_SENSE.test(t) || /^[A-Z]/.test(t));
  // "Alternative form of paparazzo" is a form too, though Wiktextract files it under alt_of.
  const isSpelling = (s: any) =>
    Array.isArray(s?.alt_of) && s.alt_of.length > 0 && (s.tags || []).some((t: string) => t === 'alternative' || t === 'misspelling') && !minor(s);
  // Where the word is also a form of another in that part of speech, a row that only repeats the
  // word goes: "glasses" (spectacles) has no plural "glasses". A homograph keeps its own table:
  // "found" (to establish) still has founded.
  const formPos = new Set(
    entries.filter((e) => isForm(e?.senses?.[0]) && !minor(e.senses[0])).map((e) => POS_NAME[String(e?.pos || '')] || ''),
  );
  for (const entry of entries) {
    const pos = POS_NAME[String(entry?.pos || '')] || '';
    const senses: any[] = Array.isArray(entry?.senses) ? entry.senses : [];
    const formSenses = senses.filter(isForm);
    // A word is a form when its first sense says so ("running": present participle of run).
    if (formSenses.length && senses[0] === formSenses[0]) {
      // "went" is the past of go; that it is also a nonstandard past participle of go, and the
      // archaic past of wend, is left out.
      const major = formSenses.filter((s) => !minor(s));
      for (const s of (major.length ? major : formSenses).slice(0, 3)) {
        const lemma = String(s.form_of[0]?.word || '').trim();
        const label = formLabel(Array.isArray(s.tags) ? s.tags : []);
        if (lemma && lemma !== word && !out.formOf.some((f) => f.lemma === lemma && f.label === label)) {
          out.formOf.push({ lemma, label: label || 'form', pos });
        }
      }
      continue;
    }
    if (isSpelling(senses[0]) && pos) {
      const lemma = String(senses[0].alt_of[0]?.word || '').trim();
      const gloss = String(senses[0].glosses?.[0] || '');
      const label = (senses[0].tags || []).includes('misspelling') ? 'misspelling' : /\bform\b/i.test(gloss) ? 'alternative form' : 'alternative spelling';
      if (lemma && lemma !== word && !out.formOf.some((f) => f.lemma === lemma)) out.formOf.push({ lemma, label, pos });
      continue;
    }
    if (!pos) continue;
    const weight = senses.filter((x) => !(Array.isArray(x?.tags) ? x.tags : []).some((t: string) => MINOR_SENSE.test(t))).length;
    if (seenPos.has(pos)) {
      // Another noun spelt the same with its own plural: "die" the tool has dies, the cube dice.
      if (pos === 'noun' && lang === 'en' && weight > 0) {
        const other = tableFor(pos, Array.isArray(entry?.forms) ? entry.forms : [], word, lang, weight);
        const prev = out.tables.find((t) => t.pos === 'noun');
        const prevPlural = prev?.rows.find((r) => r.label.startsWith('Plural'));
        const plural = other?.rows.find((r) => r.label === 'Plural');
        const listed = (prev?.rows || []).filter((r) => r.label.startsWith('Plural')).flatMap((r) => r.forms);
        if (prev && prevPlural && plural && plural.forms.some((f) => !listed.includes(f))) {
          if (prevPlural.label === 'Plural' && nounHint) prevPlural.label = `Plural (${nounHint})`;
          const hint = senseHint(senses);
          prev.rows.push({ ...plural, label: hint ? `Plural (${hint})` : 'Plural' });
        }
      }
      continue;
    }
    let table = tableFor(pos, Array.isArray(entry?.forms) ? entry.forms : [], word, lang, weight);
    if (table && pos === 'noun' && formPos.has(pos)) {
      const rows = table.rows.filter((r) => r.forms.some((f) => f.toLowerCase() !== word.toLowerCase()));
      table = rows.length || table.grids.length ? { ...table, rows } : null;
    }
    if (table) {
      out.tables.push(table);
      seenPos.add(pos);
      if (pos === 'noun') nounHint = senseHint(senses);
    }
  }
  return out;
}

/** A few words naming a sense, for telling two nouns apart: "isohedral polyhedron". */
function senseHint(senses: any[]): string {
  const s = senses.find((x) => !(x?.tags || []).some((t: string) => MINOR_SENSE.test(t)) && x?.glosses?.length) || senses[0];
  const gloss = String(s?.glosses?.[0] || '')
    .replace(/^\([^)]*\)\s*/, '')
    .split(/[,;:(.]/)[0]
    .replace(/^(?:an?|any|the|one)\s+/i, '')
    .trim();
  const words = gloss.split(/\s+/).slice(0, 5);
  while (words.length > 1 && /^(?:a|an|the|of|for|to|in|on|with|or|and|that|which)$/i.test(words[words.length - 1])) words.pop();
  return words.join(' ');
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

/** English rows with two or more forms Wiktionary gives without a label. */
function unlabelledAlternatives(tables: InflectionTable[]): string[] {
  const out: string[] = [];
  for (const t of tables) {
    for (const r of t.rows) {
      const plain = r.forms.filter((_, i) => !r.notes?.[i]);
      if (plain.length > 1) out.push(...plain);
    }
  }
  return [...new Set(out)];
}

/**
 * Weighs forms Wiktionary lists side by side without a label by how often each is written
 * (`freq`, per million words): the most common comes first, one under half as common is marked
 * "less common", and one under a fiftieth as common, or unknown to the frequency list, is dropped
 * ("paparazzos" beside paparazzi). A row whose forms are missing from `freq` is left as it is.
 */
export function weighForms(tables: InflectionTable[], freq: Map<string, number>): InflectionTable[] {
  return tables.map((t) => ({
    ...t,
    rows: t.rows.map((r) => {
      const plainIdx = r.forms.map((_, i) => i).filter((i) => !r.notes?.[i]);
      if (r.distinct || plainIdx.length < 2 || !plainIdx.every((i) => freq.has(r.forms[i]))) return r;
      const top = Math.max(...plainIdx.map((i) => freq.get(r.forms[i]) || 0));
      if (top <= 0) return r;
      const items = r.forms.map((form, i) => ({ form, note: r.notes?.[i] || '', f: plainIdx.includes(i) ? freq.get(form) || 0 : -1 }));
      const plain = items.filter((x) => x.f >= 0 && x.f >= top / 50).sort((a, b) => b.f - a.f);
      for (const x of plain) if (x.f < top / 2) x.note = 'less common';
      const kept = [...plain, ...items.filter((x) => x.f < 0)];
      const out: InflectionRow = { label: r.label, forms: kept.map((x) => x.form) };
      if (kept.some((x) => x.note)) out.notes = kept.map((x) => x.note);
      return out;
    }),
  }));
}

async function weighed(http: HttpClient, tables: InflectionTable[] | undefined, lang: string): Promise<InflectionTable[] | undefined> {
  if (!tables?.length || lang !== 'en') return tables;
  const words = unlabelledAlternatives(tables);
  if (!words.length) return tables;
  try {
    return weighForms(tables, await wordFrequencies(http, words.slice(0, 8)));
  } catch {
    return tables;
  }
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
  own.tables = (await weighed(http, own.tables, lang)) || [];
  own.lemmaTables = await weighed(http, own.lemmaTables, lang);
  return hasInflections(own) || own.lemmaTables?.length ? own : null;
}
