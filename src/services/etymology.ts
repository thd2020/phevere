/**
 * Wiktionary etymology extraction.
 *
 * Wiktionary etymologies are written as typed templates ({{inh}}, {{bor}},
 * {{der}}, {{root}}, ...) rather than free prose. Parsing the templates instead
 * of stripping them gives both readable text and a structured ancestry chain,
 * which is what wiktextract's `etymology_templates` field exposes for the bulk
 * dumps: https://github.com/tatuylonen/wiktextract
 */

export type EtymologyRelation =
  | 'inherited'
  | 'borrowed'
  | 'learned borrowing'
  | 'semi-learned borrowing'
  | 'derived'
  | 'calque'
  | 'root'
  | 'cognate'
  | 'affix'
  | 'doublet'
  | 'clipping'
  | 'back-formation'
  | 'blend'
  | 'mention';

export interface EtymologyLink {
  relation: EtymologyRelation;
  languageCode?: string;
  language?: string;
  term?: string;
  gloss?: string;
  /** For affix/blend style templates, the component parts. */
  parts?: string[];
}

export interface ParsedEtymology {
  text: string;
  chain: EtymologyLink[];
}

/**
 * Language codes that appear in etymology templates. Wiktionary uses several
 * thousand; these cover the ancestors that show up for English and CJK entries.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  // Modern
  en: 'English', fr: 'French', de: 'German', nl: 'Dutch', es: 'Spanish',
  pt: 'Portuguese', it: 'Italian', ro: 'Romanian', ca: 'Catalan', oc: 'Occitan',
  da: 'Danish', sv: 'Swedish', no: 'Norwegian', nb: 'Norwegian Bokmål',
  nn: 'Norwegian Nynorsk', is: 'Icelandic', fi: 'Finnish', et: 'Estonian',
  ru: 'Russian', uk: 'Ukrainian', be: 'Belarusian', pl: 'Polish', cs: 'Czech',
  sk: 'Slovak', sl: 'Slovene', hr: 'Croatian', sr: 'Serbian', bg: 'Bulgarian',
  mk: 'Macedonian', el: 'Greek', tr: 'Turkish', hu: 'Hungarian', lt: 'Lithuanian',
  lv: 'Latvian', ga: 'Irish', gd: 'Scottish Gaelic', cy: 'Welsh', br: 'Breton',
  eu: 'Basque', sq: 'Albanian', hy: 'Armenian', ka: 'Georgian', he: 'Hebrew',
  ar: 'Arabic', fa: 'Persian', ur: 'Urdu', hi: 'Hindi', bn: 'Bengali',
  ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', th: 'Thai', vi: 'Vietnamese',
  id: 'Indonesian', ms: 'Malay', tl: 'Tagalog', sw: 'Swahili', af: 'Afrikaans',
  yi: 'Yiddish', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',

  // Historical stages
  ang: 'Old English', enm: 'Middle English', sco: 'Scots',
  fro: 'Old French', frm: 'Middle French', xno: 'Anglo-Norman', pro: 'Old Occitan',
  la: 'Latin', 'la-cla': 'Classical Latin', 'la-lat': 'Late Latin',
  'la-med': 'Medieval Latin', 'la-新': 'New Latin', 'la-vul': 'Vulgar Latin',
  ML: 'Medieval Latin', LL: 'Late Latin', NL: 'New Latin', VL: 'Vulgar Latin',
  grc: 'Ancient Greek', gkm: 'Byzantine Greek',
  goh: 'Old High German', gmh: 'Middle High German', gml: 'Middle Low German',
  odt: 'Old Dutch', dum: 'Middle Dutch', osx: 'Old Saxon',
  non: 'Old Norse', got: 'Gothic', ofs: 'Old Frisian',
  sa: 'Sanskrit', pi: 'Pali', ae: 'Avestan', peo: 'Old Persian', pal: 'Middle Persian',
  sga: 'Old Irish', mga: 'Middle Irish', owl: 'Old Welsh',
  cu: 'Old Church Slavonic', orv: 'Old East Slavic',
  egy: 'Egyptian', akk: 'Akkadian', sux: 'Sumerian', arc: 'Aramaic', syc: 'Syriac',
  ota: 'Ottoman Turkish', xcl: 'Old Armenian',
  ltc: 'Middle Chinese', och: 'Old Chinese', lzh: 'Literary Chinese',
  ojp: 'Old Japanese', okm: 'Middle Korean',

  // Proto-languages
  'ine-pro': 'Proto-Indo-European',
  'gem-pro': 'Proto-Germanic',
  'gmw-pro': 'Proto-West Germanic',
  'itc-pro': 'Proto-Italic',
  'grk-pro': 'Proto-Hellenic',
  'cel-pro': 'Proto-Celtic',
  'sla-pro': 'Proto-Slavic',
  'bat-pro': 'Proto-Baltic',
  'iir-pro': 'Proto-Indo-Iranian',
  'inc-pro': 'Proto-Indo-Aryan',
  'ira-pro': 'Proto-Iranian',
  'urj-pro': 'Proto-Uralic',
  'trk-pro': 'Proto-Turkic',
  'sem-pro': 'Proto-Semitic',
  'afa-pro': 'Proto-Afroasiatic',
  'sit-pro': 'Proto-Sino-Tibetan',
  'jpx-pro': 'Proto-Japonic',
  'poz-pro': 'Proto-Malayo-Polynesian',
  'map-pro': 'Proto-Austronesian'
};

const RELATION_BY_TEMPLATE: Record<string, EtymologyRelation> = {
  inh: 'inherited', 'inh+': 'inherited', inherited: 'inherited',
  bor: 'borrowed', 'bor+': 'borrowed', borrowed: 'borrowed',
  lbor: 'learned borrowing', 'lbor+': 'learned borrowing',
  slbor: 'semi-learned borrowing',
  der: 'derived', 'der+': 'derived', derived: 'derived', uder: 'derived',
  cal: 'calque', calque: 'calque', clq: 'calque',
  root: 'root',
  cog: 'cognate', cognate: 'cognate', noncog: 'cognate',
  af: 'affix', affix: 'affix', com: 'affix', compound: 'affix',
  suf: 'affix', suffix: 'affix', pre: 'affix', prefix: 'affix',
  con: 'affix', confix: 'affix', surf: 'affix',
  doublet: 'doublet', dbt: 'doublet',
  clipping: 'clipping', clip: 'clipping',
  'back-form': 'back-formation', bf: 'back-formation', 'back-formation': 'back-formation',
  blend: 'blend',
  m: 'mention', mention: 'mention', l: 'mention', link: 'mention'
};

/** Templates whose first parameter is the *target* language, not the source. */
const TARGET_FIRST = new Set<EtymologyRelation>([
  'inherited', 'borrowed', 'learned borrowing', 'semi-learned borrowing',
  'derived', 'calque', 'root', 'doublet', 'affix', 'clipping', 'back-formation', 'blend'
]);

