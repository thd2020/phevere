/**
 * Offline dictionary packs offered in Settings → Offline on desktop and phone.
 * `language` is the headword language; lookups search the pack whose language
 * matches the word, and Settings groups packs under it.
 *
 * Every pack is a published open dump. Current Oxford, Collegiate Webster and
 * Collins editions are not redistributable, so they are not offered.
 *
 * Inspector metadata (edition, date, entry count, licence) comes from the
 * publishers: freedict.org/freedict-database.json and each TEI header for
 * FreeDict, the CC-CEDICT file header, the jmdict-simplified release files,
 * kengdic.tsv, and the download servers' file dates for WordNet and GCIDE.
 * Leave a field out rather than guess it.
 */

import { compareLanguageHeadings, languageName } from './source-languages';

export type OfflinePackFormat = 'wordnet' | 'gcide' | 'cedict' | 'freedict-tei' | 'jmdict' | 'kengdic';
export type OfflinePackArchive = 'tar.gz' | 'tar.xz' | 'gz' | 'plain';
export type OfflinePlatform = 'desktop' | 'phone';

export interface OfflineCatalogItem {
  id: string;
  name: string;
  /** Headword language (ISO 639-1). */
  language: string;
  license: string;
  /** Download size as shown next to the pack. */
  sizeHint: string;
  /** Confirmation shown before downloading. */
  consent: string;
  urls: string[];
  format: OfflinePackFormat;
  archive: OfflinePackArchive;
  platforms: OfflinePlatform[];
  /** What the pack holds, in one or two sentences. */
  description: string;
  /** The dictionary's own project page. */
  homepage: string;
  /** Licence deed or text. */
  licenseUrl?: string;
  /** Edition as its publisher numbers it. */
  edition?: string;
  /** Date of that edition, YYYY-MM-DD, as the publisher or the download server gives it. */
  date?: string;
  /** Headword or entry count of this edition. */
  entries?: number;
  /** True when `entries` is rounded because the source changes daily. */
  entriesApprox?: boolean;
  /** Who compiles or maintains it. */
  publisher?: string;
}

const BOTH: OfflinePlatform[] = ['desktop', 'phone'];
const FREEDICT = 'https://download.freedict.org/dictionaries';

const CC_BY_SA_3 = 'Creative Commons Attribution-ShareAlike 3.0';
const CC_BY_SA_3_URL = 'https://creativecommons.org/licenses/by-sa/3.0/';
const GPL_2 = 'GNU GPL 2.0 or later';
const GPL_2_URL = 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html';
const EDRDG = 'EDRDG Licence, Creative Commons Attribution-ShareAlike 4.0';
const EDRDG_URL = 'https://www.edrdg.org/edrdg/licence.html';
const WIKDICT = 'WikDict (Karl Bartel)';

interface FreedictMeta {
  edition: string;
  sizeHint: string;
  license: string;
  licenseUrl: string;
  /** Edition date and headword count from freedict.org/freedict-database.json. */
  date: string;
  entries: number;
  description: string;
  publisher: string;
  platforms?: OfflinePlatform[];
}

function freedict(code: string, language: string, m: FreedictMeta): OfflineCatalogItem {
  const pair = `${code}-eng`;
  const name = `FreeDict ${languageName(language)}–English`;
  return {
    id: `freedict-${pair}`,
    name,
    language,
    license: m.license,
    sizeHint: m.sizeHint,
    consent: `Download ${name} from download.freedict.org?\n\n${m.license}.`,
    urls: [`${FREEDICT}/${pair}/${m.edition}/freedict-${pair}-${m.edition.replace(/\+/g, '%2B')}.src.tar.xz`],
    format: 'freedict-tei',
    archive: 'tar.xz',
    platforms: m.platforms || BOTH,
    description: m.description,
    homepage: 'https://freedict.org/',
    licenseUrl: m.licenseUrl,
    edition: m.edition,
    date: m.date,
    entries: m.entries,
    publisher: m.publisher,
  };
}

/** X–English dictionaries that WikDict generates from Wiktionary (CC BY-SA 3.0 in every TEI header). */
function wikdict(code: string, language: string, sizeHint: string, entries: number): OfflineCatalogItem {
  return freedict(code, language, {
    edition: '2025.11.23',
    sizeHint,
    license: CC_BY_SA_3,
    licenseUrl: CC_BY_SA_3_URL,
    date: '2025-11-23',
    entries,
    description: `${languageName(language)} headwords with English translations, generated from Wiktionary by WikDict.`,
    publisher: WIKDICT,
  });
}

/** Older FreeDict word lists under the GPL. */
function freedictGpl(
  code: string,
  language: string,
  edition: string,
  sizeHint: string,
  date: string,
  entries: number,
  license = GPL_2,
): OfflineCatalogItem {
  return freedict(code, language, {
    edition,
    sizeHint,
    license,
    licenseUrl: GPL_2_URL,
    date,
    entries,
    description: `${languageName(language)} headwords with English translations from the FreeDict project.`,
    publisher: 'FreeDict',
  });
}

