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
Var nativeInstallDirectory
Var hasNativeDirectory

Function .onInit
  ; NSIS consumes its native final /D= argument before FileFunc sees $CMDLINE.
  ; Save the parsed directory and detect the switch in the raw Windows command.
  StrCpy $nativeInstallDirectory $INSTDIR
  System::Call 'kernel32::GetCommandLineW() w .r0'
  StrCpy $hasNativeDirectory "0"
  StrCpy $1 0 ; character offset
  StrCpy $4 0 ; inside quoted executable/argument
  pvScanNativeDirectory:
    StrCpy $2 $0 1 $1
    ${If} $2 == ""
      Return
    ${EndIf}
    ${If} $2 == '"'
      IntOp $4 $4 ^ 1
    ${ElseIf} $4 == 0
      ${If} $2 == " "
      ${OrIf} $2 == "$\t"
        IntOp $3 $1 + 1
        StrCpy $3 $0 3 $3
        StrCmpS $3 "/D=" pvFoundNativeDirectory
      ${EndIf}
    ${EndIf}
    IntOp $1 $1 + 1
    Goto pvScanNativeDirectory
  pvFoundNativeDirectory:
    StrCpy $hasNativeDirectory "1"
FunctionEnd

Function runBackendAndWait
  ; ExecShellWait waits but does not return a process exit code. Keep the
  ; ShellExecuteEx process handle and read the code after that process exits.
  !if ${NSIS_PTR_SIZE} > 4
    !define /math PV_SHELLEXECUTEINFO_SIZE 14 * ${NSIS_PTR_SIZE}
  !else
    !define PV_SHELLEXECUTEINFO_SIZE 60
  !endif
  System::Call '*(&i${PV_SHELLEXECUTEINFO_SIZE}) p .r0'
  System::Call '*$0(i ${PV_SHELLEXECUTEINFO_SIZE}, i 0x40, p 0, w "runas", w "$PLUGINSDIR\Backend.exe", w "$parameters", p 0, i 0)'
  System::Call 'shell32::ShellExecuteExW(p r0) i .r1 ?e'
  Pop $2
  ${If} $1 == 0
    System::Free $0
    SetErrors
    Return
  ${EndIf}
  System::Call '*$0(i, i, p, p, p, p, p, i, p, p, p, p, i, p, p .r1)'
  System::Free $0
  ${If} $1 == 0
    SetErrors
    Return
  ${EndIf}
  System::Call 'kernel32::WaitForSingleObject(p r1, i -1) i .r2'
  ${If} $2 != 0
    System::Call 'kernel32::CloseHandle(p r1)'
    SetErrors
    Return
  ${EndIf}
  System::Call 'kernel32::GetExitCodeProcess(p r1, *i .r2) i .r3'
  System::Call 'kernel32::CloseHandle(p r1)'
  ${If} $3 == 0
    SetErrors
  ${Else}
    StrCpy $exitCode $2
  ${EndIf}
FunctionEnd

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
  ${If} $hasNativeDirectory == "1"
    StrCpy $parameters "$parameters /D=$nativeInstallDirectory"
  ${EndIf}
  ClearErrors
  ${GetOptions} $parameters "/S" $0
  ${IfNot} ${Errors}
    ; Keep /D= with spaces at the end, where the backend's native parser expects it.
    ClearErrors
    Call runBackendAndWait
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
