/**
 * Offline dictionary packs stored in local SQLite (sql.js).
 * Import via user file upload or consent download from the catalog
 * (WordNet, Webster 1913/GCIDE, CC-CEDICT, FreeDict eng–zho).
 */

import { net } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import { createReadStream } from 'fs';
import { getLocalDb, isLocalDbReady, markDirty, queryAll, queryOne, runBatch, runWrite } from './local-db';
import { wrapConsole } from '../logger';
import { getCatalogItem, OFFLINE_CATALOG, type OfflineCatalogItem } from './offline-catalog';
import {
  parseFreedictTei,
  parseGcideCide,
  parseWordNetData,
  type ParsedOfflineEntry,
} from './offline-pack-parsers';

const console = wrapConsole('offline-dict');
const execFileAsync = promisify(execFile);
const UA = 'Phevere/1.0 (offline dictionary import; https://github.com/thd2020/phevere)';

const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
const WORDNET_URLS = ['https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz'];
const GCIDE_URLS = [
  'https://ftp.gnu.org/gnu/gcide/gcide-0.53.tar.gz',
  'https://mirrors.kernel.org/gnu/gcide/gcide-0.53.tar.gz',
];
const FREEDICT_ENG_ZHO_XZ =
  'https://download.freedict.org/dictionaries/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.src.tar.xz';

const INSERT_ENTRY_SQL =
  'INSERT INTO offline_entries (headword, language, pos, definition, pack_id, extra) VALUES (?, ?, ?, ?, ?, ?)';
const INSERT_CHUNK = 1200;

export interface OfflinePack {
  id: string;
  name: string;
  language: string;
  source?: string;
  entryCount: number;
  createdAt: number;
}

export interface OfflineHit {
  headword: string;
  language: string;
  pos?: string;
  definition: string;
  packId: string;
  packName?: string;
}

export type CatalogStatusItem = OfflineCatalogItem & {
  installed: boolean;
  entryCount: number;
};

export async function ensureOfflineReady(): Promise<void> {
  await getLocalDb();
}

export async function listPacks(): Promise<OfflinePack[]> {
  await ensureOfflineReady();
  const rows = await queryAll(`SELECT * FROM offline_packs ORDER BY created_at DESC`);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    language: String(r.language),
    source: r.source ? String(r.source) : undefined,
    entryCount: Number(r.entry_count) || 0,
    createdAt: Number(r.created_at) || 0,
  }));
}

export async function listCatalogStatus(): Promise<CatalogStatusItem[]> {
  let installed: OfflinePack[] = [];
  try {
    installed = await listPacks();
  } catch {
    installed = [];
  }
  const byId = new Map(installed.map((p) => [p.id, p]));
  return OFFLINE_CATALOG.map((c) => ({
    ...c,
    installed: byId.has(c.id),
    entryCount: byId.get(c.id)?.entryCount || 0,
  }));
}

export async function removePack(packId: string): Promise<void> {
  await ensureOfflineReady();
  await runWrite(`DELETE FROM offline_entries WHERE pack_id = ?`, [packId]);
  await runWrite(`DELETE FROM offline_packs WHERE id = ?`, [packId]);
}

export async function lookupOffline(
  headword: string,
  language?: string,
  limit = 20,
  extraForms: string[] = [],
): Promise<OfflineHit[]> {
  if (!isLocalDbReady()) return [];
  const q = (headword || '').trim();
  if (!q) return [];
  const forms = Array.from(
    new Set(
      [q, ...extraForms]
        .map((f) => (f || '').trim())
        .filter((f) => f && f.length <= 80),
    ),
  );
  const matchSql = forms.map(() => 'e.headword = ? COLLATE NOCASE').join(' OR ');
  const rows = language
    ? await queryAll(
        `SELECT e.*, p.name AS pack_name FROM offline_entries e
         LEFT JOIN offline_packs p ON p.id = e.pack_id
         WHERE (${matchSql}) AND e.language = ? LIMIT ?`,
        [...forms, language, limit],
      )
    : await queryAll(
        `SELECT e.*, p.name AS pack_name FROM offline_entries e
         LEFT JOIN offline_packs p ON p.id = e.pack_id
         WHERE (${matchSql}) LIMIT ?`,
        [...forms, limit],
      );
  return rows.map((r) => ({
    headword: String(r.headword),
    language: String(r.language),
    pos: r.pos ? String(r.pos) : undefined,
    definition: String(r.definition),
    packId: String(r.pack_id),
    packName: r.pack_name ? String(r.pack_name) : undefined,
  }));
}

