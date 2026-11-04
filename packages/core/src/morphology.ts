/**
 * Morpheme analysis for notebook words: the prefixes, roots and suffixes a learner can
 * recognise across words, with what each means and where it comes from. Han-script words
 * split into their characters, which are the morphemes Chinese and Japanese learners use.
 *
 * The tables hold the classical roots and affixes taught in English vocabulary courses
 * (Latin and Greek roots, Germanic and French affixes). Two things keep spelling from
 * fooling the analysis:
 *
 * - Each root and prefix lists its allomorphs, the spellings it takes in English words:
 *   Latin facere is fac in factory, fic in efficient and fect in infect; ad- assimilates to
 *   the next consonant (accept, affect, attract). An assimilated prefix is recognised by the
 *   doubled consonant it leaves, so "accept" is ad- but "acid" is not.
 * - Words whose spelling looks like a morpheme they do not contain are listed as false
 *   friends: "face" is Latin facies, not facere; "certain" has no ten "hold" in it. Where
 *   Wiktionary's origin for the word is cached (Families traces it), a Germanic word drops
 *   its Latin or Greek parts, and a root whose Proto-Indo-European root disagrees with the
 *   word's is dropped.
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
  /** The spellings the morpheme takes, for display: "fac · fic · fec · fect". Absent for one. */
  forms?: string;
}

/** What the etymology cache knows about a word, as `cachedEtymon` returns it. */
export interface MorphEtymon {
  origin: string;
  roots: string[];
}

interface Entry {
  /**
   * Spellings to match. Plain forms of four letters or more match anywhere in the stem;
   * shorter ones only at its start. `^form` matches only at the start of the stem (the word
   * or what follows its prefix), `+form` only right after a prefix, and `lead|form` only
   * where `lead` comes first ("prin|cip" in principle).
   */
  forms: string[];
  gloss: string;
  origin: string;
  /** Allomorphs shown with the label. */
  show?: string[];
  /** Words this is not in: a stem the word starts with (prefixes) or contains (roots); `word$` for one word. */
  not?: string[];
  /** Proto-Indo-European root as Wiktionary writes it, to check against the word's own. */
  pie?: string;
}

const L = 'Latin';
const G = 'Greek';
const E = 'Old English';
const F = 'French';

/*
 * Prefix forms: `xy:abc` matches xy when the next letter is one of abc. When that letter
 * repeats the form's last one (acc-, aff-, opp-), the doubled consonant marks the prefix and
 * no root is needed after it.
 */
