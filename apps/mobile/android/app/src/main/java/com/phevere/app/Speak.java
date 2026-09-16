package com.phevere.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.Locale;

/** On-device TTS and streamed pronunciation clips. Android WebView has no SpeechSynthesis. */
final class Speak {
  private static Speak inst;
  private final TextToSpeech tts;
  private volatile boolean ready;
  private String pendingText;
  private String pendingLang = "en-US";
  private float pendingRate = 1f;
  private Runnable pendingDone;
  private int gen;
  private MediaPlayer player;

  static synchronized Speak get(Context ctx) {
    if (inst == null) inst = new Speak(ctx.getApplicationContext());
    return inst;
  }

  private Speak(Context ctx) {
    tts = new TextToSpeech(ctx, this::onEngineInit);
  }

  private void onEngineInit(int status) {
    ready = status == TextToSpeech.SUCCESS;
    if (ready) {
      tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
        @Override
        public void onStart(String utteranceId) {}

        @Override
        public void onDone(String utteranceId) {
          if (utteranceId != null && utteranceId.equals("pv-" + gen)) fireDone();
        }

        @Deprecated
        @Override
        public void onError(String utteranceId) {
          if (utteranceId != null && utteranceId.equals("pv-" + gen)) fireDone();
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
      else fireDone();
    } else if (!ready) {
      fireDone();
    }
  }

  void speak(String text, String lang, float rate, Runnable done) {
    interrupt();
    pendingDone = done;
    gen++;
    if (text == null || text.trim().isEmpty()) {
      fireDone();
      return;
    }
    if (!ready) {
      pendingText = text;
      pendingLang = lang;
      pendingRate = rate;
      return;
    }
    speakNow(text, lang, rate);
  }

  void playUrl(String url, float rate, Runnable done) {
    interrupt();
    pendingDone = done;
    gen++;
    if (url == null || url.isEmpty()) {
      fireDone();
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
        mp.start();
      });
      player.setOnCompletionListener(mp -> {
        if (token == gen) fireDone();
      });
      player.setOnErrorListener((mp, what, extra) -> {
        if (token == gen) fireDone();
        return true;
      });
      player.prepareAsync();
    } catch (Exception e) {
      fireDone();
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
      tts.setLanguage(locale(lang));
      tts.setSpeechRate(clampRate(rate));
      tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "pv-" + gen);
    } catch (Exception e) {
      fireDone();
    }
  }

  private void fireDone() {
    Runnable d = pendingDone;
    pendingDone = null;
    if (d != null) d.run();
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
