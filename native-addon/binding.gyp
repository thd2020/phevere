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
    }
  ]
}
