package com.phevere.app;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class OverlayService extends Service implements NativeBridge.Target, BridgeRouter.Host {
  private final ExecutorService io = Executors.newCachedThreadPool();
  private final BridgeRouter router = new BridgeRouter(this);
  private WindowManager wm;
  private View root;
  private WebView web;
  private String pendingText;
  private String pendingOrigin = "process-text";
  private String pendingJsId;
  private String pendingSaveText;
  private boolean pageReady;

  public static void show(Context ctx, String text) {
    Intent i = new Intent(ctx, OverlayService.class);
    i.putExtra(CapturePrefs.EXTRA_QUERY, text);
    try {
      if (Build.VERSION.SDK_INT >= 26) ContextCompat.startForegroundService(ctx, i);
      else ctx.startService(i);
    } catch (Exception e) {
      ctx.startService(i);
    }
  }

  public static void hide(Context ctx) {
    ctx.stopService(new Intent(ctx, OverlayService.class));
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    try {
      Notify.startForeground(this);
    } catch (Exception ignored) {
    }
    String text = intent != null ? intent.getStringExtra(CapturePrefs.EXTRA_QUERY) : null;
    if (text != null && !text.isEmpty()) {
      pendingText = text;
      pendingOrigin = "process-text";
    }
    if (root == null) attach();
    else if (pageReady && pendingText != null) injectIncoming();
    return START_NOT_STICKY;
  }

  private void attach() {
    wm = (WindowManager) getSystemService(WINDOW_SERVICE);
    root = LayoutInflater.from(this).inflate(R.layout.overlay_strip, null);
    web = root.findViewById(R.id.webview);
    DisplayMetrics dm = getResources().getDisplayMetrics();
    WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        (int) (dm.heightPixels * 0.62f),
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
    );
    lp.gravity = Gravity.BOTTOM;
    lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
    WebViews.bind(web, WebViews.assets(this), this, true, () -> {
      pageReady = true;
      if (pendingText != null) injectIncoming();
    });
    try {
      wm.addView(root, lp);
    } catch (Exception e) {
      Intent i = new Intent(this, StripActivity.class);
      if (pendingText != null) i.putExtra(CapturePrefs.EXTRA_QUERY, pendingText);
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      startActivity(i);
      stopSelf();
    }
  }

  private void injectIncoming() {
    if (web == null || pendingText == null) return;
    String js = "window.__pvIncoming && window.__pvIncoming("
        + JSONObject.quote(pendingText) + "," + JSONObject.quote(pendingOrigin) + ")";
    web.evaluateJavascript(js, null);
    pendingText = null;
  }

  @Override
  public void handleJs(String method, String id, String paramsJson) {
    router.handle(method, id, paramsJson);
  }

  @Override
  public Context context() {
    return getApplicationContext();
  }

  @Nullable
  @Override
  public android.app.Activity activity() {
    return null;
  }

  @Override
  public WebView web() {
    return web;
  }

  @Override
  public ExecutorService io() {
    return io;
  }

  @Override
  public void runUi(Runnable r) {
    if (web != null) web.post(r);
    else r.run();
  }

  @Override
  public String takePendingText() {
    String t = pendingText;
    pendingText = null;
    return t;
  }

  @Override
  public String takePendingOrigin() {
    String o = pendingOrigin;
    pendingOrigin = null;
    return o;
  }

  @Override
  public void setPendingJsId(String id) {
    pendingJsId = id;
  }

  @Override
  public String pendingJsId() {
    return pendingJsId;
  }

  @Override
  public void setPendingSaveText(String text) {
    pendingSaveText = text;
  }

  @Override
  public String pendingSaveText() {
    return pendingSaveText;
  }

  @Override
  public void chooseOcr() {
    router.fail(pendingJsId, "Camera OCR needs the full app");
  }

  @Override
  public void launchPickFile() {
    router.fail(pendingJsId, "Import needs the full app");
  }

  @Override
  public void launchSaveFile(String name) {
    router.fail(pendingJsId, "Export needs the full app");
  }

  @Override
  public void closeStrip() {
    stopSelf();
  }

  @Override
  public void expandToFullApp(String query) {
    Intent i = new Intent(this, MainActivity.class);
    if (query != null && !query.isEmpty()) i.putExtra(CapturePrefs.EXTRA_QUERY, query);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    startActivity(i);
    stopSelf();
  }

  @Override
  public void requestOverlayPermission() {
    Intent i = new Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + getPackageName())
    );
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    startActivity(i);
  }

  @Override
  public void requestNotifications() {
    Notify.openSettings(this);
  }

  @Override
  public void openNotificationSettings() {
    Notify.openSettings(this);
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public void onDestroy() {
    if (wm != null && root != null) {
      try {
        wm.removeView(root);
      } catch (Exception ignored) {
      }
    }
    io.shutdownNow();
    super.onDestroy();
  }
}
