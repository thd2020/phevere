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
    String text = extra == null ? "" : extra.toString().trim();
    if (text.isEmpty()) {
      finish();
      return;
    }
    if (CapturePrefs.canDrawOverlays(this)) {
      OverlayService.show(this, text);
      finish();
      return;
    }
    Intent i = new Intent(this, StripActivity.class);
    i.putExtra(CapturePrefs.EXTRA_QUERY, text);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
    startActivity(i);
    overridePendingTransition(0, 0);
    finish();
  }
}
