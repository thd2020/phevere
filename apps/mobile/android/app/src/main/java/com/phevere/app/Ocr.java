package com.phevere.app;

import android.graphics.Bitmap;
import android.graphics.Point;
import android.graphics.Rect;
import android.util.Base64;

import com.google.mlkit.vision.text.Text;

import org.json.JSONArray;
import org.json.JSONException;
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
    int lineNo = 0;
    for (Text.TextBlock block : text.getTextBlocks()) {
      for (Text.Line line : block.getLines()) {
        lineNo++;
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
          w.put("l", lineNo);  // the page joins a line's words with spaces, lines with newlines
          words.put(w);
        }
      }
    }
  }

  /**
   * Lines for the in-place text view: each with its corner points (clockwise from the text's
   * top-left, as fractions of the picture), confidence, block, and its words likewise. The page
   * lays them out for reading (packages/core/src/ocr-layout.ts).
   */
  static void addLines(JSONArray lines, Text text, int width, int height) throws Exception {
    if (text == null || width < 1 || height < 1) return;
    int blockNo = 0;
    for (Text.TextBlock block : text.getTextBlocks()) {
      blockNo++;
      for (Text.Line line : block.getLines()) {
        String t = line.getText() == null ? "" : line.getText().trim();
        JSONArray q = quad(line.getCornerPoints(), line.getBoundingBox(), width, height);
        if (t.isEmpty() || q == null) continue;
        JSONObject l = new JSONObject();
        l.put("t", t);
        l.put("q", q);
        l.put("b", blockNo);
        if (line.getConfidence() > 0) l.put("c", (double) line.getConfidence());
        JSONArray ws = new JSONArray();
        for (Text.Element el : line.getElements()) {
          String et = el.getText() == null ? "" : el.getText().trim();
          JSONArray eq = quad(el.getCornerPoints(), el.getBoundingBox(), width, height);
          if (et.isEmpty() || eq == null) continue;
          JSONObject w = new JSONObject();
          w.put("t", et);
          w.put("q", eq);
          if (el.getConfidence() > 0) w.put("c", (double) el.getConfidence());
          ws.put(w);
        }
        l.put("w", ws);
        lines.put(l);
      }
    }
  }

  /** Eight numbers, x and y of four corners as fractions of the picture; the box when corners are missing. */
  private static JSONArray quad(Point[] pts, Rect r, int width, int height) throws JSONException {
    JSONArray q = new JSONArray();
    if (pts != null && pts.length == 4) {
      for (Point p : pts) {
        q.put(p.x / (double) width);
        q.put(p.y / (double) height);
      }
      return q;
    }
    if (r == null) return null;
    double l = r.left / (double) width, t = r.top / (double) height;
    double rr = r.right / (double) width, b = r.bottom / (double) height;
    q.put(l); q.put(t); q.put(rr); q.put(t); q.put(rr); q.put(b); q.put(l); q.put(b);
    return q;
  }

  static JSONObject pack(Bitmap bmp, JSONArray words, JSONArray lines) throws Exception {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    bmp.compress(Bitmap.CompressFormat.JPEG, 78, bos);
    JSONObject out = new JSONObject();
    out.put("jpeg", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
    out.put("width", bmp.getWidth());
    out.put("height", bmp.getHeight());
    out.put("words", words);
    out.put("lines", lines);
    out.put("engine", "mlkit");
    return out;
  }
}
