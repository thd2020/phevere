package com.phevere.app;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.util.List;

/**
 * Instant pop-up without root: when the system selection bar appears in another app, press
 * its Phevere button (opening the overflow first if Phevere sits there). The app then sends
 * the selected text to Phevere as usual. Works wherever the bar shows Phevere, including
 * Chrome; the bar itself stays (only the LSPosed module can hide or reorder it).
 */
public class SelectionAccessibilityService extends AccessibilityService {
  private static final String ITEM_TEXT_ID = "android:id/floating_toolbar_menu_item_text";
  private static final long COOLDOWN_MS = 1500;
  private long pressedAt;
  private long overflowAt;

  @Override
  public void onAccessibilityEvent(AccessibilityEvent event) {
    CharSequence pkg = event.getPackageName();
    if (pkg == null || getPackageName().contentEquals(pkg)) return;
    if (event.getEventType() == AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED) {
      rememberSelection(event);
      return;
    }
    // Rooted with the LSPosed module: the module presses Phevere without a bar; stay out of it.
    if (!CapturePrefs.autoPopup(this) || CapturePrefs.moduleActive(this)) return;
    long now = SystemClock.uptimeMillis();
    if (now - pressedAt < COOLDOWN_MS) return;
    // The bar is its own small window; content changes matter only right after opening overflow.
    if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED && now - overflowAt > 1000) return;
    pressPhevere();
  }

  private void pressPhevere() {
    String label = getString(R.string.app_name);
    for (AccessibilityWindowInfo window : getWindows()) {
      AccessibilityNodeInfo root = window.getRoot();
      if (root == null) continue;
      List<AccessibilityNodeInfo> items = root.findAccessibilityNodeInfosByViewId(ITEM_TEXT_ID);
      if (items.isEmpty()) continue;  // not a selection bar
      for (AccessibilityNodeInfo item : items) {
        if (item.getText() == null || !label.contentEquals(item.getText())) continue;
        AccessibilityNodeInfo button = clickable(item);
        if (button == null) continue;
        Rect bar = new Rect();
        root.getBoundsInScreen(bar);
        // The bar floats just above (or below) the selection; place the pop-up by it.
        if (SelectionAnchor.recent() == null && !bar.isEmpty()) {
          SelectionAnchor.remember(new Rect(bar.left, bar.bottom, bar.right, bar.bottom + bar.height()));
        }
        pressedAt = SystemClock.uptimeMillis();
        button.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        return;
      }
      // Phevere not on the main row: open the overflow (the bar's only clickable
      // control without a menu-item label), then look again when its content changes.
      AccessibilityNodeInfo overflow = findOverflow(root);
      if (overflow != null && SystemClock.uptimeMillis() - overflowAt > 1000) {
        overflowAt = SystemClock.uptimeMillis();
        overflow.performAction(AccessibilityNodeInfo.ACTION_CLICK);
      }
      return;
    }
  }

  private static AccessibilityNodeInfo clickable(AccessibilityNodeInfo node) {
    for (AccessibilityNodeInfo n = node; n != null; n = n.getParent()) {
      if (n.isClickable()) return n;
    }
    return null;
  }

  private static AccessibilityNodeInfo findOverflow(AccessibilityNodeInfo node) {
    if (node == null) return null;
    if (node.isClickable() && node.getClassName() != null
        && node.getClassName().toString().endsWith("ImageButton")) return node;
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo hit = findOverflow(node.getChild(i));
      if (hit != null) return hit;
    }
    return null;
  }

  /** Where the selected characters are, so the pop-up can open beside them. */
  private void rememberSelection(AccessibilityEvent event) {
    int from = Math.min(event.getFromIndex(), event.getToIndex());
    int to = Math.max(event.getFromIndex(), event.getToIndex());
    if (from < 0 || from == to || event.isPassword()) return;
    Rect r = bounds(event.getSource(), from, to);
    if (r != null) SelectionAnchor.remember(r);
  }

  /** Screen bounds of the selected characters; the whole view when the app gives none. */
  private static Rect bounds(AccessibilityNodeInfo node, int from, int to) {
    if (node == null) return null;
    Rect whole = new Rect();
    node.getBoundsInScreen(whole);
    if (android.os.Build.VERSION.SDK_INT < 26) return whole.isEmpty() ? null : whole;
    try {
      android.os.Bundle args = new android.os.Bundle();
      args.putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_START_INDEX, from);
      args.putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_LENGTH, Math.min(to - from, 100));
      if (node.refreshWithExtraData(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY, args)) {
        android.os.Parcelable[] boxes = node.getExtras()
            .getParcelableArray(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY);
        android.graphics.RectF union = null;
        if (boxes != null) for (android.os.Parcelable box : boxes) {
          if (!(box instanceof android.graphics.RectF)) continue;
          if (union == null) union = new android.graphics.RectF((android.graphics.RectF) box);
          else union.union((android.graphics.RectF) box);
        }
        if (union != null && !union.isEmpty()) {
          Rect r = new Rect();
          union.round(r);
          return r;
        }
      }
    } catch (RuntimeException ignored) {
      // Older or custom views: fall back to the view's bounds.
    }
    return whole.isEmpty() ? null : whole;
  }

  @Override
  public void onInterrupt() {}
}
