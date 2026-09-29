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
        .setMessage("Hooks the system text-selection toolbar (FloatingToolbar) in the apps you scope: "
            + "puts Phevere in the slot you choose, adds it where an app hides other apps' actions, "
            + "and can press it for you on selection.\n\n"
            + "1. In LSPosed → Modules, enable Phevere.\n\n"
            + "2. Select the apps where you select text.\n\n"
            + "3. Force-stop and reopen those apps.")
        .setPositiveButton("Got it", (dialog, which) -> prefs.edit().putBoolean("shown_v2", true).apply())
        .show();
  }
}
