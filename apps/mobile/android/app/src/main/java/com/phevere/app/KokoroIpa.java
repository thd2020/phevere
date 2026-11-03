package com.phevere.app;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Kokoro read straight from phonemes, for IPA chips when a neural voice is chosen. sherpa-onnx
 * only takes text, so this runs the same model through onnxruntime (the version sherpa-onnx
 * bundles, so both share one libonnxruntime.so), as the desktop's 'kokoro-ipa' engine does in
 * scripts/speech-worker.js. Each chip then sounds like its own IPA, not like the headword.
 */
final class KokoroIpa {
  private OrtEnvironment env;
  private OrtSession session;
  private File sessionModel;
  private final Map<String, Long> vocab = new HashMap<>();

  /** WAV of `phonemes` (Kokoro's phoneme alphabet) with `speaker` (0 US, 20 GB) into `wave`. */
  void synthesize(File root, File modelFile, String phonemes, int speaker, float speed, File wave) throws Exception {
    if (session == null || !modelFile.equals(sessionModel)) load(root, modelFile);
    List<Long> ids = new ArrayList<>();
    phonemes.codePoints().forEach((cp) -> {
      Long id = vocab.get(new String(Character.toChars(cp)));
      if (id != null) ids.add(id);
    });
    if (ids.isEmpty()) throw new Exception("No phonemes to speak");
    int n = Math.min(ids.size(), 509);
    long[][] tokens = new long[1][n + 2];
    for (int i = 0; i < n; i++) tokens[0][i + 1] = ids.get(i);
    // voices.bin is float32 [speakers][510][256]; the row is picked by token count.
    float[][] style = new float[1][256];
    try (RandomAccessFile voices = new RandomAccessFile(new File(root, "voices.bin"), "r")) {
      long offset = ((long) speaker * 510 + n) * 256L * 4L;
      if (offset + 1024 > voices.length()) throw new Exception("Unknown neural speaker");
      byte[] row = new byte[1024];
      voices.seek(offset);
      voices.readFully(row);
      ByteBuffer.wrap(row).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(style[0]);
    }
    Map<String, OnnxTensor> inputs = new HashMap<>();
    try (OnnxTensor t = OnnxTensor.createTensor(env, tokens);
         OnnxTensor s = OnnxTensor.createTensor(env, style);
         OnnxTensor sp = OnnxTensor.createTensor(env, new float[] { speed })) {
      inputs.put("tokens", t);
      inputs.put("style", s);
      inputs.put("speed", sp);
      try (OrtSession.Result out = session.run(inputs)) {
        Object value = out.get(0).getValue();
        float[] audio = value instanceof float[][] ? ((float[][]) value)[0] : (float[]) value;
        if (audio == null || audio.length == 0) throw new Exception("No speech generated for this IPA");
        writeWav(audio, 24000, wave);
      }
    }
  }

  void release() {
    try { if (session != null) session.close(); } catch (Exception ignored) { }
    session = null;
    sessionModel = null;
  }

  private void load(File root, File modelFile) throws Exception {
    release();
    if (env == null) env = OrtEnvironment.getEnvironment();
    OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
    opts.setIntraOpNumThreads(2);
    opts.setInterOpNumThreads(1);
    session = env.createSession(modelFile.getAbsolutePath(), opts);
    sessionModel = modelFile;
    vocab.clear();
    try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(new File(root, "tokens.txt")), StandardCharsets.UTF_8))) {
      String line;
      while ((line = r.readLine()) != null) {
        int sp = line.lastIndexOf(' ');
        if (sp <= 0) continue;
        try {
          vocab.put(line.substring(0, sp), Long.parseLong(line.substring(sp + 1).trim()));
        } catch (NumberFormatException ignored) {
        }
      }
    }
  }

  private static void writeWav(float[] samples, int rate, File wave) throws Exception {
    int n = samples.length;
    ByteBuffer b = ByteBuffer.allocate(44 + n * 2).order(ByteOrder.LITTLE_ENDIAN);
    b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + n * 2).put("WAVE".getBytes(StandardCharsets.US_ASCII));
    b.put("fmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1)
        .putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16);
    b.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(n * 2);
    for (float s : samples) b.putShort((short) Math.round(Math.max(-1f, Math.min(1f, s)) * 32767f));
    try (FileOutputStream out = new FileOutputStream(wave)) {
      out.write(b.array());
    }
  }
}
