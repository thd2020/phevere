package com.phevere.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.Locale;

/** On-device TTS and streamed pronunciation clips. Android WebView has no SpeechSynthesis. */
final class Speak {
  private static Speak inst;
  private final TextToSpeech tts;
  private volatile boolean ready;
  private boolean initialized;
  private final Handler main = new Handler(Looper.getMainLooper());
  private String pendingText;
  private String pendingLang = "en-US";
  private float pendingRate = 1f;
  interface Completion { void finish(String error); }
  private Completion pendingDone;
  private int gen;
  private MediaPlayer player;

  static synchronized Speak get(Context ctx) {
    if (inst == null) inst = new Speak(ctx.getApplicationContext());
    return inst;
  }

  private Speak(Context ctx) {
    tts = new TextToSpeech(ctx, status -> main.post(() -> onEngineInit(status)));
  }

  private void onEngineInit(int status) {
    initialized = true;
    ready = status == TextToSpeech.SUCCESS;
    if (ready) {
      tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
        @Override
        public void onStart(String utteranceId) {}

        @Override
        public void onDone(String utteranceId) {
          main.post(() -> { if (utteranceId != null && utteranceId.equals("pv-" + gen)) fireDone(); });
        }

        @Deprecated
        @Override
        public void onError(String utteranceId) {
          main.post(() -> { if (utteranceId != null && utteranceId.equals("pv-" + gen)) finish("Speech playback failed. Check your phone’s text-to-speech settings."); });
        }
      });
      if (Build.VERSION.SDK_INT >= 21) {
        tts.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
      }
    }
    if (pendingText != null) {
      String text = pendingText;
      String lang = pendingLang;
      float rate = pendingRate;
      pendingText = null;
      if (ready) speakNow(text, lang, rate);
      else finish("No text-to-speech engine available. Enable an engine in Android Settings → Text-to-speech output.");
    }
  }

  void speak(String text, String lang, float rate, Completion done) {
    interrupt();
    pendingDone = done;
    gen++;
    if (text == null || text.trim().isEmpty()) {
      fireDone();
      return;
    }
    if (!ready) {
      if (initialized) {
        finish("No text-to-speech engine available. Enable an engine in Android Settings → Text-to-speech output.");
        return;
      }
      pendingText = text;
      pendingLang = lang;
      pendingRate = rate;
      final int token = gen;
      main.postDelayed(() -> {
        if (token == gen && pendingText != null) {
          pendingText = null;
          finish("Text-to-speech did not start. Check Android speech settings.");
        }
      }, 10000);
      return;
    }
    speakNow(text, lang, rate);
  }

  void playUrl(String url, float rate, Completion done) {
    interrupt();
    pendingDone = done;
    gen++;
    if (url == null || url.isEmpty()) {
      finish("No pronunciation recording available.");
      return;
    }
    try {
      final int token = gen;
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
      main.postDelayed(() -> {
        if (token == gen && player != null && pendingDone != null) {
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
    pendingText = null;
    stopMedia();
    if (ready) {
      try {
        tts.stop();
      } catch (Exception ignored) {
      }
    }
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
  }

  private void speakNow(String text, String lang, float rate) {
    try {
      int language = tts.setLanguage(locale(lang));
      if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
        finish("Install a voice for " + lang + " in Android text-to-speech settings.");
        return;
      }
      tts.setSpeechRate(clampRate(rate));
      if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "pv-" + gen) == TextToSpeech.ERROR) {
        finish("Text-to-speech could not start.");
      }
    } catch (Exception e) {
      finish("Text-to-speech playback failed.");
    }
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

  private static Locale locale(String lang) {
    if (lang == null || lang.isEmpty()) return Locale.US;
    String[] p = lang.replace('_', '-').split("-");
    if (p.length >= 2) return new Locale(p[0], p[1]);
    if ("en".equalsIgnoreCase(p[0])) return Locale.US;
    return new Locale(p[0]);
  }
}
