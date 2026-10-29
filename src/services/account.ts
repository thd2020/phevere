/**
 * Holarky account on desktop (userData/holarky-account.json).
 * Sign-in opens Holarky's Auth0 sign-in page in the default browser, which returns to a one-shot
 * port on 127.0.0.1 (RFC 8252 loopback redirect). Auth0 does not accept a random port, so the
 * first free of LOOPBACK_PORTS is used; all three are registered. The session is encrypted with
 * safeStorage.
 */

import { app, safeStorage, shell } from 'electron';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { webcrypto } from 'crypto';
import {
  AccountController,
  HOLARKY_ACCOUNT,
  HolarkyAccount,
  getHttp,
  httpClientFetch,
  resolveAccountApi,
  type AccountState,
  type KeyValueStorage,
} from '@phevere/core';
import { log } from '../logger';

const FILE_NAME = 'holarky-account.json';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const LOOPBACK_PORTS = [47231, 47232, 47233];

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

/** Key-value file, encrypted as a whole when the OS keychain is available. */
function fileStorage(): KeyValueStorage {
  let cache: Record<string, string> | null = null;
  let warned = false;
  const encrypt = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };
  const load = (): Record<string, string> => {
    if (cache) return cache;
    cache = {};
    try {
      const p = resolvePath();
      if (!fs.existsSync(p)) return cache;
      const file = JSON.parse(fs.readFileSync(p, 'utf8')) as { enc?: string; plain?: Record<string, string> };
      if (file.enc) cache = JSON.parse(safeStorage.decryptString(Buffer.from(file.enc, 'base64')));
      else if (file.plain) cache = file.plain;
    } catch (err) {
      log.warn('account', 'Could not read the saved sign-in; signing out', { err: String(err) });
      cache = {};
    }
    return cache;
  };
  const save = () => {
    const data = load();
    let body: string;
    if (encrypt()) {
      body = JSON.stringify({ enc: safeStorage.encryptString(JSON.stringify(data)).toString('base64') });
    } else {
      if (!warned) log.warn('account', 'OS encryption unavailable; sign-in saved unencrypted (owner-only file)');
      warned = true;
      body = JSON.stringify({ plain: data });
    }
    fs.writeFileSync(resolvePath(), body, { encoding: 'utf8', mode: 0o600 });
  };
  return {
    get: (key) => load()[key] ?? null,
    set: (key, value) => {
      load()[key] = value;
      save();
    },
    remove: (key) => {
      delete load()[key];
      save();
    },
  };
}

let controller: AccountController | null = null;
let abortSignIn: (() => void) | null = null;

export function initAccount(hooks: { onState: (state: AccountState) => void; onNotebookChanged: () => void }): void {
  const apiBase = resolveAccountApi(process.env.PHEVERE_ACCOUNT_API);
  const storage = fileStorage();
  const account = apiBase
    ? new HolarkyAccount({
        domain: HOLARKY_ACCOUNT.domain,
        audience: HOLARKY_ACCOUNT.audience,
        clientId: HOLARKY_ACCOUNT.clientIds.desktop,
        apiBase,
        storage,
        fetch: httpClientFetch(getHttp()),
        // Electron 28's Node may not expose globalThis.crypto.
        webCrypto: webcrypto as unknown as Crypto,
      })
    : null;
  if (!apiBase) log.info('account', 'No Holarky API configured; sign-in is off');
  controller = new AccountController({
    account,
    meta: storage,
    onState: hooks.onState,
    onNotebookChanged: () => hooks.onNotebookChanged(),
    log: (message, detail) => log.warn('account', message, { detail }),
  });
  void controller.init().catch((err) => log.warn('account', 'init failed', { err: String(err) }));
}

export function getAccountState(): AccountState | null {
  return controller ? controller.getState() : null;
}

export function signIn(): Promise<void> {
  if (!controller) return Promise.resolve();
  return controller.signIn((account) => loopbackSignIn(account));
}

export function cancelSignIn(): void {
  abortSignIn?.();
  controller?.cancelSignIn();
}

export function signOut(): Promise<void> {
  return controller ? controller.signOut() : Promise.resolve();
}

export function syncNow(): Promise<void> {
  return controller ? controller.syncNow() : Promise.resolve();
}

export function disposeAccount(): void {
  controller?.dispose();
}

async function loopbackSignIn(account: HolarkyAccount): Promise<void> {
  const { server, port } = await listenOnFreePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  try {
    const callback = new Promise<{ url: string; res: http.ServerResponse }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in timed out. Try again.')), SIGN_IN_TIMEOUT_MS);
      abortSignIn = () => {
        clearTimeout(timer);
        reject(new Error('Sign-in cancelled.'));
      };
      server.on('request', (req, res) => {
        const url = new URL(req.url || '/', redirectUri);
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        clearTimeout(timer);
        resolve({ url: url.toString(), res });
      });
    });
    callback.catch((): void => undefined); // rejected before we await it when cancelled early
    await shell.openExternal(await account.beginSignIn({ redirectUri }));
    const { url, res } = await callback;
    try {
      await account.completeSignIn(url);
      respond(res, 'Signed in to phevere', 'You can close this tab and go back to phevere.');
    } catch (err) {
      respond(res, 'Sign-in did not finish', 'Go back to phevere and try again.');
      throw err;
    }
  } finally {
    abortSignIn = null;
    server.close();
  }
}

async function listenOnFreePort(): Promise<{ server: http.Server; port: number }> {
  for (const port of LOOPBACK_PORTS) {
    const server = http.createServer();
    const ok = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) return { server, port };
  }
  throw new Error(`Sign-in needs one of the local ports ${LOOPBACK_PORTS.join(', ')}, and all are in use. Close the program using them and try again.`);
}

function respond(res: http.ServerResponse, title: string, message: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f3ee;color:#1c1917}
main{max-width:360px;padding:28px;text-align:center}h1{font-size:1.3rem;margin:0 0 8px}p{margin:0;color:#57534e}
@media (prefers-color-scheme: dark){body{background:#1c1917;color:#f5f5f4}p{color:#a8a29e}}</style>
<main><h1>${title}</h1><p>${message}</p></main>`);
}
