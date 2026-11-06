/**
 * A number wheel: one large display numeral with its neighbours curving away above and below it,
 * in the manner of the iOS wheel picker and the timer and alarm pickers in iOS and Android's Clock.
 * The centre value is set big in Source Serif at its display size and heavy weight, and the weight
 * falls away with the size as a number turns off centre.
 *
 * It is a spinbutton (WAI-ARIA APG): Up and Down step by one, Page Up and Page Down by `page`, Home
 * and End go to the ends, and Enter, F2 or a digit opens a field to type the number. With a pointer
 * the wheel is dragged or flicked up and down and settles on a value with a spring; the mouse wheel
 * steps one notch at a time and a trackpad turns it continuously. A tap on the centre opens the
 * field, a tap above or below steps towards that side. Keyboard steps do not animate.
 *
 * The value goes out as a bubbling `change` event on the wheel once it settles; read it from
 * `data-value`. `wireNumberWheels` listens on a container once, so a repaint needs no rewiring.
 * Styles: settings-kit.css (`.nw`).
 */
import { esc } from './settings-kit';

export interface NumberWheelInput {
  id: string;
  /** Id of the element that names the wheel. */
  labelledBy: string;
  value: number;
  min: number;
  max: number;
  /** 0 means Off and sits before `min`, as on a countdown. */
  off?: boolean;
  /** A word under the number, such as "seconds"; hidden while the wheel shows Off. */
  unit?: string;
  /** Page Up and Page Down step; 10 by default. */
  page?: number;
  /** Extra attributes for the wheel element, such as data-act. */
  attrs?: string;
}

export interface WheelRange {
  min: number;
  max: number;
  off: boolean;
}

/** How many neighbours on each side are drawn. */
const REACH = 3;
/**
 * Distance, in ems of the numeral, between two values at full size: the height of a lining figure
 * (about 0.68em) and a gap. Each value is lifted by the sizes of the values between it and the
 * centre, so neighbours stay apart at every point of a turn, never overlapping as they pass.
 */
const PITCH = 0.86;

/** Size of a value `t` steps off centre, as a share of the centre's. */
const sizeAt = (t: number) => 0.36 + 0.64 * Math.exp(-1.4 * t * t);

/** Distance from the centre to a value `d` steps off it: PITCH times the integral of sizeAt from 0 to d. */
function liftAt(d: number): number {
  const n = 16;
  const h = d / n;
  let sum = sizeAt(0) + sizeAt(d);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * sizeAt(i * h);
  return PITCH * (h / 3) * sum;
}

const count = (r: WheelRange) => r.max - r.min + 1 + (r.off ? 1 : 0);
const valueAt = (r: WheelRange, i: number) => (r.off ? (i === 0 ? 0 : r.min + i - 1) : r.min + i);

function indexOf(r: WheelRange, v: number): number {
  if (r.off && v <= 0) return 0;
  const clamped = Math.max(r.min, Math.min(r.max, Math.round(v)));
  return clamped - r.min + (r.off ? 1 : 0);
}

const label = (v: number) => (v === 0 ? 'Off' : String(v));

/**
 * Where a value `d` steps off centre is drawn: lifted along the drum, smaller, fainter and lighter.
 * Shared by the first paint and the live wheel, so both look the same.
 */
export function wheelItemStyle(d: number): { y: number; scale: number; opacity: number; weight: number } {
  return {
    y: liftAt(d),
    scale: sizeAt(d),
    opacity: Math.abs(d) > REACH ? 0 : Math.exp(-0.8 * d * d),
    weight: Math.round(300 + 520 * Math.exp(-2 * d * d)),
  };
}

/** Off is set at 0.8em (settings-kit.css), so its lift is scaled back up to match the numerals'. */
const WORD_SIZE = 0.8;

function itemCss(d: number, word = false): string {
  const s = wheelItemStyle(d);
  return `transform:translateY(-50%) translateY(${(s.y / (word ? WORD_SIZE : 1)).toFixed(3)}em) scale(${s.scale.toFixed(3)});opacity:${s.opacity.toFixed(3)};font-variation-settings:'opsz' 60,'wght' ${s.weight}`;
}

function valueText(v: number, unit: string): string {
  if (v === 0) return 'Off';
  return unit ? `${v} ${unit}` : String(v);
}