const PREFIXES: Record<string, Entry> = {
  'ab-': { forms: ['abs:ct', 'ab'], gloss: 'away from', origin: L, show: ['ab-', 'abs-'], not: ['abb', 'abdom', 'abide', 'abil', 'able', 'aboard', 'abou', 'abov', 'abroad', 'aband'] },
  'ad-': {
    forms: ['ad', 'ac:cq', 'af:f', 'ag:g', 'al:l', 'an:n', 'ap:p', 'ar:r', 'as:s', 'at:t'],
    gloss: 'to, toward',
    origin: L,
    show: ['ad-', 'ac-', 'af-', 'ag-', 'al-', 'ap-', 'as-', 'at-'],
    not: ['alleg', 'allopar', 'advan', 'adam', 'adder', 'addl', 'attitud', 'annu', 'anniv', 'afford', 'arrow', 'assassin', 'apple', 'allerg', 'alley', 'attic', 'annoy', 'allig', 'ally$x'],
  },
  'ante-': { forms: ['ante'], gloss: 'before', origin: L, not: ['antenn', 'antelop'] },
  'anti-': { forms: ['anti'], gloss: 'against', origin: G, not: ['anticip', 'antiq', 'antic$', 'antics'] },
  'auto-': { forms: ['auto'], gloss: 'self', origin: G, not: ['autumn'] },
  'bene-': { forms: ['bene'], gloss: 'good, well', origin: L },
  'bi-': { forms: ['bi'], gloss: 'two', origin: L },
  'circum-': { forms: ['circum'], gloss: 'around', origin: L },
  'con-': {
    forms: ['con', 'com:mpb', 'col:l', 'cor:r', 'co:aeiouh'],
    gloss: 'together, with',
    origin: L,
    show: ['con-', 'com-', 'col-', 'cor-', 'co-'],
    not: ['conif', 'conch', 'condor', 'condom', 'conga', 'cony', 'comma$', 'commas$', 'comb$', 'combs$', 'combo', 'collar', 'corrid', 'corral', 'coast', 'coat', 'coach', 'coal', 'coin', 'cook', 'cool', 'coop$', 'cobra', 'cocoa', 'coconut', 'coffee', 'coffin'],
  },
  'contra-': { forms: ['contra', 'counter', 'contro'], gloss: 'against', origin: L },
  'de-': { forms: ['de'], gloss: 'down, away, undo', origin: L, not: ['demon', 'decad', 'delight', 'deliber', 'demur'] },
  'dia-': { forms: ['dia'], gloss: 'through, across', origin: G, not: ['diamond', 'diar', 'diaper', 'dial$', 'dials$'] },
  'dis-': {
    forms: ['dis', 'dif:f', 'di:glmrv'],
    gloss: 'apart, not',
    origin: L,
    show: ['dis-', 'dif-', 'di-'],
    not: ['diffeo', 'disc$', 'discs$', 'disco$', 'discus$', 'disk', 'dish', 'dismal', 'discipl', 'dinner', 'diet', 'dial', 'divid', 'divis', 'dive$', 'diving', 'diver$', 'dimens'],
  },
  'en-': { forms: ['en', 'em:bmp'], gloss: 'put into, cause to be', origin: F, show: ['en-', 'em-'], not: ['enter$', 'engine', 'enemy', 'enorm', 'envy', 'envious'] },
  'ex-': {
    forms: ['ex', 'ef:f', 'e:dlmnrv'],
    gloss: 'out, former',
    origin: L,
    show: ['ex-', 'ef-', 'e-'],
    not: ['electr', 'eager', 'eagle', 'east', 'estate', 'establ', 'estim', 'every', 'elephant', 'eleven', 'even$', 'evening', 'evenly', 'exotic', 'ever$', 'evil', 'enemy', 'energ', 'emerald', 'envy', 'envious', 'era$', 'error', 'erron', 'errand', 'elbow', 'elder', 'eldest', 'elm$'],
  },
  'extra-': { forms: ['extra'], gloss: 'beyond', origin: L },
  'fore-': { forms: ['fore'], gloss: 'before, front', origin: E, not: ['foremost', 'forens', 'forest', 'foreign'] },
  'hyper-': { forms: ['hyper'], gloss: 'over, excessive', origin: G },
  'hypo-': { forms: ['hypo'], gloss: 'under', origin: G },
  'in-': {
    forms: ['in', 'im:bmp', 'il:l', 'ir:r'],
    gloss: 'not, into',
    origin: L,
    show: ['in-', 'im-', 'il-', 'ir-'],
    not: ['inferior', 'inside', 'ill$', 'illness', 'irritat', 'imag', 'inch', 'inherit', 'income', 'inn$', 'inning', 'innings', 'instinct', 'imitat'],
  },
  'inter-': { forms: ['inter', 'intel:l'], gloss: 'between', origin: L, not: ['interior', 'intern$', 'internal', 'interest'] },
  'intra-': { forms: ['intra', 'intro'], gloss: 'within', origin: L },
  'macro-': { forms: ['macro'], gloss: 'large', origin: G },
  'mal-': { forms: ['male', 'mal'], gloss: 'bad', origin: L, not: ['male$', 'males$', 'mall', 'malt', 'malay'] },
  'micro-': { forms: ['micro'], gloss: 'small', origin: G },
  'mid-': { forms: ['mid'], gloss: 'middle', origin: E, not: ['midget'] },
  'mis-': { forms: ['mis'], gloss: 'wrongly', origin: E, not: ['miss', 'mist', 'misc', 'miser', 'mister'] },
  'mono-': { forms: ['mono'], gloss: 'one', origin: G },
  'multi-': { forms: ['multi'], gloss: 'many', origin: L },
  'non-': { forms: ['non'], gloss: 'not', origin: L, not: ['none', 'nonetheless'] },
  'ob-': {
    forms: ['ob', 'oc:c', 'of:f', 'op:p'],
    gloss: 'against, toward',
    origin: L,
    show: ['ob-', 'oc-', 'of-', 'op-'],
    not: ['offic', 'offset', 'offspring', 'offshore', 'offhand', 'obelisk', 'oboe', 'occult', 'offal'],
  },
  'omni-': { forms: ['omni'], gloss: 'all', origin: L },
  'out-': { forms: ['out'], gloss: 'beyond, more than', origin: E },
  'over-': { forms: ['over'], gloss: 'too much, above', origin: E, not: ['overt$'] },
  'pan-': { forms: ['pan'], gloss: 'all', origin: G },
  'para-': { forms: ['para'], gloss: 'beside', origin: G, not: ['parade', 'paramount', 'parachut', 'parasol', 'paragon'] },
  'per-': { forms: ['per'], gloss: 'through, thoroughly', origin: L, not: ['person', 'perch', 'peril'] },
  'peri-': { forms: ['peri'], gloss: 'around', origin: G, not: ['peril', 'perish'] },
  'poly-': { forms: ['poly'], gloss: 'many', origin: G },
  'post-': { forms: ['post'], gloss: 'after', origin: L, not: ['poster', 'postur', 'postal', 'postag', 'post$', 'posts$', 'postman'] },
  'pre-': { forms: ['pre'], gloss: 'before', origin: L, not: ['precious', 'premier', 'press', 'pretty', 'prey', 'prest'] },
  'pro-': { forms: ['pro', 'pur'], gloss: 'forward, for', origin: L, show: ['pro-', 'pur-'], not: ['proper', 'probab', 'prove', 'proud', 'provinc'] },
  're-': { forms: ['re'], gloss: 'again, back', origin: L, not: ['regist', 'reason', 'ready', 'real'] },
  'retro-': { forms: ['retro'], gloss: 'backward', origin: L },
  'se-': { forms: ['se'], gloss: 'apart', origin: L, not: ['second', 'secret', 'sense', 'sent', 'session', 'sequ', 'serv', 'sect'] },
  'semi-': { forms: ['semi'], gloss: 'half', origin: L, not: ['seminar'] },
  'sub-': {
    forms: ['sub', 'suc:c', 'suf:f', 'sug:g', 'sup:p', 'sus:cpt'],
    gloss: 'under',
    origin: L,
    show: ['sub-', 'suc-', 'suf-', 'sup-', 'sus-'],
    not: ['supper', 'suck'],
  },
  'super-': { forms: ['super', 'sur:fprv'], gloss: 'above, over', origin: L, show: ['super-', 'sur-'], not: ['surf$', 'surfs', 'surfing', 'surge', 'surgeon', 'surgery', 'surplus$x'] },
  'syn-': { forms: ['syn', 'sym:bmp', 'syl:l'], gloss: 'together', origin: G, show: ['syn-', 'sym-', 'syl-'] },
  'tele-': { forms: ['tele'], gloss: 'far', origin: G },
  'trans-': { forms: ['trans'], gloss: 'across', origin: L },
  'tri-': { forms: ['tri'], gloss: 'three', origin: L, not: ['trich', 'trium', 'trib', 'trick', 'trip', 'trim', 'trivia', 'trigg'] },
  'un-': {
    forms: ['un'],
    gloss: 'not, undo',
    origin: E,
    not: ['unless', 'union', 'uniq', 'unit', 'univers', 'uniform', 'unif', 'unilat', 'unison', 'unicorn', 'unanim', 'uncle', 'until', 'unto$'],
  },
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
  ag: { forms: ['act', 'agen', 'agil', 'agit'], gloss: 'do, drive', origin: L, show: ['ag', 'act'], not: ['impact', 'compact', 'pact', 'practi', 'tactic'], pie: '*h₂eǵ-' },
  am: { forms: ['amor', 'amic', 'amat'], gloss: 'love', origin: L, not: ['amalgam', 'metamor'] },
  anim: { forms: ['anim'], gloss: 'life, mind', origin: L },
  anthrop: { forms: ['anthrop'], gloss: 'human', origin: G },
  aqua: { forms: ['aqua', 'aque'], gloss: 'water', origin: L },
  arch: { forms: ['archy', 'arch'], gloss: 'rule, chief', origin: G, not: ['search', 'march', 'starch', 'parch', 'larch', 'archer', 'arched', 'archipel'] },
  astro: { forms: ['astro', 'aster', 'astr'], gloss: 'star', origin: G, not: ['master', 'plaster', 'faster', 'east', 'caster', 'raster', 'vaster', 'pastr', 'castr', 'gastr', 'pilaster', 'catastroph'] },
  aud: { forms: ['audi', 'audit', 'aud'], gloss: 'hear', origin: L, not: ['audac'] },
  bibl: { forms: ['biblio', 'bibl'], gloss: 'book', origin: G },
  bio: { forms: ['bio'], gloss: 'life', origin: G },
  cad: { forms: ['^cad', '^cas', 'ac|cid', 'in|cid', 'oc|cas', 'de|cay'], gloss: 'fall', origin: L, show: ['cad', 'cas', 'cid'], not: ['cadet', 'decade', 'academ', 'cast', 'cash', 'casin', 'cassett', 'cashier', 'casket', 'castle'] },
  cap: {
    forms: ['capt', 'cept', 'ceiv', 'ceit', 'ceipt', 'cip', 'cap', 'prin|cip', 'parti|cip', 'muni|cip', 'anti|cip', 'eman|cip', '+cup'],
    gloss: 'take, seize',
    origin: L,
    show: ['cap', 'cip', 'cept', 'ceive'],
    not: ['capston', 'capuch', 'capit', 'captain', 'cape$', 'capes$', 'escap', 'handicap', 'cap$', 'caps$', 'capsiz', 'capric', 'reciproc', 'sceptic', 'cipher', 'precip', 'discipl', 'capsul'],
    pie: '*keh₂p-',
  },
  card: { forms: ['cardi', 'cord'], gloss: 'heart', origin: L, show: ['card', 'cord'], not: ['cord$', 'cords$', 'cordon', 'cardin'] },
  ced: { forms: ['cede', 'ceed', 'cess', 'ced'], gloss: 'go, yield', origin: L, show: ['ced', 'ceed', 'cess'], not: ['princess', 'cedar', 'possess', 'obsess'], pie: '*ked-' },
  cern: { forms: ['cert', 'cern', 'cret', 'crimin'], gloss: 'sift, decide', origin: L, show: ['cern', 'cert', 'cret'], not: ['concret', 'concert'] },
  chron: { forms: ['chron'], gloss: 'time', origin: G },
  cid: { forms: ['cis', 'cid'], gloss: 'cut, kill', origin: L, not: ['accid', 'incid', 'coincid', 'acid', 'placid', 'cist'] },
  claim: { forms: ['claim', 'clam'], gloss: 'shout', origin: L, not: ['clam$', 'clams$', 'clamp'] },
  clud: { forms: ['clude', 'clus', 'clos'], gloss: 'shut', origin: L, show: ['clud', 'clus', 'clos'] },
  cogn: { forms: ['cogn', 'gnos'], gloss: 'know', origin: L },
  corp: { forms: ['corpor', 'corp'], gloss: 'body', origin: L },
  cosm: { forms: ['cosm'], gloss: 'world, order', origin: G },
  cred: { forms: ['cred'], gloss: 'believe', origin: L },
  cresc: { forms: ['creas', 'cresc', 'crement', 'cruit'], gloss: 'grow', origin: L },
  cult: { forms: ['cult', 'colon'], gloss: 'till, tend', origin: L, not: ['difficult', 'occult', 'colonel'] },
  cur: { forms: ['curr', 'curs', 'cour', '+cur'], gloss: 'run', origin: L, show: ['cur', 'curs', 'cours'], not: ['secur', 'procur', 'accura', 'courag', 'court', 'curse', 'cursed', 'obscur'] },
  cura: { forms: ['^cura', 'curio', 'secur', 'accura', 'procur', '^cure'], gloss: 'care', origin: L, show: ['cur', 'cura'] },
  cycl: { forms: ['cycl'], gloss: 'circle, wheel', origin: G },
  dem: { forms: ['demo', 'dem'], gloss: 'people', origin: G, not: ['demon', 'demol', 'dement', 'demur', 'demean', 'demand'] },
  dent: { forms: ['^dent', 'dont'], gloss: 'tooth', origin: L },
  derm: { forms: ['derm'], gloss: 'skin', origin: G },
  dict: { forms: ['dict', 'dic'], gloss: 'say', origin: L, show: ['dic', 'dict'], not: ['period', 'dice', 'dick'], pie: '*deyḱ-' },
  doc: { forms: ['doct', 'doc'], gloss: 'teach', origin: L, not: ['dock'] },
  dom: { forms: ['domin', 'domes', 'domai'], gloss: 'master, house', origin: L },
  duc: { forms: ['duct', 'duce', 'duc'], gloss: 'lead', origin: L, show: ['duc', 'duct'], not: ['duck'], pie: '*dewk-' },
  dyn: { forms: ['dynam', 'dyn'], gloss: 'power', origin: G },
  equ: { forms: ['equi', 'equ'], gloss: 'equal', origin: L, not: ['equip'] },
  fac: {
    forms: ['fact', 'fect', 'fic', 'fac', 'feat', 'feit', '+fit', 'i|fic', 'of|fic'],
    gloss: 'make, do',
    origin: L,
    show: ['fac', 'fic', 'fec', 'fect'],
    // facies "face" and fingere "shape" (fiction) look like facere and are not.
    not: ['face', 'facial', 'facet', 'facad', 'fiction', 'fictitious', 'traffic', 'feather', 'superfic', 'preface', 'fickl', 'outfit'],
    pie: '*dʰeh₁-',
  },
  fer: { forms: ['fer'], gloss: 'carry', origin: L, not: ['ferry', 'ferment', 'feroc', 'fern', 'inferior'], pie: '*bʰer-' },
  fid: { forms: ['fid', 'fide'], gloss: 'faith', origin: L, not: ['fiddl', 'fidget'] },
  fig: { forms: ['fict', 'figur', 'feign'], gloss: 'shape, invent', origin: L },
  fin: { forms: ['fini', 'fin'], gloss: 'end, limit', origin: L, not: ['find', 'finger', 'finch', 'finn'] },
  flect: { forms: ['flect', 'flex'], gloss: 'bend', origin: L },
  flu: { forms: ['flu', 'flux'], gloss: 'flow', origin: L, not: ['flush', 'flut'] },
  form: { forms: ['form'], gloss: 'shape', origin: L, not: ['perform', 'former', 'formid'] },
  fort: { forms: ['fort', 'forc'], gloss: 'strong', origin: L, not: ['fortun', 'forty', 'fortnight', 'forth'] },
  fract: { forms: ['fract', 'frag'], gloss: 'break', origin: L, not: ['fragran'] },
  gen: { forms: ['gene', 'genit', 'gen'], gloss: 'birth, kind', origin: L, not: ['genicul', 'agent', 'agenc', 'agend'], pie: '*ǵenh₁-' },
  geo: { forms: ['geo'], gloss: 'earth', origin: G },
  grad: { forms: ['grad', 'gress', 'gred'], gloss: 'step, go', origin: L, show: ['grad', 'gress'] },
  graph: { forms: ['graph', 'gram'], gloss: 'write, draw', origin: G },
  grat: { forms: ['grat'], gloss: 'pleasing, thanks', origin: L, not: ['grate$', 'migrat', 'integr', 'emigrat', 'immigrat'] },
  grav: { forms: ['grav', 'griev'], gloss: 'heavy', origin: L, not: ['grave$', 'graves$', 'gravel', 'engrav', 'gravy'] },
  her: { forms: ['+her', '+hes', 'hesit'], gloss: 'stick', origin: L, show: ['her', 'hes'], not: ['inherit'] },
  hydr: { forms: ['hydr'], gloss: 'water', origin: G },
  ject: { forms: ['ject'], gloss: 'throw', origin: L },
  jud: { forms: ['judic', 'jud'], gloss: 'judge', origin: L },
  junct: { forms: ['junct', 'join'], gloss: 'join', origin: L },
  jur: { forms: ['jur', 'jus'], gloss: 'law, swear', origin: L, not: ['adjust'] },
  labor: { forms: ['labor', 'labour'], gloss: 'work', origin: L },
  lect: { forms: ['lect', '^leg', '+lig'], gloss: 'choose, read', origin: L, show: ['lect', 'leg'], not: ['light', 'electr', 'legal', 'legis', 'legit', 'legac', 'leg$', 'legs$', 'legg', 'alleg', 'colleag', 'colleg'] },
  lev: { forms: ['lev'], gloss: 'lift, light', origin: L, not: ['level', 'eleven'] },
  liber: { forms: ['liber'], gloss: 'free', origin: L, not: ['deliber'] },
  loc: { forms: ['loc'], gloss: 'place', origin: L, not: ['lock', 'block', 'clock', 'flock'] },
  log: { forms: ['logue', 'log'], gloss: 'word, reason', origin: G, not: ['logist'] },
  loqu: { forms: ['loqu', 'locut'], gloss: 'speak', origin: L },
  luc: { forms: ['luc', 'lum'], gloss: 'light', origin: L, not: ['reluct', 'alumin', 'alum$', 'alumni', 'lumber', 'lump', 'luck', 'lucrat'] },
  magn: { forms: ['magn'], gloss: 'great', origin: L, not: ['magnet'] },
  man: { forms: ['manu', 'man'], gloss: 'hand', origin: L, not: ['mantl', 'emanat', 'perman', 'mankind', 'manly', 'many', 'mania', 'maniac', 'mansion', 'manor', 'mango', 'mane$', 'manner$x', 'manifold'] },
  mand: { forms: ['mand'], gloss: 'order, entrust', origin: L, not: ['mandibl', 'summand', 'mandarin'] },
  mar: { forms: ['marin', 'maritim'], gloss: 'sea', origin: L },
  mater: { forms: ['matr', 'mater'], gloss: 'mother', origin: L },
  medi: { forms: ['medi'], gloss: 'middle', origin: L, not: ['medic', 'comedi', 'medit'] },
  mem: { forms: ['memor', 'mem'], gloss: 'remember', origin: L, not: ['member', 'membran'] },
  mens: { forms: ['mens', 'meas'], gloss: 'measure', origin: L, not: ['measl'] },
  merc: { forms: ['merc'], gloss: 'trade, reward', origin: L, not: ['mercur'] },
  merg: { forms: ['merg', 'mers'], gloss: 'dip', origin: L },
  meter: { forms: ['meter', 'metr'], gloss: 'measure', origin: G, not: ['cemeter', 'metrop'] },
  migr: { forms: ['migr'], gloss: 'move', origin: L },
  mit: { forms: ['miss', 'mit', '+mis'], gloss: 'send', origin: L, show: ['mit', 'miss', 'mis'], not: ['missing', 'miss$', 'misses$', 'missed$', 'imitat', 'mitt$', 'mitten$', 'mittens$', 'mitig', 'smith'] },
  mob: { forms: ['mob', 'mot', 'mov'], gloss: 'move', origin: L, show: ['mob', 'mot', 'mov'], not: ['moth', 'mott'] },
  mort: { forms: ['mort'], gloss: 'death', origin: L, not: ['mortar'] },
  morph: { forms: ['morph'], gloss: 'shape', origin: G },
  mut: { forms: ['mut'], gloss: 'change', origin: L, not: ['mute$', 'mutter', 'mutton', 'mutin'] },
  nat: { forms: ['nat', 'nasc'], gloss: 'born', origin: L, not: ['senat'] },
  nav: { forms: ['naut', 'nav'], gloss: 'ship, sail', origin: L, not: ['navel'] },
  nect: { forms: ['nect', 'nex'], gloss: 'tie, bind', origin: L, not: ['next'] },
  neg: { forms: ['neg'], gloss: 'deny', origin: L, not: ['negro'] },
  neo: { forms: ['neo'], gloss: 'new', origin: G },
  nom: { forms: ['nomin', 'nym', 'onym', 'nom'], gloss: 'name', origin: L, not: ['onom', 'anomal', 'nomad'] },
  not: { forms: ['^not', 'notion', 'notic', 'notif'], gloss: 'mark, know', origin: L, show: ['not', 'noti'], not: ['nothing', 'notwith', 'notch', 'notabl'] },
  nov: { forms: ['nov'], gloss: 'new', origin: L, not: ['novemb'] },
  nunc: { forms: ['nounce', 'nunci'], gloss: 'report', origin: L },
  oper: { forms: ['oper'], gloss: 'work', origin: L },
  ordin: { forms: ['ordin'], gloss: 'order', origin: L },
  ori: { forms: ['origin', 'orient', 'abori'], gloss: 'rise, begin', origin: L },
  part: { forms: ['part'], gloss: 'part, share', origin: L },
  path: { forms: ['path'], gloss: 'feeling, disease', origin: G, not: ['path$', 'paths$', 'pathway', 'footpath'] },
  pater: { forms: ['patr', 'pater'], gloss: 'father', origin: L, not: ['patrol'] },
  pati: { forms: ['patien', 'passion', 'passiv'], gloss: 'suffer, feel', origin: L },
  ped: { forms: ['ped', 'pod'], gloss: 'foot', origin: L, not: ['pedag', 'pediatr'] },
  pel: { forms: ['pel', 'puls'], gloss: 'drive, push', origin: L, show: ['pel', 'puls'], not: ['pelic', 'pellet'] },
  pend: { forms: ['pend', 'pens'], gloss: 'hang, weigh', origin: L },
  pet: { forms: ['^pet', 'petit', '+peat'], gloss: 'seek', origin: L, not: ['perpetrat', 'petrol', 'petro', 'petal', 'petty'] },
  phil: { forms: ['phil'], gloss: 'love', origin: G },
  phon: { forms: ['phon'], gloss: 'sound', origin: G },
  photo: { forms: ['photo', 'phot'], gloss: 'light', origin: G },
  plaud: { forms: ['plaud', 'plaus', 'plod', 'plos'], gloss: 'clap', origin: L },
  plic: {
    forms: ['plic', 'plex', 'ply', 'ploy', 'ploit'],
    gloss: 'fold',
    origin: L,
    show: ['plic', 'plex', 'ply'],
    not: ['suppl', 'comply', 'complian', 'complim', 'complem', 'complet'],
  },
  plor: { forms: ['plor'], gloss: 'cry out', origin: L },
  pon: { forms: ['pone', 'posit', 'pos', 'pound'], gloss: 'put, place', origin: L, show: ['pon', 'pos'], not: ['possib', 'possess', 'post', 'posh', 'pound$', 'pounds$'] },
  popul: { forms: ['popul', 'publ'], gloss: 'people', origin: L },
  port: { forms: ['port'], gloss: 'carry', origin: L, not: ['opportun', 'portion', 'proport', 'passport', 'airport', 'seaport', 'portrait', 'portray', 'portal', 'porch', 'port$', 'ports$'], pie: '*per-' },
  prehend: { forms: ['prehen', 'pris'], gloss: 'seize', origin: L, show: ['prehend', 'pris'], not: ['prism'] },
  press: { forms: ['press'], gloss: 'press', origin: L, not: ['cypress'] },
  psych: { forms: ['psych'], gloss: 'mind', origin: G },
  quer: { forms: ['quer', 'quest', 'quir', 'quis'], gloss: 'ask, seek', origin: L, show: ['quer', 'quest', 'quir', 'quis'], not: ['squir'] },
  rect: { forms: ['rect', 'regul', 'regim', '^region'], gloss: 'straight, rule', origin: L, show: ['rect', 'reg'] },
  rog: { forms: ['+rog'], gloss: 'ask', origin: L },
  rupt: { forms: ['rupt'], gloss: 'break', origin: L },
  sacr: { forms: ['sacr', 'sanct'], gloss: 'holy', origin: L, not: ['massacr'] },
  scend: { forms: ['scend', 'scens'], gloss: 'climb', origin: L },
  sci: { forms: ['sci'], gloss: 'know', origin: L, not: ['scissor'] },
  scope: { forms: ['scope'], gloss: 'look at', origin: G },
  scrib: { forms: ['scrib', 'script'], gloss: 'write', origin: L },
  sec: { forms: ['sect', 'segment'], gloss: 'cut', origin: L },
  sed: { forms: ['sess', 'sid', 'sed'], gloss: 'sit', origin: L, show: ['sed', 'sid', 'sess'], not: ['consider', 'inside', 'aside', 'beside'] },
  sens: { forms: ['sens', 'sent'], gloss: 'feel', origin: L, not: ['present', 'absent', 'essent'] },
  sequ: { forms: ['sequ', 'secut'], gloss: 'follow', origin: L },
  sert: { forms: ['+sert'], gloss: 'join', origin: L },
  serv: { forms: ['serv'], gloss: 'serve, keep', origin: L },
  sign: { forms: ['sign'], gloss: 'mark', origin: L },
  simil: { forms: ['simil', 'simul', 'sembl'], gloss: 'like', origin: L },
  sol: { forms: ['sol'], gloss: 'sun, alone', origin: L, not: ['solid', 'soldier', 'solemn', 'consol', 'isolat', 'sold', 'solicit', 'solac'] },
  solv: { forms: ['solv', 'solu'], gloss: 'loosen', origin: L },
  son: { forms: ['son'], gloss: 'sound', origin: L, not: ['person', 'song'] },
  soph: { forms: ['soph'], gloss: 'wise', origin: G },
  spect: { forms: ['spect', 'spic', 'spec'], gloss: 'look', origin: L, show: ['spec', 'spect', 'spic'], pie: '*speḱ-' },
  spir: { forms: ['spir'], gloss: 'breathe', origin: L, not: ['spiral'] },
  spond: { forms: ['spond', 'spons'], gloss: 'promise', origin: L },
  sta: {
    forms: ['stat', 'stit', 'sist', 'stanc', 'stant', 'stabl', 'stacl', '+stin'],
    gloss: 'stand',
    origin: L,
    show: ['sta', 'stat', 'stit', 'sist'],
    not: ['stitch', 'sister', 'instinct'],
    pie: '*steh₂-',
  },
  string: { forms: ['strict', 'string'], gloss: 'draw tight', origin: L },
  struct: { forms: ['struct', 'stru'], gloss: 'build', origin: L, not: ['estrus', 'oestr', 'struck'] },
  sult: { forms: ['+sult', '+sault'], gloss: 'leap', origin: L, not: ['consult'] },
  sum: { forms: ['sume', 'sump'], gloss: 'take', origin: L },
  tact: { forms: ['tact', 'tang', 'at|tain', '+ting'], gloss: 'touch', origin: L, show: ['tact', 'tang', 'ting'], not: ['distin', 'extin', 'instin', 'tactic', 'tango', 'tangl', 'rectang'] },
  ten: {
    forms: ['+tain', '+tin', '+ten', '+tent', 'main|tain', 'main|ten', 'enter|tain', '^tenan', '^tenur', '^tenac', '^tenet', '^tenabl'],
    gloss: 'hold',
    origin: L,
    show: ['ten', 'tin', 'tain'],
    not: ['tenua', 'tenuo', 'attain', 'attend', 'attent', 'intent', 'extent', 'contend', 'contention', 'distin', 'extin', 'instin', 'pretend', 'potent', 'competen'],
    pie: '*ten-',
  },
  techn: { forms: ['techn'], gloss: 'skill, art', origin: G },
  temp: { forms: ['tempor', 'temp'], gloss: 'time', origin: L, not: ['templ', 'tempt'] },
  tend: { forms: ['tend', 'tens', 'tent'], gloss: 'stretch', origin: L, show: ['tend', 'tens', 'tent'], not: ['latent', 'utens', 'content', 'retent', 'detent', 'abstent', 'tentativ', 'potent', 'competent', 'mittent'], pie: '*ten-' },
  terr: { forms: ['terr'], gloss: 'earth', origin: L, not: ['terrib', 'terrif', 'terror'] },
  text: { forms: ['text'], gloss: 'weave', origin: L },
  the: { forms: ['theolog', 'theis', 'theocr'], gloss: 'god', origin: G },
  therm: { forms: ['therm'], gloss: 'heat', origin: G },
  tort: { forms: ['tort'], gloss: 'twist', origin: L },
  tract: { forms: ['tract', 'treat'], gloss: 'pull, draw', origin: L },
  tribut: { forms: ['tribut'], gloss: 'give, assign', origin: L },
  turb: { forms: ['turb'], gloss: 'stir up', origin: L },
  urb: { forms: ['urb'], gloss: 'city', origin: L, not: ['turb'] },
  vac: { forms: ['vac', 'void'], gloss: 'empty', origin: L, not: ['vacc'] },
  vad: { forms: ['+vad', '+vas'], gloss: 'go', origin: L },
  val: { forms: ['val', 'vail'], gloss: 'strong, worth', origin: L, show: ['val', 'vail'], not: ['valley', 'valv', 'interval', 'oval'] },
  ven: { forms: ['vene', 'vent', 'veni', 'ven'], gloss: 'come', origin: L, show: ['ven', 'vent'], not: ['juven', 'juvent', 'seven', 'ventil', 'venge', 'vend', 'vener', 'veneer', 'oven', 'even$', 'evening', 'evenly', 'venom', 'venus'], pie: '*gʷem-' },
  ver: { forms: ['veri', 'ver'], gloss: 'true', origin: L, not: ['verb', 'over$', 'every', 'averag', 'verge', 'vermi', 'veranda', 'vernac', 'verdant'] },
  vert: { forms: ['vert', 'vers'], gloss: 'turn', origin: L, show: ['vert', 'vers'], not: ['neverthe'] },
  via: { forms: ['via', 'vious', 'voy', '+vey'], gloss: 'way', origin: L, show: ['via', 'vi', 'voy', 'vey'], not: ['envious', 'aviat', 'survey', 'purvey'] },
  vel: { forms: ['+vel', '+veal'], gloss: 'veil', origin: L, not: ['develop', 'level', 'travel', 'novel', 'marvel', 'shovel', 'swivel', 'gravel'] },
  vid: { forms: ['vid', 'vis'], gloss: 'see', origin: L, show: ['vid', 'vis'], not: ['divid', 'divis', 'devis', 'individ'], pie: '*weyd-' },
  vinc: { forms: ['vinc', 'vict'], gloss: 'conquer', origin: L, not: ['provinc', 'victim'] },
  viv: { forms: ['viv', 'vita', 'vit'], gloss: 'live', origin: L, not: ['invit', 'evitabl'] },
  voc: { forms: ['voc', 'vok'], gloss: 'call, voice', origin: L },
  vol: { forms: ['volv', 'volu'], gloss: 'roll', origin: L, not: ['volupt', 'volunt'] },
  zo: { forms: ['zoo', 'zo'], gloss: 'animal', origin: G, not: ['zone', 'zoom'] },
};

