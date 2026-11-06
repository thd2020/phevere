/**
 * The letter case of a short translation. Engines often answer a single word or a short phrase
 * with a capital first letter, as if it began a sentence: 苹果 comes back as "Apple", French
 * "chat" as "Cat". Dictionaries and translators mirror the source's case for words and phrases
 * instead (Google's patent US8886518 translates in lower case and then restores the source's
 * capitals), so a translation of a lower-case or uncased word starts in lower case unless the
 * capital belongs to the word: a name ("Beijing"), a language or nationality ("English"), a day or
 * month in a language that capitalises them ("Monday"), an acronym ("NASA"), a word with inner
 * capitals ("iPhone") or the English pronoun "I".
 *
 * caseVerdict decides what the text alone can decide. When the only question left is whether a
 * capitalised first word is a name, it says so ('ask'), and the dictionary service answers from
 * Wiktionary (capitalBelongsByWiktionary): Wiktionary writes the English glosses of foreign words
 * in lower case unless the word is a name, and keeps "Monday" and "monday" as separate pages.
 */
import { classify, sanitize, trimEdges } from './text-normalize';
import { GRAMMATICAL_FORM_OF, stripGlossText } from './lookup-policy';

export type CaseVerdict =
  /** Leave the engine's casing. */
  | { kind: 'keep' }
  /** Lower the first letter (`lowered`) unless `word` is a name; the caller decides that. */
  | { kind: 'ask'; word: string; lowered: string };

