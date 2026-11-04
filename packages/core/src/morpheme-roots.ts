/**
 * The Latin or Greek word behind each classical root of the morpheme tables, and the reading
 * of its Wiktionary entry: fac is facere ("faciō, facere, fēcī, factum"), graph is γράφω.
 * A root page shows that word with its principal parts, its senses and the PIE root it
 * continues, as Merriam-Webster's and Wiktionary's root notes do.
 *
 * Titles are Wiktionary page titles: Latin without macrons ("facio"), Greek as written.
 */
import { extractLanguageSection, scanTemplates } from './etymology';
import { wikiInline } from './morpheme-wiki';

export const ROOT_LEMMA: Record<string, string> = {
  ag: 'ago', am: 'amo', anim: 'animus', anthrop: 'ἄνθρωπος', aqua: 'aqua', arch: 'ἄρχω', astro: 'ἀστήρ',
  aud: 'audio', bibl: 'βιβλίον', bio: 'βίος', cad: 'cado', cap: 'capio', card: 'cor', ced: 'cedo', cern: 'cerno',
  chron: 'χρόνος', cid: 'caedo', claim: 'clamo', clud: 'claudo', cogn: 'cognosco', corp: 'corpus', cosm: 'κόσμος',
  cred: 'credo', cresc: 'cresco', cult: 'colo', cur: 'curro', cura: 'cura', cycl: 'κύκλος', dem: 'δῆμος',
  dent: 'dens', derm: 'δέρμα', dict: 'dico', doc: 'doceo', dom: 'dominus', duc: 'duco', dyn: 'δύναμις',
  equ: 'aequus', fac: 'facio', fer: 'fero', fid: 'fides', fig: 'fingo', fin: 'finis', flect: 'flecto',
  flu: 'fluo', form: 'forma', fort: 'fortis', fract: 'frango', gen: 'genus', geo: 'γῆ', grad: 'gradior',
  graph: 'γράφω', grat: 'gratus', grav: 'gravis', her: 'haereo', hydr: 'ὕδωρ', ject: 'iacio', jud: 'iudex',
  junct: 'iungo', jur: 'ius', labor: 'labor', lect: 'lego', lev: 'levo', liber: 'liber', loc: 'locus',
  log: 'λόγος', loqu: 'loquor', luc: 'lux', magn: 'magnus', man: 'manus', mand: 'mando', mar: 'mare',
  mater: 'mater', medi: 'medius', mem: 'memor', mens: 'metior', merc: 'merx', merg: 'mergo', meter: 'μέτρον',
  migr: 'migro', mit: 'mitto', mob: 'moveo', mort: 'mors', morph: 'μορφή', mut: 'muto', nat: 'nascor',
  nav: 'navis', nect: 'necto', neg: 'nego', neo: 'νέος', nom: 'nomen', nov: 'novus', nunc: 'nuntio',
  oper: 'opus', ordin: 'ordo', ori: 'orior', part: 'pars', path: 'πάθος', pater: 'pater', pati: 'patior',
  ped: 'pes', pel: 'pello', pend: 'pendo', pet: 'peto', phil: 'φίλος', phon: 'φωνή', photo: 'φῶς',
  plaud: 'plaudo', plic: 'plico', plor: 'ploro', pon: 'pono', popul: 'populus', port: 'porto',
  prehend: 'prehendo', press: 'premo', psych: 'ψυχή', quer: 'quaero', rect: 'rego', rog: 'rogo',
  rupt: 'rumpo', sacr: 'sacer', scend: 'scando', sci: 'scio', scope: 'σκοπέω', scrib: 'scribo', sec: 'seco',
  sed: 'sedeo', sens: 'sentio', sequ: 'sequor', sert: 'sero', serv: 'servo', sign: 'signum', simil: 'similis',
  sol: 'sol', solv: 'solvo', son: 'sonus', soph: 'σοφός', spect: 'specio', spir: 'spiro', spond: 'spondeo',
  sta: 'sto', string: 'stringo', struct: 'struo', sult: 'salio', sum: 'sumo', tact: 'tango', ten: 'teneo',
  techn: 'τέχνη', temp: 'tempus', tend: 'tendo', terr: 'terra', text: 'texo', the: 'θεός', therm: 'θερμός',
  tort: 'torqueo', tract: 'traho', tribut: 'tribuo', turb: 'turba', urb: 'urbs', vac: 'vaco', vad: 'vado',
  val: 'valeo', ven: 'venio', ver: 'verus', vert: 'verto', via: 'via', vid: 'video', vinc: 'vinco',
  viv: 'vivo', voc: 'voco', vol: 'volvo', zo: 'ζῷον',
};

