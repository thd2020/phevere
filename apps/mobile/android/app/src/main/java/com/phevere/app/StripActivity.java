package com.phevere.app;

import android.content.Intent;

public class StripActivity extends MainActivity {
  @Override
  protected boolean isStrip() {
    return true;
  }

  @Override
  public void closeStrip() {
    finish();
  }

  @Override
  public void expandToFullApp(String query) {
    Intent i = new Intent(this, MainActivity.class);
    if (query != null && !query.isEmpty()) i.putExtra(CapturePrefs.EXTRA_QUERY, query);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    startActivity(i);
    finish();
  }
}
