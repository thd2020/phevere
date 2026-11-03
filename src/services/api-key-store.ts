/**
 * Settings → API keys, kept across restarts in userData/api-keys.json. Each value is encrypted
 * with Electron's safeStorage (DPAPI on Windows, the Keychain on macOS, the secret service on
 * Linux), so the file alone does not reveal a key. Where encryption is unavailable nothing is
 * written, and keys last until the app quits, as before.
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** The credential fields `DictionaryService.setApiCredential` accepts. */
export const API_KEY_FIELDS = [
  'googleKey', 'deeplKey', 'youdaoKey', 'youdaoSecret', 'oxfordId', 'oxfordKey', 'wordsKey', 'collinsKey', 'collinsHost',
] as const;

const FILE_NAME = 'api-keys.json';

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function readAll(): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Every saved credential, decrypted. Fields that fail to decrypt are skipped. */
export function loadApiKeys(): Array<[field: string, value: string]> {
  if (!safeStorage.isEncryptionAvailable()) return [];
  const out: Array<[string, string]> = [];
  for (const [field, enc] of Object.entries(readAll())) {
    if (!(API_KEY_FIELDS as readonly string[]).includes(field) || typeof enc !== 'string') continue;
    try {
      const value = safeStorage.decryptString(Buffer.from(enc, 'base64'));
      if (value) out.push([field, value]);
    } catch {
      /* written by another user or machine: ignore it */
    }
  }
  return out;
}

/** Save one credential, or remove it when `value` is empty. */
export function saveApiKey(field: string, value: string): void {
  if (!(API_KEY_FIELDS as readonly string[]).includes(field) || !safeStorage.isEncryptionAvailable()) return;
  const all = readAll();
  const v = String(value ?? '').trim();
  if (v) all[field] = safeStorage.encryptString(v).toString('base64');
  else delete all[field];
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(all, null, 2), 'utf8');
  } catch {
    /* unwritable profile: the key still works until the app quits */
  }
}
