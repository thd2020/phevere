/**
 * Settings → Offline: a shelf per headword language, catalogue cards and the pack inspector.
 * Shared by the desktop Settings window and the phone's Settings tab; each app
 * wires the `data-act` attributes. Styles: settings-offline.css.
 */

import type { CatalogLanguageGroup, OfflineCatalogItem } from './offline-catalog';
import { languageName } from './source-languages';
import { esc, hostOf, linkHtml, SVG } from './settings-kit';

export type ShelfHue = 'rust' | 'teal' | 'ochre';

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

/** Every headword language in the catalog, plus the ones an imported pack may carry. */
export const LANGUAGE_TRAITS: Record<string, LanguageTraits> = {
  en: { endonym: 'English', sample: 'Aa', script: 'Latin script', detail: '26 letters', hue: 'rust' },
  zh: { endonym: '中文', sample: '漢字', script: 'Han characters', detail: 'Simplified and traditional', hue: 'teal' },
  ja: { endonym: '日本語', sample: 'かな', script: 'Kanji and kana', detail: 'Hiragana, katakana', hue: 'ochre' },
  ko: { endonym: '한국어', sample: '한글', script: 'Hangul', detail: 'Syllable blocks', hue: 'rust' },
  ca: { endonym: 'Català', sample: 'Çà', script: 'Latin script', detail: 'à ç è é í ï ò ó ú ü', hue: 'teal' },
  hr: { endonym: 'Hrvatski', sample: 'Čč', script: 'Latin script', detail: '30 letters, č ć đ š ž', hue: 'ochre' },
  nl: { endonym: 'Nederlands', sample: 'IJ', script: 'Latin script', detail: 'ij, ë, é', hue: 'rust' },
  fi: { endonym: 'Suomi', sample: 'Ää', script: 'Latin script', detail: 'ä ö å', hue: 'teal' },
  fr: { endonym: 'Français', sample: 'Çç', script: 'Latin script', detail: 'é è ê à ç œ', hue: 'ochre' },
  de: { endonym: 'Deutsch', sample: 'ß', script: 'Latin script', detail: 'ä ö ü ß', hue: 'rust' },
  el: { endonym: 'Ελληνικά', sample: 'Ωω', script: 'Greek script', detail: '24 letters', hue: 'teal' },
  hu: { endonym: 'Magyar', sample: 'Őő', script: 'Latin script', detail: '44 letters, ő ű', hue: 'ochre' },
  it: { endonym: 'Italiano', sample: 'Èè', script: 'Latin script', detail: 'à è é ì ò ù', hue: 'rust' },
  pl: { endonym: 'Polski', sample: 'Łł', script: 'Latin script', detail: '32 letters, ą ę ł ż', hue: 'teal' },
  pt: { endonym: 'Português', sample: 'Ãã', script: 'Latin script', detail: 'ã õ ç á ê', hue: 'ochre' },
  ru: { endonym: 'Русский', sample: 'Жж', script: 'Cyrillic script', detail: '33 letters', hue: 'rust' },
  es: { endonym: 'Español', sample: 'Ññ', script: 'Latin script', detail: '27 letters, ñ', hue: 'teal' },
  uk: { endonym: 'Українська', sample: 'Її', script: 'Cyrillic script', detail: '33 letters', hue: 'ochre' },
  cs: { endonym: 'Čeština', sample: 'Řř', script: 'Latin script', detail: 'ř ě š č ů', hue: 'rust' },
  sv: { endonym: 'Svenska', sample: 'Åå', script: 'Latin script', detail: 'å ä ö', hue: 'teal' },
  da: { endonym: 'Dansk', sample: 'Øø', script: 'Latin script', detail: 'æ ø å', hue: 'ochre' },
  nb: { endonym: 'Norsk bokmål', sample: 'Ææ', script: 'Latin script', detail: 'æ ø å', hue: 'rust' },
  tr: { endonym: 'Türkçe', sample: 'Ğğ', script: 'Latin script', detail: 'ç ğ ı ö ş ü', hue: 'teal' },
  ar: { endonym: 'العربية', sample: 'ض', script: 'Arabic script', detail: 'Right to left', hue: 'ochre' },
  he: { endonym: 'עברית', sample: 'אב', script: 'Hebrew script', detail: 'Right to left', hue: 'rust' },
  fa: { endonym: 'فارسی', sample: 'گ', script: 'Arabic script', detail: 'Right to left', hue: 'teal' },
  hi: { endonym: 'हिन्दी', sample: 'अ', script: 'Devanagari', hue: 'ochre' },
  th: { endonym: 'ไทย', sample: 'ก', script: 'Thai script', hue: 'rust' },
  vi: { endonym: 'Tiếng Việt', sample: 'Ơơ', script: 'Latin script', detail: 'Tone marks', hue: 'teal' },
  id: { endonym: 'Bahasa Indonesia', sample: 'Aa', script: 'Latin script', hue: 'ochre' },
  ro: { endonym: 'Română', sample: 'Șș', script: 'Latin script', detail: 'ă â î ș ț', hue: 'rust' },
  la: { endonym: 'Latina', sample: 'Æ', script: 'Latin script', hue: 'teal' },
  eo: { endonym: 'Esperanto', sample: 'Ĉĉ', script: 'Latin script', detail: 'ĉ ĝ ĥ ĵ ŝ ŭ', hue: 'ochre' },
};

