/**
 * Morpheme analysis for notebook words: the prefixes, roots and suffixes a learner can
 * recognise across words, with what each means and where it comes from. Han-script words
 * split into their characters, which are the morphemes Chinese and Japanese learners use.
 *
 * The tables hold the classical roots and affixes taught in English vocabulary courses
 * (Latin and Greek roots, Germanic and French affixes). A match needs the rest of the word
 * to stay long enough to be a word part, so "man" is not found in "germane".
 */

export type MorphKind = 'prefix' | 'root' | 'suffix' | 'char';

export interface Morph {
  kind: MorphKind;
  /** Canonical form shown to the user: "spect", "re-", "-tion", "対". */
  label: string;
  gloss: string;
  origin: string;
  /** Position in the word, for the breakdown "in·spect·or". */
  start: number;
  end: number;
}

interface Entry {
  forms: string[];
  gloss: string;
  origin: string;
}

const L = 'Latin';
const G = 'Greek';
const E = 'Old English';
const F = 'French';

const PREFIXES: Record<string, Entry> = {
  'anti-': { forms: ['anti'], gloss: 'against', origin: G },
  'auto-': { forms: ['auto'], gloss: 'self', origin: G },
  'bene-': { forms: ['bene'], gloss: 'good, well', origin: L },
  'bi-': { forms: ['bi'], gloss: 'two', origin: L },
  'circum-': { forms: ['circum'], gloss: 'around', origin: L },
  'co-': { forms: ['com', 'con', 'col', 'cor', 'co'], gloss: 'together, with', origin: L },
  'contra-': { forms: ['contra', 'counter'], gloss: 'against', origin: L },
  'de-': { forms: ['de'], gloss: 'down, away, undo', origin: L },
  'dia-': { forms: ['dia'], gloss: 'through, across', origin: G },
  'dis-': { forms: ['dis', 'dif'], gloss: 'apart, not', origin: L },
  'en-': { forms: ['en', 'em'], gloss: 'put into, cause to be', origin: F },
  'ex-': { forms: ['ex', 'e'], gloss: 'out, former', origin: L },
  'extra-': { forms: ['extra'], gloss: 'beyond', origin: L },
  'fore-': { forms: ['fore'], gloss: 'before, front', origin: E },
  'hyper-': { forms: ['hyper'], gloss: 'over, excessive', origin: G },
  'hypo-': { forms: ['hypo'], gloss: 'under', origin: G },
  'in-': { forms: ['in', 'im', 'il', 'ir'], gloss: 'not, into', origin: L },
  'inter-': { forms: ['inter'], gloss: 'between', origin: L },
  'intra-': { forms: ['intra', 'intro'], gloss: 'within', origin: L },
  'macro-': { forms: ['macro'], gloss: 'large', origin: G },
  'mal-': { forms: ['male', 'mal'], gloss: 'bad', origin: L },
  'micro-': { forms: ['micro'], gloss: 'small', origin: G },
  'mid-': { forms: ['mid'], gloss: 'middle', origin: E },
  'mis-': { forms: ['mis'], gloss: 'wrongly', origin: E },
  'mono-': { forms: ['mono'], gloss: 'one', origin: G },
  'multi-': { forms: ['multi'], gloss: 'many', origin: L },
  'non-': { forms: ['non'], gloss: 'not', origin: L },
  'ob-': { forms: ['ob', 'op', 'oc'], gloss: 'against, toward', origin: L },
  'omni-': { forms: ['omni'], gloss: 'all', origin: L },
  'out-': { forms: ['out'], gloss: 'beyond, more than', origin: E },
  'over-': { forms: ['over'], gloss: 'too much, above', origin: E },
  'pan-': { forms: ['pan'], gloss: 'all', origin: G },
  'para-': { forms: ['para'], gloss: 'beside', origin: G },
  'per-': { forms: ['per'], gloss: 'through, thoroughly', origin: L },
  'peri-': { forms: ['peri'], gloss: 'around', origin: G },
  'poly-': { forms: ['poly'], gloss: 'many', origin: G },
  'post-': { forms: ['post'], gloss: 'after', origin: L },
  'pre-': { forms: ['pre'], gloss: 'before', origin: L },
  'pro-': { forms: ['pro'], gloss: 'forward, for', origin: L },
  're-': { forms: ['re'], gloss: 'again, back', origin: L },
  'retro-': { forms: ['retro'], gloss: 'backward', origin: L },
  'se-': { forms: ['se'], gloss: 'apart', origin: L },
  'semi-': { forms: ['semi'], gloss: 'half', origin: L },
  'sub-': { forms: ['sub', 'suc', 'suf', 'sup', 'sus'], gloss: 'under', origin: L },
  'super-': { forms: ['super', 'sur'], gloss: 'above, over', origin: L },
  'syn-': { forms: ['syn', 'sym'], gloss: 'together', origin: G },
  'tele-': { forms: ['tele'], gloss: 'far', origin: G },
  'trans-': { forms: ['trans'], gloss: 'across', origin: L },
  'tri-': { forms: ['tri'], gloss: 'three', origin: L },
  'un-': { forms: ['un'], gloss: 'not, undo', origin: E },
  'under-': { forms: ['under'], gloss: 'below, too little', origin: E },
  'uni-': { forms: ['uni'], gloss: 'one', origin: L },
};

