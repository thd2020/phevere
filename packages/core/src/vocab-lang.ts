/**
 * Notebook language chip: lemma language → language of the saved gloss.
 * Do not use the translation-tab default (en→zh) when the card is an English dictionary sense.
 */

const LATIN_DICT =
  /wiktionary|wordnet|webster|gcide|free dictionary|oxford|datamuse|wordsapi|collins/i;
const CJK_EN_DICT = /cedict|cc-cedict|youdao|freedict/i;
const CJK_CHAR = /[\u3400-\u9FFF\uF900-\uFAFF]/;

function iso(code?: string): string {
  return String(code || '')
    .toLowerCase()
    .split('-')[0]
    .trim();
}

function mostlyCjk(text: string): boolean {
  const s = String(text || '');
  if (!s) return false;
  const hits = s.match(new RegExp(CJK_CHAR.source, 'g'));
  return !!hits && hits.length >= Math.max(2, Math.floor(s.length * 0.12));
}

export function inferVocabGlossLang(entry: {
  sourceLang?: string;
  targetLang?: string;
  definition?: string;
  sources?: string[];
}): string | undefined {
  const def = String(entry.definition || '').trim();
  const srcs = (entry.sources || []).join(' ');
  if (mostlyCjk(def)) return 'zh';
  if (LATIN_DICT.test(srcs)) return 'en';
  if (CJK_EN_DICT.test(srcs) && def && !mostlyCjk(def)) return 'en';
  const src = iso(entry.sourceLang);
  const tgt = iso(entry.targetLang);
  if (src === 'en' && tgt === 'zh' && /[A-Za-z]{3,}/.test(def) && !mostlyCjk(def)) return 'en';
  return tgt || src || undefined;
}

/** e.g. `en → en` for an English dictionary card, `zh → en` for CEDICT. */
export function formatVocabLangPair(entry: {
  sourceLang?: string;
  targetLang?: string;
  definition?: string;
  sources?: string[];
}): string {
  const src = iso(entry.sourceLang);
  const gloss = inferVocabGlossLang(entry);
  if (src && gloss) return `${src} → ${gloss}`;
  return src || gloss || '';
}
