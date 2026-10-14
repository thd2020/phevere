; The WPF frontend owns interactive setup. electron-builder's NSIS installer
; remains the elevated installation and upgrade backend.
Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Name "Phevere Setup"
OutFile "${OUTPUT_FILE}"
Icon "${INSTALLER_ICON}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
SetCompressor lzma
SetCompressorDictSize 64
VIProductVersion "${VERSION_QUAD}"
VIAddVersionKey /LANG=1033 "ProductName" "Phevere"
VIAddVersionKey /LANG=1033 "FileDescription" "Phevere Installer"
VIAddVersionKey /LANG=1033 "CompanyName" "thd2020"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright © 2026 thd2020"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
Var parameters
Var exitCode
Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  ; The backend is already compressed. Store it directly so setup can open
  ; without decompressing a second copy of the full application payload.
  SetCompress off
  File /oname=Backend.exe "${BACKEND_FILE}"
  SetCompress auto
  File /oname=InstallerUi.exe "${UI_FILE}"
  File /oname=InstallerUi.exe.config "${UI_CONFIG}"
  File /oname=icon.ico "${INSTALLER_ICON}"
  File /oname=hero.bmp "${UI_ART}"
  SetOutPath "$PLUGINSDIR\fonts"
  File "${UI_FONTS}\*.ttf"
  File "${UI_FONTS}\LICENSE.txt"
  SetOutPath "$PLUGINSDIR"
  ${GetParameters} $parameters
  ClearErrors
  ${GetOptions} $parameters "/S" $0
  ${IfNot} ${Errors}
    ; Keep the original parameters intact, including /D= with spaces at the end.
    ClearErrors
    ExecShellWait "runas" "$PLUGINSDIR\Backend.exe" "$parameters" SW_HIDE $exitCode
  ${Else}
    ClearErrors
    ExecWait '"$PLUGINSDIR\InstallerUi.exe" --backend "$PLUGINSDIR\Backend.exe" --version "${APP_VERSION}" --arch "${APP_ARCH}"' $exitCode
  ${EndIf}
  ${If} ${Errors}
    SetErrorLevel 1
  ${Else}
    SetErrorLevel $exitCode
  ${EndIf}
SectionEnd
