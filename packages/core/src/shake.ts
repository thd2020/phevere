/**
 * Shake detection from DeviceMotion samples, after Square's Seismic (the detector most Android
 * apps use): a sample whose acceleration including gravity is over 13 m/s² counts as
 * accelerating, and a shake is a stretch of at least a quarter second, within the last half
 * second, in which three quarters of the samples are accelerating. A double shake is two of
 * those within 1.5 s with a short pause between them; after one, the detector rests for a
 * second.
 */

export const SHAKE_THRESHOLD = 13;
const MAX_WINDOW = 500;
const MIN_WINDOW = 250;
const MIN_SAMPLES = 4;
export const DOUBLE_SHAKE_GAP = 1500;
const REST_AFTER = 1000;
/** The pause that separates two shakes, in ms. */
const PAUSE = 120;

type Sample = { t: number; on: boolean };

export interface ShakeDetector {
  /** Feed one sample: time in ms and acceleration in m/s². Returns true when it completes a shake. */
  push(t: number, x: number, y: number, z: number): boolean;
  reset(): void;
}

export function shakeDetector(threshold = SHAKE_THRESHOLD): ShakeDetector {
  let q: Sample[] = [];
  const reset = () => {
    q = [];
  };
  return {
    reset,
    push(t, x, y, z) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
      q.push({ t, on: x * x + y * y + z * z > threshold * threshold });
      while (q.length > MIN_SAMPLES && t - q[0].t > MAX_WINDOW) q.shift();
      if (q.length < MIN_SAMPLES || t - q[0].t < MIN_WINDOW) return false;
      const on = q.reduce((n, s) => n + (s.on ? 1 : 0), 0);
      if (on < (q.length >> 1) + (q.length >> 2)) return false;
      reset();
      return true;
    },
  };
}

/**
 * Two shakes with a pause between them: `push` returns true on the second one. Shaking on
 * without a pause is one long shake, however long it lasts.
 */
export function doubleShakeDetector(threshold = SHAKE_THRESHOLD): ShakeDetector {
  const one = shakeDetector(threshold);
  let last = -Infinity;
  let restUntil = -Infinity;
  let calmFrom = -Infinity;
  let paused = false;
  return {
    reset() {
      one.reset();
      last = -Infinity;
      paused = false;
    },
    push(t, x, y, z) {
      if (t < restUntil) return false;
      const still = x * x + y * y + z * z <= threshold * threshold;
      if (!still) calmFrom = Infinity;
      else if (calmFrom === Infinity) calmFrom = t;
      if (still && t - calmFrom >= PAUSE) paused = true;
      if (!one.push(t, x, y, z)) return false;
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
  const onMotion = (ev: any) => {
    const a = ev.accelerationIncludingGravity || ev.acceleration;
    if (!a) return;
    if (det.push(ev.timeStamp || win.performance?.now?.() || Date.now(), Number(a.x), Number(a.y), Number(a.z))) fn();
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
