/**
 * Word parts written in a lookup's text are links to their own page: "ob-" and "-ant" in an
 * etymology, "*bʰeh₂-", "-fic-". Ordinary words stay text; the sources' own links (Wiktionary's)
 * and the lookup's dedicated rows (Built from, Forms, word family) are the way to other words.
 *
 * The links are spans with role="link", not anchors: dragging across an anchor drags the
 * link in Chromium instead of selecting text, and selecting a phrase in a definition to look
 * it up has to keep working. Each shell turns a click, Enter or Space on one into a lookup.
 *
 * Word parts keep their marks: "ob-" and "-ant" in an etymology, and "*bʰeh₂-", link to
 * the part's page, not to "ob" or "ant". Language names ("Middle English") link as one name.
 */
import { LANGUAGE_NAMES } from './etymology';
import type { LexiconLinks } from './lexicon-parts';
import { stripSisterProjects } from './lookup-policy';

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

/**
 * A link to a lookup: `data-act="lookup"` for the phone's tap handler, `data-lookup` for the
 * pop-up's. Both are focusable spans that read as links to a screen reader.
 */
export function wordLinkHtml(query: string, innerHtml: string, links: LexiconLinks, cls = 'lx-w'): string {
  const q = esc(query);
  const target = links === 'act' ? `data-act="lookup" data-q="${q}"` : `data-lookup="${q}"`;
  return `<span class="${cls}" role="link" tabindex="0" ${target}>${innerHtml}</span>`;
}

/**
 * Runs of letters, with the marks a word part or a reconstruction carries. Chinese, Japanese
 * and Korean text has no spaces between words, so it is not split here and stays text.
 */
