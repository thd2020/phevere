/**
 * Shake detection from DeviceMotion samples, after Square's Seismic (the detector most Android
 * apps use), with two changes that let a double shake be two short shakes. A sample counts as
 * accelerating when the phone's own acceleration, with gravity filtered out as Android's sensor
 * guide does, is over 5 m/s²; that is Seismic's light setting for a phone shaken sideways, and
 * it holds the same when the phone is shaken up and down. A shake is a stretch of at least a
 * quarter second, within the last half second, in which two thirds of the samples are
 * accelerating. A double shake is two shakes within 1.5 s with a pause of at least 120 ms
 * between them; the pause starts the second shake afresh, so it needs only its own quarter
 * second. After a double shake the detector rests for a second.
 */

export const SHAKE_THRESHOLD = 5;
/** Share of samples in the window that must be accelerating. Seismic asks three quarters. */
export const SHAKE_SHARE = 2 / 3;
const MAX_WINDOW = 500;
const MIN_WINDOW = 250;
const MIN_SAMPLES = 4;
export const DOUBLE_SHAKE_GAP = 1500;
const REST_AFTER = 1000;
/** The pause that separates two shakes, in ms. */
const PAUSE = 120;
/**
 * Time constant of the gravity filter, in ms. Short enough that turning the phone over is not
 * read as a shake, long enough that a shake of three or more strokes a second passes through.
 */
const GRAVITY_MS = 100;

export interface ShakeOptions {
  /** Acceleration without gravity that counts, in m/s². */
  threshold?: number;
  /** Share of accelerating samples a shake needs. */
  share?: number;
}

export interface ShakeDetector {
  /**
   * Feed one sample: time in ms and acceleration including gravity in m/s², as DeviceMotion's
   * accelerationIncludingGravity and Android's accelerometer give it. Returns true when the
   * sample completes a shake (or, for the double detector, a double shake).
   */
  push(t: number, x: number, y: number, z: number): boolean;
  reset(): void;
}

/** How strongly the phone itself moves: the sample minus a running estimate of gravity. */
function motionFilter(): { push(t: number, x: number, y: number, z: number): number } {
  const g = [0, 0, 0];
  let n = 0;
  let lastT = 0;
  return {
    push(t, x, y, z) {
      // The first samples set gravity by their average; after that it follows slowly.
      const k = n < 1 ? 1 : Math.max(1 / (n + 1), 1 - Math.exp(-Math.max(1, t - lastT) / GRAVITY_MS));
      n += 1;
      lastT = t;
      g[0] += (x - g[0]) * k;
      g[1] += (y - g[1]) * k;
      g[2] += (z - g[2]) * k;
      return Math.hypot(x - g[0], y - g[1], z - g[2]);
    },
  };
}

/** Seismic's window: true once enough of the last half second is accelerating. */
function burstDetector(share: number) {
  let q: Array<{ t: number; on: boolean }> = [];
  return {
    reset() {
      q = [];
    },
    push(t: number, on: boolean): boolean {
      q.push({ t, on });
      while (q.length > MIN_SAMPLES && t - q[0].t > MAX_WINDOW) q.shift();
      if (q.length < MIN_SAMPLES || t - q[0].t < MIN_WINDOW) return false;
      const count = q.reduce((c, s) => c + (s.on ? 1 : 0), 0);
      if (count < q.length * share) return false;
      q = [];
      return true;
    },
  };
}

const finite = (x: number, y: number, z: number) => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);

export function shakeDetector(opts: ShakeOptions = {}): ShakeDetector {
  const threshold = opts.threshold ?? SHAKE_THRESHOLD;
  let motion = motionFilter();
  const burst = burstDetector(opts.share ?? SHAKE_SHARE);
  return {
    reset() {
      motion = motionFilter();
      burst.reset();
    },
    push(t, x, y, z) {
      if (!finite(x, y, z)) return false;
      return burst.push(t, motion.push(t, x, y, z) > threshold);
    },
  };
}

/**
 * Two shakes with a pause between them: `push` returns true on the second one. Shaking on
 * without a pause is one long shake, however long it lasts.
 */
export function doubleShakeDetector(opts: ShakeOptions = {}): ShakeDetector {
  const threshold = opts.threshold ?? SHAKE_THRESHOLD;
  const motion = motionFilter();
  const burst = burstDetector(opts.share ?? SHAKE_SHARE);
  let last = -Infinity;
  let restUntil = -Infinity;
  let calmFrom = -Infinity;
  let paused = false;
  return {
    reset() {
      burst.reset();
      last = -Infinity;
      paused = false;
    },
    push(t, x, y, z) {
      if (!finite(x, y, z)) return false;
      // Gravity is followed through the rest too, so the next shake is measured right.
      const on = motion.push(t, x, y, z) > threshold;
      if (t < restUntil) return false;
      if (on) calmFrom = Infinity;
      else if (calmFrom === Infinity) calmFrom = t;
      if (!on && t - calmFrom >= PAUSE) {
        // A pause: the next shake is judged on its own samples, not on the calm before it.
        paused = true;
        burst.reset();
        return false;
      }
      if (!burst.push(t, on)) return false;
      if (paused && t - last <= DOUBLE_SHAKE_GAP) {
        last = -Infinity;
        paused = false;
        restUntil = t + REST_AFTER;
        return true;
      }
      last = t;
      paused = false;
      return false;
    },
  };
}

/**
 * Listen for double shakes on `win` until `signal` aborts. iOS only sends motion after the page
 * asks, and it may only ask from a tap; `askOn` is the element whose first tap asks.
 */
export function onDoubleShake(win: any, signal: AbortSignal, fn: () => void, askOn?: any): void {
  const DME = win?.DeviceMotionEvent;
  if (!DME || !win.addEventListener) return;
  const det = doubleShakeDetector();
  const has = (a: any) => !!a && typeof a.x === 'number' && typeof a.y === 'number' && typeof a.z === 'number';
  const onMotion = (ev: any) => {
    // A phone without an accelerometer for this sends empty readings (nulls), which are skipped.
    // Without gravity, the filter's estimate of it simply stays near zero.
    const a = has(ev.accelerationIncludingGravity) ? ev.accelerationIncludingGravity : has(ev.acceleration) ? ev.acceleration : null;
    if (!a) return;
    // The page's own clock: an event's timeStamp is not on the same clock in every WebView.
    if (det.push(win.performance?.now?.() ?? Date.now(), a.x, a.y, a.z)) fn();
  };
  // Added again after iOS grants motion, so Safari starts sending it to this page.
  const listen = () => {
    win.removeEventListener('devicemotion', onMotion);
    if (!signal.aborted) win.addEventListener('devicemotion', onMotion, { signal, passive: true });
  };
  // Where motion needs no permission it flows at once.
  listen();
  if (typeof DME.requestPermission !== 'function' || motionPermission !== 'unknown' || !askOn?.addEventListener) return;
  const ask = () => {
    if (motionPermission !== 'unknown') return;
    motionPermission = 'asking';
    Promise.resolve(DME.requestPermission())
      .then((state: string) => {
        motionPermission = state === 'granted' ? 'granted' : 'denied';
        if (motionPermission === 'granted') listen();
      })
      .catch(() => {
        // Not from a tap after all; the next tap asks again.
        motionPermission = 'unknown';
      });
  };
  // Safari counts click and touchend as a tap, not touchstart. Capture, so a control that stops
  // the click still asks.
  askOn.addEventListener('click', ask, { signal, capture: true });
}

let motionPermission: 'unknown' | 'asking' | 'granted' | 'denied' = 'unknown';
