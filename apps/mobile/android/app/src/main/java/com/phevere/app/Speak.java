package com.phevere.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Bundled offline speech and recorded pronunciation clips. No system TTS dependency. */
final class Speak {
  private static Speak inst;
  private final OfflineSpeech offline;
  private final ExecutorService synthesis = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private File speechFile;
  interface Completion { void finish(String error); }
  private Completion pendingDone;
  private volatile int gen;
  private MediaPlayer player;
  /** Settings → Audio → Playback volume, 0–1, applied to recordings and synthesis. */
  private volatile float volume = 1f;

  void setVolume(float value) { volume = Math.max(0f, Math.min(1f, value)); }

  static synchronized Speak get(Context ctx) {
    if (inst == null) inst = new Speak(ctx.getApplicationContext());
    return inst;
  }

  private Speak(Context ctx) {
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
          if (token == gen) finish("Bundled speech could not play this text. Try again.");
        });
      }
    });
  }

  void playUrl(String url, float rate, Completion done) {
    interrupt();
    pendingDone = done;
    gen++;
    if (url == null || url.isEmpty()) {
      finish("No pronunciation recording available.");
      return;
    }
    startPlayer(url, rate, gen);
  }

  private void startPlayer(String url, float rate, int token) {
    try {
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
        mp.setVolume(volume, volume);
        try { mp.start(); }
        catch (Exception e) { stopMedia(); finish("Could not start pronunciation recording."); }
      });
      player.setOnCompletionListener(mp -> {
        if (token == gen) { stopMedia(); fireDone(); }
      });
      player.setOnErrorListener((mp, what, extra) -> {
        if (token == gen) { stopMedia(); finish("Could not play pronunciation recording."); }
        return true;
      });
      player.prepareAsync();
      final MediaPlayer preparing = player;
      main.postDelayed(() -> {
        if (token == gen && player == preparing && pendingDone != null && !player.isPlaying()) {
          stopMedia();
          finish("Pronunciation recording timed out.");
        }
      }, 20000);
    } catch (Exception e) {
      stopMedia();
      finish("Could not load pronunciation recording.");
    }
  }

  void stop() {
    interrupt();
    gen++;
  }

  private void interrupt() {
    stopMedia();
    fireDone();
  }

  private void stopMedia() {
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
