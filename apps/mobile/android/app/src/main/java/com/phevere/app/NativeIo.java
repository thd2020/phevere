package com.phevere.app;

import android.content.Context;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class NativeIo {
  static final int MAX_BYTES = 24 * 1024 * 1024;

  private NativeIo() {}

  static JSONObject http(JSONObject p) throws Exception {
    String url = p.getString("url");
    String method = p.optString("method", "GET");
    int timeout = p.optInt("timeoutMs", 8000);
    String as = p.optString("responseType", "text");
    OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(timeout, TimeUnit.MILLISECONDS)
        .readTimeout(timeout, TimeUnit.MILLISECONDS)
        .callTimeout(timeout + 2000L, TimeUnit.MILLISECONDS)
        .build();
    Request.Builder b = new Request.Builder().url(url);
    JSONObject headers = p.optJSONObject("headers");
    if (headers != null) {
      Iterator<String> keys = headers.keys();
      while (keys.hasNext()) {
        String k = keys.next();
        b.header(k, headers.optString(k));
      }
    }
    String body = p.optString("body", null);
    if (body != null && !"null".equals(body) && !body.isEmpty() && !"GET".equalsIgnoreCase(method)) {
      String ct = headers != null ? headers.optString("Content-Type", "application/json") : "application/json";
      b.method(method, RequestBody.create(body, MediaType.parse(ct)));
    } else {
      b.method(method, null);
    }
    try (Response res = client.newCall(b.build()).execute()) {
      JSONObject out = new JSONObject();
      out.put("status", res.code());
      ResponseBody rb = res.body();
      String ct = rb != null && rb.contentType() != null ? rb.contentType().toString() : "";
      out.put("contentType", ct);
      if (rb == null) {
        out.put("text", "");
        return out;
      }
      byte[] bytes = rb.bytes();
      if (bytes.length > MAX_BYTES) throw new Exception("Response too large");
      if ("bytes".equals(as)) out.put("b64", Base64.encodeToString(bytes, Base64.NO_WRAP));
      else out.put("text", new String(bytes, StandardCharsets.UTF_8));
      return out;
    }
  }

  static JSONObject readFile(Context ctx, String name) throws Exception {
    File f = new File(ctx.getFilesDir(), safeName(name));
    JSONObject out = new JSONObject();
    if (!f.exists()) {
      out.put("b64", JSONObject.NULL);
      return out;
    }
    FileInputStream in = new FileInputStream(f);
    byte[] bytes = readAll(in);
    in.close();
    out.put("b64", Base64.encodeToString(bytes, Base64.NO_WRAP));
    return out;
  }

  static void writeFile(Context ctx, String name, String b64) throws Exception {
    File f = new File(ctx.getFilesDir(), safeName(name));
    byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
    FileOutputStream out = new FileOutputStream(f);
    out.write(bytes);
    out.close();
  }

  static String safeName(String name) {
    String n = name == null ? "file" : name.replace("\\", "_").replace("/", "_");
    if (n.contains("..")) n = "file";
    return n;
  }

  static byte[] readAll(InputStream in) throws Exception {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    int n;
    int total = 0;
    while ((n = in.read(buf)) > 0) {
      total += n;
      if (total > MAX_BYTES) throw new Exception("File too large");
      bos.write(buf, 0, n);
    }
    in.close();
    return bos.toByteArray();
  }
}