const JMDICT_RELEASE =
  'https://github.com/scriptin/jmdict-simplified/releases/download/3.6.2%2B20261026175559';
const KENGDIC_COMMIT = '793de2369c9a98b944154eb4695d26854d2de59b';

export const OFFLINE_CATALOG: OfflineCatalogItem[] = [
  {
    id: 'wordnet-3.1',
    name: 'Princeton WordNet 3.1',
    language: 'en',
    license: 'WordNet License (Princeton University)',
    sizeHint: '16 MB',
    consent:
      'Download Princeton WordNet 3.1 from wordnetcode.princeton.edu?\n\n' +
      'WordNet License (free use with attribution). This product includes WordNet® data developed by Princeton University. Import may take a minute.',
    urls: ['https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz'],
    format: 'wordnet',
    archive: 'tar.gz',
    platforms: BOTH,
    description:
      'A lexical database of English. Nouns, verbs, adjectives and adverbs are grouped into sets of synonyms, each with a short definition.',
    homepage: 'https://wordnet.princeton.edu/',
    licenseUrl: 'https://wordnet.princeton.edu/license-and-commercial-use',
    edition: '3.1',
    date: '2012-02-27',
    publisher: 'Princeton University',
  },
  {
    id: 'webster-1913',
    name: "Webster's Unabridged 1913 (GCIDE)",
    language: 'en',
    license: 'GPL-3+ (GNU GCIDE; 1913 Webster text is public domain)',
    sizeHint: '18 MB',
    consent:
      "Download GNU GCIDE (Webster's Revised Unabridged Dictionary, 1913) from ftp.gnu.org?\n\n" +
      'GNU GPL v3 or later. File is large; import may take a few minutes.',
    urls: [
      'https://ftp.gnu.org/gnu/gcide/gcide-0.53.tar.gz',
      'https://mirrors.kernel.org/gnu/gcide/gcide-0.53.tar.gz',
    ],
    format: 'gcide',
    archive: 'tar.gz',
    platforms: BOTH,
    description:
      "GNU's Collaborative International Dictionary of English: Webster's Revised Unabridged Dictionary of 1913, supplemented with WordNet and proofread by volunteers.",
    homepage: 'https://www.gnu.org/software/gcide/',
    licenseUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    edition: '0.53',
    date: '2021-04-27',
    publisher: 'GNU Project',
  },
  {
    id: 'freedict-eng-zho',
    name: 'FreeDict English–Chinese',
    language: 'en',
    license: CC_BY_SA_3,
    sizeHint: '1.6 MB',
    consent: `Download FreeDict English–Chinese from download.freedict.org?\n\n${CC_BY_SA_3}. About 27k headwords.`,
    urls: [`${FREEDICT}/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.src.tar.xz`],
    format: 'freedict-tei',
    archive: 'tar.xz',
    platforms: BOTH,
    description: 'English headwords with Chinese translations, generated from Wiktionary by WikDict.',
    homepage: 'https://freedict.org/',
    licenseUrl: CC_BY_SA_3_URL,
    edition: '2025.11.23',
    date: '2025-11-23',
    entries: 26660,
    publisher: WIKDICT,
  },
  {
    id: 'cc-cedict',
    name: 'CC-CEDICT',
    language: 'zh',
    license: 'Creative Commons Attribution-ShareAlike 4.0',
    sizeHint: '4 MB',
    consent:
      'Download free CC-CEDICT from mdbg.net?\n\nCreative Commons Attribution-ShareAlike 4.0. File is large; import may take a minute.',
    urls: ['https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz'],
    format: 'cedict',
    archive: 'gz',
    platforms: BOTH,
    description:
      'Community-maintained Chinese–English dictionary with traditional and simplified characters, pinyin and English glosses.',
    homepage: 'https://cc-cedict.org/wiki/',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    edition: 'Daily export',
    entries: 125000,
    entriesApprox: true,
    publisher: 'MDBG',
  },
  {
    id: 'jmdict-eng',
    name: 'JMdict',
    language: 'ja',
    license: EDRDG,
    sizeHint: '12 MB',
    consent:
      'Download JMdict (English) from github.com/scriptin/jmdict-simplified?\n\n' +
      'Electronic Dictionary Research and Development Group, Creative Commons Attribution-ShareAlike 4.0. About 219k entries; import may take a few minutes.',
    urls: [`${JMDICT_RELEASE}/jmdict-eng-3.6.2%2B20261026175559.json.tgz`],
    format: 'jmdict',
    archive: 'tar.gz',
    platforms: ['desktop'],
    description:
      'Japanese–English dictionary with kanji spellings, kana readings and English glosses, in the JSON edition by jmdict-simplified.',
    homepage: 'https://www.edrdg.org/jmdict/j_jmdict.html',
    licenseUrl: EDRDG_URL,
    edition: '3.6.2',
    date: '2026-10-26',
    entries: 218963,
    publisher: 'Electronic Dictionary Research and Development Group',
  },
  {
    id: 'jmdict-eng-common',
    name: 'JMdict (common words)',
    language: 'ja',
    license: EDRDG,
    sizeHint: '1.4 MB',
    consent:
      'Download JMdict common words (English) from github.com/scriptin/jmdict-simplified?\n\n' +
      'Electronic Dictionary Research and Development Group, Creative Commons Attribution-ShareAlike 4.0. About 23k entries.',
    urls: [`${JMDICT_RELEASE}/jmdict-eng-common-3.6.2%2B20261026175559.json.tgz`],
    format: 'jmdict',
    archive: 'tar.gz',
    platforms: ['phone'],
    description: 'The JMdict entries marked as common words, with kanji spellings, kana readings and English glosses.',
    homepage: 'https://www.edrdg.org/jmdict/j_jmdict.html',
    licenseUrl: EDRDG_URL,
    edition: '3.6.2',
    date: '2026-10-26',
    entries: 22649,
    publisher: 'Electronic Dictionary Research and Development Group',
  },
  {
    id: 'kengdic',
    name: 'Kengdic Korean–English',
    language: 'ko',
    license: 'MPL 2.0 or GNU LGPL 2.0 or later',
    sizeHint: '3.4 MB',
    consent:
      "Download Kengdic (Joe Speigle's Korean–English dictionary) from github.com/garfieldnate/kengdic?\n\n" +
      'Mozilla Public License 2.0 or GNU LGPL 2.0 or later. About 109k words.',
    urls: [`https://raw.githubusercontent.com/garfieldnate/kengdic/${KENGDIC_COMMIT}/kengdic.tsv`],
    format: 'kengdic',
    archive: 'plain',
    platforms: BOTH,
    description: "Joe Speigle's Korean–English word list, with hanja where known.",
    homepage: 'https://github.com/garfieldnate/kengdic',
    licenseUrl: 'https://www.mozilla.org/MPL/2.0/',
    edition: KENGDIC_COMMIT.slice(0, 7),
    publisher: 'Joe Speigle',
  },
  // German is 450 MB once unpacked: desktop only.
  freedict('deu', 'de', {
    edition: '1.9-fd1',
    sizeHint: '18 MB',
    license: 'GNU GPL 3.0 and GNU AGPL 3.0 (Ding by Frank Richter)',
    licenseUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    date: '2022-04-15',
    entries: 517534,
    description: 'German–English dictionary from Ding by Frank Richter, TU Chemnitz.',
    publisher: 'Frank Richter (Ding)',
    platforms: ['desktop'],
  }),
  freedictGpl('fra', 'fr', '0.4.1', '210 KB', '2018-08-11', 8505),
  wikdict('ita', 'it', '1.2 MB', 29660),
  freedictGpl('por', 'pt', '0.2', '195 KB', '2017-12-09', 10661),
  freedictGpl('nld', 'nl', '0.2', '430 KB', '2017-12-06', 22747),
  wikdict('pol', 'pl', '1.9 MB', 42088),
  wikdict('rus', 'ru', '1.2 MB', 42600),
  wikdict('ell', 'el', '850 KB', 41714),
  wikdict('fin', 'fi', '1.7 MB', 42060),
  freedictGpl('hun', 'hu', '0.4.1', '2 MB', '2017-12-06', 139935, 'GNU GPL 2.0'),
  wikdict('cat', 'ca', '775 KB', 23590),
  freedictGpl('hrv', 'hr', '0.1.2', '1 MB', '2017-12-05', 79808),
];

