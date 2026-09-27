package com.phevere.app;

import android.app.Application;

public class PhevereApp extends Application {
  @Override
  public void onCreate() {
    super.onCreate();
    // Must register early: LSPosed delivers its service binder once, through XposedProvider.
    LsposedPrefs.init(this);
  }
}
