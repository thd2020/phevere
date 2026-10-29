# Holarky account and notebook sync

phevere can sign in with a Holarky account, the one account shared by Holarky apps (phevere, knowrld). While signed in, the notebook syncs between every desktop and phone signed in to the same account. Lookups never wait on the account or the network; without an account phevere works exactly as before.

Identity is the Holarky Auth0 tenant: people sign in on its Universal Login page with email and password or Google, and Auth0 handles verification emails, password resets and attack protection. Profiles and sync are the Holarky API, a Cloudflare Worker in [thd2020/holarky-account](https://github.com/thd2020/holarky-account), whose README explains the protocol (OAuth 2.0 authorization code with PKCE) and how to deploy it.

## Where the code is

| Piece | File |
|---|---|
| Client (vendored copy; edit it in holarky-account, then copy it here) | `packages/core/src/holarky-account.ts` |
| Signed-in state, automatic sync, account settings | `packages/core/src/account.ts` |
| Notebook sync | `packages/core/src/vocab-sync.ts` |
| Desktop: session file, browser sign-in | `src/services/account.ts`, IPC in `src/index.ts`, `accountAPI` in `src/preload.ts` |
| Desktop: Settings → Account | `wireAccountSettingsPanel` in `src/renderer.ts` |
| Mobile: session, sign-in | `apps/mobile/src/platform/account.ts` |
| Mobile: Settings → Account | `accountPanel` in `apps/mobile/src/settings-panels.ts` |
| Android callback | intent filter on `MainActivity` (`AndroidManifest.xml`), `openAuth` / `takeAuthCallback` in `BridgeRouter.java` |
| iOS callback | `openAuth` in `PhevereViewController.swift` (`ASWebAuthenticationSession`) |
| Test | `scripts/test-vocab-sync.js` |

## Account settings

`HOLARKY_ACCOUNT` in `packages/core/src/account.ts` holds the Auth0 tenant, the API identifier and phevere's two Auth0 client ids (public values, recorded in holarky-account's `auth0/tenant.json`), and `apiBase`, the deployed Holarky API, for example `https://holarky-api.<subdomain>.workers.dev`. `apiBase` is the deployed API, `https://holarky-api.thdfreelancer.workers.dev`; set it to an empty string to build phevere with sign-in off (Settings → Account then says sign-in isn't set up).

To use another API address without editing the file:

- **Desktop:** start phevere with `PHEVERE_ACCOUNT_API=<address>`.
- **Mobile:** build with `VITE_PHEVERE_ACCOUNT_API=<address> npm run mobile:build`.

Addresses must be `https://`, except `localhost` and `127.0.0.1` for development.

## How signing in works

- **Desktop** (Auth0 app "phevere", native): phevere listens on the first free of ports 47231, 47232 and 47233 on `127.0.0.1` (Auth0 does not accept a random port, so these three are registered), opens Holarky's sign-in page in the default browser, and the browser returns to `http://127.0.0.1:<port>/callback`. If all three ports are busy, sign-in says so. The tab then says you can close it. The session is saved in `userData/holarky-account.json`, encrypted with Electron `safeStorage`; where the OS offers no encryption (some Linux setups without a keyring) it is saved unencrypted with owner-only permissions, and the log says so. Sign-in gives up after 5 minutes; Cancel stops it sooner.
- **Android** (Auth0 app "phevere", native, mobile client id): the sign-in page opens in the browser and returns to `com.phevere.app:/oauth/callback`, which `MainActivity` receives. If Android restarted phevere meanwhile, the page picks the result up on launch (`takeAuthCallback`).
- **iOS** (same client id): the sign-in page opens in an `ASWebAuthenticationSession` sheet, which hands back the `com.phevere.app:` address directly.

The mobile session is kept in the WebView's local storage under `holarky-account:*`.

## How the notebook syncs

Each notebook row is sent as a record `{ id, updatedAt, deleted, data }` to the `phevere/vocab` collection.

- **Push:** rows and deletions changed since the last push. Deleting a word now leaves a tombstone in the `vocab_deleted` table so the deletion reaches other devices.
- **Pull:** everything the server has after this device's cursor, in pages of 500. A remote record replaces the local row unless the local row is newer; on a tie the server's copy wins, so devices converge.
- **The same word saved on two devices** gets two ids. After each pull, rows with the same lemma (ignoring case) fold into the row with the smallest id: text fields keep the newest non-empty value, sources and tags are combined, review progress comes from the most-reviewed row. The other rows become tombstones. Every device folds the same way.
- **When:** after sign-in, at startup, 5 seconds after a notebook edit, every 15 minutes, when the phone app comes back to the foreground, and on Sync now.
- **Sync state** (cursor, last push time, which account it belongs to) is in the `sync_state` table. Signing in with a different account starts over and adds this device's notebook to that account. Signing out keeps the notebook on the device.
- **Delete account** (Settings → Account) asks for the account's email, then removes the Holarky account everywhere: the Auth0 sign-in, the profile and the synced notebook. The notebook on the device stays.

## Testing locally

1. Run the Holarky API: in holarky-account, `cd packages/server && npm run dev` (http://localhost:8787). It checks tokens against the real Auth0 tenant, so sign-in works as in production.
2. Sync logic, two simulated devices: `node scripts/test-vocab-sync.js` (in-memory server), or against the running API with an access token for a test user with an empty notebook: `PHEVERE_SYNC_TEST_API=http://127.0.0.1:8787 PHEVERE_SYNC_TEST_TOKEN=<token> node scripts/test-vocab-sync.js`.
3. Desktop end to end: `PHEVERE_ACCOUNT_API=http://localhost:8787 npm start`, then Settings → Account → Sign in.
4. Android: `adb reverse tcp:8787 tcp:8787` makes the phone's `localhost:8787` reach your computer; then `VITE_PHEVERE_ACCOUNT_API=http://localhost:8787 npm run mobile:build` and install. phevere accepts plain `http://` only for `localhost` and `127.0.0.1`, so for iOS test against the deployed API.

## Not yet verified

- The desktop sign-in and Settings → Account have not been run in Electron. The sync logic has been tested with two simulated devices in Node, in memory and against the Holarky API with a real Auth0 token; the client has been tested end to end against the real Auth0 tenant.
- The Android and iOS changes have not been built or run on a device.
