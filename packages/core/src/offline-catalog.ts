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

import { formatMegabytes, formatNumber, languageDisplayName, t, type MessageKey } from './i18n/runtime';
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
  /** Download size as shown next to the pack, in the interface language (read when shown). */
  readonly sizeHint: string;
  /** Confirmation shown before downloading, in the interface language (read when shown). */
  readonly consent: string;
  urls: string[];
  format: OfflinePackFormat;
  archive: OfflinePackArchive;
  platforms: OfflinePlatform[];
  /** What the pack holds, in one or two sentences, in the interface language (read when shown). */
  readonly description: string;
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
/** The publisher and licence as the JMdict download confirmation names them. */
const EDRDG_CONSENT = 'Electronic Dictionary Research and Development Group, Creative Commons Attribution-ShareAlike 4.0';
const WIKDICT = 'WikDict (Karl Bartel)';

/** A download size in megabytes as the interface language writes it ("1.6 MB", "210 kB"). */
export function formatPackSize(megabytes: number): string {
  if (megabytes < 1) return formatNumber(Math.round(megabytes * 1000), { style: 'unit', unit: 'kilobyte', unitDisplay: 'short' });
  return formatMegabytes(megabytes, 1);
}

/** The confirmation before a download: "Download X from host?", a blank line, then what to expect. */
function consentText(name: string, host: string, rest: string, free = false): string {
  return `${t(free ? 'settings.offline.consent.askFree' : 'settings.offline.consent.ask', { name, host })}\n\n${rest}`;
}

type PackText = Pick<OfflineCatalogItem, 'sizeHint' | 'consent' | 'description'> & { edition?: string };

/**
 * A pack whose shown text (size, confirmation, description and, where it is a word, the edition)
 * follows the interface language: each is a getter, read when Settings shows it, and a spread
 * copy (`{ ...item }`) takes the text of the moment.
 */
function pack(item: Omit<OfflineCatalogItem, keyof PackText> & { edition?: string }, sizeMB: number, text: { consent: () => string; description: () => string; edition?: () => string }): OfflineCatalogItem {
  const props: PropertyDescriptorMap = {
    sizeHint: { get: () => formatPackSize(sizeMB), enumerable: true },
    consent: { get: text.consent, enumerable: true },
    description: { get: text.description, enumerable: true },
  };
  if (text.edition) props.edition = { get: text.edition, enumerable: true };
  return Object.defineProperties(item, props) as OfflineCatalogItem;
}

interface FreedictMeta {
  edition: string;
  sizeMB: number;
  license: string;
  licenseUrl: string;
  /** Edition date and headword count from freedict.org/freedict-database.json. */
  date: string;
  entries: number;
  description: () => string;
  publisher: string;
  platforms?: OfflinePlatform[];
}

function freedict(code: string, language: string, m: FreedictMeta): OfflineCatalogItem {
  const pair = `${code}-eng`;
  // A pack's name is the name of the work, in English as FreeDict publishes it.
  const name = `FreeDict ${languageName(language)}–English`;
  return pack(
    {
      id: `freedict-${pair}`,
      name,
      language,
      license: m.license,
      urls: [`${FREEDICT}/${pair}/${m.edition}/freedict-${pair}-${m.edition.replace(/\+/g, '%2B')}.src.tar.xz`],
      format: 'freedict-tei',
      archive: 'tar.xz',
      platforms: m.platforms || BOTH,
      homepage: 'https://freedict.org/',
      licenseUrl: m.licenseUrl,
      edition: m.edition,
      date: m.date,
      entries: m.entries,
      publisher: m.publisher,
    },
    m.sizeMB,
    {
      consent: () => consentText(name, 'download.freedict.org', t('settings.offline.consent.licence', { licence: m.license })),
      description: m.description,
    },
  );
}

/** X–English dictionaries that WikDict generates from Wiktionary (CC BY-SA 3.0 in every TEI header). */
function wikdict(code: string, language: string, sizeMB: number, entries: number): OfflineCatalogItem {
  return freedict(code, language, {
    edition: '2025.11.23',
    sizeMB,
    license: CC_BY_SA_3,
    licenseUrl: CC_BY_SA_3_URL,
    date: '2025-11-23',
    entries,
    description: () => t('settings.offline.desc.wikdict', { language: languageDisplayName(language) }),
    publisher: WIKDICT,
  });
}

