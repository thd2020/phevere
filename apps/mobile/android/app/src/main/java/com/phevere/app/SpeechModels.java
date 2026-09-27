package com.phevere.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;

/** Model downloads are opt-in. A missing/unfinished model always leaves mechanical speech usable. */
final class SpeechModels {
  /** Same Kokoro v1.0 voices; the compact one stores weights as int8 (about a third of the size). */
  enum Variant {
    COMPACT("compact", "kokoro-int8-v1-sherpa-1.13.3", "kokoro-int8-multi-lang-v1_0", "model.int8.onnx",
        "4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e", 132, 500),
    FULL("full", "kokoro-v1-sherpa-1.13.3", "kokoro-multi-lang-v1_0", "model.onnx",
        "c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298", 350, 1000);

    final String id, dir, archiveDir, model, sha;
    final int downloadMb, freeMb;

    Variant(String id, String dir, String archiveDir, String model, String sha, int downloadMb, int freeMb) {
      this.id = id; this.dir = dir; this.archiveDir = archiveDir; this.model = model; this.sha = sha;
      this.downloadMb = downloadMb; this.freeMb = freeMb;
    }

    String url() { return "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/" + archiveDir + ".tar.bz2"; }
  }

  private static volatile boolean downloading;
  private static volatile boolean cancelled;
  private static volatile String progress = "";
  private static final Handler main = new Handler(Looper.getMainLooper());

  static File root(Context c, Variant v) { return new File(c.getNoBackupFilesDir(), v.dir); }
  static boolean ready(Context c, Variant v) {
    File root = root(c, v);
    return new File(root, ".ready").isFile() && new File(root, v.model).isFile()
        && new File(root, "voices.bin").isFile();
  }
  static boolean ready(Context c) { return ready(c, Variant.COMPACT) || ready(c, Variant.FULL); }

  /** Selected neural variant, or null for the built-in mechanical voice. */
  static Variant selected(Context c) {
    android.content.SharedPreferences prefs = c.getSharedPreferences("speech", 0);
    String voice = prefs.getString("voice", prefs.getBoolean("neural", false) ? Variant.FULL.id : "mechanical");
    for (Variant v : Variant.values()) if (v.id.equals(voice)) return v;
    return null;
  }
  static boolean useNeural(Context c) {
    Variant v = selected(c);
    return v != null && ready(c, v);
  }
  static File modelFile(Context c) {
    Variant v = selected(c);
    return new File(root(c, v), v.model);
  }
  static File root(Context c) { return root(c, selected(c)); }
  private static void select(Context c, Variant v) {
    c.getSharedPreferences("speech", 0).edit().remove("neural")
        .putString("voice", v == null ? "mechanical" : v.id).apply();
  }

  static void show(Activity activity) {
    if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
    if (downloading) { showProgress(activity); return; }
    Variant[] variants = {null, Variant.COMPACT, Variant.FULL};
    String[] choices = {
        "Mechanical · built-in",
        label(activity, Variant.COMPACT, "Neural compact"),
        label(activity, Variant.FULL, "Neural full quality"),
    };
    Variant current = useNeural(activity) ? selected(activity) : null;
    int checked = current == Variant.COMPACT ? 1 : current == Variant.FULL ? 2 : 0;
    new AlertDialog.Builder(activity).setTitle("Pronunciation voice")
        .setSingleChoiceItems(choices, checked, (dialog, which) -> {
          dialog.dismiss();
          Variant v = variants[which];
          if (v == null || ready(activity, v)) { select(activity, v); return; }
          new AlertDialog.Builder(activity).setTitle("Download " + choices[which].split(" · ")[0].toLowerCase(java.util.Locale.ROOT) + "?")
              .setMessage(v.downloadMb + " MB download; allow " + v.freeMb + " MB free during setup. Mechanical speech remains available.")
              .setNegativeButton("Cancel", null)
              .setPositiveButton("Download", (d, w) -> { start(activity.getApplicationContext(), v); showProgress(activity); })
              .show();
        }).setNegativeButton("Close", null).show();
  }

  private static String label(Context c, Variant v, String name) {
    return name + (ready(c, v) ? " · downloaded" : " · download " + v.downloadMb + " MB");
  }

