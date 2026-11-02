/**
 * Frequency-based ordering of English senses.
 *
 * Usage data: SemCor sense tag counts from Princeton WordNet 3.1 (the counts
 * that order WordNet's own sense numbers), built into `sense-frequency-data.ts`
 * by `scripts/build-sense-frequency.js` and loaded lazily on first use.
 *
 * Free Dictionary and Wiktionary glosses are worded differently from WordNet's,
 * so each merged sense is aligned to a WordNet sense of the same part of speech
 * by gloss overlap (simplified Lesk over gloss, examples, synset lemmas and
 * hypernym lemmas, with a most-frequent-sense prior for near ties). A sense
 * with no confident match keeps its place next to the sense before it.
 *
 * Ordering follows the frequency bands dictionaries print: counts are grouped
 * by doublings, so parts of speech and senses move only when the corpus shows
 * a clear difference, and the existing order breaks every tie.
 */

import { canonicalPos, type MergeableDefinition } from './definition-merge';
import { glossTokens } from './sense-gloss-tokens';

export interface SenseFrequencyData {
  /** Lines "lemma\tpos:count.synset,...;pos:...". */
  words: string;
  /** Space-separated gloss tokens; synset lines index into it. */
  vocab: string;
  /** One line per synset: space-separated base-36 vocab indexes. */
  synsets: string;
}

interface Table {
  words: Map<string, string>;
  vocab: string[];
  synsets: string[];
}

interface WordNetSense {
  count: number;
  tokens: string[];
}

type WnPos = 'n' | 'v' | 'a' | 'r';
type WordNetEntry = Partial<Record<WnPos, WordNetSense[]>>;

let table: Table | null = null;
let loading: Promise<void> | null = null;

/** Parse the generated strings once; lines are split, tokens decoded on demand. */
export function primeSenseFrequency(data: SenseFrequencyData): void {
  const words = new Map<string, string>();
  for (const line of data.words.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0) words.set(line.slice(0, tab), line.slice(tab + 1));
  }
  table = { words, vocab: data.vocab.split(' '), synsets: data.synsets.split('\n') };
}

/** Start loading the dataset (a separate chunk) so it is ready by the first paint. */
export function warmSenseFrequency(): Promise<void> {
  if (table) return Promise.resolve();
  if (!loading) {
    loading = import('./sense-frequency-data')
      .then((m) =>
        primeSenseFrequency({
          words: m.SENSE_FREQUENCY_WORDS,
          vocab: m.SENSE_FREQUENCY_VOCAB,
          synsets: m.SENSE_FREQUENCY_SYNSETS,
        }),
      )
      .catch(() => {
        loading = null;
      });
  }
  return loading;
}

export function senseFrequencyReady(): boolean {
  return table !== null;
}

const WN_POS: Record<string, WnPos> = {
  noun: 'n',
  verb: 'v',
  adjective: 'a',
  adverb: 'r',
};

/** Function-word classes WordNet does not cover; when present they are the common use. */
const CLOSED_CLASS = new Set([
  'preposition',
  'postposition',
  'pronoun',
  'determiner',
  'article',
  'conjunction',
  'numeral',
  'particle',
]);

function entryFor(headword: string): WordNetEntry | null {
  if (!table) return null;
  const key = String(headword || '')
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[_\s]+/g, ' ');
  const line = table.words.get(key);
  if (!line) return null;
  const { vocab, synsets } = table;
  const entry: WordNetEntry = {};
  for (const field of line.split(';')) {
    const pos = field[0] as WnPos;
    entry[pos] = field
      .slice(2)
      .split(',')
      .map((cell) => {
        const dot = cell.indexOf('.');
        const ids = synsets[parseInt(cell.slice(dot + 1), 36)] || '';
        return {
          count: parseInt(cell.slice(0, dot), 10) || 0,
          tokens: ids ? ids.split(' ').map((id) => vocab[parseInt(id, 36)]).filter(Boolean) : [],
        };
      });
  }
  return entry;
}

