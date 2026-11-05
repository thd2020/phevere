package com.phevere.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Updates from GitHub releases (apps/mobile/src/app-update.ts decides when): download the APK
 * into cache/updates, check its size, SHA-512 and package name, then hand it to the system
 * installer. Installing over the app keeps its data, so the notebook stays.
 */
final class AppUpdate {
  /** Only release assets of this repository are downloaded. */
  private static final String RELEASE_PREFIX = "https://github.com/thd2020/phevere/releases/download/";
  private static final AtomicBoolean DOWNLOADING = new AtomicBoolean(false);
  private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .followRedirects(true)
      .followSslRedirects(true)
      .build();

  interface Progress {
    void report(long done, long total);
  }

  private AppUpdate() {}

  static File dir(Context ctx) {
    return new File(ctx.getCacheDir(), "updates");
  }

  private static boolean safeName(String name) {
    return name != null && name.matches("[A-Za-z0-9._-]+\\.apk") && !name.startsWith(".");
  }

  /** Version, whether this is a debug build (which never updates), and installs-allowed. */
  static JSONObject info(Context ctx) throws Exception {
    PackageManager pm = ctx.getPackageManager();
    PackageInfo pi = pm.getPackageInfo(ctx.getPackageName(), 0);
    long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
    boolean debuggable = (ctx.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    removeInstalled(ctx, code);
    JSONObject out = new JSONObject();
    out.put("versionName", pi.versionName == null ? "" : pi.versionName);
    out.put("versionCode", code);
    out.put("debuggable", debuggable);
    out.put("installsAllowed", installsAllowed(ctx));
    return out;
  }

  static boolean installsAllowed(Context ctx) {
    if (Build.VERSION.SDK_INT < 26) return true;
    return ctx.getPackageManager().canRequestPackageInstalls();
  }

  /** Drops downloaded APKs that are not newer than the installed app (already installed). */
  private static void removeInstalled(Context ctx, long installedCode) {
    if (DOWNLOADING.get()) return;
    File[] files = dir(ctx).listFiles();
    if (files == null) return;
    PackageManager pm = ctx.getPackageManager();
    for (File f : files) {
      PackageInfo archive = f.getName().endsWith(".apk") ? pm.getPackageArchiveInfo(f.getPath(), 0) : null;
      long code = archive == null ? -1 : (Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode);
      if (archive == null || code <= installedCode) {
        //noinspection ResultOfMethodCallIgnored
        f.delete();
      }
    }
  }

  private static String sha512(File file) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-512");
    try (InputStream in = new FileInputStream(file)) {
      byte[] buf = new byte[1 << 16];
      int n;
      while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
    }
    return Base64.encodeToString(md.digest(), Base64.NO_WRAP);
  }

  /**
   * Downloads `url` to cache/updates/`name` unless a verified copy is already there. Other files
   * in that folder are removed. Throws when the size, SHA-512 or package name does not match;
   * the partial or wrong file is deleted.
   */
  static JSONObject download(Context ctx, JSONObject p, Progress progress) throws Exception {
    String url = p.getString("url");
    String name = p.getString("name");
    String expected = p.getString("sha512");
    long size = p.optLong("size", -1);
    if (!url.startsWith(RELEASE_PREFIX)) throw new Exception("Not a Phevere release file");
    if (!safeName(name)) throw new Exception("Bad file name");
    if (!DOWNLOADING.compareAndSet(false, true)) throw new Exception("A download is already running");
    File folder = dir(ctx);
    File target = new File(folder, name);
    File part = new File(folder, name + ".part");
    try {
      //noinspection ResultOfMethodCallIgnored
      folder.mkdirs();
      File[] old = folder.listFiles();
      if (old != null) {
        for (File f : old) {
          if (!f.getName().equals(name)) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
          }
        }
      }
      if (target.isFile() && (size < 0 || target.length() == size) && expected.equals(sha512(target))) {
        return result(ctx, target);
      }
      //noinspection ResultOfMethodCallIgnored
      target.delete();
      Request req = new Request.Builder().url(url).header("User-Agent", "Phevere-Android").build();
      MessageDigest md = MessageDigest.getInstance("SHA-512");
      long done = 0;
      try (Response res = CLIENT.newCall(req).execute()) {
        if (!res.isSuccessful()) throw new Exception("HTTP " + res.code());
        ResponseBody body = res.body();
        if (body == null) throw new Exception("Empty response");
        long total = size > 0 ? size : body.contentLength();
        try (InputStream in = body.byteStream(); OutputStream out = new FileOutputStream(part)) {
          byte[] buf = new byte[1 << 16];
          int n;
          int lastPct = -1;
          while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            md.update(buf, 0, n);
            done += n;
            if (size > 0 && done > size) throw new Exception("File is larger than expected");
            int pct = total > 0 ? (int) (done * 100 / total) : -1;
            if (progress != null && pct != lastPct) {
              lastPct = pct;
              progress.report(done, total);
            }
          }
        }
      }
      if (size >= 0 && done != size) throw new Exception("Size mismatch");
      String actual = Base64.encodeToString(md.digest(), Base64.NO_WRAP);
      if (!expected.equals(actual)) throw new Exception("Checksum mismatch");
      PackageInfo archive = ctx.getPackageManager().getPackageArchiveInfo(part.getPath(), 0);
      if (archive == null || !ctx.getPackageName().equals(archive.packageName)) throw new Exception("Not a Phevere package");
      if (!part.renameTo(target)) throw new Exception("Could not save the update");
      return result(ctx, target);
    } catch (Exception e) {
      //noinspection ResultOfMethodCallIgnored
      part.delete();
      throw e;
    } finally {
      DOWNLOADING.set(false);
    }
  }

  private static JSONObject result(Context ctx, File file) throws Exception {
    PackageInfo archive = ctx.getPackageManager().getPackageArchiveInfo(file.getPath(), 0);
    JSONObject out = new JSONObject();
    out.put("ok", true);
    out.put("name", file.getName());
    out.put("versionName", archive != null && archive.versionName != null ? archive.versionName : "");
    return out;
  }

  /**
   * Shows the system install prompt for a downloaded APK. When this app may not install apps
   * yet, opens that permission page instead and answers needsPermission.
   */
  static JSONObject install(Context ctx, String name, Starter starter) throws Exception {
    if (!safeName(name)) throw new Exception("Bad file name");
    File file = new File(dir(ctx), name);
    if (!file.isFile()) throw new Exception("Update not downloaded");
    JSONObject out = new JSONObject();
    if (!installsAllowed(ctx)) {
      Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
      starter.start(allow);
      out.put("needsPermission", true);
      return out;
    }
    Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
    Intent view = new Intent(Intent.ACTION_VIEW);
    view.setDataAndType(uri, "application/vnd.android.package-archive");
    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    starter.start(view);
    out.put("started", true);
    return out;
  }

  interface Starter {
    void start(Intent intent);
  }
}
