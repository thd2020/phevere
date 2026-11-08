import type { DictionaryResult, Definition } from './dictionary';
import { isGrammaticalFormOfGloss, stripGlossText } from './lookup-policy';
import { inferVocabGlossLang } from './vocab-lang';
import { splitByGlossLanguage } from './lexicon-parts';
import { tidySenseText } from './sense-text';
import type { VocabAddInput } from './vocab-store';

/**
 * The senses a saved word keeps, in the order its lookup shows them: senses glossed in English
 * first, then the first gloss in another language (Chinese Wiktionary's 老态龙钟的 for "decrepit"),
 * `max` in all. Glosses in other languages sit in a section after the English senses in the lookup,
 * so a saved row never leads with one.
 */
export function savedSenses<T extends { source?: string; sources?: string[]; meaning?: string; definition?: string }>(defs: T[], max = 4): T[] {
  const { main, other } = splitByGlossLanguage(defs);
  const foreign = other.flatMap((o) => o.defs);
  if (!foreign.length) return main.slice(0, max);
  return main.length >= max ? [...main.slice(0, max - 1), foreign[0]] : [...main, ...foreign].slice(0, max);
}

function usableVocabDef(d: Definition): boolean {
  if (!d || d.source === 'Fallback' || d.source === 'Timeout') return false;
  const m = stripGlossText(d.meaning || '');
  if (!m || m === 'No definition available.') return false;
  return !/lookup timed out/i.test(m);
}

/** "US /…/ · UK /…/", one entry when both accents read the same. */
/**
 * Whether a lookup is finished enough to replace a saved word's definition (`refreshFromLookup`):
 * it has dictionary senses, not only a translation, and every dictionary it waited for answered
 * without failing. An early result, or one from a lookup that timed out, only fills empty rows.
 */
export function lookupSettled(result: DictionaryResult | null | undefined): boolean {
  const usable = (result?.definitions || []).some((d) => d.source !== 'Fallback' && d.source !== 'Timeout' && String(d.meaning || '').trim());
  const meta = (result?.metadata || {}) as { sourceStatus?: Record<string, string>; expectedSources?: string[] };
  const status = meta.sourceStatus;
  if (!usable || !status || typeof status !== 'object') return false;
  if (Object.values(status).some((v) => v === 'fail')) return false;
  return (meta.expectedSources || []).every((k) => !!status[k] && status[k] !== 'fail');
}

function vocabReading(result: DictionaryResult): string | undefined {
  const list = result.pronunciations || [];
  if (list.length) {
    const parts: string[] = [];
    const used = new Set<string>();
    const push = (label: string, ipa: string | undefined) => {
      const clean = String(ipa || '').replace(/^\/+|\/+$/g, '');
      if (!clean || used.has(clean)) return;
      used.add(clean);
      parts.push(label ? `${label} /${clean}/` : `/${clean}/`);
    };
    const us = list.find((p) => p.accent === 'us');
    const uk = list.find((p) => p.accent === 'uk');
    if (us && uk && us.ipa === uk.ipa) push('', us.ipa);
    else {
      if (uk) push('UK', uk.ipa);
      if (us) push('US', us.ipa);
    }
    for (const p of list) {
      if (p === us || p === uk) continue;
      push(p.accent === 'us' ? 'US' : p.accent === 'uk' ? 'UK' : '', p.ipa);
    }
    if (parts.length) return parts.join('  ·  ');
  }
  return result.pronunciation || undefined;
}

/**
 * A saved word's definition: one line per sense, as plain text. An English word's senses are
 * tidied as the lookup tidies them (tidySenseText), since a sense the lookup leaves as its source
 * wrote it ("Diminutive of bro , a smaller…") must not be saved that way.
 */
export function savedDefinition(defs: Array<{ meaning?: string }>, sourceLang?: string): string {
  const english = !sourceLang || sourceLang === 'auto' || /^en(?:-|$)/i.test(sourceLang);
  return defs
    .map((d) => stripGlossText(d.meaning || ''))
    .map((m) => (english && m ? tidySenseText(m) : m))
    .filter(Boolean)
    .join('\n');
}

/**
 * Notebook card from a lookup, as the desktop pop-up saves it: real senses before
 * "plural of X" forms, up to four joined, the first translation when no sense is usable.
 */
