import {
  dictionaryService,
  getHttp,
  parseFreedictTei,
  parseGcideCide,
  parseWordNetData,
  type OfflineHit,
  type ParsedOfflineEntry,
} from '@phevere/core';
import { getSqlDatabase, markDbDirty, sqlJsVocabDb } from './sqljs-vocab-db';

export type OfflineCatalogItem = {
  id: string;
  name: string;
  language: string;
  license: string;
  summary: string;
  sizeHint: string;
  consent: string;
  urls: string[];
  kind: 'cedict' | 'wordnet' | 'gcide' | 'freedict-tei';
};

export const OFFLINE_CATALOG: OfflineCatalogItem[] = [
  {
    id: 'wordnet-3.1',
    name: 'Princeton WordNet 3.1',
    language: 'en',
    license: 'WordNet License (Princeton University)',
    summary: 'Academic English glosses and synonym sets.',
    sizeHint: '~16 MB download',
    consent: 'Download Princeton WordNet 3.1 from wordnetcode.princeton.edu? WordNet License. Import may take a minute.',
    urls: ['https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz'],
    kind: 'wordnet',
  },
  {
    id: 'webster-1913',
    name: "Webster's Unabridged 1913 (GCIDE)",
    language: 'en',
    license: 'GPL-3+ (GNU GCIDE)',
    summary: "Webster's Revised Unabridged Dictionary (1913).",
    sizeHint: '~18 MB download',
    consent: "Download GNU GCIDE from ftp.gnu.org? GPL-3+. File is large; import may take a few minutes.",
    urls: [
      'https://ftp.gnu.org/gnu/gcide/gcide-0.53.tar.gz',
      'https://mirrors.kernel.org/gnu/gcide/gcide-0.53.tar.gz',
    ],
    kind: 'gcide',
  },
  {
    id: 'cc-cedict',
    name: 'CC-CEDICT',
    language: 'zh',
    license: 'CC BY-SA 4.0',
    summary: 'Community Chinese–English dictionary.',
    sizeHint: 'large; import may take a minute',
    consent: 'Download CC-CEDICT from mdbg.net? Creative Commons Attribution-ShareAlike 4.0.',
    urls: ['https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz'],
    kind: 'cedict',
  },
  {
    id: 'freedict-eng-zho',
    name: 'FreeDict English–Chinese',
    language: 'en',
    license: 'GPL (FreeDict)',
    summary: 'English headwords with Chinese glosses. Auto-download is xz; import a .tei from Files if the download cannot unpack.',
    sizeHint: '~2 MB',
    consent: 'FreeDict English–Chinese is GPL. Prefer importing the .tei if xz unpack fails.',
    urls: ['https://download.freedict.org/dictionaries/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.src.tar.xz'],
    kind: 'freedict-tei',
  },
];

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
    throw new Error('This WebView cannot gunzip archives');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readOctal(buf: Uint8Array, start: number, len: number): number {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf[start + i];
    if (!c || c === 32) continue;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
}

function readCString(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  const max = start + len;
  while (end < max && buf[end] !== 0) end += 1;
  return new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(start, end));
}

function extractTar(bytes: Uint8Array, want: (name: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header[0] === 0) break;
    const name = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    const size = readOctal(header, 124, 12);
    const type = header[156];
    offset += 512;
    const data = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === 53 || type === '5'.charCodeAt(0)) continue;
    const base = full.split(/[/\\]/).pop() || full;
    if (want(base) || want(full)) out.set(base, decoder.decode(data));
  }
  return out;
}

function parseCedict(text: string): ParsedOfflineEntry[] {
  const entries: ParsedOfflineEntry[] = [];
  for (const line of text.split(/\n/)) {
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
  return entries;
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

export async function importTextPack(
  item: OfflineCatalogItem,
  text: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ packId: string; count: number }> {
  let entries: ParsedOfflineEntry[] = [];
  if (item.kind === 'cedict') entries = parseCedict(text);
  else if (item.kind === 'wordnet') entries = parseWordNetData(text);
  else if (item.kind === 'gcide') entries = parseGcideCide(text);
  else entries = parseFreedictTei(text);
  return writePack(
    { id: item.id, name: item.name, language: item.language, source: 'import' },
    entries,
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
  if (item.kind === 'cedict') {
    onProgress?.('Unpacking…');
    const text = new TextDecoder('utf-8').decode(await gunzip(bytes));
    return importTextPack(item, text, (d, t) => onProgress?.(`Importing ${d}/${t}`));
  }
  if (item.kind === 'freedict-tei') {
    throw new Error('This pack is an .xz archive. Import the .tei from Files instead.');
  }
  onProgress?.('Unpacking archive…');
  const unpacked = extractTar(await gunzip(bytes), (name) => {
    if (item.kind === 'wordnet') return /^data\.(noun|verb|adj|adv)$/i.test(name);
    return /^CIDE\.[A-Z]$/i.test(name);
  });
  if (!unpacked.size) throw new Error('Archive had no dictionary files');
  const joined = [...unpacked.values()].join('\n');
  return importTextPack(item, joined, (d, t) => onProgress?.(`Importing ${d}/${t}`));
}

export async function importUserFile(name: string, text: string): Promise<{ packId: string; count: number }> {
  const lower = name.toLowerCase();
  if (lower.includes('cedict') || /\.(u8|txt)$/.test(lower)) {
    const item = OFFLINE_CATALOG.find((c) => c.id === 'cc-cedict')!;
    return importTextPack(item, text);
  }
  if (lower.endsWith('.tei')) {
    const item = OFFLINE_CATALOG.find((c) => c.id === 'freedict-eng-zho')!;
    return importTextPack(item, text);
  }
  if (/cide/i.test(lower)) {
    const item = OFFLINE_CATALOG.find((c) => c.id === 'webster-1913')!;
    return importTextPack(item, text);
  }
  const item = OFFLINE_CATALOG.find((c) => c.id === 'wordnet-3.1')!;
  return importTextPack(item, text);
}

export async function markInstalledPacksOnCore(): Promise<void> {
  const list = await listCatalogStatus();
  for (const pack of list.filter((p) => p.installed)) {
    dictionaryService.markOfflinePackAvailable(pack.id === 'cc-cedict' ? 'CC-CEDICT' : pack.name, true);
  }
}
