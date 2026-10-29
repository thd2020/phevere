import {
  AccountController,
  HolarkyAccount,
  HOLARKY_ACCOUNT,
  HolarkyAccountError,
  browserStorage,
  getHttp,
  httpClientFetch,
  resolveAccountApi,
  type AccountState,
} from '@phevere/core';
import { hasNativeBridge, nativeCall } from './native';

/** Registered for the phevere mobile app in Auth0; Android and iOS route it back to the app. */
const REDIRECT_URI = 'com.phevere.app:/oauth/callback';
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

let controller: AccountController | null = null;
let cancelPending: (() => void) | null = null;

export function initAccount(hooks: { onState: (state: AccountState) => void; onNotebookChanged: () => void }): void {
  const apiBase = resolveAccountApi(import.meta.env.VITE_PHEVERE_ACCOUNT_API as string | undefined);
  const storage = browserStorage();
  const account = apiBase
    ? new HolarkyAccount({
        domain: HOLARKY_ACCOUNT.domain,
        audience: HOLARKY_ACCOUNT.audience,
        clientId: HOLARKY_ACCOUNT.clientIds.mobile,
        apiBase,
        redirectUri: REDIRECT_URI,
        storage,
        // The native HTTP bridge, like lookups: no WebView CORS or mixed-content limits.
        fetch: httpClientFetch(getHttp()),
      })
    : null;
  controller = new AccountController({
    account,
    meta: storage,
    onState: hooks.onState,
    onNotebookChanged: () => hooks.onNotebookChanged(),
    log: (message, detail) => console.warn('[account]', message, detail),
  });
  void controller.init().then(() => resumeSignIn());
}

/** Android may restart the app while the browser is open; finish that sign-in on launch. */
async function resumeSignIn(): Promise<void> {
  const account = controller?.account;
  if (!account || !hasNativeBridge()) return;
  try {
    const res = await nativeCall<{ url?: string | null }>('takeAuthCallback', {});
    if (res.url && (await account.isSignInCallback(res.url))) {
      await controller!.signIn((a) => a.completeSignIn(res.url!));
    }
  } catch {
    /* older native shell without the method */
  }
}

export function getAccountState(): AccountState | null {
  return controller ? controller.getState() : null;
}

export function signIn(): Promise<void> {
  if (!controller) return Promise.resolve();
  return controller.signIn(async (account) => {
    if (!hasNativeBridge()) throw new Error('Sign-in works in the phevere app, not in a browser preview.');
    const url = await account.beginSignIn();
    const cancelled = new Promise<never>((_, reject) => {
      cancelPending = () => reject(new HolarkyAccountError('access_denied', 0));
    });
    try {
      const res = await Promise.race([
        nativeCall<{ url?: string }>('openAuth', { url }, SIGN_IN_TIMEOUT_MS),
        cancelled,
      ]);
      if (!res.url) throw new Error('Sign-in did not finish.');
      await account.completeSignIn(res.url);
    } catch (err) {
      // iOS reports a closed sign-in sheet as "cancelled".
      if (err instanceof Error && err.message === 'cancelled') throw new HolarkyAccountError('access_denied', 0);
      throw err;
    } finally {
      cancelPending = null;
    }
  });
}

export function cancelSignIn(): void {
  cancelPending?.();
  controller?.cancelSignIn();
}

export function signOut(): Promise<void> {
  return controller ? controller.signOut() : Promise.resolve();
}

export function syncNow(): Promise<void> {
  return controller ? controller.syncNow() : Promise.resolve();
}

/** Coming back to the app: pick up edits made on other devices. */
export function syncSoon(): void {
  controller?.requestSync(1000);
}
