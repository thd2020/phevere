/**
 * Language names and script hints shared by the multilingual sources and the
 * offline catalog. Codes are ISO 639-1 where one exists.
 */
import { languageDisplayName, uiLocale } from './i18n/runtime';

/**
 * English names, as kaikki.org spells them: data for finding and matching sources. The interface
 * names a language with languageDisplayName (i18n/runtime.ts) instead.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  uk: 'Ukrainian',
  nl: 'Dutch',
  pl: 'Polish',
  cs: 'Czech',
  sv: 'Swedish',
  da: 'Danish',
  nb: 'Norwegian Bokmål',
  fi: 'Finnish',
  hu: 'Hungarian',
  el: 'Greek',
  tr: 'Turkish',
  ar: 'Arabic',
  he: 'Hebrew',
  fa: 'Persian',
  hi: 'Hindi',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ca: 'Catalan',
  ro: 'Romanian',
  hr: 'Croatian',
  la: 'Latin',
  eo: 'Esperanto',
};

/** Order of language headings in Settings → Offline; the rest follow alphabetically. */
const HEADING_ORDER = ['en', 'zh', 'ja', 'ko'];

export function languageName(code: string): string {
  return LANGUAGE_NAMES[(code || '').toLowerCase()] || (code || '').toUpperCase();
}

/** Headings in the order Settings shows them: the ones above first, the rest by their name in the interface language. */
export function compareLanguageHeadings(a: string, b: string): number {
  const ia = HEADING_ORDER.indexOf(a);
  const ib = HEADING_ORDER.indexOf(b);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return languageDisplayName(a).localeCompare(languageDisplayName(b), uiLocale());
}

/**
 * Kanji written only in Japanese (shinjitai and kokuji): neither simplified nor
 * traditional Chinese uses them. One of these in an all-Han word means Japanese.
 */
const JAPANESE_ONLY_KANJI = new Set(
  Array.from(
    '対応図広売読続駅発変楽気歩渉涙険検験剣権歓観鉄関単戦栄営円価仮辺様沢塩拡覚挙県鶏軽経恵黒斎済剤雑歯児実釈収従渋獣縦粛処焼奨乗浄剰畳嬢譲醸寝粋酔摂専銭繊荘捜挿巣総騒増蔵臓帯滞滝択団弾遅鋳庁徴聴鎮逓転伝稲闘徳縄弐悩脳覇廃拝髪抜晩払舗毎満黙訳薬揺謡頼覧両猟緑塁霊齢暦歴練錬労録説帰掲渇勧巻陥寛戻隠穏殻拠駆姫枠込働畑峠匂辻栃榊凪噺',
  ),
);

const HAN_ONLY = /^[㐀-䶿一-鿿豈-﫿々〆ヶ]+$/;

/** True for an all-Han word that uses at least one Japanese-only kanji (要対応, 駅前). */
export function looksJapaneseKanji(text: string): boolean {
  const t = (text || '').replace(/\s+/g, '');
  if (!t || !HAN_ONLY.test(t)) return false;
  if (/[々〆ヶ]/.test(t)) return true;
  for (const ch of t) if (JAPANESE_ONLY_KANJI.has(ch)) return true;
  return false;
}
