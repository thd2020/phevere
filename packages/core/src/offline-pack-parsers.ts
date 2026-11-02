/** Pure parsers for official/open dictionary dumps (no Node/Electron APIs). */

import { canonicalPos } from './definition-merge';

export interface ParsedOfflineEntry {
  headword: string;
  language: string;
  pos?: string;
  definition: string;
  extra?: unknown;
}

const WN_POS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  s: 'adjective',
  r: 'adverb',
};

/** WordNet wndb `data.*` line → one row per lemma in the synset. */
export function parseWordNetData(content: string): ParsedOfflineEntry[] {
  const out: ParsedOfflineEntry[] = [];
  const seen = new Set<string>();
  for (const raw of content.split(/\n/)) {
    const line = raw.trimEnd();
    if (!/^\d{8} /.test(line)) continue;
    const bar = line.indexOf('|');
    if (bar < 0) continue;
    const gloss = line.slice(bar + 1).replace(/\s+/g, ' ').trim();
    if (!gloss) continue;
    const meta = line.slice(0, bar).trim().split(/\s+/);
    if (meta.length < 4) continue;
    const pos = WN_POS[meta[2]] || canonicalPos(meta[2]) || 'definition';
    const wCnt = parseInt(meta[3], 16);
    if (!Number.isFinite(wCnt) || wCnt < 1) continue;
    let i = 4;
    for (let w = 0; w < wCnt && i < meta.length; w++) {
      const lemma = (meta[i] || '')
        .replace(/_/g, ' ')
        .replace(/\([^)]*\)$/, '')
        .trim();
      i += 2;
      if (!lemma || lemma.length > 80) continue;
      const key = `${lemma.toLowerCase()}|${pos}|${gloss}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ headword: lemma, language: 'en', pos, definition: gloss });
    }
  }
  return out;
}

function decodeLiteEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripMarkup(s: string): string {
  return decodeLiteEntities(
    s
      .replace(/<br\s*\//gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function cleanGcideHeadword(raw: string): string {
  return stripMarkup(raw)
    .replace(/[*`"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * GNU GCIDE CIDE.* SGML (almost-XML). Entries are `<p>` blocks with `<ent>`/`<hw>`/`<def>`.
 */
export function parseGcideCide(content: string): ParsedOfflineEntry[] {
  const out: ParsedOfflineEntry[] = [];
  const seen = new Set<string>();
  const blocks = content.split(/<p(?:\s[^>]*)?>/i);
  for (const block of blocks) {
    const body = block.split(/<\/p>/i)[0] || block;
    if (!/<hw[\s>]|<ent[\s>]/i.test(body) || !/<def[\s>]/i.test(body)) continue;
    const ent = (body.match(/<ent>([\s\S]*?)<\/ent>/i) || [])[1];
    const hw = (body.match(/<hw>([\s\S]*?)<\/hw>/i) || [])[1];
    const headword = cleanGcideHeadword(ent || hw || '');
    if (!headword || headword.length > 80) continue;
    const posRaw = (body.match(/<pos>([\s\S]*?)<\/pos>/i) || [])[1];
    const pos = posRaw ? canonicalPos(stripMarkup(posRaw)) : 'definition';
    const defs: string[] = [];
    const defRe = /<def>([\s\S]*?)<\/def>/gi;
    let m: RegExpExecArray | null;
    while ((m = defRe.exec(body))) {
      const d = stripMarkup(m[1]);
      if (d) defs.push(d);
    }
    if (!defs.length) continue;
    const definition = defs.join('; ');
    const key = `${headword.toLowerCase()}|${pos}|${definition.slice(0, 180)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ headword, language: 'en', pos, definition });
  }
  return out;
}

/** One FreeDict TEI `<entry>` body: `<orth>` headwords and `<cit type="trans"><quote>` glosses. */
export function parseFreedictTeiEntry(body: string, language = 'en', seen?: Set<string>): ParsedOfflineEntry[] {
  const out: ParsedOfflineEntry[] = [];
  const orths: string[] = [];
  const orthRe = /<orth\b[^>]*>([\s\S]*?)<\/orth>/gi;
  let om: RegExpExecArray | null;
  while ((om = orthRe.exec(body))) {
    const h = stripMarkup(om[1]);
    if (h && h.length <= 80) orths.push(h);
  }
  if (!orths.length) return out;
  const glosses: string[] = [];
  const quoteRe = /<cit\b[^>]*type="trans"[^>]*>[\s\S]*?<quote\b[^>]*>([\s\S]*?)<\/quote>/gi;
  let qm: RegExpExecArray | null;
  while ((qm = quoteRe.exec(body))) {
    const g = stripMarkup(qm[1]);
    if (g) glosses.push(g);
  }
  if (!glosses.length) {
    const senseRe = /<def\b[^>]*>([\s\S]*?)<\/def>/gi;
    let dm: RegExpExecArray | null;
    while ((dm = senseRe.exec(body))) {
      const g = stripMarkup(dm[1]);
      if (g) glosses.push(g);
    }
  }
  if (!glosses.length) return out;
  const definition = Array.from(new Set(glosses)).join('; ');
  const posRaw = (body.match(/<pos\b[^>]*>([\s\S]*?)<\/pos>/i) || [])[1];
  const pos = posRaw ? canonicalPos(stripMarkup(posRaw)) : 'translation';
  for (const headword of Array.from(new Set(orths))) {
    const key = `${headword.toLowerCase()}|${definition}`;
    if (seen) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push({ headword, language, pos, definition });
  }
  return out;
}

/**
 * FreeDict TEI in either direction. `language` is the headword language: `en` for
 * eng-zho, `de` for deu-eng, and so on.
 */
export function parseFreedictTei(content: string, language = 'en'): ParsedOfflineEntry[] {
  const out: ParsedOfflineEntry[] = [];
  const seen = new Set<string>();
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let em: RegExpExecArray | null;
  while ((em = entryRe.exec(content))) {
    for (const row of parseFreedictTeiEntry(em[1], language, seen)) out.push(row);
  }
  return out;
}

/**
 * Takes TEI text in pieces (lines from a file stream) and hands out parsed rows as
 * each `</entry>` closes, so the 450 MB German file never sits in memory at once.
 */
export class FreedictTeiStream {
  private buf = '';
  private seen = new Set<string>();
  constructor(private language: string, private onRows: (rows: ParsedOfflineEntry[]) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    for (;;) {
      const open = this.buf.search(/<entry\b/i);
      if (open < 0) {
        // Keep a tail in case "<entry" is split across chunks.
        if (this.buf.length > 16) this.buf = this.buf.slice(-16);
        return;
      }
      const close = this.buf.indexOf('</entry>', open);
      if (close < 0) {
        if (open > 0) this.buf = this.buf.slice(open);
        return;
      }
      const inner = this.buf.slice(this.buf.indexOf('>', open) + 1, close);
      this.buf = this.buf.slice(close + 8);
      const rows = parseFreedictTeiEntry(inner, this.language, this.seen);
      if (rows.length) this.onRows(rows);
    }
  }
}

/** CC-CEDICT line: `傳統 传统 [chuan2 tong3] /tradition/traditional/`. */
export function parseCedictLine(line: string): ParsedOfflineEntry[] {
  if (!line || line.startsWith('#')) return [];
  const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.+)\/\s*$/);
  if (!m) return [];
  const [, traditional, simplified, pinyin, body] = m;
  const defs = body
    .split('/')
    .map((d) => d.trim())
    .filter(Boolean);
  const definition = `[${pinyin}] ${defs.join('; ')}`;
  return Array.from(new Set([simplified, traditional])).map((head) => ({
    headword: head,
    language: 'zh',
    definition,
    extra: { traditional, simplified, pinyin },
  }));
}

export function parseCedict(text: string): ParsedOfflineEntry[] {
  const out: ParsedOfflineEntry[] = [];
  for (const line of text.split(/\r?\n/)) for (const row of parseCedictLine(line)) out.push(row);
  return out;
}

const JMDICT_POS: Array<[RegExp, string]> = [
  [/^(v1|v5|v2|v4|vk|vs|vz|vn|vr|vt|vi|v-unspec|aux-v|cop)/, 'verb'],
  [/^adj-/, 'adjective'],
  [/^adv/, 'adverb'],
  [/^pn$/, 'pronoun'],
  [/^n/, 'noun'],
  [/^exp$/, 'phrase'],
  [/^int$/, 'interjection'],
  [/^conj$/, 'conjunction'],
  [/^prt$/, 'particle'],
  [/^ctr$/, 'counter'],
  [/^suf$/, 'suffix'],
  [/^pref$/, 'prefix'],
  [/^num$/, 'numeral'],
  [/^aux/, 'auxiliary'],
];

function jmdictPos(codes: unknown): string | null {
  for (const code of Array.isArray(codes) ? codes : []) {
    for (const [re, pos] of JMDICT_POS) if (re.test(String(code))) return pos;
  }
  return null;
}

/**
 * One word object from jmdict-simplified (`jmdict-eng-*.json` holds one word per
 * line inside `"words": [...]`). Senses that share a part of speech become one row
 * per spelling; kanji spellings carry their reading in brackets, as CC-CEDICT rows do.
 */
export function parseJmdictWord(word: any): ParsedOfflineEntry[] {
  const kanji: Array<{ text: string }> = Array.isArray(word?.kanji) ? word.kanji : [];
  const kana: Array<{ text: string; appliesToKanji?: string[] }> = Array.isArray(word?.kana) ? word.kana : [];
  const groups: Array<{ pos: string; glosses: string[] }> = [];
  let pos = 'unknown';
  for (const sense of Array.isArray(word?.sense) ? word.sense : []) {
    const p = jmdictPos(sense?.partOfSpeech);
    if (p) pos = p;
    const glosses = (Array.isArray(sense?.gloss) ? sense.gloss : [])
      .filter((g: any) => !g?.lang || g.lang === 'eng')
      .map((g: any) => String(g?.text || '').trim())
      .filter(Boolean);
    if (!glosses.length) continue;
    const last = groups[groups.length - 1];
    if (last && last.pos === pos) last.glosses.push(...glosses);
    else groups.push({ pos, glosses });
  }
  if (!groups.length) return [];
  const out: ParsedOfflineEntry[] = [];
  const readingFor = (k: string) =>
    (kana.find((r) => !r.appliesToKanji || r.appliesToKanji.includes('*') || r.appliesToKanji.includes(k)) || kana[0])?.text;
  for (const g of groups) {
    const gloss = Array.from(new Set(g.glosses)).join('; ');
    for (const k of kanji) {
      if (!k?.text) continue;
      const reading = readingFor(k.text);
      out.push({
        headword: k.text,
        language: 'ja',
        pos: g.pos,
        definition: reading ? `[${reading}] ${gloss}` : gloss,
      });
    }
    for (const r of kana) {
      if (!r?.text) continue;
      out.push({ headword: r.text, language: 'ja', pos: g.pos, definition: gloss });
    }
  }
  return out;
}

/** A line of the jmdict-simplified JSON; header and footer lines yield nothing. */
export function parseJmdictLine(line: string): ParsedOfflineEntry[] {
  const t = line.trim().replace(/,$/, '');
  if (!t.startsWith('{"id"')) return [];
  try {
    return parseJmdictWord(JSON.parse(t));
  } catch {
    return [];
  }
}

export function parseJmdictJson(text: string): ParsedOfflineEntry[] {
  const out: ParsedOfflineEntry[] = [];
  for (const line of text.split(/\r?\n/)) for (const row of parseJmdictLine(line)) out.push(row);
  return out;
}

/**
 * Kengdic (Korean–English `kengdic.tsv`): id, surface, hanja, gloss, level, created,
 * source. Rows for the same word are joined into one definition.
 */
export class KengdicCollector {
  private byWord = new Map<string, { surface: string; hanja: string; glosses: string[] }>();

  addLine(line: string): void {
    const cols = line.split('\t');
    if (cols.length < 4 || !/^\d+$/.test(cols[0])) return;
    const surface = cols[1].replace(/\s+/g, ' ').trim();
    const hanja = (cols[2] || '').trim();
    const gloss = (cols[3] || '')
      .replace(/\s+/g, ' ')
      .replace(/^\(\s*(?=[^)]*$)/, '')
      .trim();
    if (!surface || !gloss || surface.length > 80) return;
    const key = `${surface}\u0000${hanja}`;
    const hit = this.byWord.get(key);
    if (hit) {
      if (!hit.glosses.some((g) => g.toLowerCase() === gloss.toLowerCase())) hit.glosses.push(gloss);
    } else {
      this.byWord.set(key, { surface, hanja, glosses: [gloss] });
    }
  }

  entries(): ParsedOfflineEntry[] {
    const out: ParsedOfflineEntry[] = [];
    for (const w of this.byWord.values()) {
      const gloss = w.glosses.join('; ');
      out.push({
        headword: w.surface,
        language: 'ko',
        definition: w.hanja ? `[${w.hanja}] ${gloss}` : gloss,
        extra: w.hanja ? { hanja: w.hanja } : undefined,
      });
    }
    return out;
  }
}

export function parseKengdicTsv(text: string): ParsedOfflineEntry[] {
  const c = new KengdicCollector();
  for (const line of text.split(/\r?\n/)) c.addLine(line);
  return c.entries();
}
