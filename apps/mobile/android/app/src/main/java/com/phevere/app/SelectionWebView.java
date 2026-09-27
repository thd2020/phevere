package com.phevere.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.View;
import android.webkit.WebView;
import android.widget.PopupMenu;

/**
 * WebView for the overlay pop-up. An overlay window has no Activity, so the system cannot
 * show the floating Copy/Share toolbar; Chromium then clears the selection it just made.
 * Returning a silent ActionMode keeps the selection, and the page looks it up itself.
 */
public class SelectionWebView extends WebView {
  public SelectionWebView(Context context, AttributeSet attrs) {
    super(context, attrs);
  }

  @Override
  public ActionMode startActionMode(ActionMode.Callback callback, int type) {
    return new QuietMode(this);
  }

  @Override
  public ActionMode startActionMode(ActionMode.Callback callback) {
    return new QuietMode(this);
  }

  private static final class QuietMode extends ActionMode {
    private final View anchor;
    private final Menu menu;
    private CharSequence title;
    private CharSequence subtitle;
    private View custom;

    QuietMode(View anchor) {
      this.anchor = anchor;
      this.menu = new PopupMenu(anchor.getContext(), anchor).getMenu();
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
}
