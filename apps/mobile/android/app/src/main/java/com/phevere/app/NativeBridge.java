package com.phevere.app;

import android.webkit.JavascriptInterface;

public class NativeBridge {
  public interface Target {
    void handleJs(String method, String id, String paramsJson);
  }

  private final Target target;

  public NativeBridge(Target target) {
    this.target = target;
  }

  @JavascriptInterface
  public void call(String method, String id, String paramsJson) {
    target.handleJs(method, id, paramsJson == null ? "{}" : paramsJson);
  }
}
