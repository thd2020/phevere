package com.phevere.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.annotation.RequiresApi;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Updates from GitHub Releases. apps/mobile/src/app-update.ts decides what and when; this class
 * reads GitHub, downloads the APK into cache/updates, checks its SHA-256, package name and signing
 * key, and hands it to the system installer through the FileProvider. Installing over the app keeps
 * its data, so the notebook stays.
 */
final class AppUpdate {
  private static final String REPO_API = "https://api.github.com/repos/thd2020/phevere/";
  private static final String REPO_PAGE = "https://github.com/thd2020/phevere/";
  /** Only release assets of this repository are downloaded. */
  private static final String RELEASE_PREFIX = "https://github.com/thd2020/phevere/releases/download/";
  private static final int DOWNLOAD_ATTEMPTS = 4;
  private static final AtomicBoolean DOWNLOADING = new AtomicBoolean(false);
  private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .followRedirects(true)
      .followSslRedirects(true)
      .build();
  /** For releases/latest, whose redirect names the latest version. */
  private static final OkHttpClient NO_REDIRECT = CLIENT.newBuilder()
      .followRedirects(false)
      .followSslRedirects(false)
      .build();

  interface Progress {
    void report(long done, long total);
  }

  interface Starter {
    /** Throws when no app on the phone can open the intent. */
    void start(Intent intent) throws Exception;
  }

  private AppUpdate() {}

  static File dir(Context ctx) {
    return new File(ctx.getCacheDir(), "updates");
  }

  private static boolean safeName(String name) {
    return name != null && name.matches("Phevere-[0-9]+\\.[0-9]+\\.[0-9]+-android\\.apk");
  }

  private static long versionCode(PackageInfo pi) {
    return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
  }

  /** Installed version, whether this is a debug build, installs allowed, and a metered network. */
  static JSONObject info(Context ctx) throws Exception {
    PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
    boolean debuggable = (ctx.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    removeInstalled(ctx, versionCode(pi));
    JSONObject out = new JSONObject();
    out.put("versionName", pi.versionName == null ? "" : pi.versionName);
    out.put("versionCode", versionCode(pi));
    out.put("debuggable", debuggable);
    out.put("installsAllowed", installsAllowed(ctx));
    out.put("metered", metered(ctx));
    return out;
  }

  static boolean installsAllowed(Context ctx) {
    if (Build.VERSION.SDK_INT < 26) return true;
    return ctx.getPackageManager().canRequestPackageInstalls();
  }

  /** True on mobile data or a hotspot the user marked metered; unknown counts as metered. */
  static boolean metered(Context ctx) {
    ConnectivityManager cm = ctx.getSystemService(ConnectivityManager.class);
    return cm == null || cm.isActiveNetworkMetered();
  }

  /** Drops downloaded APKs that are not newer than the installed app, such as the one just installed. */
  private static void removeInstalled(Context ctx, long installedCode) {
    if (DOWNLOADING.get()) return;
    File[] files = dir(ctx).listFiles();
    if (files == null) return;
    PackageManager pm = ctx.getPackageManager();
    for (File f : files) {
      if (!f.getName().endsWith(".apk")) continue;
      PackageInfo archive = pm.getPackageArchiveInfo(f.getPath(), 0);
      if (archive == null || versionCode(archive) <= installedCode) {
        //noinspection ResultOfMethodCallIgnored
        f.delete();
      }
    }
  }

  /**
   * GET (or HEAD) a GitHub URL of this repository. Returns the status, body, ETag and, when
   * `redirect` is false, the Location of a redirect.
   */
  static JSONObject fetch(JSONObject p) throws Exception {
    String url = p.getString("url");
    if (!url.startsWith(REPO_API) && !url.startsWith(REPO_PAGE)) throw new Exception("Not a Phevere release URL");
    Request.Builder req = new Request.Builder().url(url).header("User-Agent", "Phevere-Android");
    if (url.startsWith(REPO_API)) req.header("Accept", "application/vnd.github+json");
    String etag = p.optString("etag", "");
    if (!etag.isEmpty()) req.header("If-None-Match", etag);
    if (p.optBoolean("head", false)) req.head();
    OkHttpClient client = p.optBoolean("redirect", true) ? CLIENT : NO_REDIRECT;
    try (Response res = client.newCall(req.build()).execute()) {
      JSONObject out = new JSONObject();
      out.put("status", res.code());
      out.put("etag", res.header("ETag", ""));
      out.put("location", res.header("Location", ""));
      ResponseBody body = res.body();
      out.put("text", body == null || p.optBoolean("head", false) ? "" : body.string());
      return out;
    }
  }

  private static String sha256(File file) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-256");
    try (InputStream in = new FileInputStream(file)) {
      byte[] buf = new byte[1 << 16];
      int n;
      while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
    }
    StringBuilder hex = new StringBuilder();
    for (byte b : md.digest()) hex.append(String.format("%02x", b));
    return hex.toString();
  }

