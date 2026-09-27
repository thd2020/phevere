package com.phevere.app;

import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;

public final class CapturePrefs {
  public static final String EXTRA_QUERY = "com.phevere.app.QUERY";
  private static final String PREFS = "phevere_capture";
  private static final String FLOATING = "floating_strip";
  private static final String AUTO_POPUP = "auto_popup";
  private static final String BAR_SLOT = "bar_slot";
  private static final String MODULE_SEEN = "module_seen";

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
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(AUTO_POPUP, on).commit();
    LsposedPrefs.publish(ctx);
  }

  /** LSPosed only: -1 keeps the system's placement; otherwise Phevere's slot on the bar. */
  public static int barSlot(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(BAR_SLOT, -1);
  }

  public static void setBarSlot(Context ctx, int slot) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(BAR_SLOT, Math.max(-1, slot)).commit();
    LsposedPrefs.publish(ctx);
  }

  /** A lookup arrived through the LSPosed module (legacy or modern): it is active. */
  public static void markModuleSeen(Context ctx) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(MODULE_SEEN, true).apply();
  }

  /** Rooted with the module working: LSPosed replaces the accessibility fallback. */
  public static boolean moduleActive(Context ctx) {
    return LsposedPrefs.modernActive()
        || ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(MODULE_SEEN, false);
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
