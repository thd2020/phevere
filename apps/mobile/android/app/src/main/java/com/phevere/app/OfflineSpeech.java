package com.phevere.app;

import android.content.Context;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import java.io.File;
import java.io.FileOutputStream;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipEntry;
import com.reecedunn.espeak.SpeechSynthesis;

/** Embedded mechanical voice by default; Kokoro is an optional model download. */
final class OfflineSpeech {
  private final Context context;
  private OfflineTts engine;
  private File engineModel;
  private SpeechSynthesis mechanical;

  OfflineSpeech(Context context) { this.context = context; }

  File synthesize(String text, String lang, float rate, int token) throws Exception {
    return synthesize(text, lang, rate, token, false);
  }

  /** phonemes: text is eSpeak phoneme mnemonics from an IPA chip; only eSpeak can voice those. */
  File synthesize(String text, String lang, float rate, int token, boolean phonemes) throws Exception {
    boolean chinese = !phonemes && ((lang != null && lang.startsWith("zh")) || text.codePoints().anyMatch(c -> c >= 0x3400 && c <= 0x9fff));
    File wave = new File(context.getCacheDir(), "speech-" + token + ".wav");
    if (phonemes || !SpeechModels.useNeural(context)) {
      if (mechanical == null) {
        File root = new File(context.getNoBackupFilesDir(), "espeak-1.52.0");
        File ready = new File(root, ".ready");
        if (!ready.exists()) {
          root.mkdirs();
          try (ZipInputStream zip = new ZipInputStream(context.getAssets().open("speech/espeak-data.zip"))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
              File dest = new File(root, entry.getName());
              if (!dest.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator))
                throw new Exception("Invalid voice data path");
              if (entry.isDirectory()) { dest.mkdirs(); continue; }
              dest.getParentFile().mkdirs();
              try (FileOutputStream out = new FileOutputStream(dest)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = zip.read(buffer)) != -1) out.write(buffer, 0, count);
              }
            }
          }
          try (FileOutputStream out = new FileOutputStream(ready)) { out.write(1); }
        }
        mechanical = new SpeechSynthesis(root.getAbsolutePath());
      }
      mechanical.synthesize(phonemes ? "[[" + text + "]]" : text, chinese ? "cmn" : "en-GB".equalsIgnoreCase(lang) ? "en-gb" : "en-us", rate, wave);
      return wave;
    }
    File modelFile = SpeechModels.modelFile(context);
    if (engine != null && !modelFile.equals(engineModel)) {
      engine.release();  // switched between compact and full
      engine = null;
    }
    if (engine == null) {
      File root = SpeechModels.root(context);
      OfflineTtsKokoroModelConfig kokoro = new OfflineTtsKokoroModelConfig();
      kokoro.setModel(modelFile.getAbsolutePath());
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
      engineModel = modelFile;
    }
    int speaker = chinese ? 45 : "en-GB".equalsIgnoreCase(lang) ? 20 : 0;
    GeneratedAudio audio = engine.generate(text, speaker, rate);
    if (audio.getSamples().length == 0) throw new Exception("No speech generated for this text");
    if (!audio.save(wave.getAbsolutePath())) throw new Exception("Could not prepare speech audio");
    return wave;
  }

}
