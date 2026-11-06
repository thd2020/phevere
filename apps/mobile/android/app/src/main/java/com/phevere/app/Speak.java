package com.phevere.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.audiofx.LoudnessEnhancer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Bundled offline speech and recorded pronunciation clips. No system TTS dependency. */
final class Speak {
  private static Speak inst;
  private final OfflineSpeech offline;
  private final ExecutorService synthesis = Executors.newSingleThreadExecutor();
  private final ExecutorService prefetcher = Executors.newSingleThreadExecutor();
  private final Context context;
  private final Handler main = new Handler(Looper.getMainLooper());
  private File speechFile;
  interface Completion { void finish(String error); }
  private Completion pendingDone;
  private volatile int gen;
  private MediaPlayer player;
  /**
   * When the current player started making sound (uptime milliseconds), or 0 before it starts. A
   * clip that fails after playing HEARD_MS has been heard, so it ends as done rather than as an
   * error; an error would make the page try the next clip or the synthetic voice, and the learner
   * would hear the word twice. One that fails sooner was not heard, and the page falls back.
   */
  private long startedAt;
  private static final long HEARD_MS = 300;
  private LoudnessEnhancer boost;
  /**
   * Settings → Audio → Playback volume as a gain, 0–2: the slider's middle (50%) is the
   * player's full level, and the upper half boosts quiet clips and speech.
   */
  private volatile float volume = 1f;

  void setVolume(float value) { volume = Math.max(0f, Math.min(2f, value)); }

  static synchronized Speak get(Context ctx) {
    if (inst == null) inst = new Speak(ctx.getApplicationContext());
    return inst;
  }

  private Speak(Context ctx) {
    context = ctx;
    offline = new OfflineSpeech(ctx);
  }

  void speak(String text, String lang, float rate, Completion done) {
    speak(text, lang, rate, false, done);
  }

  void speak(String text, String lang, float rate, boolean phonemes, Completion done) {
    interrupt();
    pendingDone = done;
    final int token = ++gen;
    if (text == null || text.trim().isEmpty()) { fireDone(); return; }
    synthesis.execute(() -> {
      if (token != gen) return;
      try {
        File wave = offline.synthesize(text, lang, clampRate(rate), token, phonemes);
        main.post(() -> {
          if (token != gen) { wave.delete(); return; }
          speechFile = wave;
          startPlayer(wave.getAbsolutePath(), 1f, token);
        });
      } catch (Exception | LinkageError error) {
        main.post(() -> {
          if (token == gen) finish("Could not play pronunciation.");
        });
      }
    });
  }

  /**
   * An IPA chip with a neural voice: Kokoro reads `kokoro` (its phonemes) with `speaker`. When
   * that fails, eSpeak reads `espeak` (the same IPA as eSpeak mnemonics), so each chip still
   * sounds like its own pronunciation.
   */
  void speakIpa(String kokoro, int speaker, String espeak, String lang, float rate, Completion done) {
    interrupt();
    pendingDone = done;
    final int token = ++gen;
    synthesis.execute(() -> {
      if (token != gen) return;
      File wave;
      try {
        wave = offline.synthesizeKokoroIpa(kokoro, speaker, clampRate(rate), token);
      } catch (Exception | LinkageError neuralError) {
        try {
          wave = offline.synthesize(espeak, lang, clampRate(rate), token, true);
        } catch (Exception | LinkageError error) {
          main.post(() -> {
            if (token == gen) finish("Could not play pronunciation.");
          });
          return;
        }
      }
      final File ready = wave;
      main.post(() -> {
        if (token != gen) { ready.delete(); return; }
        speechFile = ready;
        startPlayer(ready.getAbsolutePath(), 1f, token);
      });
    });
  }

  /** Recorded clips are kept in the cache folder by URL, so a word plays at once the second time. */
  /** True when the recording at `url` is already kept on the phone. */
  boolean hasClip(String url) {
    File f = clipFile(url);
    return f != null && f.isFile() && f.length() > 0;
  }

  private File clipFile(String url) {
    try {
      byte[] h = MessageDigest.getInstance("SHA-1").digest(url.getBytes("UTF-8"));
      StringBuilder sb = new StringBuilder();
      for (byte b : h) sb.append(String.format("%02x", b));
      String ext = url.replaceAll("[?#].*$", "").replaceAll("^.*\\.", "");
      if (!ext.matches("[A-Za-z0-9]{2,4}")) ext = "mp3";
      File dir = new File(context.getCacheDir(), "pronunciations");
      dir.mkdirs();
      return new File(dir, sb + "." + ext);
    } catch (Exception e) {
      return null;
    }
  }

