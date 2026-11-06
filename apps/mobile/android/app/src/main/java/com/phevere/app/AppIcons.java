package com.phevere.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;

/**
 * An installed app's launcher icon as a PNG, for the app's row in Words, Sources. The manifest
 * asks to see launcher apps (a <queries> intent), so any app a word can be selected in and
 * that has a home-screen icon is found here.
 */
final class AppIcons {
  private static final int SIZE_PX = 96;

  private AppIcons() {}

  /** {png: base64} or {png: null} when the app is not installed here. */
  static JSONObject icon(Context ctx, String pkg) throws Exception {
    JSONObject out = new JSONObject().put("png", JSONObject.NULL);
    if (pkg == null || !pkg.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+")) return out;
    Drawable d;
    try {
      d = ctx.getPackageManager().getApplicationIcon(pkg);
    } catch (Exception e) {
      return out;
    }
    Bitmap bmp = Bitmap.createBitmap(SIZE_PX, SIZE_PX, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bmp);
    d.setBounds(0, 0, SIZE_PX, SIZE_PX);
    d.draw(canvas);
    ByteArrayOutputStream png = new ByteArrayOutputStream();
    bmp.compress(Bitmap.CompressFormat.PNG, 100, png);
    bmp.recycle();
    return out.put("png", Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP));
  }
}
