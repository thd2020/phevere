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

; electron-builder selects a recorded install path and supplies the default path
; when none exists. Do not write registry keys until installation succeeds.

!macro PV_RESTORE_COMPONENT SECTION VALUE EXISTS
  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "${VALUE}"
  ${If} $R0 == ""
    ; Older installers did not record component choices. Infer their on-disk state
    ; before uninstallOldVersion removes the old installation.
    ${If} ${FileExists} "${EXISTS}"
      StrCpy $R0 "1"
    ${Else}
      StrCpy $R0 "0"
    ${EndIf}
  ${EndIf}
  ${If} $R0 == "1"
    SectionSetFlags ${SECTION} ${SF_SELECTED}
  ${Else}
    SectionSetFlags ${SECTION} 0
  ${EndIf}
!macroend

!macro PV_STORE_COMPONENT SECTION VALUE
  ${If} ${SectionIsSelected} ${SECTION}
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "${VALUE}" "1"
  ${Else}
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "${VALUE}" "0"
  ${EndIf}
!macroend

!macro PV_COMPONENT_ARGUMENT SECTION OPTION
  ClearErrors
  ${GetOptions} $R1 "${OPTION}=" $R0
  ${IfNot} ${Errors}
    ; GetOptions uses the option's leading '-' as its delimiter. The final
    ; --ocr-models value therefore includes the trailing /D= path from the
    ; frontend. Read one strict 0/1 token and reject longer numeric/text values.
    StrCpy $R2 $R0 1
    StrCpy $R3 $R0 1 1
    ${If} $R3 != ""
    ${AndIf} $R3 != " "
      SetErrorLevel 2
      Abort "Invalid ${OPTION} value. Expected 0 or 1."
    ${EndIf}
    ${If} $R2 == "1"
      SectionSetFlags ${SECTION} ${SF_SELECTED}
    ${ElseIf} $R2 == "0"
      SectionSetFlags ${SECTION} 0
    ${Else}
      SetErrorLevel 2
      Abort "Invalid ${OPTION} value. Expected 0 or 1."
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  SetDetailsPrint both
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro PV_RESTORE_COMPONENT ${SecDesktop} DesktopShortcut "$DESKTOP\Phevere.lnk"
    !insertmacro PV_RESTORE_COMPONENT ${SecStartMenu} StartMenuShortcut "$SMPROGRAMS\Phevere.lnk"
    !insertmacro PV_RESTORE_COMPONENT ${SecOcr} OcrModels "$INSTDIR\resources\ocr-models\*.*"
  ${EndIf}
  ; The WPF frontend sends explicit choices to the silent backend. A plain /S
  ; upgrade omits these switches and retains the saved or inferred choices.
  ${GetParameters} $R1
  !insertmacro PV_COMPONENT_ARGUMENT ${SecDesktop} --desktop-shortcut
  !insertmacro PV_COMPONENT_ARGUMENT ${SecStartMenu} --start-menu-shortcut
  !insertmacro PV_COMPONENT_ARGUMENT ${SecOcr} --ocr-models
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
    Delete "$DESKTOP\Phevere.lnk"
  ${EndIf}

  ${If} ${SectionIsSelected} ${SecStartMenu}
    DetailPrint "Creating Start menu shortcuts (Phevere + Uninstall)..."
    CreateShortCut "$SMPROGRAMS\Phevere.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    ; Explicit uninstall entry next to the app (Control Panel also lists it via registry).
    CreateShortCut "$SMPROGRAMS\Uninstall Phevere.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
  ${Else}
    DetailPrint "Skipping Start menu shortcuts"
    Delete "$SMPROGRAMS\Phevere.lnk"
    Delete "$SMPROGRAMS\Uninstall Phevere.lnk"
  ${EndIf}

  !insertmacro PV_STORE_COMPONENT ${SecDesktop} DesktopShortcut
  !insertmacro PV_STORE_COMPONENT ${SecStartMenu} StartMenuShortcut
  !insertmacro PV_STORE_COMPONENT ${SecOcr} OcrModels

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
  ; Updates pass --keep-shortcuts. Preserve existing choices until the new
  ; install applies its selected components; normal uninstall removes them.
  ${IfNot} ${isKeepShortcuts}
    Delete "$DESKTOP\Phevere.lnk"
    Delete "$SMPROGRAMS\Phevere.lnk"
    Delete "$SMPROGRAMS\Uninstall Phevere.lnk"
  ${EndIf}

  ; Clean legacy author-folder Start Menu leftovers from older builds.
  RMDir /r "$SMPROGRAMS\thd2020"
  RMDir /r "$SMPROGRAMS\xiangyuxiao"
!macroend