/** Roots and prefix forms of two letters or one letter only count at the start of the word. */
const MIN_STEM = 3;

const HAN = /[㐀-䶿一-鿿豈-﫿]/;

interface Form {
  key: string;
  e: Entry;
  /** The letters that make up the morpheme. */
  form: string;
  /** Letters that must come right before it (not part of the morpheme). */
  lead: string;
  /** Next-letter condition for an assimilated prefix ("ac" before c or q). */
  next: string;
  /** "start": only at the stem start; "bound": only right after a prefix. */
  at: 'any' | 'start' | 'bound';
}

function parseForms(table: Record<string, Entry>): Form[] {
  const out: Form[] = [];
  for (const [key, e] of Object.entries(table)) {
    for (const raw of e.forms) {
      let s = raw;
      let at: Form['at'] = 'any';
      if (s.startsWith('^')) {
        at = 'start';
        s = s.slice(1);
      } else if (s.startsWith('+')) {
        at = 'bound';
        s = s.slice(1);
      }
      const [body, next = ''] = s.split(':');
      const bar = body.indexOf('|');
      const lead = bar >= 0 ? body.slice(0, bar) : '';
      const form = bar >= 0 ? body.slice(bar + 1) : body;
      out.push({ key, e, form, lead, next, at });
    }
  }
  return out.sort((a, b) => b.form.length + b.lead.length - (a.form.length + a.lead.length));
}

