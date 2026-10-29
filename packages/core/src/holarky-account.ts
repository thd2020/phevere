// Vendored from github.com/thd2020/holarky-account, packages/client/src/index.ts at c27bbc4.
// Edit it there and copy it here; do not change this copy on its own.

// Holarky account client. One dependency-free file shared by every Holarky app (browser, Electron,
// Capacitor-style WebViews). Apps vendor a copy of this file; the source of truth is
// github.com/thd2020/holarky-account/packages/client/src/index.ts.
//
// Identity is Auth0 (Universal Login); profile and sync are the Holarky API. Sign-in uses OAuth 2.0
// authorization code + PKCE in the system browser (RFC 8252) or, on the web, the same tab:
//   const url = await account.beginSignIn();   // open it
//   await account.completeSignIn(callbackUrl);  // when the browser comes back with ?code=
// After that, account.fetch() calls the Holarky API and refreshes tokens as needed.

export interface HolarkyUser {
  /** Auth0 user id, e.g. "google-oauth2|1234". Stable for the life of the account. */
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface HolarkySession {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  user: HolarkyUser;
}

/** Where the client keeps its session. Values are strings; methods may be sync or async. */
export interface KeyValueStorage {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export interface SyncChange<T = unknown> {
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: T | null;
}

export interface SyncResult<T = unknown> {
  changes: SyncChange<T>[];
  cursor: number;
  more: boolean;
}

export interface HolarkyAccountOptions {
  /** Auth0 tenant host, e.g. "pyridoxeer.us.auth0.com". */
  domain: string;
  /** The app's Auth0 client id. */
  clientId: string;
  /** Holarky API identifier in Auth0, e.g. "https://api.holarky.app". */
  audience: string;
  /** Holarky API origin, e.g. "https://holarky-api.example.workers.dev". */
  apiBase: string;
  /** Where the browser returns after sign-in. Desktop loopback apps can pass one per sign-in instead. */
  redirectUri?: string;
  storage: KeyValueStorage;
  /** Storage key prefix. */
  storageKey?: string;
  fetch?: typeof fetch;
  /** Web Crypto. Defaults to globalThis.crypto (pass require('node:crypto').webcrypto on Node 18). */
  webCrypto?: Crypto;
  now?: () => number;
  /**
   * Serialises token refreshes across tabs or processes that share storage. Defaults to the Web
   * Locks API where it exists. Refresh tokens rotate, so parallel refreshes could sign out.
   */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export class HolarkyAccountError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.name = 'HolarkyAccountError';
    this.code = code;
    this.status = status;
  }
}

interface PendingSignIn {
  verifier: string;
  state: string;
  redirectUri: string;
}

type Listener = (user: HolarkyUser | null) => void;

const REFRESH_MARGIN_MS = 60_000;
const SCOPE = 'openid profile email offline_access';

export class HolarkyAccount {
  private readonly domain: string;
  private readonly clientId: string;
  private readonly audience: string;
  private readonly apiBase: string;
  private readonly redirectUri: string | undefined;
  private readonly storage: KeyValueStorage;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly webCrypto: Crypto;
  private readonly now: () => number;
  private readonly lock: <T>(fn: () => Promise<T>) => Promise<T>;
  private readonly listeners = new Set<Listener>();
  private refreshing: Promise<HolarkySession | null> | null = null;

  constructor(opts: HolarkyAccountOptions) {
    this.domain = opts.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    this.clientId = opts.clientId;
    this.audience = opts.audience;
    this.apiBase = opts.apiBase.replace(/\/+$/, '');
    this.redirectUri = opts.redirectUri;
    this.storage = opts.storage;
    this.key = opts.storageKey ?? 'holarky-account';
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.webCrypto = opts.webCrypto ?? globalThis.crypto;
    this.now = opts.now ?? Date.now;
    this.lock = opts.lock ?? defaultLock(`${this.key}:refresh`);
  }

  // ---- State ----

  async getSession(): Promise<HolarkySession | null> {
    const raw = await this.storage.get(`${this.key}:session`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as HolarkySession;
    } catch {
      return null;
    }
  }

  /** The signed-in user as last seen, or null. Works offline. */
  async getUser(): Promise<HolarkyUser | null> {
    return (await this.getSession())?.user ?? null;
  }