/** Wiktionary's language section for a lemma title: Greek script is Ancient Greek. */
export function lemmaLanguage(title: string): 'Latin' | 'Ancient Greek' {
  return /[Ͱ-Ͽἀ-῿]/.test(title) ? 'Ancient Greek' : 'Latin';
}

export interface LemmaPage {
  language: 'Latin' | 'Ancient Greek';
  /** The headword template as written ({{la-verb|irreg|faciō}}), to expand for its principal parts. */
  headTemplate: string;
  pos: string;
  senses: string[];
  /** The Proto-Indo-European root Wiktionary files the word under. */
  pie: string;
  etymology: string;
}

const LEMMA_POS = ['Verb', 'Noun', 'Adjective', 'Adverb', 'Preposition', 'Pronoun', 'Numeral'];

/** The Latin or Ancient Greek entry of a lemma page; null when the page has none. */
export function parseLemmaPage(wikitext: string, title: string): LemmaPage | null {
  const language = lemmaLanguage(title);
  if (!new RegExp(`^==\\s*${language}\\s*==\\s*$`, 'm').test(wikitext || '')) return null;
  const text = extractLanguageSection(wikitext, language);
  const pos = new RegExp(`^(={3,5})\\s*(${LEMMA_POS.join('|')})\\s*\\1\\s*$`, 'm').exec(text);
  if (!pos) return null;
  const rest = text.slice(pos.index + pos[0].length);
  const next = /^=+[^=\n][^\n]*$/m.exec(rest);
  const body = next ? rest.slice(0, next.index) : rest;
  const headTemplate = (body.match(/^\{\{(?:la|grc)-[a-z]+\|[^\n]*\}\}|^\{\{head\|(?:la|grc)\|[^\n]*\}\}/m) || [])[0] || '';
  const senses = body
    .split('\n')
    .filter((l) => /^#\s*[^:*#]/.test(l))
    .map((l) => wikiInline(l.replace(/^#\s*/, '')))
    .filter(Boolean)
    .slice(0, 5);
  // The etymology section that comes before the part of speech.
  const before = text.slice(0, pos.index);
  const etyAt = before.search(/^={3,4}\s*Etymology(?:\s+\d+)?\s*={3,4}\s*$/m);
  const etyBody = etyAt >= 0 ? before.slice(etyAt).replace(/^[^\n]*\n/, '').split(/^=+[^=\n]/m)[0] : '';
  let pie = '';
  for (const t of scanTemplates(etyBody)) {
    if (t.name === 'root' && t.positional[1] === 'ine-pro' && t.positional[2]) {
      pie = t.positional[2];
      break;
    }
  }
  const etymology = etyBody
    .split('\n')
    .filter((l) => l.trim() && !/^\{\{(?:etymon|ety|root)\|/.test(l.trim()))
    .map((l) => wikiInline(l))
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);
  return { language, headTemplate, pos: pos[2].toLowerCase(), senses, pie, etymology };
}

/**
 * The headword line Wiktionary renders from the template, as the citation form and its
 * principal parts: "faciō, facere, fēcī, factum"; "γράφω"; "cor, cordis".
 */
export function principalParts(expandedWikitext: string): string {
  const text = String(expandedWikitext || '')
    .replace(/\[\[Category:[^\]]*\]\]/g, '')
    .replace(/\[\[:?[^\]|]*\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[:?([^\]]+)\]\]/g, '$1');
  const head = (text.match(/<strong[^>]*headword[^>]*>([\s\S]*?)<\/strong>/) || [])[1] || '';
  if (!head) return '';
  const parts: string[] = [head.replace(/<[^>]+>/g, '').trim()];
  const paren = (text.match(/<\/strong>\s*\(([\s\S]*?)\)<\/span>/) || [])[1] || '';
  // Each part is "<i>label</i> <b>form</b> or <b>form</b>"; the first form of each is kept.
  for (const chunk of paren.split(/,\s*(?=<i>)/)) {
    const form = (chunk.match(/<b[^>]*>([\s\S]*?)<\/b>/) || [])[1];
    if (form) parts.push(form.replace(/<[^>]+>/g, '').trim());
  }
  return parts.filter(Boolean).join(', ');
}