/** Languages that capitalise every noun, so a capital says nothing about names (German, Luxembourgish). */
const NOUN_CAPITALS = new Set(['de', 'lb']);
/** A sentence ends here: a full stop, question or exclamation mark, possibly before a closing quote. */
const SENTENCE_END = /[.!?。！？…‽][\p{Pf}\p{Pe}"'」』）)\]]*$/u;
const CASED = /[\p{Lu}\p{Ll}\p{Lt}]/u;
const UPPER = /[\p{Lu}\p{Lt}]/u;

function base(lang: string | undefined): string {
  return String(lang || '').toLowerCase().split(/[-_]/)[0];
}

/** A word or short phrase (not a sentence), as the lookup decides when it routes a selection. */
export function isShortText(text: string): boolean {
  const s = sanitize(text || '');
  if (!s || SENTENCE_END.test(s)) return false;
  return classify(trimEdges(s)) !== 'sentence';
}

/**
 * Whether the source's own case lets the translation start in lower case: its first cased letter
 * is lower case, or it has no case at all (Chinese, Japanese, Korean). A German noun's capital is
 * spelling, not a name, so a German source counts as uncased.
 */
function sourceIsLower(source: string, sourceLang: string): boolean {
  const s = trimEdges(sanitize(source));
  const first = s.match(CASED);
  if (!first) return true;
  if (!UPPER.test(first[0])) return true;
  // "HUND" is written in capitals; "Hund" is just a German noun.
  return NOUN_CAPITALS.has(base(sourceLang)) && s !== s.toLocaleUpperCase();
}

/**
 * What to do with a translation's case. `source` is the text that was translated, `translation`
 * the engine's answer, and the languages are ISO codes ('zh', 'en', 'zh-CN').
 */
export function caseVerdict(source: string, translation: string, sourceLang: string, targetLang: string): CaseVerdict {
  const keep: CaseVerdict = { kind: 'keep' };
  const text = String(translation || '');
  const target = base(targetLang);
  if (!text.trim() || NOUN_CAPITALS.has(target)) return keep;
  if (!isShortText(source) || !sourceIsLower(source, sourceLang)) return keep;

  // The first letter of the translation, past any opening quote or bracket.
  const at = text.search(/\p{L}/u);
  if (at < 0 || !UPPER.test(text[at])) return keep;
  const words = text.slice(at).split(/\s+/).filter(Boolean);
  const word = words[0].replace(/[\p{P}\p{S}]+$/u, '');
  // Acronyms and words with inner capitals: "NASA", "DNA", "McDonald's", "Coca-Cola".
  if (UPPER.test(word.slice(1))) return keep;
  // The English pronoun, alone or in a contraction: "I", "I'm", "I'll".
  if (target === 'en' && /^I(?:['’]\p{L}+)?$/u.test(word)) return keep;
  // A capital the engine gave a later word marks a name: "New York", "Peking University".
  if (words.slice(1).some((w) => UPPER.test(w.replace(/^[\p{P}\p{S}]+/u, '').charAt(0)))) return keep;
  const first = text[at].toLocaleLowerCase(target || undefined);
  return { kind: 'ask', word, lowered: text.slice(0, at) + first + text.slice(at + 1) };
}

/** The plain text of a Wiktionary REST definition (its HTML tags removed). */
function plain(definition: unknown): string {
  return String(definition || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every entry of one language on a Wiktionary REST definitions page. */
function entries(page: any, lang: string): any[] {
  const list = page && typeof page === 'object' ? page[lang] : null;
  return Array.isArray(list) ? list : [];
}

function rawSenses(entry: any): string[] {
  return (Array.isArray(entry?.definitions) ? entry.definitions : [])
    .map((d: any) => String(d?.definition || ''))
    .filter((d: string) => plain(d));
}

function senses(entry: any): string[] {
  return rawSenses(entry).map(plain);
}

const PROPER = /proper noun/i;
/**
 * A sense that is another word's form or spelling: "plural of", "alternative form of",
 * "misspelling of", "inflection of chiner", "first-person singular present indicative of pommer",
 * "alternative letter-case form of".
 */
const FORM_OF = new RegExp(
  `${GRAMMATICAL_FORM_OF.source}|^.{0,80}\\b(?:inflection|singular|plural|participle|gerund|indicative|subjunctive|imperative|comparative|superlative|feminine|masculine|neuter|letter-case form|spelling)\\b.{0,60}\\bof\\b`,
  'i',
);

function isFormOfSense(sense: string): boolean {
  return FORM_OF.test(stripGlossText(sense));
}

/** An entry that is only another word's form: its first sense says so. */
function isFormOfEntry(entry: any): boolean {
  const first = senses(entry)[0];
  return !!first && isFormOfSense(first);
}

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

/** Whether a sense is a form or spelling of `word` itself: "english" is "Alternative form of English". */
function pointsAt(sense: string, word: string): boolean {
  const text = plain(sense);
  if (!isFormOfSense(text)) return false;
  for (const m of sense.matchAll(/href="\/wiki\/([^"#?]+)/g)) {
    let title = m[1];
    try {
      title = decodeURIComponent(title);
    } catch {
      /* keep the raw path */
    }
    if (title.replace(/_/g, ' ') === word) return true;
  }
  return hasWord(text, word);
}

/**
 * Whether a Wiktionary definitions page has a proper noun that stands for something in its own
 * right: the city of Paris, the month of May. One whose first sense is only a surname, a given
 * name or a minor place ("Children", "Went") does not count, so a capital at the start of a
 * sentence does not hide the word. `lang` limits it to one language's entries.
 */
export function hasProperNoun(page: any, lang?: string): boolean {
  const minor = /^\s*(?:an?\s+)?(?:(?:english|habitational|occupational|common)\s+)?(?:surname|(?:male|female|unisex)\s+given\s+name|given\s+name|placename|place\s+name|number\s+of\s+places|river|village|hamlet|town|locale)\b/i;
  const lists = lang ? [entries(page, lang)] : Object.values(page || {});
  return lists.some(
    (list) =>
      Array.isArray(list) &&
      list.some((e: any) => {
        if (!PROPER.test(String(e?.partOfSpeech || ''))) return false;
        const first = senses(e)[0];
        return !!first && !minor.test(first) && !/^the river\b/i.test(first);
      }),
  );
}

/**
 * Whether the capital of `word`, the first word of a translation into `targetLang`, belongs to it,
 * from Wiktionary's definitions pages: `sourcePage` for the translated text, `ownPage` for the
 * capitalised word and `lowerPage` for it in lower case. A page is null when Wiktionary has no
 * such page and undefined when it did not answer. The answer is undefined when the pages do not say.
 *
 * Into English, the source's own glosses decide when they use the word: Wiktionary glosses foreign
 * words in lower case unless they are names, so 苹果 has "apple", 北京 "Beijing", 五月 "May",
 * 我 "I, me" and German "Hund" "dog, hound".
 *
 * Otherwise the target language's lower-case page decides. A word with no lower-case entry keeps
 * its capital ("Beijing", "London"), and so does one whose lower-case page only points back at it
 * ("monday" as a misspelling of Monday, "english" as an alternative form of English). A
 * lower-case word of its own starts the translation: "apple" beside "Apple", "pomme" beside
 * "Pomme". A lower-case page that is only another word's form ("chine", of the verb chiner) leaves
 * it to the capitalised page: "Chine" (China) is a name and keeps its capital.
 */
export function capitalBelongsByWiktionary(
  word: string,
  targetLang: string,
  sourceLang: string,
  pages: { sourcePage?: any; ownPage?: any; lowerPage?: any },
): boolean | undefined {
  const target = base(targetLang);
  const lowerWord = word.charAt(0).toLocaleLowerCase(target || undefined) + word.slice(1);
  if (target === 'en' && pages.sourcePage) {
    const src = base(sourceLang);
    const others = Object.keys(pages.sourcePage).filter((l) => l !== 'en');
    const langs = entries(pages.sourcePage, src).length ? [src] : others;
    const glosses = langs.flatMap((l) => entries(pages.sourcePage, l).flatMap(senses));
    if (glosses.some((g) => hasWord(g, word))) return true;
    if (glosses.some((g) => hasWord(g, lowerWord))) return false;
  }
  if (pages.lowerPage === undefined) return undefined;
  const lower = entries(pages.lowerPage, target);
  if (lower.some((e) => rawSenses(e).some((s) => pointsAt(s, word)))) return true;
  if (lower.some((e) => !PROPER.test(String(e?.partOfSpeech || '')) && !isFormOfEntry(e))) return false;
  if (!lower.some(isFormOfEntry)) return true;
  if (pages.ownPage === undefined) return undefined;
  return hasProperNoun(pages.ownPage, target);
}
