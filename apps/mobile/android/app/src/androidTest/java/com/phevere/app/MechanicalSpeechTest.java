package com.phevere.app;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class MechanicalSpeechTest {
  @Test public void freshInstallSpeaksEnglishAndMandarinWithoutNeuralDownload() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    context.getSharedPreferences("speech", 0).edit().clear().commit();
    assertFalse(SpeechModels.useNeural(context));
    assertFalse(SpeechModels.ready(context));
    OfflineSpeech speech = new OfflineSpeech(context);
    String[] words = {"Hello, world.", "Dictionary.", "你好，世界。"};
    String[] langs = {"en-US", "en-GB", "zh-CN"};
    for (int i = 0; i < words.length; i++) {
      File wave = speech.synthesize(words[i], langs[i], 1f, 100 + i);
      byte[] data = Files.readAllBytes(wave.toPath());
      ByteBuffer header = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
      assertEquals(0x46464952, header.getInt(0));
      assertEquals(data.length - 44, header.getInt(40));
      int sampleRate = header.getInt(24);
      assertTrue(sampleRate > 0);
      assertTrue("Speech must not be empty or truncated", data.length > 44 + sampleRate / 5 * 2);
      boolean audible = false;
      for (int n = 44; n + 1 < data.length; n += 2) {
        if (Math.abs(header.getShort(n)) > 32) { audible = true; break; }
      }
      assertTrue("Speech must not be silent", audible);
      wave.delete();
    }
    // IPA chips: eSpeak must parse [[phonemes]], not read brackets and letters aloud.
    File ipa = speech.synthesize("h@l'oU", "en-GB", 1f, 105, true);
    ByteBuffer ipaHeader = ByteBuffer.wrap(Files.readAllBytes(ipa.toPath())).order(ByteOrder.LITTLE_ENDIAN);
    double seconds = ipaHeader.getInt(40) / 2.0 / ipaHeader.getInt(24);
    assertTrue("Phoneme speech length " + seconds + "s", seconds > 0.2 && seconds < 1.5);
    ipa.delete();
    // A stale neural preference cannot break speech when its model is missing.
    context.getSharedPreferences("speech", 0).edit().putBoolean("neural", true).commit();
    assertFalse(SpeechModels.useNeural(context));
    File fallback = speech.synthesize("Fallback works.", "en-US", 1.5f, 104);
    assertTrue(fallback.length() > 44);
    fallback.delete();
    context.getSharedPreferences("speech", 0).edit().clear().commit();
  }
}
