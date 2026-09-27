package com.phevere.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Selection-tray Phevere: popup over the other app, never the full dictionary. */
public class ProcessTextActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    CharSequence extra = getIntent() != null ? getIntent().getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT) : null;
    if (extra == null && getIntent() != null) extra = getIntent().getCharSequenceExtra(Intent.EXTRA_TEXT);
    String text = extra == null ? "" : extra.toString().trim();
    if (!text.isEmpty()) {
      openPopup(this, text);
      overridePendingTransition(0, 0);
    }
    finish();
  }

  /** The one pop-up path: selection tray in other apps and selections inside Phevere. */
  static void openPopup(android.content.Context ctx, String text) {
    openPopup(ctx, text, null);
  }

  /** anchor: the selection in screen pixels when known; else a recent accessibility position. */
  static void openPopup(android.content.Context ctx, String text, android.graphics.Rect anchor) {
    if (anchor == null) anchor = SelectionAnchor.recent();
    if (CapturePrefs.floatingStrip(ctx) && CapturePrefs.canDrawOverlays(ctx)) {
      OverlayService.show(ctx, text, anchor);
      return;
    }
    Intent i = new Intent(ctx, StripActivity.class);
    i.putExtra(CapturePrefs.EXTRA_QUERY, text);
    SelectionAnchor.put(i, anchor);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
    ctx.startActivity(i);
  }
}
