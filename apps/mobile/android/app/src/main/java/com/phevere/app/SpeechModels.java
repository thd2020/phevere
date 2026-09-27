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
  private static final String VERSION = "kokoro-v1-sherpa-1.13.3";
  private static final String URL_MODEL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2";
  private static final String SHA = "c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298";
  private static volatile boolean downloading;
  private static volatile boolean cancelled;
  private static volatile String progress = "";
  private static final Handler main = new Handler(Looper.getMainLooper());

  static File root(Context c) { return new File(c.getNoBackupFilesDir(), VERSION); }
  static boolean ready(Context c) {
    File root = root(c);
    return new File(root, ".ready").isFile() && new File(root, "model.onnx").isFile()
        && new File(root, "voices.bin").isFile();
  }
  static boolean useNeural(Context c) {
    return c.getSharedPreferences("speech", 0).getBoolean("neural", false) && ready(c);
  }
  private static void select(Context c, boolean neural) {
    c.getSharedPreferences("speech", 0).edit().putBoolean("neural", neural).apply();
  }

  static void show(Activity activity) {
    if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
    if (downloading) { showProgress(activity); return; }
    boolean installed = ready(activity);
    String[] choices = {"Mechanical · built-in", installed ? "Neural · downloaded" : "Neural · download 350 MB"};
    new AlertDialog.Builder(activity).setTitle("Pronunciation voice")
        .setSingleChoiceItems(choices, useNeural(activity) ? 1 : 0, (dialog, which) -> {
          dialog.dismiss();
          if (which == 0 || installed) { select(activity, which == 1); return; }
          new AlertDialog.Builder(activity).setTitle("Download neural voice?")
              .setMessage("350 MB download; allow 1 GB free during setup. Mechanical speech remains available.")
              .setNegativeButton("Cancel", null)
              .setPositiveButton("Download", (d, w) -> { start(activity.getApplicationContext()); showProgress(activity); })
              .show();
        }).setNegativeButton("Close", null).show();
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

  private static synchronized void start(Context c) {
    if (downloading || ready(c)) return;
    downloading = true;
    cancelled = false;
    progress = "Connecting…";
    // A process-wide worker lets dismissing Settings leave the download running.
    Thread worker = new Thread(() -> {
      File archive = new File(c.getNoBackupFilesDir(), VERSION + ".download");
      File staging = new File(c.getNoBackupFilesDir(), VERSION + ".staging");
      try {
        if (c.getNoBackupFilesDir().getUsableSpace() < 1_000_000_000L)
          throw new IOException("Free 1 GB of storage, then try again.");
        remove(staging);
        HttpURLConnection connection = (HttpURLConnection) new URL(URL_MODEL).openConnection();
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
              if (total > 400_000_000L) throw new IOException("Unexpected download size.");
              out.write(buffer, 0, count);
              hash.update(buffer, 0, count);
              progress = "Downloading: " + total / 1_000_000 + " / 350 MB";
            }
          }
        } finally { connection.disconnect(); }
        StringBuilder hex = new StringBuilder();
        for (byte b : hash.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        if (!SHA.equals(hex.toString())) throw new IOException("Download verification failed. Please retry.");
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
        File model = new File(staging, "kokoro-multi-lang-v1_0");
        for (String name : new String[]{"model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-zh.txt", "LICENSE"})
          if (!new File(model, name).isFile()) throw new IOException("Incomplete voice download.");
        checkCancelled();
        // The ready marker is published only after the complete, verified directory is in place.
        remove(root(c));
        if (!model.renameTo(root(c))) throw new IOException("Could not install voice.");
        try (OutputStream out = new FileOutputStream(new File(root(c), ".ready"))) { out.write(1); }
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
