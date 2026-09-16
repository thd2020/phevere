package com.phevere.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

final class WebViews {
  static final String INDEX = "https://appassets.androidplatform.net/assets/www/index.html";

  private WebViews() {}

  static WebViewAssetLoader assets(Context ctx) {
    return new WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(ctx))
        .build();
  }

  static void bind(
      WebView web,
      WebViewAssetLoader assets,
      NativeBridge.Target target,
      boolean strip,
      Runnable onReady
  ) {
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);
    if (Build.VERSION.SDK_INT >= 21) {
      s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
    }
    web.addJavascriptInterface(new NativeBridge(target), "PhevereBridge");
    web.setWebViewClient(new WebViewClient() {
      @Nullable
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return assets.shouldInterceptRequest(request.getUrl());
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        if (u != null && "appassets.androidplatform.net".equals(u.getHost())) return false;
        if (u != null) {
          Context ctx = view.getContext();
          Intent i = new Intent(Intent.ACTION_VIEW, u);
          if (!(ctx instanceof android.app.Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          ctx.startActivity(i);
          return true;
        }
        return false;
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        onReady.run();
      }
    });
    web.loadUrl(strip ? INDEX + "?mode=strip" : INDEX);
  }
}
