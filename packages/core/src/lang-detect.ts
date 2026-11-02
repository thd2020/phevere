/**
 * Source-language guess for a lookup, from the text alone.
 *
 * Script decides most cases. Han-only text is the hard one: Japanese shinjitai and kokuji
 * (対, 応, 駅, 働) and the iteration mark 々 never appear in Chinese, and a set of common
 * simplified-only forms (们, 这, 对) never appears in Japanese. Latin text uses letters that
 * belong to few languages (ß, ñ, ő, ł) and then common function words. A guess is marked
 * `confident: false` when nothing in the text tells the languages apart, so the caller can
 * ask a remote detector (with a short timeout) and fall back to this guess.
 */

export interface LangGuess {
  lang: string;
  confident: boolean;
}

/** Kanji used in Japanese but not in simplified or traditional Chinese. */
const JA_ONLY_HAN = new Set(
  (
    '対応済様円気図駅売読険帰戦歳単広価発変楽薬権歴沢絵県実浜辺縄拝払仮仏伝経続総関検験鉄転軽' +
    '営覚挙労栄蔵臓黒塩姉徳恵摂銭桜歩毎遅隣両乗亜悪圧囲隠駆勧巻陥渇寛戯犠拠暁掲渓継鶏撃倹剣圏' +
    '顕厳効鉱砕剤雑桟賛糸歯児釈収従渋獣縦粛処奨焼証浄剰畳壌嬢譲醸寝粋酔穂髄瀬斉専繊荘捜挿巣層' +
    '騒増憎贈帯滞滝嘆弾鋳庁徴聴懲鎮塚逓稲闘届弐悩脳覇廃髪抜賓頻侮併塀舗満黙訳揺謡頼覧竜虜猟緑' +
    '涙戻霊齢暦練錬録歓観渉戸亀縁込畑峠働匂枠栃凧凪榊躾鰯噺襷麿籾笹杢鴫'
  ).split(''),
);

/** Common simplified-Chinese forms that Japanese writes differently. */
const ZH_ONLY_HAN = new Set(
  (
    '们这说对应时东车长门问间见现书认让话语读谁请还进过边发经给电页马鸟鱼龙爱个为么关开头样难' +
    '买卖钱银铁听吗呢吧哪您该从无业务动产种实级场线标变观视觉习练际确简单'
  ).split(''),
);

const HIRAGANA_KATAKANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/;

const SCRIPTS: Array<[RegExp, string]> = [
  [/[֐-׿]/, 'he'],
  [/[ऀ-ॿ]/, 'hi'],
  [/[ঀ-৿]/, 'bn'],
  [/[਀-੿]/, 'pa'],
  [/[஀-௿]/, 'ta'],
  [/[ఀ-౿]/, 'te'],
  [/[฀-๿]/, 'th'],
  [/[຀-໿]/, 'lo'],
  [/[က-႟]/, 'my'],
  [/[ក-៿]/, 'km'],
  [/[Ⴀ-ჿ]/, 'ka'],
  [/[԰-֏]/, 'hy'],
  [/[ሀ-፿]/, 'am'],
  [/[Ͱ-Ͽἀ-῿]/, 'el'],
];

/** Letters that point at one language (or a small family); weights add up per language. */
const LATIN_MARKS: Array<[RegExp, Record<string, number>]> = [
  [/ß/, { de: 6 }],
  [/[äöü]/, { de: 2, sv: 0.6, fi: 0.6, tr: 0.4, hu: 0.4 }],
  [/[ñ¿¡]/, { es: 6 }],
  [/[ãõ]/, { pt: 6 }],
  [/ç/, { fr: 2, pt: 2, tr: 1, ca: 1 }],
  [/[œ]/, { fr: 6 }],
  [/[èêëîïôûùÿ]/, { fr: 2.5, it: 0.4 }],
  [/[àâ]/, { fr: 1.5, it: 0.6, pt: 0.6 }],
  [/[ìò]/, { it: 3 }],
  [/[áíóú]/, { es: 1.5, pt: 1, it: 0.3, hu: 0.5, cs: 0.5 }],
  [/é/, { fr: 1.5, es: 0.8, pt: 0.8, it: 0.4, hu: 0.4, cs: 0.3 }],
  [/[åø]/, { sv: 2, da: 2, no: 2 }],
  [/æ/, { da: 3, no: 3 }],
  [/[őű]/, { hu: 6 }],
  [/[łżźśćńęą]/, { pl: 6 }],
  [/[řěů]/, { cs: 6 }],
  [/[čšž]/, { cs: 2, sk: 1.5, sl: 1.5, hr: 1.5 }],
  [/[ğış]/, { tr: 6 }],
  [/[șțăî]/, { ro: 4 }],
  [/[đ]/, { vi: 2, hr: 2 }],
  [/[ơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/, { vi: 8 }],
];

const FUNCTION_WORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'it', 'for', 'with', 'was', 'on', 'are', 'this', 'be', 'have', 'not', 'you', 'they', 'what'],
  es: ['el', 'la', 'de', 'que', 'y', 'en', 'los', 'las', 'del', 'por', 'con', 'para', 'una', 'es', 'está', 'pero', 'como', 'su', 'se', 'no'],
  fr: ['le', 'la', 'les', 'de', 'des', 'et', 'est', 'un', 'une', 'du', 'que', 'pour', 'dans', 'pas', 'sur', 'avec', 'ce', 'il', 'je', 'vous'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'den', 'dem', 'von', 'zu', 'auf', 'für', 'ich', 'sie', 'es', 'auch', 'sich'],
  it: ['il', 'di', 'che', 'e', 'la', 'per', 'un', 'una', 'del', 'della', 'con', 'non', 'sono', 'è', 'gli', 'anche', 'come', 'più', 'questo', 'nel'],
  pt: ['o', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não', 'os', 'no', 'na', 'por', 'mais', 'como', 'mas', 'é'],
  nl: ['de', 'het', 'een', 'van', 'en', 'is', 'niet', 'dat', 'op', 'te', 'zijn', 'met', 'voor', 'ik', 'je', 'wat', 'maar', 'ook', 'dit', 'er'],
  sv: ['och', 'att', 'det', 'som', 'en', 'är', 'på', 'för', 'med', 'inte', 'jag', 'har', 'av', 'till', 'den', 'om', 'ett', 'men', 'var', 'så'],
  pl: ['i', 'w', 'nie', 'na', 'się', 'jest', 'to', 'że', 'z', 'do', 'jak', 'ale', 'co', 'tak', 'za', 'od', 'po', 'czy', 'tylko', 'jego'],
  tr: ['ve', 'bir', 'bu', 'da', 'de', 'için', 'ile', 'çok', 'ne', 'var', 'ama', 'gibi', 'daha', 'olarak', 'kadar', 'sonra', 'her', 'mı', 'mi', 'değil'],
  id: ['yang', 'dan', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'dalam', 'akan', 'pada', 'juga', 'saya', 'ke', 'karena', 'ada', 'bisa', 'kita', 'mereka'],
};