export function vocabPayloadFromResult(result: DictionaryResult | null, lemma: string): VocabAddInput {
  const defs = (result?.definitions || []).filter(usableVocabDef);
  const substantive = defs.filter((d) => {
    const m = stripGlossText(d.meaning || '');
    return !isGrammaticalFormOfGloss(m) || m.length > 64;
  });
  const useDefs = savedSenses(substantive.length ? substantive : defs);
  const defJoined = savedDefinition(useDefs, result?.detectedLanguage);
  const tx = (result?.translations || [])[0];
  const sourceList: string[] = [];
  for (const d of useDefs.slice(0, 6)) {
    if (Array.isArray(d.sources)) d.sources.forEach((s) => s && sourceList.push(s));
    else if (d.source) String(d.source).split(/\s*·\s*/).forEach((s) => s && sourceList.push(s));
  }
  const sources = Array.from(new Set(sourceList)).slice(0, 6);
  const usedTxFallback = !defJoined && !!tx?.text;
  const sourceLang = result?.detectedLanguage;
  const targetLang = usedTxFallback
    ? tx?.language || result?.language
    : inferVocabGlossLang({
        sourceLang,
        targetLang: result?.language,
        definition: defJoined || (tx?.text ? String(tx.text) : ''),
        sources,
      }) || sourceLang;
  return {
    lemma,
    reading: result ? vocabReading(result) : undefined,
    definition: defJoined || (tx?.text ? String(tx.text) : undefined),
    partOfSpeech: useDefs[0]?.partOfSpeech,
    sources: sources.length ? sources : tx?.source ? [tx.source] : result?.sources || [],
    sourceLang,
    targetLang,
  };
}

/**
 * Whether the word shown can go into a word book. A book holds plain spellings, with no language,
 * and studies each as its plain lookup opens it. So an entry opened in another language through the
 * language switch, when the same spelling has an English entry (Danish "give"), is not offered: its
 * spelling in a book would stand for the English word. Its heart saves it to My words, which keeps
 * the language.
 */
export function canAddToWordBook(result: DictionaryResult | null | undefined): boolean {
  if (!result) return false;
  const langs = Array.isArray(result.languages) ? result.languages : [];
  const shown = langs.find((l) => l.current)?.code || String(result.detectedLanguage || '').toLowerCase().split('-')[0];
  return !(shown && shown !== 'en' && langs.some((l) => l.code === 'en'));
}

/** Example sentences from a lookup, for the quiz's gap-fill questions: plain text, each once, at most eight. */
/**
 * Synonyms for a "closest in meaning" question, senses first: those listed under the entry's first
 * part of speech in dictionary order, then the entry's own list (Datamuse), up to six single words.
 */
export function synonymsFromResult(result: DictionaryResult | null): string[] {
  const defs = result?.definitions || [];
  const pos = defs[0]?.partOfSpeech;
  const out: string[] = [];
  const add = (raw: unknown) => {
    const w = stripGlossText(String(raw || '')).trim();
    if (w && !/\s/.test(w) && !out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w);
  };
  for (const d of defs) if (d.partOfSpeech === pos) for (const w of d.synonyms || []) add(w);
  for (const w of result?.synonyms || []) add(w);
  return out.slice(0, 6);
}

/** Antonyms for an "opposite in meaning" question, found the way `synonymsFromResult` finds synonyms. */
export function antonymsFromResult(result: DictionaryResult | null): string[] {
  const defs = result?.definitions || [];
  const pos = defs[0]?.partOfSpeech;
  const out: string[] = [];
  const add = (raw: unknown) => {
    const w = stripGlossText(String(raw || '')).trim();
    if (w && !/\s/.test(w) && !out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w);
  };
  for (const d of defs) if (d.partOfSpeech === pos) for (const w of d.antonyms || []) add(w);
  for (const w of result?.antonyms || []) add(w);
  return out.slice(0, 6);
}

/**
 * Single words of the entry's family (derived words, the base, related forms), for word-formation
 * questions: derived and related words only with a recorded use in print, so a quiz never prints
 * a coinage such as "errandy" in capitals. A lookup that has no frequencies yet gives none of them.
 */
export function familyFromResult(result: DictionaryResult | null): string[] {
  const out: string[] = [];
  for (const g of result?.wordFamily || []) {
    if (g.relation !== 'derived' && g.relation !== 'lemma' && g.relation !== 'related') continue;
    for (const item of g.items || []) {
      const w = String(item.word || '').trim();
      // The base of a form is a real word; derived and related words need a recorded use.
      if (w && (g.relation === 'lemma' || item.common) && /^\p{L}+$/u.test(w) && !out.includes(w)) out.push(w);
    }
  }
  return out.slice(0, 20);
}

export function examplesFromResult(result: DictionaryResult | null): string[] {
  const out: string[] = [];
  for (const d of result?.definitions || []) {
    for (const raw of d.examples || []) {
      const t = stripGlossText(String(raw || '')).replace(/^[“"]|[”"]$/g, '').trim();
      if (t.length >= 12 && t.length <= 220 && !out.includes(t)) out.push(t);
      if (out.length >= 8) return out;
    }
  }
  return out;
}
