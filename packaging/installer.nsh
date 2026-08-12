; Custom NSIS macros for Phevere (electron-builder / forge-maker-nsis)
; - Default path: Program Files\Phevere (menuCategory false — no author parent folder)
; - Optional components: shortcuts + OCR pack (sidecar zip keeps Setup lean)
; - Branding copy: publisher thd2020

!include "LogicLib.nsh"

; --- Optional component sections (MUI components page) ---
Section "Desktop shortcut" SecDesktop
SectionEnd

Section "Start menu shortcut" SecStartMenu
SectionEnd

Section /o "OCR models (PP-OCRv4, ~15 MB)" SecOcr
SectionEnd

LangString DESC_SecDesktop ${LANG_ENGLISH} "Create a Phevere shortcut on the desktop."
LangString DESC_SecStartMenu ${LANG_ENGLISH} "Add Phevere to the Start menu."
LangString DESC_SecOcr ${LANG_ENGLISH} "On-device OCR models. For a lean Setup, distribute Phevere-OCR-Models.zip next to the installer (or enable OCR later in Settings)."

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_SecDesktop)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartMenu} $(DESC_SecStartMenu)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecOcr} $(DESC_SecOcr)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Phevere"
  !define MUI_WELCOMEPAGE_TEXT "Select-to-lookup dictionary for Windows.$\r$\n$\r$\nPublisher: thd2020$\r$\n$\r$\nChoose the install folder and optional components (OCR, shortcuts) on the following pages."
  !define MUI_FINISHPAGE_TITLE "Phevere is ready"
  !define MUI_FINISHPAGE_TEXT "Installation finished. Launch Phevere now, or open it from the Start menu / desktop."
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Phevere"
  !define MUI_COMPONENTSPAGE_SMALLDESC
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

  ; OCR — optional. Prefer Phevere-OCR-Models.zip beside Setup.exe (de-bloated installer).
  ${If} ${SectionIsSelected} ${SecOcr}
    StrCpy $R9 ""
    ${If} ${FileExists} "$EXEDIR\Phevere-OCR-Models.zip"
      StrCpy $R9 "$EXEDIR\Phevere-OCR-Models.zip"
    ${ElseIf} ${FileExists} "$EXEDIR\optional\Phevere-OCR-Models.zip"
      StrCpy $R9 "$EXEDIR\optional\Phevere-OCR-Models.zip"
    ${EndIf}

    ${If} $R9 != ""
      CreateDirectory "$INSTDIR\resources"
      DetailPrint "Installing OCR models from $R9"
      nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath ''$R9'' -DestinationPath ''$INSTDIR\resources'' -Force"'
    ${Else}
      DetailPrint "OCR pack not found next to the installer. Enable OCR later in Settings."
      CreateDirectory "$INSTDIR\resources"
      FileOpen $R8 "$INSTDIR\resources\ocr-install-later.flag" w
      FileWrite $R8 "pending"
      FileClose $R8
    ${EndIf}
  ${EndIf}
!macroend