  /** Called with the user after sign-in, profile changes and sign-out (null). Returns an unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async save(session: HolarkySession | null): Promise<void> {
    if (session) await this.storage.set(`${this.key}:session`, JSON.stringify(session));
    else await this.storage.remove(`${this.key}:session`);
    for (const l of this.listeners) l(session?.user ?? null);
  }

  // ---- Sign-in ----

  /**
   * Returns the address to open in a browser. Pass redirectUri for loopback apps; pass
   * screen: 'signup' to open on the sign-up form, prompt: 'login' to force the sign-in form.
   */
  async beginSignIn(opts: { redirectUri?: string; prompt?: 'login'; screen?: 'signup' } = {}): Promise<string> {
    const redirectUri = opts.redirectUri ?? this.redirectUri;
    if (!redirectUri) throw new Error('HolarkyAccount: redirectUri is required');
    const verifier = randomString(this.webCrypto, 32);
    const state = randomString(this.webCrypto, 16);
    const pending: PendingSignIn = { verifier, state, redirectUri };
    await this.storage.set(`${this.key}:pending`, JSON.stringify(pending));
    const u = new URL(`https://${this.domain}/authorize`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('audience', this.audience);
    u.searchParams.set('scope', SCOPE);
    u.searchParams.set('code_challenge', await pkceChallenge(this.webCrypto, verifier));
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('state', state);
    if (opts.prompt) u.searchParams.set('prompt', opts.prompt);
    if (opts.screen) u.searchParams.set('screen_hint', opts.screen);
    return u.toString();
  }

  /** True when this address is the browser coming back from a sign-in this client started. */
  async isSignInCallback(callbackUrl: string): Promise<boolean> {
    const pending = await this.loadPending();
    if (!pending) return false;
    const p = new URL(callbackUrl).searchParams;
    return p.get('state') === pending.state && (p.has('code') || p.has('error'));
  }

  /** Finishes sign-in from the address the browser returned to. */
  async completeSignIn(callbackUrl: string): Promise<HolarkyUser> {
    const pending = await this.loadPending();
    if (!pending) throw new HolarkyAccountError('no_pending_sign_in', 0, 'No sign-in is in progress.');
    const p = new URL(callbackUrl).searchParams;
    if (p.get('state') !== pending.state) throw new HolarkyAccountError('state_mismatch', 0, 'This sign-in response does not belong to this app.');
    await this.storage.remove(`${this.key}:pending`);
    const error = p.get('error');
    if (error) throw new HolarkyAccountError(error, 0, p.get('error_description') || `Sign-in failed: ${error}`);
    const code = p.get('code');
    if (!code) throw new HolarkyAccountError('invalid_response', 0, 'The sign-in response had no code.');
    const session = await this.tokenRequest(
      { grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier },
      null,
    );
    await this.save(session);
    return session.user;
  }

  private async loadPending(): Promise<PendingSignIn | null> {
    const raw = await this.storage.get(`${this.key}:pending`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingSignIn;
    } catch {
      return null;
    }
  }

  /**
   * Signs out on this device and revokes the refresh token (best effort). The browser stays signed
   * in to Holarky for other apps; to end that too, also open logoutUrl().
   */
  async signOut(): Promise<void> {
    const session = await this.getSession();
    await this.save(null);
    if (!session) return;
    try {
      await this.fetchImpl(`https://${this.domain}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: this.clientId, token: session.refreshToken }),
      });
    } catch {
      // Offline: the token expires on its own.
    }
  }

  /** Address that ends the browser's Holarky session and then returns to `returnTo` (must be registered in Auth0). */
  logoutUrl(returnTo: string): string {
    const u = new URL(`https://${this.domain}/v2/logout`);
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('returnTo', returnTo);
    return u.toString();
  }

  // ---- Tokens ----

  /** A valid access token, refreshing it if needed; null when signed out. Throws on network failure. */
  async getAccessToken(): Promise<string | null> {
    const session = await this.getSession();
    if (!session) return null;
    if (session.expiresAt - REFRESH_MARGIN_MS > this.now()) return session.accessToken;
    return (await this.refresh(session))?.accessToken ?? null;
  }

  private refresh(stale: HolarkySession): Promise<HolarkySession | null> {
    if (!this.refreshing) {
      this.refreshing = this.lock(async () => {
        // Another tab or process may have refreshed while we waited for the lock.
        const current = await this.getSession();
        if (!current) return null;
        if (current.refreshToken !== stale.refreshToken && current.expiresAt - REFRESH_MARGIN_MS > this.now()) return current;
        try {
          const next = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refreshToken }, current);
          await this.save(next);
          return next;
        } catch (err) {
          if (err instanceof HolarkyAccountError && err.code === 'invalid_grant') {
            await this.save(null); // The sign-in was revoked or expired.
            return null;
          }
          throw err;
        }
      }).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async tokenRequest(params: Record<string, string>, previous: HolarkySession | null): Promise<HolarkySession> {
    const res = await this.fetchImpl(`https://${this.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: this.clientId }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new HolarkyAccountError(String(body.error ?? 'token_error'), res.status, typeof body.error_description === 'string' ? body.error_description : undefined);
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : previous?.refreshToken;
    if (!refreshToken) throw new HolarkyAccountError('no_refresh_token', res.status, 'The Auth0 app must allow offline access (refresh tokens).');
    const user = typeof body.id_token === 'string' ? userFromIdToken(body.id_token) : previous?.user;
    if (!user) throw new HolarkyAccountError('no_id_token', res.status);
    // Keep a name chosen in Holarky (it comes from the API, not the ID token).
    if (previous && previous.user.id === user.id && previous.user.name !== user.name) user.name = previous.user.name;
    return { accessToken: String(body.access_token), refreshToken, expiresAt: this.now() + Number(body.expires_in) * 1000, user };
  }

  // ---- Holarky API ----

  /** fetch() against the Holarky API with the access token. Retries once after a refresh on 401. */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      return this.fetchImpl(`${this.apiBase}${path}`, { ...init, headers });
    };
    const token = await this.getAccessToken();
    if (!token) throw new HolarkyAccountError('signed_out', 401, 'Not signed in.');
    const res = await send(token);
    if (res.status !== 401) return res;
    const session = await this.getSession();
    const fresh = session ? await this.refresh({ ...session, expiresAt: 0 }) : null;
    if (!fresh) throw new HolarkyAccountError('signed_out', 401, 'Not signed in.');
    return send(fresh.accessToken);
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetch(path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HolarkyAccountError(String((body as { error?: unknown }).error ?? 'request_failed'), res.status);
    return body as T;
  }

  /** Reloads the profile from the Holarky API and stores it. */
  async refreshUser(): Promise<HolarkyUser> {
    return this.storeUser(await this.json<HolarkyUser>('/v1/me'));
  }

  /** Changes the name shown in Holarky apps (null goes back to the name from the sign-in provider). */
  async updateProfile(patch: { name: string | null }): Promise<HolarkyUser> {
    return this.storeUser(
      await this.json<HolarkyUser>('/v1/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }),
    );
  }

  /** Deletes the Holarky account everywhere (identity, profile, synced data) and signs out. */
  async deleteAccount(confirmEmail: string): Promise<void> {
    await this.json('/v1/me', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmEmail }) });
    await this.save(null);
  }

  private async storeUser(api: HolarkyUser): Promise<HolarkyUser> {
    const user: HolarkyUser = { id: api.id, email: api.email, name: api.name, avatarUrl: api.avatarUrl, emailVerified: api.emailVerified };
    const session = await this.getSession();
    if (session) await this.save({ ...session, user });
    return user;
  }

  /**
   * Sends local changes and receives everything newer than `cursor` for one collection, e.g.
   * sync('phevere/vocab', ...). Records merge last-writer-wins by updatedAt. Call again with the
   * returned cursor while `more` is true.
   */
  async sync<T>(namespace: string, cursor: number, changes: SyncChange<T>[]): Promise<SyncResult<T>> {
    return this.json<SyncResult<T>>(`/v1/sync/${namespace}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cursor, changes }),
    });
  }
}

// ---- Helpers ----

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(c: Crypto, bytes: number): string {
  return base64url(c.getRandomValues(new Uint8Array(bytes)));
}

async function pkceChallenge(c: Crypto, verifier: string): Promise<string> {
  return base64url(new Uint8Array(await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/**
 * Reads the user from the ID token. It arrives straight from Auth0's token endpoint over TLS, so
 * OpenID Connect Core §3.1.3.7 lets the client use it without checking the signature.
 */
function userFromIdToken(idToken: string): HolarkyUser {
  const part = idToken.split('.')[1] ?? '';
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const c = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  const email = typeof c.email === 'string' ? c.email : '';
  return {
    id: String(c.sub),
    email,
    name: String(c.name || c.nickname || email.split('@')[0] || 'Holarky player'),
    avatarUrl: typeof c.picture === 'string' ? c.picture : null,
    emailVerified: c.email_verified === true,
  };
}

function defaultLock(name: string): <T>(fn: () => Promise<T>) => Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request(name: string, cb: () => Promise<unknown>): Promise<unknown> } } }).navigator?.locks;
  if (locks) return <T>(fn: () => Promise<T>) => locks.request(name, fn) as Promise<T>;
  return (fn) => fn();
}

/** localStorage-backed storage for browser apps. */
export function browserStorage(store: Storage = globalThis.localStorage): KeyValueStorage {
  return {
    get: (k) => store.getItem(k),
    set: (k, v) => store.setItem(k, v),
    remove: (k) => store.removeItem(k),
  };
}