const PREFIX_FORMS = parseForms(PREFIXES);
const SUFFIX_FORMS = parseForms(SUFFIXES);
const ROOT_FORMS = parseForms(ROOTS);

/** Prefixes that are almost always prefixes at the start of a word. */
const RELIABLE_PREFIX = new Set([
  'un', 'non', 'mis', 'dis', 'over', 'under', 'out', 'fore', 'anti', 'ante', 'inter', 'intra', 'trans', 'super', 'multi',
  'semi', 'tele', 'micro', 'macro', 'mono', 'poly', 'auto', 'hyper', 'hypo', 'post', 'pre', 'circum', 'contra',
  'counter', 'extra', 'retro', 'omni', 'bene', 'male', 'peri', 'para', 'dia', 'mid', 'uni', 'tri',
  'ad', 'ob', 'con', 'com', 'ex', 'sub', 'syn', 'sym', 'sur', 'im',
]);

/** Origins a Latin or Greek morpheme cannot sit in (from the etymology cache). */
const GERMANIC = new Set(['Old English', 'Old Norse', 'Dutch', 'Low German', 'Germanic', 'Frankish', 'German']);

/** Suffixes that can sit inside another suffix ("nation·al·ity", "hope·ful·ness"). */
const INNER_SUFFIX = new Set(['-al', '-ive', '-able', '-ful', '-less', '-ous', '-ic', '-ant', '-ary', '-sion', '-ate', '-ize']);
const OUTER_TAKES_INNER = new Set(['-ity', '-ly', '-ness', '-ism', '-ist', '-ize', '-al', '-ment', '-ate']);

