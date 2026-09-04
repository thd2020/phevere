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
  s = s.replace(/\\/g, '/');
  s = s.replace(/^[/[\s]+/, '').replace(/[/\]\s]+$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length < 2) return '';
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

  let lineAccents: AccentTag[] = ['other'];
  for (const line of lines) {
    const aLabel = line.match(/\{\{\s*a\s*\|([^}]+)\}\}/i);
    if (aLabel) lineAccents = accentsFromHint(aLabel[1]);

    const audio = line.match(/\{\{\s*audio\s*\|[^}]*\b(a|accent)\s*=\s*([^|}]+)/i);
    if (audio) lineAccents = accentsFromHint(audio[2]);

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
  for (const list of lists) {
    for (const p of list || []) {
      const ipa = cleanIpa(p.ipa);
      if (!ipa) continue;
      const accent = p.accent || 'other';
      const key = `${accent}:${ipa}`;
      const audioUrl = p.audioUrl ? normalizePronunciationAudioUrl(p.audioUrl) : '';
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.audioUrl && audioUrl) existing.audioUrl = audioUrl;
        continue;
      }
      byKey.set(key, { ipa, accent, source: p.source, ...(audioUrl ? { audioUrl } : {}) });
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

export function formatPronunciationLine(list?: Pronunciation[]): string {
  if (!list || !list.length) return '';
  const parts: string[] = [];
  const used = new Set<string>();
  const push = (label: string, ipa: string) => {
    if (used.has(ipa) && label === '') return;
    used.add(ipa);
    parts.push(label ? `${label} /${ipa}/` : `/${ipa}/`);
  };
  const us = list.find((p) => p.accent === 'us');
  const uk = list.find((p) => p.accent === 'uk');
  if (us && uk && us.ipa === uk.ipa) {
    push('', us.ipa);
  } else {
    if (us) push('US', us.ipa);
    if (uk) push('UK', uk.ipa);
  }
  for (const p of list) {
    if (p === us || p === uk) continue;
    if (used.has(p.ipa)) continue;
    push(p.accent === 'us' ? 'US' : p.accent === 'uk' ? 'UK' : '', p.ipa);
  }
  return parts.join('  ·  ');
}
