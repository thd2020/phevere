/**
 * Map English dictionary IPA onto engine phone strings.
 *
 * Chromium speechSynthesis strips SSML <phoneme>, so the popup cannot speak
 * IPA itself. Main process uses these strings with Windows SAPI, macOS `say`
 * PHON input, or eSpeak-ng [[…]] — never the headword spelling.
 */

import { cleanIpa } from './pronunciation';

export type IpaAccent = 'us' | 'uk' | 'other';

export function accentToBcp47(accent?: string): 'en-US' | 'en-GB' {
  return accent === 'uk' ? 'en-GB' : 'en-US';
}

/** IPA body without slashes; falls back to a light strip if cleanIpa rejects. */
export function phonemeIpa(raw?: string): string {
  const cleaned = cleanIpa(raw);
  if (cleaned) return cleaned;
  return String(raw || '')
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/^[/[\s]+/, '')
    .replace(/[/\]\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type Kind = 'v' | 'c';

/** [ipa, sapi, apple, espeak] — longest IPA first after sort. */
const PHONES: Array<[string, string, string, string, Kind]> = [
  ['tʃ', 'ch', 'C', 'tS', 'c'],
  ['dʒ', 'jh', 'J', 'dZ', 'c'],
  ['eɪ', 'ey', 'EY', 'eI', 'v'],
  ['aɪ', 'ay', 'AY', 'aI', 'v'],
  ['ɔɪ', 'oy', 'OY', 'OI', 'v'],
  ['oʊ', 'ow', 'OW', 'oU', 'v'],
  ['əʊ', 'ow', 'OW', '@U', 'v'],
  ['aʊ', 'aw', 'AW', 'aU', 'v'],
  ['ɪə', 'ih ax', 'IH AX', 'I@', 'v'],
  ['eə', 'eh ax', 'EH AX', 'E@', 'v'],
  ['ɛə', 'eh ax', 'EH AX', 'E@', 'v'],
  ['ʊə', 'uh ax', 'UH AX', 'U@', 'v'],
  ['ɔə', 'ao ax', 'AO AX', 'O@', 'v'],
  ['iː', 'iy', 'IY', 'i:', 'v'],
  ['uː', 'uw', 'UW', 'u:', 'v'],
  ['ɑː', 'aa', 'AA', 'A:', 'v'],
  ['ɔː', 'ao', 'AO', 'O:', 'v'],
  ['ɜː', 'er', 'ER', '3:', 'v'],
  ['oː', 'ao', 'AO', 'o:', 'v'],
  ['eː', 'ey', 'EY', 'e:', 'v'],
  ['ɛː', 'eh', 'EH', 'E:', 'v'],
  ['æː', 'ae', 'AE', '&:', 'v'],
  ['ʊː', 'uw', 'UW', 'U:', 'v'],
  ['ɝː', 'er', 'ER', '3:', 'v'],
  ['ɑɹ', 'aa r', 'AA r', 'Ar', 'v'],
  ['ɔɹ', 'ao r', 'AO r', 'Or', 'v'],
  ['ɪɹ', 'ih r', 'IH r', 'Ir', 'v'],
  ['ɛɹ', 'eh r', 'EH r', 'Er', 'v'],
  ['ʊɹ', 'uh r', 'UH r', 'Ur', 'v'],
  ['əɹ', 'ax r', 'AX r', '@r', 'v'],
  ['ɜɹ', 'er', 'ER', '3r', 'v'],
  ['θ', 'th', 'T', 'T', 'c'],
  ['ð', 'dh', 'D', 'D', 'c'],
  ['ʃ', 'sh', 'S', 'S', 'c'],
  ['ʒ', 'zh', 'Z', 'Z', 'c'],
  ['ŋ', 'ng', 'N', 'N', 'c'],
  ['ɹ', 'r', 'r', 'r', 'c'],
  ['ɫ', 'l', 'l', 'l', 'c'],
  ['ɾ', 'd', 'd', '4', 'c'],
  ['ʔ', 't', 't', '?', 'c'],
  ['ɡ', 'g', 'g', 'g', 'c'],
  ['ə', 'ax', 'AX', '@', 'v'],
  ['ɚ', 'ax r', 'AX r', '@r', 'v'],
  ['ɝ', 'er', 'ER', '3', 'v'],
  ['ɪ', 'ih', 'IH', 'I', 'v'],
  ['ɛ', 'eh', 'EH', 'E', 'v'],
  ['æ', 'ae', 'AE', '&', 'v'],
  ['ɑ', 'aa', 'AA', 'A', 'v'],
  ['ɒ', 'aa', 'AA', 'Q', 'v'],
  ['ɔ', 'ao', 'AO', 'O', 'v'],
  ['ʊ', 'uh', 'UH', 'U', 'v'],
  ['ʌ', 'ah', 'AX', 'V', 'v'],
  ['ɐ', 'ah', 'AX', 'V', 'v'],
  ['ɜ', 'er', 'ER', '3', 'v'],
  ['i', 'iy', 'IY', 'i', 'v'],
  ['u', 'uw', 'UW', 'u', 'v'],
  ['e', 'eh', 'EH', 'E', 'v'],
  ['o', 'ow', 'OW', 'o', 'v'],
  ['a', 'aa', 'AA', 'a', 'v'],
  ['ɨ', 'ih', 'IH', 'I', 'v'],
  ['ʉ', 'uw', 'UW', 'u', 'v'],
  ['ɵ', 'ow', 'OW', '8', 'v'],
  ['ɘ', 'ax', 'AX', '@', 'v'],
  ['ʏ', 'uh', 'UH', 'Y', 'v'],
  ['ᵻ', 'ih', 'IH', 'I', 'v'],
  ['ᵿ', 'uh', 'UH', 'U', 'v'],
  ['j', 'y', 'y', 'j', 'c'],
  ['w', 'w', 'w', 'w', 'c'],
  ['h', 'h', 'h', 'h', 'c'],
  ['x', 'hh', 'h', 'x', 'c'],
  ['ç', 'hh', 'h', 'C', 'c'],
  ['p', 'p', 'p', 'p', 'c'],
  ['b', 'b', 'b', 'b', 'c'],
  ['t', 't', 't', 't', 'c'],
  ['d', 'd', 'd', 'd', 'c'],
  ['k', 'k', 'k', 'k', 'c'],
  ['g', 'g', 'g', 'g', 'c'],
  ['f', 'f', 'f', 'f', 'c'],
  ['v', 'v', 'v', 'v', 'c'],
  ['s', 's', 's', 's', 'c'],
  ['z', 'z', 'z', 'z', 'c'],
  ['m', 'm', 'm', 'm', 'c'],
  ['n', 'n', 'n', 'n', 'c'],
  ['l', 'l', 'l', 'l', 'c'],
  ['r', 'r', 'r', 'r', 'c'],
];

const PHONES_SORTED = PHONES.slice().sort((a, b) => b[0].length - a[0].length);

interface Tok {
  sapi: string;
  apple: string;
  espeak: string;
  kind: Kind;
  stress: 0 | 1 | 2;
}

function prepareIpa(raw?: string): string {
  let s = phonemeIpa(raw);
  s = s.replace(/\u0361/g, '');
  s = s.replace(/[()[\]|]/g, '');
  s = s.replace(/[\u02B0-\u02B8]/g, '');
  s = s.replace(/\u032F/g, '');
  s = s.replace(/\u031A/g, '');
  s = s.replace(/\u0329/g, '');
  s = s.replace(/\u0306/g, '');
  return s;
}

function tokenize(raw?: string): Tok[] {
  const s = prepareIpa(raw);
  const out: Tok[] = [];
  let pending: 0 | 1 | 2 = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === 'ˈ' || ch === "'" || ch === '\u02C8') {
      pending = 1;
      i += 1;
      continue;
    }
    if (ch === 'ˌ' || ch === '\u02CC') {
      pending = 2;
      i += 1;
      continue;
    }
    if (ch === '.' || ch === ' ' || ch === '-' || ch === '‿' || ch === 'ˑ') {
      i += 1;
      continue;
    }
    if (ch === 'ː') {
      i += 1;
      continue;
    }
    let hit: (typeof PHONES)[number] | null = null;
    for (const row of PHONES_SORTED) {
      if (s.startsWith(row[0], i)) {
        hit = row;
        break;
      }
    }
    if (!hit) {
      i += 1;
      continue;
    }
    i += hit[0].length;
    if (s[i] === 'ː') i += 1;
    const stress = hit[4] === 'v' ? pending : 0;
    if (hit[4] === 'v') pending = 0;
    out.push({ sapi: hit[1], apple: hit[2], espeak: hit[3], kind: hit[4], stress });
  }
  return out;
}

