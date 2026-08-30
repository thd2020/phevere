package com.phevere.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ProcessText")
public class ProcessTextPlugin extends Plugin {
  private String pending;

  @Override
  public void load() {
    capture(getActivity() != null ? getActivity().getIntent() : null);
  }

  @Override
  protected void handleOnNewIntent(Intent intent) {
    capture(intent);
  }

  @Override
  protected void handleOnResume() {
    if (getActivity() != null) {
      capture(getActivity().getIntent());
    }
  }

  private void capture(Intent intent) {
    if (intent == null) return;
    CharSequence extra = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
    if (extra == null || extra.length() == 0) return;
    pending = extra.toString().trim();
    intent.removeExtra(Intent.EXTRA_PROCESS_TEXT);
  }

  @PluginMethod
  public void getPendingText(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("text", pending);
    pending = null;
    call.resolve(ret);
  }
}
