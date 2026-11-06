/**
 * Settings → Offline: a shelf per headword language, catalogue cards and the pack inspector.
 * Shared by the desktop Settings window and the phone's Settings tab; each app
 * wires the `data-act` attributes. Styles: settings-offline.css.
 */

import { formatDate, formatMegabytes, formatNumber, languageDisplayName, t, tHtml, type MessageKey } from './i18n/runtime';
import type { CatalogLanguageGroup, OfflineCatalogItem } from './offline-catalog';
import { esc, linkHtml, SVG } from './settings-kit';

export type ShelfHue = 'rust' | 'teal' | 'ochre';

/** A language's traits as a shelf shows them, in the interface language. */
export interface LanguageTraits {
  /** The language's name in its own script. */
  endonym: string;
  /** Large glyphs set behind the heading. */
  sample: string;
  script: string;
  /** A line about the alphabet or writing system. */
  detail?: string;
  hue: ShelfHue;
}

export type ScriptId = 'latin' | 'han' | 'kanjiKana' | 'hangul' | 'greek' | 'cyrillic' | 'arabic' | 'hebrew' | 'devanagari' | 'thai';

/** The alphabet or writing system: its size, the letters that set it apart, or a note from the catalogue. */
export interface ScriptDetail {
  letters?: number;
  /** Letters shown as they are written. */
  chars?: string;
  note?: 'zh' | 'ja' | 'ko' | 'rtl' | 'toneMarks';
}

export interface LanguageTraitData {
  endonym: string;
  sample: string;
  script: ScriptId;
  detail?: ScriptDetail;
  hue: ShelfHue;
}

const RTL: ScriptDetail = { note: 'rtl' };