const SUFFIXES: Record<string, Entry> = {
  '-able': { forms: ['able', 'ible'], gloss: 'can be done', origin: L },
  '-age': { forms: ['age'], gloss: 'action, collection', origin: F },
  '-al': { forms: ['ial', 'al'], gloss: 'relating to', origin: L },
  '-ance': { forms: ['ance', 'ence', 'ancy', 'ency'], gloss: 'state, quality', origin: L },
  '-ant': { forms: ['ant', 'ent'], gloss: 'one who, being', origin: L },
  '-ary': { forms: ['ary', 'ory'], gloss: 'relating to, place for', origin: L },
  '-ate': { forms: ['ate'], gloss: 'make, having', origin: L },
  '-cide': { forms: ['cide'], gloss: 'killing', origin: L },
  '-cracy': { forms: ['cracy', 'crat'], gloss: 'rule', origin: G },
  '-dom': { forms: ['dom'], gloss: 'state, realm', origin: E },
  '-en': { forms: ['en'], gloss: 'make, made of', origin: E },
  '-er': { forms: ['ator', 'er', 'or'], gloss: 'one who, more', origin: E },
  '-ery': { forms: ['ery'], gloss: 'place, practice', origin: F },
  '-ful': { forms: ['ful'], gloss: 'full of', origin: E },
  '-hood': { forms: ['hood'], gloss: 'state, group', origin: E },
  '-ic': { forms: ['ical', 'ic'], gloss: 'relating to', origin: G },
  '-ify': { forms: ['ify', 'fy'], gloss: 'make', origin: L },
  '-ism': { forms: ['ism'], gloss: 'belief, practice', origin: G },
  '-ist': { forms: ['ist'], gloss: 'one who', origin: G },
  '-ity': { forms: ['ity', 'ty'], gloss: 'state, quality', origin: L },
  '-ive': { forms: ['ative', 'itive', 'ive'], gloss: 'tending to', origin: L },
  '-ize': { forms: ['ize', 'ise'], gloss: 'make, become', origin: G },
  '-less': { forms: ['less'], gloss: 'without', origin: E },
  '-logy': { forms: ['logy', 'ology'], gloss: 'study of', origin: G },
  '-ly': { forms: ['ly'], gloss: 'in the manner of', origin: E },
  '-ment': { forms: ['ment'], gloss: 'action, result', origin: L },
  '-ness': { forms: ['ness'], gloss: 'state, quality', origin: E },
  '-ous': { forms: ['ious', 'eous', 'ous'], gloss: 'full of', origin: L },
  '-phobia': { forms: ['phobia', 'phobe'], gloss: 'fear', origin: G },
  '-ship': { forms: ['ship'], gloss: 'state, skill', origin: E },
  '-sion': { forms: ['ation', 'ition', 'tion', 'sion', 'ion'], gloss: 'act, state', origin: L },
  '-ure': { forms: ['ure'], gloss: 'act, result', origin: L },
  '-ward': { forms: ['ward', 'wards'], gloss: 'direction', origin: E },
  '-wise': { forms: ['wise'], gloss: 'in the manner of', origin: E },
};