function splitSapi(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

export function ipaToSapiPhones(raw?: string): string {
  const parts: string[] = [];
  for (const t of tokenize(raw)) {
    const phones = splitSapi(t.sapi);
    if (!phones.length) continue;
    if (t.kind === 'v' && t.stress) {
      parts.push(phones[0], String(t.stress), ...phones.slice(1));
    } else {
      parts.push(...phones);
    }
  }
  return parts.join(' ');
}

export function ipaToApplePhonemes(raw?: string): string {
  let out = '';
  for (const t of tokenize(raw)) {
    const bits = t.apple.split(/\s+/).filter(Boolean);
    for (let i = 0; i < bits.length; i += 1) {
      out += bits[i];
      if (t.kind === 'v' && t.stress && i === 0) out += String(t.stress);
    }
  }
  return out;
}

export function ipaToEspeakPhonemes(raw?: string): string {
  let out = '';
  for (const t of tokenize(raw)) {
    if (t.kind === 'v' && t.stress === 1) out += "'";
    else if (t.kind === 'v' && t.stress === 2) out += ',';
    out += t.espeak;
  }
  return out;
}

export function xmlEscapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/'/g, '&apos;');
}

export function buildSapiPhonemeSsml(ipa: string, lang: string): string | null {
  const ph = ipaToSapiPhones(ipa);
  if (!ph) return null;
  const xmlLang = xmlEscapeAttr(lang);
  return `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlLang}">
  <phoneme alphabet="sapi" ph="${xmlEscapeAttr(ph)}">&#x2060;</phoneme>
</speak>`;
}

export function buildIpaPhonemeSsml(ipa: string, lang: string): string | null {
  const ph = phonemeIpa(ipa);
  if (!ph) return null;
  const xmlLang = xmlEscapeAttr(lang);
  return `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlLang}">
  <phoneme alphabet="ipa" ph="${xmlEscapeAttr(ph)}">&#x2060;</phoneme>
</speak>`;
}
