package com.phevere.app;

import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;

public final class CapturePrefs {
  public static final String EXTRA_QUERY = "com.phevere.app.QUERY";
  private static final String PREFS = "phevere_capture";
  private static final String FLOATING = "floating_strip";
  private static final String AUTO_POPUP = "auto_popup";

  private CapturePrefs() {}

  public static boolean floatingStrip(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(FLOATING, true);
  }

  public static void setFloatingStrip(Context ctx, boolean on) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(FLOATING, on).apply();
  }

  /** Off by default: selection menu → Phevere. On: pop up as soon as text is selected. */
  public static boolean autoPopup(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(AUTO_POPUP, false);
  }

  public static void setAutoPopup(Context ctx, boolean on) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(AUTO_POPUP, on).apply();
  }

  public static boolean canDrawOverlays(Context ctx) {
    return Settings.canDrawOverlays(ctx);
  }

  public static boolean accessibilityOn(Context ctx) {
    String enabled = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
    if (enabled == null) return false;
    ComponentName self = new ComponentName(ctx, SelectionAccessibilityService.class);
    for (String entry : enabled.split(":")) {
      if (self.equals(ComponentName.unflattenFromString(entry))) return true;
    }
    return false;
  }
}