/** Frequency band: one step per doubling of the tag count (0, 1, 2–3, 4–7, …). */
export function frequencyBand(count: number): number {
  return Math.floor(Math.log2(Math.max(0, count) + 1));
}

/** Share of the definition's weighted tokens a WordNet sense must contain to count as a match. */
const MIN_COVERAGE = 0.3;
/** Senses within this fraction of the best coverage count as a tie; the more common one wins. */
const NEAR_TIE = 0.75;
/** A definition token no sense of the lemma uses still dilutes the match, at half the top weight. */
const UNSEEN_TOKEN_SHARE = 0.5;
/** A definition keeps its match only if it covers the sense this well relative to the best claimant. */
const RIVAL_SHARE = 0.6;

function lemmaWeights(senses: WordNetSense[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const s of senses) for (const t of new Set(s.tokens)) df.set(t, (df.get(t) || 0) + 1);
  const weight = new Map<string, number>();
  for (const [t, n] of df) weight.set(t, Math.log(1 + senses.length / n));
  return weight;
}

/**
 * Weighted overlap of one definition with each WordNet sense, or null when
 * the definition has no token any sense uses. The definition (gloss plus
 * synonyms) is the query and each WordNet sense (gloss, examples, synset and
 * hypernym lemmas) a document. Weights are inverse sense frequency inside the
 * lemma, so a token every sense shares ("move" for run) counts for little and
 * a distinctive one ("deposit" for bank) decides. `coverage` is the share of
 * the definition's weight a sense contains; `hits` is the raw shared weight.
 */
function overlapRow(
  def: MergeableDefinition,
  senses: WordNetSense[],
  weight: Map<string, number>,
  skip: Set<string>,
): { coverage: number[]; hits: number[] } | null {
  const text = [def.meaning, ...(def.synonyms || []).slice(0, 8)].join(' ; ');
  const all = glossTokens(text).filter((t) => !skip.has(t));
  const known = all.filter((t) => weight.has(t));
  if (!known.length) return null;
  const unseen = Math.log(1 + senses.length) * UNSEEN_TOKEN_SHARE;
  let total = 0;
  for (const t of all) total += (weight.get(t) ?? unseen) ** 2;
  const hits = senses.map((sense) => {
    const own = new Set(sense.tokens);
    let hit = 0;
    for (const t of known) if (own.has(t)) hit += weight.get(t)! ** 2;
    return hit;
  });
  return { coverage: hits.map((h) => h / total), hits };
}

/**
 * Align the definitions of one part of speech to that part of speech's
 * WordNet senses; -1 marks no confident match.
 *
 * This is simplified Lesk with a most-frequent-sense prior. Wiktionary glosses
 * are short and often overlap several WordNet senses about equally; among
 * senses whose coverage is close to the best, the one SemCor tags most often
 * wins. A definition that matched only through a stray shared word (the saw
 * "teeth" sense of set landing on "a set of teeth") is dropped when another
 * definition shares far more with that WordNet sense.
 */
function alignGroup(defs: MergeableDefinition[], senses: WordNetSense[], skip: Set<string>): number[] {
  const weight = lemmaWeights(senses);
  const rows = defs.map((d) => overlapRow(d, senses, weight, skip));
  const picks = rows.map((row) => {
    if (!row) return -1;
    const top = Math.max(...row.coverage);
    if (top < MIN_COVERAGE) return -1;
    let best = -1;
    for (let i = 0; i < senses.length; i++) {
      if (row.coverage[i] < top * NEAR_TIE) continue;
      if (best < 0 || senses[i].count > senses[best].count) best = i;
    }
    return best;
  });
  const strongest = senses.map(() => 0);
  picks.forEach((at, d) => {
    if (at >= 0) strongest[at] = Math.max(strongest[at], rows[d]!.hits[at]);
  });
  return picks.map((at, d) => (at >= 0 && rows[d]!.hits[at] >= strongest[at] * RIVAL_SHARE ? at : -1));
}