/** True when `word` is listed as a false friend: `stem$` for the word itself, else a stem it starts with or contains. */
function listed(not: string[] | undefined, word: string, kind: 'prefix' | 'root'): boolean {
  if (!not) return false;
  for (const n of not) {
    if (n.endsWith('$')) {
      if (word === n.slice(0, -1)) return true;
    } else if (kind === 'prefix' ? word.startsWith(n) : word.includes(n)) return true;
  }
  return false;
}

const showOf = (e: Entry, label: string) => (e.show && e.show.length > 1 ? e.show.join(' · ') : undefined);

function morphOf(kind: MorphKind, label: string, e: Entry, start: number, end: number): Morph {
  const forms = showOf(e, label);
  return { kind, label, gloss: e.gloss, origin: e.origin, start, end, ...(forms ? { forms } : {}) };
}

/** The PIE root without its notation, so "*speḱ-" and "*spek-" compare equal. */
function pieKey(r: string): string {
  return r.normalize('NFD').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * The root that starts earliest in w[lo, hi), the longest one where two start together.
 * `afterPrefix` says a prefix ends at `lo`, which `+form` roots need.
 */
function findRoot(w: string, lo: number, hi: number, afterPrefix: boolean, ety: MorphEtymon | null, afterRoot = false): Morph | null {
  let best: { f: Form; at: number } | null = null;
  for (const f of ROOT_FORMS) {
    let at = w.indexOf(f.form, lo);
    while (at >= 0 && at < hi) {
      if (fits(w, f, at, lo, afterPrefix, afterRoot)) break;
      at = w.indexOf(f.form, at + 1);
    }
    if (at < 0 || at >= hi) continue;
    // A short root that runs on into the suffix must leave a suffix behind it:
    // "inter·nat·ion·al" does, "se·nat·e" does not.
    const end = at + f.form.length;
    if (f.form.length <= 3 && !f.lead && f.at !== 'bound' && end > hi && !SUFFIX_FORMS.some((x) => x.form.length >= 2 && w.startsWith(x.form, end))) continue;
    if (listed(f.e.not, w, 'root')) continue;
    if (!rootAgrees(f.e, ety)) continue;
    if (!best || at < best.at || (at === best.at && f.form.length > best.f.form.length)) best = { f, at };
  }
  return best ? morphOf('root', best.f.key, best.f.e, best.at, best.at + best.f.form.length) : null;
}

function fits(w: string, f: Form, at: number, lo: number, afterPrefix: boolean, afterRoot: boolean): boolean {
  if (f.lead && w.slice(at - f.lead.length, at) !== f.lead) return false;
  if (f.lead) return true;
  if (f.at === 'bound') return afterPrefix && at === lo;
  if (f.at === 'start') return at === lo;
  if (f.form.length >= 4) return true;
  if (at === lo) return true;
  // A short root one letter in: after a prefix ("e·duc·ate"), after a word-initial vowel
  // ("o·mit", "a·ven·ue") or after a linking vowel that follows another root ("sign·i·fic"),
  // never after a consonant ("b·loc·k").
  if (at !== lo + 1 || f.form.length <= 2) return false;
  if (afterPrefix) return true;
  return lo === 0 ? /[aeiou]/.test(w[0]) : afterRoot && w[lo] === 'i';
}

function rootAgrees(e: Entry, ety: MorphEtymon | null): boolean {
  if (!ety) return true;
  if ((e.origin === L || e.origin === G) && GERMANIC.has(ety.origin)) return false;
  if (e.pie && ety.roots.length && !ety.roots.some((r) => pieKey(r) === pieKey(e.pie!))) return false;
  return true;
}

/** Split a Latin-script word into prefix, root and suffix parts, left to right. */
function analyzeLatin(word: string, ety: MorphEtymon | null): Morph[] {
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
    suffixes.unshift(morphOf('suffix', hit.key, hit.e, hi, hi + hit.form.length));
  }

  const germanic = !!ety && GERMANIC.has(ety.origin);
  let prefix: Morph | null = null;
  let root: Morph | null = null;
  // A longer prefix that starts the word but is turned down ("under" in "underg·o" is not)
  // also rules out the shorter ones inside it: "undergo" is not un·dergo.
  let refused = '';
  let held: { p: Morph; r: Morph | null } | null = null;
  for (const p of PREFIX_FORMS) {
    if (!w.startsWith(p.form)) continue;
    // Once a prefix is held, only the shorter prefixes inside it are worth trying.
    if (held && !w.slice(0, held.p.end).startsWith(p.form)) continue;
    if (refused && refused.startsWith(p.form)) continue;
    const n = p.form.length;
    if (p.next && !p.next.includes(w[n] || '')) continue;
    if (listed(p.e.not, w, 'prefix')) continue;
    if (germanic && p.e.origin !== E) continue;
    const r = findRoot(w, n, hi, true, ety);
    const rootNext = !!r && r.start === n;
    const doubled = !!p.next && w[n] === p.form[n - 1];
    const reliable = doubled || RELIABLE_PREFIX.has(p.form);
    // The rest must be long enough to be a word part ("ad·opt" is, "ex·it" is not), or be a
    // known root on its own ("com·pel"). A long, reliable prefix may leave two letters
    // ("contra·st", "under·go").
    const rest = w.length - n;
    const longOk = reliable && n >= 4 && rest >= 2 && w.length >= 6;
    if (rest < 4 && !(rootNext && r!.end - r!.start >= 3) && !(reliable && rest >= 3 && w.length >= 5) && !longOk) {
      if (n >= 4 && !refused) refused = p.form;
      continue;
    }
    // An ambiguous prefix ("re", "de", "in", "se") counts only with a known root right after it.
    if (!reliable && !rootNext) continue;
    // A prefix with no known root after it is held back while a shorter one inside it is
    // tried: "con·tract" and "con·tribute" have a root after con-, "contra·st" has none.
    if (!rootNext && !held) {
      held = { p: morphOf('prefix', p.key, p.e, 0, n), r };
      continue;
    }
    if (held && !rootNext) break;
    prefix = morphOf('prefix', p.key, p.e, 0, n);
    root = r;
    break;
  }
  if (!prefix && held) {
    prefix = held.p;
    root = held.r;
  }
  if (!prefix) root = findRoot(w, 0, hi, false, ety);

  // A second root right after the first ("manu·fact·ure", "sign·i·fic·ant", "photo·graph").
  let root2: Morph | null = null;
  if (root && root.end < hi) {
    const r2 = findRoot(w, root.end, hi, false, ety, true);
    if (r2 && r2.label !== root.label && r2.start <= root.end + 1 && r2.end - r2.start >= 3) root2 = r2;
  }
  const last = root2 || root;

  // A root that runs into the suffix ("de·struct·ion") moves the suffix boundary.
  if (last && suffixes.length && last.end > suffixes[0].start) {
    if (last.end >= suffixes[0].end) suffixes.shift();
    else suffixes[0] = { ...suffixes[0], start: last.end };
  }
  while (prefix && suffixes.length && suffixes[0].start < prefix.end) suffixes.shift();
  const out: Morph[] = [];
  if (prefix) out.push(prefix);
  if (root) out.push(root);
  if (root2) out.push(root2);
  // Without a known root or prefix, a two-letter ending is usually part of the word
  // ("chamber", "mirror"); longer endings ("-ness", "-tion") still hold.
  const kept = prefix || root ? suffixes : suffixes.filter((m) => m.end - m.start >= 3);
  return [...out, ...kept];
}

