/** Pure parsers for official/open dictionary dumps (no Node/Electron APIs). */

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
    const pos = WN_POS[meta[2]] || meta[2] || 'definition';
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
    const pos = posRaw ? stripMarkup(posRaw).replace(/\.$/, '') : 'definition';
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

/**
 * FreeDict TEI: English `<orth>` + Chinese `<cit type="trans"><quote>`.
 */
export function parseFreedictTei(content: string, language = 'en'): ParsedOfflineEntry[] {
  const out: ParsedOfflineEntry[] = [];
  const seen = new Set<string>();
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let em: RegExpExecArray | null;
  while ((em = entryRe.exec(content))) {
    const body = em[1];
    const orths: string[] = [];
    const orthRe = /<orth\b[^>]*>([\s\S]*?)<\/orth>/gi;
    let om: RegExpExecArray | null;
    while ((om = orthRe.exec(body))) {
      const h = stripMarkup(om[1]);
      if (h && h.length <= 80) orths.push(h);
    }
    if (!orths.length) continue;
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
    if (!glosses.length) continue;
    const definition = Array.from(new Set(glosses)).join('; ');
    const posRaw = (body.match(/<pos\b[^>]*>([\s\S]*?)<\/pos>/i) || [])[1];
    const pos = posRaw ? stripMarkup(posRaw) : 'translation';
    for (const headword of Array.from(new Set(orths))) {
      const key = `${headword.toLowerCase()}|${definition}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ headword, language, pos, definition });
    }
  }
  return out;
}
