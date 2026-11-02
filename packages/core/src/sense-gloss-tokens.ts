/**
 * Bag-of-words tokens for gloss overlap (simplified Lesk). Shared by the
 * runtime aligner and `scripts/build-sense-frequency.js`, which stores
 * WordNet glosses already reduced to these tokens, so both sides must use
 * exactly this function. No imports: the build script transpiles it alone.
 */

const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below ' +
    'between both but by can could did do does doing down during each either etc especially few for from ' +
    'further had has have having he her here hers him his how however i if in into is it its itself just ' +
    'least less many may might more most much must my no nor not now of off often on once one ones only or ' +
    'other others our out over own per rather same she should so some something someone such than that the ' +
    'their them then there these they this those though through thus to too under until up upon usually ' +
    'very was we were what when where whether which while who whom whose why will with within without ' +
    'would you your used use using sth sb someone one\'s oneself certain particular various kind sort type ' +
    'way thing things act instance state quality process manner person people'
  ).split(/\s+/),
);

/** Usage labels Wiktionary puts in parentheses; they say nothing about the sense. */
const LABELS = new Set(
  (
    'countable uncountable transitive intransitive ambitransitive reflexive figurative figuratively literally ' +
    'informal formal colloquial slang dated archaic obsolete rare chiefly mostly british american us uk ' +
    'plural singular sometimes attributive comparable uncomparable ergative idiomatic dialect dialectal ' +
    'nonstandard derogatory humorous euphemistic poetic literary also'
  ).split(/\s+/),
);

/** Derivational endings, longest first; "finance" and "financial" both become "financ". */
const ENDINGS = ['ational', 'ation', 'ement', 'ment', 'ness', 'ance', 'ence', 'ical', 'ial', 'ous', 'ive', 'ity', 'al', 'ic'];

/** Light suffix stripping, then a 7-letter cap ("currency" and "currents" stay apart). */
function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(?:ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  const inflection = w.match(/(?:ing|ed)$/);
  if (inflection && w.length - inflection[0].length >= 3) {
    w = w.slice(0, -inflection[0].length);
    if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(?:ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
  } else if (w.length > 5 && w.endsWith('ly')) {
    w = w.slice(0, -2);
  }
  const ending = ENDINGS.find((e) => w.endsWith(e) && w.length - e.length >= 4);
  if (ending) w = w.slice(0, -ending.length);
  else if (/[ey]$/.test(w) && w.length >= 4) w = w.slice(0, -1);
  return w.slice(0, 7);
}

/** Lower-case content-word stems, de-duplicated, in first-seen order. */
export function glossTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const words = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z']+/);
  for (const raw of words) {
    const word = raw.replace(/^'+|'+$/g, '').replace(/'s$/, '');
    if (word.length < 3 || STOPWORDS.has(word) || LABELS.has(word)) continue;
    const s = stem(word);
    if (s.length < 3 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
