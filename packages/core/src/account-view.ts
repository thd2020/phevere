/**
 * Account entry shared by the desktop title bar and the phone app bar: the trigger button
 * (Holarky mark when signed out, the user's initial when signed in) and the panel it opens.
 * Both return HTML strings; buttons carry `data-act` so each shell wires them its own way.
 */
import { HOLARKY_ACCOUNT, progressSyncOff, type AccountState } from './account';
import { formatDate, formatRelativeTime, t, tHtml } from './i18n/runtime';

/**
 * The Holarky mark (the Stride h) as the brand's small icon, `brand/svg/holarky-icon-small.svg`
 * in thd2020/holarky-account, without its paper square. Below 32 px the brand fills the twin leg.
 * `id` keeps the mask unique when the mark appears more than once in a page.
 */
export function holarkyMarkSvg(id: string, size = 24): string {
  const mask = `hx-twin-${id}`;
  return `<svg class="hx-mark" viewBox="2 2 96 96" width="${size}" height="${size}" aria-hidden="true" focusable="false">
  <defs>
    <mask id="${mask}" maskUnits="userSpaceOnUse" x="-40" y="-10" width="180" height="130">
      <path d="M30 60 C32 50 42 45 53 45 C64 46 70 54 73 64 L79 82" fill="none" stroke="#fff" stroke-width="12"/>
      <polygon points="24,16 36,10 36,90 24,90" fill="#000"/>
    </mask>
  </defs>
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

/** "Synced just now", "Synced 5 minutes ago", "Synced 3 hours ago", then the date. */
function syncedText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return t('settings.account.syncedJustNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('settings.account.synced', { time: formatRelativeTime(-m, 'minute') });
  const h = Math.round(m / 60);
  if (h < 24) return t('settings.account.synced', { time: formatRelativeTime(-h, 'hour') });
  return t('settings.account.synced', { time: formatDate(at) });
}

function initial(state: AccountState): string {
  const name = state.user?.name || state.user?.email || '';
  return (name.trim()[0] || '?').toUpperCase();
}

/** One line under the user, or under Sign in while the browser is open. */
export function accountStatusText(state: AccountState, now = Date.now()): string {
  if (state.signingIn) return t('settings.account.finishInBrowser');
  if (state.lastError) return state.lastError;
  if (!state.user) return '';
  if (state.syncing) return t('settings.account.syncing');
  if (state.lastSyncAt) return syncedText(state.lastSyncAt, now);
  return t('settings.account.notSynced');
}

/** Title-bar or app-bar button. Empty when this build has no account server. */
export function accountButtonHtml(state: AccountState | null, open = false): string {
  if (!state?.configured) return '';
  const user = state.user;
  const sync = state.lastError ? 'error' : state.syncing ? 'syncing' : '';
  const label = user ? t('settings.account.buttonLabel', { email: user.email }) : t('settings.account.signIn');
  const face = user
    ? `<span class="hx-avatar" aria-hidden="true">${esc(initial(state))}</span>`
    : holarkyMarkSvg('btn', 22);
  return `<button type="button" class="hx-account-btn" data-act="account-open" data-sync="${sync}" aria-haspopup="dialog" aria-expanded="${open}" aria-label="${esc(label)}" title="${esc(user ? user.name || user.email : t('settings.account.signIn'))}">${face}</button>`;
}

export interface AccountPanelOptions {
  /** The email confirmation step of Delete account is showing. */
  deleting?: boolean;
  /** The device the notebook stays on, for the line about the local notebook. */
  device: 'phone' | 'computer';
  now?: number;
  /** Where Get Plus leads; HOLARKY_ACCOUNT.plusUrl by default. */
  plusUrl?: string;
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
      ? `<button type="button" class="hx-btn hx-btn--quiet" data-act="account-cancel">${tHtml('common.cancel')}</button>`
      : `<button type="button" class="hx-btn hx-btn--primary" data-act="account-sign-in">${tHtml('settings.account.signIn')}</button>`;
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
      <button type="button" class="hx-icon-btn${state.syncing ? ' is-spinning' : ''}" data-act="account-sync" aria-label="${tHtml('settings.account.syncNow')}" title="${tHtml('settings.account.syncNow')}" ${state.syncing ? 'disabled' : ''}>${SYNC_ICON}</button>
    </div>`;
  if (opts.deleting) {
    return `<div class="hx-acct">
      ${head}
      <div class="hx-acct__delete">
        <p>${tHtml(opts.device === 'phone' ? 'settings.account.deleteWarningPhone' : 'settings.account.deleteWarningComputer')}</p>
        <input id="account-delete-email" type="email" autocomplete="off" spellcheck="false" aria-label="${tHtml('settings.account.emailField')}" placeholder="${esc(user.email)}" />
        <div class="hx-acct__row">
          <button type="button" class="hx-btn hx-btn--danger" data-act="account-delete-confirm" disabled>${tHtml('settings.account.delete')}</button>
          <button type="button" class="hx-btn hx-btn--quiet" data-act="account-delete-cancel">${tHtml('common.cancel')}</button>
        </div>
      </div>
    </div>`;
  }
  return `<div class="hx-acct">
    ${head}
    ${plusNoticeHtml(state, opts.plusUrl ?? HOLARKY_ACCOUNT.plusUrl)}
    <div class="hx-acct__row">
      <button type="button" class="hx-btn" data-act="account-sign-out">${tHtml('settings.account.signOut')}</button>
      <button type="button" class="hx-btn hx-btn--quiet hx-btn--danger-text" data-act="account-delete-start">${tHtml('settings.account.deleteStart')}</button>
    </div>
  </div>`;
}

/**
 * The Plus state of learning-progress sync: one quiet line with a text link, no button.
 *
 * The account panel shows it whenever sync is off, since that is where sync lives. Learn shows it
 * only when the reader meets the limit for real: progress they synced before is about to be
 * dropped. Empty unless signed in with Plus known to be inactive.
 */
export function plusNoticeHtml(state: AccountState | null, plusUrl: string, where: 'account' | 'learn' = 'account'): string {
  if (!progressSyncOff(state)) return '';
  const kept = state!.plus!.keptUntil;
  if (where === 'learn' && !kept) return '';
  const line = kept
    ? t('settings.account.plusKeptUntil', { date: formatDate(kept, { month: 'short', day: 'numeric', year: 'numeric' }) })
    : t('settings.account.plusLocalOnly');
  const link = t(kept ? 'settings.account.plusKeep' : 'settings.account.plusSync');
  return `<p class="hx-plus" role="note">${esc(line)} <a class="hx-plus__link" href="${esc(plusUrl)}" target="_blank" rel="noopener noreferrer" data-act="account-plus">${esc(link)}</a></p>`;
}

/** Enables Delete account once the typed email matches the signed-in one. */
export function deleteEmailMatches(state: AccountState | null, typed: string): boolean {
  const want = String(state?.user?.email || '').trim().toLowerCase();
  return !!want && typed.trim().toLowerCase() === want;
}
