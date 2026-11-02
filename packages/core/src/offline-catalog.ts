/**
 * Offline dictionary packs offered in Settings → Offline on desktop and phone.
 * `language` is the headword language; lookups search the pack whose language
 * matches the word, and Settings groups packs under it.
 *
 * Every pack is a published open dump. Current Oxford, Collegiate Webster and
 * Collins editions are not redistributable, so they are not offered.
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
  /** Confirmation shown before downloading; the only place the licence is spelled out. */
  consent: string;
  urls: string[];
  format: OfflinePackFormat;
  archive: OfflinePackArchive;
  platforms: OfflinePlatform[];
}

const BOTH: OfflinePlatform[] = ['desktop', 'phone'];
const FREEDICT = 'https://download.freedict.org/dictionaries';

function freedict(
  code: string,
  language: string,
  version: string,
  sizeHint: string,
  license: string,
  platforms: OfflinePlatform[] = BOTH,
): OfflineCatalogItem {
  const pair = `${code}-eng`;
  const name = `FreeDict ${languageName(language)}–English`;
  return {
    id: `freedict-${pair}`,
    name,
    language,
    license,
    sizeHint,
    consent: `Download ${name} from download.freedict.org?\n\n${license}.`,
    urls: [`${FREEDICT}/${pair}/${version}/freedict-${pair}-${version.replace(/\+/g, '%2B')}.src.tar.xz`],
    format: 'freedict-tei',
    archive: 'tar.xz',
    platforms,
  };
}

const JMDICT_RELEASE =
  'https://github.com/scriptin/jmdict-simplified/releases/download/3.6.2%2B20261026175559';
const KENGDIC_COMMIT = '793de2369c9a98b944154eb4695d26854d2de59b';

const CC_BY_SA_3 = 'Creative Commons Attribution-ShareAlike 3.0';
const GPL_2 = 'GNU GPL 2.0 or later';

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
  },
  {
    id: 'freedict-eng-zho',
    name: 'FreeDict English–Chinese',
    language: 'en',
    license: 'GNU GPL',
    sizeHint: '1.6 MB',
    consent: 'Download FreeDict English–Chinese from download.freedict.org?\n\nGNU GPL. About 26k headwords.',
    urls: [`${FREEDICT}/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.src.tar.xz`],
    format: 'freedict-tei',
    archive: 'tar.xz',
    platforms: BOTH,
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
  },
  {
    id: 'jmdict-eng',
    name: 'JMdict',
    language: 'ja',
    license: 'EDRDG Licence, Creative Commons Attribution-ShareAlike 4.0',
    sizeHint: '12 MB',
    consent:
      'Download JMdict (English) from github.com/scriptin/jmdict-simplified?\n\n' +
      'Electronic Dictionary Research and Development Group, Creative Commons Attribution-ShareAlike 4.0. About 219k entries; import may take a few minutes.',
    urls: [`${JMDICT_RELEASE}/jmdict-eng-3.6.2%2B20261026175559.json.tgz`],
    format: 'jmdict',
    archive: 'tar.gz',
    platforms: ['desktop'],
  },
  {
    id: 'jmdict-eng-common',
    name: 'JMdict (common words)',
    language: 'ja',
    license: 'EDRDG Licence, Creative Commons Attribution-ShareAlike 4.0',
    sizeHint: '1.4 MB',
    consent:
      'Download JMdict common words (English) from github.com/scriptin/jmdict-simplified?\n\n' +
      'Electronic Dictionary Research and Development Group, Creative Commons Attribution-ShareAlike 4.0. About 23k entries.',
    urls: [`${JMDICT_RELEASE}/jmdict-eng-common-3.6.2%2B20261026175559.json.tgz`],
    format: 'jmdict',
    archive: 'tar.gz',
    platforms: ['phone'],
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
  },
  // German is 450 MB once unpacked: desktop only.
  freedict('deu', 'de', '1.9-fd1', '18 MB', 'GNU GPL 3.0 and GNU AGPL 3.0 (Ding by Frank Richter)', ['desktop']),
  freedict('fra', 'fr', '0.4.1', '210 KB', GPL_2),
  freedict('ita', 'it', '2025.11.23', '1.2 MB', CC_BY_SA_3),
  freedict('por', 'pt', '0.2', '195 KB', GPL_2),
  freedict('nld', 'nl', '0.2', '430 KB', GPL_2),
  freedict('pol', 'pl', '2025.11.23', '1.9 MB', CC_BY_SA_3),
  freedict('rus', 'ru', '2025.11.23', '1.2 MB', CC_BY_SA_3),
  freedict('ell', 'el', '2025.11.23', '850 KB', CC_BY_SA_3),
  freedict('fin', 'fi', '2025.11.23', '1.7 MB', CC_BY_SA_3),
  freedict('hun', 'hu', '0.4.1', '2 MB', 'GNU GPL 2.0'),
  freedict('cat', 'ca', '2025.11.23', '775 KB', CC_BY_SA_3),
  freedict('hrv', 'hr', '0.1.2', '1 MB', GPL_2),
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
