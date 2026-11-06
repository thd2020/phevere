import type { DictionaryResult, Definition } from './dictionary';
import { isGrammaticalFormOfGloss, stripGlossText } from './lookup-policy';
import { inferVocabGlossLang } from './vocab-lang';
import type { VocabAddInput } from './vocab-store';

function usableVocabDef(d: Definition): boolean {
  if (!d || d.source === 'Fallback' || d.source === 'Timeout') return false;
  const m = stripGlossText(d.meaning || '');
  if (!m || m === 'No definition available.') return false;
  return !/lookup timed out/i.test(m);
}

/** "US /…/ · UK /…/", one entry when both accents read the same. */
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
      if (us) push('US', us.ipa);
      if (uk) push('UK', uk.ipa);
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
 * Notebook card from a lookup, as the desktop pop-up saves it: real senses before
 * "plural of X" forms, up to four joined, the first translation when no sense is usable.
 */
export function vocabPayloadFromResult(result: DictionaryResult | null, lemma: string): VocabAddInput {
  const defs = (result?.definitions || []).filter(usableVocabDef);
  const substantive = defs.filter((d) => {
    const m = stripGlossText(d.meaning || '');
    return !isGrammaticalFormOfGloss(m) || m.length > 64;
  });
  const useDefs = substantive.length ? substantive : defs;
  const defJoined = useDefs
    .slice(0, 4)
    .map((d) => stripGlossText(d.meaning || ''))
    .filter(Boolean)
    .join('\n');
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
