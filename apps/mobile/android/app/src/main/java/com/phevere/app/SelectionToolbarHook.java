package com.phevere.app;

import android.content.Intent;
import android.view.MenuItem;
import java.util.Comparator;
import java.util.List;
import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/** Optional LSPosed module, active only in apps explicitly selected by the user. */
public final class SelectionToolbarHook implements IXposedHookLoadPackage {
  private static final String INSTALLED = "phevere.selection.comparator";

  @Override
  public void handleLoadPackage(XC_LoadPackage.LoadPackageParam load) {
    // Framework classes execute inside each scoped app; no system_server hook is needed.
    if ("android".equals(load.packageName)) return;
    Class<?> toolbar = XposedHelpers.findClassIfExists(
        "com.android.internal.widget.floatingtoolbar.FloatingToolbar", load.classLoader);
    if (toolbar == null) return;
    XposedBridge.hookAllMethods(toolbar, "getVisibleAndEnabledMenuItems", new XC_MethodHook() {
      @Override protected void afterHookedMethod(MethodHookParam param) {
        if (param.hasThrowable() || !(param.getResult() instanceof List)) return;
        for (Object value : (List<?>) param.getResult()) {
          if (value instanceof MenuItem && isPhevere((MenuItem) value)) {
            MenuItem item = (MenuItem) value;
            if (!Boolean.TRUE.equals(XposedHelpers.callMethod(item, "requiresActionButton"))) {
              item.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
            }
          }
        }
      }
    });
    XposedBridge.hookAllMethods(toolbar, "doShow", new XC_MethodHook() {
      @Override protected void beforeHookedMethod(MethodHookParam param) {
        if (XposedHelpers.getAdditionalInstanceField(param.thisObject, INSTALLED) != null) return;
        @SuppressWarnings("unchecked")
        Comparator<MenuItem> original = (Comparator<MenuItem>)
            XposedHelpers.getObjectField(param.thisObject, "mMenuItemComparator");
        Comparator<MenuItem> first = (left, right) -> {
          boolean a = isPhevere(left), b = isPhevere(right);
          return a == b ? original.compare(left, right) : a ? -1 : 1;
        };
        XposedHelpers.setObjectField(param.thisObject, "mMenuItemComparator", first);
        XposedHelpers.setAdditionalInstanceField(param.thisObject, INSTALLED, true);
      }
    });
  }

  private static boolean isPhevere(MenuItem item) {
    Intent intent = item.getIntent();
    return intent != null && Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())
        && intent.getComponent() != null
        && "com.phevere.app".equals(intent.getComponent().getPackageName());
  }
}