export function catalogFor(platform: OfflinePlatform): OfflineCatalogItem[] {
  return OFFLINE_CATALOG.filter((p) => p.platforms.includes(platform));
}

export function getCatalogItem(id: string): OfflineCatalogItem | undefined {
  return OFFLINE_CATALOG.find((p) => p.id === id);
}

export interface CatalogLanguageGroup<T extends { language: string }> {
  language: string;
  title: string;
  items: T[];
}

/** Packs grouped under their headword language, English first, then Chinese, Japanese, Korean, then A–Z. */
export function groupCatalogByLanguage<T extends { language: string }>(items: T[]): Array<CatalogLanguageGroup<T>> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.language) || [];
    list.push(item);
    groups.set(item.language, list);
  }
  return Array.from(groups.keys())
    .sort(compareLanguageHeadings)
    .map((language) => ({ language, title: languageName(language), items: groups.get(language)! }));
}

/** Which tar members hold the dictionary for a pack format. */
export function wantsArchiveMember(format: OfflinePackFormat, name: string): boolean {
  switch (format) {
    case 'wordnet':
      return /^data\.(noun|verb|adj|adv)$/i.test(name);
    case 'gcide':
      return /^CIDE\.[A-Z]$/i.test(name);
    case 'freedict-tei':
      return /\.tei$/i.test(name);
    case 'jmdict':
      return /\.json$/i.test(name);
    default:
      return true;
  }
}
