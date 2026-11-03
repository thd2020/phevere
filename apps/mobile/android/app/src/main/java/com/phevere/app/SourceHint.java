package com.phevere.app;

import org.json.JSONObject;

/**
 * Where the last selection lookup came from: the launching app's name, and a page title or URL
 * when the LSPosed module could read one in that app. The pop-up's page takes it once
 * ("takeSourceHint") and keeps it with the word if the word is saved. It never leaves the device
 * except inside the learner's own notebook sync.
 */
final class SourceHint {
  /** A hint older than this belongs to an earlier lookup. */
  private static final long MAX_AGE_MS = 10 * 60 * 1000;

  private static String text;
  private static JSONObject source;
  private static long at;

  private SourceHint() {}

  static synchronized void set(String lookupText, JSONObject src) {
    text = lookupText;
    source = src;
    at = android.os.SystemClock.uptimeMillis();
  }

  /** {text, source} for the latest lookup, or null; cleared once taken. */
  static synchronized JSONObject take() {
    try {
      if (source == null || android.os.SystemClock.uptimeMillis() - at > MAX_AGE_MS) return null;
      return new JSONObject().put("text", text).put("source", source);
    } catch (Exception e) {
      return null;
    } finally {
      source = null;
      text = null;
    }
  }
}