  /**
   * Downloads `url` to cache/updates/`name` unless a verified copy is already there, resuming an
   * interrupted download. Other files in that folder are removed. Throws when the SHA-256, package
   * name or signing key does not match, and deletes the file.
   */
  static JSONObject download(Context ctx, JSONObject p, Progress progress) throws Exception {
    String url = p.getString("url");
    String name = p.getString("name");
    String expected = p.optString("sha256", "").toLowerCase();
    long size = p.optLong("size", 0);
    if (!url.startsWith(RELEASE_PREFIX)) throw new Exception("Not a Phevere release file");
    if (!safeName(name)) throw new Exception("Not a Phevere APK name");
    if (!expected.matches("[0-9a-f]{64}")) throw new Exception("GitHub lists no checksum for " + name + ", so it was not installed.");
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
          if (!f.getName().equals(name) && !f.getName().equals(part.getName())) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
          }
        }
      }
      if (target.isFile() && expected.equals(sha256(target))) return verified(ctx, target);
      //noinspection ResultOfMethodCallIgnored
      target.delete();
      // Downloads from GitHub often break off on slow or filtered connections. Keep what arrived
      // and resume with a Range request, a few times now and again on the next check.
      for (int attempt = 1; ; attempt++) {
        try {
          fetchInto(part, url, size, progress);
          break;
        } catch (Exception e) {
          if (attempt >= DOWNLOAD_ATTEMPTS) {
            throw new Exception("The download was interrupted. It resumes where it stopped on the next check.");
          }
          Thread.sleep(2000L * attempt);
        }
      }
      if (!expected.equals(sha256(part))) {
        //noinspection ResultOfMethodCallIgnored
        part.delete();
        throw new Exception(name + " did not match GitHub's checksum, so it was deleted.");
      }
      if (!part.renameTo(target)) throw new Exception("Could not save the update");
      return verified(ctx, target);
    } finally {
      DOWNLOADING.set(false);
    }
  }

  /** Appends the rest of `url` to `part`, starting from what is already there. */
  private static void fetchInto(File part, String url, long size, Progress progress) throws Exception {
    long start = part.isFile() ? part.length() : 0;
    if (size > 0 && start >= size) {
      if (start == size) return;
      //noinspection ResultOfMethodCallIgnored
      part.delete();
      start = 0;
    }
    Request.Builder req = new Request.Builder().url(url).header("User-Agent", "Phevere-Android");
    if (start > 0) req.header("Range", "bytes=" + start + "-");
    try (Response res = CLIENT.newCall(req.build()).execute()) {
      if (res.code() != 200 && res.code() != 206) throw new Exception("HTTP " + res.code());
      ResponseBody body = res.body();
      if (body == null) throw new Exception("Empty response");
      // 200 means the server ignored the range: start the file again.
      if (res.code() == 200) start = 0;
      long total = size > 0 ? size : start + Math.max(0, body.contentLength());
      long done = start;
      try (InputStream in = body.byteStream(); OutputStream out = new FileOutputStream(part, start > 0)) {
        byte[] buf = new byte[1 << 16];
        int n;
        int lastPct = -1;
        while ((n = in.read(buf)) > 0) {
          out.write(buf, 0, n);
          done += n;
          int pct = total > 0 ? (int) (done * 100 / total) : -1;
          if (progress != null && pct != lastPct) {
            lastPct = pct;
            progress.report(done, total);
          }
        }
      }
    }
  }

  /** Checks a verified download is Phevere, newer, and signed with this install's key. */
  private static JSONObject verified(Context ctx, File file) throws Exception {
    PackageManager pm = ctx.getPackageManager();
    int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : 0;
    PackageInfo archive = pm.getPackageArchiveInfo(file.getPath(), flags);
    if (archive == null || !ctx.getPackageName().equals(archive.packageName)) {
      //noinspection ResultOfMethodCallIgnored
      file.delete();
      throw new Exception(file.getName() + " is not a Phevere package, so it was deleted.");
    }
    if (!sameSigner(ctx, archive)) {
      //noinspection ResultOfMethodCallIgnored
      file.delete();
      throw new Exception("This update is signed with a different key than the Phevere on this phone, so Android cannot install it over this copy.");
    }
    JSONObject out = new JSONObject();
    out.put("name", file.getName());
    out.put("versionName", archive.versionName == null ? "" : archive.versionName);
    return out;
  }

  /**
   * True when the APK carries a certificate of the installed app. Android refuses any other
   * update, so finding out here gives a plain message instead of the installer's "App not
   * installed". Before Android 9 the archive's signers are not readable and Android decides.
   */
  private static boolean sameSigner(Context ctx, PackageInfo archive) throws Exception {
    if (Build.VERSION.SDK_INT < 28) return true;
    SigningInfo theirs = archive.signingInfo;
    if (theirs == null) return true;
    PackageInfo installed = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
    Set<String> ours = certs(installed.signingInfo);
    Set<String> candidate = certs(theirs);
    if (ours.isEmpty() || candidate.isEmpty()) return true;
    for (Iterator<String> it = candidate.iterator(); it.hasNext(); ) {
      if (ours.contains(it.next())) return true;
    }
    return false;
  }

  @RequiresApi(28)
  private static Set<String> certs(SigningInfo info) throws Exception {
    Set<String> out = new HashSet<>();
    if (info == null) return out;
    Signature[] list = info.hasMultipleSigners() ? info.getApkContentsSigners() : info.getSigningCertificateHistory();
    if (list == null) return out;
    MessageDigest md = MessageDigest.getInstance("SHA-256");
    for (Signature s : list) {
      StringBuilder hex = new StringBuilder();
      for (byte b : md.digest(s.toByteArray())) hex.append(String.format("%02x", b));
      out.add(hex.toString());
    }
    return out;
  }

  /**
   * Shows the system install prompt for a downloaded APK. When Phevere may not install apps yet,
   * opens Install unknown apps for Phevere instead and answers needsPermission.
   */
  static JSONObject install(Context ctx, String name, Starter starter) throws Exception {
    if (!safeName(name)) throw new Exception("Not a Phevere APK name");
    File file = new File(dir(ctx), name);
    if (!file.isFile()) throw new Exception("The update is no longer downloaded. Check again.");
    JSONObject out = new JSONObject();
    if (!installsAllowed(ctx)) {
      Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
      try {
        starter.start(allow);
      } catch (android.content.ActivityNotFoundException e) {
        throw new Exception("Allow Phevere to install apps in Settings, under Apps, Special app access.");
      }
      out.put("needsPermission", true);
      return out;
    }
    Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
    Intent view = new Intent(Intent.ACTION_VIEW);
    view.setDataAndType(uri, "application/vnd.android.package-archive");
    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    try {
      starter.start(view);
    } catch (android.content.ActivityNotFoundException e) {
      throw new Exception("No app on this phone can install the update.");
    }
    out.put("started", true);
    return out;
  }
}
