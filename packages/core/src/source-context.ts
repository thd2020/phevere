/**
 * Where a saved word was met: the app, the web page or document, the page number and the
 * sentence around the word. Desktop capture fills it at the moment of a selection lookup, the
 * phone fills the launching app (and a page title or URL when the LSPosed module can read one).
 *
 * It is stored as JSON in the nullable `vocab.context` column, written when the word is first
 * saved and never replaced by a later save of the same word. Titles, URLs and sentences are
 * personal data: they stay in the learner's own notebook and travel only through the learner's
 * own account sync.
 */

export interface SourceContext {
  /** The app the word was selected in ("Chrome", "Acrobat", "Kindle"). */
  app?: string;
  /** The web page or window title, without the app's name. */
  title?: string;
  /** The page address, http or https only. */
  url?: string;
  /** The document name ("GEB.pdf"). */
  doc?: string;
  /** The page number in the document, when the reader shows it. */
  page?: number;
  /** The sentence around the word, at most about 300 characters. */
  sentence?: string;
}

const LIMITS = { app: 60, title: 300, url: 2000, doc: 300, sentence: 400 } as const;

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f​-‍﻿]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Keeps a web address only when it is http or https; local paths and script URLs are dropped. */
export function cleanSourceUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(s) || s.length > LIMITS.url) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    // Credentials in a URL never belong in a notebook.
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Validates any value (a parsed JSON column, a sync record, an IPC payload) into a SourceContext. */
export function normalizeSourceContext(raw: unknown): SourceContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: SourceContext = {};
  const app = cleanText(r.app, LIMITS.app);
  const title = cleanText(r.title, LIMITS.title);
  const url = cleanSourceUrl(r.url);
  const doc = cleanText(r.doc, LIMITS.doc);
  const sentence = cleanText(r.sentence, LIMITS.sentence);
  const page = Number(r.page);
  if (app) out.app = app;
  if (title) out.title = title;
  if (url) out.url = url;
  if (doc) out.doc = doc;
  if (Number.isInteger(page) && page > 0 && page < 100000) out.page = page;
  if (sentence) out.sentence = sentence;
  return Object.keys(out).length ? out : null;
}

/** The `vocab.context` column value: JSON, or null when there is nothing to keep. */
export function sourceContextToJson(ctx: unknown): string | null {
  const n = normalizeSourceContext(ctx);
  return n ? JSON.stringify(n) : null;
}