const LATIN_WORD = /^[a-z][a-z'’-]*$/;

function hanGuess(text: string): LangGuess {
  let ja = 0;
  let zh = 0;
  for (const ch of text) {
    if (JA_ONLY_HAN.has(ch)) ja += 1;
    else if (ZH_ONLY_HAN.has(ch)) zh += 1;
  }
  if (text.includes('々') || text.includes('〆')) ja += 2;
  if (ja > zh) return { lang: 'ja', confident: true };
  if (zh > ja) return { lang: 'zh', confident: true };
  return { lang: 'zh', confident: false };
}

function cyrillicGuess(text: string): LangGuess {
  if (/[іїєґ]/i.test(text)) return { lang: 'uk', confident: true };
  if (/[ђћџљњј]/i.test(text)) return { lang: 'sr', confident: true };
  if (/[ў]/i.test(text)) return { lang: 'be', confident: true };
  if (/[ңүөһ]/i.test(text)) return { lang: 'kk', confident: true };
  return { lang: 'ru', confident: true };
}

function arabicGuess(text: string): LangGuess {
  if (/[ٹڈڑںے]/.test(text)) return { lang: 'ur', confident: true };
  if (/[پچژگکی]/.test(text)) return { lang: 'fa', confident: true };
  return { lang: 'ar', confident: true };
}

function latinGuess(text: string): LangGuess {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [re, weights] of LATIN_MARKS) {
    if (!re.test(lower)) continue;
    for (const [lang, w] of Object.entries(weights)) scores[lang] = (scores[lang] || 0) + w;
  }
  const words = lower.split(/[^\p{L}'’]+/u).filter(Boolean).slice(0, 40);
  if (words.length > 1) {
    for (const [lang, list] of Object.entries(FUNCTION_WORDS)) {
      const hits = words.filter((w) => list.includes(w)).length;
      if (hits) scores[lang] = (scores[lang] || 0) + hits * 1.2;
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { lang: 'en', confident: false };
  const [best, top] = ranked[0];
  const second = ranked[1]?.[1] || 0;
  return { lang: best, confident: top >= 2 && top - second >= 1 };
}

/** Best local guess, with whether the text itself settles it. */
export function detectLanguageLocal(text: string): LangGuess {
  const t = String(text || '').replace(/[​-‍﻿]/g, '').trim();
  if (!t) return { lang: 'en', confident: false };
  if (HIRAGANA_KATAKANA.test(t)) return { lang: 'ja', confident: true };
  if (HANGUL.test(t)) return { lang: 'ko', confident: true };
  if (HAN.test(t)) return hanGuess(t);
  if (/[Ѐ-ӿ]/.test(t)) return cyrillicGuess(t);
  if (/[؀-ۿݐ-ݿ]/.test(t)) return arabicGuess(t);
  for (const [re, lang] of SCRIPTS) if (re.test(t)) return { lang, confident: true };
  return latinGuess(t);
}

/** True for a single plain-ASCII word, the case where an English word list can settle it. */
export function isPlainLatinWord(text: string): boolean {
  return LATIN_WORD.test(String(text || '').trim().toLowerCase());
}

/**
 * Accept a remote detector's answer only when it fits the script we saw: a remote "zh" for
 * Latin text, or "fr" for kanji, is a misfire on a short string.
 */
export function remoteFitsScript(text: string, remote: string): boolean {
  const r = String(remote || '').toLowerCase().split(/[-_]/)[0];
  if (!r || r === 'und' || r === 'auto') return false;
  const local = detectLanguageLocal(text);
  if (HAN.test(text)) return r === 'zh' || r === 'ja';
  if (/^[\p{Script=Latin}\p{M}\s\p{P}\d]+$/u.test(text)) return !['zh', 'ja', 'ko', 'ru', 'ar', 'el', 'he', 'hi', 'th', 'uk', 'fa'].includes(r);
  return r === local.lang;
}