  private static void showProgress(Activity activity) {
    AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("Neural voice")
        .setMessage(progress).setPositiveButton("Background", null)
        .setNegativeButton("Cancel download", (d, w) -> cancelled = true).create();
    dialog.show();
    Runnable refresh = new Runnable() {
      public void run() {
        if (!dialog.isShowing() || activity.isFinishing() || activity.isDestroyed()) return;
        dialog.setMessage(progress);
        if (downloading) main.postDelayed(this, 500);
        else { dialog.dismiss(); show(activity); }
      }
    };
    main.post(refresh);
  }

  private static synchronized void start(Context c, Variant v) {
    if (downloading || ready(c, v)) return;
    downloading = true;
    cancelled = false;
    progress = "Connecting…";
    // A process-wide worker lets dismissing Settings leave the download running.
    Thread worker = new Thread(() -> {
      File archive = new File(c.getNoBackupFilesDir(), v.dir + ".download");
      File staging = new File(c.getNoBackupFilesDir(), v.dir + ".staging");
      try {
        if (c.getNoBackupFilesDir().getUsableSpace() < v.freeMb * 1_000_000L)
          throw new IOException("Free " + v.freeMb + " MB of storage, then try again.");
        remove(staging);
        HttpURLConnection connection = (HttpURLConnection) new URL(v.url()).openConnection();
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(30000);
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try {
          if (connection.getResponseCode() != 200) throw new IOException("Download failed. Try again later.");
          try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(archive)) {
            byte[] buffer = new byte[65536];
            long total = 0;
            int count;
            while ((count = in.read(buffer)) != -1) {
              checkCancelled();
              total += count;
              if (total > (v.downloadMb + 50) * 1_000_000L) throw new IOException("Unexpected download size.");
              out.write(buffer, 0, count);
              hash.update(buffer, 0, count);
              progress = "Downloading: " + total / 1_000_000 + " / " + v.downloadMb + " MB";
            }
          }
        } finally { connection.disconnect(); }
        StringBuilder hex = new StringBuilder();
        for (byte b : hash.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        if (!v.sha.equals(hex.toString())) throw new IOException("Download verification failed. Please retry.");
        progress = "Installing voice…";
        staging.mkdirs();
        try (TarArchiveInputStream tar = new TarArchiveInputStream(new BZip2CompressorInputStream(new BufferedInputStream(new FileInputStream(archive))))) {
          TarArchiveEntry entry;
          long total = 0;
          while ((entry = tar.getNextTarEntry()) != null) {
            checkCancelled();
            if (!entry.isDirectory() && !entry.isFile()) throw new IOException("Unsupported model entry.");
            File dest = new File(staging, entry.getName());
            if (!dest.getCanonicalPath().startsWith(staging.getCanonicalPath() + File.separator))
              throw new IOException("Invalid model path.");
            if (entry.isDirectory()) { dest.mkdirs(); continue; }
            total += entry.getSize();
            if (total > 600_000_000L) throw new IOException("Unexpected model size.");
            dest.getParentFile().mkdirs();
            try (OutputStream out = new FileOutputStream(dest)) {
              byte[] buffer = new byte[65536];
              int count;
              while ((count = tar.read(buffer)) != -1) { checkCancelled(); out.write(buffer, 0, count); }
            }
          }
        }
        File model = new File(staging, v.archiveDir);
        for (String name : new String[]{v.model, "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-zh.txt", "LICENSE"})
          if (!new File(model, name).isFile()) throw new IOException("Incomplete voice download.");
        checkCancelled();
        // The ready marker is published only after the complete, verified directory is in place.
        remove(root(c, v));
        if (!model.renameTo(root(c, v))) throw new IOException("Could not install voice.");
        try (OutputStream out = new FileOutputStream(new File(root(c, v), ".ready"))) { out.write(1); }
        progress = "Neural voice ready. Select it in Audio settings.";
      } catch (Exception e) {
        progress = cancelled ? "Download cancelled." : "Neural voice: " + e.getMessage();
      } finally {
        archive.delete();
        remove(staging);
        downloading = false;
        String message = progress;
        main.post(() -> Toast.makeText(c, message, Toast.LENGTH_LONG).show());
      }
    }, "voice-download");
    worker.start();
  }
  private static void checkCancelled() throws IOException {
    if (cancelled) throw new IOException("Cancelled");
  }
  private static void remove(File file) {
    File[] children = file.listFiles();
    if (children != null) for (File child : children) remove(child);
    file.delete();
  }
}
