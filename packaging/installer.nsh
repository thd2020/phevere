; Custom NSIS macros for Phevere (electron-builder / forge-maker-nsis)
; - Default path: Program Files\Phevere (menuCategory false — no author parent folder)
; - Single Setup.exe bundles everything (incl. OCR models via extraResources)
; - Components page: shortcuts + optional OCR (unchecked = remove models after copy)
; - Explicit Uninstall Start Menu link + reinforced Apps & Features registry
; - Publisher: thd2020
; - Win11-era chrome: Segoe UI + Per-Monitor v2 DPI (avoids XP-grey / blurry glyphs)
;
; Note: do not use MUI_FUNCTION_DESCRIPTION_* here — include runs before MUI macros exist.

!include "LogicLib.nsh"

SetFont "Segoe UI" 9
ManifestDPIAware true
ManifestDPIAwareness "PerMonitorV2"
XPStyle on

; --- Optional component sections (MUI components page) ---
Section "Desktop shortcut" SecDesktop
SectionEnd

Section "Start menu shortcut" SecStartMenu
SectionEnd

; OCR on by default (no /o). Models ship inside Setup; uncheck to omit from disk.
Section "OCR models (PP-OCRv4, ~15 MB)" SecOcr
SectionEnd

!macro customHeader
  ; electron-builder already !define's MUI_BGCOLOR (MUI default). /redef keeps Win11 paper without aborting makensis.
  !define /redef MUI_BGCOLOR F3F3F3
  !define /redef MUI_TEXTCOLOR 1A1A1A
  !define /redef MUI_INSTFILESPAGE_COLORS "1A1A1A F3F3F3"
  ; Per-Monitor v2 otherwise stretches 164×314 / 150×57 bitmaps → blur and warp.
  !define MUI_HEADERIMAGE_BITMAP_NOSTRETCH
  !define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
  !define MUI_UNWELCOMEFINISHPAGE_BITMAP_NOSTRETCH
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Phevere"
  !define MUI_WELCOMEPAGE_TEXT "Select-to-lookup dictionary for Windows.$\r$\n$\r$\nPublisher: thd2020$\r$\n$\r$\nThis single installer includes the app, OCR models, and a Control Panel uninstaller. Choose folder and components on the next pages.$\r$\n$\r$\nIf an older Phevere folder is stuck in Program Files with no Apps entry, run scripts\remove-ghost-phevere.ps1 from the repo (or reinstall over it)."
  !define MUI_FINISHPAGE_TITLE "Phevere is ready"
  !define MUI_FINISHPAGE_TEXT "Installation finished.$\r$\n$\r$\nTo remove Phevere later: Start menu → Uninstall Phevere, or Windows Settings → Apps → Phevere."
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
  ; Seed default InstallLocation only when no prior install is recorded.
  ; Writing both hives unconditionally left "ghost" InstallLocation keys without a real uninstaller.
  SetRegView 64
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 == ""
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\Phevere"
  ${EndIf}
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 == ""
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\Phevere"
  ${EndIf}
  SetRegView 32
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 == ""
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES\Phevere"
  ${EndIf}
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 == ""
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\Phevere"
  ${EndIf}
!macroend

!macro customInstall
  CreateDirectory "$INSTDIR\resources\seed"

  ; Shortcuts — createDesktopShortcut / createStartMenuShortcut are off; honor checkboxes.
  ${If} ${SectionIsSelected} ${SecDesktop}
    CreateShortCut "$DESKTOP\Phevere.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}

  ${If} ${SectionIsSelected} ${SecStartMenu}
    CreateShortCut "$SMPROGRAMS\Phevere.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    ; Explicit uninstall entry next to the app (Control Panel also lists it via registry).
    CreateShortCut "$SMPROGRAMS\Uninstall Phevere.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
  ${EndIf}

  ; OCR models are always packed in Setup (extraResources). If user opts out, remove after extract.
  ${IfNot} ${SectionIsSelected} ${SecOcr}
    DetailPrint "Skipping OCR models (component unchecked)"
    RMDir /r "$INSTDIR\resources\ocr-models"
  ${EndIf}

  ; Belt-and-suspenders: ensure Apps & Features can see Phevere even if SHELL_CONTEXT was odd.
  ; electron-builder already wrote SHELL_CONTEXT; mirror Publisher/DisplayName for the active install.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayName "${UNINSTALL_DISPLAY_NAME}"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" Publisher "thd2020"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion "${VERSION}"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  StrCpy $R7 "$INSTDIR\${UNINSTALL_FILENAME}"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$R7"'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$R7" /S'
  ${If} ${FileExists} "$INSTDIR\uninstallerIcon.ico"
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayIcon "$INSTDIR\uninstallerIcon.ico"
  ${Else}
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayIcon "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  ${EndIf}
  WriteRegDWORD SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" NoModify 1
  WriteRegDWORD SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" NoRepair 1
!macroend

!macro customUnInstall
  ; Remove Start Menu / desktop shortcuts we created (in case electron-builder keepShortcuts skipped them).
  Delete "$DESKTOP\Phevere.lnk"
  Delete "$SMPROGRAMS\Phevere.lnk"
  Delete "$SMPROGRAMS\Uninstall Phevere.lnk"

  ; Clean legacy author-folder Start Menu leftovers from older builds.
  RMDir /r "$SMPROGRAMS\thd2020"
  RMDir /r "$SMPROGRAMS\xiangyuxiao"
!macroend