/** Older FreeDict word lists under the GPL. */
function freedictGpl(
  code: string,
  language: string,
  edition: string,
  sizeMB: number,
  date: string,
  entries: number,
  license = GPL_2,
): OfflineCatalogItem {
  return freedict(code, language, {
    edition,
    sizeMB,
    license,
    licenseUrl: GPL_2_URL,
    date,
    entries,
    description: () => t('settings.offline.desc.freedict', { language: languageDisplayName(language) }),
    publisher: 'FreeDict',
  });
}

const desc = (key: MessageKey) => () => t(key);

const JMDICT_RELEASE =
  'https://github.com/scriptin/jmdict-simplified/releases/download/3.6.2%2B20261026175559';
const KENGDIC_COMMIT = '793de2369c9a98b944154eb4695d26854d2de59b';

export const OFFLINE_CATALOG: OfflineCatalogItem[] = [
  pack(
    {
      id: 'wordnet-3.1',
      name: 'Princeton WordNet 3.1',
      language: 'en',
      license: 'WordNet License (Princeton University)',
      urls: ['https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz'],
      format: 'wordnet',
      archive: 'tar.gz',
      platforms: BOTH,
      homepage: 'https://wordnet.princeton.edu/',
      licenseUrl: 'https://wordnet.princeton.edu/license-and-commercial-use',
      edition: '3.1',
      date: '2012-02-27',
      publisher: 'Princeton University',
    },
    16,
    {
      consent: () => consentText('Princeton WordNet 3.1', 'wordnetcode.princeton.edu', t('settings.offline.consent.wordnet')),
      description: desc('settings.offline.desc.wordnet'),
    },
  ),
  pack(
    {
      id: 'webster-1913',
      name: "Webster's Unabridged 1913 (GCIDE)",
      language: 'en',
      license: 'GPL-3+ (GNU GCIDE; 1913 Webster text is public domain)',
      urls: [
        'https://ftp.gnu.org/gnu/gcide/gcide-0.53.tar.gz',
        'https://mirrors.kernel.org/gnu/gcide/gcide-0.53.tar.gz',
      ],
      format: 'gcide',
      archive: 'tar.gz',
      platforms: BOTH,
      homepage: 'https://www.gnu.org/software/gcide/',
      licenseUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
      edition: '0.53',
      date: '2021-04-27',
      publisher: 'GNU Project',
    },
    18,
    {
      consent: () => consentText(t('settings.offline.consent.gcideName'), 'ftp.gnu.org', t('settings.offline.consent.gcide')),
      description: desc('settings.offline.desc.gcide'),
    },
  ),
  pack(
    {
      id: 'freedict-eng-zho',
      name: 'FreeDict English–Chinese',
      language: 'en',
      license: CC_BY_SA_3,
      urls: [`${FREEDICT}/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.src.tar.xz`],
      format: 'freedict-tei',
      archive: 'tar.xz',
      platforms: BOTH,
      homepage: 'https://freedict.org/',
      licenseUrl: CC_BY_SA_3_URL,
      edition: '2025.11.23',
      date: '2025-11-23',
      entries: 26660,
      publisher: WIKDICT,
    },
    1.6,
    {
      consent: () =>
        consentText(
          'FreeDict English–Chinese',
          'download.freedict.org',
          t('settings.offline.consent.headwords', { licence: CC_BY_SA_3, count: 27000 }),
        ),
      description: desc('settings.offline.desc.engZho'),
    },
  ),
  pack(
    {
      id: 'cc-cedict',
      name: 'CC-CEDICT',
      language: 'zh',
      license: 'Creative Commons Attribution-ShareAlike 4.0',
      urls: ['https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz'],
      format: 'cedict',
      archive: 'gz',
      platforms: BOTH,
      homepage: 'https://cc-cedict.org/wiki/',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      entries: 125000,
      entriesApprox: true,
      publisher: 'MDBG',
    },
    4,
    {
      consent: () =>
        consentText(
          'CC-CEDICT',
          'mdbg.net',
          t('settings.offline.consent.largeMinute', { licence: 'Creative Commons Attribution-ShareAlike 4.0' }),
          true,
        ),
      description: desc('settings.offline.desc.cedict'),
      edition: () => t('settings.offline.edition.daily'),
    },
  ),
  pack(
    {
      id: 'jmdict-eng',
      name: 'JMdict',
      language: 'ja',
      license: EDRDG,
      urls: [`${JMDICT_RELEASE}/jmdict-eng-3.6.2%2B20261026175559.json.tgz`],
      format: 'jmdict',
      archive: 'tar.gz',
      platforms: ['desktop'],
      homepage: 'https://www.edrdg.org/jmdict/j_jmdict.html',
      licenseUrl: EDRDG_URL,
      edition: '3.6.2',
      date: '2026-10-26',
      entries: 218963,
      publisher: 'Electronic Dictionary Research and Development Group',
    },
    12,
    {
      consent: () =>
        consentText(
          t('settings.offline.consent.jmdictName', { language: languageDisplayName('en') }),
          'github.com/scriptin/jmdict-simplified',
          t('settings.offline.consent.entriesMinutes', { licence: EDRDG_CONSENT, count: 219000 }),
        ),
      description: desc('settings.offline.desc.jmdict'),
    },
  ),
  pack(
    {
      id: 'jmdict-eng-common',
      name: 'JMdict (common words)',
      language: 'ja',
      license: EDRDG,
      urls: [`${JMDICT_RELEASE}/jmdict-eng-common-3.6.2%2B20261026175559.json.tgz`],
      format: 'jmdict',
      archive: 'tar.gz',
      platforms: ['phone'],
      homepage: 'https://www.edrdg.org/jmdict/j_jmdict.html',
      licenseUrl: EDRDG_URL,
      edition: '3.6.2',
      date: '2026-10-26',
      entries: 22649,
      publisher: 'Electronic Dictionary Research and Development Group',
    },
    1.4,
    {
      consent: () =>
        consentText(
          t('settings.offline.consent.jmdictCommonName', { language: languageDisplayName('en') }),
          'github.com/scriptin/jmdict-simplified',
          t('settings.offline.consent.entries', { licence: EDRDG_CONSENT, count: 23000 }),
        ),
      description: desc('settings.offline.desc.jmdictCommon'),
    },
  ),
  pack(
    {
      id: 'kengdic',
      name: 'Kengdic Korean–English',
      language: 'ko',
      license: 'MPL 2.0 or GNU LGPL 2.0 or later',
      urls: [`https://raw.githubusercontent.com/garfieldnate/kengdic/${KENGDIC_COMMIT}/kengdic.tsv`],
      format: 'kengdic',
      archive: 'plain',
      platforms: BOTH,
      homepage: 'https://github.com/garfieldnate/kengdic',
      licenseUrl: 'https://www.mozilla.org/MPL/2.0/',
      edition: KENGDIC_COMMIT.slice(0, 7),
      publisher: 'Joe Speigle',
    },
    3.4,
    {
      consent: () =>
        consentText(
          t('settings.offline.consent.kengdicName'),
          'github.com/garfieldnate/kengdic',
          t('settings.offline.consent.words', { licence: 'Mozilla Public License 2.0 or GNU LGPL 2.0 or later', count: 109000 }),
        ),
      description: desc('settings.offline.desc.kengdic'),
    },
  ),
  // German is 450 MB once unpacked: desktop only.
  freedict('deu', 'de', {
    edition: '1.9-fd1',
    sizeMB: 18,
    license: 'GNU GPL 3.0 and GNU AGPL 3.0 (Ding by Frank Richter)',
    licenseUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    date: '2022-04-15',
    entries: 517534,
    description: desc('settings.offline.desc.ding'),
    publisher: 'Frank Richter (Ding)',
    platforms: ['desktop'],
  }),
  freedictGpl('fra', 'fr', '0.4.1', 0.21, '2018-08-11', 8505),
  wikdict('ita', 'it', 1.2, 29660),
  freedictGpl('por', 'pt', '0.2', 0.195, '2017-12-09', 10661),
  freedictGpl('nld', 'nl', '0.2', 0.43, '2017-12-06', 22747),
  wikdict('pol', 'pl', 1.9, 42088),
  wikdict('rus', 'ru', 1.2, 42600),
  wikdict('ell', 'el', 0.85, 41714),
  wikdict('fin', 'fi', 1.7, 42060),
  freedictGpl('hun', 'hu', '0.4.1', 2, '2017-12-06', 139935, 'GNU GPL 2.0'),
  wikdict('cat', 'ca', 0.775, 23590),
  freedictGpl('hrv', 'hr', '0.1.2', 1, '2017-12-05', 79808),
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
