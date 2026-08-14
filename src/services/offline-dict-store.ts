/**
 * Offline dictionary packs stored in local SQLite (sql.js).
 * Import via user file upload or free download (CC-CEDICT).
 */

import { net } from 'electron';
import * as fs from 'fs';
import * as readline from 'readline';
import { createReadStream } from 'fs';
import { getLocalDb, isLocalDbReady, markDirty, queryAll, queryOne, runWrite } from './local-db';
import { wrapConsole } from '../logger';

const console = wrapConsole('offline-dict');

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

const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

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

export async function removePack(packId: string): Promise<void> {
  await ensureOfflineReady();
  await runWrite(`DELETE FROM offline_entries WHERE pack_id = ?`, [packId]);
  await runWrite(`DELETE FROM offline_packs WHERE id = ?`, [packId]);
}

export async function lookupOffline(headword: string, language?: string, limit = 20): Promise<OfflineHit[]> {
  // Never wait for sql.js to finish opening a 40MB+ CEDICT file on the lookup path.
  if (!isLocalDbReady()) return [];
  const q = (headword || '').trim();
  if (!q) return [];
  const rows = language
    ? await queryAll(
        `SELECT e.*, p.name AS pack_name FROM offline_entries e
         LEFT JOIN offline_packs p ON p.id = e.pack_id
         WHERE e.headword = ? COLLATE NOCASE AND e.language = ? LIMIT ?`,
        [q, language, limit],
      )
    : await queryAll(
        `SELECT e.*, p.name AS pack_name FROM offline_entries e
         LEFT JOIN offline_packs p ON p.id = e.pack_id
         WHERE e.headword = ? COLLATE NOCASE LIMIT ?`,
        [q, limit],
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

/**
 * Import a JSONL / JSON array file:
 * { "headword": "...", "definition": "...", "pos"?: "...", "language"?: "en" }
 */
export async function importJsonFile(
  filePath: string,
  opts?: { packId?: string; name?: string; language?: string },
): Promise<{ packId: string; count: number }> {
  await ensureOfflineReady();
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
  await insertPack({
    id: packId,
    name: opts?.name || pathBasename(filePath),
    language,
    source: 'user-upload',
  });

  let count = 0;
  for (const item of items) {
    const headword = String(item.headword || item.word || item.lemma || '').trim();
    const definition = String(item.definition || item.meaning || item.gloss || '').trim();
    if (!headword || !definition) continue;
    await runWrite(
      `INSERT INTO offline_entries (headword, language, pos, definition, pack_id, extra) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        headword,
        String(item.language || language),
        item.pos || item.partOfSpeech || null,
        definition,
        packId,
        item.extra ? JSON.stringify(item.extra) : null,
      ],
    );
    count += 1;
  }
  await bumpPackCount(packId, count);
  console.log('Imported JSON pack', { packId, count });
  return { packId, count };
}

/** Import uncompressed CC-CEDICT text (UTF-8). */
export async function importCedictTextFile(
  filePath: string,
  packId = 'cc-cedict',
): Promise<{ packId: string; count: number }> {
  await ensureOfflineReady();
  await insertPack({
    id: packId,
    name: 'CC-CEDICT',
    language: 'zh',
    source: filePath,
  });

  let count = 0;
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line || line.startsWith('#')) continue;
    // traditional simplified [pinyin] /def1/def2/
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.+)\/\s*$/);
    if (!m) continue;
    const traditional = m[1];
    const simplified = m[2];
    const pinyin = m[3];
    const defs = m[4].split('/').map((d) => d.trim()).filter(Boolean);
    const meaning = defs.join('; ');
    const definition = `[${pinyin}] ${meaning}`;
    for (const head of Array.from(new Set([simplified, traditional]))) {
      await runWrite(
        `INSERT INTO offline_entries (headword, language, pos, definition, pack_id, extra) VALUES (?, 'zh', NULL, ?, ?, ?)`,
        [head, definition, packId, JSON.stringify({ traditional, simplified, pinyin })],
      );
      count += 1;
    }
  }
  await bumpPackCount(packId, count);
  console.log('Imported CEDICT', { packId, count });
  return { packId, count };
}

/**
 * Download CC-CEDICT (.txt.gz), gunzip via zlib, import.
 * User must agree — call only after explicit UI confirmation.
 */
export async function downloadAndImportCedict(): Promise<{ packId: string; count: number }> {
  await ensureOfflineReady();
  const zlib = await import('zlib');
  const { promisify } = await import('util');
  const gunzip = promisify(zlib.gunzip);

  console.log('Downloading CC-CEDICT…', CEDICT_URL);
  const response = await net.fetch(CEDICT_URL, {
    headers: { 'User-Agent': 'Phevere/1.0 (offline dictionary import)' },
  });
  if (!response.ok) {
    throw new Error(`CEDICT download failed: HTTP ${response.status}`);
  }
  const compressed = Buffer.from(await response.arrayBuffer());
  const textBuf = await gunzip(compressed);
  const tmp = require('path').join(require('os').tmpdir(), `phevere-cedict-${Date.now()}.txt`);
  fs.writeFileSync(tmp, textBuf);
  try {
    return await importCedictTextFile(tmp, 'cc-cedict');
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'upload';
}
