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
  /** Marks a saveFile body as base64 bytes rather than text. */
  static final String SAVE_B64 = "\u0000b64:";

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
    /**
     * Account sign-in: answer `id` with the callback URL when the browser returns to the app. Only
     * the full app signs in; the pop-up (OverlayService) keeps these defaults.
     */
    default void setPendingAuthJsId(String id) {
      throw new IllegalStateException("Sign in from the Phevere app");
    }
    /** A sign-in callback that arrived while no page was waiting (the app had been restarted). */
    default String takePendingAuthUrl() {
      return null;
    }
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
            // This is the JS-ready handshake, serialized with incoming Android intents.
            host.runUi(() -> {
              try {
                JSONObject out = new JSONObject();
                String text = host.takePendingText();
                String origin = host.takePendingOrigin();
                out.put("text", text == null ? JSONObject.NULL : text);
                out.put("origin", origin == null ? JSONObject.NULL : origin);
                resolve(id, out);
              } catch (Exception e) { fail(id, e.getMessage()); }
            });
            break;
          }
          case "takeSourceHint": {
            // Where the latest selection lookup came from (SourceHint); null when unknown.
            JSONObject hint = SourceHint.take();
            resolve(id, hint == null ? new JSONObject().put("text", JSONObject.NULL) : hint);
            break;
          }
          case "openUrl":
            host.runUi(() -> openUrl(p.optString("url")));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "openAuth":
            // Resolved by MainActivity when com.phevere.app:/oauth/callback comes back.
            host.setPendingAuthJsId(id);
            host.runUi(() -> openUrl(p.optString("url")));
            break;
          case "takeAuthCallback": {
            String url = host.takePendingAuthUrl();
            resolve(id, new JSONObject().put("url", url == null ? JSONObject.NULL : url));
            break;
          }
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
            host.setPendingSaveText(p.has("b64") ? SAVE_B64 + p.optString("b64") : p.optString("text"));
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
            out.put("autoPopup", CapturePrefs.autoPopup(host.context()));
            out.put("accessibilityOn", CapturePrefs.accessibilityOn(host.context()));
            out.put("moduleActive", CapturePrefs.moduleActive(host.context()));
            out.put("moduleFramework", LsposedPrefs.frameworkName());
            out.put("barSlot", CapturePrefs.barSlot(host.context()));
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
          case "speechVoices":
            resolve(id, SpeechModels.status(host.context()));
            break;
          case "setSpeechVoice":
            SpeechModels.choose(host.context(), p.optString("id"));
            resolve(id, SpeechModels.status(host.context()));
            break;
          case "cancelSpeechDownload":
            SpeechModels.cancel();
            resolve(id, SpeechModels.status(host.context()));
            break;
          case "speak": {
            String sid = id;
            String text = p.optString("text");
            String lang = p.optString("lang", "en-US");
            float rate = (float) p.optDouble("rate", 1);
            boolean phonemes = p.optBoolean("phonemes", false);
            String kokoro = p.optString("kokoro", "").trim();
            Speak.get(host.context()).setVolume((float) p.optDouble("volume", 1));
            // An IPA chip with a neural voice: Kokoro reads the chip's own phonemes, as on the
            // desktop, so a US and a UK chip sound different (eSpeak reads them if it fails).
            if (phonemes && !kokoro.isEmpty() && SpeechModels.useNeural(host.context())) {
              final String espeak = text;
              final int speaker = p.optInt("speaker", 0);
              host.runUi(() -> Speak.get(host.context()).speakIpa(kokoro, speaker, espeak, lang, rate, error -> {
                if (error != null) { fail(sid, error); return; }
                try {
                  resolve(sid, new JSONObject().put("ok", true));
                } catch (Exception ignored) {
                }
              }));
              break;
            }
            final String spokenText = text;
            final boolean spokenPhonemes = phonemes;
            Speak.get(host.context()).setVolume((float) p.optDouble("volume", 1));
            host.runUi(() -> Speak.get(host.context()).speak(spokenText, lang, rate, spokenPhonemes, error -> {
              if (error != null) { fail(sid, error); return; }
              try {
                resolve(sid, new JSONObject().put("ok", true));
              } catch (Exception ignored) {
              }
            }));
            break;
          }
          case "prefetchAudio": {
            org.json.JSONArray list = p.optJSONArray("urls");
            java.util.List<String> urls = new java.util.ArrayList<>();
            for (int i = 0; list != null && i < list.length(); i++) urls.add(list.optString(i));
            Speak.get(host.context()).prefetch(urls);
            resolve(id, new JSONObject().put("ok", true));
            break;
          }
          case "clipCached": {
            resolve(id, new JSONObject().put("cached", Speak.get(host.context()).hasClip(p.optString("url"))));
            break;
          }
          case "playUrl": {
            String sid = id;
            String url = p.optString("url");
            float rate = (float) p.optDouble("rate", 1);
            Speak.get(host.context()).setVolume((float) p.optDouble("volume", 1));
            host.runUi(() -> Speak.get(host.context()).playUrl(url, rate, error -> {
              if (error != null) { fail(sid, error); return; }
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
          case "setBarSlot":
            CapturePrefs.setBarSlot(host.context(), p.optInt("slot", -1));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "setAutoPopup":
            CapturePrefs.setAutoPopup(host.context(), p.optBoolean("enabled", false));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "openAccessibilitySettings":
            host.runUi(() -> {
              android.content.Intent i = new android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
              i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
              host.context().startActivity(i);
            });
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "openPopup": {
            String text = p.optString("text").trim();
            JSONObject box = p.optJSONObject("rect");
            if (!text.isEmpty()) host.runUi(() -> ProcessTextActivity.openPopup(host.context(), text, screenRect(box)));
            resolve(id, new JSONObject().put("ok", true));
            break;
          }
          case "expandStrip":
            host.runUi(() -> host.expandToFullApp(p.optString("q")));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "selectionSetup":
            host.runUi(() -> SelectionSetup.show(host.activity(), false));
            resolve(id, new JSONObject().put("ok", true));
            break;
          case "updateInfo":
            resolve(id, AppUpdate.info(host.context()));
            break;
          case "updateFetch":
            resolve(id, AppUpdate.fetch(p));
            break;
          case "updateDownload":
            // Progress goes to window.__pvUpdateProgress(done, total) while the call runs.
            resolve(id, AppUpdate.download(host.context(), p, (done, total) -> {
              String js = "window.__pvUpdateProgress && window.__pvUpdateProgress(" + done + "," + total + ")";
              host.runUi(() -> {
                WebView web = host.web();
                if (web != null) web.evaluateJavascript(js, null);
              });
            }));
            break;
          case "updateInstall":
            resolve(id, AppUpdate.install(host.context(), p.optString("name"), this::startOnUi));
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

  /**
   * Starts an activity on the UI thread and waits for it, so a screen the phone lacks comes back
   * to the caller as an error instead of crashing the app. Called from the io pool only.
   */
  private void startOnUi(Intent intent) throws Exception {
    java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
    Exception[] failed = new Exception[1];
    host.runUi(() -> {
      try {
        startExternal(intent);
      } catch (Exception e) {
        failed[0] = e;
      } finally {
        done.countDown();
      }
    });
    if (!done.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new Exception("The installer did not open. Try again.");
    if (failed[0] != null) throw failed[0];
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

  /** Page rectangle (CSS px) → screen pixels, for placing the pop-up beside a selection. */
  private android.graphics.Rect screenRect(JSONObject box) {
    android.webkit.WebView web = host.web();
    if (box == null || web == null) return null;
    float d = web.getResources().getDisplayMetrics().density;
    int[] loc = new int[2];
    web.getLocationOnScreen(loc);
    return new android.graphics.Rect(
        loc[0] + Math.round((float) box.optDouble("left") * d), loc[1] + Math.round((float) box.optDouble("top") * d),
        loc[0] + Math.round((float) box.optDouble("right") * d), loc[1] + Math.round((float) box.optDouble("bottom") * d));
  }
}
