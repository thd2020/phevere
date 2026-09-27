package com.phevere.app;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.List;

/**
 * No-root fallback for "pop up on selection": listens for text-selection events and opens
 * the Phevere pop-up once the selection stops changing. Android cannot hide the system
 * selection bar from here, and Chrome does not report selections in page text.
 */
public class SelectionAccessibilityService extends AccessibilityService {
  private static final long SETTLE_MS = 700;
  private final Handler main = new Handler(Looper.getMainLooper());
  private String pending;
  private android.graphics.Rect pendingAnchor;
  private final Runnable fire = () -> {
    if (pending != null) ProcessTextActivity.openPopup(this, pending, pendingAnchor);
    pending = null;
  };

  @Override
  public void onAccessibilityEvent(AccessibilityEvent event) {
    if (event.getEventType() != AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED) return;
    if (getPackageName().contentEquals(nonNull(event.getPackageName()))) return;
    main.removeCallbacks(fire);
    pending = null;
    if (event.isPassword()) return;
    int from = Math.min(event.getFromIndex(), event.getToIndex());
    int to = Math.max(event.getFromIndex(), event.getToIndex());
    List<CharSequence> texts = event.getText();
    if (from < 0 || from == to || texts.isEmpty() || texts.get(0) == null) return;
    String all = texts.get(0).toString();
    if (to > all.length()) return;
    String picked = all.substring(from, to).trim();
    if (picked.isEmpty() || picked.length() > 200) return;
    AccessibilityNodeInfo source = event.getSource();
    // Selecting inside a text box is usually editing, not reading.
    if (source != null && source.isEditable()) return;
    pendingAnchor = bounds(source, from, to);
    // Also serves the selection-menu path: a lookup opened within seconds lands here.
    SelectionAnchor.remember(pendingAnchor);
    if (!CapturePrefs.autoPopup(this)) return;
    pending = picked;
    main.postDelayed(fire, SETTLE_MS);
  }

  /** Screen bounds of the selected characters; the whole view when the app gives none. */
  private static android.graphics.Rect bounds(AccessibilityNodeInfo node, int from, int to) {
    if (node == null) return null;
    android.graphics.Rect whole = new android.graphics.Rect();
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
          android.graphics.Rect r = new android.graphics.Rect();
          union.round(r);
          return r;
        }
      }
    } catch (RuntimeException ignored) {
      // Older or custom views: fall back to the view's bounds.
    }
    return whole.isEmpty() ? null : whole;
  }

  private static CharSequence nonNull(CharSequence value) {
    return value == null ? "" : value;
  }

  @Override
  public void onInterrupt() {
    main.removeCallbacks(fire);
  }
}
