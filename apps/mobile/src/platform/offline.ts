import {
  catalogFor,
  dictionaryService,
  extractTar,
  getHttp,
  isXz,
  KengdicCollector,
  parseCedict,
  parseFreedictTei,
  parseGcideCide,
  parseJmdictJson,
  parseWordNetData,
  wantsArchiveMember,
  xzDecompress,
  type OfflineCatalogItem,
  type OfflineHit,
  type ParsedOfflineEntry,
} from '@phevere/core';
import { getSqlDatabase, markDbDirty, sqlJsVocabDb } from './sqljs-vocab-db';

export type { OfflineCatalogItem };

/** Packs the phone can unpack and hold; the 450 MB German TEI and full JMdict stay on desktop. */
export const OFFLINE_CATALOG: OfflineCatalogItem[] = catalogFor('phone');

export type CatalogStatus = OfflineCatalogItem & { installed: boolean; entryCount: number };

const INSERT_SQL =
  'INSERT INTO offline_entries (headword, language, pos, definition, pack_id, extra) VALUES (?, ?, ?, ?, ?, ?)';

export async function lookupOfflineHits(
  headword: string,
  language?: string,
  limit = 20,
  extraForms: string[] = [],
): Promise<OfflineHit[]> {
  await sqlJsVocabDb.ready();
  const q = (headword || '').trim();
  if (!q) return [];
  const forms = Array.from(
    new Set([q, ...extraForms].map((f) => (f || '').trim()).filter((f) => f && f.length <= 80)),
  );
  const matchSql = forms.map(() => 'e.headword = ? COLLATE NOCASE').join(' OR ');
  const rows = language
    ? await sqlJsVocabDb.queryAll(
        `SELECT e.*, p.name AS pack_name FROM offline_entries e
         LEFT JOIN offline_packs p ON p.id = e.pack_id
         WHERE (${matchSql}) AND e.language = ? LIMIT ?`,
        [...forms, language, limit],
      )
    : await sqlJsVocabDb.queryAll(
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

export async function listCatalogStatus(): Promise<CatalogStatus[]> {
  await sqlJsVocabDb.ready();
  const rows = await sqlJsVocabDb.queryAll(`SELECT * FROM offline_packs ORDER BY created_at DESC`);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  return OFFLINE_CATALOG.map((c) => {
    const hit = byId.get(c.id);
    return {
      ...c,
      installed: Boolean(hit),
      entryCount: hit ? Number(hit.entry_count) || 0 : 0,
    };
  });
}

export async function removePack(packId: string): Promise<void> {
  await sqlJsVocabDb.ready();
  await sqlJsVocabDb.runWrite(`DELETE FROM offline_entries WHERE pack_id = ?`, [packId]);
  await sqlJsVocabDb.runWrite(`DELETE FROM offline_packs WHERE id = ?`, [packId]);
}

async function writePack(
  meta: { id: string; name: string; language: string; source?: string },
  entries: ParsedOfflineEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ packId: string; count: number }> {
  await sqlJsVocabDb.ready();
  const database = getSqlDatabase();
  if (!database) throw new Error('notebook db not open');
  if (!entries.length) throw new Error(`No entries parsed for ${meta.name}`);

  database.run(`DELETE FROM offline_entries WHERE pack_id = ?`, [meta.id]);
  database.run(`DELETE FROM offline_packs WHERE id = ?`, [meta.id]);
  database.run(
    `INSERT INTO offline_packs (id, name, language, source, entry_count, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
    [meta.id, meta.name, meta.language, meta.source || null, Date.now()],
  );

  const stmt = database.prepare(INSERT_SQL);
  const chunk = 800;
  try {
    database.run('BEGIN');
    for (let i = 0; i < entries.length; i++) {
      const r = entries[i];
      stmt.bind([
        r.headword,
        r.language,
        r.pos || null,
        r.definition,
        meta.id,
        r.extra != null ? JSON.stringify(r.extra) : null,
      ]);
      stmt.step();
      stmt.reset();
      if (i > 0 && i % chunk === 0) {
        database.run('COMMIT');
        database.run('BEGIN');
        onProgress?.(i, entries.length);
      }
    }
    database.run('COMMIT');
  } catch (err) {
    try {
      database.run('ROLLBACK');
    } catch {
      /* ignore */
    }
    database.run(`DELETE FROM offline_entries WHERE pack_id = ?`, [meta.id]);
    database.run(`DELETE FROM offline_packs WHERE id = ?`, [meta.id]);
    throw err;
  } finally {
    stmt.free();
  }
  database.run(`UPDATE offline_packs SET entry_count = ? WHERE id = ?`, [entries.length, meta.id]);
  markDbDirty();
  dictionaryService.markOfflinePackAvailable(meta.name === 'CC-CEDICT' ? 'CC-CEDICT' : meta.name, true);
  onProgress?.(entries.length, entries.length);
  return { packId: meta.id, count: entries.length };
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This pack cannot be installed here.');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function downloadFirst(urls: string[]): Promise<Uint8Array> {
  const http = getHttp();
  let last = 'no URLs';
  for (const url of urls) {
    try {
      const res = await http.requestBytes(url, { timeoutMs: 120_000 });
      if (!res.ok) {
        last = `HTTP ${res.status} (${url})`;
        continue;
      }
      return res.bytes;
    } catch (err) {
      last = `${url}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(`Download failed: ${last}`);
}

function parsePack(item: OfflineCatalogItem, text: string): ParsedOfflineEntry[] {
  switch (item.format) {
    case 'cedict':
      return parseCedict(text);
    case 'wordnet':
      return parseWordNetData(text);
    case 'gcide':
      return parseGcideCide(text);
    case 'jmdict':
      return parseJmdictJson(text);
    case 'kengdic': {
      const c = new KengdicCollector();
      for (const line of text.split(/\r?\n/)) c.addLine(line);
      return c.entries();
    }
    default:
      return parseFreedictTei(text, item.language);
  }
}

export async function importTextPack(
  item: OfflineCatalogItem,
  text: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ packId: string; count: number }> {
  return writePack(
    { id: item.id, name: item.name, language: item.language, source: 'import' },
    parsePack(item, text),
    onProgress,
  );
}

export async function downloadCatalogPack(
  packId: string,
  onProgress?: (msg: string) => void,
): Promise<{ packId: string; count: number }> {
  const item = OFFLINE_CATALOG.find((c) => c.id === packId);
  if (!item) throw new Error(`Unknown pack ${packId}`);
  onProgress?.('Downloading…');
  const bytes = await downloadFirst(item.urls);
  const decoder = new TextDecoder('utf-8');
  const progress = (d: number, t: number) => onProgress?.(`Importing ${d} of ${t}…`);
  if (item.archive === 'plain') {
    return importTextPack(item, decoder.decode(bytes), progress);
  }
  onProgress?.('Unpacking…');
  if (item.archive === 'gz') {
    return importTextPack(item, decoder.decode(await gunzip(bytes)), progress);
  }
  const tar = item.archive === 'tar.xz' || isXz(bytes) ? xzDecompress(bytes) : await gunzip(bytes);
  const files = extractTar(tar, (name) => wantsArchiveMember(item.format, name));
  if (!files.length) throw new Error('Archive had no dictionary files');
  const joined = files.map((f) => decoder.decode(f.bytes)).join('\n');
  return importTextPack(item, joined, progress);
}

/** Which catalog pack a picked file belongs to, by its name and first bytes. */
function packForFile(name: string, text: string, kind?: 'cedict'): OfflineCatalogItem {
  const lower = name.toLowerCase();
  const byId = (id: string) => OFFLINE_CATALOG.find((c) => c.id === id)!;
  if (kind === 'cedict' || lower.includes('cedict') || /\.u8$/.test(lower)) return byId('cc-cedict');
  if (lower.endsWith('.tei')) {
    const pair = (lower.match(/([a-z]{3}-[a-z]{3})\.tei$/) || [])[1];
    return OFFLINE_CATALOG.find((c) => c.id === `freedict-${pair}`) || byId('freedict-eng-zho');
  }
  if (lower.endsWith('.json') && text.includes('"words"')) return byId('jmdict-eng-common');
  if (lower.endsWith('.tsv') || lower.includes('kengdic')) return byId('kengdic');
  if (/cide/i.test(lower)) return byId('webster-1913');
  if (/\.txt$/.test(lower)) return byId('cc-cedict');
  return byId('wordnet-3.1');
}

export async function importUserFile(
  name: string,
  text: string,
  kind?: 'cedict',
): Promise<{ packId: string; count: number }> {
  return importTextPack(packForFile(name, text, kind), text);
}

export async function markInstalledPacksOnCore(): Promise<void> {
  const list = await listCatalogStatus();
  for (const pack of list.filter((p) => p.installed)) {
    dictionaryService.markOfflinePackAvailable(pack.id === 'cc-cedict' ? 'CC-CEDICT' : pack.name, true);
  }
}
