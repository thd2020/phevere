/**
 * Interface strings for the desktop windows and the phone, from one catalogue.
 *
 * English is the source and ships with every bundle. Each other language is a catalogue of the
 * same keys, loaded on demand, so a window carries only the language it shows. Plurals pick
 * their form with Intl.PluralRules (CLDR's categories: one, few, many, other, ...), as
 * i18next's JSON format does, and numbers, dates and relative times go through Intl, never
 * through rules written here.
 *
 * A message is plain text with `{name}` placeholders. It never holds markup: code that builds
 * HTML puts the markup around the message and calls tHtml(), which escapes the text.
 */

import { EN, type MessageKey } from './en';
import { UI_LOCALES, isUiLocale, type UiLocale } from './locales';

export type PluralForms = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
export type Message = string | PluralForms;
export type Catalog = Record<MessageKey, Message>;
export type MessageParams = Record<string, string | number | RawHtml>;
export type { MessageKey };

/** A parameter tHtml() inserts as markup, unescaped. */
export class RawHtml {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html;
  }
}
export const rawHtml = (html: string): RawHtml => new RawHtml(html);

const LOADERS: Record<Exclude<UiLocale, 'en'>, () => Promise<{ default: Catalog }>> = {
  'zh-CN': () => import('./zh-CN'),
  'zh-TW': () => import('./zh-TW'),
  ja: () => import('./ja'),
  ko: () => import('./ko'),
  es: () => import('./es'),
  fr: () => import('./fr'),
  de: () => import('./de'),
  ru: () => import('./ru'),
  'pt-BR': () => import('./pt-BR'),
};

let current: UiLocale = 'en';
let catalog: Partial<Record<MessageKey, Message>> = EN;
const loaded = new Map<UiLocale, Catalog>([['en', EN as Catalog]]);
const listeners = new Set<(locale: UiLocale) => void>();
let plural: Intl.PluralRules | null = null;
let numbers: Intl.NumberFormat | null = null;

/** The locale the interface is showing. */
export function uiLocale(): UiLocale {
  return current;
}

/** Load a locale's catalogue without switching to it. */
export async function loadUiCatalog(locale: UiLocale): Promise<Catalog> {
  const have = loaded.get(locale);
  if (have) return have;
  if (locale === 'en') return EN as Catalog;
  const mod = await LOADERS[locale]();
  loaded.set(locale, mod.default);
  return mod.default;
}

/**
 * Switch the interface language. Resolves once the catalogue is in, then tells every listener;
 * a locale Phevere does not have falls back to English.
 */
export async function setUiLocale(locale: string): Promise<UiLocale> {
  const next: UiLocale = isUiLocale(locale) ? locale : 'en';
  let messages: Catalog;
  try {
    messages = await loadUiCatalog(next);
  } catch {
    messages = EN as Catalog;
  }
  const changed = next !== current;
  current = loaded.has(next) ? next : 'en';
  catalog = messages;
  plural = null;
  numbers = null;
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = current;
  if (changed) for (const fn of Array.from(listeners)) fn(current);
  return current;
}

/** Install an already-loaded catalogue synchronously (tests, and pages that bundle one). */
export function useUiCatalog(locale: UiLocale, messages: Catalog): void {
  loaded.set(locale, messages);
  current = locale;
  catalog = messages;
  plural = null;
  numbers = null;
}

/** Called after each switch; returns a function that stops listening. */
export function onUiLocaleChange(fn: (locale: UiLocale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function pluralRules(): Intl.PluralRules {
  return (plural ||= new Intl.PluralRules(current));
}

function numberFormat(): Intl.NumberFormat {
  return (numbers ||= new Intl.NumberFormat(current));
}

function pick(message: Message, params?: MessageParams): string {
  if (typeof message === 'string') return message;
  const count = Number(params?.count);
  const n = Number.isFinite(count) ? count : 0;
  if (n === 0 && message.zero !== undefined) return message.zero;
  const form = pluralRules().select(n) as keyof PluralForms;
  return message[form] ?? message.other;
}

function fill(text: string, params: MessageParams | undefined, escape: boolean): string {
  const body = escape ? escapeHtml(text) : text;
  if (!params) return body;
  return body.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in params)) return whole;
    const v = params[name];
    if (v instanceof RawHtml) return escape ? v.html : v.html;
    const s = typeof v === 'number' ? numberFormat().format(v) : String(v);
    return escape ? escapeHtml(s) : s;
  });
}

/** The message for `key` in the interface language, English when it has none, as plain text. */
export function t(key: MessageKey, params?: MessageParams): string {
  const message = catalog[key] ?? EN[key];
  if (message === undefined) return key;
  return fill(pick(message as Message, params), params, false);
}

/** t() escaped for HTML; RawHtml parameters go in as markup. */
export function tHtml(key: MessageKey, params?: MessageParams): string {
  const message = catalog[key] ?? EN[key];
  if (message === undefined) return escapeHtml(key);
  return fill(pick(message as Message, params), params, true);
}

/** True when `key` names a message (for keys built from data, such as a section id). */
export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(EN, key);
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- numbers, dates and lists through Intl ----------

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return options ? new Intl.NumberFormat(current, options).format(n) : numberFormat().format(n);
}

/** 0.42 → "42%" (or "42 %", "%42", as the locale writes it). */
export function formatPercent(fraction: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(current, { style: 'percent', maximumFractionDigits }).format(fraction);
}

/** Sizes in megabytes, as "12 MB" with the locale's digits and spacing. */
export function formatMegabytes(mb: number, maximumFractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(current, { style: 'unit', unit: 'megabyte', maximumFractionDigits }).format(mb);
  } catch {
    return `${formatNumber(mb, { maximumFractionDigits })} MB`;
  }
}

export function formatDate(date: Date | number, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(current, options).format(date);
}

/** "3 days ago", "in 2 hours", "yesterday" (numeric: 'auto'). */
export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, numeric: 'auto' | 'always' = 'auto'): string {
  return new Intl.RelativeTimeFormat(current, { numeric }).format(value, unit);
}

type ListFormatCtor = new (locale: string, options: { type: 'conjunction' | 'disjunction' | 'unit'; style?: 'long' | 'short' | 'narrow' }) => {
  format(items: string[]): string;
};

/** "A, B and C" in the interface language (`or` lists with type 'disjunction'). */
export function formatList(items: string[], type: 'conjunction' | 'disjunction' | 'unit' = 'conjunction'): string {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatCtor }).ListFormat;
  if (!ListFormat) return items.join(', ');
  return new ListFormat(current, { type }).format(items);
}

/** A language's name in the interface language ("French", "Französisch", "法语"). */
export function languageDisplayName(code: string): string {
  const Names = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: 'language' }) => { of(c: string): string | undefined } }).DisplayNames;
  if (!Names || !code) return code;
  try {
    return Names ? new Names([current], { type: 'language' }).of(code) || code : code;
  } catch {
    return code;
  }
}

// ---------- static markup ----------

/**
 * Translate static HTML: an element with `data-i18n="key"` gets the message as its text, and
 * `data-i18n-attr="title:key; aria-label:key2"` sets attributes. The English text written in
 * the HTML stays until this runs.
 */
export function translateDom(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n || '';
    if (hasMessage(key)) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of (el.dataset.i18nAttr || '').split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key && hasMessage(key)) el.setAttribute(attr, t(key));
    }
  });
}

export const ALL_UI_LOCALES = UI_LOCALES;
