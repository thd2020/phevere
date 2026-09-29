package com.phevere.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Resources;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.TextView;
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
  /** ProcessTextActivity's label (@string/app_name); the hook cannot read Phevere's resources. */
  static final String APP_LABEL = "Phevere";
  /** Marks lookups that came through the module, so Phevere can show it is active. */
  static final String EXTRA_VIA_HOOK = "com.phevere.app.VIA_HOOK";
  /** Set once per process: whichever entry (modern or legacy) hooks first wins. */
  static final String INSTALLED_PROPERTY = "phevere.selectionbar.installed";

  /** Settings shared from the Phevere app (remote preferences or the legacy file). */
  interface Settings {
    boolean instant();
    /** -1: leave the system's placement; otherwise Phevere's slot on the bar's main row. */
    int slot();
    /** Write to the LSPosed log, so a bar that ignores Phevere can be diagnosed per app. */
    void log(String message);
  }

  private static boolean reportedMissing;

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
    if (ours == null) {
      // Apps such as X build their own menu and drop every app's text action; add Phevere back.
      ours = inject(toolbar, type, menu);
      if (ours != null) items = (List<MenuItem>) visible.invoke(null, menu);
    }
    if (ours == null) {
      if (!reportedMissing) {
        reportedMissing = true;
        StringBuilder titles = new StringBuilder();
        for (MenuItem item : items) titles.append(" [").append(item.getTitle()).append(']');
        settings.log("selection bar without Phevere:" + titles);
      }
      return false;
    }
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

  /** Menu id of the Phevere item the module adds; "Phev" in ASCII, clear of app ids. */
  private static final int INJECTED_ID = 0x50686576;

  /**
   * Add Phevere to a text-selection bar that lacks it. Only bars with Copy count as text
   * selection. The item runs its own click listener, which MenuItem invokes before the app's
   * callback, so the app never sees an item it does not know.
   */
  private static MenuItem inject(Object toolbar, Class<?> type, Menu menu) throws Exception {
    MenuItem copy = findCopy(menu);
    if (copy == null) return null;
    Window window = (Window) field(type, "mWindow").get(toolbar);
    MenuItem item = menu.add(Menu.NONE, INJECTED_ID, copy.getOrder(), APP_LABEL);
    item.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
    item.setOnMenuItemClickListener(clicked -> {
      Rect anchor = null;
      try {
        anchor = new Rect((Rect) field(type, "mContentRect").get(toolbar));
      } catch (ReflectiveOperationException ignored) {
      }
      launchWithSelection(window, menu, copy, anchor);
      return true;
    });
    return item;
  }

  private static MenuItem findCopy(Menu menu) {
    MenuItem byId = menu.findItem(android.R.id.copy);
    if (byId != null) return byId;
    String label = Resources.getSystem().getString(android.R.string.copy);
    for (int i = 0; i < menu.size(); i++) {
      MenuItem item = menu.getItem(i);
      if (item.getTitle() != null && label.contentEquals(item.getTitle().toString().trim())) return item;
    }
    return null;
  }

  /**
   * Read the selection from the selected TextView; custom views (X's posts) expose it only
   * through Copy, so fall back to the clipboard and put the previous clip back.
   */
  private static void launchWithSelection(Window window, Menu menu, MenuItem copy, Rect anchor) {
    Context ctx = window.getContext();
    String text = selectedText(window.getDecorView());
    if (text != null) {
      openPhevere(ctx, text, anchor);
      return;
    }
    ClipboardManager clipboard = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
    if (clipboard == null) return;
    ClipData before = clipboard.getPrimaryClip();
    menu.performIdentifierAction(copy.getItemId(), 0);
    new Handler(Looper.getMainLooper()).postDelayed(() -> {
      ClipData clip = clipboard.getPrimaryClip();
      CharSequence copied = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).coerceToText(ctx) : null;
      try {
        if (before != null) clipboard.setPrimaryClip(before);
        else if (Build.VERSION.SDK_INT >= 28) clipboard.clearPrimaryClip();
      } catch (RuntimeException ignored) {
      }
      String picked = copied == null ? "" : copied.toString().trim();
      if (!picked.isEmpty()) openPhevere(ctx, picked, anchor);
    }, 150);
  }

  private static String selectedText(View view) {
    if (view instanceof TextView) {
      TextView tv = (TextView) view;
      int start = Math.min(tv.getSelectionStart(), tv.getSelectionEnd());
      int end = Math.max(tv.getSelectionStart(), tv.getSelectionEnd());
      if (start >= 0 && end > start && end <= tv.getText().length()) {
        String t = tv.getText().subSequence(start, end).toString().trim();
        if (!t.isEmpty()) return t;
      }
    }
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        String t = selectedText(group.getChildAt(i));
        if (t != null) return t;
      }
    }
    return null;
  }

  private static void openPhevere(Context ctx, String text, Rect anchor) {
    Intent intent = new Intent(Intent.ACTION_PROCESS_TEXT)
        .setClassName(OUR_PACKAGE, OUR_PACKAGE + ".ProcessTextActivity")
        .setType("text/plain")
        .putExtra(Intent.EXTRA_PROCESS_TEXT, text)
        .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
        .putExtra(EXTRA_VIA_HOOK, true)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    if (anchor != null && !anchor.isEmpty()) {
      intent.putExtra(SelectionAnchor.EXTRA, new int[] {anchor.left, anchor.top, anchor.right, anchor.bottom});
    }
    try {
      ctx.startActivity(intent);
    } catch (RuntimeException ignored) {
    }
  }

  static boolean isOurs(MenuItem item) {
    Intent intent = item.getIntent();
    if (intent != null) {
      if (!Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) return false;
      String pkg = intent.getComponent() != null ? intent.getComponent().getPackageName() : intent.getPackage();
      return OUR_PACKAGE.equals(pkg);
    }
    // Compose text menus add process-text entries without an intent, and the item inject()
    // adds has none either; only the label identifies them.
    CharSequence title = item.getTitle();
    return title != null && APP_LABEL.contentEquals(title.toString().trim());
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
