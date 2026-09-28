package com.phevere.app;

import android.app.Activity;
import android.content.Context;
import androidx.appcompat.app.AlertDialog;

final class SelectionSetup {
  static void show(Activity activity, boolean once) {
    if (activity == null || activity.isFinishing()) return;
    android.content.SharedPreferences prefs = activity.getSharedPreferences("selection_setup", Context.MODE_PRIVATE);
    if (once && prefs.getBoolean("shown_v2", false)) return;
    new AlertDialog.Builder(activity)
        .setTitle("LSPosed module")
        .setMessage("1. In LSPosed → Modules, enable Phevere.\n\n"
            + "2. Select the apps where you select text.\n\n"
            + "3. Force-stop and reopen those apps.\n\n"
            + "An app still ignores Phevere? LSPosed → Logs shows its selection bar's items.")
        .setPositiveButton("Got it", (dialog, which) -> prefs.edit().putBoolean("shown_v2", true).apply())
        .show();
  }
}