/** Every headword language in the catalog, plus the ones an imported pack may carry. */
export const LANGUAGE_TRAITS: Record<string, LanguageTraitData> = {
  en: { endonym: 'English', sample: 'Aa', script: 'latin', detail: { letters: 26 }, hue: 'rust' },
  zh: { endonym: '中文', sample: '漢字', script: 'han', detail: { note: 'zh' }, hue: 'teal' },
  ja: { endonym: '日本語', sample: 'かな', script: 'kanjiKana', detail: { note: 'ja' }, hue: 'ochre' },
  ko: { endonym: '한국어', sample: '한글', script: 'hangul', detail: { note: 'ko' }, hue: 'rust' },
  ca: { endonym: 'Català', sample: 'Çà', script: 'latin', detail: { chars: 'à ç è é í ï ò ó ú ü' }, hue: 'teal' },
  hr: { endonym: 'Hrvatski', sample: 'Čč', script: 'latin', detail: { letters: 30, chars: 'č ć đ š ž' }, hue: 'ochre' },
  nl: { endonym: 'Nederlands', sample: 'IJ', script: 'latin', detail: { chars: 'ij, ë, é' }, hue: 'rust' },
  fi: { endonym: 'Suomi', sample: 'Ää', script: 'latin', detail: { chars: 'ä ö å' }, hue: 'teal' },
  fr: { endonym: 'Français', sample: 'Çç', script: 'latin', detail: { chars: 'é è ê à ç œ' }, hue: 'ochre' },
  de: { endonym: 'Deutsch', sample: 'ß', script: 'latin', detail: { chars: 'ä ö ü ß' }, hue: 'rust' },
  el: { endonym: 'Ελληνικά', sample: 'Ωω', script: 'greek', detail: { letters: 24 }, hue: 'teal' },
  hu: { endonym: 'Magyar', sample: 'Őő', script: 'latin', detail: { letters: 44, chars: 'ő ű' }, hue: 'ochre' },
  it: { endonym: 'Italiano', sample: 'Èè', script: 'latin', detail: { chars: 'à è é ì ò ù' }, hue: 'rust' },
  pl: { endonym: 'Polski', sample: 'Łł', script: 'latin', detail: { letters: 32, chars: 'ą ę ł ż' }, hue: 'teal' },
  pt: { endonym: 'Português', sample: 'Ãã', script: 'latin', detail: { chars: 'ã õ ç á ê' }, hue: 'ochre' },
  ru: { endonym: 'Русский', sample: 'Жж', script: 'cyrillic', detail: { letters: 33 }, hue: 'rust' },
  es: { endonym: 'Español', sample: 'Ññ', script: 'latin', detail: { letters: 27, chars: 'ñ' }, hue: 'teal' },
  uk: { endonym: 'Українська', sample: 'Її', script: 'cyrillic', detail: { letters: 33 }, hue: 'ochre' },
  cs: { endonym: 'Čeština', sample: 'Řř', script: 'latin', detail: { chars: 'ř ě š č ů' }, hue: 'rust' },
  sv: { endonym: 'Svenska', sample: 'Åå', script: 'latin', detail: { chars: 'å ä ö' }, hue: 'teal' },
  da: { endonym: 'Dansk', sample: 'Øø', script: 'latin', detail: { chars: 'æ ø å' }, hue: 'ochre' },
  nb: { endonym: 'Norsk bokmål', sample: 'Ææ', script: 'latin', detail: { chars: 'æ ø å' }, hue: 'rust' },
  tr: { endonym: 'Türkçe', sample: 'Ğğ', script: 'latin', detail: { chars: 'ç ğ ı ö ş ü' }, hue: 'teal' },
  ar: { endonym: 'العربية', sample: 'ض', script: 'arabic', detail: RTL, hue: 'ochre' },
  he: { endonym: 'עברית', sample: 'אב', script: 'hebrew', detail: RTL, hue: 'rust' },
  fa: { endonym: 'فارسی', sample: 'گ', script: 'arabic', detail: RTL, hue: 'teal' },
  hi: { endonym: 'हिन्दी', sample: 'अ', script: 'devanagari', hue: 'ochre' },
  th: { endonym: 'ไทย', sample: 'ก', script: 'thai', hue: 'rust' },
  vi: { endonym: 'Tiếng Việt', sample: 'Ơơ', script: 'latin', detail: { note: 'toneMarks' }, hue: 'teal' },
  id: { endonym: 'Bahasa Indonesia', sample: 'Aa', script: 'latin', hue: 'ochre' },
  ro: { endonym: 'Română', sample: 'Șș', script: 'latin', detail: { chars: 'ă â î ș ț' }, hue: 'rust' },
  la: { endonym: 'Latina', sample: 'Æ', script: 'latin', hue: 'teal' },
  eo: { endonym: 'Esperanto', sample: 'Ĉĉ', script: 'latin', detail: { chars: 'ĉ ĝ ĥ ĵ ŝ ŭ' }, hue: 'ochre' },
};

const NOTE_KEY: Record<NonNullable<ScriptDetail['note']>, MessageKey> = {
  zh: 'settings.offline.trait.zh',
  ja: 'settings.offline.trait.ja',
  ko: 'settings.offline.trait.ko',
  rtl: 'settings.offline.trait.rtl',
  toneMarks: 'settings.offline.trait.toneMarks',
};

function detailText(d: ScriptDetail | undefined): string | undefined {
  if (!d) return undefined;
  if (d.note) return t(NOTE_KEY[d.note]);
  if (d.letters && d.chars) return t('settings.offline.lettersWith', { count: d.letters, letters: d.chars });
  if (d.letters) return t('settings.offline.letters', { count: d.letters });
  return d.chars;
}

export function languageTraits(code: string): LanguageTraits {
  const data = LANGUAGE_TRAITS[(code || '').toLowerCase()];
  if (!data) {
    const name = languageDisplayName(code);
    return { endonym: name, sample: (name || '?').slice(0, 2), script: '', hue: 'teal' };
  }
  return { endonym: data.endonym, sample: data.sample, script: t(`settings.offline.script.${data.script}`), detail: detailText(data.detail), hue: data.hue };
}