/**
 * The WordNet sense each definition aligns to: its 1-based WordNet sense
 * number within its part of speech and its SemCor count, or null when nothing
 * matches confidently (or the dataset is not loaded or lacks the word).
 */
export function alignToWordNet(
  headword: string,
  defs: MergeableDefinition[],
): Array<{ sense: number; count: number } | null> {
  const out: Array<{ sense: number; count: number } | null> = defs.map((): null => null);
  const entry = entryFor(headword);
  if (!entry) return out;
  const skip = new Set(glossTokens(headword));
  const byPos = new Map<WnPos, number[]>();
  defs.forEach((d, i) => {
    const wn = WN_POS[canonicalPos(d.partOfSpeech)];
    if (!wn || !entry[wn]?.length) return;
    if (!byPos.has(wn)) byPos.set(wn, []);
    byPos.get(wn)!.push(i);
  });
  for (const [wn, idx] of byPos) {
    const senses = entry[wn]!;
    alignGroup(
      idx.map((i) => defs[i]),
      senses,
      skip,
    ).forEach((at, k) => {
      if (at >= 0) out[idx[k]] = { sense: at + 1, count: senses[at].count };
    });
  }
  return out;
}

/**
 * Give items without evidence the key of the nearest item before them (or,
 * at the start, after them), so a stable sort keeps them beside that neighbour.
 */
function fillFromNeighbours(keys: Array<number | null>): number[] {
  const out = keys.slice();
  let last: number | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null) out[i] = last;
    else last = out[i];
  }
  let next: number | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (keys[i] !== null) next = keys[i];
    if (out[i] === null) out[i] = next;
  }
  return out.map((k) => (k === null ? 0 : k));
}

function stableSortByKeyDesc<T>(items: T[], keys: number[]): T[] {
  return items
    .map((item, i) => ({ item, key: keys[i], i }))
    .sort((a, b) => (a.key === b.key ? a.i - b.i : b.key > a.key ? 1 : -1))
    .map((x) => x.item);
}

/**
 * Reorder merged English senses by usage frequency: parts of speech by their
 * total SemCor count, senses inside each part of speech by the count of the
 * WordNet sense they align to. Senses that align get `frequency` (the tag
 * count). Returns the input unchanged when the dataset is not loaded yet or
 * the word has no counts; callers pass English headwords only.
 */
export function orderSensesByFrequency<T extends MergeableDefinition>(headword: string, defs: T[]): T[] {
  if (!defs || defs.length < 2) return defs || [];
  if (!table) {
    void warmSenseFrequency();
    return defs;
  }
  const entry = entryFor(headword);
  if (!entry) return defs;

  const skip = new Set(glossTokens(headword));
  const groups = new Map<string, T[]>();
  for (const d of defs) {
    const pos = canonicalPos(d.partOfSpeech);
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos)!.push(d);
  }

  const posKeys: number[] = [];
  const sortedGroups: T[][] = [];
  for (const [pos, members] of groups) {
    const wn = WN_POS[pos];
    if (!wn) {
      // Function words lead; interjections and unlabelled senses, which have
      // no count, follow every part of speech that has one.
      posKeys.push(CLOSED_CLASS.has(pos) ? Number.POSITIVE_INFINITY : -1);
      sortedGroups.push(members);
      continue;
    }
    const senses = entry[wn] || [];
    posKeys.push(frequencyBand(senses.reduce((n, s) => n + s.count, 0)));
    if (!senses.length) {
      sortedGroups.push(members);
      continue;
    }
    const senseKeys = alignGroup(members, senses, skip).map((at, i) => {
      if (at < 0) return null;
      const count = senses[at].count;
      members[i] = { ...members[i], frequency: count };
      return frequencyBand(count);
    });
    sortedGroups.push(
      senseKeys.some((k) => k !== null) ? stableSortByKeyDesc(members, fillFromNeighbours(senseKeys)) : members,
    );
  }

  return stableSortByKeyDesc(sortedGroups, posKeys).flat();
}
