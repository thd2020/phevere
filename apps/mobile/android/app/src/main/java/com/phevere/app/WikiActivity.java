package com.phevere.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.appbar.MaterialToolbar;

public class WikiActivity extends AppCompatActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_wiki);
    String url = getIntent().getStringExtra("url");
    String title = getIntent().getStringExtra("title");
    MaterialToolbar bar = findViewById(R.id.wiki_toolbar);
    bar.setTitle(title != null && !title.isEmpty() ? title : "Wikipedia");
    bar.setNavigationIcon(android.R.drawable.ic_menu_revert);
    bar.setNavigationOnClickListener(v -> finish());
    WebView web = findViewById(R.id.wiki_webview);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    web.setWebViewClient(new WebViewClient());
    if (url != null) web.loadUrl(url);

    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        if (web.canGoBack()) web.goBack();
        else {
          setEnabled(false);
          WikiActivity.this.getOnBackPressedDispatcher().onBackPressed();
        }
      }
    });
  }
}
