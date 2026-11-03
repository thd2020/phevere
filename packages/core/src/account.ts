/**
 * Holarky account for phevere: one account across Holarky apps (phevere, knowrld), used here to
 * sync the notebook. Platform code supplies storage and the sign-in transport (a loopback port on
 * desktop, the system browser and an app link on mobile); everything else is shared.
 */

import { HolarkyAccount, HolarkyAccountError, type HolarkyUser, type KeyValueStorage } from './holarky-account';
import type { HttpClient } from './http';
import { onVocabChanged } from './vocab-store';
import { syncVocab, type VocabSyncResult } from './vocab-sync';
import { syncWordbooks } from './wordbook-sync';
import { PROGRESS_SYNC_NAMESPACE, syncProgress } from './progress-sync';

/**
 * The Holarky account. Identity is the Holarky Auth0 tenant; profile and sync are the Holarky API.
 * Client ids are public: they identify the app, not a secret (holarky-account/auth0/tenant.json).
 */
export const HOLARKY_ACCOUNT = {
  domain: 'pyridoxeer.us.auth0.com',
  audience: 'https://api.holarky.app',
  clientIds: { desktop: 'AciQpYMD0MGdadmLcCOPNlhUt1cCsJjN', mobile: 'HsHtoivEQhzTJjmJPSRNQ5MxkreUhiqO' },
  /**
   * The deployed Holarky API, e.g. https://holarky-api.<subdomain>.workers.dev. Empty means sign-in
   * is off in this build. Desktop overrides it with the PHEVERE_ACCOUNT_API environment variable,
   * mobile with VITE_PHEVERE_ACCOUNT_API at build time. See docs/ACCOUNT.md.
   */
  apiBase: 'https://holarky-api.thdfreelancer.workers.dev',
  /**
   * Where "Get Plus" leads. A placeholder until checkout exists (Paddle for most buyers, 爱发电 in
   * China; holarky-account docs/PAYMENTS.md describes both).
   */
  plusUrl: 'https://holarky.app/plus',
};

