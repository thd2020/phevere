/**
 * Settings → About, desktop and phone: the app's name, icon and version (read at run time by
 * each host and passed in), an invitation to star the repository, links to the changelog, issue
 * tracker, privacy policy, licence and author, and the credits every bundled or fetched work
 * needs (CC BY-SA asks for the work's name, a link to it and a link to the licence).
 *
 * Strings: the `settings.about.*` keys of the interface catalogue (i18n/en/settings.ts). Names of
 * works, people and licences (Wiktionary, CC BY-SA 4.0) stay as their owners write them.
 * Styles: settings-kit.css and settings-about.css.
 * Hooks: links carry data-act="about-link" and data-url (the phone opens them in the system
 * browser; the desktop routes every target=_blank link there already); the Copy button carries
 * data-act="about-copy" and data-copy with the version text.
 */
import { esc, SVG } from './settings-kit';
import { hasMessage, t, type MessageKey } from './i18n/runtime';

export const REPO_URL = 'https://github.com/thd2020/phevere';
export const AUTHOR = { name: 'thd2020', url: 'https://github.com/thd2020' };
export const PRIVACY_URL = 'https://holarky-api.thdfreelancer.workers.dev/privacy';
export const APP_LICENCE = { name: 'MIT', url: `${REPO_URL}/blob/main/LICENSE` };

export type AboutPlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web';

export interface AboutInfo {
  /** Installed version as the platform reports it; empty when the build has none. */
  version: string;
  /** Build number where the platform has one (Android's version code). */
  build?: string;
  platform: AboutPlatform;
  /** The system as a person would name it in a bug report, such as "Windows 11 x64". */
  system?: string;
}

const DESKTOP: AboutPlatform[] = ['windows', 'macos', 'linux'];
const NATIVE: AboutPlatform[] = [...DESKTOP, 'android', 'ios'];

const CC_BY_SA_4 = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };

export interface AboutCredit {
  id: string;
  name: string;
  /** A generic name to show translated instead of `name` (the fonts row). */
  nameKey?: MessageKey;
  url: string;
  /** Licence name and its text; leave out url where there is no single text to link. */
  licence?: { name: string; url?: string };
  /** A licence line from the catalogue (`settings.about.perFile`, `.perPack`) instead of a licence name. */
  licenceText?: 'perFile' | 'perPack';
  /** Only on these platforms; everywhere when left out. */
  on?: AboutPlatform[];
  group: 'data' | 'software';
}

