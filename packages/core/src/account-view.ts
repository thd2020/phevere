/**
 * Account entry shared by the desktop title bar and the phone app bar: the trigger button
 * (Holarky mark when signed out, the user's initial when signed in) and the panel it opens.
 * Both return HTML strings; buttons carry `data-act` so each shell wires them its own way.
 */
import type { AccountState } from './account';

/**
 * The Holarky mark (the Stride h), as served by holarky-account at /brand/holarky-mark.svg.
 * `id` keeps the mask unique when the mark appears more than once in a page.
 */
export function holarkyMarkSvg(id: string, size = 24): string {
  const mask = `hx-twin-${id}`;
  return `<svg class="hx-mark" viewBox="-6 2 112 104" width="${size}" height="${Math.round((size * 104) / 112)}" aria-hidden="true" focusable="false">
  <defs>
    <mask id="${mask}" maskUnits="userSpaceOnUse" x="-40" y="-10" width="180" height="130">
      <path d="M30 60 C32 50 42 45 53 45 C64 46 70 54 73 64 L79 82" fill="none" stroke="#fff" stroke-width="13"/>
      <path d="M30 60 C32 50 42 45 53 45 C64 46 70 54 73 64 L79 82" fill="none" stroke="#000" stroke-width="8" pathLength="100" stroke-dasharray="0 1.8 96.4 1.8"/>
      <polygon points="24,16 36,10 36,90 24,90" fill="#000"/>
    </mask>
  </defs>
  <path d="M6 92 H94" stroke="#5e3a8c" stroke-width="2.4" stroke-linecap="round"/>
  <ellipse cx="76" cy="93.5" rx="8" ry="1.6" fill="#5e3a8c" fill-opacity="0.25"/>
  <g transform="translate(14 0) skewX(-12)">
    <rect x="-40" y="-10" width="180" height="130" fill="#2a9d84" mask="url(#${mask})"/>
    <polygon points="24,16 36,10 36,90 24,90" fill="#5e3a8c"/>
  </g>
</svg>`;
}

const SYNC_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3.5v4h-4M5.5 20.5v-4h4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}

function initial(state: AccountState): string {
  const name = state.user?.name || state.user?.email || '';
  return (name.trim()[0] || '?').toUpperCase();
}

/** One line under the user, or under Sign in while the browser is open. */
export function accountStatusText(state: AccountState, now = Date.now()): string {
  if (state.signingIn) return 'Finish signing in in your browser.';
  if (state.lastError) return state.lastError;
  if (!state.user) return '';
  if (state.syncing) return 'Syncing…';
  if (state.lastSyncAt) return `Synced ${timeAgo(state.lastSyncAt, now)}`;
  return 'Not synced yet';
}

/** Title-bar or app-bar button. Empty when this build has no account server. */
export function accountButtonHtml(state: AccountState | null, open = false): string {
  if (!state?.configured) return '';
  const user = state.user;
  const sync = state.lastError ? 'error' : state.syncing ? 'syncing' : '';
  const label = user ? `Account: ${user.email}` : 'Sign in';
  const face = user
    ? `<span class="hx-avatar" aria-hidden="true">${esc(initial(state))}</span>`
    : holarkyMarkSvg('btn', 22);
  return `<button type="button" class="hx-account-btn" data-act="account-open" data-sync="${sync}" aria-haspopup="dialog" aria-expanded="${open}" aria-label="${esc(label)}" title="${esc(user ? user.name || user.email : 'Sign in')}">${face}</button>`;
}

export interface AccountPanelOptions {
  /** The email confirmation step of Delete account is showing. */
  deleting?: boolean;
  /** "phone" or "computer", for the line about the local notebook. */
  device: string;
  now?: number;
}

/** Popover (desktop) or bottom sheet (phone) content. */
export function accountPanelHtml(state: AccountState | null, opts: AccountPanelOptions): string {
  if (!state?.configured) return '';
  const status = accountStatusText(state, opts.now);
  const statusHtml = status
    ? `<p class="hx-acct__status${state.lastError ? ' is-error' : ''}" role="status">${esc(status)}</p>`
    : '';
  const user = state.user;
  if (!user) {
    const actions = state.signingIn
      ? `<button type="button" class="hx-btn hx-btn--quiet" data-act="account-cancel">Cancel</button>`
      : `<button type="button" class="hx-btn hx-btn--primary" data-act="account-sign-in">Sign in</button>`;
    return `<div class="hx-acct">
      <div class="hx-acct__brand">${holarkyMarkSvg('panel', 30)}<strong>Holarky</strong></div>
      ${actions}
      ${statusHtml}
    </div>`;
  }
  const head = `<div class="hx-acct__who">
      <span class="hx-avatar hx-avatar--lg" aria-hidden="true">${esc(initial(state))}</span>
      <span class="hx-acct__id"><strong>${esc(user.name || user.email)}</strong><span>${esc(user.email)}</span></span>
    </div>
    <div class="hx-acct__sync">
      ${statusHtml || '<span></span>'}
      <button type="button" class="hx-icon-btn${state.syncing ? ' is-spinning' : ''}" data-act="account-sync" aria-label="Sync now" title="Sync now" ${state.syncing ? 'disabled' : ''}>${SYNC_ICON}</button>
    </div>`;
  if (opts.deleting) {
    return `<div class="hx-acct">
      ${head}
      <div class="hx-acct__delete">
        <p>Deletes your Holarky account and its synced notebook in every Holarky app. The notebook on this ${esc(opts.device)} stays. Type your email to confirm.</p>
        <input id="account-delete-email" type="email" autocomplete="off" spellcheck="false" aria-label="Account email" placeholder="${esc(user.email)}" />
        <div class="hx-acct__row">
          <button type="button" class="hx-btn hx-btn--danger" data-act="account-delete-confirm" disabled>Delete account</button>
          <button type="button" class="hx-btn hx-btn--quiet" data-act="account-delete-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
  }
  return `<div class="hx-acct">
    ${head}
    <div class="hx-acct__row">
      <button type="button" class="hx-btn" data-act="account-sign-out">Sign out</button>
      <button type="button" class="hx-btn hx-btn--quiet hx-btn--danger-text" data-act="account-delete-start">Delete account…</button>
    </div>
  </div>`;
}

/** Enables Delete account once the typed email matches the signed-in one. */
export function deleteEmailMatches(state: AccountState | null, typed: string): boolean {
  const want = String(state?.user?.email || '').trim().toLowerCase();
  return !!want && typed.trim().toLowerCase() === want;
}