export function numberWheelHtml(w: NumberWheelInput): string {
  const r: WheelRange = { min: w.min, max: w.max, off: !!w.off };
  const at = indexOf(r, w.value);
  const value = valueAt(r, at);
  const unit = w.unit || '';
  const items: string[] = [];
  for (let k = -REACH; k <= REACH; k++) {
    const i = at + k;
    const inRange = i >= 0 && i < count(r);
    const v = inRange ? valueAt(r, i) : -1;
    items.push(
      `<span class="nw__n${k === 0 ? ' is-centre' : ''}${v === 0 ? ' is-word' : ''}"${inRange ? '' : ' hidden'} style="${itemCss(k, v === 0)}">${inRange ? label(v) : ''}</span>`,
    );
  }
  return `<div class="nw${value === 0 ? ' is-off' : ''}" id="${esc(w.id)}" role="spinbutton" tabindex="0" aria-labelledby="${esc(w.labelledBy)}" aria-valuemin="${r.off ? 0 : r.min}" aria-valuemax="${r.max}" aria-valuenow="${value}" aria-valuetext="${esc(valueText(value, unit))}" data-min="${r.min}" data-max="${r.max}"${r.off ? ' data-off=""' : ''} data-page="${w.page ?? 10}" data-unit="${esc(unit)}" data-value="${value}"${w.attrs ? ` ${w.attrs}` : ''}>
    <span class="nw__drum" aria-hidden="true">${items.join('')}</span>
    ${unit ? `<span class="nw__unit" aria-hidden="true">${esc(unit)}</span>` : ''}
  </div>`;
}

/** Reads what a typed number means on this wheel: a value in range, or null to leave it as it was. */
export function parseWheelEntry(raw: string, r: WheelRange): number | null {
  const t = raw.trim().toLowerCase();
  if (r.off && (t === 'off' || t === '0')) return 0;
  const digits = t.replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return valueAt(r, indexOf(r, n));
}

/* ------------------------------------------------------------------ wiring */

interface State {
  r: WheelRange;
  pos: number;
  vel: number;
  target: number | null;
  frame: number;
  last: number;
  drag: { id: number; y0: number; p0: number; moved: boolean; samples: Array<{ t: number; y: number }> } | null;
  settle: ReturnType<typeof setTimeout> | null;
  keyCommit: ReturnType<typeof setTimeout> | null;
  shown: number;
}

const states = new WeakMap<HTMLElement, State>();
const wiredRoots = new WeakSet<HTMLElement>();

const reduceMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function stateOf(el: HTMLElement): State {
  let st = states.get(el);
  if (!st) {
    const r: WheelRange = { min: Number(el.dataset.min) || 0, max: Number(el.dataset.max) || 0, off: el.dataset.off != null };
    const at = indexOf(r, Number(el.dataset.value));
    st = { r, pos: at, vel: 0, target: null, frame: 0, last: 0, drag: null, settle: null, keyCommit: null, shown: at };
    states.set(el, st);
  }
  return st;
}

/** Pixels of drag that turn the wheel one step, so the number under the finger moves with it. */
function stepPx(el: HTMLElement): number {
  const size = parseFloat(getComputedStyle(el.querySelector('.nw__drum') || el).fontSize) || 64;
  return PITCH * sizeAt(0) * size;
}

function render(el: HTMLElement, st: State): void {
  const n = count(st.r);
  const base = Math.round(Math.max(0, Math.min(n - 1, st.pos)));
  const items = el.querySelectorAll<HTMLElement>('.nw__n');
  items.forEach((item, k) => {
    const i = base + k - REACH;
    const inRange = i >= 0 && i < n;
    item.hidden = !inRange;
    if (!inRange) return;
    const v = valueAt(st.r, i);
    const text = label(v);
    if (item.textContent !== text) item.textContent = text;
    item.classList.toggle('is-word', v === 0);
    const d = i - st.pos;
    item.style.cssText = itemCss(d, v === 0);
    item.classList.toggle('is-centre', i === base);
  });
  if (base !== st.shown) {
    st.shown = base;
    const v = valueAt(st.r, base);
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', valueText(v, el.dataset.unit || ''));
    el.classList.toggle('is-off', v === 0);
  }
}

