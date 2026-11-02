/**
 * Offline dictionary packs stored in local SQLite (sql.js).
 * Import via user file upload or consent download from the shared catalog
 * (`packages/core/src/offline-catalog.ts`).
 *
 * Big dumps are read line by line from disk and written in batches, so the
 * 450 MB FreeDict German TEI or the 118 MB JMdict JSON never sit in memory whole.
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
  FreedictTeiStream,
  KengdicCollector,
  parseCedictLine,
  parseGcideCide,
  parseJmdictLine,
  parseWordNetData,
  wantsArchiveMember,
  type ParsedOfflineEntry,
} from '@phevere/core';

const console = wrapConsole('offline-dict');
const execFileAsync = promisify(execFile);
const UA = 'Phevere/1.0 (offline dictionary import; https://github.com/thd2020/phevere)';

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

import type { OfflineHit } from '@phevere/core';
export type { OfflineHit };

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

type PackMeta = { id: string; name: string; language: string; source?: string };

/** Replaces a pack's rows in batches; a failed import removes what it wrote. */
class PackWriter {
  private pending: ParsedOfflineEntry[] = [];
  private count = 0;

  private constructor(private meta: PackMeta) {}

  static async begin(meta: PackMeta): Promise<PackWriter> {
    await ensureOfflineReady();
    const existing = await queryOne(`SELECT id FROM offline_packs WHERE id = ?`, [meta.id]);
    if (existing) {
      await runWrite(`DELETE FROM offline_entries WHERE pack_id = ?`, [meta.id]);
      await runWrite(`DELETE FROM offline_packs WHERE id = ?`, [meta.id]);
    }
    await runWrite(
      `INSERT INTO offline_packs (id, name, language, source, entry_count, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
      [meta.id, meta.name, meta.language, meta.source || null, Date.now()],
    );
    return new PackWriter(meta);
  }

  add(rows: ParsedOfflineEntry[]): void {
    for (const r of rows) this.pending.push(r);
  }

  get full(): boolean {
    return this.pending.length >= INSERT_CHUNK;
  }

  async flush(): Promise<void> {
    while (this.pending.length) {
      const slice = this.pending.splice(0, INSERT_CHUNK);
      await runBatch(
        INSERT_ENTRY_SQL,
        slice.map((r) => [
          r.headword,
          r.language,
          r.pos || null,
          r.definition,
          this.meta.id,
          r.extra != null ? JSON.stringify(r.extra) : null,
        ]),
      );
      this.count += slice.length;
    }
  }

  async finish(): Promise<{ packId: string; count: number }> {
    await this.flush();
    if (!this.count) {
      await removePack(this.meta.id);
      throw new Error(`No entries parsed for ${this.meta.name}`);
    }
    await runWrite(`UPDATE offline_packs SET entry_count = ? WHERE id = ?`, [this.count, this.meta.id]);
    markDirty();
    console.log('Imported pack', { packId: this.meta.id, count: this.count });
    return { packId: this.meta.id, count: this.count };
  }

  async abort(): Promise<void> {
    this.pending = [];
    try {
      await removePack(this.meta.id);
    } catch {
      /* ignore */
    }
  }
}

async function writePack(meta: PackMeta, entries: ParsedOfflineEntry[]): Promise<{ packId: string; count: number }> {
  if (!entries.length) throw new Error(`No entries parsed for ${meta.name}`);
  const writer = await PackWriter.begin(meta);
  try {
    writer.add(entries);
    return await writer.finish();
  } catch (e) {
    await writer.abort();
    throw e;
  }
}

/** Read a UTF-8 file line by line, flushing the writer between lines when it fills up. */
async function eachLine(file: string, writer: PackWriter, onLine: (line: string) => void): Promise<void> {
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    onLine(line);
    if (writer.full) await writer.flush();
  }
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
  return out.sort();
}

/** bsdtar (Windows, macOS) and GNU tar both read .tar.gz and .tar.xz. */
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
  return importFiles({ id: packId, name: 'CC-CEDICT', language: 'zh', source: filePath }, 'cedict', [filePath]);
}

/** Parse the unpacked files of one pack format into the pack's rows. */
async function importFiles(
  meta: PackMeta,
  format: OfflineCatalogItem['format'],
  files: string[],
): Promise<{ packId: string; count: number }> {
  const writer = await PackWriter.begin(meta);
  try {
    for (const file of files) {
      switch (format) {
        case 'wordnet':
          writer.add(parseWordNetData(fs.readFileSync(file, 'utf8')));
          break;
        case 'gcide':
          writer.add(parseGcideCide(fs.readFileSync(file, 'utf8')));
          break;
        case 'cedict':
          await eachLine(file, writer, (line) => writer.add(parseCedictLine(line)));
          break;
        case 'jmdict':
          await eachLine(file, writer, (line) => writer.add(parseJmdictLine(line)));
          break;
        case 'freedict-tei': {
          const tei = new FreedictTeiStream(meta.language, (rows) => writer.add(rows));
          await eachLine(file, writer, (line) => tei.push(`${line}\n`));
          break;
        }
        case 'kengdic': {
          const collector = new KengdicCollector();
          await eachLine(file, writer, (line) => collector.addLine(line));
          writer.add(collector.entries());
          break;
        }
        default:
          throw new Error(`No importer for ${format}`);
      }
      await writer.flush();
    }
    return await writer.finish();
  } catch (e) {
    await writer.abort();
    throw e;
  }
}

/** Download a catalog pack, unpack it to a temp folder and import it. Call only after the user agreed. */
export async function downloadCatalogPack(packId: string): Promise<{ packId: string; count: number }> {
  const item = getCatalogItem(packId);
  if (!item) throw new Error(`Unknown catalog pack: ${packId}`);
  const work = mkWork(item.id);
  try {
    const buf = await downloadBuffer(item.urls);
    let files: string[];
    if (item.archive === 'plain' || item.archive === 'gz') {
      const file = path.join(work, 'pack.txt');
      if (item.archive === 'gz') {
        const zlib = await import('zlib');
        fs.writeFileSync(file, await promisify(zlib.gunzip)(buf));
      } else {
        fs.writeFileSync(file, buf);
      }
      files = [file];
    } else {
      const archive = path.join(work, `pack.${item.archive}`);
      fs.writeFileSync(archive, buf);
      const dest = path.join(work, 'out');
      await extractArchive(archive, dest);
      files = walkFiles(dest, (n) => wantsArchiveMember(item.format, n));
    }
    if (!files.length) throw new Error(`${item.name}: the download had no dictionary files`);
    return await importFiles(
      { id: item.id, name: item.name, language: item.language, source: item.urls[0] },
      item.format,
      files,
    );
  } finally {
    rmWork(work);
  }
}

/** Kept for the `offline-download-cedict` IPC channel. */
export async function downloadAndImportCedict(): Promise<{ packId: string; count: number }> {
  return downloadCatalogPack('cc-cedict');
}
