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
        .setMessage("Adds Phevere to the text selection menu.\n\n"
            + "1. In LSPosed, open Modules and turn on Phevere.\n"
            + "2. Select the apps to use it in.\n"
            + "3. Force-stop and reopen those apps.")
        .setPositiveButton("OK", (dialog, which) -> prefs.edit().putBoolean("shown_v2", true).apply())
        .show();
  }
}