/** A catalog pack with its install state, or a pack imported from a file. */
export type PackView = Partial<OfflineCatalogItem> & {
  id: string;
  name: string;
  language: string;
  installed: boolean;
  entryCount: number;
  /** Imported from a file rather than downloaded from the catalog. */
  imported?: boolean;
  /** Install time, epoch ms. */
  createdAt?: number;
  /** File or URL it was imported from. */
  source?: string;
};

export interface PackProgress {
  id: string;
  /** 0–1, or null while the step has no measurable size. */
  fraction: number | null;
  label: string;
}

export interface PackDetails {
  /** Bytes the pack's rows take in the database. */
  installedBytes?: number;
  /** Where installed packs live. */
  storedAt?: string;
}

/** A size in bytes as the interface language writes it ("512 B", "3.4 kB", "12 MB"). */
export function formatBytes(n: number): string {
  const unit = (value: number, u: 'byte' | 'kilobyte', digits = 0) =>
    formatNumber(value, { style: 'unit', unit: u, unitDisplay: u === 'byte' ? 'narrow' : 'short', maximumFractionDigits: digits });
  if (!Number.isFinite(n) || n <= 0) return unit(0, 'byte');
  if (n < 1024) return unit(n, 'byte');
  if (n < 1024 * 1024) return unit(n / 1024, 'kilobyte', n < 10 * 1024 ? 1 : 0);
  return formatMegabytes(n / (1024 * 1024), n < 10 * 1024 * 1024 ? 1 : 0);
}

function publishedEntries(p: PackView): string {
  if (!p.entries) return '';
  return t(p.entriesApprox ? 'settings.offline.entriesAbout' : 'settings.offline.entries', { count: p.entries });
}

function cardMeta(p: PackView, progress: PackProgress | null): string {
  if (progress) return progress.label;
  if (p.installed) return t('settings.offline.entries', { count: p.entryCount });
  const entries = p.entries ? t(p.entriesApprox ? 'settings.offline.entriesApproxShort' : 'settings.offline.entries', { count: p.entries }) : '';
  return [p.sizeHint, entries].filter(Boolean).join(' · ');
}

interface Spine {
  variant: 'net' | 'gilt' | 'stripe' | 'seal' | 'vertical' | 'hangul' | 'plain';
  mark: string;
  call: string;
}

/** Each pack's spine: its own mark and pattern, so two packs never look alike. */
function spineFor(p: PackView): Spine {
  const id = p.id;
  if (p.imported) return { variant: 'plain', mark: (p.name || '?').slice(0, 1).toUpperCase(), call: p.language.toUpperCase() };
  if (p.format === 'wordnet') return { variant: 'net', mark: 'WN', call: p.edition || '' };
  if (p.format === 'gcide') return { variant: 'gilt', mark: '1913', call: 'GCIDE' };
  if (p.format === 'cedict') return { variant: 'seal', mark: '典', call: 'CEDICT' };
  if (p.format === 'jmdict') return { variant: 'vertical', mark: id.includes('common') ? '常用' : '辞書', call: 'JMdict' };
  if (p.format === 'kengdic') return { variant: 'hangul', mark: '사전', call: 'KENG' };
  const pair = id.match(/^freedict-([a-z]{3})-([a-z]{3})$/);
  if (pair) return { variant: 'stripe', mark: pair[1].toUpperCase(), call: pair[2].toUpperCase() };
  return { variant: 'plain', mark: (p.name || '?').slice(0, 1), call: p.language.toUpperCase() };
}