export const ABOUT_CREDITS: AboutCredit[] = [
  { id: 'wiktionary', name: 'Wiktionary', url: 'https://www.wiktionary.org/', licence: CC_BY_SA_4, group: 'data' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org/', licence: CC_BY_SA_4, group: 'data' },
  { id: 'commons', name: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/', licenceText: 'perFile', group: 'data' },
  { id: 'wikidata', name: 'Wikidata', url: 'https://www.wikidata.org/', licence: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }, group: 'data' },
  { id: 'jmdict', name: 'JMdict (EDRDG)', url: 'https://www.edrdg.org/jmdict/j_jmdict.html', licence: { name: 'CC BY-SA 4.0', url: 'https://www.edrdg.org/edrdg/licence.html' }, group: 'data' },
  { id: 'openrussian', name: 'OpenRussian', url: 'https://en.openrussian.org/', licence: CC_BY_SA_4, group: 'data' },
  { id: 'tatoeba', name: 'Tatoeba', url: 'https://tatoeba.org/', licence: { name: 'CC BY 2.0 FR', url: 'https://creativecommons.org/licenses/by/2.0/fr/' }, group: 'data' },
  { id: 'cedict', name: 'CC-CEDICT', url: 'https://cc-cedict.org/wiki/', licence: CC_BY_SA_4, group: 'data' },
  { id: 'wordnet', name: 'Princeton WordNet', url: 'https://wordnet.princeton.edu/', licence: { name: 'WordNet License', url: 'https://wordnet.princeton.edu/license-and-commercial-use' }, group: 'data' },
  { id: 'gcide', name: 'GNU GCIDE', url: 'https://gcide.gnu.org.ua/', licence: { name: 'GPL 3.0 or later', url: 'https://www.gnu.org/licenses/gpl-3.0.html' }, group: 'data' },
  { id: 'freedict', name: 'FreeDict and WikDict', url: 'https://freedict.org/', licenceText: 'perPack', group: 'data' },
  { id: 'kengdic', name: 'Kengdic', url: 'https://github.com/garfieldnate/kengdic', licence: { name: 'MPL 2.0', url: 'https://www.mozilla.org/MPL/2.0/' }, group: 'data' },
  { id: 'etymonline', name: 'Online Etymology Dictionary', url: 'https://www.etymonline.com/', licence: { name: '© Douglas Harper' }, group: 'data' },
  { id: 'ngsl', name: 'NGSL (Browne, Culligan and Phillips)', url: 'https://www.newgeneralservicelist.com/', licence: CC_BY_SA_4, group: 'data' },
  { id: 'ecdict', name: 'ECDICT', url: 'https://github.com/skywind3000/ECDICT', licence: { name: 'MIT', url: 'https://github.com/skywind3000/ECDICT/blob/master/LICENSE' }, group: 'data' },
  { id: 'cmudict', name: 'CMU Pronouncing Dictionary', url: 'https://github.com/cmusphinx/cmudict', licence: { name: 'BSD 2-Clause', url: 'https://github.com/cmusphinx/cmudict/blob/master/LICENSE' }, group: 'data' },
  { id: 'espeak', name: 'eSpeak NG', url: 'https://github.com/espeak-ng/espeak-ng', licence: { name: 'GPL 3.0 or later', url: 'https://www.gnu.org/licenses/gpl-3.0.html' }, on: NATIVE, group: 'software' },
  { id: 'kokoro', name: 'Kokoro', url: 'https://huggingface.co/hexgrad/Kokoro-82M', licence: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' }, on: NATIVE, group: 'software' },
  { id: 'sherpa', name: 'sherpa-onnx', url: 'https://github.com/k2-fsa/sherpa-onnx', licence: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' }, on: NATIVE, group: 'software' },
  { id: 'ppocr', name: 'PaddleOCR and RapidOCR', url: 'https://github.com/RapidAI/RapidOCR', licence: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' }, on: DESKTOP, group: 'software' },
  { id: 'fonts', name: 'Fonts', nameKey: 'settings.about.fontsName', url: 'https://fontsource.org/', licence: { name: 'SIL OFL 1.1', url: 'https://openfontlicense.org/' }, group: 'software' },
];

/** Services Phevere calls under their own terms, with no open licence to credit. */
export const ABOUT_SERVICES: Array<{ name: string; url: string }> = [
  { name: 'Google Translate', url: 'https://translate.google.com/' },
  { name: 'MyMemory', url: 'https://mymemory.translated.net/' },
  { name: 'DeepL', url: 'https://www.deepl.com/' },
  { name: 'Youdao', url: 'https://ai.youdao.com/' },
  { name: 'Datamuse', url: 'https://www.datamuse.com/api/' },
  { name: 'Oxford', url: 'https://developer.oxforddictionaries.com/' },
  { name: 'Collins', url: 'https://www.collinsdictionary.com/' },
  { name: 'WordsAPI', url: 'https://www.wordsapi.com/' },
];

const ICON = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};

/** The Phevere mark, as in the desktop Settings title bar, with ids of its own. */
const APP_ICON = `<svg viewBox="0 0 1024 1024" focusable="false" aria-hidden="true">
  <defs><mask id="pvAboutTwin" maskUnits="userSpaceOnUse" x="-40" y="-10" width="180" height="130">
    <path d="M30 55 C34 48 43 45 51 45 C63 45 71 53 71 64 C71 76 63 84 51 84 C43 84 35 81 30 75" stroke="#fff" stroke-width="12" fill="none"/>
    <polygon points="24,51 36,45 36,106 24,106" fill="#000"/>
  </mask></defs>
  <rect width="1024" height="1024" rx="228" fill="#F2EFE9"/>
  <rect x="1.5" y="1.5" width="1021" height="1021" rx="226.5" fill="none" stroke="#5E3A8C" stroke-opacity="0.12" stroke-width="3"/>
  <g transform="scale(8.53333) translate(10 10) translate(50 50) scale(1.1) translate(-46 -72.5) translate(14 0) skewX(-12)">
    <rect x="-40" y="-10" width="180" height="130" fill="#2A9D84" mask="url(#pvAboutTwin)"/>
    <polygon points="24,51 36,45 36,106 24,106" fill="#5E3A8C"/>
  </g>
</svg>`;

export function aboutVersionLabel(info: AboutInfo): string {
  if (!info.version) return t('settings.about.versionUnknown');
  return info.build
    ? t('settings.about.versionBuild', { version: info.version, build: info.build })
    : t('settings.about.version', { version: info.version });
}

/**
 * What a credited work provides, from `settings.about.provides.<id>`; a platform's own line
 * (`<id><Platform>`, as espeakIos) wins over the general one.
 */
export function aboutProvides(id: string, platform?: AboutPlatform): string {
  const own = platform ? `settings.about.provides.${id}${platform[0].toUpperCase()}${platform.slice(1)}` : '';
  if (own && hasMessage(own)) return t(own);
  const key = `settings.about.provides.${id}`;
  return hasMessage(key) ? t(key) : '';
}

/** What Copy puts on the clipboard and what a new issue starts with. */
export function aboutVersionText(info: AboutInfo): string {
  const version = info.version ? ` ${info.version}${info.build ? ` (${info.build})` : ''}` : '';
  return [`Phevere${version}`, info.system].filter(Boolean).join('\n');
}

export function aboutIssueUrl(info: AboutInfo): string {
  const body = `${t('settings.about.issueIntro')}\n\n\n\n---\n${aboutVersionText(info)}`;
  return `${REPO_URL}/issues/new?body=${encodeURIComponent(body)}`;
}

/** "Android 14" or "iOS 17.2" from a phone WebView's user agent; empty for anything else. */
export function systemFromUserAgent(ua: string): string {
  const android = /Android\s+([\d.]+)/.exec(ua);
  if (android) return `Android ${android[1]}`;
  const ios = /(?:iPhone|iPad|CPU) OS (\d+(?:_\d+)*)/.exec(ua);
  if (ios) return `iOS ${ios[1].replace(/_/g, '.')}`;
  return '';
}

export function aboutCredits(platform: AboutPlatform): AboutCredit[] {
  return ABOUT_CREDITS.filter((c) => !c.on || c.on.includes(platform));
}

function linkAttrs(url: string): string {
  return `href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="about-link" data-url="${esc(url)}"`;
}

function linkRow(label: string, url: string, value?: string): string {
  return `<a class="sv-nav sv-about__link" ${linkAttrs(url)}>
    <span class="sv-row__text"><span class="sv-row__label">${esc(label)}</span></span>
    ${value ? `<span class="sv-about__value">${esc(value)}</span>` : ''}
    <span class="sv-nav__chev" aria-hidden="true">${SVG.out}</span>
  </a>`;
}

const LICENCE_TEXT = { perFile: 'settings.about.perFile', perPack: 'settings.about.perPack' } as const;

function creditRow(c: AboutCredit, platform: AboutPlatform): string {
  const licence = c.licence
    ? c.licence.url
      ? `<a class="sv-link" ${linkAttrs(c.licence.url)}>${esc(c.licence.name)}</a>`
      : `<span class="sv-about__licence">${esc(c.licence.name)}</span>`
    : c.licenceText
      ? `<span class="sv-about__licence">${esc(t(LICENCE_TEXT[c.licenceText]))}</span>`
      : '';
  return `<div class="sv-row sv-about__credit">
    <span class="sv-row__text">
      <a class="sv-about__name" ${linkAttrs(c.url)}>${esc(c.nameKey ? t(c.nameKey) : c.name)}</a>
      <span class="sv-row__sub">${esc(aboutProvides(c.id, platform))}</span>
      <span class="sv-about__end">${licence}</span>
    </span>
  </div>`;
}

function servicesRow(): string {
  const names = ABOUT_SERVICES.map((s) => `<a class="sv-about__service" ${linkAttrs(s.url)}>${esc(s.name)}</a>`).join(', ');
  return `<div class="sv-row sv-about__credit">
    <span class="sv-row__text">
      <span class="sv-about__name">${esc(t('settings.about.servicesName'))}</span>
      <span class="sv-row__sub">${names}</span>
      <span class="sv-about__end"><span class="sv-about__licence">${esc(t('settings.about.servicesSub'))}</span></span>
    </span>
  </div>`;
}

/** `updates`: the platform's Updates rows, shown under the version when it has an updater. */
export function aboutSettingsHtml(info: AboutInfo, updates = ''): string {
  const credits = aboutCredits(info.platform);
  const data = credits.filter((c) => c.group === 'data').map((c) => creditRow(c, info.platform)).join('') + servicesRow();
  const software = credits.filter((c) => c.group === 'software').map((c) => creditRow(c, info.platform)).join('');
  const copy = aboutVersionText(info);
  return `<div class="sv sv-page sv-about">
    <div class="sv-about__hero">
      <span class="sv-about__icon">${APP_ICON}</span>
      <span class="sv-about__title">
        <span class="sv-about__name-big">Phevere</span>
        <span class="sv-about__version" id="about-version">${esc(aboutVersionLabel(info))}</span>
      </span>
      <button type="button" class="sv-btn" data-act="about-copy" data-copy="${esc(copy)}" data-copied="${esc(t('common.copied'))}" aria-describedby="about-version">${ICON.copy}<span>${esc(t('common.copy'))}</span></button>
    </div>
    ${updates}
    <div class="sv-ledger sv-about__star">
      <div class="sv-row">
        <span class="sv-row__text"><span class="sv-row__label">${esc(t('settings.about.starTitle'))}</span><span class="sv-row__sub">${esc(t('settings.about.starSub'))}</span></span>
        <a class="sv-btn sv-btn--accent" ${linkAttrs(REPO_URL)}>${ICON.star}<span>${esc(t('settings.about.star'))}</span></a>
      </div>
    </div>
    <div class="sv-ledger">
      ${linkRow(t('settings.about.sourceCode'), REPO_URL, 'GitHub')}
      ${linkRow(t('settings.about.whatsNew'), `${REPO_URL}/blob/main/CHANGELOG.md`)}
      ${linkRow(t('settings.about.reportProblem'), aboutIssueUrl(info))}
      ${linkRow(t('settings.about.privacy'), PRIVACY_URL)}
      ${linkRow(t('settings.about.licence'), APP_LICENCE.url, APP_LICENCE.name)}
      ${linkRow(t('settings.about.author'), AUTHOR.url, AUTHOR.name)}
    </div>
    <header class="sv-head"><h3 class="sv-head__title">${esc(t('settings.about.dataHead'))}</h3></header>
    <div class="sv-ledger">${data}</div>
    <header class="sv-head"><h3 class="sv-head__title">${esc(t('settings.about.softwareHead'))}</h3></header>
    <div class="sv-ledger">${software}</div>
  </div>`;
}

/** After Copy: the button reads "Copied" for a moment. */
export function flashAboutCopied(button: HTMLElement): void {
  const label = button.querySelector('span');
  if (!label || button.classList.contains('is-done')) return;
  const before = label.textContent || '';
  label.textContent = button.dataset.copied || before;
  button.classList.add('is-done');
  window.setTimeout(() => {
    label.textContent = before;
    button.classList.remove('is-done');
  }, 1600);
}