/** Sends the settled value out when it changed. */
function commit(el: HTMLElement, st: State): void {
  const v = valueAt(st.r, Math.round(Math.max(0, Math.min(count(st.r) - 1, st.pos))));
  if (String(v) === el.dataset.value) return;
  el.dataset.value = String(v);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function stop(st: State): void {
  if (st.frame) cancelAnimationFrame(st.frame);
  st.frame = 0;
  st.target = null;
}

/** A slightly underdamped spring, so the wheel lands with the faintest overshoot, as a physical drum would. */
const STIFFNESS = 210;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.82;

/** Lands the wheel on `target`. A wheel already moving keeps its speed unless a release gives a new one. */
function springTo(el: HTMLElement, st: State, target: number, velocity?: number): void {
  const n = count(st.r);
  target = Math.max(0, Math.min(n - 1, Math.round(target)));
  if (reduceMotion()) {
    stop(st);
    st.pos = target;
    st.vel = 0;
    render(el, st);
    commit(el, st);
    return;
  }
  st.target = target;
  if (velocity != null || !st.frame) st.vel = velocity ?? 0;
  if (st.frame) return;
  st.last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.032, Math.max(0.001, (now - st.last) / 1000));
    st.last = now;
    const goal = st.target ?? target;
    st.vel += (-STIFFNESS * (st.pos - goal) - DAMPING * st.vel) * dt;
    st.pos += st.vel * dt;
    if (Math.abs(st.pos - goal) < 0.002 && Math.abs(st.vel) < 0.02) {
      st.pos = goal;
      st.vel = 0;
      st.frame = 0;
      st.target = null;
      render(el, st);
      commit(el, st);
      return;
    }
    render(el, st);
    st.frame = requestAnimationFrame(tick);
  };
  st.frame = requestAnimationFrame(tick);
}

/** Past either end the wheel gives way less and less, as iOS lists do. */
function rubber(pos: number, n: number): number {
  const over = pos < 0 ? pos : pos > n - 1 ? pos - (n - 1) : 0;
  if (!over) return pos;
  const give = (Math.abs(over) * 0.55 * 2) / (2 + 0.55 * Math.abs(over));
  return over < 0 ? -give : n - 1 + give;
}

function jump(el: HTMLElement, st: State, index: number): void {
  stop(st);
  st.pos = Math.max(0, Math.min(count(st.r) - 1, index));
  st.vel = 0;
  render(el, st);
  // Key presses come in runs; the value goes out once they pause.
  if (st.keyCommit) clearTimeout(st.keyCommit);
  st.keyCommit = setTimeout(() => {
    st.keyCommit = null;
    commit(el, st);
  }, 350);
}

function openEntry(el: HTMLElement, st: State, first = ''): void {
  if (el.querySelector('.nw__entry')) return;
  stop(st);
  st.pos = Math.round(st.pos);
  render(el, st);
  const input = document.createElement('input');
  input.className = 'nw__entry';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.enterKeyHint = 'done';
  input.maxLength = String(st.r.max).length;
  const name = document.getElementById(el.getAttribute('aria-labelledby') || '')?.textContent || '';
  input.setAttribute('aria-label', name);
  input.value = first || label(valueAt(st.r, Math.round(st.pos)));
  el.classList.add('is-typing');
  el.appendChild(input);
  input.focus();
  if (first) input.setSelectionRange(input.value.length, input.value.length);
  else input.select();
  let done = false;
  const close = (keep: boolean, refocus: boolean) => {
    if (done) return;
    done = true;
    const v = keep ? parseWheelEntry(input.value, st.r) : null;
    input.remove();
    el.classList.remove('is-typing');
    if (v != null) {
      st.pos = indexOf(st.r, v);
      render(el, st);
      commit(el, st);
    }
    if (refocus) el.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      close(true, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(false, true);
    }
  });
  input.addEventListener('blur', () => close(true, false));
  // The field's own input and change events stay inside the wheel; the wheel sends its own change.
  input.addEventListener('input', (e) => e.stopPropagation());
  input.addEventListener('change', (e) => e.stopPropagation());
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
}