/**
 * The word's prefixes, roots and suffixes. `etymon` is what the etymology cache knows about
 * the word, when anything; it removes parts the word's history rules out.
 */
export function analyzeMorphemes(word: string, etymon?: MorphEtymon | null): Morph[] {
  const w = String(word || '').trim();
  if (!w) return [];
  if (HAN.test(w)) {
    const out: Morph[] = [];
    [...w].forEach((ch, i) => {
      if (HAN.test(ch)) out.push({ kind: 'char', label: ch, gloss: '', origin: '', start: i, end: i + 1 });
    });
    return out.length > 1 ? out : [];
  }
  return analyzeLatin(w, etymon || null);
}

/** One prefix, root or suffix from the tables, for pages about a word part. */
export interface MorphEntry {
  kind: 'prefix' | 'root' | 'suffix';
  /** The label analyzeMorphemes uses: "ob-", "fac", "-tion". */
  key: string;
  gloss: string;
  origin: string;
  /** Its spellings, the label first: ["ob-", "oc-", "of-", "op-"], ["fac", "fic", "fec", "fect"]. */
  forms: string[];
  /** Proto-Indo-European root as Wiktionary writes it ("*dʰeh₁-"), when the table records one. */
  pie?: string;
}

function entryOf(kind: MorphEntry['kind'], key: string, e: Entry): MorphEntry {
  const dash = (f: string) => (kind === 'prefix' ? `${f}-` : kind === 'suffix' ? `-${f}` : f);
  const plain = e.forms.map((f) => {
    const body = f.replace(/^[+^]/, '').split(':')[0];
    return dash(body.slice(body.indexOf('|') + 1));
  });
  const forms = [key, ...(e.show || []), ...plain].filter((f, i, all) => all.indexOf(f) === i);
  return { kind, key, gloss: e.gloss, origin: e.origin, forms, ...(e.pie ? { pie: e.pie } : {}) };
}

