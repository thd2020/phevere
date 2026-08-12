; Custom NSIS macros for Phevere (electron-builder / forge-maker-nsis)
; - Default path: Program Files\Phevere (menuCategory false — no author parent folder)
; - Single Setup.exe bundles everything (incl. OCR models via extraResources)
; - Components page: shortcuts + optional OCR (unchecked = remove models after copy)
; - Publisher: thd2020
;
; Note: do not use MUI_FUNCTION_DESCRIPTION_* here — include runs before MUI macros exist.

!include "LogicLib.nsh"

; --- Optional component sections (MUI components page) ---
Section "Desktop shortcut" SecDesktop
SectionEnd

Section "Start menu shortcut" SecStartMenu
SectionEnd

; OCR on by default (no /o). Models ship inside Setup; uncheck to omit from disk.
Section "OCR models (PP-OCRv4, ~15 MB)" SecOcr
SectionEnd

!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Phevere"
  !define MUI_WELCOMEPAGE_TEXT "Select-to-lookup dictionary for Windows.$\r$\n$\r$\nPublisher: thd2020$\r$\n$\r$\nThis single installer includes the app and optional OCR models. Choose folder and components on the next pages."
  !define MUI_FINISHPAGE_TITLE "Phevere is ready"
  !define MUI_FINISHPAGE_TEXT "Installation finished. Launch Phevere now, or open it from the Start menu / desktop."
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Phevere"
  !define MUI_COMPONENTSPAGE_NODESC
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  !insertmacro MUI_PAGE_COMPONENTS
!macroend

!macro customFinishPage
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro preInit
  ; First-run default locations (no author\Phevere parent).
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\Phevere"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\Phevere"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES\Phevere"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\Phevere"
!macroend

!macro customInstall
  CreateDirectory "$INSTDIR\resources\seed"

  ; Shortcuts — createDesktopShortcut / createStartMenuShortcut are off; honor checkboxes.
  ${If} ${SectionIsSelected} ${SecDesktop}
    CreateShortCut "$DESKTOP\Phevere.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}

  ${If} ${SectionIsSelected} ${SecStartMenu}
    CreateShortCut "$SMPROGRAMS\Phevere.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}

  ; OCR models are always packed in Setup (extraResources). If user opts out, remove after extract.
  ${IfNot} ${SectionIsSelected} ${SecOcr}
    DetailPrint "Skipping OCR models (component unchecked)"
    RMDir /r "$INSTDIR\resources\ocr-models"
  ${EndIf}
!macroend