  /** Download a clip into the cache; returns the file, or null when it could not be fetched. */
  private File fetchClip(String url) {
    File dest = clipFile(url);
    if (dest == null) return null;
    if (dest.isFile() && dest.length() > 0) return dest;
    File tmp = new File(dest.getPath() + ".part");
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setConnectTimeout(8000);
      conn.setReadTimeout(12000);
      conn.setRequestProperty("User-Agent", "Phevere/4 (https://github.com/thd2020/phevere)");
      if (conn.getResponseCode() != 200) return null;
      try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
        byte[] buf = new byte[32768];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
      }
      if (tmp.length() == 0 || !tmp.renameTo(dest)) { tmp.delete(); return null; }
      return dest;
    } catch (Exception e) {
      tmp.delete();
      return null;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  /** Fetch clips ahead of a press (after a lookup), one at a time, off the main thread. */
  void prefetch(java.util.List<String> urls) {
    for (String url : urls) {
      if (url == null || !url.startsWith("http")) continue;
      prefetcher.execute(() -> fetchClip(url));
    }
  }

  void playUrl(String url, float rate, Completion done) {
    interrupt();
    pendingDone = done;
    final int token = ++gen;
    if (url == null || url.isEmpty()) {
      finish("No recording available.");
      return;
    }
    File cached = clipFile(url);
    if (cached != null && cached.isFile() && cached.length() > 0) {
      startPlayer(cached.getAbsolutePath(), rate, token);
      return;
    }
    // Not cached yet: download first (it is played from the file and kept), or stream if that fails.
    prefetcher.execute(() -> {
      File file = fetchClip(url);
      main.post(() -> {
        if (token != gen) return;
        startPlayer(file != null ? file.getAbsolutePath() : url, rate, token);
      });
    });
  }

  private void startPlayer(String url, float rate, int token) {
    try {
      startedAt = 0;
      player = new MediaPlayer();
      player.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build());
      player.setDataSource(url);
      player.setOnPreparedListener(mp -> {
        if (token != gen) return;
        try {
          if (Build.VERSION.SDK_INT >= 23) {
            mp.setPlaybackParams(mp.getPlaybackParams().setSpeed(clampRate(rate)));
          }
        } catch (Exception ignored) {
        }
        float level = Math.min(1f, volume);
        mp.setVolume(level, level);
        applyBoost(mp);
        try { mp.start(); startedAt = SystemClock.uptimeMillis(); }
        catch (Exception e) { stopMedia(); finish("Could not start pronunciation recording."); }
      });
      player.setOnCompletionListener(mp -> {
        if (token == gen) { stopMedia(); fireDone(); }
      });
      player.setOnErrorListener((mp, what, extra) -> {
        if (token != gen) return true;
        boolean heard = heard();
        stopMedia();
        if (heard) fireDone();
        else finish("Could not play pronunciation recording.");
        return true;
      });
      player.prepareAsync();
      final MediaPlayer preparing = player;
      main.postDelayed(() -> {
        if (token != gen || player != preparing || pendingDone == null || player.isPlaying()) return;
        // Still loading after 20 s: an error, so the page can try the next clip. A clip that
        // started and then stalled has been heard: it ends there.
        boolean heard = heard();
        stopMedia();
        if (heard) fireDone();
        else finish("Pronunciation recording timed out.");
      }, 20000);
    } catch (Exception e) {
      stopMedia();
      finish("Could not load pronunciation recording.");
    }
  }

  private boolean heard() {
    return startedAt > 0 && SystemClock.uptimeMillis() - startedAt >= HEARD_MS;
  }

  void stop() {
    interrupt();
    gen++;
  }

  private void interrupt() {
    stopMedia();
    fireDone();
  }

  /** Gain above 1 goes through LoudnessEnhancer, in millibels: 20·log10(gain)·100. */
  private void applyBoost(MediaPlayer mp) {
    releaseBoost();
    if (volume <= 1.01f) return;
    try {
      boost = new LoudnessEnhancer(mp.getAudioSessionId());
      boost.setTargetGain(Math.round((float) (2000 * Math.log10(volume))));
      boost.setEnabled(true);
    } catch (RuntimeException ignored) {
      releaseBoost();  // no effect on this device: play at full level
    }
  }

  private void releaseBoost() {
    if (boost == null) return;
    try { boost.release(); } catch (RuntimeException ignored) {}
    boost = null;
  }

  private void stopMedia() {
    releaseBoost();
    if (player == null) return;
    try {
      player.stop();
    } catch (Exception ignored) {
    }
    try {
      player.release();
    } catch (Exception ignored) {
    }
    player = null;
    if (speechFile != null) { speechFile.delete(); speechFile = null; }
  }

  private void fireDone() {
    finish(null);
  }

  private void finish(String error) {
    Completion d = pendingDone;
    pendingDone = null;
    if (d != null) d.finish(error);
  }

  private static float clampRate(float rate) {
    if (rate < 0.5f) return 0.5f;
    if (rate > 2f) return 2f;
    return rate;
  }

}
