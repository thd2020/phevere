; Custom NSIS macros for Phevere (electron-builder / forge-maker-nsis)
; - One-page installer UI (installer-pages.nsh): Install page with Custom options,
;   progress, finish. Replaces the welcome, licence, folder and components pages.
; - Default path: Program Files\Phevere (menuCategory false — no author parent folder)
; - Setup.exe carries the app without OCR models; the app downloads the OCR pack.
;   Models an older installer left in resources\ocr-models survive the upgrade
;   (PV_KEEP_OCR_MODELS / PV_RESTORE_OCR_MODELS).
; - Custom options: shortcuts (the WPF frontend passes them as switches)
; - Explicit Uninstall Start Menu link + reinforced Apps & Features registry
; - Publisher: thd2020
; - InstFiles page lists what is copying (compiler ShowInstDetails show here;
;   SetDetailsPrint both via scripts/patch-nsis-details-print.js). Do not put
;   ShowInstDetails inside Function/Section — makensis rejects it.
;
; Note: do not use MUI_FUNCTION_DESCRIPTION_* here — include runs before MUI macros exist.

!include "LogicLib.nsh"

Var pvNativeInstallDirectory
Var pvKeptOcrModels

!macro preInit
  ; NSIS reads its final, unquoted /D argument as one complete directory.
  ; electron-builder later reparses it through StdUtils, which splits spaces.
  ; Preserve the native value before that install-mode initialization runs.
  StrCpy $pvNativeInstallDirectory $INSTDIR
!macroend

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

; Installers up to 3.0 put the PP-OCRv4 models in resources\ocr-models, and the
; app still loads them from there. During an upgrade electron-builder runs the old
; uninstaller, which deletes the whole install folder, and this package carries no
; models. Copy them aside before that and put them back after the new files.
!macro PV_KEEP_OCR_MODELS
  StrCpy $pvKeptOcrModels ""
  StrCpy $R2 "$INSTDIR"
  ${IfNot} ${FileExists} "$R2\resources\ocr-models\ch_PP-OCRv4_rec_infer.onnx"
    ; The new folder may differ from the old one; the old one is in the registry.
    ReadRegStr $R2 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $R2 != ""
  ${AndIf} ${FileExists} "$R2\resources\ocr-models\ch_PP-OCRv4_rec_infer.onnx"
    InitPluginsDir
    CreateDirectory "$PLUGINSDIR\kept-ocr-models"
    ClearErrors
    CopyFiles /SILENT "$R2\resources\ocr-models\*.*" "$PLUGINSDIR\kept-ocr-models"
    ${IfNot} ${Errors}
      StrCpy $pvKeptOcrModels "$PLUGINSDIR\kept-ocr-models"
    ${EndIf}
  ${EndIf}
!macroend

!macro PV_RESTORE_OCR_MODELS
  ${If} $pvKeptOcrModels != ""
  ${AndIfNot} ${FileExists} "$INSTDIR\resources\ocr-models\ch_PP-OCRv4_rec_infer.onnx"
    DetailPrint "Keeping the OCR models from the previous version..."
    CreateDirectory "$INSTDIR\resources\ocr-models"
    CopyFiles /SILENT "$pvKeptOcrModels\*.*" "$INSTDIR\resources\ocr-models"
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
    ${If} $R0 == "1"
      SectionSetFlags ${SECTION} ${SF_SELECTED}
    ${ElseIf} $R0 == "0"
      SectionSetFlags ${SECTION} 0
    ${Else}
      SetErrorLevel 2
      Abort "Invalid ${OPTION} value. Expected 0 or 1."
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  SetDetailsPrint both
  ${StdUtils.GetParameter} $R0 "D" ""
  ${If} $R0 != ""
    StrCpy $INSTDIR $pvNativeInstallDirectory
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro PV_RESTORE_COMPONENT ${SecDesktop} DesktopShortcut "$DESKTOP\Phevere.lnk"
    !insertmacro PV_RESTORE_COMPONENT ${SecStartMenu} StartMenuShortcut "$SMPROGRAMS\Phevere.lnk"
  ${EndIf}
  !insertmacro PV_KEEP_OCR_MODELS
  ; The WPF frontend sends explicit choices to the silent backend. A plain /S
  ; upgrade omits these switches and retains the saved or inferred choices.
  ${GetParameters} $R1
  !insertmacro PV_COMPONENT_ARGUMENT ${SecDesktop} --desktop-shortcut
  !insertmacro PV_COMPONENT_ARGUMENT ${SecStartMenu} --start-menu-shortcut
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
  !insertmacro PV_RESTORE_OCR_MODELS

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
  ; The frontend owns this current-user startup value. Remove only our exact
  ; executable on a normal uninstall; replacement installs retain it.
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${isKeepShortcuts}
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Phevere"
    ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Phevere"
    ${EndIf}
  ${EndIf}

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