export function languageTraits(code: string): LanguageTraits {
  return (
    LANGUAGE_TRAITS[(code || '').toLowerCase()] || {
      endonym: languageName(code),
      sample: (languageName(code) || '?').slice(0, 2),
      script: '',
      hue: 'teal',
    }
  );
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

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function publishedEntries(p: PackView): string {
  if (!p.entries) return '';
  return `${p.entriesApprox ? 'About ' : ''}${p.entries.toLocaleString('en-US')} entries`;
}

function cardMeta(p: PackView, progress: PackProgress | null): string {
  if (progress) return progress.label;
  if (p.installed) return `${p.entryCount.toLocaleString('en-US')} entries`;
  return [p.sizeHint, p.entries ? `${p.entriesApprox ? '~' : ''}${p.entries.toLocaleString('en-US')} entries` : '']
    .filter(Boolean)
    .join(' · ');
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
    return `<button type="button" class="sv-icon" data-act="pack-rm" data-id="${esc(p.id)}" title="Remove" aria-label="Remove ${esc(p.name)}">${SVG.trash}</button>`;
  }
  return `<button type="button" class="sv-icon sv-icon--accent" data-act="pack-dl" data-id="${esc(p.id)}" title="Download" aria-label="Download ${esc(p.name)}"${busy ? ' disabled' : ''}>${SVG.download}</button>`;
}

export function packCardHtml(p: PackView, progress: PackProgress | null = null, busy = false): string {
  return `<article class="sv-pack${p.installed ? ' is-installed' : ''}${progress ? ' is-busy' : ''}" data-id="${esc(p.id)}">
    <button type="button" class="sv-pack__open" data-act="pack-open" data-id="${esc(p.id)}" aria-label="${esc(p.name)} details">
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
      const t = languageTraits(g.language);
      const installed = g.items.filter((p) => p.installed).length;
      const english = languageName(g.language);
      const traits = [english !== t.endonym ? english : '', t.script, t.detail].filter(Boolean);
      return `<section class="sv-shelf sv-hue-${t.hue}" data-lang="${esc(g.language)}">
        <header class="sv-shelf__band">
          <span class="sv-shelf__sample" lang="${esc(g.language)}" aria-hidden="true">${esc(t.sample)}</span>
          <h3 class="sv-shelf__name" lang="${esc(g.language)}">${esc(t.endonym)}</h3>
          <p class="sv-shelf__traits">${traits.map((x) => `<span>${esc(x)}</span>`).join('')}</p>
          <span class="sv-shelf__count">${g.items.length} ${g.items.length === 1 ? 'pack' : 'packs'}${installed ? `, ${installed} installed` : ''}</span>
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

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return esc(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  return esc(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
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
  const t = languageTraits(p.language);
  const installedAt = p.installed && p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const rows = [
    metaRow('Language', esc(languageName(p.language))),
    metaRow('Entries', p.installed ? esc(`${p.entryCount.toLocaleString('en-US')} installed`) + (p.entries ? `<small>${esc(publishedEntries(p))} published</small>` : '') : esc(publishedEntries(p))),
    metaRow('Download', esc(p.sizeHint || '')),
    metaRow('Installed size', p.installed && details.installedBytes ? esc(formatBytes(details.installedBytes)) : ''),
    metaRow('Edition', esc(p.edition || '')),
    metaRow('Date', formatDate(p.date)),
    metaRow('Publisher', esc(p.publisher || '')),
    metaRow('Licence', p.license ? (p.licenseUrl ? linkHtml(p.licenseUrl, p.license) : esc(p.license)) : ''),
    metaRow('Source', p.urls?.[0] ? linkHtml(p.urls[0]) : p.source ? esc(p.source) : ''),
    metaRow('Homepage', linkHtml(p.homepage)),
    metaRow('Installed on', esc(installedAt)),
    metaRow('Stored in', p.installed && details.storedAt ? `<code>${esc(details.storedAt)}</code>` : ''),
  ].join('');
  const action = progress
    ? `<div class="sv-inspector__progress"><span>${esc(progress.label)}</span>${progressBar(progress)}</div>`
    : p.installed
      ? `<button type="button" class="sv-btn sv-btn--quiet" data-act="pack-rm" data-id="${esc(p.id)}">${SVG.trash}Remove</button>`
      : p.urls?.length
        ? `<button type="button" class="sv-btn sv-btn--accent" data-act="pack-dl" data-id="${esc(p.id)}"${busy ? ' disabled' : ''}>${SVG.download}Download${p.sizeHint ? ` <small>${esc(p.sizeHint)}</small>` : ''}</button>`
        : '';
  const enter = entering ? ' is-entering' : '';
  return `<div class="sv-scrim${enter}" data-act="pack-close"></div>
  <aside class="sv sv-inspector sv-hue-${t.hue}${enter}" role="dialog" aria-modal="true" aria-label="${esc(p.name)}" data-id="${esc(p.id)}">
    <header class="sv-inspector__head">
      ${spineHtml(p, true)}
      <div class="sv-inspector__title">
        <h3>${esc(p.name)}</h3>
        <span class="sv-inspector__state${p.installed ? ' is-installed' : ''}">${p.installed ? 'Installed' : 'Not installed'}</span>
      </div>
      <button type="button" class="sv-icon" data-act="pack-close" aria-label="Close">${SVG.close}</button>
    </header>
    ${p.description ? `<p class="sv-inspector__desc">${esc(p.description)}</p>` : ''}
    <dl class="sv-meta">${rows}</dl>
    <footer class="sv-inspector__foot">${action}</footer>
  </aside>`;
}