export function sourceContextFromJson(v: unknown): SourceContext | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'object') return normalizeSourceContext(v) || undefined;
  try {
    return normalizeSourceContext(JSON.parse(String(v))) || undefined;
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------------- sentence */

const SENTENCE_CAP = 300;

/**
 * The sentence of `text` (a paragraph or a line read from the page) that holds `word`, at most
 * `cap` characters. A longer sentence is cut to a window around the word, at word boundaries.
 */
export function extractSentence(text: string, word: string, cap = SENTENCE_CAP): string | undefined {
  const para = String(text || '').replace(/\s+/g, ' ').trim();
  const w = String(word || '').replace(/\s+/g, ' ').trim();
  if (!para || !w) return undefined;
  const lower = para.toLowerCase();
  const at = lower.indexOf(w.toLowerCase());
  if (at < 0) return undefined;
  // Sentence ends: . ! ? and their CJK forms, followed by space or a closing quote. Initials and
  // abbreviations such as "e.g." or "Mr." can cut a sentence short; the cap keeps that harmless.
  const ends: number[] = [];
  const re = /[.!?。！？]+["'”’)\]]*(?=\s|$)|[。！？]/g;
  for (let m = re.exec(para); m; m = re.exec(para)) ends.push(m.index + m[0].length);
  let start = 0;
  let end = para.length;
  for (const e of ends) {
    if (e <= at) start = e;
    else if (e >= at + w.length) {
      end = e;
      break;
    }
  }
  let s = para.slice(start, end).trim();
  if (s.length <= cap) return s.length > w.length ? s : undefined;
  // Too long: a window around the word.
  const rel = s.toLowerCase().indexOf(w.toLowerCase());
  const half = Math.max(0, Math.floor((cap - w.length) / 2));
  let a = Math.max(0, rel - half);
  let b = Math.min(s.length, rel + w.length + half);
  if (a > 0) {
    const sp = s.indexOf(' ', a);
    if (sp >= 0 && sp < rel) a = sp + 1;
  }
  if (b < s.length) {
    const sp = s.lastIndexOf(' ', b);
    if (sp > rel + w.length) b = sp;
  }
  s = `${a > 0 ? '…' : ''}${s.slice(a, b).trim()}${b < s.length ? '…' : ''}`;
  return s;
}

/**
 * Where the saved word sits in the sentence: the first token that is the word or an inflected
 * form of it ("ran" is not found for "run", "braids" is found for "braid").
 */
export function findWordInSentence(sentence: string, lemma: string): { index: number; length: number } | null {
  const s = String(sentence || '');
  const w = String(lemma || '').trim().toLowerCase();
  if (!s || !w) return null;
  const exact = s.toLowerCase().indexOf(w);
  const tokenRe = /[\p{L}\p{M}'’-]+/gu;
  const stem = w.length > 4 ? w.replace(/(e|y|ies|es|s)$/u, '') : w;
  for (let m = tokenRe.exec(s); m; m = tokenRe.exec(s)) {
    const t = m[0].toLowerCase();
    if (t === w || (stem.length >= 3 && t.startsWith(stem) && t.length - stem.length <= 4)) return { index: m.index, length: m[0].length };
  }
  if (exact >= 0) return { index: exact, length: w.length };
  return null;
}

/* ------------------------------------------------------------------ sources */

export interface SourceGroupKey {
  key: string;
  kind: 'doc' | 'site';
  label: string;
}

/** Host without "www.", or '' for an unreadable address. */
export function siteOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The site's own icon, the way browsers find one when a page names none: /favicon.ico at the
 * site's address. It comes from the site the word was read on, not from a third-party icon
 * service, so it loads wherever that site does. '' for an unreadable host.
 */
export function siteIconUrl(host: string): string {
  const h = String(host || '').trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? `https://${h}/favicon.ico` : '';
}

/** Second-level labels that countries register names under, as in bbc.co.uk or sina.com.cn. */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'mil', 'nic']);

/**
 * The letter on a site's tile when its icon does not load, as Chrome's new tab page draws one:
 * the first letter of the site's name, skipping "www", subdomains such as "en", the top-level
 * domain and a short second level such as the "co" of bbc.co.uk.
 */
export function siteMonogram(host: string): string {
  const labels = String(host || '').toLowerCase().split('.').filter(Boolean);
  const tld = labels.length > 1 ? labels.pop()! : '';
  // Only a country's own second level ("co.uk", "com.cn"), so a short name such as cnn in
  // edition.cnn.com or qq in mail.qq.com stays the name.
  if (tld.length === 2 && labels.length > 1 && SECOND_LEVEL.has(labels[labels.length - 1])) labels.pop();
  const name = labels[labels.length - 1] || '';
  return (name.match(/[\p{L}\p{N}]/u)?.[0] || '').toLocaleUpperCase('en');
}

/** The group a saved word belongs to: the document when there is one, otherwise the web site. */
export function sourceGroupOf(ctx: SourceContext | null | undefined): SourceGroupKey | null {
  if (!ctx) return null;
  if (ctx.doc) return { key: `doc:${ctx.doc.toLowerCase()}`, kind: 'doc', label: ctx.doc };
  const site = siteOf(ctx.url);
  if (site) return { key: `site:${site}`, kind: 'site', label: site };
  return null;
}

/** A document name without its extension, as a word book title ("GEB.pdf" becomes "GEB"). */
export function sourceBookTitle(label: string): string {
  const t = String(label || '').trim();
  const bare = t.replace(/\.(pdf|epub|mobi|azw3?|djvu|docx?|txt)$/i, '').trim();
  return (bare || t).slice(0, 80);
}

/** Whether a word saved from the pop-up is the text that was selected (or a form of it). */
export function lookupTextMatches(selected: string, lemma: string): boolean {
  const s = String(selected || '').trim().toLowerCase();
  const l = String(lemma || '').trim().toLowerCase();
  if (!s || !l) return false;
  if (s === l || s.includes(l) || l.includes(s)) return true;
  let i = 0;
  while (i < s.length && i < l.length && s[i] === l[i]) i += 1;
  return i >= Math.min(4, Math.min(s.length, l.length) - 1) && i >= 3;
}
