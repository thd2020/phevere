/**
 * Every word of a lookup's text is a link to its own lookup: definitions, examples,
 * etymology prose, synonyms. As in Apple's Dictionary and in Wiktionary's running text the
 * words stay plain until pointed at, so a sense does not read as a row of underlines.
 *
 * Word parts keep their marks: "ob-" and "-ant" in an etymology, and "*bʰeh₂-", link to
 * the part's page, not to "ob" or "ant".
 */
import type { LexiconLinks } from './lexicon-parts';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** A link to a lookup, in the shell's own form: a pop-up anchor or a phone tap target. */
export function wordLinkHtml(query: string, innerHtml: string, links: LexiconLinks, cls = 'lx-w'): string {
  const q = esc(query);
  return links === 'act'
    ? `<span class="${cls}" data-act="lookup" data-q="${q}">${innerHtml}</span>`
    : `<a href="#" class="${cls}" data-lookup="${q}">${innerHtml}</a>`;
}

/**
 * Runs of letters, with the marks a word part or a reconstruction carries. Chinese, Japanese
 * and Korean text has no spaces between words, so it is not split here and stays text.
 */
const RUN = /\*?(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{M}ʰ-˿₀-₉'’-])+/gu;
const OPENS = /[\s(\[“"‘'/—–]/;

interface Token {
  start: number;
  end: number;
  query: string;
}

/** The links in one stretch of plain text, as character ranges. */
export function wordTokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(RUN)) {
    let start = m.index!;
    let word = m[0];
    const before = start > 0 ? text[start - 1] : ' ';
    if (!word.startsWith('*')) {
      // A leading hyphen marks a suffix only where a word could start ("-ant", "(-tion)").
      const lead = /^['’-]+/.exec(word)?.[0] || '';
      const keepHyphen = lead === '-' && OPENS.test(before) && /^-\p{L}/u.test(word);
      const drop = keepHyphen ? 0 : lead.length;
      start += drop;
      word = word.slice(drop);
    }
    // Closing quotes and apostrophes belong to the sentence; a trailing hyphen stays on a prefix.
    word = word.replace(/['’]+$/, '').replace(/--+$/, '');
    if (word.endsWith('-') && !/\p{L}[\p{M}ʰ-˿₀-₉]*-$/u.test(word) && !word.startsWith('*')) {
      word = word.replace(/-+$/, '');
    }
    const letters = (word.match(/\p{L}/gu) || []).length;
    if (letters < 2 && !/^[*-]|-$/.test(word)) continue;
    if (letters < 1) continue;
    const query = word.replace(/['’]s$/, '');
    out.push({ start, end: start + word.length, query });
  }
  return out;
}

/** Plain text as HTML, each word a link. */
export function linkText(text: string, links: LexiconLinks): string {
  const s = String(text || '');
  let out = '';
  let at = 0;
  for (const t of wordTokens(s)) {
    out += esc(s.slice(at, t.start));
    out += wordLinkHtml(t.query, esc(s.slice(t.start, t.end)), links);
    at = t.end;
  }
  return out + esc(s.slice(at));
}

const SKIP_TAGS = new Set(['a', 'button', 'script', 'style', 'code', 'svg', 'textarea', 'select', 'option']);

/**
 * Escaped HTML with the words of its text made links. Text already inside a link or a
 * button keeps that link; attributes are never touched.
 */
export function linkHtml(html: string, links: LexiconLinks): string {
  const parts = String(html || '').split(/(<[^>]*>)/);
  const stack: Array<{ name: string; skip: boolean }> = [];
  let skipping = 0;
  return parts
    .map((part) => {
      if (!part) return part;
      if (part.startsWith('<')) {
        const m = /^<\s*(\/?)\s*([a-z0-9-]+)/i.exec(part);
        if (!m) return part;
        const name = m[2].toLowerCase();
        const closing = !!m[1];
        const selfClosing = /\/\s*>$/.test(part) || /^(br|img|hr|input|wbr|source|meta|link)$/.test(name);
        // A word in a class marked lx-nolink (headwords, codes) stays text.
        const nolink = /class\s*=\s*["'][^"']*\blx-nolink\b/.test(part);
        if (closing) {
          let at = stack.length - 1;
          while (at >= 0 && stack[at].name !== name) at -= 1;
          if (at >= 0) {
            for (const tag of stack.splice(at)) if (tag.skip) skipping -= 1;
          }
        } else if (!selfClosing) {
          const skip = SKIP_TAGS.has(name) || nolink;
          stack.push({ name, skip });
          if (skip) skipping += 1;
        }
        return part;
      }
      return skipping > 0 ? part : linkText(decode(part), links);
    })
    .join('');
}

/**
 * The lookup a Wiktionary link names: "Reconstruction:Proto-Indo-European/bʰeh₂-" is the
 * root *bʰeh₂-; other namespaces (File:, Category:, Appendix:) are not lookups.
 */
export function wikiLinkLookup(title: string): string {
  const t = String(title || '').replace(/#.*$/, '').trim();
  const recon = /^Reconstruction:Proto-Indo-European\/(.+)$/i.exec(t);
  if (recon) return `*${recon[1]}`;
  if (/^(File|Category|Special|Wiktionary|Template|Appendix|Help|Module|User|Talk|Reconstruction|Thesaurus|Rhymes|Citations|Wikipedia|w):/i.test(t)) return '';
  return t;
}
