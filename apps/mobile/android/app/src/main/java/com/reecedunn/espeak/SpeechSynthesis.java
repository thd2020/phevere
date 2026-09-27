package com.reecedunn.espeak;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Minimal adapter for the unmodified eSpeak NG 1.52 Android JNI ABI. */
public final class SpeechSynthesis {
  static {
    System.loadLibrary("ttsespeak");
    nativeClassInit();
  }
  private final int sampleRate;
  private ByteArrayOutputStream samples;

  public SpeechSynthesis(String dataParent) {
    sampleRate = nativeCreate(dataParent);
    if (sampleRate <= 0) throw new IllegalStateException("Could not initialize mechanical speech");
  }

  // Called synchronously by libttsespeak; this name and signature are part of its ABI.
  @SuppressWarnings("unused")
  private void nativeSynthCallback(byte[] data) {
    if (data != null) samples.write(data, 0, data.length);
  }

  public synchronized void synthesize(String text, String language, float rate, File wave) throws Exception {
    if (!nativeSetVoiceByProperties(language, 0, 0)) throw new Exception("Voice unavailable: " + language);
    nativeSetParameter(1, Math.round(175 * rate)); // eSpeak RATE: words/minute
    samples = new ByteArrayOutputStream();
    try {
      if (!nativeSynthesize(text, false) || samples.size() == 0) throw new Exception("No speech generated");
      byte[] pcm = samples.toByteArray();
      ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
      header.putInt(0x46464952).putInt(36 + pcm.length).putInt(0x45564157);
      header.putInt(0x20746d66).putInt(16).putShort((short) 1).putShort((short) 1);
      header.putInt(sampleRate).putInt(sampleRate * 2).putShort((short) 2).putShort((short) 16);
      header.putInt(0x61746164).putInt(pcm.length);
      try (FileOutputStream out = new FileOutputStream(wave)) {
        out.write(header.array());
        out.write(pcm);
      }
    } finally { samples = null; }
  }

  private static native boolean nativeClassInit();
  private native int nativeCreate(String path);
  private native boolean nativeSetVoiceByProperties(String language, int gender, int age);
  private native boolean nativeSetParameter(int parameter, int value);
  private native boolean nativeSynthesize(String text, boolean isSsml);
}
