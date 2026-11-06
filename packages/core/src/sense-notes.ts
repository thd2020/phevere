/**
 * What a learner's dictionary prints around a gloss, read from Wiktionary's wikitext: grammar
 * codes ("countable", "transitive", "with on or upon"), usage labels ("informal", "UK", "law"),
 * synonyms and opposites under a sense, and collocations. Oxford Learner's, Longman and
 * Cambridge print the grammar in square brackets and the labels in round ones, both before the
 * definition; Wiktionary writes both in one {{lb}} template, so each label is sorted into one or
 * the other here.
 *
 * Wiktionary's definitions API, which supplies the glosses, drops every {{lb}} label and every
 * synonym line. The page's wikitext, which a lookup already fetches for IPA and the word family,
 * has them; its sense lines are matched to the API's glosses by their words.
 */
import { extractLanguageSection, scanTemplates } from './etymology';
import { wikiInline } from './morpheme-wiki';
import { normalizeMeaningForMerge } from './definition-merge';
import { stripSisterProjects } from './lookup-policy';

/** The notes of one sense. Every list holds display text. */
export interface SenseNotes {
  /** "countable", "usually uncountable", "transitive", "with on or upon". */
  grammar?: string[];
  /** "informal", "chiefly UK", "law", "of a person". */
  labels?: string[];
  synonyms?: string[];
  antonyms?: string[];
  /** "make a proposition", "a tempting proposition". */
  collocations?: string[];
}

/**
 * Words {{lb}} joins to the next label with a space instead of a comma ("usually uncountable",
 * "chiefly UK"), as Wiktionary's Module:labels does.
 */
const QUALIFIERS = new Set([
  'also', 'by', 'chiefly', 'especially', 'excluding', 'except', 'extremely', 'frequently', 'including', 'mainly',
  'many', 'markedly', 'mildly', 'mostly', 'now', 'occasionally', 'of', 'often', 'originally', 'possibly',
  'primarily', 'rarely', 'slightly', 'sometimes', 'somewhat', 'strongly', 'than', 'then', 'typically', 'usually',
  'very', 'generally', 'formerly',
]);

/**
 * Short and alternative names {{lb}} accepts, as Wiktionary displays them. Wiktionary keeps some
 * near names apart: "figurative" and "figuratively", "dialect" and "dialectal" are labels of
 * their own, and "trans" means transgender, not transitive.
 */
const ALIASES: Record<string, string> = {
  c: 'countable',
  count: 'countable',
  uc: 'uncountable',
  uncount: 'uncountable',
  'not countable': 'uncountable',
  t: 'transitive',
  tr: 'transitive',
  intr: 'intransitive',
  intrans: 'intransitive',
  ditrans: 'ditransitive',
  refl: 'reflexive',
  attr: 'attributive',
  attrib: 'attributive',
  attributively: 'attributive',
  pred: 'predicative',
  predicatively: 'predicative',
  nc: 'not comparable',
  uncomparable: 'not comparable',
  'pl-only': 'plural only',
  pluralonly: 'plural only',
  'plurale tantum': 'plural only',
  'pluralia tantum': 'plural only',
  'in the plural': 'in the plural',
  'sg-only': 'singular only',
  'singulare tantum': 'singular only',
  inf: 'informal',
  fml: 'formal',
  colloq: 'colloquial',
  obs: 'obsolete',
  fig: 'figurative',
  pejorative: 'derogatory',
  euphemism: 'euphemistic',
  jocular: 'humorous',
  british: 'UK',
  britain: 'UK',
  uk: 'UK',
  us: 'US',
  american: 'US',
  america: 'US',
  au: 'Australia',
  aus: 'Australia',
  australian: 'Australia',
  nz: 'New Zealand',
  ca: 'Canada',
  canadian: 'Canada',
  ie: 'Ireland',
  irish: 'Ireland',
  safr: 'South Africa',
  scottish: 'Scotland',
  indian: 'India',
};

/** Labels about how the word is built into a sentence; the rest say where and how it is used. */
const GRAMMAR = new Set([
  'countable', 'uncountable', 'transitive', 'intransitive', 'ditransitive', 'ambitransitive', 'reflexive',
  'reciprocal', 'ergative', 'impersonal', 'stative', 'copulative', 'auxiliary', 'modal', 'causative',
  'catenative', 'attributive', 'predicative', 'postpositive', 'not comparable', 'comparable', 'plural only',
  'singular only', 'plural', 'singular', 'collective', 'in the plural', 'in the singular', 'passive',
  'in the passive', 'mass noun', 'count noun', 'in the negative', 'in negative constructions', 'in combination',
  'used in the plural', 'with a plural verb', 'with a singular verb', 'object-oriented', 'phrasal',
]);

