/**
 * One place for “what is this lookup, and what may attach to the card.”
 *
 * Surface (the queried form) owns definitions, IPA, and the notebook key.
 * Inflected lemmas are a fallback ladder only when the exact form has no senses.
 * Related forms belong in Word family links — never mixed into definitions.
 */

import {
  NormalizedQuery,
  foldLookupKey,
  latinLemmaForms,
} from './text-normalize';

/** Inflection glosses (“plural of cat”), not English “a form of roleplaying”. */
export const GRAMMATICAL_FORM_OF =
  /^(?:the\s+)?(?:plural|past(?:\s+tense)?|simple\s+past|present(?:\s+participle)?|gerund|(?:past|present)\s+participle|third-person\s+singular(?:\s+simple\s+present)?|alternative\s+(?:form|spelling)|(?:common\s+)?misspelling|obsolete\s+(?:form|spelling)|archaic\s+(?:form|spelling)|inflection|conjugated\s+form)\s+of\b/i;

/** Same prefixes, for turning “participle of X” into a link (capture phrase + lemma). */
export const GRAMMATICAL_FORM_OF_LINK =
  /\b((?:the\s+)?(?:plural|past(?:\s+tense)?|simple\s+past|present(?:\s+participle)?|gerund|(?:past|present)\s+participle|third-person\s+singular(?:\s+simple\s+present)?|alternative\s+(?:form|spelling)|(?:common\s+)?misspelling|obsolete\s+(?:form|spelling)|archaic\s+(?:form|spelling)|inflection|conjugated\s+form)\s+of)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'-]*)/gi;

export function stripGlossText(meaning: string): string {
  return String(meaning || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGrammaticalFormOfGloss(meaning: string): boolean {
  return GRAMMATICAL_FORM_OF.test(stripGlossText(meaning));
}

export function sameLookupFold(a: string, b: string): boolean {
  const fa = foldLookupKey(a);
  return fa.length > 0 && fa === foldLookupKey(b);
}

/**
 * Punctuation/script variants that are the same folded form vs wink lemmas
 * (and diacritic / possessive strips whose fold key differs).
 */
export function splitSurfaceAndLemma(query: NormalizedQuery): { surface: string[]; lemma: string[] } {
  const all = query.candidates.length > 0 ? query.candidates : [query.trimmed];
  const surfaceKey = foldLookupKey(query.trimmed);
  const surface: string[] = [];
  const lemma: string[] = [];
  const seen = new Set<string>();
  const push = (list: string[], value: string) => {
    const v = (value || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    list.push(v);
  };
  for (const c of all) {
    if (foldLookupKey(c) === surfaceKey) push(surface, c);
    else push(lemma, c);
  }
  if (!query.isCJK && query.kind === 'word') {
    for (const f of latinLemmaForms(query.trimmed)) push(lemma, f);
  }
  return { surface, lemma };
}

/** Notebook / heart key: the form the user asked for, not a pivoted lemma. */
export function saveLemma(
  result?: { word?: string; metadata?: Record<string, unknown> } | null,
  selection?: string,
): string {
  const queried = result?.metadata && typeof result.metadata.queriedAs === 'string'
    ? result.metadata.queriedAs.trim()
    : '';
  return String(selection || queried || result?.word || '').trim();
}
