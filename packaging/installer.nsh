; Custom NSIS macros for Phevere (electron-builder / forge-maker-nsis)
; Enables a multi-page, chooser-style installer (directory, shortcuts, finish).

!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Phevere Setup"
  !define MUI_WELCOMEPAGE_TEXT "Phevere is a select-to-lookup dictionary for Windows.$\r$\n$\r$\nThis wizard will install the app, local vocabulary notebook, and offline dictionary runtime (SQLite via sql.js).$\r$\n$\r$\nClick Next to continue."
  !define MUI_FINISHPAGE_TITLE "Phevere is ready"
  !define MUI_FINISHPAGE_TEXT "Installation finished. You can start Phevere now or later from the Start menu / desktop shortcut."
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Phevere"
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInstallMode
  ; Prefer assisted install so users can pick directory / per-machine like desktop apps.
!macroend

!macro customInstall
  ; Ensure seed directory exists for optional offline dictionary packs.
  CreateDirectory "$INSTDIR\resources\seed"
!macroend
