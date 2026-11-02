/**
 * The form a notebook word is saved in. A selection keeps whatever case and punctuation the
 * page had ("CODON", "Bunny,"), so the saved headword is put in dictionary form: lower case,
 * except where the language or the word's kind needs capitals (German nouns, proper nouns,
 * abbreviations, the pronoun "I"), with surrounding quotes and punctuation removed.
 */

const EDGE = /^[\s"'“”‘’«»‹›「」『』（）()[\]{}.,;:!?¡¿…·•*_~–—-]+|[\s"'“”‘’«»‹›「」『』（）()[\]{}.,;:!?¡¿…·•*_~–—-]+$/gu;

const KEEP_AS_IS = new Set(['I', 'O']);

export function normalizeVocabLemma(raw: string, opts: { pos?: string | null; lang?: string | null } = {}): string {
  const original = String(raw || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const t = original.replace(EDGE, '').trim() || original;
  if (KEEP_AS_IS.has(t)) return t;
  const pos = String(opts.pos || '').toLowerCase();
  const lang = String(opts.lang || 'en').toLowerCase().split('-')[0] || 'en';
  if (/abbreviation|acronym|initialism|symbol/.test(pos)) return t.toLocaleUpperCase(lang);
  if (/proper/.test(pos)) {
    return t
      .split(' ')
      .map((w) => w.charAt(0).toLocaleUpperCase(lang) + w.slice(1).toLocaleLowerCase(lang))
      .join(' ');
  }
  // German capitalises every noun.
  if (lang === 'de' && /noun/.test(pos)) {
    return t.charAt(0).toLocaleUpperCase('de') + t.slice(1).toLocaleLowerCase('de');
  }
  return t.toLocaleLowerCase(lang);
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps), for typo checks. */
export function typoDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) => [i, ...new Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/** The suggestion a misspelling most likely meant: one or two edits away, never a phrase. */
export function closestSpelling(word: string, suggestions: string[]): string | null {
  const w = String(word || '').trim();
  if (w.length < 4 || /\s/.test(w)) return null;
  const limit = w.length >= 7 ? 2 : 1;
  for (const s of suggestions || []) {
    const c = String(s || '').trim();
    if (!c || /\s/.test(c) || c.toLowerCase() === w.toLowerCase()) continue;
    if (typoDistance(c, w) <= limit) return c;
  }
  return null;
}
