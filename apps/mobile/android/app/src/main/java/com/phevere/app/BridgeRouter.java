package com.phevere.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;

import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabsIntent;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;

final class BridgeRouter {
  interface Host {
    Context context();
    @Nullable Activity activity();
    WebView web();
    ExecutorService io();
    void runUi(Runnable r);
    String takePendingText();
    String takePendingOrigin();
    void setPendingJsId(String id);
    String pendingJsId();
    void setPendingSaveText(String text);
    String pendingSaveText();
    void chooseOcr();
    void launchPickFile();
    void launchSaveFile(String name);
    void closeStrip();
    void expandToFullApp(String query);
    void requestOverlayPermission();
    void requestNotifications();
    void openNotificationSettings();
  }

  private final Host host;

  BridgeRouter(Host host) {
    this.host = host;
  }

  void handle(String method, String id, String paramsJson) {
    host.io().execute(() -> {
      try {
        JSONObject p = new JSONObject(paramsJson);
        switch (method) {
          case "http":
            resolve(id, NativeIo.http(p));
            break;
          case "readFile":
            resolve(id, NativeIo.readFile(host.context(), p.optString("name")));
            break;
          case "writeFile":
            NativeIo.writeFile(host.context(), p.optString("name"), p.optString("b64"));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "getPendingText": {
            JSONObject out = new JSONObject();
            String text = host.takePendingText();
            String origin = host.takePendingOrigin();
            out.put("text", text == null ? JSONObject.NULL : text);
            out.put("origin", origin == null ? JSONObject.NULL : origin);
            resolve(id, out);
            break;
          }
          case "openUrl":
            host.runUi(() -> openUrl(p.optString("url")));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "openWikipedia":
            host.runUi(() -> {
              Intent i = new Intent(host.context(), WikiActivity.class);
              i.putExtra("url", p.optString("url"));
              startExternal(i);
            });
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "copy": {
            host.runUi(() -> {
              ClipboardManager cm = (ClipboardManager) host.context().getSystemService(Context.CLIPBOARD_SERVICE);
              cm.setPrimaryClip(ClipData.newPlainText("phevere", p.optString("text")));
            });
            resolve(id, new JSONObject().put("ok", true));
            break;
          }
          case "share":
            host.runUi(() -> {
              Intent send = new Intent(Intent.ACTION_SEND);
              send.setType("text/plain");
              send.putExtra(Intent.EXTRA_TEXT, p.optString("text"));
              Intent chooser = Intent.createChooser(send, "Phevere");
              startExternal(chooser);
            });
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "getClipboard": {
            JSONObject out = new JSONObject();
            ClipboardManager cm = (ClipboardManager) host.context().getSystemService(Context.CLIPBOARD_SERVICE);
            CharSequence t = cm.getPrimaryClip() != null && cm.getPrimaryClip().getItemCount() > 0
                ? cm.getPrimaryClip().getItemAt(0).coerceToText(host.context())
                : "";
            out.put("text", t == null ? "" : t.toString());
            resolve(id, out);
            break;
          }
          case "scanOcr":
            host.setPendingJsId(id);
            host.runUi(host::chooseOcr);
            break;
          case "pickFile":
            host.setPendingJsId(id);
            host.runUi(host::launchPickFile);
            break;
          case "saveFile":
            host.setPendingJsId(id);
            host.setPendingSaveText(p.optString("text"));
            host.runUi(() -> host.launchSaveFile(p.optString("name", "phevere.txt")));
            break;
          case "setFloatingStrip":
            CapturePrefs.setFloatingStrip(host.context(), p.optBoolean("enabled"));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "getCapturePrefs": {
            JSONObject out = new JSONObject();
            out.put("floatingStrip", CapturePrefs.floatingStrip(host.context()));
            out.put("canDrawOverlays", CapturePrefs.canDrawOverlays(host.context()));
            out.put("platform", "android");
            out.put("notificationsGranted", Notify.granted(host.context()));
            resolve(id, out);
            break;
          }
          case "requestOverlayPermission":
            host.runUi(host::requestOverlayPermission);
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "requestNotifications":
            host.runUi(host::requestNotifications);
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "openNotificationSettings":
            host.runUi(host::openNotificationSettings);
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "speak": {
            String sid = id;
            String text = p.optString("text");
            String lang = p.optString("lang", "en-US");
            float rate = (float) p.optDouble("rate", 1);
            host.runUi(() -> Speak.get(host.context()).speak(text, lang, rate, () -> {
              try {
                resolve(sid, new JSONObject().put("ok", true));
              } catch (Exception ignored) {
              }
            }));
            break;
          }
          case "playUrl": {
            String sid = id;
            String url = p.optString("url");
            float rate = (float) p.optDouble("rate", 1);
            host.runUi(() -> Speak.get(host.context()).playUrl(url, rate, () -> {
              try {
                resolve(sid, new JSONObject().put("ok", true));
              } catch (Exception ignored) {
              }
            }));
            break;
          }
          case "stopAudio":
            host.runUi(() -> Speak.get(host.context()).stop());
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "notify":
            Notify.post(host.context(), p.optString("title", "Phevere"), p.optString("body"));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "closeStrip":
            host.runUi(host::closeStrip);
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "expandStrip":
            host.runUi(() -> host.expandToFullApp(p.optString("q")));
            resolve(id, new JSONObject().put("ok", true));
            break;
          default:
            fail(id, "Unknown method " + method);
        }
      } catch (Exception e) {
        fail(id, e.getMessage() == null ? "native error" : e.getMessage());
      }
    });
  }

  void resolve(String id, JSONObject data) {
    if (id == null) return;
    String js = "window.__pvResolve && window.__pvResolve(" + JSONObject.quote(id) + "," + JSONObject.quote(data.toString()) + ")";
    host.runUi(() -> {
      WebView web = host.web();
      if (web != null) web.evaluateJavascript(js, null);
    });
  }

  void fail(String id, String msg) {
    try {
      resolve(id, new JSONObject().put("error", msg == null ? "error" : msg));
    } catch (Exception ignored) {
    }
  }

  private void openUrl(String url) {
    try {
      Activity a = host.activity();
      if (a != null) {
        new CustomTabsIntent.Builder().build().launchUrl(a, Uri.parse(url));
        return;
      }
    } catch (Exception ignored) {
    }
    Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
    startExternal(view);
  }

  private void startExternal(Intent intent) {
    Activity a = host.activity();
    if (a != null) {
      a.startActivity(intent);
      return;
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    host.context().startActivity(intent);
  }
}
