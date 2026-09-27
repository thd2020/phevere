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
  private final Runnable fire = () -> {
    if (pending != null) ProcessTextActivity.openPopup(this, pending);
    pending = null;
  };

  @Override
  public void onAccessibilityEvent(AccessibilityEvent event) {
    if (event.getEventType() != AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED) return;
    if (!CapturePrefs.autoPopup(this) || getPackageName().contentEquals(nonNull(event.getPackageName()))) return;
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
    pending = picked;
    main.postDelayed(fire, SETTLE_MS);
  }

  private static CharSequence nonNull(CharSequence value) {
    return value == null ? "" : value;
  }

  @Override
  public void onInterrupt() {
    main.removeCallbacks(fire);
  }
}
