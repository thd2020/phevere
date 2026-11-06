package com.phevere.app;

import android.content.Context;
import android.util.Base64;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.WeakHashMap;

/**
 * The notebook file that every page in this process shares: the full app, the bottom-sheet
 * pop-up and the floating pop-up over another app. Each page keeps its own copy in memory
 * (sql.js), so this class is the one owner of the file on disk.
 *
 * Writes carry the version the page last read. A write from a page whose copy is older than
 * the file is refused, and that page reloads the file and applies its changes again before
 * writing (optimistic concurrency, as a sync server does). After each write the other open
 * pages are told the new version, so they reload and show the change at once, in the way
 * Room's multi-instance invalidation tells other database instances to re-query.
 */
final class Notebook {
  static final String FILE = "phevere.sqlite";

  /** Starts at 1 for every process; pages and the file live and die with the process. */
  private static long version = 1;
  private static final Set<BridgeRouter.Host> pages = Collections.newSetFromMap(new WeakHashMap<>());

  private Notebook() {}

  static synchronized void register(BridgeRouter.Host page) {
    pages.add(page);
  }

  static synchronized void unregister(BridgeRouter.Host page) {
    pages.remove(page);
  }

  static synchronized long version() {
    return version;
  }

  /** {b64 (null when there is no notebook yet), version}. */
  static synchronized JSONObject read(Context ctx) throws Exception {
    File f = new File(ctx.getFilesDir(), FILE);
    JSONObject out = new JSONObject().put("version", version);
    if (!f.exists()) return out.put("b64", JSONObject.NULL);
    // No size cap: a notebook with dictionary packs passes the bridge's 24 MB limit for other
    // files, and a page that cannot read the file must not start an empty notebook over it.
    try (FileInputStream in = new FileInputStream(f)) {
      ByteArrayOutputStream bos = new ByteArrayOutputStream((int) Math.min(f.length(), Integer.MAX_VALUE - 8));
      byte[] buf = new byte[1 << 16];
      int n;
      while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
      return out.put("b64", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
    }
  }

  /**
   * Writes the page's notebook when `base` is the current version: {ok, version}. Otherwise
   * nothing is written: {conflict, version}.
   */
  static JSONObject write(Context ctx, String b64, long base, BridgeRouter.Host from) throws Exception {
    long next;
    List<BridgeRouter.Host> others = new ArrayList<>();
    synchronized (Notebook.class) {
      if (base != version) return new JSONObject().put("conflict", true).put("version", version);
      writeAtomically(new File(ctx.getFilesDir(), FILE), Base64.decode(b64, Base64.DEFAULT));
      next = ++version;
      for (BridgeRouter.Host page : pages) if (page != from) others.add(page);
    }
    String js = "window.__pvNotebookChanged && window.__pvNotebookChanged(" + next + ")";
    for (BridgeRouter.Host page : others) {
      page.runUi(() -> {
        WebView web = page.web();
        if (web != null) web.evaluateJavascript(js, null);
      });
    }
    return new JSONObject().put("ok", true).put("version", next);
  }

  /** A reader never sees half a file: the bytes go to a temporary file that then replaces it. */
  private static void writeAtomically(File target, byte[] bytes) throws IOException {
    File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
    try (FileOutputStream out = new FileOutputStream(tmp)) {
      out.write(bytes);
      out.getFD().sync();
    }
    if (!tmp.renameTo(target)) {
      tmp.delete();
      throw new IOException("Could not save the notebook");
    }
  }
}
