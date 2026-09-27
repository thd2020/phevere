package com.phevere.app;

import android.content.Context;
import android.content.res.AssetManager;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** APK-bundled Kokoro + sherpa-onnx; called only on Speak's serial synthesis worker. */
final class OfflineSpeech {
  private static final String VERSION = "kokoro-v1-sherpa-1.13.3";
  private final Context context;
  private OfflineTts engine;

  OfflineSpeech(Context context) { this.context = context; }

  File synthesize(String text, String lang, float rate, int token) throws Exception {
    if (engine == null) {
      File root = new File(context.getNoBackupFilesDir(), VERSION);
      File ready = new File(root, ".ready");
      if (!ready.exists()) {
        copyAssets(context.getAssets(), "speech/kokoro-multi-lang-v1_0", root);
        try (FileOutputStream out = new FileOutputStream(ready)) {
          out.write(VERSION.getBytes(StandardCharsets.UTF_8));
        }
      }
      OfflineTtsKokoroModelConfig kokoro = new OfflineTtsKokoroModelConfig();
      kokoro.setModel(new File(root, "model.onnx").getAbsolutePath());
      kokoro.setVoices(new File(root, "voices.bin").getAbsolutePath());
      kokoro.setTokens(new File(root, "tokens.txt").getAbsolutePath());
      kokoro.setDataDir(new File(root, "espeak-ng-data").getAbsolutePath());
      kokoro.setLexicon(new File(root, "lexicon-us-en.txt").getAbsolutePath() + ","
          + new File(root, "lexicon-zh.txt").getAbsolutePath());
      OfflineTtsModelConfig model = new OfflineTtsModelConfig();
      model.setKokoro(kokoro);
      model.setNumThreads(2);
      OfflineTtsConfig config = new OfflineTtsConfig();
      config.setModel(model);
      engine = new OfflineTts(null, config);
    }
    boolean chinese = (lang != null && lang.startsWith("zh")) || text.codePoints().anyMatch(c -> c >= 0x3400 && c <= 0x9fff);
    int speaker = chinese ? 45 : "en-GB".equalsIgnoreCase(lang) ? 20 : 0;
    GeneratedAudio audio = engine.generate(text, speaker, rate);
    if (audio.getSamples().length == 0) throw new Exception("No speech generated for this text");
    File wave = new File(context.getCacheDir(), "speech-" + token + ".wav");
    if (!audio.save(wave.getAbsolutePath())) throw new Exception("Could not prepare speech audio");
    return wave;
  }

  private static void copyAssets(AssetManager assets, String source, File dest) throws Exception {
    String[] children = assets.list(source);
    if (children != null && children.length > 0) {
      if (!dest.isDirectory() && !dest.mkdirs()) throw new Exception("Could not prepare bundled voice");
      for (String child : children) copyAssets(assets, source + "/" + child, new File(dest, child));
      return;
    }
    try (InputStream in = assets.open(source); FileOutputStream out = new FileOutputStream(dest)) {
      byte[] buffer = new byte[65536];
      int count;
      while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
    }
  }
}
