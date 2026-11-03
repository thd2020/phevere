/**
 * Split text for speech so a long paragraph can play while the rest is synthesized.
 *
 * The first chunk is one short sentence, so audio starts quickly. Later chunks join
 * sentences up to a size the neural voice handles in one pass (Kokoro reads at most
 * about 500 phonemes), growing gradually when `growth` is set. A sentence longer than
 * the limit is cut at a clause mark, then at a space.
 */

export interface SpeechChunkOptions {
  /** Longest first chunk, in characters. */
  firstMax?: number;
  /** Longest later chunk, in characters. */
  max?: number;
  /**
   * When set, each later chunk is at most this many times longer than the one before
   * (never under 40 characters), up to `max`. A chunk then synthesizes in about the time
   * the previous one plays, instead of a short first sentence being followed by a long
   * wait for a full-size second chunk.
   */
  growth?: number;
}

const CLAUSE = /[,;:，；：、—–]\s*/g;

function sentences(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) {
    const out: string[] = [];
    for (const s of new Seg(undefined, { granularity: 'sentence' }).segment(text)) {
      const t = s.segment.trim();
      if (t) out.push(t);
    }
    return out;
  }
  return (text.match(/[^.!?。！？…]+(?:[.!?。！？…]+["'”’)\]]*|$)/g) || [text]).map((s) => s.trim()).filter(Boolean);
}

/** Cut one over-long sentence into pieces no longer than `max`. */
function cut(sentence: string, max: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    let at = -1;
    CLAUSE.lastIndex = 0;
    for (let m = CLAUSE.exec(head); m; m = CLAUSE.exec(head)) {
      if (m.index + m[0].length <= max && m.index >= max / 3) at = m.index + m[0].length;
    }
    if (at < 0) {
      const sp = head.lastIndexOf(' ');
      at = sp > max / 3 ? sp + 1 : max;
    }
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function splitSpeechText(text: string, opts: SpeechChunkOptions = {}): string[] {
  const firstMax = opts.firstMax ?? 160;
  const max = opts.max ?? 300;
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts: string[] = [];
  for (const s of sentences(clean)) parts.push(...cut(s, max));
  if (!parts.length) return [];

  const chunks: string[] = [];
  const first = parts.shift() as string;
  if (first.length > firstMax) {
    const [head] = cut(first, firstMax);
    chunks.push(head);
    parts.unshift(first.slice(head.length).trim());
  } else {
    chunks.push(first);
  }
  const growth = opts.growth;
  const limitAfter = (prev: string) => (growth ? Math.min(max, Math.max(40, Math.round(prev.length * growth))) : max);
  // Chinese and Japanese sentences join without a space.
  const join = (a: string, b: string) => (/[　-ヿ㐀-鿿＀-￯]$/.test(a) ? a + b : `${a} ${b}`);
  let lim = limitAfter(chunks[0]);
  let cur = '';
  const push = (chunk: string) => {
    chunks.push(chunk);
    lim = limitAfter(chunk);
    cur = '';
  };
  while (parts.length) {
    const p = parts.shift() as string;
    if (!p) continue;
    if (!cur || cur.length + 1 + p.length <= lim) {
      if (cur || p.length <= lim) {
        cur = cur ? join(cur, p) : p;
        continue;
      }
      const [head] = cut(p, lim);
      push(head);
      parts.unshift(p.slice(head.length).trim());
      continue;
    }
    // With a growing limit, a short leftover is topped up from the next sentence rather
    // than spoken alone, which would leave too little time to synthesize the chunk after it.
    const room = lim - cur.length - 1;
    if (growth && room >= 40) {
      const [head] = cut(p, room);
      push(join(cur, head));
      parts.unshift(p.slice(head.length).trim());
    } else {
      push(cur);
      parts.unshift(p);
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
