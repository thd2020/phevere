; Custom NSIS macros for Phevere (electron-builder / forge-maker-nsis)
; - One-page installer UI (installer-pages.nsh): Install page with Custom options,
;   progress, finish. Replaces the welcome, licence, folder and components pages.
; - Default path: Program Files\Phevere (menuCategory false — no author parent folder)
; - Single Setup.exe bundles everything (incl. OCR models via extraResources)
; - Custom options: shortcuts + optional OCR (unchecked = remove models after copy)
; - Explicit Uninstall Start Menu link + reinforced Apps & Features registry
; - Publisher: thd2020
; - InstFiles page lists what is copying (compiler ShowInstDetails show here;
;   SetDetailsPrint both via scripts/patch-nsis-details-print.js). Do not put
;   ShowInstDetails inside Function/Section — makensis rejects it.
;
; Note: do not use MUI_FUNCTION_DESCRIPTION_* here — include runs before MUI macros exist.

!include "LogicLib.nsh"

SetFont "Segoe UI" 10
ManifestDPIAware true
ManifestDPIAwareness "PerMonitorV2"
XPStyle on
ShowInstDetails show
ShowUninstDetails show
BrandingText " "

; --- Optional component sections (MUI components page) ---
Section "Desktop shortcut" SecDesktop
SectionEnd

Section "Start menu shortcut" SecStartMenu
SectionEnd

; OCR on by default (no /o). Models ship inside Setup; uncheck to omit from disk.
Section "OCR models (PP-OCRv4, ~15 MB)" SecOcr
SectionEnd

!include "${BUILD_RESOURCES_DIR}\installer-pages.nsh"

Function phevereOnGuiInit
  ; HALFTONE so 2× sidebar/header BMPs are not nearest-neighbor when DPI stretches the pane.
  System::Call 'user32::GetDC(p $HWNDPARENT) p .r0'
  System::Call 'gdi32::SetStretchBltMode(p r0, i 4)'
  System::Call 'gdi32::SetBrushOrgEx(p r0, i 0, i 0, p 0)'
  System::Call 'user32::ReleaseDC(p $HWNDPARENT, p r0) i .n'
FunctionEnd

!macro customHeader
  ; electron-builder already !define's MUI_BGCOLOR (MUI default). /redef keeps the paper colour.
  !define /redef MUI_BGCOLOR F4F0EA
  !define /redef MUI_TEXTCOLOR 1C1917
  !define /redef MUI_INSTFILESPAGE_COLORS "1C1917 F4F0EA"
  ; 2× BMPs fill the DPI-scaled control (NOSTRETCH left a tiny/pixelated 1× blit on Win11).
  !define /redef MUI_CUSTOMFUNCTION_GUIINIT phevereOnGuiInit
!macroend

!macro customWelcomePage
  !insertmacro PV_PAGE_FUNCTIONS
  Page custom pvInstallPage
!macroend

; Applies to the progress page electron-builder inserts next.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW pvInstFilesShow
!macroend

!macro customFinishPage
  Page custom pvFinishPage
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


!macro customInit
  SetDetailsPrint both
!macroend

!macro customInstall
  SetDetailsPrint both
  CreateDirectory "$INSTDIR\resources\seed"

  ; Shortcuts — createDesktopShortcut / createStartMenuShortcut are off; honor checkboxes.
  ${If} ${SectionIsSelected} ${SecDesktop}
    DetailPrint "Creating desktop shortcut..."
    CreateShortCut "$DESKTOP\Phevere.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${Else}
    DetailPrint "Skipping desktop shortcut"
  ${EndIf}

  ${If} ${SectionIsSelected} ${SecStartMenu}
    DetailPrint "Creating Start menu shortcuts (Phevere + Uninstall)..."
    CreateShortCut "$SMPROGRAMS\Phevere.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    ; Explicit uninstall entry next to the app (Control Panel also lists it via registry).
    CreateShortCut "$SMPROGRAMS\Uninstall Phevere.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
  ${Else}
    DetailPrint "Skipping Start menu shortcuts"
  ${EndIf}

  ; OCR models are always packed in Setup (extraResources). If user opts out, remove after extract.
  ${IfNot} ${SectionIsSelected} ${SecOcr}
    DetailPrint "Removing OCR models (you unchecked that component)..."
    RMDir /r "$INSTDIR\resources\ocr-models"
  ${Else}
    DetailPrint "Keeping bundled PP-OCRv4 models in resources\ocr-models"
  ${EndIf}

  ; Belt-and-suspenders: ensure Apps & Features can see Phevere even if SHELL_CONTEXT was odd.
  ; electron-builder already wrote SHELL_CONTEXT; mirror Publisher/DisplayName for the active install.
  DetailPrint "Registering Apps & Features uninstaller..."
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
  DetailPrint "Phevere ${VERSION} is installed in $INSTDIR"
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
