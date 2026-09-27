package com.phevere.app;

import android.content.SharedPreferences;
import android.util.Log;
import androidx.annotation.NonNull;
import io.github.libxposed.api.XposedModule;
import java.lang.reflect.Method;

/**
 * Modern LSPosed entry (META-INF/xposed/java_init.list, libxposed API 101+). Settings come
 * from LSPosed remote preferences, private to this module; the behaviour is SelectionBar,
 * shared with the legacy entry.
 */
public final class ModernSelectionHook extends XposedModule {
  private SharedPreferences prefs;

  @Override
  public void onPackageReady(@NonNull PackageReadyParam param) {
    String pkg = param.getPackageName();
    if ("android".equals(pkg) || SelectionBar.OUR_PACKAGE.equals(pkg)) return;
    Class<?> toolbar;
    try {
      toolbar = Class.forName("com.android.internal.widget.floatingtoolbar.FloatingToolbar", false,
          param.getClassLoader());
    } catch (ClassNotFoundException e) {
      return;
    }
    if (!SelectionBar.claimProcess()) return;
    try {
      prefs = getRemotePreferences(LsposedPrefs.GROUP);
    } catch (RuntimeException e) {
      log(Log.WARN, "Phevere", "Remote preferences unavailable; using defaults", e);
    }
    SelectionBar.Settings settings = new SelectionBar.Settings() {
      @Override public boolean instant() { return prefs != null && prefs.getBoolean(LsposedPrefs.KEY_INSTANT, false); }
      @Override public int slot() { return prefs == null ? -1 : prefs.getInt(LsposedPrefs.KEY_SLOT, -1); }
    };
    try {
      Method doShow = toolbar.getDeclaredMethod("doShow");
      hook(doShow).intercept(chain -> {
        try {
          if (SelectionBar.onDoShow(chain.getThisObject(), settings)) return null;
        } catch (Throwable t) {
          log(Log.WARN, "Phevere", "selection bar", t);
        }
        return chain.proceed();
      });
    } catch (NoSuchMethodException e) {
      log(Log.WARN, "Phevere", "FloatingToolbar.doShow not found", e);
    }
  }
}