/** Stable small number from the pack id, used to vary stripe angles and band positions. */
function seed(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function spineHtml(p: PackView, small = false): string {
  const s = spineFor(p);
  const n = seed(p.id);
  return `<span class="sv-spine sv-spine--${s.variant}${small ? ' sv-spine--small' : ''}" style="--sv-angle:${30 + (n % 5) * 15}deg;--sv-band:${18 + (n % 4) * 6}%" aria-hidden="true">
    <span class="sv-spine__mark">${esc(s.mark)}</span>
    <span class="sv-spine__call">${esc(s.call)}</span>
  </span>`;
}

function progressBar(progress: PackProgress | null): string {
  if (!progress) return '';
  const pct = progress.fraction == null ? null : Math.round(Math.max(0, Math.min(1, progress.fraction)) * 100);
  return `<span class="sv-progress${pct == null ? ' is-indeterminate' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100"${pct == null ? '' : ` aria-valuenow="${pct}"`} aria-label="${esc(progress.label)}"><span style="${pct == null ? '' : `width:${pct}%`}"></span></span>`;
}

function packActionHtml(p: PackView, progress: PackProgress | null, busy: boolean): string {
  if (progress) return '<span class="sv-pack__busy" aria-hidden="true"></span>';
  if (p.installed) {
    return `<button type="button" class="sv-icon" data-act="pack-rm" data-id="${esc(p.id)}" title="${tHtml('common.remove')}" aria-label="${tHtml('settings.offline.removeNamed', { name: p.name })}">${SVG.trash}</button>`;
  }
  return `<button type="button" class="sv-icon sv-icon--accent" data-act="pack-dl" data-id="${esc(p.id)}" title="${tHtml('common.download')}" aria-label="${tHtml('settings.offline.downloadNamed', { name: p.name })}"${busy ? ' disabled' : ''}>${SVG.download}</button>`;
}

export function packCardHtml(p: PackView, progress: PackProgress | null = null, busy = false): string {
  return `<article class="sv-pack${p.installed ? ' is-installed' : ''}${progress ? ' is-busy' : ''}" data-id="${esc(p.id)}">
    <button type="button" class="sv-pack__open" data-act="pack-open" data-id="${esc(p.id)}" aria-label="${tHtml('settings.offline.details', { name: p.name })}">
      ${spineHtml(p)}
      <span class="sv-pack__body">
        <span class="sv-pack__name">${esc(p.name)}</span>
        <span class="sv-pack__meta">${p.installed && !progress ? `<span class="sv-pack__tick">${SVG.check}</span>` : ''}${esc(cardMeta(p, progress))}</span>
      </span>
    </button>
    <span class="sv-pack__act">${packActionHtml(p, progress, busy)}</span>
    ${progressBar(progress)}
  </article>`;
}

export interface OfflineShelvesInput {
  groups: Array<CatalogLanguageGroup<PackView>>;
  progress?: PackProgress | null;
}

/** One block per headword language: tinted band, the language in its own script, script traits, and its packs. */
export function offlineShelvesHtml(input: OfflineShelvesInput): string {
  const progress = input.progress || null;
  return `<div class="sv sv-offline">${input.groups
    .map((g) => {
      const traits = languageTraits(g.language);
      const installed = g.items.filter((p) => p.installed).length;
      const shown = languageDisplayName(g.language);
      const lines = [shown !== traits.endonym ? shown : '', traits.script, traits.detail].filter(Boolean);
      const count = installed
        ? t('settings.offline.shelfPacksInstalled', { count: g.items.length, installed })
        : t('settings.offline.shelfPacks', { count: g.items.length });
      return `<section class="sv-shelf sv-hue-${traits.hue}" data-lang="${esc(g.language)}">
        <header class="sv-shelf__band">
          <span class="sv-shelf__sample" lang="${esc(g.language)}" aria-hidden="true">${esc(traits.sample)}</span>
          <h3 class="sv-shelf__name" lang="${esc(g.language)}">${esc(traits.endonym)}</h3>
          <p class="sv-shelf__traits">${lines.map((x) => `<span>${esc(x)}</span>`).join('')}</p>
          <span class="sv-shelf__count">${esc(count)}</span>
        </header>
        <div class="sv-shelf__packs">${g.items
          .map((p) => packCardHtml(p, progress && progress.id === p.id ? progress : null, !!progress))
          .join('')}</div>
      </section>`;
    })
    .join('')}</div>`;
}

function metaRow(label: string, value: string): string {
  return value ? `<div class="sv-meta__row"><dt>${esc(label)}</dt><dd>${value}</dd></div>` : '';
}

function packDate(iso: string | undefined): string {
  if (!iso) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return esc(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  return esc(formatDate(d, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
}

/** Inspector drawer: description and every known fact about one pack, with its action. */
export function packInspectorHtml(
  p: PackView,
  details: PackDetails = {},
  progress: PackProgress | null = null,
  busy = false,
  /** First paint after opening: the drawer slides in. Repaints pass false and stay still. */
  entering = true,
): string {
  const traits = languageTraits(p.language);
  const installedAt = p.installed && p.createdAt ? formatDate(p.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const published = p.entries
    ? t(p.entriesApprox ? 'settings.offline.entriesPublishedAbout' : 'settings.offline.entriesPublished', { count: p.entries })
    : '';
  const rows = [
    metaRow(t('settings.offline.meta.language'), esc(languageDisplayName(p.language))),
    metaRow(
      t('settings.offline.meta.entries'),
      p.installed
        ? esc(t('settings.offline.entriesInstalled', { count: p.entryCount })) + (published ? `<small>${esc(published)}</small>` : '')
        : esc(publishedEntries(p)),
    ),
    metaRow(t('settings.offline.meta.download'), esc(p.sizeHint || '')),
    metaRow(t('settings.offline.meta.installedSize'), p.installed && details.installedBytes ? esc(formatBytes(details.installedBytes)) : ''),
    metaRow(t('settings.offline.meta.edition'), esc(p.edition || '')),
    metaRow(t('settings.offline.meta.date'), packDate(p.date)),
    metaRow(t('settings.offline.meta.publisher'), esc(p.publisher || '')),
    metaRow(t('settings.offline.meta.licence'), p.license ? (p.licenseUrl ? linkHtml(p.licenseUrl, p.license) : esc(p.license)) : ''),
    metaRow(t('settings.offline.meta.source'), p.urls?.[0] ? linkHtml(p.urls[0]) : p.source ? esc(p.source) : ''),
    metaRow(t('settings.offline.meta.homepage'), linkHtml(p.homepage)),
    metaRow(t('settings.offline.meta.installedOn'), esc(installedAt)),
    metaRow(t('settings.offline.meta.storedIn'), p.installed && details.storedAt ? `<code>${esc(details.storedAt)}</code>` : ''),
  ].join('');
  const action = progress
    ? `<div class="sv-inspector__progress"><span>${esc(progress.label)}</span>${progressBar(progress)}</div>`
    : p.installed
      ? `<button type="button" class="sv-btn sv-btn--quiet" data-act="pack-rm" data-id="${esc(p.id)}">${SVG.trash}${tHtml('common.remove')}</button>`
      : p.urls?.length
        ? `<button type="button" class="sv-btn sv-btn--accent" data-act="pack-dl" data-id="${esc(p.id)}"${busy ? ' disabled' : ''}>${SVG.download}${tHtml('common.download')}${p.sizeHint ? ` <small>${esc(p.sizeHint)}</small>` : ''}</button>`
        : '';
  const enter = entering ? ' is-entering' : '';
  return `<div class="sv-scrim${enter}" data-act="pack-close"></div>
  <aside class="sv sv-inspector sv-hue-${traits.hue}${enter}" role="dialog" aria-modal="true" aria-label="${esc(p.name)}" data-id="${esc(p.id)}">
    <header class="sv-inspector__head">
      ${spineHtml(p, true)}
      <div class="sv-inspector__title">
        <h3>${esc(p.name)}</h3>
        <span class="sv-inspector__state${p.installed ? ' is-installed' : ''}">${tHtml(p.installed ? 'settings.offline.installed' : 'settings.offline.notInstalled')}</span>
      </div>
      <button type="button" class="sv-icon" data-act="pack-close" aria-label="${tHtml('common.close')}">${SVG.close}</button>
    </header>
    ${p.description ? `<p class="sv-inspector__desc">${esc(p.description)}</p>` : ''}
    <dl class="sv-meta">${rows}</dl>
    <footer class="sv-inspector__foot">${action}</footer>
  </aside>`;
}
