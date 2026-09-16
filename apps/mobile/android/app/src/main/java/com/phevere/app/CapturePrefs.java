package com.phevere.app;

import android.content.Context;
import android.provider.Settings;

public final class CapturePrefs {
  public static final String EXTRA_QUERY = "com.phevere.app.QUERY";
  private static final String PREFS = "phevere_capture";
  private static final String FLOATING = "floating_strip";

  private CapturePrefs() {}

  public static boolean floatingStrip(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(FLOATING, false);
  }

  public static void setFloatingStrip(Context ctx, boolean on) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(FLOATING, on).apply();
  }

  public static boolean canDrawOverlays(Context ctx) {
    return Settings.canDrawOverlays(ctx);
  }
}