const ROOTS: Record<string, Entry> = {
  ag: { forms: ['act', 'agi', 'ag'], gloss: 'do, drive', origin: L },
  am: { forms: ['amor', 'amic', 'amat'], gloss: 'love', origin: L },
  anthrop: { forms: ['anthrop'], gloss: 'human', origin: G },
  aqua: { forms: ['aqua', 'aque'], gloss: 'water', origin: L },
  arch: { forms: ['archy', 'arch'], gloss: 'rule, chief', origin: G },
  astro: { forms: ['astro', 'aster', 'astr'], gloss: 'star', origin: G },
  aud: { forms: ['audi', 'audit', 'aud'], gloss: 'hear', origin: L },
  bibl: { forms: ['biblio', 'bibl'], gloss: 'book', origin: G },
  bio: { forms: ['bio'], gloss: 'life', origin: G },
  cap: { forms: ['capt', 'cept', 'ceiv', 'cip', 'cap'], gloss: 'take, seize', origin: L },
  card: { forms: ['cardi', 'cord'], gloss: 'heart', origin: L },
  ced: { forms: ['cede', 'ceed', 'cess', 'ced'], gloss: 'go, yield', origin: L },
  chron: { forms: ['chron'], gloss: 'time', origin: G },
  cid: { forms: ['cis', 'cid'], gloss: 'cut, kill', origin: L },
  claim: { forms: ['claim', 'clam'], gloss: 'shout', origin: L },
  clud: { forms: ['clude', 'clus', 'clos'], gloss: 'shut', origin: L },
  cogn: { forms: ['cogn', 'gnos'], gloss: 'know', origin: L },
  corp: { forms: ['corpor', 'corp'], gloss: 'body', origin: L },
  cosm: { forms: ['cosm'], gloss: 'world, order', origin: G },
  cred: { forms: ['cred'], gloss: 'believe', origin: L },
  cur: { forms: ['curr', 'curs', 'cour'], gloss: 'run', origin: L },
  cycl: { forms: ['cycl'], gloss: 'circle, wheel', origin: G },
  dem: { forms: ['demo', 'dem'], gloss: 'people', origin: G },
  dent: { forms: ['dent', 'dont'], gloss: 'tooth', origin: L },
  derm: { forms: ['derm'], gloss: 'skin', origin: G },
  dict: { forms: ['dict', 'dic'], gloss: 'say', origin: L },
  doc: { forms: ['doct', 'doc'], gloss: 'teach', origin: L },
  dom: { forms: ['domin', 'domes'], gloss: 'master, house', origin: L },
  duc: { forms: ['duct', 'duce', 'duc'], gloss: 'lead', origin: L },
  dyn: { forms: ['dynam', 'dyn'], gloss: 'power', origin: G },
  equ: { forms: ['equi', 'equ'], gloss: 'equal', origin: L },
  fac: { forms: ['fact', 'fect', 'fic', 'fac'], gloss: 'make, do', origin: L },
  fer: { forms: ['fer'], gloss: 'carry', origin: L },
  fid: { forms: ['fid', 'fide'], gloss: 'faith', origin: L },
  fin: { forms: ['fini', 'fin'], gloss: 'end, limit', origin: L },
  flect: { forms: ['flect', 'flex'], gloss: 'bend', origin: L },
  flu: { forms: ['flu', 'flux'], gloss: 'flow', origin: L },
  form: { forms: ['form'], gloss: 'shape', origin: L },
  fract: { forms: ['fract', 'frag'], gloss: 'break', origin: L },
  gen: { forms: ['gene', 'genit', 'gen'], gloss: 'birth, kind', origin: L },
  geo: { forms: ['geo'], gloss: 'earth', origin: G },
  grad: { forms: ['grad', 'gress'], gloss: 'step, go', origin: L },
  graph: { forms: ['graph', 'gram'], gloss: 'write, draw', origin: G },
  grat: { forms: ['grat'], gloss: 'pleasing, thanks', origin: L },
  hydr: { forms: ['hydr'], gloss: 'water', origin: G },
  ject: { forms: ['ject'], gloss: 'throw', origin: L },
  jud: { forms: ['judic', 'jud'], gloss: 'judge', origin: L },
  junct: { forms: ['junct', 'join'], gloss: 'join', origin: L },
  jur: { forms: ['jur', 'jus'], gloss: 'law, swear', origin: L },
  lect: { forms: ['lect', 'leg'], gloss: 'choose, read', origin: L },
  lev: { forms: ['lev'], gloss: 'lift, light', origin: L },
  liber: { forms: ['liber'], gloss: 'free', origin: L },
  loc: { forms: ['loc'], gloss: 'place', origin: L },
  log: { forms: ['logue', 'log'], gloss: 'word, reason', origin: G },
  loqu: { forms: ['loqu', 'locut'], gloss: 'speak', origin: L },
  luc: { forms: ['luc', 'lum'], gloss: 'light', origin: L },
  magn: { forms: ['magn'], gloss: 'great', origin: L },
  man: { forms: ['manu', 'man'], gloss: 'hand', origin: L },
  mar: { forms: ['mari', 'mar'], gloss: 'sea', origin: L },
  mater: { forms: ['matr', 'mater'], gloss: 'mother', origin: L },
  medi: { forms: ['medi'], gloss: 'middle', origin: L },
  mem: { forms: ['memor', 'mem'], gloss: 'remember', origin: L },
  meter: { forms: ['meter', 'metr'], gloss: 'measure', origin: G },
  migr: { forms: ['migr'], gloss: 'move', origin: L },
  mit: { forms: ['miss', 'mit'], gloss: 'send', origin: L },
  mob: { forms: ['mob', 'mot', 'mov'], gloss: 'move', origin: L },
  mort: { forms: ['mort'], gloss: 'death', origin: L },
  morph: { forms: ['morph'], gloss: 'shape', origin: G },
  mut: { forms: ['mut'], gloss: 'change', origin: L },
  nat: { forms: ['nat', 'nasc'], gloss: 'born', origin: L },
  nav: { forms: ['naut', 'nav'], gloss: 'ship, sail', origin: L },
  neg: { forms: ['neg'], gloss: 'deny', origin: L },
  neo: { forms: ['neo'], gloss: 'new', origin: G },
  nom: { forms: ['nomin', 'nym', 'nom'], gloss: 'name', origin: L },
  nov: { forms: ['nov'], gloss: 'new', origin: L },
  path: { forms: ['path'], gloss: 'feeling, disease', origin: G },
  pater: { forms: ['patr', 'pater'], gloss: 'father', origin: L },
  ped: { forms: ['ped', 'pod'], gloss: 'foot', origin: L },
  pel: { forms: ['pel', 'puls'], gloss: 'drive, push', origin: L },
  pend: { forms: ['pend', 'pens'], gloss: 'hang, weigh', origin: L },
  phil: { forms: ['phil'], gloss: 'love', origin: G },
  phon: { forms: ['phon'], gloss: 'sound', origin: G },
  photo: { forms: ['photo', 'phot'], gloss: 'light', origin: G },
  plic: { forms: ['plic', 'plex', 'ply'], gloss: 'fold', origin: L },
  pon: { forms: ['pone', 'pos', 'pound'], gloss: 'put, place', origin: L },
  port: { forms: ['port'], gloss: 'carry', origin: L },
  psych: { forms: ['psych'], gloss: 'mind', origin: G },
  quer: { forms: ['quer', 'quest', 'quir', 'quis'], gloss: 'ask, seek', origin: L },
  rupt: { forms: ['rupt'], gloss: 'break', origin: L },
  scend: { forms: ['scend', 'scens'], gloss: 'climb', origin: L },
  sci: { forms: ['sci'], gloss: 'know', origin: L },
  scope: { forms: ['scope'], gloss: 'look at', origin: G },
  scrib: { forms: ['scrib', 'script'], gloss: 'write', origin: L },
  sec: { forms: ['sect', 'sec'], gloss: 'cut', origin: L },
  sed: { forms: ['sess', 'sid', 'sed'], gloss: 'sit', origin: L },
  sens: { forms: ['sens', 'sent'], gloss: 'feel', origin: L },
  sequ: { forms: ['sequ', 'secut'], gloss: 'follow', origin: L },
  serv: { forms: ['serv'], gloss: 'serve, keep', origin: L },
  sign: { forms: ['sign'], gloss: 'mark', origin: L },
  simil: { forms: ['simil', 'simul', 'sembl'], gloss: 'like', origin: L },
  sol: { forms: ['sol'], gloss: 'sun, alone', origin: L },
  solv: { forms: ['solv', 'solu'], gloss: 'loosen', origin: L },
  son: { forms: ['son'], gloss: 'sound', origin: L },
  soph: { forms: ['soph'], gloss: 'wise', origin: G },
  spect: { forms: ['spect', 'spic'], gloss: 'look', origin: L },
  spir: { forms: ['spir'], gloss: 'breathe', origin: L },
  sta: { forms: ['stat', 'stit', 'sist'], gloss: 'stand', origin: L },
  string: { forms: ['strict', 'string'], gloss: 'draw tight', origin: L },
  struct: { forms: ['struct', 'stru'], gloss: 'build', origin: L },
  sum: { forms: ['sume', 'sump'], gloss: 'take', origin: L },
  tact: { forms: ['tact', 'tang'], gloss: 'touch', origin: L },
  tain: { forms: ['tain', 'ten', 'tin'], gloss: 'hold', origin: L },
  techn: { forms: ['techn'], gloss: 'skill, art', origin: G },
  temp: { forms: ['tempor', 'temp'], gloss: 'time', origin: L },
  tend: { forms: ['tend', 'tens', 'tent'], gloss: 'stretch', origin: L },
  terr: { forms: ['terr'], gloss: 'earth', origin: L },
  the: { forms: ['theo', 'thei'], gloss: 'god', origin: G },
  therm: { forms: ['therm'], gloss: 'heat', origin: G },
  tort: { forms: ['tort'], gloss: 'twist', origin: L },
  tract: { forms: ['tract'], gloss: 'pull, draw', origin: L },
  urb: { forms: ['urb'], gloss: 'city', origin: L },
  vac: { forms: ['vac', 'void'], gloss: 'empty', origin: L },
  val: { forms: ['val'], gloss: 'strong, worth', origin: L },
  ven: { forms: ['vene', 'vent', 'ven'], gloss: 'come', origin: L },
  ver: { forms: ['veri', 'ver'], gloss: 'true', origin: L },
  vert: { forms: ['vert', 'vers'], gloss: 'turn', origin: L },
  vid: { forms: ['vid', 'vis'], gloss: 'see', origin: L },
  vinc: { forms: ['vinc', 'vict'], gloss: 'conquer', origin: L },
  viv: { forms: ['viv', 'vita', 'vit'], gloss: 'live', origin: L },
  voc: { forms: ['voc', 'vok'], gloss: 'call, voice', origin: L },
  vol: { forms: ['volv', 'volu'], gloss: 'roll', origin: L },
  zo: { forms: ['zoo', 'zo'], gloss: 'animal', origin: G },
};

