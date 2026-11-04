/**
 * Reading Wiktionary wikitext for the word part pages: one line as plain text, a section's
 * body, the terms a section links, and a part of speech's senses with their examples.
 */
import { languageName, scanTemplates } from './etymology';

type RawTemplate = ReturnType<typeof scanTemplates>[number];

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export const LINK_TEMPLATES = new Set(['l', 'm', 'll', 'l-self', 'm-self', 'mention', 'link', 'alter', 'alt', 'll-lite']);

function templateText(t: RawTemplate): string {
  const p = t.positional;
  switch (t.name) {
    case 'lb':
    case 'lbl':
    case 'label': {
      const labels = p.slice(1).filter((x) => x && x !== '_' && x !== 'and' && x !== 'or');
      return labels.length ? `(${labels.join(', ')})` : '';
    }
    case 'n-g':
    case 'ng':
    case 'non-gloss':
    case 'non-gloss definition':
      return wikiInline(p[0] || '');
    case 'gloss':
    case 'gl':
      return p[0] ? `(${wikiInline(p[0])})` : '';
    case 'q':
    case 'qual':
    case 'qualifier':
    case 'i':
    case 'sense':
    case 's':
      return p.length ? `(${p.map(wikiInline).join(', ')})` : '';
    case 'w':
      return wikiInline(t.named.alt || p[1] || p[0] || '');
    case 'ux':
    case 'uxi':
    case 'usex':
    case 'eg':
      return wikiInline(p[1] || '') + (t.named.t ? ` (${wikiInline(t.named.t)})` : '');
    case 'suffixusex':
    case 'prefixusex':
    case 'affixusex':
    case 'afex':
      return p.slice(1).filter(Boolean).slice(-2).join(' → ');
    case 'inh':
    case 'inh+':
    case 'der':
    case 'der+':
    case 'bor':
    case 'bor+':
    case 'cog':
    case 'noncog': {
      // {{inh|la|itc-pro|*fakjō}} reads "Proto-Italic *fakjō"; {{cog|grc|σκέπτομαι}} names its language first.
      const cog = t.name === 'cog' || t.name === 'noncog';
      const code = cog ? p[0] : p[1];
      const term = wikiInline(t.named.alt || (cog ? p[1] : p[2]) || '');
      const lead = t.name === 'inh+' ? 'Inherited from ' : t.name === 'der+' ? 'Derived from ' : t.name === 'bor+' ? 'Borrowed from ' : '';
      return `${lead}${[languageName(code) || '', term].filter(Boolean).join(' ')}`;
    }
    default:
      if (LINK_TEMPLATES.has(t.name)) return wikiInline(t.named.alt || p[2] || p[1] || '');
      if (/ of$/.test(t.name) && p[1]) return `${capitalize(t.name)} ${p[1]}`;
      return '';
  }
}

/** One line of wikitext as reading text: templates rendered, links and markup dropped. */
export function wikiInline(s: string): string {
  let out = String(s || '');
  for (const t of scanTemplates(out)) out = out.split(t.source).join(templateText(t));
  return out
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?(?:<\/ref>|$)/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#45;/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s*\)/g, '')
    // A root written with its hyphen ends the sentence as "*dʰeh₁-.": no second full stop.
    .replace(/\.{2,}/g, '.')
    .trim();
}

/** The body under a heading (any level), up to the next heading of the same or higher level. */
export function sectionBody(text: string, name: string): string {
  const re = new RegExp(`^(={3,6})\\s*${name}\\s*\\1\\s*$`, 'im');
  const m = re.exec(text);
  if (!m) return '';
  const level = m[1].length;
  const rest = text.slice(m.index + m[0].length);
  const next = new RegExp(`^={2,${level}}[^=\\n][^\\n]*$`, 'm').exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/**
 * Terms linked in a section ({{l|en|-ion}}, {{alter|la|obs-|op-}}, [[-ize]]), in order. With
 * `firstPerLine`, only the bullet's own term counts, not the "(as in {{m|en|complexion}})" after it.
 */
export function sectionTerms(body: string, lang: string, firstPerLine = false): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    const term = wikiInline(w).replace(/#.*$/, '').trim();
    if (term && !out.includes(term) && !/[|=:]/.test(term)) out.push(term);
  };
  for (const line of firstPerLine ? body.split('\n') : [body]) {
    for (const t of scanTemplates(line)) {
      if (!LINK_TEMPLATES.has(t.name) || t.positional[0] !== lang) continue;
      if (t.name === 'alter' || t.name === 'alt') {
        for (const x of t.positional.slice(1)) {
          if (!x) break;
          add(x);
        }
      } else if (t.positional[1]) {
        add(t.positional[1]);
      }
      if (firstPerLine) break;
    }
  }
  for (const m of body.replace(/\{\{[\s\S]*?\}\}/g, '').matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) add(m[1]);
  return out;
}

export interface WikiSense {
  text: string;
  examples: string[];
}

/**
 * Senses under every heading named one of `pos`, with their "#:" examples. Sub-senses ("##")
 * count as senses; a sense that only introduces them ("Indicating a common origin:") is
 * folded into each of them, so none ends in a bare colon.
 */
export function sensesUnder(text: string, pos: string[]): WikiSense[] {
  const re = new RegExp(`^(={3,6})\\s*(?:${pos.join('|')})(?:\\s+\\d+)?\\s*\\1\\s*$`, 'gim');
  const out: WikiSense[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length);
    const next = /^=+[^=\n][^\n]*$/m.exec(rest);
    const body = next ? rest.slice(0, next.index) : rest;
    let parent: WikiSense | null = null;
    let parentUsed = false;
    for (const line of body.split('\n')) {
      const depth = (line.match(/^#+/) || [''])[0].length;
      const marker = line.slice(depth, depth + 1);
      if (depth === 1 && !/[:*]/.test(marker)) {
        const sense = wikiInline(line.slice(1));
        if (!sense) continue;
        parent = { text: sense, examples: [] };
        parentUsed = false;
        out.push(parent);
      } else if (depth === 2 && !/[:*]/.test(marker) && parent) {
        const sub = wikiInline(line.slice(2));
        if (!sub) continue;
        if (/:\s*$/.test(parent.text)) {
          // The introducing line stands in front of each of its sub-senses.
          if (!parentUsed) out.splice(out.indexOf(parent), 1);
          parentUsed = true;
          out.push({ text: `${parent.text.replace(/:\s*$/, '')}: ${sub}`, examples: [] });
        } else {
          out.push({ text: sub, examples: [] });
        }
      } else if (/^#{1,2}:/.test(line) && out.length) {
        const ex = wikiInline(line.replace(/^#{1,2}:\s*/, ''));
        if (ex && ex.length < 200) out[out.length - 1].examples.push(ex);
      }
    }
  }
  return out;
}