const RUN = /\*?(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{M}ʰ-˿₀-₉'’-])+/gu;
const OPENS = /[\s(\[“"‘'/—–]/;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Language names of more than one word, longest first, as one alternation. */
const NAMES = (() => {
  const extra = ['Middle English', 'Old English', 'Old French', 'Middle French', 'Anglo-Norman', 'Ancient Greek', 'Late Latin', 'Medieval Latin', 'New Latin', 'Vulgar Latin', 'Old Norse', 'Old High German', 'Middle Dutch', 'Old Irish', 'Old Church Slavonic', 'Classical Latin', 'Ecclesiastical Latin'];
  const names = [...new Set([...Object.values(LANGUAGE_NAMES), ...extra])].filter((n) => / /.test(n) && /^[A-Z][\p{L} -]+$/u.test(n));
  names.sort((a, b) => b.length - a.length);
  return names.length ? new RegExp(`\\b(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g') : null;
})();

/** Contractions whose base is not worth a lookup on its own: "he's" is looked up whole. */
const SHORT_BASE = /^(?:he|she|it|that|what|there|here|who|where|let|how|when)$/i;

interface Token {
  start: number;
  end: number;
  query: string;
}

/** The links in one stretch of plain text, as character ranges. */
export function wordTokens(text: string): Token[] {
  const out: Token[] = [];
  const names: Array<{ start: number; end: number }> = [];
  if (NAMES) {
    for (const m of text.matchAll(NAMES)) {
      names.push({ start: m.index!, end: m.index! + m[0].length });
      out.push({ start: m.index!, end: m.index! + m[0].length, query: m[0] });
    }
  }
  const inName = (i: number) => names.some((n) => i >= n.start && i < n.end);
  for (const m of text.matchAll(RUN)) {
    let start = m.index!;
    if (inName(start)) continue;
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
    // Closing quotes and apostrophes belong to the sentence.
    word = word.replace(/['’]+$/, '').replace(/--+$/, '');
    // A trailing hyphen marks a prefix only before a space or punctuation: "pre- and post-war",
    // not "mid-15c.", where the hyphen joins a number.
    const after = text[start + word.length] || ' ';
    const joined = /\p{N}/u.test(after) || (/\p{L}/u.test(after) && !CJK.test(after));
    if (word.endsWith('-') && !word.startsWith('*') && (joined ||!/\p{L}[\p{M}ʰ-˿₀-₉]*-$/u.test(word))) {
      word = word.replace(/-+$/, '');
    }
    // One letter is never a link, with or without its marks ("a", "I", the "-i-" of a Youdao note).
    const letters = (word.match(/\p{L}/gu) || []).length;
    if (letters < 2) continue;
    const base = word.replace(/['’]s$/, '');
    const query = base !== word && SHORT_BASE.test(base) ? word.replace(/’/g, "'") : base;
    out.push({ start, end: start + word.length, query });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** "ob-", "-ant", "-fic-", "*bʰeh₂-": a query that names a word part, not a word. */
function isPartQuery(q: string): boolean {
  return /^\*/.test(q) || /^-\p{L}/u.test(q) || /\p{L}[\p{M}ʰ-˿₀-₉]*-$/u.test(q);
}

/** Plain text as HTML, with the word parts in it made links. */
export function linkText(text: string, links: LexiconLinks): string {
  const s = String(text || '');
  let out = '';
  let at = 0;
  for (const t of wordTokens(s)) {
    if (!isPartQuery(t.query)) continue;
    out += esc(s.slice(at, t.start));
    out += wordLinkHtml(t.query, esc(s.slice(t.start, t.end)), links);
    at = t.end;
  }
  return out + esc(s.slice(at));
}

const SKIP_TAGS = new Set(['a', 'button', 'script', 'style', 'code', 'svg', 'textarea', 'select', 'option']);

/**
 * Escaped HTML with the word parts in its text made links. Text already inside a link, a button
 * or a lookup span keeps that link; attributes are never touched.
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
        // A word in a class marked lx-nolink (sense labels), or already a lookup, stays as it is.
        const nolink = /class\s*=\s*["'][^"']*\blx-nolink\b/.test(part) || /\b(?:data-lookup|data-act|role\s*=\s*["']link)/.test(part);
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
 * A Wiktionary definition as shown in a Lexicon: Wiktionary links almost every word of a gloss,
 * but a dictionary page links only the word a definition points to. A link stays only inside the
 * span Wiktionary marks as a form-of target ("Abbreviation of *et cetera*", "plural of *mouse*");
 * every other link keeps its text and loses the link. Spaces just inside brackets and quotes and
 * before punctuation, left where Wiktionary's markup was, are removed.
 */
export function pruneGlossLinks(html: string): string {
  // Wiktionary's form-of span also holds the target's own gloss ("et cetera (“and so on; used
  // to note …”)"); only the target, outside that gloss, keeps its link.
  const stack: Array<{ name: string; target: boolean; gloss: boolean }> = [];
  const openAnchors: boolean[] = [];
  const out = stripSisterProjects(String(html || ''))
    .split(/(<[^>]+>)/g)
    .map((part) => {
      const tag = /^<\s*(\/)?\s*([a-z0-9]+)([^>]*?)(\/)?\s*>$/i.exec(part);
      if (!tag) return part;
      const closing = !!tag[1];
      const name = tag[2].toLowerCase();
      const inTarget = stack.some((t) => t.target) && !stack.some((t) => t.gloss);
      if (name === 'a') {
        if (closing) return openAnchors.pop() ? part : '';
        openAnchors.push(inTarget);
        return inTarget ? part : '';
      }
      if (closing) {
        let at = stack.length - 1;
        while (at >= 0 && stack[at].name !== name) at -= 1;
        if (at >= 0) stack.splice(at);
      } else if (!tag[4] && !/^(br|img|hr|wbr|input|meta|link)$/.test(name)) {
        stack.push({
          name,
          target: /\bclass\s*=\s*["'][^"']*\bform-of-definition-link\b/i.test(tag[3]),
          gloss: /\bclass\s*=\s*["'][^"']*\bmention-gloss\b/i.test(tag[3]),
        });
      }
      return part;
    })
    .join('');
  return tidyGlossSpacing(out);
}

/** Removes spaces just inside brackets and quotes and before punctuation; tags in between are kept. */
export function tidyGlossSpacing(html: string): string {
  return String(html || '')
    .replace(/([(\[“‘])((?:<[^>]+>)*)\s+/g, '$1$2')
    .replace(/\s+((?:<\/[^>]+>)*)([)\]”’,.;:!?])/g, '$1$2');
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
