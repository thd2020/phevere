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
        .setMessage("Root + LSPosed:\n\n1. Open LSPosed → Modules → Phevere and enable it.\n\n"
            + "2. Select the apps where you read and select text (for example your browser). System Framework is not needed.\n\n"
            + "3. Force-stop and reopen those apps, or reboot.\n\n"
            + "Then, in Phevere → Settings → Capture: \"Pop up as soon as text is selected\" opens the lookup "
            + "without showing the selection bar, and \"Phevere's place\" sets where Phevere sits on the bar. "
            + "Accessibility is not needed with the module. Apps that draw their own selection menus are not covered.")
        .setPositiveButton("Got it", (dialog, which) -> prefs.edit().putBoolean("shown_v2", true).apply())
        .show();
  }
}
