package com.phevere.app;

import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.util.AttributeSet;
import android.util.DisplayMetrics;
import android.view.ActionMode;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.PopupWindow;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;

/**
 * WebView for the overlay pop-up. An overlay window has no Activity, so Android cannot show
 * its floating selection bar, and Chromium clears a selection that gets no bar.
 *
 * Switch off ("Pop up as soon as text is selected"): draw the selection bar ourselves with
 * the page's own menu (Copy, Select all, Share, every app's selection action — Phevere
 * looks up in place). Switch on: keep the selection silently; the page looks it up.
 */
public class SelectionWebView extends WebView {
  public SelectionWebView(Context context, AttributeSet attrs) {
    super(context, attrs);
  }

  @Override
  public ActionMode startActionMode(ActionMode.Callback callback, int type) {
    if (CapturePrefs.autoPopup(getContext())) return new QuietMode(this);
    // Activities (main app, bottom sheet) show the system bar with a Phevere item of our own;
    // the overlay pop-up has no Activity and draws the bar itself.
    if (getContext() instanceof android.app.Activity) {
      return super.startActionMode(new PhevereItemCallback(callback), type);
    }
    BarMode mode = new BarMode(this, callback);
    return mode.start() ? mode : new QuietMode(this);
  }

  private static final int PHEVERE_ITEM = 0x50686576;

  /**
   * The system selection bar, plus Phevere. Chromium may already list Phevere as a
   * process-text app; either way the press is handled here, so the page decides: the pop-up
   * and Scan look up in place, anywhere else opens the pop-up beside the selection.
   */
  private final class PhevereItemCallback extends ActionMode.Callback2 {
    private final ActionMode.Callback base;

    PhevereItemCallback(ActionMode.Callback base) { this.base = base; }

    @Override public boolean onCreateActionMode(ActionMode mode, Menu menu) {
      boolean ok = base.onCreateActionMode(mode, menu);
      if (ok) ensureItem(menu);
      return ok;
    }

    @Override public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
      boolean changed = base.onPrepareActionMode(mode, menu);
      return ensureItem(menu) || changed;
    }

