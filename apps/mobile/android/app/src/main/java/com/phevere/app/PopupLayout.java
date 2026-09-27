package com.phevere.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Rect;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.MotionEvent;
import android.view.View;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Size and place the pop-up (overlay window or permission-free activity). Floating pop-ups
 * are anchored top-left in screen pixels, sit beside the selected word when its position is
 * known, and can be moved and resized; the bottom sheet only resizes its height.
 */
final class PopupLayout {
  private static final int LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8;
  private static final int MIN_W_DP = 260, MIN_H_DP = 220;
  /** Desktop-like default: a compact card, not half the screen. */
  private static final int DEFAULT_W_DP = 360, DEFAULT_H_DP = 460;
  private static final int GAP_DP = 8, MARGIN_DP = 8;

  private static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences("popup_size_v2", Context.MODE_PRIVATE);
  }

  static void size(WindowManager.LayoutParams lp, Context context) {
    place(lp, context, null);
  }

  /** anchor: the selection in screen pixels, or null when unknown (then centred). */
  static void place(WindowManager.LayoutParams lp, Context context, Rect anchor) {
    DisplayMetrics dm = context.getResources().getDisplayMetrics();
    float d = dm.density;
    boolean floating = CapturePrefs.floatingStrip(context);
    SharedPreferences saved = prefs(context);
    if (!floating) {
      lp.width = WindowManager.LayoutParams.MATCH_PARENT;
      lp.height = clamp(Math.round(saved.getFloat("sheet_h_dp", dm.heightPixels * 0.5f / d) * d),
          MIN_H_DP * d, dm.heightPixels * 0.9f);
      lp.gravity = Gravity.BOTTOM;
      lp.x = 0;
      lp.y = 0;
      return;
    }
    int margin = Math.round(MARGIN_DP * d);
    lp.width = clamp(Math.round(saved.getFloat("w_dp", DEFAULT_W_DP) * d), MIN_W_DP * d, dm.widthPixels - 2 * margin);
    lp.height = clamp(Math.round(saved.getFloat("h_dp", DEFAULT_H_DP) * d), MIN_H_DP * d,
        Math.min(dm.heightPixels * 0.8f, dm.heightPixels - 2 * margin));
    lp.gravity = Gravity.TOP | Gravity.START;
    int gap = Math.round(GAP_DP * d);
    int x = (dm.widthPixels - lp.width) / 2;
    int y = (dm.heightPixels - lp.height) / 2;
    if (anchor != null && !anchor.isEmpty()) {
      x = anchor.centerX() - lp.width / 2;
      // Below the word when it fits, else above it; otherwise the side with more room.
      if (anchor.bottom + gap + lp.height <= dm.heightPixels - margin) y = anchor.bottom + gap;
      else if (anchor.top - gap - lp.height >= margin) y = anchor.top - gap - lp.height;
      else y = anchor.top > dm.heightPixels - anchor.bottom ? margin : dm.heightPixels - margin - lp.height;
    }
    lp.x = clamp(x, margin, dm.widthPixels - margin - lp.width);
    lp.y = clamp(y, margin, dm.heightPixels - margin - lp.height);
  }

  /** Top handle: moves the floating popup; resizes the bottom sheet's height. */
  static void draggable(View handle, Context context, Supplier<WindowManager.LayoutParams> params,
      Consumer<WindowManager.LayoutParams> update) {
    final float[] start = new float[4];
    handle.setOnTouchListener((view, event) -> {
      if (!CapturePrefs.floatingStrip(context)) return resize(event, TOP, context, params, update, start);
      WindowManager.LayoutParams lp = params.get();
      if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
        start[0] = event.getRawX(); start[1] = event.getRawY();
        start[2] = lp.x; start[3] = lp.y;
        return true;
      }
      if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        lp.x = clamp(Math.round(start[2] + event.getRawX() - start[0]), 0, dm.widthPixels - lp.width);
        lp.y = clamp(Math.round(start[3] + event.getRawY() - start[1]), 0, dm.heightPixels - lp.height);
        update.accept(lp);
        return true;
      }
      if (event.getActionMasked() == MotionEvent.ACTION_UP) view.performClick();
      return true;
    });
  }

  /** Left, right and bottom margins resize the floating popup; the sheet only resizes from the top. */
  static void resizable(View root, Context context, Supplier<WindowManager.LayoutParams> params,
      Consumer<WindowManager.LayoutParams> update) {
    boolean floating = CapturePrefs.floatingStrip(context);
    int[] ids = {R.id.edge_left, R.id.edge_right, R.id.edge_bottom};
    int[] edges = {LEFT, RIGHT, BOTTOM};
    for (int i = 0; i < ids.length; i++) {
      View edge = root.findViewById(ids[i]);
      if (edge == null) continue;
      edge.setVisibility(floating ? View.VISIBLE : View.GONE);
      final int which = edges[i];
      final float[] start = new float[5];
      edge.setOnTouchListener((view, event) -> resize(event, which, context, params, update, start));
    }
  }

  private static boolean resize(MotionEvent event, int edge, Context context,
      Supplier<WindowManager.LayoutParams> params, Consumer<WindowManager.LayoutParams> update, float[] start) {
    WindowManager.LayoutParams lp = params.get();
    DisplayMetrics dm = context.getResources().getDisplayMetrics();
    float d = dm.density;
    switch (event.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        start[0] = event.getRawX(); start[1] = event.getRawY();
        start[2] = lp.width; start[3] = lp.height; start[4] = lp.x;
        return true;
      case MotionEvent.ACTION_MOVE: {
        float dx = event.getRawX() - start[0], dy = event.getRawY() - start[1];
        if (edge == RIGHT) {
          lp.width = clamp(Math.round(start[2] + dx), MIN_W_DP * d, dm.widthPixels - lp.x);
        } else if (edge == LEFT) {
          // Keep the right edge fixed: grow leftwards by moving x.
          int right = Math.round(start[4] + start[2]);
          lp.width = clamp(Math.round(start[2] - dx), MIN_W_DP * d, right);
          lp.x = right - lp.width;
        } else if (edge == BOTTOM) {
          lp.height = clamp(Math.round(start[3] + dy), MIN_H_DP * d, dm.heightPixels - lp.y);
        } else {
          // Bottom sheet: drag the top handle up to grow.
          lp.height = clamp(Math.round(start[3] - dy), MIN_H_DP * d, dm.heightPixels * 0.9f);
        }
        update.accept(lp);
        return true;
      }
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL: {
        SharedPreferences.Editor edit = prefs(context).edit();
        if (edge == TOP) edit.putFloat("sheet_h_dp", lp.height / d);
        else edit.putFloat("w_dp", lp.width / d).putFloat("h_dp", lp.height / d);
        edit.apply();
        return true;
      }
      default:
        return true;
    }
  }

  private static int clamp(int value, float min, float max) {
    return Math.round(Math.max(min, Math.min(max, value)));
  }
}
