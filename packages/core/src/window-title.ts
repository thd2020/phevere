/**
 * Reading a desktop window's title at the moment of a selection lookup: which app it is, the web
 * page or document it shows, the page number when the title carries one, and whether it is a
 * private or incognito browser window (which is never recorded).
 *
 * Title formats, as the apps write them on Windows (macOS titles have no app suffix):
 *   Chrome    "Page - Google Chrome", accessible name "Page - Google Chrome (Incognito)"
 *   Edge      "Page and 3 more pages - Personal - Microsoft​ Edge" (a zero-width space in the
 *             name), "[InPrivate]" or "InPrivate" in a private window
 *   Firefox   "Page — Mozilla Firefox", "Page — Mozilla Firefox Private Browsing"
 *   Acrobat   "GEB.pdf - Adobe Acrobat Reader (64-bit)", "GEB.pdf - Adobe Acrobat Pro DC"
 *   Foxit     "GEB.pdf - Foxit PDF Reader", "GEB.pdf - Foxit PDF Editor"
 *   SumatraPDF "GEB.pdf - SumatraPDF", "GEB.pdf - [Page 12 of 777] - SumatraPDF" in some builds
 *   WPS       "GEB.pdf - WPS Office", "GEB.pdf - WPS PDF"
 * A PDF opened in a browser shows its file name (or its title metadata) as the page title.
 */

import { cleanSourceUrl, extractSentence, normalizeSourceContext, type SourceContext } from './source-context';

export type WindowKind = 'browser' | 'pdf' | 'other';

export interface ParsedWindow {
  /** A short app name for display ("Chrome", "Acrobat"). */
  app: string;
  kind: WindowKind;
  /** Page or window title without the app's name. */
  title?: string;
  /** The document name when the window shows a file ("GEB.pdf"). */
  doc?: string;
  /** A page number read from the title. */
  page?: number;
  /** A private or incognito browser window: record nothing. */
  private: boolean;
}

interface AppRule {
  app: string;
  kind: WindowKind;
  /** Process names (lowercase, without .exe) or macOS app names. */
  match: RegExp;
  /** The app's part of the title, cut off with everything after it. */
  suffix: RegExp;
}

const DASH = '[-–—]';
const EDGE_PROFILE = '(?:Personal|Work|School|Family|Guest|Default|Profile\\s*\\d+|\\[?InPrivate\\]?|个人|工作|学校|家庭|来宾)';

const APPS: AppRule[] = [
  { app: 'Chrome', kind: 'browser', match: /^(chrome|google chrome)$/i, suffix: new RegExp(`\\s+${DASH}\\s+Google Chrome\\b.*$`, 'i') },
  // Edge puts the profile between the page and its name. Only the usual profile names are cut,
  // since a page title can hold " - " too.
  { app: 'Edge', kind: 'browser', match: /^(msedge|microsoft edge)$/i, suffix: new RegExp(`(?:\\s+${DASH}\\s+${EDGE_PROFILE})?\\s+${DASH}\\s+Microsoft\\s*Edge\\b.*$`, 'i') },
  { app: 'Firefox', kind: 'browser', match: /^(firefox|mozilla firefox)$/i, suffix: new RegExp(`\\s+${DASH}\\s+(?:Mozilla\\s+)?Firefox\\b.*$`, 'i') },
  { app: 'Brave', kind: 'browser', match: /^(brave|brave browser)$/i, suffix: new RegExp(`\\s+${DASH}\\s+Brave\\b.*$`, 'i') },
  { app: 'Opera', kind: 'browser', match: /^(opera|opera_gx)$/i, suffix: new RegExp(`\\s+${DASH}\\s+Opera\\b.*$`, 'i') },
  { app: 'Vivaldi', kind: 'browser', match: /^vivaldi$/i, suffix: new RegExp(`\\s+${DASH}\\s+Vivaldi\\b.*$`, 'i') },
  { app: 'Safari', kind: 'browser', match: /^safari$/i, suffix: /$^/ },
  { app: 'Arc', kind: 'browser', match: /^arc$/i, suffix: /$^/ },
  { app: 'Acrobat', kind: 'pdf', match: /^(acrord32|acrobat|adobe acrobat.*)$/i, suffix: new RegExp(`\\s+${DASH}\\s+Adobe Acrobat\\b.*$`, 'i') },
  { app: 'Foxit', kind: 'pdf', match: /^(foxit.*)$/i, suffix: new RegExp(`\\s+${DASH}\\s+Foxit\\b.*$`, 'i') },
  { app: 'SumatraPDF', kind: 'pdf', match: /^sumatrapdf$/i, suffix: new RegExp(`\\s+${DASH}\\s+SumatraPDF\\b.*$`, 'i') },
  { app: 'WPS', kind: 'pdf', match: /^(wps|wpspdf|wpsoffice|wps office)$/i, suffix: new RegExp(`\\s+${DASH}\\s+WPS\\b.*$`, 'i') },
  { app: 'Preview', kind: 'pdf', match: /^preview$/i, suffix: /$^/ },
  { app: 'Skim', kind: 'pdf', match: /^skim$/i, suffix: /$^/ },
  { app: 'Word', kind: 'other', match: /^(winword|microsoft word)$/i, suffix: new RegExp(`\\s+${DASH}\\s+(?:Microsoft\\s+)?Word\\b.*$`, 'i') },
  { app: 'Kindle', kind: 'other', match: /^kindle$/i, suffix: new RegExp(`^Kindle\\s+${DASH}\\s+|\\s+${DASH}\\s+Kindle$`, 'i') },
];

