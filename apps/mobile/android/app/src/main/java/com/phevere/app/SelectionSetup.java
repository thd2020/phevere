package com.phevere.app;

import android.app.Activity;
import android.content.Context;
import androidx.appcompat.app.AlertDialog;

final class SelectionSetup {
  static void show(Activity activity, boolean once) {
    if (activity == null || activity.isFinishing()) return;
    android.content.SharedPreferences prefs = activity.getSharedPreferences("selection_setup", Context.MODE_PRIVATE);
    if (once && prefs.getBoolean("shown_v1", false)) return;
    new AlertDialog.Builder(activity)
        .setTitle("Put Phevere first")
        .setMessage("Root + LSPosed:\n\n1. Open LSPosed → Modules → Phevere and enable it.\n\n"
            + "2. Select the apps where you read/select text (for example your browser). System Framework is not needed.\n\n"
            + "3. Force-stop and reopen those apps, or reboot. Select a word: Phevere appears first.\n\n"
            + "Applies to the Android selection toolbar. Apps that draw their own menus may not support it.")
        .setPositiveButton("Got it", (dialog, which) -> prefs.edit().putBoolean("shown_v1", true).apply())
        .show();
  }
}
