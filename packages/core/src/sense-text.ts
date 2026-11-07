/**
 * One style for English senses from several dictionaries. Free Dictionary and Wiktionary write a
 * sense as a sentence ("Weakened or worn out from age or wear."), WordNet as a lowercase phrase
 * with no stop ("a giant supernatural being"), and Wiktionary sometimes drops the stop. A lookup
 * that shows them together reads as if half were typed in a hurry, so every English sense gets a
 * capital and a closing stop, and no space before its punctuation. Chinese and Japanese glosses
 * take no added stop; they only lose the space after full-width punctuation ("老态龙钟的； 破旧").
 */

/** Wiktionary's TemplateStyles rule, left as text when its <style> tag was stripped as a tag. */
const CSS_JUNK = /\.mw-parser-output[^{}]*\{[^}]*\}/g;
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
/** A sense that already ends as a sentence, or introduces sub-senses ("A room, particularly:"). */
const ENDS = /[.!?…:;]$/;
const CLOSERS = /[)\]"'”’»]+$/;

function englishLike(text: string): boolean {
  return /[A-Za-z]/.test(text) && !CJK.test(text);
}

/** Spaces a stripped tag left before punctuation, and after full-width punctuation. */
function tidySpacing(text: string): string {
  return text
    .replace(/([.!?])\s+\.(?=\s|$)/g, '$1')
    .replace(/\s+([,.;:!?)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/([，。；：、！？）」』])\s+/g, '$1');
}

/** Index of the first letter outside leading brackets ("(law) an …" gives the "a"), or -1. */
function firstLetterAt(text: string, depthIn = 0): { at: number; depth: number } {
  let depth = depthIn;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\p{L}/u.test(c)) return { at: i, depth };
  }
  return { at: -1, depth };
}

/** Upper-cases `text[at]` unless its word is written in mixed case on purpose (iPhone, pH, eBay). */
function capitalAt(text: string, at: number): string {
  const word = /^[\p{L}'’-]+/u.exec(text.slice(at))?.[0] || '';
  if (!word || word[0] !== word[0].toLowerCase() || /\p{Lu}/u.test(word.slice(1))) return text;
  return text.slice(0, at) + word[0].toUpperCase() + text.slice(at + 1);
}

function needsStop(text: string): boolean {
  const core = text.trim().replace(CLOSERS, '');
  return !!core && !ENDS.test(core);
}

/** A plain-text sense in the shared style. */
export function tidySenseText(raw: string): string {
  let s = tidySpacing(String(raw || '').replace(CSS_JUNK, ' ').replace(/\s+/g, ' ').trim());
  if (!englishLike(s)) return s;
  const first = firstLetterAt(s);
  if (first.at >= 0) s = capitalAt(s, first.at);
  return needsStop(s) ? `${s}.` : s;
}

/**
 * A sense as the lookup's HTML carries it (links on words, usage-label spans), in the shared
 * style. Only the text between tags changes; the stop goes after any tags that close the last
 * word, so a linked last word does not take the stop into its link.
 */
export function tidySenseHtml(raw: string): string {
  const html = String(raw || '')
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(CSS_JUNK, '');
  if (!/[<>]/.test(html)) return tidySenseText(html);
  const parts = html.split(/(<[^>]*>)/);
  for (let i = 0; i < parts.length; i += 2) parts[i] = tidySpacing(parts[i]);
  const text = parts.filter((_, i) => i % 2 === 0).join('');
  if (!englishLike(text)) return parts.join('').trim();
  let depth = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const found = firstLetterAt(parts[i], depth);
    if (found.at >= 0) {
      parts[i] = capitalAt(parts[i], found.at);
      break;
    }
    depth = found.depth;
  }
  if (needsStop(text.replace(/&[a-z#0-9]+;/gi, ' '))) {
    let last = -1;
    for (let i = parts.length - 1; i >= 0; i -= 2) {
      if (i % 2 === 0 && parts[i].trim()) {
        last = i;
        break;
      }
    }
    if (last >= 0) {
      parts[last] = parts[last].replace(/\s+$/, '');
      let j = last + 1;
      while (j < parts.length && (/^<\//.test(parts[j]) || (j % 2 === 0 && !parts[j].trim()))) j += 1;
      // The text just before the first tag that does not close the last word: the last word itself,
      // or the empty text after its closing tags.
      const at = j % 2 === 0 ? j : j - 1;
      parts[Math.min(at, parts.length - 1)] += '.';
    }
  }
  return parts.join('').trim();
}