/** The Holarky API address to use, or null when sign-in is not configured. */
export function resolveAccountApi(override?: string | null): string | null {
  const raw = String(override || HOLARKY_ACCOUNT.apiBase || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * fetch() on top of core's HttpClient, so account calls go through the same transport as
 * lookups (node-fetch on desktop, the native bridge on mobile).
 */
export function httpClientFetch(http: HttpClient): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const res = await http.requestText(String(input), {
      method: init?.method || 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      timeoutMs: 20_000,
    });
    const empty = res.status === 204 || res.status === 205 || res.status === 304;
    return new Response(empty ? null : res.text, { status: res.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

export interface AccountState {
  /** False when this build has no account server address. */
  configured: boolean;
  user: HolarkyUser | null;
  signingIn: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  /**
   * Learning-progress sync (Plus). Null until the account's entitlements are known. `keptUntil` is
   * when the server deletes the progress it still holds from a lapsed Plus (null: nothing kept).
   */
  plus: { active: boolean; keptUntil: number | null } | null;
}

/** Signed in, entitlements known, and Plus is not active: progress stays on this device. */
export function progressSyncOff(state: AccountState | null): boolean {
  return !!state?.configured && !!state.user && !!state.plus && !state.plus.active;
}

export interface AccountControllerOptions {
  account: HolarkyAccount | null;
  /** Keeps the last sync time across restarts. */
  meta: KeyValueStorage;
  onState: (state: AccountState) => void;
  /** After a sync that changed local rows, so the notebook view can reload. */
  onNotebookChanged?: (result: VocabSyncResult) => void;
  log?: (message: string, detail?: unknown) => void;
  /** Delay between a local edit and the sync it triggers. */
  editDelayMs?: number;
  /** Background sync interval while signed in. */
  periodMs?: number;
}

const META_LAST_SYNC = 'phevere.account.lastSyncAt';

/** Signed-in state, sign-out and automatic notebook sync. */
export class AccountController {
  private readonly opts: AccountControllerOptions;
  private state: AccountState;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private periodTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(opts: AccountControllerOptions) {
    this.opts = opts;
    this.state = { configured: !!opts.account, user: null, signingIn: false, syncing: false, lastSyncAt: null, lastError: null, plus: null };
  }

  get account(): HolarkyAccount | null {
    return this.opts.account;
  }

  getState(): AccountState {
    return { ...this.state };
  }

  private set(patch: Partial<AccountState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState(this.getState());
  }

  async init(): Promise<void> {
    const account = this.opts.account;
    if (!account) {
      this.opts.onState(this.getState());
      return;
    }
    const last = Number(await this.opts.meta.get(META_LAST_SYNC));
    this.set({ user: await account.getUser(), lastSyncAt: last > 0 ? last : null });
    // A revoked or expired sign-in clears the session inside the client; reflect it here.
    this.unsubscribers.push(account.onChange((user) => this.set({ user })));
    this.unsubscribers.push(onVocabChanged(() => this.requestSync()));
    const period = this.opts.periodMs ?? 15 * 60 * 1000;
    this.periodTimer = setInterval(() => void this.syncNow(), period);
    (this.periodTimer as { unref?: () => void }).unref?.();
    if (this.state.user) void this.syncNow();
  }

  dispose(): void {
    if (this.editTimer) clearTimeout(this.editTimer);
    if (this.periodTimer) clearInterval(this.periodTimer);
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  /** Runs a platform sign-in (it ends with account.completeSignIn), then syncs. */
  async signIn(run: (account: HolarkyAccount) => Promise<unknown>): Promise<void> {
    const account = this.opts.account;
    if (!account || this.state.signingIn) return;
    this.set({ signingIn: true, lastError: null });
    try {
      await run(account);
      this.set({ user: await account.getUser() });
    } catch (err) {
      this.opts.log?.('account sign-in failed', String(err));
      this.set({ lastError: describeError(err, 'Sign-in did not finish.') });
    } finally {
      this.set({ signingIn: false });
    }
    if (this.state.user) await this.syncNow();
  }

  /** Marks an in-progress sign-in as abandoned (the person closed the browser). */
  cancelSignIn(): void {
    if (this.state.signingIn) this.set({ signingIn: false });
  }

  async signOut(): Promise<void> {
    const account = this.opts.account;
    if (!account) return;
    await account.signOut();
    this.set({ user: null, lastError: null, plus: null });
  }

  /**
   * Deletes the Holarky account everywhere (sign-in, profile, synced notebook) after the person types
   * its email. The notebook on this device stays. Returns false, with state.lastError set, on failure.
   */
  async deleteAccount(confirmEmail: string): Promise<boolean> {
    const account = this.opts.account;
    if (!account || !this.state.user) return false;
    try {
      await account.deleteAccount(confirmEmail.trim());
      await this.opts.meta.remove(META_LAST_SYNC);
      this.set({ user: null, lastSyncAt: null, lastError: null, plus: null });
      return true;
    } catch (err) {
      this.opts.log?.('account deletion failed', String(err));
      const code = err instanceof HolarkyAccountError ? err.code : '';
      this.set({
        lastError: code === 'confirm_email_mismatch' ? "That email doesn't match this account." : describeError(err, 'The account was not deleted.'),
      });
      return false;
    }
  }

  /** Schedules a sync shortly after a local notebook edit. */
  requestSync(delayMs = this.opts.editDelayMs ?? 5000): void {
    if (!this.state.user) return;
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      void this.syncNow();
    }, delayMs);
  }

  private syncProgressIfPlus(account: HolarkyAccount): Promise<number> {
    return syncProgressForAccount(account, (plus) => this.set({ plus }), this.opts.log);
  }

  /** Syncs now. Never throws: failures land in state.lastError. */
  async syncNow(): Promise<void> {
    const account = this.opts.account;
    if (!account || !this.state.user || this.state.syncing) return;
    this.set({ syncing: true });
    try {
      const result = await syncVocab(account);
      // Word book subscriptions and progress travel in their own namespace. A server that does
      // not know it yet must not stop the notebook from syncing.
      const books = await syncWordbooks(account).catch((err) => {
        this.opts.log?.('word book sync failed', String(err));
        return { pushed: 0, received: 0 };
      });
      // Learning progress (the answer history) syncs only while Plus is active.
      const progress = await this.syncProgressIfPlus(account);
      await this.opts.meta.set(META_LAST_SYNC, String(result.at));
      this.set({ lastSyncAt: result.at, lastError: null });
      if (result.received || result.merged || books.received || progress) this.opts.onNotebookChanged?.(result);
    } catch (err) {
      this.opts.log?.('notebook sync failed', String(err));
      const signedOut = err instanceof HolarkyAccountError && err.code === 'signed_out';
      this.set({ lastError: signedOut ? 'You were signed out. Sign in again to keep syncing.' : describeError(err, 'Sync failed.') });
      if (signedOut) this.set({ user: null });
    } finally {
      this.set({ syncing: false });
    }
  }
}

export type ProgressSyncCapable = Pick<HolarkyAccount, 'getUser' | 'sync' | 'getEntitlements'>;

/**
 * Checks the entitlements and, with Plus active, syncs the answer history. Updates state.plus and
 * returns how many answers arrived from other devices. A server without entitlements (an older
 * deployment) counts as no Plus; any other failure leaves state.plus as it was.
 */
export async function syncProgressForAccount(
  account: ProgressSyncCapable,
  setPlus: (plus: AccountState['plus']) => void,
  log?: (message: string, detail?: unknown) => void,
): Promise<number> {
  let access = false;
  try {
    const ent = await account.getEntitlements();
    const col = ent.collections?.[PROGRESS_SYNC_NAMESPACE];
    access = !!col?.access;
    setPlus({ active: access, keptUntil: col?.keptUntil ?? null });
  } catch (err) {
    if ((err as { status?: unknown })?.status === 404) setPlus({ active: false, keptUntil: null });
    else log?.('entitlements check failed', String(err));
    return 0;
  }
  if (!access) return 0;
  try {
    const res = await syncProgress(account);
    if (res.status === 'plus_required') {
      setPlus({ active: false, keptUntil: res.keptUntil });
      return 0;
    }
    return res.received;
  } catch (err) {
    log?.('progress sync failed', String(err));
    return 0;
  }
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof HolarkyAccountError) {
    if (err.code === 'access_denied') return 'Sign-in was cancelled.';
    if (err.status >= 500) return 'The account server had a problem. phevere will try again later.';
    return `${fallback} (${err.code})`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|timed? ?out|ECONN|ENOTFOUND|Request failed/i.test(msg)) {
    return "Couldn't reach the account server. phevere will try again later.";
  }
  return `${fallback} ${msg}`.trim();
}
