package com.phevere.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import io.github.libxposed.service.XposedService;
import io.github.libxposed.service.XposedServiceHelper;
import java.util.Collections;
import java.util.List;

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
  /** Packages Phevere has already asked LSPosed to add, so each is asked about once. */
  private static final String SCOPE_ASKED = "lsposed_scope_asked";

  private static volatile XposedService service;
  private static Context app;
  /** A lookup that arrived before LSPosed bound to a freshly started Phevere. */
  private static volatile String pendingScope;

  private LsposedPrefs() {}

  /** Called once from Application.onCreate. */
  static void init(Context context) {
    app = context.getApplicationContext();
    if (Build.VERSION.SDK_INT < 26) return;  // libxposed service needs Android 8+
    XposedServiceHelper.registerListener(new XposedServiceHelper.OnServiceListener() {
      @Override public void onServiceBind(@NonNull XposedService bound) {
        service = bound;
        publish(app);
        String pending = pendingScope;
        pendingScope = null;
        if (pending != null) offerScope(app, pending);
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

  /**
   * A selection-bar lookup arrived from {@code pkg} without passing through the module. When
   * the user has set a custom slot or the instant press and {@code pkg} is outside the module's
   * scope, ask LSPosed once to add it; LSPosed shows its own approval notification. An app
   * whose screens belong to another package draws its bar in that package's process, so the
   * package the user selected in LSPosed is not the one that needs the hook.
   */
  static void offerScope(Context ctx, String pkg) {
    if (pkg == null || pkg.isEmpty() || pkg.equals(ctx.getPackageName()) || "android".equals(pkg)) return;
    XposedService s = service;
    if (s == null) {
      // A press from another app often cold-starts Phevere; LSPosed binds a moment later.
      pendingScope = pkg;
      return;
    }
    if (CapturePrefs.barSlot(ctx) < 0 && !CapturePrefs.autoPopup(ctx)) return;
    SharedPreferences asked = ctx.getSharedPreferences(SCOPE_ASKED, Context.MODE_PRIVATE);
    if (asked.getBoolean(pkg, false)) return;
    try {
      // Compose bars launch Phevere without the module's marker even in hooked apps.
      if (s.getScope().contains(pkg)) return;
      asked.edit().putBoolean(pkg, true).apply();
      s.requestScope(Collections.singletonList(pkg), new XposedService.OnScopeEventListener() {
        @Override public void onScopeRequestApproved(@NonNull List<String> approved) {
          Log.i("Phevere", "LSPosed scope added: " + approved);
        }

        @Override public void onScopeRequestFailed(@NonNull String message) {
          Log.w("Phevere", "LSPosed scope request for " + pkg + ": " + message);
        }
      });
    } catch (RuntimeException e) {
      Log.w("Phevere", "LSPosed scope request", e);
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
