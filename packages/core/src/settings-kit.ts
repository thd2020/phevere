/**
 * Shared pieces of every Settings page, desktop and phone: escaping, link markup,
 * icons, and the row, switch, choice, slider and key-cap markup. Styles: settings-kit.css.
 */

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const SVG = {
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M9.9 5.8A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.3 7.6A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18V6M11 22V2M3 14v-4M15 18V6M19 14v-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** A row with a label and a switch at the end; the whole row toggles it. */
export interface SwitchRowInput {
  label: string;
  on: boolean;
  /** Attributes for the input (id, data-act, aria-…), already escaped. */
  attrs?: string;
  sub?: string;
  labelId?: string;
}

export function switchRowHtml(r: SwitchRowInput): string {
  return `<label class="sv-row">
    <span class="sv-row__text"><span class="sv-row__label"${r.labelId ? ` id="${esc(r.labelId)}"` : ''}>${esc(r.label)}</span>${r.sub ? `<span class="sv-row__sub">${esc(r.sub)}</span>` : ''}</span>
    <span class="sv-ctl"><input type="checkbox" role="switch" class="sv-switch" ${r.attrs || ''}${r.on ? ' checked' : ''} /></span>
  </label>`;
}

/**
 * A row with a label and a segmented choice of two to five short options: radios on a paper
 * track, so arrow keys move between them and a screen reader hears a radio group.
 */
export interface SegRowInput {
  label: string;
  /** Radio group name; also the label's id stem. */
  name: string;
  options: Array<{ value: string; label: string }>;
  value: string;
}

export function segRowHtml(r: SegRowInput): string {
  const labelId = `${r.name}-label`;
  const items = r.options
    .map((o) => `<label class="sv-seg__item"><input type="radio" name="${esc(r.name)}" value="${esc(o.value)}"${o.value === r.value ? ' checked' : ''} />${esc(o.label)}</label>`)
    .join('');
  return `<div class="sv-row sv-row--seg">
    <span class="sv-row__text"><span class="sv-row__label" id="${esc(labelId)}">${esc(r.label)}</span></span>
    <div class="sv-seg" role="radiogroup" aria-labelledby="${esc(labelId)}">${items}</div>
  </div>`;
}

/** A labelled slider with its value in mono. */
export interface RangeRowInput {
  label: string;
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  valueId: string;
  valueText: string;
  attrs?: string;
}

export function rangeRowHtml(r: RangeRowInput): string {
  return `<div class="sv-row">
    <label class="sv-row__text sv-row__label" for="${esc(r.id)}">${esc(r.label)}</label>
    <span class="sv-range-wrap">
      <input type="range" class="sv-range" id="${esc(r.id)}" min="${r.min}" max="${r.max}" step="${r.step}" value="${r.value}" ${r.attrs || ''} />
      <span class="sv-range__value" id="${esc(r.valueId)}">${esc(r.valueText)}</span>
    </span>
  </div>`;
}

/** A row that opens a screen or a system page: icon, label, optional value, chevron. */
export interface NavRowInput {
  /** Leave out inside a card of switch rows, so every label starts at the same edge. */
  icon?: string;
  label: string;
  sub?: string;
  /** Short state on the right, such as "Off", when it asks for action. */
  value?: string;
  attrs?: string;
}

export function navRowHtml(r: NavRowInput): string {
  return `<button type="button" class="sv-nav" ${r.attrs || ''}>
    ${r.icon ? `<span class="sv-nav__icon" aria-hidden="true">${r.icon}</span>` : ''}
    <span class="sv-row__text"><span class="sv-row__label">${esc(r.label)}</span>${r.sub ? `<span class="sv-row__sub">${esc(r.sub)}</span>` : ''}</span>
    ${r.value ? `<span class="sv-nav__value">${esc(r.value)}</span>` : ''}
    <span class="sv-nav__chev" aria-hidden="true">${SVG.chevron}</span>
  </button>`;
}

/**
 * One option in a radio list whose options may need a download, such as a pronunciation voice.
 * Selected: a check. Not downloaded: a download mark. Downloading: a cancel button and a progress bar.
 */
export interface ChoiceRowInput {
  name: string;
  /** Size, "Built-in", "Downloaded", "Downloading 40%" or an error. */
  meta: string;
  metaTone?: 'installed' | 'busy' | 'error';
  on: boolean;
  /** Not downloaded yet. */
  needsDownload?: boolean;
  disabled?: boolean;
  /** Attributes for the radio button (data-*), already escaped. */
  attrs: string;
  ariaLabel?: string;
  /** While downloading: percent done and the cancel button's attributes. */
  busy?: { pct: number; cancelAttrs: string };
  /** A short tag beside the name, such as "Recommended". */
  badge?: string;
}

export function choiceRowHtml(c: ChoiceRowInput): string {
  const end = c.busy
    ? `<button type="button" class="sv-icon sv-icon--small" ${c.busy.cancelAttrs} title="Cancel" aria-label="Cancel download">${SVG.close}</button>`
    : c.on
      ? `<span class="sv-choice__mark sv-choice__mark--check" aria-hidden="true">${SVG.check}</span>`
      : c.needsDownload
        ? `<span class="sv-choice__mark sv-choice__mark--download" aria-hidden="true">${SVG.download}</span>`
        : '<span class="sv-choice__mark" aria-hidden="true"></span>';
  const pct = c.busy ? Math.max(0, Math.min(100, Math.round(c.busy.pct))) : 0;
  return `<div class="sv-choice${c.on ? ' is-on' : ''}">
    <button type="button" class="sv-choice__main" role="radio" aria-checked="${c.on}" ${c.attrs}${c.disabled ? ' disabled' : ''}${c.ariaLabel ? ` aria-label="${esc(c.ariaLabel)}"` : ''}>
      <span class="sv-seal" aria-hidden="true">${SVG.wave}</span>
      <span class="sv-choice__text"><span class="sv-choice__name">${esc(c.name)}${c.badge ? ` <span class="sv-choice__badge">${esc(c.badge)}</span>` : ''}</span><span class="sv-choice__meta${c.metaTone ? ` is-${c.metaTone}` : ''}">${esc(c.meta)}</span></span>
    </button>
    ${end}
    ${c.busy ? `<span class="sv-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(c.name)}"><span style="width:${pct}%"></span></span>` : ''}
  </div>`;
}

/** Key caps for a shortcut already split into display names (Ctrl, Shift, K). */
export function keycapsHtml(parts: string[]): string {
  if (!parts.length) return '<span class="sv-kbd-empty">Not set</span>';
  return parts.map((k) => `<kbd class="sv-kbd">${esc(k)}</kbd>`).join('<span class="sv-kbd-join">+</span>');
}

/** External link that opens in the browser; Settings windows route target=_blank clicks to the system browser. */
export function linkHtml(url: string | undefined, text?: string): string {
  if (!url) return '';
  return `<a class="sv-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text || hostOf(url))}${SVG.out}</a>`;
}