    @Override public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
      if (item.getItemId() != PHEVERE_ITEM && !isOwnProcessText(item)) return base.onActionItemClicked(mode, item);
      // Read the selection before finishing the mode: finishing clears it.
      evaluateJavascript("JSON.stringify(window.__pvSelectionAction ? window.__pvSelectionAction() : null)", value -> {
        mode.finish();
        try {
          String json = new JSONArray("[" + value + "]").optString(0, "null");
          org.json.JSONObject out = "null".equals(json) ? null : new org.json.JSONObject(json);
          if (out == null || out.optBoolean("inPlace")) return;
          String text = out.optString("text").trim();
          if (!text.isEmpty()) ProcessTextActivity.openPopup(getContext(), text, screenRect(out.optJSONObject("rect")));
        } catch (Exception ignored) {
        }
      });
      return true;
    }

    @Override public void onDestroyActionMode(ActionMode mode) { base.onDestroyActionMode(mode); }

    @Override public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
      if (base instanceof ActionMode.Callback2) ((ActionMode.Callback2) base).onGetContentRect(mode, view, outRect);
      else super.onGetContentRect(mode, view, outRect);
    }

    /** @return true when the item was added now. */
    private boolean ensureItem(Menu menu) {
      if (menu.findItem(PHEVERE_ITEM) != null) return false;
      for (int i = 0; i < menu.size(); i++) {
        if (isOwnProcessText(menu.getItem(i))) {
          menu.getItem(i).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
          return false;
        }
      }
      menu.add(Menu.NONE, PHEVERE_ITEM, 0, getContext().getString(R.string.app_name))
          .setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
      return true;
    }

    private boolean isOwnProcessText(MenuItem item) {
      Intent intent = item.getIntent();
      return intent != null && Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())
          && intent.getComponent() != null
          && getContext().getPackageName().equals(intent.getComponent().getPackageName());
    }
  }

  /** Page rectangle (CSS px) to screen pixels, for placing the pop-up beside the selection. */
  private Rect screenRect(org.json.JSONObject box) {
    if (box == null) return null;
    float d = getResources().getDisplayMetrics().density;
    int[] loc = new int[2];
    getLocationOnScreen(loc);
    return new Rect(
        loc[0] + Math.round((float) box.optDouble("left") * d), loc[1] + Math.round((float) box.optDouble("top") * d),
        loc[0] + Math.round((float) box.optDouble("right") * d), loc[1] + Math.round((float) box.optDouble("bottom") * d));
  }

  @Override
  public ActionMode startActionMode(ActionMode.Callback callback) {
    return startActionMode(callback, ActionMode.TYPE_FLOATING);
  }

  private static class QuietMode extends ActionMode {
    final View anchor;
    final Menu menu;
    private CharSequence title;
    private CharSequence subtitle;
    private View custom;

    QuietMode(View anchor) {
      this.anchor = anchor;
      this.menu = new PopupMenu(anchor.getContext(), anchor).getMenu();
      setType(TYPE_FLOATING);
    }

    @Override public void setTitle(CharSequence value) { title = value; }
    @Override public void setTitle(int resId) { title = anchor.getContext().getText(resId); }
    @Override public void setSubtitle(CharSequence value) { subtitle = value; }
    @Override public void setSubtitle(int resId) { subtitle = anchor.getContext().getText(resId); }
    @Override public void setCustomView(View view) { custom = view; }
    @Override public void invalidate() {}
    @Override public void finish() {}
    @Override public Menu getMenu() { return menu; }
    @Override public CharSequence getTitle() { return title; }
    @Override public CharSequence getSubtitle() { return subtitle; }
    @Override public View getCustomView() { return custom; }
    @Override public MenuInflater getMenuInflater() { return new MenuInflater(anchor.getContext()); }
  }

  /** Stand-in for the system floating selection bar, fed by the page's ActionMode callback. */
  private static final class BarMode extends QuietMode {
    private final WebView web;
    private final ActionMode.Callback callback;
    private final PopupWindow window;
    private final LinearLayout row;
    private final Runnable reveal;
    private boolean finished;

    BarMode(WebView web, ActionMode.Callback callback) {
      super(web);
      this.web = web;
      this.callback = callback;
      Context ctx = web.getContext();
      float d = ctx.getResources().getDisplayMetrics().density;
      row = new LinearLayout(ctx);
      row.setOrientation(LinearLayout.HORIZONTAL);
      row.setPadding(Math.round(4 * d), 0, Math.round(4 * d), 0);
      HorizontalScrollView scroll = new HorizontalScrollView(ctx);
      scroll.setHorizontalScrollBarEnabled(false);
      scroll.addView(row);
      GradientDrawable bg = new GradientDrawable();
      bg.setColor(ContextCompat.getColor(ctx, R.color.paper));
      bg.setCornerRadius(20 * d);
      bg.setStroke(Math.max(1, Math.round(d)), ContextCompat.getColor(ctx, R.color.outline));
      scroll.setBackground(bg);
      scroll.setClipToOutline(true);
      window = new PopupWindow(scroll, ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      window.setElevation(8 * d);
      window.setClippingEnabled(true);
      reveal = () -> { if (!finished) window.getContentView().setVisibility(View.VISIBLE); };
    }

    boolean start() {
      if (!callback.onCreateActionMode(this, menu)) return false;
      callback.onPrepareActionMode(this, menu);
      rebuild();
      reposition();
      return true;
    }

    private void rebuild() {
      row.removeAllViews();
      Context ctx = web.getContext();
      float d = ctx.getResources().getDisplayMetrics().density;
      for (int i = 0; i < menu.size(); i++) {
        MenuItem item = menu.getItem(i);
        if (!item.isVisible() || item.getTitle() == null) continue;
        TextView button = new TextView(ctx);
        button.setText(item.getTitle());
        button.setTextColor(ContextCompat.getColor(ctx, R.color.ink));
        button.setTextSize(14);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(Math.round(44 * d));
        button.setPadding(Math.round(12 * d), 0, Math.round(12 * d), 0);
        button.setEnabled(item.isEnabled());
        button.setOnClickListener(v -> click(item));
        // Phevere first, as the LSPosed module does in other apps.
        if (isOurs(item)) row.addView(button, 0);
        else row.addView(button);
      }
    }

    private void reposition() {
      if (finished) return;
      Rect content = new Rect();
      if (callback instanceof ActionMode.Callback2) {
        ((ActionMode.Callback2) callback).onGetContentRect(this, web, content);
      }
      int[] loc = new int[2];
      web.getLocationOnScreen(loc);
      content.offset(loc[0], loc[1]);
      View bar = window.getContentView();
      bar.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
      DisplayMetrics dm = web.getResources().getDisplayMetrics();
      float d = dm.density;
      int w = Math.min(bar.getMeasuredWidth(), dm.widthPixels - Math.round(16 * d));
      int h = bar.getMeasuredHeight();
      window.setWidth(w);
      int x = Math.max(Math.round(8 * d), Math.min(dm.widthPixels - w - Math.round(8 * d), content.centerX() - w / 2));
      int y = content.top - h - Math.round(8 * d);
      // No room above: go below, past the selection handles.
      if (y < loc[1]) y = content.bottom + Math.round(28 * d);
      if (window.isShowing()) window.update(x, y, w, h);
      else window.showAtLocation(web, Gravity.NO_GRAVITY, x, y);
    }

    private boolean isOurs(MenuItem item) {
      Intent intent = item.getIntent();
      return intent != null && Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())
          && intent.getComponent() != null
          && web.getContext().getPackageName().equals(intent.getComponent().getPackageName());
    }

    private void click(MenuItem item) {
      Intent intent = item.getIntent();
      if (intent == null || !Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
        callback.onActionItemClicked(this, item);
        return;
      }
      // Selection actions need an Activity to launch from; send the text ourselves.
      boolean ours = isOurs(item);
      web.evaluateJavascript("String(window.getSelection() || '')", value -> {
        String text = "";
        try { text = new JSONArray("[" + value + "]").getString(0).trim(); } catch (Exception ignored) {}
        if (text.isEmpty()) return;
        if (ours) {
          web.evaluateJavascript("window.__pvLookupText && window.__pvLookupText(" + org.json.JSONObject.quote(text) + ")", null);
        } else {
          Intent launch = new Intent(intent)
              .putExtra(Intent.EXTRA_PROCESS_TEXT, text)
              .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          try { web.getContext().startActivity(launch); } catch (RuntimeException ignored) {}
        }
        web.clearFocus();
        finish();
      });
    }

    @Override public void invalidate() {
      if (finished) return;
      callback.onPrepareActionMode(this, menu);
      rebuild();
      reposition();
    }

    @Override public void invalidateContentRect() { reposition(); }

    @Override public void hide(long duration) {
      if (finished) return;
      window.getContentView().removeCallbacks(reveal);
      window.getContentView().setVisibility(View.INVISIBLE);
      long wait = duration == DEFAULT_HIDE_DURATION ? 2000 : Math.max(0, duration);
      window.getContentView().postDelayed(reveal, wait);
    }

    @Override public void finish() {
      if (finished) return;
      finished = true;
      window.getContentView().removeCallbacks(reveal);
      window.dismiss();
      callback.onDestroyActionMode(this);
    }
  }
}