/**
 * The table entry for a word part, by its label or any of its spellings: "ob-", "oc-",
 * "fac", "fect", "-tion". A bare spelling is tried as a root, then as a prefix, then as a suffix.
 */
export function morphEntry(form: string): MorphEntry | null {
  const f = String(form || '').trim().toLowerCase();
  if (!f) return null;
  const tables: Array<[MorphEntry['kind'], Record<string, Entry>]> = f.endsWith('-')
    ? [['prefix', PREFIXES]]
    : f.startsWith('-')
      ? [['suffix', SUFFIXES]]
      : [['root', ROOTS], ['prefix', PREFIXES], ['suffix', SUFFIXES]];
  for (const [kind, table] of tables) {
    const bare = f.replace(/^-|-$/g, '');
    for (const [key, e] of Object.entries(table)) {
      const entry = entryOf(kind, key, e);
      if (entry.forms.some((x) => x.replace(/^-|-$/g, '') === bare)) return entry;
    }
  }
  return null;
}

/** "fac · fic · fec · fect" for a root or prefix with several spellings, else the label. */
export function morphForms(kind: MorphKind, label: string): string {
  const e = kind === 'prefix' ? PREFIXES[label] : kind === 'root' ? ROOTS[label] : kind === 'suffix' ? SUFFIXES[label] : undefined;
  return (e && showOf(e, label)) || label;
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
