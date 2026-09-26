package com.phevere.app;

import android.content.Context;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.view.MotionEvent;
import android.view.View;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** Keep the permission-free activity and overlay popup the same size. */
final class PopupLayout {
  static void size(WindowManager.LayoutParams lp, Context context, boolean compact) {
    DisplayMetrics dm = context.getResources().getDisplayMetrics();
    boolean floating = CapturePrefs.floatingStrip(context);
    lp.width = floating ? Math.min(dm.widthPixels - Math.round(24 * dm.density), Math.round(560 * dm.density))
        : WindowManager.LayoutParams.MATCH_PARENT;
    lp.height = compact ? Math.round(76 * dm.density) : Math.round(dm.heightPixels * (floating ? 0.60f : 0.50f));
    lp.gravity = floating ? Gravity.CENTER : Gravity.BOTTOM;
    lp.x = 0;
    lp.y = 0;
  }

  static void apply(Window window, Context context, boolean compact) {
    WindowManager.LayoutParams lp = window.getAttributes();
    size(lp, context, compact);
    window.setAttributes(lp);
  }

  static void draggable(View handle, Context context, Supplier<WindowManager.LayoutParams> params,
      Consumer<WindowManager.LayoutParams> update) {
    final float[] start = new float[4];
    handle.setOnTouchListener((view, event) -> {
      if (!CapturePrefs.floatingStrip(context)) return false;
      WindowManager.LayoutParams lp = params.get();
      if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
        start[0] = event.getRawX(); start[1] = event.getRawY();
        start[2] = lp.x; start[3] = lp.y;
        return true;
      }
      if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        int maxX = Math.max(0, (dm.widthPixels - lp.width) / 2);
        int maxY = Math.max(0, (dm.heightPixels - lp.height) / 2 - Math.round(32 * dm.density));
        lp.x = Math.max(-maxX, Math.min(maxX, Math.round(start[2] + event.getRawX() - start[0])));
        lp.y = Math.max(-maxY, Math.min(maxY, Math.round(start[3] + event.getRawY() - start[1])));
        update.accept(lp);
        return true;
      }
      if (event.getActionMasked() == MotionEvent.ACTION_UP) view.performClick();
      return true;
    });
  }
}
