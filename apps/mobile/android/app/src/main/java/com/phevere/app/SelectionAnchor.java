package com.phevere.app;

import android.content.Intent;
import android.graphics.Rect;
import android.os.SystemClock;

/**
 * Where the selected word is on screen, so the pop-up can open beside it. Known for
 * selections inside Phevere and, with the accessibility fallback on, in other apps.
 */
final class SelectionAnchor {
  static final String EXTRA = "com.phevere.app.ANCHOR";
  private static final long FRESH_MS = 4000;
  private static volatile Rect last;
  private static volatile long at;

  private SelectionAnchor() {}

  /** Remember the latest selection seen by the accessibility service. */
  static void remember(Rect screen) {
    last = screen == null ? null : new Rect(screen);
    at = SystemClock.uptimeMillis();
  }

  /** A selection position recent enough to belong to the lookup being opened now. */
  static Rect recent() {
    Rect r = last;
    return r != null && SystemClock.uptimeMillis() - at < FRESH_MS ? new Rect(r) : null;
  }

  static void put(Intent intent, Rect anchor) {
    if (anchor != null) intent.putExtra(EXTRA, new int[] {anchor.left, anchor.top, anchor.right, anchor.bottom});
  }

  static Rect from(Intent intent) {
    int[] v = intent == null ? null : intent.getIntArrayExtra(EXTRA);
    return v != null && v.length == 4 ? new Rect(v[0], v[1], v[2], v[3]) : null;
  }
}