/** A label that names a pattern: "with on or upon", "+ to-infinitive", "followed by of". */
const PATTERN = /^(?:with|\+|followed by|construed with|used with|takes?|in the (?:plural|singular|passive|negative)|in negative)\b/i;

/** Sister-project boxes and anchors that stand at the start of a sense line; they are not labels. */
const SKIPPED_LEAD = /^(?:wp|wikipedia|pedia|slim-wikipedia|wiki|commons|commonscat|wikispecies|specieslite|wikiquote|wikisource|wikibooks|wikiversity|wikivoyage|wikinews|wikidata|senseid|sid|anchor|tcx|rfclarify|rfdef|rfv-sense|rfd-sense|attention|defdate|c|topics|top|cln|catlangname)$/i;

/** Plain text of a wikitext fragment, with the character references wikiInline leaves ("&emsp;"). */
function plain(raw: string): string {
  return wikiInline(raw)
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(?:emsp|ensp|thinsp|nbsp);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function display(raw: string): string {
  const text = plain(raw).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return ALIASES[text.toLowerCase()] || text;
}

/**
 * {{lb|en|heading}} marks a line that only heads its sub-senses ("Senses relating to
 * grasping"); it says nothing about how the word is used, and the sub-senses do not take it.
 */
const STRUCTURAL = new Set(['heading']);

/** Whether a label (or a joined one, "usually uncountable") belongs with the grammar codes. */
export function isGrammarLabel(label: string): boolean {
  const words = String(label || '').toLowerCase().trim();
  if (!words) return false;
  // "countable and uncountable", "transitive or intransitive".
  const joined = words.split(/\s+(?:and|or)\s+/);
  if (joined.length > 1 && joined.every((w) => isGrammarLabel(w))) return true;
  if (PATTERN.test(words)) return true;
  if (GRAMMAR.has(words) || GRAMMAR.has(ALIASES[words] || '')) return true;
  // "usually uncountable", "chiefly transitive", "often in the plural": the qualifier leads.
  const parts = words.split(/\s+/);
  let at = 0;
  while (at < parts.length - 1 && QUALIFIERS.has(parts[at])) at += 1;
  const rest = parts.slice(at).join(' ');
  return GRAMMAR.has(rest) || GRAMMAR.has(ALIASES[rest] || '') || PATTERN.test(rest);
}

/** The labels of one {{lb|lang|…}}, joined as Wiktionary joins them and sorted into grammar and usage. */
export function labelTemplateNotes(params: string[]): { grammar: string[]; labels: string[] } {
  const phrases: string[][] = [];
  let glue = false;
  for (const raw of params) {
    const p = String(raw || '').trim();
    if (!p) continue;
    if (p === '_') {
      glue = true;
      continue;
    }
    if (p === 'and' || p === 'or') {
      if (phrases.length) {
        phrases[phrases.length - 1].push(p);
        glue = true;
      }
      continue;
    }
    const key = p.toLowerCase();
    if (STRUCTURAL.has(key)) continue;
    // "ambitransitive" is printed as both.
    const texts = key === 'ambitransitive' || key === 'ambi' || key === 'ambitrans' ? ['transitive', 'intransitive'] : [display(p)];
    for (const text of texts) {
      if (!text) continue;
      if (glue && phrases.length) phrases[phrases.length - 1].push(text);
      else phrases.push([text]);
      glue = QUALIFIERS.has(text.toLowerCase());
    }
  }
  const grammar: string[] = [];
  const labels: string[] = [];
  for (const words of phrases) {
    const text = words.join(' ');
    (isGrammarLabel(text) ? grammar : labels).push(text);
  }
  return { grammar, labels };
}

/** A term from a {{syn}} or {{ant}} parameter: inline modifiers and Thesaurus pages dropped. */
function nymTerm(raw: string): string {
  const t = String(raw || '').replace(/<[a-z]+:[^>]*>/gi, '').trim();
  if (!t || /^(?:Thesaurus|Appendix|Wikisaurus):/i.test(t) || t === ';') return '';
  return wikiInline(t);
}

function pushUnique(list: string[], items: string[]): void {
  for (const i of items) if (i && !list.some((x) => x.toLowerCase() === i.toLowerCase())) list.push(i);
}

export interface WikiSense {
  /** The gloss as plain text, for matching to the definitions API. */
  text: string;
  notes: SenseNotes;
  /** Whether the line has an {{lb}} of its own (not one taken from the sense above it). */
  labelled?: boolean;
}

export interface WikiPosSection {
  /** The heading as written: "Noun", "Verb", "Proper noun". */
  heading: string;
  /** Countability from the headword line: ["countable"], ["uncountable"], ["countable", "uncountable"]. */
  head: string[];
  senses: WikiSense[];
}

/** Countability that {{en-noun}} or {{en-plural noun}} gives the whole part of speech. */
function headGrammar(body: string): string[] {
  const firstSense = body.search(/^#/m);
  const headLines = firstSense < 0 ? body : body.slice(0, firstSense);
  for (const t of scanTemplates(headLines)) {
    if (t.name === 'en-plural noun') return ['plural'];
    if (t.name !== 'en-noun') continue;
    const first = (t.positional[0] || '').trim();
    if (first === '-') return t.positional.length > 1 ? ['usually uncountable'] : ['uncountable'];
    if (first === '~') return ['countable', 'uncountable'];
    if (first === '!' || first === '?') return [];
    return ['countable'];
  }
  return [];
}

function senseLine(line: string): WikiSense {
  const notes: SenseNotes = {};
  let labelled = false;
  let rest = line.trim();
  // Only the templates in front of the gloss label it; one later in the line ("…; {{lb|en|logic}}
  // a predicate…") labels a clause, not the sense.
  for (let guard = 0; guard < 12 && rest.startsWith('{{'); guard += 1) {
    const t = scanTemplates(rest)[0];
    if (!t || !rest.startsWith(t.source)) break;
    const name = t.name;
    if (name === 'lb' || name === 'lbl' || name === 'label' || name === 'tlb' || name === 'term-label') {
      const { grammar, labels } = labelTemplateNotes(t.positional.slice(1));
      if (grammar.length) pushUnique((notes.grammar ||= []), grammar);
      if (labels.length) pushUnique((notes.labels ||= []), labels);
      labelled = true;
    } else if (name === 'q' || name === 'qual' || name === 'qualifier' || name === 'i' || name === 'qf') {
      const items = t.positional.map((p) => wikiInline(p)).filter(Boolean);
      if (items.length) pushUnique((notes.labels ||= []), items);
    } else if (!SKIPPED_LEAD.test(name)) {
      break;
    }
    rest = rest.slice(t.source.length).trimStart();
  }
  return { text: wikiInline(rest), notes, ...(labelled ? { labelled } : {}) };
}

function subLine(line: string, sense: WikiSense): void {
  for (const t of scanTemplates(line)) {
    const n = t.name;
    if (n === 'syn' || n === 'synonyms' || n === 'syn-lite') {
      pushUnique((sense.notes.synonyms ||= []), t.positional.slice(1).map(nymTerm));
    } else if (n === 'ant' || n === 'antonyms' || n === 'ant-lite') {
      pushUnique((sense.notes.antonyms ||= []), t.positional.slice(1).map(nymTerm));
    } else if (n === 'co' || n === 'coi' || n === 'collocation') {
      // One {{co}} may hold several, set apart by semicolons ("walking about;&emsp; rushing about").
      const texts = plain(t.positional[1] || '').split(/\s*;\s*/).filter((x) => x && x.length <= 80);
      if (texts.length) pushUnique((sense.notes.collocations ||= []), texts);
    }
  }
}

/**
 * Every part-of-speech section of one language on a Wiktionary page, in page order, with its
 * headword countability and its senses' notes. `language` is the section's name ("English").
 */
export function wikiSenseSections(wikitext: string, language = 'English'): WikiPosSection[] {
  const scope = extractLanguageSection(String(wikitext || ''), language);
  if (!scope) return [];
  const heads = [...scope.matchAll(/^(={3,6})\s*([^=\n]+?)\s*\1\s*$/gm)];
  const out: WikiPosSection[] = [];
  heads.forEach((h, i) => {
    const start = (h.index ?? 0) + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index ?? scope.length : scope.length;
    const body = scope.slice(start, end);
    if (!/^#[^:*]/m.test(body)) return;
    const section: WikiPosSection = { heading: h[2].replace(/\s+\d+$/, '').trim(), head: headGrammar(body), senses: [] };
    // The sense each "#:" line belongs to, by depth: "##:" goes with the last "##" sense.
    const byDepth: WikiSense[] = [];
    for (const line of body.split('\n')) {
      const m = /^(#+)(.*)$/.exec(line);
      if (!m) continue;
      const depth = m[1].length;
      const mark = m[2].charAt(0);
      if (mark === '*') continue;
      if (mark === ':') {
        const owner = byDepth[depth - 1] || section.senses[section.senses.length - 1];
        if (owner) subLine(m[2].slice(1), owner);
        continue;
      }
      const sense = senseLine(m[2]);
      // A sub-sense ("##") is read under its sense's labels: "ditransitive" on "To move,
      // provide…" holds for "To make a present of" below it, unless it has labels of its own.
      const parent = depth > 1 ? byDepth[depth - 2] : undefined;
      if (parent) {
        if (!sense.notes.grammar && parent.notes.grammar) sense.notes.grammar = [...parent.notes.grammar];
        if (!sense.notes.labels && parent.notes.labels) sense.notes.labels = [...parent.notes.labels];
      }
      section.senses.push(sense);
      byDepth[depth - 1] = sense;
      byDepth.length = depth;
    }
    out.push(section);
  });
  return out;
}

function tokens(text: string): string[] {
  return normalizeMeaningForMerge(text).split(/\s+/).filter((t) => t.length > 1);
}

function likeness(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const shared = new Set(a.filter((t) => sb.has(t))).size;
  return shared / Math.max(new Set(a).size, sb.size);
}

/**
 * A definitions-API gloss without the sub-senses it carries as a nested list: "To be
 * authoritative, accepted, or valid:" and not the "Of an opinion…" under it, whose words would
 * otherwise match the sub-sense's line and give the sense its labels.
 */
export function glossOwnHtml(html: string): string {
  const s = String(html || '');
  const at = s.search(/<(?:ol|ul|dl)\b/i);
  return at < 0 ? s : s.slice(0, at);
}

/**
 * Whether a definitions-API gloss had an {{lb}} label. The API drops the label's text but keeps
 * its empty `usage-label-sense` span at the start of the gloss, so this says which glosses a
 * label may go on. Empty spans and links before it (category links, anchors) are passed over.
 */
export function glossLabelMark(html: string): boolean {
  let s = stripSisterProjects(glossOwnHtml(html));
  for (let guard = 0; guard < 12; guard += 1) {
    const m = /^\s*(?:<link\b[^>]*>|<(span|a|sup|div|b|i)\b[^>]*>(?:\s*<link\b[^>]*>)*\s*<\/\1>)/i.exec(s);
    if (!m) return false;
    if (/\busage-label-sense\b/.test(m[0])) return true;
    s = s.slice(m[0].length);
  }
  return false;
}

/**
 * The notes for each gloss of one part of speech from the definitions API, matched in order
 * to the sense lines of the same section by their words: the closest line within the next few
 * wins. `glosses` are plain text without their sub-senses (glossOwnHtml). `marks` (glossLabelMark)
 * say which glosses had a label; a match that disagrees with it is taken as wrong and gives
 * nothing, as does a gloss with no close line, since a label on the wrong sense is worse than none.
 */
export function alignSenseNotes(senses: WikiSense[], glosses: string[], marks?: Array<boolean | undefined>): Array<SenseNotes | undefined> {
  const wiki = senses.map((s) => tokens(s.text));
  let from = 0;
  return glosses.map((gloss, gi) => {
    const g = tokens(gloss);
    if (!g.length) return undefined;
    let best = -1;
    let bestScore = 0.6;
    for (let i = from; i < Math.min(senses.length, from + 8); i += 1) {
      const score = likeness(g, wiki[i]);
      if (score > bestScore || (best < 0 && score >= bestScore)) {
        best = i;
        bestScore = score;
      }
      if (score === 1) break;
    }
    if (best < 0) return undefined;
    const mark = marks?.[gi];
    if (mark !== undefined && mark !== !!senses[best].labelled) return undefined;
    from = best + 1;
    return senses[best].notes;
  });
}

/** The fields of a sense the notes fill; empty lists are left out. */
export function notesFields(notes: SenseNotes | undefined): SenseNotes {
  const out: SenseNotes = {};
  if (!notes) return out;
  for (const k of ['grammar', 'labels', 'synonyms', 'antonyms', 'collocations'] as const) {
    const list = (notes[k] || []).filter(Boolean);
    if (list.length) out[k] = list;
  }
  return out;
}