/** Names of private windows: Chrome, Brave and Opera ("Incognito", "Private"), Edge, Firefox, Chinese builds. */
const PRIVATE_RE = /\(incognito\)|\bincognito\b|inprivate|private browsing|\(private\)|private window|无痕|隐身|隐私浏览|隐私窗口|私密浏览/i;

/** Whether a browser window is private. `name` is the window's UI Automation name when known. */
export function isPrivateWindow(process: string, title: string, name?: string): boolean {
  const rule = ruleFor(process);
  // A document titled "Private browsing.pdf" in a reader is not a private window; in a browser,
  // or in an app we do not know, the check fails closed.
  if (rule && rule.kind !== 'browser') return false;
  return PRIVATE_RE.test(String(title || '')) || PRIVATE_RE.test(String(name || ''));
}

function ruleFor(process: string): AppRule | undefined {
  const p = String(process || '').trim().replace(/\.(exe|app)$/i, '');
  return APPS.find((r) => r.match.test(p));
}

/** "Page" from "Page and 3 more pages" (Edge), and a trailing "- [InPrivate]". */
function tidyBrowserTitle(t: string): string {
  return t
    .replace(/\s+and\s+\d+\s+more\s+pages?$/i, '')
    .replace(/\s+[-–—]\s+\[?InPrivate\]?$/i, '')
    .trim();
}

const PAGE_RES = [/\[?\bpage\s+(\d{1,5})(?:\s*(?:of|\/)\s*\d{1,5})?\]?/i, /第\s*(\d{1,5})\s*页/];
const DOC_RE = /([^\\/:*?"<>|]+\.(?:pdf|epub|djvu|mobi|azw3?|docx?|wps|txt))\b/i;

function pageFrom(t: string): { page?: number; rest: string } {
  for (const re of PAGE_RES) {
    const m = re.exec(t);
    if (m) {
      const rest = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).replace(/\s+[-–—]\s*$/, '').replace(/^\s*[-–—]\s+/, '').replace(/\s{2,}/g, ' ').trim();
      return { page: Number(m[1]), rest };
    }
  }
  return { rest: t };
}

/** Display name for a process we have no rule for: "notepad" becomes "Notepad". */
function friendlyName(process: string): string {
  const p = String(process || '').trim().replace(/\.(exe|app)$/i, '');
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
}

/** Splits a window title into app, page or document title, document name and page number. */
export function parseWindowTitle(process: string, title: string, name?: string): ParsedWindow {
  const rule = ruleFor(process);
  const raw = String(title || '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const out: ParsedWindow = {
    app: rule?.app || friendlyName(process),
    kind: rule?.kind || 'other',
    private: isPrivateWindow(process, title, name),
  };
  if (out.private || !raw) return out;
  let t = rule ? raw.replace(rule.suffix, '').trim() : raw;
  if (rule?.kind === 'browser') t = tidyBrowserTitle(t);
  const { page, rest } = pageFrom(t);
  if (page && out.kind !== 'browser') {
    out.page = page;
    t = rest;
  }
  if (!t || t === rule?.app) return out;
  out.title = t;
  const doc = DOC_RE.exec(t);
  if (doc && (out.kind !== 'browser' || /\.pdf$/i.test(doc[1]))) out.doc = doc[1].trim();
  else if (out.kind === 'pdf') out.doc = t;
  return out;
}

/** The document name from a PDF address ("https://x.org/papers/GEB.pdf" gives "GEB.pdf"). */
export function docFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').pop() || '');
    return /\.pdf$/i.test(last) ? last : undefined;
  } catch {
    return undefined;
  }
}

/** What the UI Automation reader returned for the window (scripts/source_context_host.ps1). */
export interface WindowReading {
  /** The window's accessible name, which can say "Incognito" when the title does not. */
  name?: string;
  url?: string;
  page?: number;
  /** The paragraph or line holding the selection. */
  paragraph?: string;
  /** The selected text as the window reports it. */
  selected?: string;
}

/**
 * The context kept with a saved word, from the window title and what UI Automation read.
 * Null for a private window, or when nothing useful was found.
 */
export function sourceFromWindow(process: string, title: string, reading: WindowReading | null, text: string): SourceContext | null {
  const parsed = parseWindowTitle(process, title, reading?.name);
  if (parsed.private || isPrivateWindow(process, title, reading?.name)) return null;
  const url = cleanSourceUrl(reading?.url);
  const doc = parsed.doc || docFromUrl(url);
  const page = Number(reading?.page) > 0 ? Number(reading?.page) : parsed.page;
  const sentence = reading?.paragraph
    ? extractSentence(reading.paragraph, reading.selected || text) || extractSentence(reading.paragraph, text)
    : undefined;
  return normalizeSourceContext({
    app: parsed.app,
    // A reader's title is the document name already.
    title: parsed.title && parsed.title !== doc ? parsed.title : undefined,
    url,
    doc,
    page: doc ? page : undefined,
    sentence,
  });
}
