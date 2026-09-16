package com.phevere.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

final class Notify {
  static final String CHANNEL_STRIP = "strip";
  static final int ID_STRIP = 7;

  private Notify() {}

  static void ensureChannels(Context ctx) {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel ch = new NotificationChannel(
        CHANNEL_STRIP,
        "Lookup strip",
        NotificationManager.IMPORTANCE_LOW
    );
    ch.setDescription("Shown while the lookup strip floats over other apps");
    ch.setShowBadge(false);
    nm.createNotificationChannel(ch);
  }

  static boolean granted(Context ctx) {
    if (Build.VERSION.SDK_INT < 33) return true;
    return ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
        == PackageManager.PERMISSION_GRANTED;
  }

  static void startForeground(Service svc) {
    ensureChannels(svc);
    Intent open = new Intent(svc, MainActivity.class);
    open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pi = PendingIntent.getActivity(svc, 0, open, flags);
    Notification n = new NotificationCompat.Builder(svc, CHANNEL_STRIP)
        .setSmallIcon(R.drawable.ic_stat_phevere)
        .setContentTitle("Lookup strip")
        .setContentText("Phevere is showing over other apps")
        .setOngoing(true)
        .setSilent(true)
        .setColor(ContextCompat.getColor(svc, R.color.ember))
        .setContentIntent(pi)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .build();
    if (Build.VERSION.SDK_INT >= 34) {
      svc.startForeground(ID_STRIP, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
    } else {
      svc.startForeground(ID_STRIP, n);
    }
  }

  static void openSettings(Context ctx) {
    Intent i;
    if (Build.VERSION.SDK_INT >= 26) {
      i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
    } else {
      i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName()));
    }
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    ctx.startActivity(i);
  }
}
