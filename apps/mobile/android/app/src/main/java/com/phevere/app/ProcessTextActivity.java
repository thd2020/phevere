package com.phevere.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

public class ProcessTextActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    CharSequence extra = getIntent() != null ? getIntent().getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT) : null;
    String text = extra == null ? "" : extra.toString().trim();
    boolean floating = CapturePrefs.floatingStrip(this);
    if (floating && CapturePrefs.canDrawOverlays(this) && !text.isEmpty()) {
      OverlayService.show(this, text);
      finish();
      return;
    }
    Class<?> dest = floating ? StripActivity.class : MainActivity.class;
    Intent i = new Intent(this, dest);
    if (!text.isEmpty()) i.putExtra(CapturePrefs.EXTRA_QUERY, text);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    startActivity(i);
    finish();
  }
}
