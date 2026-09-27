package com.phevere.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import io.github.libxposed.service.XposedService;
import io.github.libxposed.service.XposedServiceHelper;

/**
 * Hands the two selection-bar switches to the LSPosed module running inside other apps.
 *
 * Modern LSPosed (libxposed API 101+): remote preferences, private to this module.
 * Older LSPosed: a world-readable preferences file read through XSharedPreferences; LSPosed
 * allows MODE_WORLD_READABLE for enabled modules (xposedsharedprefs). It holds only these
 * two values. Both are written every time, so either framework sees the same settings.
 */
final class LsposedPrefs {
  static final String GROUP = "selection";
  static final String LEGACY_FILE = "phevere_hook";
  static final String KEY_INSTANT = "instant";
  /** -1: system placement; otherwise Phevere's slot on the bar's main row. */
  static final String KEY_SLOT = "slot";

  private static volatile XposedService service;
  private static Context app;

  private LsposedPrefs() {}

  /** Called once from Application.onCreate. */
  static void init(Context context) {
    app = context.getApplicationContext();
    if (Build.VERSION.SDK_INT < 26) return;  // libxposed service needs Android 8+
    XposedServiceHelper.registerListener(new XposedServiceHelper.OnServiceListener() {
      @Override public void onServiceBind(@NonNull XposedService bound) {
        service = bound;
        publish(app);
      }

      @Override public void onServiceDied(@NonNull XposedService dead) {
        if (service == dead) service = null;
      }
    });
  }

  /** Modern LSPosed has connected to Phevere (module enabled). */
  static boolean modernActive() {
    return service != null;
  }

  static String frameworkName() {
    XposedService s = service;
    try {
      return s == null ? "" : s.getFrameworkName() + " " + s.getFrameworkVersion();
    } catch (RuntimeException e) {
      return "";
    }
  }

  /** Push the current switches to every channel the module may read. */
  @SuppressWarnings("deprecation")
  static void publish(Context ctx) {
    boolean instant = CapturePrefs.autoPopup(ctx);
    int slot = CapturePrefs.barSlot(ctx);
    XposedService s = service;
    if (s != null) {
      try {
        s.getRemotePreferences(GROUP).edit().putBoolean(KEY_INSTANT, instant).putInt(KEY_SLOT, slot).apply();
      } catch (RuntimeException e) {
        Log.w("Phevere", "LSPosed remote preferences", e);
      }
    }
    try {
      SharedPreferences legacy = ctx.getSharedPreferences(LEGACY_FILE, Context.MODE_WORLD_READABLE);
      legacy.edit().putBoolean(KEY_INSTANT, instant).putInt(KEY_SLOT, slot).commit();
    } catch (SecurityException ignored) {
      // No legacy LSPosed module active: Android refuses world-readable files; nothing reads it.
    }
  }
}