/** Roots and prefix forms of two letters or one letter only count at the start of the word. */
const MIN_STEM = 3;

const HAN = /[㐀-䶿一-鿿豈-﫿]/;

function sortedForms(table: Record<string, Entry>): Array<{ key: string; form: string; e: Entry }> {
  const out: Array<{ key: string; form: string; e: Entry }> = [];
  for (const [key, e] of Object.entries(table)) for (const form of e.forms) out.push({ key, form, e });
  return out.sort((a, b) => b.form.length - a.form.length);
}

const PREFIX_FORMS = sortedForms(PREFIXES);
const SUFFIX_FORMS = sortedForms(SUFFIXES);
const ROOT_FORMS = sortedForms(ROOTS);

/** Prefixes that are almost always prefixes at the start of a word. */
const RELIABLE_PREFIX = new Set([
  'un', 'non', 'mis', 'dis', 'over', 'under', 'out', 'fore', 'anti', 'inter', 'intra', 'trans', 'super', 'multi',
  'semi', 'tele', 'micro', 'macro', 'mono', 'poly', 'auto', 'hyper', 'hypo', 'post', 'pre', 'circum', 'contra',
  'counter', 'extra', 'retro', 'omni', 'bene', 'male', 'peri', 'para', 'dia', 'mid', 'uni', 'tri',
]);

