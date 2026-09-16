package com.phevere.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.view.Window;
import android.view.WindowManager;

import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity implements NativeBridge.Target, BridgeRouter.Host {
  private WebView web;
  private WebViewAssetLoader assets;
  private final ExecutorService io = Executors.newCachedThreadPool();
  private final BridgeRouter router = new BridgeRouter(this);
  private String pendingText;
  private String pendingOrigin;
  private String pendingJsId;
  private String pendingSaveText;
  private Uri captureUri;
  private boolean pageReady;
  private Insets lastInsets;

  private final ActivityResultLauncher<String> notifyPerm =
      registerForActivityResult(new ActivityResultContracts.RequestPermission(), ok -> {});

  private final ActivityResultLauncher<String> cameraPerm =
      registerForActivityResult(new ActivityResultContracts.RequestPermission(), ok -> {
        if (ok) takePhoto();
        else failPending("Camera permission denied");
      });

  private final ActivityResultLauncher<Uri> takePicture =
      registerForActivityResult(new ActivityResultContracts.TakePicture(), ok -> {
        if (ok && captureUri != null) recognize(captureUri);
        else failPending("No photo");
      });

  private final ActivityResultLauncher<String> pickVisual =
      registerForActivityResult(new ActivityResultContracts.GetContent(), uri -> {
        if (uri != null) recognize(uri);
        else failPending("No image");
      });

  private final ActivityResultLauncher<String[]> pickFile =
      registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> {
        if (uri == null) {
          failPending("Cancelled");
          return;
        }
        io.execute(() -> {
          try {
            java.io.InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) throw new Exception("Could not open file");
            byte[] bytes = NativeIo.readAll(in);
            JSONObject out = new JSONObject();
            out.put("name", nameFromUri(uri));
            out.put("text", new String(bytes, StandardCharsets.UTF_8));
            router.resolve(pendingJsId, out);
          } catch (Exception e) {
            failPending(e.getMessage());
          }
        });
      });

  private final ActivityResultLauncher<String> createFile =
      registerForActivityResult(new ActivityResultContracts.CreateDocument("application/octet-stream"), uri -> {
        if (uri == null) {
          failPending("Cancelled");
          return;
        }
        io.execute(() -> {
          try {
            String text = pendingSaveText == null ? "" : pendingSaveText;
            java.io.OutputStream os = getContentResolver().openOutputStream(uri);
            if (os == null) throw new Exception("Could not write file");
            os.write(text.getBytes(StandardCharsets.UTF_8));
            os.close();
            router.resolve(pendingJsId, new JSONObject().put("ok", true));
          } catch (Exception e) {
            failPending(e.getMessage());
          }
        });
      });

  protected boolean isStrip() {
    return false;
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    if (!isStrip()) SplashScreen.installSplashScreen(this);
    super.onCreate(savedInstanceState);
    if (!isStrip()) {
      EdgeToEdge.enable(
          this,
          SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
          SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT));
    }
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    bars.setAppearanceLightStatusBars(true);
    bars.setAppearanceLightNavigationBars(true);
    setContentView(isStrip() ? R.layout.activity_strip : R.layout.activity_main);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    if (!isStrip()) {
      getWindow().setSoftInputMode(
          WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN);
    }
    if (isStrip()) {
      Window w = getWindow();
      w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, (int) (getResources().getDisplayMetrics().heightPixels * 0.68f));
      w.setGravity(Gravity.BOTTOM);
    }
    captureIncoming(getIntent());
    Notify.ensureChannels(this);

    assets = WebViews.assets(this);
    web = findViewById(R.id.webview);
    web.setFitsSystemWindows(false);
    WebViews.bind(web, assets, this, isStrip(), () -> {
      pageReady = true;
      pushInsets();
      if (pendingText != null) injectIncoming();
    });

    View root = findViewById(R.id.root);
    if (root != null && !isStrip()) {
      ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
        lastInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars());
        v.setPadding(0, 0, 0, 0);
        if (web != null) web.setPadding(0, 0, 0, 0);
        pushInsets();
        return WindowInsetsCompat.CONSUMED;
      });
    }
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    captureIncoming(intent);
    if (pageReady && pendingText != null) injectIncoming();
  }

  @Override
  public void handleJs(String method, String id, String paramsJson) {
    router.handle(method, id, paramsJson);
  }

  @Override
  public Context context() {
    return getApplicationContext();
  }

  @Override
  public Activity activity() {
    return this;
  }

  @Override
  public WebView web() {
    return web;
  }

  @Override
  public ExecutorService io() {
    return io;
  }

  @Override
  public void runUi(Runnable r) {
    runOnUiThread(r);
  }

  @Override
  public String takePendingText() {
    String t = pendingText;
    pendingText = null;
    return t;
  }

  @Override
  public String takePendingOrigin() {
    String o = pendingOrigin;
    pendingOrigin = null;
    return o;
  }

  @Override
  public void setPendingJsId(String id) {
    pendingJsId = id;
  }

  @Override
  public String pendingJsId() {
    return pendingJsId;
  }

  @Override
  public void setPendingSaveText(String text) {
    pendingSaveText = text;
  }

  @Override
  public String pendingSaveText() {
    return pendingSaveText;
  }

  @Override
  public void chooseOcr() {
    boolean camera = hasImageCapture();
    CharSequence[] items = camera ? new CharSequence[] {"Camera", "Photo"} : new CharSequence[] {"Photo"};
    new AlertDialog.Builder(this)
        .setTitle("Scan text")
        .setItems(items, (d, which) -> {
          if (camera && which == 0) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
              takePhoto();
            } else cameraPerm.launch(Manifest.permission.CAMERA);
          } else {
            pickVisual.launch("image/*");
          }
        })
        .setOnCancelListener(d -> failPending("Cancelled"))
        .show();
  }

  @Override
  public void launchPickFile() {
    pickFile.launch(new String[] {"*/*"});
  }

  @Override
  public void launchSaveFile(String name) {
    createFile.launch(name == null || name.isEmpty() ? "phevere.txt" : name);
  }

  @Override
  public void closeStrip() {
    /* full app */
  }

  @Override
  public void expandToFullApp(String query) {
    /* already full */
  }

  @Override
  public void requestOverlayPermission() {
    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
  }

  @Override
  public void requestNotifications() {
    if (Build.VERSION.SDK_INT >= 33
        && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
      notifyPerm.launch(Manifest.permission.POST_NOTIFICATIONS);
      return;
    }
    Notify.openSettings(this);
  }

  @Override
  public void openNotificationSettings() {
    Notify.openSettings(this);
  }

  private void captureIncoming(Intent intent) {
    if (intent == null) return;
    CharSequence extra = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
    if (extra == null || extra.length() == 0) {
      extra = intent.getStringExtra(CapturePrefs.EXTRA_QUERY);
    }
    if (extra == null || extra.length() == 0) return;
    pendingText = extra.toString().trim();
    pendingOrigin = "process-text";
    intent.removeExtra(Intent.EXTRA_PROCESS_TEXT);
    intent.removeExtra(CapturePrefs.EXTRA_QUERY);
  }

  private void injectIncoming() {
    if (web == null || pendingText == null) return;
    String js = "window.__pvIncoming && window.__pvIncoming("
        + JSONObject.quote(pendingText) + "," + JSONObject.quote(pendingOrigin == null ? "process-text" : pendingOrigin) + ")";
    web.evaluateJavascript(js, null);
    pendingText = null;
  }

  private void pushInsets() {
    int top = 0, bottom = 0, left = 0, right = 0;
    if (lastInsets != null) {
      top = lastInsets.top;
      bottom = lastInsets.bottom;
      left = lastInsets.left;
      right = lastInsets.right;
    }
    if (isStrip()) {
      top = 0;
      bottom = 0;
    }
    String js = "window.__pvInsets={top:" + top + ",bottom:" + bottom + ",left:" + left + ",right:" + right
        + "};window.document.documentElement.style.setProperty('--pv-inset-top','" + top
        + "px');window.document.documentElement.style.setProperty('--pv-inset-bottom','" + bottom + "px');";
    if (web != null) web.evaluateJavascript(js, null);
  }

  private boolean hasImageCapture() {
    return new Intent(MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(getPackageManager()) != null;
  }

  private void takePhoto() {
    if (!hasImageCapture()) {
      pickVisual.launch("image/*");
      return;
    }
    try {
      File pic = new File(getCacheDir(), "ocr.jpg");
      captureUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", pic);
      takePicture.launch(captureUri);
    } catch (Exception e) {
      String m = e.getMessage() == null ? "" : e.getMessage();
      if (e instanceof ActivityNotFoundException || m.contains("No Activity")) {
        pickVisual.launch("image/*");
        return;
      }
      failPending(m.isEmpty() ? "Camera failed" : m);
    }
  }

  private Bitmap decodeBitmap(Uri uri) throws Exception {
    if (Build.VERSION.SDK_INT >= 28) {
      return ImageDecoder.decodeBitmap(ImageDecoder.createSource(getContentResolver(), uri), (decoder, info, src) -> {
        decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
        decoder.setMutableRequired(true);
      });
    }
    return MediaStore.Images.Media.getBitmap(getContentResolver(), uri);
  }

  private void recognize(Uri uri) {
    io.execute(() -> {
      try {
        Bitmap bmp = Ocr.fit(Ocr.software(decodeBitmap(uri)), 1600);
        if (bmp == null) throw new Exception("Could not read image");
        InputImage image = InputImage.fromBitmap(bmp, 0);
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            .process(image)
            .addOnSuccessListener(latin ->
                TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build())
                    .process(image)
                    .addOnSuccessListener(zh -> succeedScan(bmp, latin, zh))
                    .addOnFailureListener(err -> succeedScan(bmp, latin, null)))
            .addOnFailureListener(err -> failPending(err.getMessage()));
      } catch (Exception e) {
        failPending(e.getMessage());
      }
    });
  }

  private void succeedScan(android.graphics.Bitmap bmp, com.google.mlkit.vision.text.Text latin, com.google.mlkit.vision.text.Text zh) {
    try {
      JSONArray words = new JSONArray();
      Ocr.addWords(words, latin, bmp.getWidth(), bmp.getHeight());
      Ocr.addWords(words, zh, bmp.getWidth(), bmp.getHeight());
      router.resolve(pendingJsId, Ocr.pack(bmp, words));
    } catch (Exception e) {
      failPending(e.getMessage());
    }
  }

  private void failPending(String msg) {
    router.fail(pendingJsId, msg);
    pendingJsId = null;
  }

  private String nameFromUri(Uri uri) {
    String path = uri.getLastPathSegment();
    return path == null ? "file" : path;
  }

  @Override
  protected void onDestroy() {
    io.shutdownNow();
    super.onDestroy();
  }
}
