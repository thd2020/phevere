package com.phevere.app;

import android.content.Intent;

public class StripActivity extends MainActivity {
  private final NotebookClose closer = new NotebookClose();
  private boolean closing;

  @Override
  protected boolean isStrip() {
    return true;
  }

  @Override
  public void closeStrip() {
    finish();
  }

  /**
   * Every way out of the pop-up (Back, a tap outside, its close control) ends here. A word
   * saved a moment earlier is written to the notebook before the page goes away.
   */
  @Override
  public void finish() {
    if (closing || isFinishing()) {
      super.finish();
      return;
    }
    closer.run(web(), () -> showWindow(false), () -> {
      closing = true;
      super.finish();
    });
  }

  /** Hidden while a closing pop-up finishes saving: out of sight, and taps pass through. */
  private void showWindow(boolean on) {
    android.view.Window w = getWindow();
    int flags = android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
    if (on) {
      w.clearFlags(flags);
      w.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
    } else {
      w.addFlags(flags);
      w.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
    }
    w.getDecorView().setVisibility(on ? android.view.View.VISIBLE : android.view.View.INVISIBLE);
  }

  @Override
  public void notebookFlushed() {
    closer.flushed();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    if (closer.waiting()) {
      closer.cancel();
      showWindow(true);
    }
    super.onNewIntent(intent);
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