/** Suffixes that can sit inside another suffix ("nation·al·ity", "hope·ful·ness"). */
const INNER_SUFFIX = new Set(['-al', '-ive', '-able', '-ful', '-less', '-ous', '-ic', '-ant', '-ary', '-sion', '-ate', '-ize']);
const OUTER_TAKES_INNER = new Set(['-ity', '-ly', '-ness', '-ism', '-ist', '-ize', '-al', '-ment', '-ate']);

function findRoot(w: string, lo: number, hi: number): Morph | null {
  const rest = w.slice(lo);
  for (const r of ROOT_FORMS) {
    const at = rest.indexOf(r.form);
    if (at < 0 || lo + at >= hi) continue;
    // A three-letter root must sit at the start of the stem or right after it.
    if (r.form.length <= 3 && at > 1) continue;
    if (r.form.length <= 2 && at !== 0) continue;
    return { kind: 'root', label: r.key, gloss: r.e.gloss, origin: r.e.origin, start: lo + at, end: lo + at + r.form.length };
  }
  return null;
}

/** Split a Latin-script word into prefix, root and suffix parts, left to right. */
function analyzeLatin(word: string): Morph[] {
  const w = word.toLowerCase();
  if (!/^[a-z]{4,}$/.test(w)) return [];
  let hi = w.length;

  const suffixes: Morph[] = [];
  for (let guard = 0; guard < 3; guard++) {
    const outer = suffixes[0];
    const hit = SUFFIX_FORMS.find((s) => {
      if (!w.slice(0, hi).endsWith(s.form) || hi - s.form.length < MIN_STEM) return false;
      if (!outer) return true;
      return OUTER_TAKES_INNER.has(outer.label) && INNER_SUFFIX.has(s.key) && s.key !== outer.label;
    });
    if (!hit) break;
    // "-er"/"-en"/"-ly"/"-al" on short stems are mostly not suffixes ("never", "open", "only").
    if (hit.form.length <= 2 && hi - hit.form.length < 4) break;
    hi -= hit.form.length;
    suffixes.unshift({ kind: 'suffix', label: hit.key, gloss: hit.e.gloss, origin: hit.e.origin, start: hi, end: hi + hit.form.length });
  }

  let prefix: Morph | null = null;
  let root: Morph | null = null;
  for (const p of PREFIX_FORMS) {
    if (!w.startsWith(p.form) || w.length - p.form.length < 4) continue;
    const r = findRoot(w, p.form.length, hi);
    const reliable = RELIABLE_PREFIX.has(p.form);
    // An ambiguous prefix ("re", "de", "in", "se") counts only with a known root right after it.
    if (!reliable && !(r && r.start === p.form.length)) continue;
    prefix = { kind: 'prefix', label: p.key, gloss: p.e.gloss, origin: p.e.origin, start: 0, end: p.form.length };
    root = r;
    break;
  }
  if (!prefix) root = findRoot(w, 0, hi);

  // A root that runs into the suffix ("de·struct·ion") moves the suffix boundary.
  if (root && suffixes.length && root.end > suffixes[0].start) {
    if (root.end >= suffixes[0].end) suffixes.shift();
    else suffixes[0] = { ...suffixes[0], start: root.end };
  }
  const out: Morph[] = [];
  if (prefix) out.push(prefix);
  if (root) out.push(root);
  // Without a known root or prefix, a two-letter ending is usually part of the word
  // ("chamber", "mirror"); longer endings ("-ness", "-tion") still hold.
  const kept = prefix || root ? suffixes : suffixes.filter((m) => m.end - m.start >= 3);
  return [...out, ...kept];
}

