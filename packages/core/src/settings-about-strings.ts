/**
 * Every string a person reads on Settings → About, desktop and phone, in one object so a
 * translation is one more object of the same shape (`AboutStrings`). Names of works, people and
 * licences (Wiktionary, CC BY-SA 4.0) are not here: they stay as their owners write them.
 * `{version}`, `{build}` and `{name}` are filled in by settings-about.ts.
 */
export interface AboutStrings {
  version: string;
  versionBuild: string;
  versionUnknown: string;
  copy: string;
  copied: string;
  starTitle: string;
  starSub: string;
  star: string;
  sourceCode: string;
  whatsNew: string;
  reportProblem: string;
  privacy: string;
  licence: string;
  author: string;
  dataHead: string;
  softwareHead: string;
  servicesName: string;
  servicesSub: string;
  perFile: string;
  perPack: string;
  /** What each credited work provides, keyed by its id in ABOUT_CREDITS. */
  provides: Record<string, string>;
  /** The issue body's first line; the version text follows it. */
  issueIntro: string;
}

export const ABOUT_STRINGS_EN: AboutStrings = {
  version: 'Version {version}',
  versionBuild: 'Version {version} ({build})',
  versionUnknown: 'Development build',
  copy: 'Copy',
  copied: 'Copied',
  starTitle: 'Like Phevere?',
  starSub: 'A star on GitHub helps other people find it.',
  star: 'Star on GitHub',
  sourceCode: 'Source code',
  whatsNew: 'What’s new',
  reportProblem: 'Report a problem',
  privacy: 'Privacy policy',
  licence: 'Licence',
  author: 'Author',
  dataHead: 'Data sources',
  softwareHead: 'Software and fonts',
  servicesName: 'Online services',
  servicesSub: 'Used under each service’s terms',
  perFile: 'Licence shown with each file',
  perPack: 'Licence shown with each pack',
  provides: {
    wiktionary: 'Definitions, pronunciation, word history and word families, also through Free Dictionary API and Kaikki',
    wikipedia: 'Article summaries',
    commons: 'Pictures and recorded pronunciations',
    wikidata: 'Links from senses to pictures',
    jmdict: 'Japanese entries, online through Jisho and offline',
    openrussian: 'Russian stress, forms and translations',
    tatoeba: 'Example sentences and their translations',
    cedict: 'Chinese entries, offline',
    wordnet: 'Sense order, and an offline dictionary',
    gcide: 'Webster’s 1913 dictionary, offline',
    freedict: 'Bilingual dictionaries, offline',
    kengdic: 'Korean entries, offline',
    etymonline: 'Word history',
    ngsl: 'Starter, General, Academic, TOEIC and Business English word books',
    ecdict: '中考, 高考, CET-4, CET-6 and 考研 word books',
    cmudict: 'American pronunciation',
    espeak: 'Mechanical voice',
    kokoro: 'Neural voices',
    sherpa: 'Speech engine',
    ppocr: 'Text recognition in images',
    fonts: 'Outfit, Source Serif 4, Charis SIL and IBM Plex Mono',
  },
  issueIntro: 'What happened, and what did you expect?',
};
