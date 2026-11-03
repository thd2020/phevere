package com.phevere.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Selection-tray Phevere: popup over the other app, never the full dictionary. */
public class ProcessTextActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    CharSequence extra = getIntent() != null ? getIntent().getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT) : null;
    if (extra == null && getIntent() != null) extra = getIntent().getCharSequenceExtra(Intent.EXTRA_TEXT);
    String text = extra == null ? "" : extra.toString().trim();
    if (getIntent() != null && getIntent().getBooleanExtra(SelectionBar.EXTRA_VIA_HOOK, false)) {
      CapturePrefs.markModuleSeen(this);
    } else if (getIntent() != null && Intent.ACTION_PROCESS_TEXT.equals(getIntent().getAction())) {
      // A selection bar the module did not reach: offer to add the app that drew it.
      LsposedPrefs.offerScope(this, launchingPackage());
    }
    if (!text.isEmpty()) {
      SourceHint.set(text, source());
      // The LSPosed module passes where the selection is; otherwise use what is known.
      openPopup(this, text, SelectionAnchor.from(getIntent()));
      overridePendingTransition(0, 0);
    }
    finish();
  }

  /**
   * Where the selection was: the launching app's name always, and the page title or URL the
   * LSPosed module read in that app. Null for a lookup from inside Phevere.
   */
  private org.json.JSONObject source() {
    android.content.Intent in = getIntent();
    String pkg = launchingPackage();
    if (pkg == null || getPackageName().equals(pkg)) return null;
    String app = in != null ? in.getStringExtra(SelectionBar.EXTRA_SOURCE_APP) : null;
    if (app == null || app.trim().isEmpty()) {
      try {
        // An app that starts one of our activities is visible to us without a <queries> entry.
        android.content.pm.PackageManager pm = getPackageManager();
        app = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
      } catch (Exception e) {
        app = pkg;
      }
    }
    try {
      org.json.JSONObject out = new org.json.JSONObject().put("app", app.trim());
      String title = in != null ? in.getStringExtra(SelectionBar.EXTRA_SOURCE_TITLE) : null;
      String url = in != null ? in.getStringExtra(SelectionBar.EXTRA_SOURCE_URL) : null;
      if (title != null && !title.trim().isEmpty() && !title.trim().equals(app.trim())) out.put("title", title.trim());
      if (url != null && (url.startsWith("https://") || url.startsWith("http://"))) out.put("url", url);
      return out;
    } catch (Exception e) {
      return null;
    }
  }

  /** The app that started this lookup, from the referrer Android records for the launch. */
  private String launchingPackage() {
    android.net.Uri referrer = getReferrer();
    if (referrer == null || !"android-app".equals(referrer.getScheme())) return null;
    return referrer.getHost();
  }

  /** The one pop-up path: selection tray in other apps and selections inside Phevere. */
  static void openPopup(android.content.Context ctx, String text) {
    openPopup(ctx, text, null);
  }

  /** anchor: the selection in screen pixels when known; else a recent accessibility position. */
  static void openPopup(android.content.Context ctx, String text, android.graphics.Rect anchor) {
    if (anchor == null) anchor = SelectionAnchor.recent();
    if (CapturePrefs.floatingStrip(ctx) && CapturePrefs.canDrawOverlays(ctx)) {
      OverlayService.show(ctx, text, anchor);
      return;
    }
    Intent i = new Intent(ctx, StripActivity.class);
    i.putExtra(CapturePrefs.EXTRA_QUERY, text);
    SelectionAnchor.put(i, anchor);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
    ctx.startActivity(i);
  }
}