export function analyzeMorphemes(word: string): Morph[] {
  const w = String(word || '').trim();
  if (!w) return [];
  if (HAN.test(w)) {
    const out: Morph[] = [];
    [...w].forEach((ch, i) => {
      if (HAN.test(ch)) out.push({ kind: 'char', label: ch, gloss: '', origin: '', start: i, end: i + 1 });
    });
    return out.length > 1 ? out : [];
  }
  return analyzeLatin(w);
}

/** "in·spect·or" from the analysis, or the word itself when nothing was found. */
export function morphBreakdown(word: string, morphs = analyzeMorphemes(word)): string[] {
  const w = String(word || '');
  if (!morphs.length || morphs[0].kind === 'char') return morphs.length ? morphs.map((m) => m.label) : [w];
  const cuts = new Set<number>([0, w.length]);
  for (const m of morphs) {
    cuts.add(m.start);
    cuts.add(m.end);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const p = w.slice(sorted[i], sorted[i + 1]);
    if (p) parts.push(p);
  }
  return parts;
}

/** The origin a learner would file the word under: its root's, else its prefix's. */
export function wordOrigin(morphs: Morph[]): string {
  const root = morphs.find((m) => m.kind === 'root');
  if (root) return root.origin;
  const pre = morphs.find((m) => m.kind === 'prefix');
  if (pre) return pre.origin;
  const suf = morphs.find((m) => m.kind === 'suffix');
  return suf ? suf.origin : '';
}

/** Stem used to spot one notebook word inside another ("nation" in "nationality"). */
export function derivationStem(word: string): string {
  const w = String(word || '').toLowerCase();
  if (!/^[a-z]{4,}$/.test(w)) return '';
  if (w.endsWith('y')) return w.slice(0, -1);
  if (w.endsWith('e')) return w.slice(0, -1);
  return w;
}
