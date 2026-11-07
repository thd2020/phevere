/**
 * IPA helpers: clean glyphs, split US/UK from Free Dictionary + Wiktionary.
 */

export type AccentTag = 'us' | 'uk' | 'other';

export interface Pronunciation {
  ipa: string;
  accent?: AccentTag;
  source?: string;
  /** Recorded clip when the source sent one (Free Dictionary Google MP3s). */
  audioUrl?: string;
}

const IPA_LETTER = /[ˈˌəɚɝɨʉɪɛæɑɒɔʊʌɐɜɵɘʔθðʃʒŋː‿.ᵻᵿãẽĩõũɡɹɾɫ]/;

export function cleanIpa(raw?: string): string {
  if (!raw) return '';
  let s = String(raw).normalize('NFC').trim();
  // Wiktionary inline modifiers: `/ˈsʌnɪt/<q:obsolete><ref:{{R:…}}>` keeps only the IPA.
  s = s.replace(/<[\s\S]*$/, '').replace(/\{\{[\s\S]*$/, '').trim();
  s = s.replace(/\\/g, '/');
  s = s.replace(/^[/[\s]+/, '').replace(/[/\]\s]+$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length < 2) return '';
  // Usage notes sometimes land in IPA slots ("This word is often pronounced …").
  if (s.length > 48 || /[=☞<>{}|]/.test(s) || s.split(' ').length > 4) return '';
  if (!IPA_LETTER.test(s) && !/[ˈˌ]/.test(s)) return '';
  return s;
}

function hintHasUs(h: string): boolean {
  return /\b(us|ga|genam|america|general american)\b/.test(h) || /[-_/]us[-_./]/.test(h) || /us[-_.]/.test(h);
}

function hintHasUk(h: string): boolean {
  return /\b(uk|gb|rp|brit|received)\b/.test(h) || /[-_/]uk[-_./]/.test(h) || /[-_/]gb[-_./]/.test(h);
}

/** One IPA line may be tagged `a=RP,GA` — keep both, do not pick the first match. */
export function accentsFromHint(hint?: string): AccentTag[] {
  const h = (hint || '').toLowerCase();
  const out: AccentTag[] = [];
  if (hintHasUs(h)) out.push('us');
  if (hintHasUk(h)) out.push('uk');
  return out.length ? out : ['other'];
}

/** Protocol-relative `//ssl.gstatic.com/…` → https. Empty if not an http(s) URL. */
export function normalizePronunciationAudioUrl(raw?: string): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (s.startsWith('//')) s = `https:${s}`;
  if (!/^https?:\/\//i.test(s)) return '';
  return s;
}

export function parseFreeDictionaryPhonetics(data: {
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
}): Pronunciation[] {
  const out: Pronunciation[] = [];
  const seen = new Set<string>();
  const add = (text: string | undefined, hint: string, source = 'Free Dictionary API', audioUrl?: string) => {
    const ipa = cleanIpa(text);
    if (!ipa) return;
    for (const accent of accentsFromHint(hint)) {
      const key = `${accent}:${ipa}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ipa, accent, source, ...(audioUrl ? { audioUrl } : {}) });
    }
  };

  if (Array.isArray(data?.phonetics)) {
    for (const p of data.phonetics) {
      add(p?.text, `${p?.audio || ''} ${p?.text || ''}`, 'Free Dictionary API', normalizePronunciationAudioUrl(p?.audio));
    }
  }
  add(data?.phonetic, data?.phonetic || '');
  return out;
}

function isEnglishIpaTemplate(args: string[]): boolean {
  if (args.some((a) => a === 'en' || /^lang\s*=\s*en$/i.test(a))) return true;
  // `{{IPA|/foo/}}` inside ==English== with no lang is usually English.
  return args.length > 0 && (args[0].startsWith('/') || args[0].startsWith('['));
}

function commonsFileUrl(fileName: string): string {
  const f = String(fileName || '')
    .replace(/^File:/i, '')
    .trim()
    .replace(/ /g, '_');
  if (!f) return '';
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}`;
}

function parseWikiAudioTemplate(argsRaw: string): { url: string; accents: AccentTag[] } | null {
  const args = String(argsRaw || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  let file = '';
  let hint = '';
  for (const arg of args) {
    if (/^(en|lang\s*=\s*en)$/i.test(arg)) continue;
    if (/^(a|aa|q|qq|text|ipa|lang)\s*=/i.test(arg)) {
      hint += ` ${arg.split('=').slice(1).join('=')}`;
      continue;
    }
    if (/\.(ogg|oga|mp3|wav|flac|opus|webm)$/i.test(arg) || /^File:/i.test(arg)) {
      file = arg.replace(/^File:/i, '');
      continue;
    }
    hint += ` ${arg}`;
  }
  if (!file) return null;
  const url = commonsFileUrl(file);
  if (!url) return null;
  const fromName = file.replace(/[-_./]/g, ' ');
  let accents = accentsFromHint(`${hint} ${fromName}`);
  if (accents.length === 1 && accents[0] === 'other') {
    accents = accentsFromHint(fromName);
  }
  return { url, accents };
}

/** Pull {{IPA|en|/…/|a=GA}} (and nearby {{a|RP}}) from English Pronunciation. */
export function extractIpaFromWikitext(wikitext: string): Pronunciation[] {
  if (!wikitext) return [];
  const start = wikitext.indexOf('==English==');
  const english = start >= 0 ? wikitext.slice(start) : wikitext;
  const pronMatch = english.match(/===\s*Pronunciation\s*===([\s\S]*?)(?=\n===\s*[A-Za-z]|\n==[^=]|$)/i);
  const block = pronMatch ? pronMatch[1] : english.slice(0, 4000);
  const lines = block.split('\n');
  const out: Pronunciation[] = [];
  const seen = new Set<string>();

  const audioByAccent = new Map<AccentTag, string>();
  let lineAccents: AccentTag[] = ['other'];
  for (const line of lines) {
    // {{a|UK}} labels only the bullet it sits on; nested "**" lines inherit it.
    if (!/^\s*\*\*/.test(line)) lineAccents = ['other'];
    const aLabel = line.match(/\{\{\s*a\s*\|([^}]+)\}\}/i);
    if (aLabel) lineAccents = accentsFromHint(aLabel[1]);

    const audioHint = line.match(/\{\{\s*audio\s*\|[^}]*\b(a|accent)\s*=\s*([^|}]+)/i);
    if (audioHint) lineAccents = accentsFromHint(audioHint[2]);

    const audioRe = /\{\{\s*audio(?:-IPA)?\s*\|([^}]+)\}\}/gi;
    let am: RegExpExecArray | null;
    while ((am = audioRe.exec(line))) {
      const parsed = parseWikiAudioTemplate(am[1]);
      if (!parsed) continue;
      for (const accent of parsed.accents) {
        if (!audioByAccent.has(accent)) audioByAccent.set(accent, parsed.url);
      }
    }

    const re = /\{\{\s*IPA\s*\|([^}]+)\}\}/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const args = m[1].split('|').map((x) => x.trim()).filter(Boolean);
      if (!isEnglishIpaTemplate(args)) continue;
      let accents = lineAccents;
      const ipas: string[] = [];
      for (const arg of args) {
        if (arg === 'en') continue;
        if (/^(a|qual|lang|audio)\s*=/i.test(arg)) {
          const v = arg.split('=').slice(1).join('=');
          if (/^lang\s*=/i.test(arg)) continue;
          const tagged = accentsFromHint(v);
          if (!(tagged.length === 1 && tagged[0] === 'other')) accents = tagged;
        } else if (arg.includes('=')) {
          continue; // other named params (passage=, ref=, nocount=…) are prose, not IPA
        } else if (arg.startsWith('[')) {
          continue; // narrow phonetic; users want phonemic /…/
        } else if (arg.startsWith('/') || IPA_LETTER.test(arg)) {
          ipas.push(arg);
        }
      }
      for (const raw of ipas) {
        const ipa = cleanIpa(raw);
        if (!ipa) continue;
        for (const accent of accents) {
          const key = `${accent}:${ipa}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ ipa, accent, source: 'Wiktionary' });
        }
      }
    }
  }
  for (const p of out) {
    if (p.audioUrl) continue;
    const u = audioByAccent.get(p.accent || 'other') || audioByAccent.get('other');
    if (u) p.audioUrl = u;
  }
  for (const [accent, url] of audioByAccent) {
    if (out.some((p) => p.audioUrl === url)) continue;
    out.push({ ipa: '', accent, source: 'Wiktionary', audioUrl: url });
  }
  return out;
}

/**
 * When the surface form has no IPA (intensionality), try the derivational stem
 * (intensional). Inflection (plurals) is handled by wink lemmas elsewhere.
 */
export function derivationalStems(word: string): string[] {
  const w = (word || '').trim().toLocaleLowerCase();
  if (!w || w.length < 6) return [];
  const suffixes = [
    'ization',
    'isation',
    'ionality',
    'ability',
    'ibility',
    'ational',
    'ality',
    'ility',
    'ivity',
    'ation',
    'ness',
    'ment',
    'ity',
    'ily',
    'ally',
    'ly',
  ];
  const out: string[] = [];
  const seen = new Set<string>([w]);
  for (const suf of suffixes) {
    if (!w.endsWith(suf) || w.length - suf.length < 4) continue;
    const stem = w.slice(0, -suf.length);
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(stem);
  }
  return out.slice(0, 3);
}

export function mergePronunciations(...lists: Array<Pronunciation[] | undefined>): Pronunciation[] {
  const byKey = new Map<string, Pronunciation>();
  const extraAudio: Pronunciation[] = [];
  for (const list of lists) {
    for (const p of list || []) {
      const ipa = cleanIpa(p.ipa);
      const accent = p.accent || 'other';
      const audioUrl = p.audioUrl ? normalizePronunciationAudioUrl(p.audioUrl) : '';
      if (!ipa) {
        if (audioUrl) extraAudio.push({ ipa: '', accent, source: p.source, audioUrl });
        continue;
      }
      const key = `${accent}:${ipa}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.audioUrl && audioUrl) existing.audioUrl = audioUrl;
        continue;
      }
      byKey.set(key, { ipa, accent, source: p.source, ...(audioUrl ? { audioUrl } : {}) });
    }
  }
  for (const a of extraAudio) {
    let attached = false;
    for (const p of byKey.values()) {
      if (p.accent === a.accent && !p.audioUrl) {
        p.audioUrl = a.audioUrl;
        attached = true;
      }
    }
    if (!attached && a.audioUrl) {
      byKey.set(`audio:${a.accent}:${a.audioUrl}`, a);
    }
  }
  const out = [...byKey.values()];
  const us = out.filter((p) => p.accent === 'us');
  const uk = out.filter((p) => p.accent === 'uk');
  const other = out.filter((p) => p.accent !== 'us' && p.accent !== 'uk');
  const ordered = [...us, ...uk, ...other];
  const ipaOnce = new Set<string>();
  const deduped: Pronunciation[] = [];
  for (const p of ordered) {
    if (p.accent === 'other' && ipaOnce.has(p.ipa) && (us.some((x) => x.ipa === p.ipa) || uk.some((x) => x.ipa === p.ipa))) {
      continue;
    }
    ipaOnce.add(p.ipa);
    deduped.push(p);
  }
  return deduped.slice(0, 6);
}

const VOWELS = 'aeiouyæɑɒɔəɚɛɜɝɪʊʌɐɵɘʉɨøœɤɯ';
/** An r closing a syllable: after a vowel, before a consonant, a space or the end ("ˈkɑɹd", "ˈfɔɹ"). */
const CODA_R = new RegExp(`[${VOWELS}ː][ɹr](?=$|\\s|[^${VOWELS}ː.\\s])`);

/**
 * The accent an unlabelled English transcription is written in, from the sounds that tell them
 * apart: ɒ, əʊ and an optional (r) are British; ɚ, ɝ, oʊ, the flap ɾ and an r closing a syllable
 * are American. Null when it has neither or both.
 */
export function inferAccent(ipa: string): 'us' | 'uk' | null {
  const s = ipa.replace(/[ˈˌ]/g, '');
  const uk = /ɒ|əʊ|\((ɹ|r)\)/.test(s);
  const us = /[ɚɝɾ]|oʊ/.test(s) || CODA_R.test(s);
  return uk === us ? null : uk ? 'uk' : 'us';
}

/**
 * What two transcriptions of one pronunciation share: no syllable dots, ties, brackets or secondary
 * stress, r and g in one form, ɚ as əɹ, and the unstressed "happy" vowel as i, so /ˌmɒ.ɹəˈtɔː.ɹi.əm/
 * and /mɒrəˈtɔːrɪəm/ count as one.
 */
export function ipaKey(ipa: string): string {
  return String(ipa || '')
    .replace(/[.‿͡()ˌ\s]/g, '')
    .replace(/r/g, 'ɹ')
    .replace(/g/g, 'ɡ')
    .replace(/ɚ/g, 'əɹ')
    .replace(/ɝ/g, 'ɜɹ')
    .replace(/ɪ(?=ə|$)/g, 'i');
}

/**
 * The pronunciations a reader sees, the way learner's dictionaries (Cambridge, Oxford, Longman)
 * show them: British first, then American, one each, and at most one more variant. Each accent's
 * main one is the transcription most sources agree on, the earlier source on a tie, so a rare
 * variant listed first by one source does not lead. An unlabelled English transcription is filed
 * under the accent its sounds show (`inferAccent`), and one that only repeats a shown one in other
 * notation is dropped. Other languages keep up to two. Entries with only a recording stay last for
 * the speaker.
 */
export function tidyPronunciations(list: Pronunciation[] | undefined, lang?: string): Pronunciation[] {
  const all = list || [];
  const english = !lang || lang === 'auto' || /^en(?:$|[-_])/i.test(lang);
  const groups = new Map<string, { p: Pronunciation; count: number; first: number; accent: AccentTag }>();
  all.forEach((p, i) => {
    if (!p.ipa) return;
    const accent: AccentTag = p.accent === 'us' || p.accent === 'uk' ? p.accent : english ? inferAccent(p.ipa) || 'other' : 'other';
    const id = `${accent}:${ipaKey(p.ipa)}`;
    const g = groups.get(id);
    if (g) {
      g.count += 1;
      if (!g.p.audioUrl && p.audioUrl) g.p = { ...g.p, audioUrl: p.audioUrl };
    } else {
      groups.set(id, { p: { ...p, accent }, count: 1, first: i, accent });
    }
  });
  const ranked = (accent: AccentTag) =>
    [...groups.values()].filter((g) => g.accent === accent).sort((a, b) => b.count - a.count || a.first - b.first);
  const uk = ranked('uk');
  const us = ranked('us');
  const other = ranked('other');
  const shown: Pronunciation[] = [];
  // A variant is new only if it sounds different with length marks set aside: Wiktionary's American
  // transcriptions often leave out the ː its British ones write.
  const loose = (ipa: string) => ipaKey(ipa).replace(/ː/g, '');
  const keys = new Set<string>();
  const show = (g?: { p: Pronunciation }) => {
    if (!g) return;
    shown.push(g.p);
    keys.add(loose(g.p.ipa));
  };
  show(uk[0]);
  show(us[0]);
  const labelled = shown.length > 0;
  // Then the best-supported remaining transcription that sounds different from those shown.
  const rest = [...uk.slice(1), ...us.slice(1), ...other].sort((a, b) => b.count - a.count || a.first - b.first);
  let more = labelled ? 1 : 2;
  for (const g of rest) {
    if (more <= 0) break;
    if (keys.has(loose(g.p.ipa))) continue;
    show(g);
    more -= 1;
  }
  const audioOnly = all.filter((p) => !p.ipa && p.audioUrl);
  return [...shown, ...audioOnly];
}

/** Recorded clip URLs, US then UK then other — for the toolbar speaker, not IPA chips. */
export function recordedPronunciationUrls(list?: Pronunciation[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (p: Pronunciation) => {
    const u = p.audioUrl ? normalizePronunciationAudioUrl(p.audioUrl) : '';
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };
  for (const p of list || []) if (p.accent === 'us') push(p);
  for (const p of list || []) if (p.accent === 'uk') push(p);
  for (const p of list || []) if (p.accent !== 'us' && p.accent !== 'uk') push(p);
  return urls;
}

export function formatPronunciationLine(list?: Pronunciation[]): string {
  if (!list || !list.length) return '';
  const parts: string[] = [];
  const used = new Set<string>();
  const push = (label: string, ipa: string) => {
    if (used.has(ipa) && label === '') return;
    used.add(ipa);
    parts.push(label ? `${label} /${ipa}/` : `/${ipa}/`);
  };
  const us = list.find((p) => p.accent === 'us' && p.ipa);
  const uk = list.find((p) => p.accent === 'uk' && p.ipa);
  if (us && uk && us.ipa === uk.ipa) {
    push('', us.ipa);
  } else {
    if (uk) push('UK', uk.ipa);
    if (us) push('US', us.ipa);
  }
  for (const p of list) {
    if (!p.ipa) continue;
    if (p === us || p === uk) continue;
    if (used.has(p.ipa)) continue;
    push(p.accent === 'us' ? 'US' : p.accent === 'uk' ? 'UK' : '', p.ipa);
  }
  return parts.join('  ·  ');
}
