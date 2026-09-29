/**
 * General American IPA from the CMU Pronouncing Dictionary (134k words, ARPAbet).
 * Fallback for English words whose Wiktionary entry has no IPA (e.g. "rejuvenation")
 * while Free Dictionary is unreachable. Loaded lazily: the table is about 4.7 MB of JS.
 */

const VOWELS: Record<string, [stressed: string, unstressed: string]> = {
  AA: ['ɑ', 'ɑ'],
  AE: ['æ', 'æ'],
  AH: ['ʌ', 'ə'],
  AO: ['ɔ', 'ɔ'],
  AW: ['aʊ', 'aʊ'],
  AY: ['aɪ', 'aɪ'],
  EH: ['ɛ', 'ɛ'],
  ER: ['ɝ', 'ɚ'],
  EY: ['eɪ', 'eɪ'],
  IH: ['ɪ', 'ɪ'],
  IY: ['i', 'i'],
  OW: ['oʊ', 'oʊ'],
  OY: ['ɔɪ', 'ɔɪ'],
  UH: ['ʊ', 'ʊ'],
  UW: ['u', 'u'],
};

const CONSONANTS: Record<string, string> = {
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l',
  M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v',
  W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

/** English onsets longer than one consonant; the stress mark goes before the longest legal one. */
const ONSETS = new Set([
  'P R', 'P L', 'B R', 'B L', 'T R', 'D R', 'K R', 'K L', 'G R', 'G L', 'F R', 'F L',
  'TH R', 'SH R', 'S P', 'S T', 'S K', 'S M', 'S N', 'S L', 'S W', 'S F', 'T W', 'D W',
  'K W', 'G W', 'TH W', 'P Y', 'B Y', 'F Y', 'K Y', 'M Y', 'V Y', 'HH Y', 'G Y', 'N Y', 'L Y',
  'S P R', 'S P L', 'S T R', 'S K R', 'S K W', 'S K Y', 'S P Y',
]);

function isOnset(cluster: string[]): boolean {
  if (cluster.length === 0) return true;
  if (cluster.length === 1) return cluster[0] !== 'NG';
  return ONSETS.has(cluster.join(' '));
}

/** "R IH0 JH UW2 V AH0 N EY1 SH AH0 N" → "ɹɪˌdʒuvəˈneɪʃən". */
export function arpabetToIpa(arpabet: string): string {
  const phones = arpabet.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let pendingConsonants: string[] = [];
  let seenVowel = false;
  const flush = (stressMark: string) => {
    // Consonants before this vowel: the tail that forms a legal onset starts the syllable.
    let split = seenVowel ? pendingConsonants.length : 0;
    if (seenVowel) {
      for (let i = 0; i <= pendingConsonants.length; i++) {
        if (isOnset(pendingConsonants.slice(i))) {
          split = i;
          break;
        }
      }
    }
    const coda = pendingConsonants.slice(0, split).map((c) => CONSONANTS[c] || '');
    const onset = pendingConsonants.slice(split).map((c) => CONSONANTS[c] || '');
    out.push(...coda, stressMark, ...onset);
    pendingConsonants = [];
  };
  phones.forEach((raw) => {
    const m = raw.match(/^([A-Z]+)([012])?$/);
    if (!m) return;
    const [, base, stress] = m;
    const vowel = VOWELS[base];
    if (!vowel) {
      pendingConsonants.push(base);
      return;
    }
    const mark = stress === '1' ? 'ˈ' : stress === '2' ? 'ˌ' : '';
    flush(mark);
    out.push(stress === '0' ? vowel[1] : vowel[0]);
    seenVowel = true;
  });
  out.push(...pendingConsonants.map((c) => CONSONANTS[c] || ''));
  const ipa = out.join('');
  // One syllable: a stress mark adds nothing (Wiktionary writes /kæt/, not /ˈkæt/).
  const syllables = phones.filter((p) => /[012]$/.test(p)).length;
  return syllables <= 1 ? ipa.replace(/[ˈˌ]/g, '') : ipa;
}

let table: Promise<Record<string, string> | null> | null = null;

function loadTable(): Promise<Record<string, string> | null> {
  if (!table) {
    table = import('cmu-pronouncing-dictionary')
      .then((m: { dictionary?: Record<string, string> }) => m.dictionary || null)
      .catch((): null => null);
  }
  return table;
}

/** Start loading early so the first English lookup does not wait on the parse. */
export function warmCmuIpa(): void {
  void loadTable();
}

/** US IPA for one English word, or '' when CMUdict does not list it. */
export async function cmuIpaFor(word: string): Promise<string> {
  const key = String(word || '').trim().toLowerCase();
  if (!key || !/^[a-z][a-z'.-]*$/.test(key)) return '';
  const dict = await loadTable();
  const arpabet = dict?.[key];
  return arpabet ? arpabetToIpa(arpabet) : '';
}
