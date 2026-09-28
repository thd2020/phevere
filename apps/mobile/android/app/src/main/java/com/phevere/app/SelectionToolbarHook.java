package com.phevere.app;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XSharedPreferences;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * Legacy LSPosed entry (assets/xposed_init) for frameworks without the modern API.
 * Settings come from Phevere's world-readable preferences file (xposedsharedprefs);
 * the behaviour itself is SelectionBar, shared with the modern entry.
 */
public final class SelectionToolbarHook implements IXposedHookLoadPackage {
  private static XSharedPreferences prefs;

  @Override
  public void handleLoadPackage(XC_LoadPackage.LoadPackageParam load) {
    if ("android".equals(load.packageName) || SelectionBar.OUR_PACKAGE.equals(load.packageName)) return;
    Class<?> toolbar = XposedHelpers.findClassIfExists(
        "com.android.internal.widget.floatingtoolbar.FloatingToolbar", load.classLoader);
    if (toolbar == null || !SelectionBar.claimProcess()) return;
    SelectionBar.Settings settings = new SelectionBar.Settings() {
      @Override public boolean instant() { return read().getBoolean(LsposedPrefs.KEY_INSTANT, false); }
      @Override public int slot() { return read().getInt(LsposedPrefs.KEY_SLOT, -1); }
      @Override public void log(String message) { XposedBridge.log("Phevere " + load.packageName + ": " + message); }
    };
    XposedBridge.hookAllMethods(toolbar, "doShow", new XC_MethodHook() {
      @Override protected void beforeHookedMethod(MethodHookParam param) {
        try {
          if (SelectionBar.onDoShow(param.thisObject, settings)) param.setResult(null);
        } catch (Throwable t) {
          XposedBridge.log("Phevere selection bar: " + t);
        }
      }
    });
  }

  private static synchronized XSharedPreferences read() {
    if (prefs == null) prefs = new XSharedPreferences(SelectionBar.OUR_PACKAGE, LsposedPrefs.LEGACY_FILE);
    else if (prefs.hasFileChanged()) prefs.reload();
    return prefs;
  }
}
