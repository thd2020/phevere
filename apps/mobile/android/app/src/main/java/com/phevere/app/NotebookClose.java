package com.phevere.app;

import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

/**
 * Closing a pop-up destroys its page. A word saved a moment earlier may still be on its way to
 * the notebook file, so the pop-up first asks its page to finish writing and closes when the
 * page says it is done (or after a few seconds, whatever happens).
 */
final class NotebookClose {
  private static final long WAIT_MS = 4000;

  private final Handler ui = new Handler(Looper.getMainLooper());
  private Runnable pending;

  /** True while a close waits for the page. */
  boolean waiting() {
    return pending != null;
  }

  /**
   * Runs `close` once the page has written its notebook. `onWait` runs first when the page
   * still has something to write, so the caller can hide the pop-up meanwhile.
   */
  void run(WebView web, Runnable onWait, Runnable close) {
    if (pending != null) return;
    if (web == null) {
      close.run();
      return;
    }
    Runnable once = new Runnable() {
      @Override
      public void run() {
        if (pending != this) return;
        pending = null;
        ui.removeCallbacks(this);
        close.run();
      }
    };
    pending = once;
    web.evaluateJavascript("window.__pvFlushNotebook ? window.__pvFlushNotebook() : false", value -> {
      if (pending != once) return;
      if ("true".equals(value)) {
        onWait.run();
        ui.postDelayed(once, WAIT_MS);
      } else {
        once.run();
      }
    });
  }

  /** The page reported its notebook written. */
  void flushed() {
    Runnable r = pending;
    if (r != null) r.run();
  }

  /** A new lookup arrived while closing: keep the pop-up. */
  void cancel() {
    if (pending != null) ui.removeCallbacks(pending);
    pending = null;
  }
}
