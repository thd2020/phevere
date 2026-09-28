package com.phevere.app;

import android.content.Intent;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.Menu;
import android.view.MenuItem;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Comparator;
import java.util.List;

/**
 * Selection-bar behaviour injected into apps scoped in LSPosed. Shared by the modern
 * (libxposed) and legacy (XposedBridge) entries, so both behave identically; only where
 * the settings come from differs. Runs inside the other app: no Phevere resources here.
 *
 * Intercepts FloatingToolbar.doShow(), which in AOSP / crDroid 16 is:
 *   items = getVisibleAndEnabledMenuItems(mMenu); items.sort(mMenuItemComparator);
 *   mPopup.show(items, mMenuItemClickListener, mContentRect);
 */
final class SelectionBar {
  static final String OUR_PACKAGE = "com.phevere.app";
  /** Marks lookups that came through the module, so Phevere can show it is active. */
  static final String EXTRA_VIA_HOOK = "com.phevere.app.VIA_HOOK";
  /** Set once per process: whichever entry (modern or legacy) hooks first wins. */
  static final String INSTALLED_PROPERTY = "phevere.selectionbar.installed";

  /** Settings shared from the Phevere app (remote preferences or the legacy file). */
  interface Settings {
    boolean instant();
    /** -1: leave the system's placement; otherwise Phevere's slot on the bar's main row. */
    int slot();
  }

  private SelectionBar() {}

  static boolean claimProcess() {
    synchronized (System.class) {
      if (System.getProperty(INSTALLED_PROPERTY) != null) return false;
      System.setProperty(INSTALLED_PROPERTY, "1");
      return true;
    }
  }

  /** @return true when the bar was handled here and the original doShow must not run. */
  @SuppressWarnings("unchecked")
  static boolean onDoShow(Object toolbar, Settings settings) throws Exception {
    Class<?> type = toolbar.getClass();
    Menu menu = (Menu) field(type, "mMenu").get(toolbar);
    Method visible = type.getDeclaredMethod("getVisibleAndEnabledMenuItems", Menu.class);
    visible.setAccessible(true);
    List<MenuItem> items = (List<MenuItem>) visible.invoke(null, menu);
    MenuItem ours = null;
    for (MenuItem item : items) if (isOurs(item)) ours = item;
    if (ours == null) return false;
    Intent intent = ours.getIntent();
    if (intent != null) {
      intent.putExtra(EXTRA_VIA_HOOK, true);
      // The pop-up opens beside the selection whether the bar is pressed now or by the user.
      Rect content = (Rect) field(type, "mContentRect").get(toolbar);
      if (content != null && !content.isEmpty()) {
        intent.putExtra(SelectionAnchor.EXTRA, new int[] {content.left, content.top, content.right, content.bottom});
      }
    }
    MenuItem.OnMenuItemClickListener click =
        (MenuItem.OnMenuItemClickListener) field(type, "mMenuItemClickListener").get(toolbar);

    if (settings.instant()) {
      // Instant: never draw the bar; press Phevere as the user would.
      final MenuItem item = ours;
      new Handler(Looper.getMainLooper()).post(() -> click.onMenuItemClick(item));
      return true;
    }

    int slot = settings.slot();
    if (slot < 0) return false;  // system default placement
    items.sort((Comparator<MenuItem>) field(type, "mMenuItemComparator").get(toolbar));
    items.remove(ours);
    // The main row ends at the first overflow-only item; keep Phevere inside it.
    int mainRow = 0;
    while (mainRow < items.size() && !requiresOverflow(items.get(mainRow))) mainRow++;
    promote(ours);
    items.add(Math.min(slot, mainRow), ours);
    Object popup = field(type, "mPopup").get(toolbar);
    Method show = null;
    for (Method m : popup.getClass().getMethods()) {
      if (m.getName().equals("show") && m.getParameterCount() == 3) show = m;
    }
    if (show == null) return false;
    show.setAccessible(true);
    show.invoke(popup, items, click, field(type, "mContentRect").get(toolbar));
    return true;
  }

  static boolean isOurs(MenuItem item) {
    Intent intent = item.getIntent();
    return intent != null && Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())
        && intent.getComponent() != null
        && OUR_PACKAGE.equals(intent.getComponent().getPackageName());
  }

  private static boolean requiresOverflow(MenuItem item) {
    try {
      Method m = item.getClass().getMethod("requiresOverflow");
      return Boolean.TRUE.equals(m.invoke(item));
    } catch (ReflectiveOperationException e) {
      return false;
    }
  }

  private static void promote(MenuItem item) {
    try {
      Method m = item.getClass().getMethod("requiresActionButton");
      if (Boolean.TRUE.equals(m.invoke(item))) return;
    } catch (ReflectiveOperationException ignored) {
    }
    item.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
  }

  private static Field field(Class<?> type, String name) throws NoSuchFieldException {
    for (Class<?> c = type; c != null; c = c.getSuperclass()) {
      try {
        Field f = c.getDeclaredField(name);
        f.setAccessible(true);
        return f;
      } catch (NoSuchFieldException ignored) {
      }
    }
    throw new NoSuchFieldException(name);
  }
}
