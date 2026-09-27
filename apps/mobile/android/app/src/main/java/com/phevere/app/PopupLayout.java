package com.phevere.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.view.MotionEvent;
import android.view.View;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** Keep the permission-free activity and overlay popup the same size; the user can resize both. */
final class PopupLayout {
  private static final int LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8;
  private static final int MIN_W_DP = 260, MIN_H_DP = 220;

  private static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences("popup_size", Context.MODE_PRIVATE);
  }

  static void size(WindowManager.LayoutParams lp, Context context) {
    DisplayMetrics dm = context.getResources().getDisplayMetrics();
    boolean floating = CapturePrefs.floatingStrip(context);
    SharedPreferences saved = prefs(context);
    int maxW = dm.widthPixels - Math.round(24 * dm.density);
    int width = Math.min(maxW, Math.round(560 * dm.density));
    int height = Math.round(dm.heightPixels * (floating ? 0.60f : 0.50f));
    if (floating) {
      width = clamp(Math.round(saved.getFloat("w_dp", width / dm.density) * dm.density), MIN_W_DP * dm.density, maxW);
      height = clamp(Math.round(saved.getFloat("h_dp", height / dm.density) * dm.density), MIN_H_DP * dm.density, dm.heightPixels * 0.9f);
    } else {
      height = clamp(Math.round(saved.getFloat("sheet_h_dp", height / dm.density) * dm.density), MIN_H_DP * dm.density, dm.heightPixels * 0.9f);
    }
    lp.width = floating ? width : WindowManager.LayoutParams.MATCH_PARENT;
    lp.height = height;
    lp.gravity = floating ? Gravity.CENTER : Gravity.BOTTOM;
    lp.x = 0;
    lp.y = 0;
  }

  static void apply(Window window, Context context) {
    WindowManager.LayoutParams lp = window.getAttributes();
    size(lp, context);
    window.setAttributes(lp);
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
      final float[] start = new float[4];
      edge.setOnTouchListener((view, event) -> resize(event, which, context, params, update, start));
    }
  }

  private static boolean resize(MotionEvent event, int edge, Context context,
      Supplier<WindowManager.LayoutParams> params, Consumer<WindowManager.LayoutParams> update, float[] start) {
    WindowManager.LayoutParams lp = params.get();
    DisplayMetrics dm = context.getResources().getDisplayMetrics();
    switch (event.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        start[0] = event.getRawX(); start[1] = event.getRawY();
        start[2] = lp.width; start[3] = lp.height;
        return true;
      case MotionEvent.ACTION_MOVE: {
        float dx = event.getRawX() - start[0], dy = event.getRawY() - start[1];
        int oldW = lp.width, oldH = lp.height;
        if ((edge & (LEFT | RIGHT)) != 0) {
          float w = start[2] + ((edge & RIGHT) != 0 ? dx : -dx);
          lp.width = clamp(Math.round(w), MIN_W_DP * dm.density, dm.widthPixels - 8 * dm.density);
          // Gravity is centred: shift by half the change so the opposite edge stays put.
          lp.x += ((edge & RIGHT) != 0 ? 1 : -1) * (lp.width - oldW) / 2;
        }
        if ((edge & (BOTTOM | TOP)) != 0) {
          float h = start[3] + ((edge & BOTTOM) != 0 ? dy : -dy);
          lp.height = clamp(Math.round(h), MIN_H_DP * dm.density, dm.heightPixels * 0.9f);
          if ((edge & BOTTOM) != 0) lp.y += (lp.height - oldH) / 2;
        }
        update.accept(lp);
        return true;
      }
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL: {
        SharedPreferences.Editor edit = prefs(context).edit();
        if (CapturePrefs.floatingStrip(context)) {
          edit.putFloat("w_dp", lp.width / dm.density).putFloat("h_dp", lp.height / dm.density);
        } else {
          edit.putFloat("sheet_h_dp", lp.height / dm.density);
        }
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