const RELATION_PREFIX: Partial<Record<EtymologyRelation, string>> = {
  inherited: 'inherited from',
  borrowed: 'borrowed from',
  'learned borrowing': 'learned borrowing from',
  'semi-learned borrowing': 'semi-learned borrowing from',
  derived: 'derived from',
  calque: 'calque of',
  root: 'from the root',
  cognate: 'cognate with',
  doublet: 'doublet of',
  clipping: 'clipping of',
  'back-formation': 'back-formation from',
  blend: 'blend of'
};

export function languageName(code?: string): string | undefined {
  if (!code) return undefined;
  const known = LANGUAGE_NAMES[code];
  if (known) return known;
  // Unknown proto-language codes still render better than the bare code.
  if (code.endsWith('-pro')) {
    return `Proto-${code.slice(0, -4).toUpperCase()}`;
  }
  return code;
}

interface RawTemplate {
  name: string;
  positional: string[];
  named: Record<string, string>;
  source: string;
}

/** Splits on `|` only at brace/bracket depth zero. */
function splitParams(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const next = body[i + 1];

    if ((ch === '{' && next === '{') || (ch === '[' && next === '[')) {
      depth++;
      current += ch + next;
      i++;
      continue;
    }
    if ((ch === '}' && next === '}') || (ch === ']' && next === ']')) {
      depth--;
      current += ch + next;
      i++;
      continue;
    }
    if (ch === '|' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Extracts top-level `{{...}}` templates, tracking nesting. */
export function scanTemplates(wikitext: string): RawTemplate[] {
  const templates: RawTemplate[] = [];

  for (let i = 0; i < wikitext.length - 1; i++) {
    if (wikitext[i] !== '{' || wikitext[i + 1] !== '{') continue;

    let depth = 1;
    let j = i + 2;
    while (j < wikitext.length - 1 && depth > 0) {
      if (wikitext[j] === '{' && wikitext[j + 1] === '{') {
        depth++;
        j += 2;
      } else if (wikitext[j] === '}' && wikitext[j + 1] === '}') {
        depth--;
        j += 2;
      } else {
        j++;
      }
    }
    if (depth !== 0) break;

    const source = wikitext.slice(i, j);
    const body = wikitext.slice(i + 2, j - 2);
    const params = splitParams(body);
    const name = (params.shift() || '').trim().toLowerCase();

    const positional: string[] = [];
    const named: Record<string, string> = {};
    for (const param of params) {
      const eq = param.indexOf('=');
      // A `=` inside a link is not a named parameter.
      if (eq > 0 && !/[[{]/.test(param.slice(0, eq))) {
        named[param.slice(0, eq).trim()] = param.slice(eq + 1).trim();
      } else {
        positional.push(param.trim());
      }
    }

    templates.push({ name, positional, named, source });
    i = j - 1;
  }

  return templates;
}

function glossOf(t: RawTemplate, fallbackIndex: number): string | undefined {
  return t.named.t || t.named.gloss || t.positional[fallbackIndex] || undefined;
}

export function templateToLink(t: RawTemplate): EtymologyLink | null {
  const relation = RELATION_BY_TEMPLATE[t.name];
  if (!relation) return null;

  if (relation === 'affix' || relation === 'blend') {
    const parts = t.positional.slice(1).filter(Boolean);
    if (parts.length === 0) return null;
    return { relation, languageCode: t.positional[0], language: languageName(t.positional[0]), parts };
  }

  const usesTargetFirst = TARGET_FIRST.has(relation);
  const languageCode = usesTargetFirst ? t.positional[1] : t.positional[0];
  const term = usesTargetFirst ? t.positional[2] : t.positional[1];
  const gloss = glossOf(t, usesTargetFirst ? 4 : 3);

  if (!languageCode && !term) return null;

  return {
    relation,
    languageCode,
    language: languageName(languageCode),
    term: term && term !== '-' ? term : undefined,
    gloss: gloss || undefined
  };
}

function renderLink(link: EtymologyLink, withPrefix: boolean): string {
  if (link.relation === 'affix' || link.relation === 'blend') {
    const joined = (link.parts || []).join(link.relation === 'blend' ? ' + ' : ' + ');
    return withPrefix && link.relation === 'blend' ? `blend of ${joined}` : joined;
  }

  const pieces: string[] = [];
  if (withPrefix) {
    const prefix = RELATION_PREFIX[link.relation];
    if (prefix) pieces.push(prefix);
  }
  if (link.language) pieces.push(link.language);
  if (link.term) pieces.push(link.term);

  let rendered = pieces.join(' ').trim();
  if (link.gloss) rendered += ` (“${link.gloss}”)`;
  return rendered;
}

/**
 * Isolates the English entry, then every Etymology section beneath it
 * (including numbered "Etymology 1" / "Etymology 2" variants).
 */
export function extractEnglishEtymologySections(wikitext: string): string[] {
  if (!wikitext) return [];

  let scope = wikitext;
  const englishStart = wikitext.search(/^==\s*English\s*==\s*$/m);
  if (englishStart !== -1) {
    const rest = wikitext.slice(englishStart + 1);
    const nextLanguage = rest.search(/^==\s*[^=\n]+\s*==\s*$/m);
    scope = nextLanguage === -1 ? wikitext.slice(englishStart) : wikitext.slice(englishStart, englishStart + 1 + nextLanguage);
  }

  const sections: string[] = [];
  const heading = /^(={3,})\s*Etymology(?:\s+\d+)?\s*\1\s*$/gim;
  let match: RegExpExecArray | null;

  while ((match = heading.exec(scope)) !== null) {
    const bodyStart = match.index + match[0].length;
    const rest = scope.slice(bodyStart);
    // Stop at the next heading of the same level or higher.
    const nextHeading = rest.search(/^={2,}\s*[^=\n]+\s*={2,}\s*$/m);
    const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
    const cleaned = body.trim();
    if (cleaned) sections.push(cleaned);
  }

  return sections;
}

/**
 * Templates that render their own connective wording ("Doublet of x"), as
 * opposed to ones the surrounding prose introduces ("From {{inh|...}}").
 */
const SELF_PREFIXED_TEMPLATES = new Set([
  'doublet', 'dbt', 'clipping', 'clip', 'back-form', 'bf', 'back-formation',
  'blend', 'cal', 'calque', 'clq', 'lbor', 'slbor',
  'bor+', 'inh+', 'der+', 'lbor+'
]);

/** `{{root}}` is a categorization template and renders nothing on the page. */
const INVISIBLE_TEMPLATES = new Set(['root']);

/** Replaces templates and wiki markup with readable inline text. */
function renderSectionText(section: string): string {
  let out = section;

  for (const t of scanTemplates(section)) {
    const link = templateToLink(t);
    let replacement = '';
    if (link && !INVISIBLE_TEMPLATES.has(t.name)) {
      replacement = renderLink(link, SELF_PREFIXED_TEMPLATES.has(t.name));
    }
    out = out.split(t.source).join(replacement);
  }

  return out
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''([^']*)'''/g, '$1')
    .replace(/''([^']*)''/g, '$1')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([,.;:)])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([;,.])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    // Templates expand to lowercase wording, so re-capitalize sentence starts.
    .replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m, lead: string, ch: string) => lead + ch.toLocaleUpperCase());
}

/** The subset of relations that form an ancestry line worth drawing. */
const CHAIN_RELATIONS = new Set<EtymologyRelation>([
  'inherited', 'borrowed', 'learned borrowing', 'semi-learned borrowing',
  'derived', 'calque', 'root'
]);

export function buildEtymology(wikitext: string): ParsedEtymology | undefined {
  const sections = extractEnglishEtymologySections(wikitext);
  if (sections.length === 0) return undefined;

  const chain: EtymologyLink[] = [];
  const rendered: string[] = [];

  sections.forEach((section, index) => {
    // Numbered Etymology sections describe unrelated origins of homographs;
    // splicing them into one ancestry line would invent a false derivation.
    if (index === 0) {
      for (const t of scanTemplates(section)) {
        const link = templateToLink(t);
        if (link && CHAIN_RELATIONS.has(link.relation) && (link.term || link.language)) {
          chain.push(link);
        }
      }
    }

    const text = renderSectionText(section);
    if (!text) return;
    rendered.push(sections.length > 1 ? `Etymology ${index + 1}: ${text}` : text);
  });

  const body = rendered.join('\n\n').trim();
  if (!body && chain.length === 0) return undefined;

  const parts: string[] = [];
  if (chain.length > 0) {
    const line = chain
      .map(link => renderLink(link, false))
      .filter(Boolean)
      .join(' ← ');
    if (line) parts.push(`English ← ${line}`);
  }
  if (body) parts.push(body);

  return { text: parts.join('\n\n'), chain };
}
