{
  "targets": [
    {
      "target_name": "uiautomation_selection_monitor",
      "conditions": [
        ["OS=='win'", {
          "sources": [ "src/selection_monitor.cpp" ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "dependencies": [
            "<!(node -p \"require('node-addon-api').gyp\")"
          ],
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/EHsc" ]
            }
          },
          "libraries": [
            "-luser32.lib",
            "-lkernel32.lib",
            "-lole32.lib",
            "-loleaut32.lib",
            "-luuid.lib",
            "-lUIAutomationCore.lib"
          ]
        }, {
          "type": "none"
        }]
      ]
    },
    {
      "target_name": "ax_selection_monitor",
      "conditions": [
        ["OS=='mac'", {
          "sources": [ "src/ax_selection_monitor.mm" ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "dependencies": [
            "<!(node -p \"require('node-addon-api').gyp\")"
          ],
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
          "libraries": [
            "-framework AppKit",
            "-framework ApplicationServices",
            "-framework CoreFoundation"
          ],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CPLUSPLUSFLAGS": [ "-fobjc-arc" ]
          }
        }, {
          "type": "none"
        }]
      ]
    },
    {
      "target_name": "linux_selection_monitor",
      "conditions": [
        ["OS=='linux'", {
          "sources": [
            "src/linux_selection_monitor.cpp",
            "src/linux_wayland_primary.cpp",
            "src/linux_kwin_script.cpp",
            "src/wayland/ext-data-control-v1-protocol.c",
            "src/wayland/wlr-data-control-unstable-v1-protocol.c"
          ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "dependencies": [
            "<!(node -p \"require('node-addon-api').gyp\")"
          ],
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ],
          "cflags": [ "<!@(pkg-config --cflags atspi-2 gio-2.0 gio-unix-2.0 x11 xfixes wayland-client)" ],
          "cflags_cc": [
            "-std=c++17", "-fvisibility=hidden", "-fvisibility-inlines-hidden",
            "<!@(pkg-config --cflags atspi-2 gio-2.0 gio-unix-2.0 x11 xfixes wayland-client)"
          ],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
          "ldflags": [
            "-static-libstdc++", "-static-libgcc", "-Wl,--exclude-libs,ALL",
            "-Wl,--version-script,<(module_root_dir)/src/linux_exports.map"
          ],
          "libraries": [ "<!@(pkg-config --libs atspi-2 gio-2.0 gio-unix-2.0 x11 xfixes wayland-client)" ]
        }, {
          "type": "none"
        }]
      ]
    }
  ]
}
