package com.phevere.app;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.util.Base64;

import com.google.mlkit.vision.text.Text;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;

/** Pack a still image plus ML Kit word boxes for the scan pane. */
final class Ocr {
  private Ocr() {}

  static Bitmap software(Bitmap bmp) {
    if (bmp == null) return null;
    if (android.os.Build.VERSION.SDK_INT >= 26 && bmp.getConfig() == Bitmap.Config.HARDWARE) {
      Bitmap copy = bmp.copy(Bitmap.Config.ARGB_8888, false);
      bmp.recycle();
      return copy;
    }
    return bmp;
  }

  static Bitmap fit(Bitmap bmp, int maxEdge) {
    if (bmp == null) return null;
    int w = bmp.getWidth();
    int h = bmp.getHeight();
    int edge = Math.max(w, h);
    if (edge <= maxEdge) return bmp;
    float s = maxEdge / (float) edge;
    Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), true);
    if (scaled != bmp) bmp.recycle();
    return scaled;
  }

  static void addWords(JSONArray words, Text text, int width, int height) throws Exception {
    if (text == null || width < 1 || height < 1) return;
    for (Text.TextBlock block : text.getTextBlocks()) {
      for (Text.Line line : block.getLines()) {
        for (Text.Element el : line.getElements()) {
          Rect r = el.getBoundingBox();
          String t = el.getText() == null ? "" : el.getText().trim();
          if (r == null || t.isEmpty()) continue;
          JSONObject w = new JSONObject();
          w.put("t", t);
          w.put("x", r.left / (double) width);
          w.put("y", r.top / (double) height);
          w.put("w", r.width() / (double) width);
          w.put("h", r.height() / (double) height);
          words.put(w);
        }
      }
    }
  }

  static JSONObject pack(Bitmap bmp, JSONArray words) throws Exception {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    bmp.compress(Bitmap.CompressFormat.JPEG, 78, bos);
    JSONObject out = new JSONObject();
    out.put("jpeg", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
    out.put("width", bmp.getWidth());
    out.put("height", bmp.getHeight());
    out.put("words", words);
    return out;
  }
}