async function insertPack(meta: { id: string; name: string; language: string; source?: string }): Promise<void> {
  const existing = await queryOne(`SELECT id FROM offline_packs WHERE id = ?`, [meta.id]);
  if (existing) {
    await runWrite(`DELETE FROM offline_entries WHERE pack_id = ?`, [meta.id]);
    await runWrite(`DELETE FROM offline_packs WHERE id = ?`, [meta.id]);
  }
  await runWrite(
    `INSERT INTO offline_packs (id, name, language, source, entry_count, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
    [meta.id, meta.name, meta.language, meta.source || null, Date.now()],
  );
}

async function bumpPackCount(packId: string, n: number): Promise<void> {
  await runWrite(`UPDATE offline_packs SET entry_count = ? WHERE id = ?`, [n, packId]);
  markDirty();
}

async function writePack(
  meta: { id: string; name: string; language: string; source?: string },
  entries: ParsedOfflineEntry[],
): Promise<{ packId: string; count: number }> {
  await ensureOfflineReady();
  if (!entries.length) {
    throw new Error(`No entries parsed for ${meta.name}`);
  }
  await insertPack(meta);
  let count = 0;
  for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
    const slice = entries.slice(i, i + INSERT_CHUNK);
    await runBatch(
      INSERT_ENTRY_SQL,
      slice.map((r) => [
        r.headword,
        r.language,
        r.pos || null,
        r.definition,
        meta.id,
        r.extra != null ? JSON.stringify(r.extra) : null,
      ]),
    );
    count += slice.length;
  }
  await bumpPackCount(meta.id, count);
  console.log('Imported pack', { packId: meta.id, count });
  return { packId: meta.id, count };
}

async function downloadBuffer(urls: string[]): Promise<Buffer> {
  let last = 'no URLs';
  for (const url of urls) {
    try {
      console.log('Downloading', url);
      const response = await net.fetch(url, { headers: { 'User-Agent': UA } });
      if (!response.ok) {
        last = `HTTP ${response.status} (${url})`;
        continue;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (e) {
      last = `${url}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(`Download failed: ${last}`);
}

function mkWork(label: string): string {
  const dir = path.join(os.tmpdir(), `phevere-${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmWork(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function walkFiles(root: string, pred: (name: string) => boolean): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (pred(e.name)) out.push(full);
    }
  }
  return out;
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  await execFileAsync('tar', ['-xf', archivePath, '-C', destDir], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * Import a JSONL / JSON array file:
 * { "headword": "...", "definition": "...", "pos"?: "...", "language"?: "en" }
 */
export async function importJsonFile(
  filePath: string,
  opts?: { packId?: string; name?: string; language?: string },
): Promise<{ packId: string; count: number }> {
  const raw = fs.readFileSync(filePath, 'utf8');
  let items: any[] = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    items = JSON.parse(trimmed);
  } else {
    items = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  const packId = opts?.packId || `json-${Date.now()}`;
  const language = opts?.language || 'en';
  const entries: ParsedOfflineEntry[] = [];
  for (const item of items) {
    const headword = String(item.headword || item.word || item.lemma || '').trim();
    const definition = String(item.definition || item.meaning || item.gloss || '').trim();
    if (!headword || !definition) continue;
    entries.push({
      headword,
      language: String(item.language || language),
      pos: item.pos || item.partOfSpeech || undefined,
      definition,
    });
  }
  return writePack(
    {
      id: packId,
      name: opts?.name || path.basename(filePath),
      language,
      source: 'user-upload',
    },
    entries,
  );
}

/** Import uncompressed CC-CEDICT text (UTF-8). */
export async function importCedictTextFile(
  filePath: string,
  packId = 'cc-cedict',
): Promise<{ packId: string; count: number }> {
  const entries: ParsedOfflineEntry[] = [];
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.+)\/\s*$/);
    if (!m) continue;
    const traditional = m[1];
    const simplified = m[2];
    const pinyin = m[3];
    const defs = m[4]
      .split('/')
      .map((d) => d.trim())
      .filter(Boolean);
    const definition = `[${pinyin}] ${defs.join('; ')}`;
    for (const head of Array.from(new Set([simplified, traditional]))) {
      entries.push({
        headword: head,
        language: 'zh',
        definition,
        extra: { traditional, simplified, pinyin },
      });
    }
  }
  return writePack(
    {
      id: packId,
      name: 'CC-CEDICT',
      language: 'zh',
      source: filePath,
    },
    entries,
  );
}

/**
 * Download CC-CEDICT (.txt.gz), gunzip via zlib, import.
 * User must agree — call only after explicit UI confirmation.
 */
export async function downloadAndImportCedict(): Promise<{ packId: string; count: number }> {
  const zlib = await import('zlib');
  const gunzip = promisify(zlib.gunzip);
  const compressed = await downloadBuffer([CEDICT_URL]);
  const textBuf = await gunzip(compressed);
  const work = mkWork('cedict');
  const tmp = path.join(work, 'cedict.txt');
  try {
    fs.writeFileSync(tmp, textBuf);
    return await importCedictTextFile(tmp, 'cc-cedict');
  } finally {
    rmWork(work);
  }
}

async function downloadAndImportWordNet(): Promise<{ packId: string; count: number }> {
  const item = getCatalogItem('wordnet-3.1')!;
  const work = mkWork('wordnet');
  try {
    const buf = await downloadBuffer(WORDNET_URLS);
    const archive = path.join(work, 'wn.dict.tar.gz');
    fs.writeFileSync(archive, buf);
    const dest = path.join(work, 'out');
    await extractArchive(archive, dest);
    const dataFiles = walkFiles(dest, (n) => /^data\.(noun|verb|adj|adv)$/i.test(n));
    if (!dataFiles.length) throw new Error('WordNet archive had no data.noun / data.verb files');
    const entries = dataFiles.flatMap((f) => parseWordNetData(fs.readFileSync(f, 'utf8')));
    return writePack(
      { id: item.id, name: item.name, language: item.language, source: WORDNET_URLS[0] },
      entries,
    );
  } finally {
    rmWork(work);
  }
}

async function downloadAndImportGcide(): Promise<{ packId: string; count: number }> {
  const item = getCatalogItem('webster-1913')!;
  const work = mkWork('gcide');
  try {
    const buf = await downloadBuffer(GCIDE_URLS);
    const archive = path.join(work, 'gcide.tar.gz');
    fs.writeFileSync(archive, buf);
    const dest = path.join(work, 'out');
    await extractArchive(archive, dest);
    const cideFiles = walkFiles(dest, (n) => /^CIDE\.[A-Z]$/i.test(n));
    if (!cideFiles.length) throw new Error('GCIDE archive had no CIDE.A–Z files');
    const entries = cideFiles.flatMap((f) => parseGcideCide(fs.readFileSync(f, 'utf8')));
    return writePack(
      { id: item.id, name: item.name, language: item.language, source: GCIDE_URLS[0] },
      entries,
    );
  } finally {
    rmWork(work);
  }
}

async function downloadAndImportFreedictEngZho(): Promise<{ packId: string; count: number }> {
  const item = getCatalogItem('freedict-eng-zho')!;
  const work = mkWork('freedict-eng-zho');
  try {
    const buf = await downloadBuffer([FREEDICT_ENG_ZHO_XZ]);
    const archive = path.join(work, 'src.tar.xz');
    fs.writeFileSync(archive, buf);
    const dest = path.join(work, 'out');
    await extractArchive(archive, dest);
    const teiFiles = walkFiles(dest, (n) => n.toLowerCase().endsWith('.tei'));
    if (!teiFiles.length) throw new Error('FreeDict archive had no .tei file');
    const entries = teiFiles.flatMap((f) => parseFreedictTei(fs.readFileSync(f, 'utf8')));
    return writePack(
      { id: item.id, name: item.name, language: item.language, source: FREEDICT_ENG_ZHO_XZ },
      entries,
    );
  } finally {
    rmWork(work);
  }
}

/** Consent download for a catalog pack id. */
export async function downloadCatalogPack(packId: string): Promise<{ packId: string; count: number }> {
  const item = getCatalogItem(packId);
  if (!item) throw new Error(`Unknown catalog pack: ${packId}`);
  switch (packId) {
    case 'cc-cedict':
      return downloadAndImportCedict();
    case 'wordnet-3.1':
      return downloadAndImportWordNet();
    case 'webster-1913':
      return downloadAndImportGcide();
    case 'freedict-eng-zho':
      return downloadAndImportFreedictEngZho();
    default:
      throw new Error(`No importer for ${packId}`);
  }
}