/** Wires every wheel inside `root`, now and after any repaint. Safe to call more than once. */
export function wireNumberWheels(root: HTMLElement): void {
  if (wiredRoots.has(root)) return;
  wiredRoots.add(root);
  const wheelOf = (t: EventTarget | null) => {
    const el = (t as Element | null)?.closest?.('.nw') as HTMLElement | null;
    return el && root.contains(el) && !(t as Element).closest('.nw__entry') ? el : null;
  };

  root.addEventListener('pointerdown', (e) => {
    const el = wheelOf(e.target);
    if (!el || e.button !== 0) return;
    const st = stateOf(el);
    if (st.drag) return;
    stop(st);
    st.vel = 0;
    st.drag = { id: e.pointerId, y0: e.clientY, p0: st.pos, moved: false, samples: [{ t: performance.now(), y: e.clientY }] };
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('is-held');
  });

  root.addEventListener('pointermove', (e) => {
    const el = wheelOf(e.target);
    const st = el && states.get(el);
    const drag = st?.drag;
    if (!el || !st || !drag || drag.id !== e.pointerId) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    el.classList.add('is-dragging');
    st.pos = rubber(drag.p0 - dy / stepPx(el), count(st.r));
    const now = performance.now();
    drag.samples.push({ t: now, y: e.clientY });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
    render(el, st);
  });

  const release = (e: PointerEvent, cancelled: boolean) => {
    const el = wheelOf(e.target);
    const st = el && states.get(el);
    const drag = st?.drag;
    if (!el || !st || !drag || drag.id !== e.pointerId) return;
    st.drag = null;
    el.classList.remove('is-held', 'is-dragging');
    if (!drag.moved) {
      if (cancelled) return;
      // A tap: the centre opens the field, above or below steps one towards that side.
      const drum = el.querySelector<HTMLElement>('.nw__drum')!.getBoundingClientRect();
      const off = e.clientY - (drum.top + drum.height / 2);
      if (Math.abs(off) < stepPx(el) * 0.55) openEntry(el, st);
      else springTo(el, st, Math.round(st.pos) + Math.sign(off));
      return;
    }
    // A flick carries on: project where the wheel would coast to, then let the spring land it there.
    // Only the last tenth of a second counts, and only if the finger was still moving when it lifted.
    const now = performance.now();
    const recent = drag.samples.filter((p) => now - p.t <= 100);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = first && last ? last.t - first.t : 0;
    const px = dt >= 8 ? (last.y - first.y) / dt : 0;
    const v = -Math.max(-6, Math.min(6, px)) / stepPx(el);
    springTo(el, st, st.pos + v * 330, v * 1000);
  };
  root.addEventListener('pointerup', (e) => release(e, false));
  root.addEventListener('pointercancel', (e) => release(e, true));

  root.addEventListener(
    'wheel',
    (e) => {
      const el = wheelOf(e.target);
      if (!el || e.ctrlKey) return;
      e.preventDefault();
      const st = stateOf(el);
      const delta = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
      if (!delta) return;
      if (e.deltaMode !== 0 || Math.abs(delta) >= 50) {
        // A mouse wheel: one value a notch (a fast spin can report several notches in one event).
        const notches = Math.max(1, Math.round(Math.abs(delta) / 100));
        springTo(el, st, (st.target ?? Math.round(st.pos)) + Math.sign(delta) * notches);
        return;
      }
      // A trackpad: the wheel follows the fingers, then settles on the nearest value.
      stop(st);
      st.pos = rubber(st.pos + delta / stepPx(el), count(st.r));
      render(el, st);
      if (st.settle) clearTimeout(st.settle);
      st.settle = setTimeout(() => {
        st.settle = null;
        springTo(el, st, Math.round(st.pos));
      }, 120);
    },
    { passive: false },
  );

  root.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (!el?.classList?.contains('nw') || !root.contains(el) || e.altKey || e.ctrlKey || e.metaKey) return;
    const st = stateOf(el);
    const at = st.target ?? Math.round(st.pos);
    const page = Number(el.dataset.page) || 10;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = at + 1;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = at - 1;
        break;
      case 'PageUp':
        next = at + page;
        break;
      case 'PageDown':
        next = at - page;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count(st.r) - 1;
        break;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        openEntry(el, st);
        return;
      default:
        if (/^\d$/.test(e.key) || (st.r.off && /^o$/i.test(e.key))) {
          e.preventDefault();
          openEntry(el, st, e.key);
        }
        return;
    }
    e.preventDefault();
    jump(el, st, next);
  });

  // Leaving the wheel sends a pending keyboard value at once.
  root.addEventListener('focusout', (e) => {
    const el = e.target as HTMLElement;
    const st = el?.classList?.contains('nw') ? states.get(el) : undefined;
    if (!st?.keyCommit) return;
    clearTimeout(st.keyCommit);
    st.keyCommit = null;
    commit(el, st);
  });
}
