; One-page installer UI for Phevere (included from installer.nsh).
;
; Install page: illustration, product name, one big Install button, the licence checkbox,
; and "Custom options" that swaps the illustration for the folder and optional parts.
; Installing: the same illustration with one progress bar and one status line.
; Finish: the illustration with an "Open Phevere" button and a Close link.
;
; Each page takes the whole window the way Modern UI's welcome page does: draw into the
; full-size placeholder 1044, hide the header, lines, branding and the Back/Next/Cancel row.
; The big buttons are bitmaps (native buttons cannot take the brand colour) that press
; the hidden Next button.
;
; Colours are the app's: paper F4F0EA, ink 1C1917, muted 5C534E, ember 9C3D00.

!ifndef BUILD_UNINSTALLER

!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; The progress page has no Next button; move to the finish page as soon as files are in.
AutoCloseWindow true

!define PV_PAPER "F4F0EA"
!define PV_INK "1C1917"
!define PV_MUTED "5C534E"
!define PV_EMBER "9C3D00"
!define PV_LICENSE_URL "https://github.com/thd2020/phevere/blob/main/LICENSE"

Var pvPage
Var pvHero
Var pvHeroBmp
Var pvBtn
Var pvBtnBmp
Var pvAgree
Var pvLicense
Var pvOptions
Var pvOptionsOpen
Var pvName
Var pvVersion
Var pvDirLabel
Var pvDir
Var pvBrowse
Var pvChkDesktop
Var pvChkStart
Var pvChkOcr
Var pvFontName
Var pvFontBody
Var pvFontLink
Var pvClose

; The functions are wrapped in a macro and inserted from customWelcomePage: electron-builder
; includes this file before its plug-ins (StdUtils) are registered, and the functions use them.
; Helpers used by the page functions below.
!macro PV_HIDE ID
  GetDlgItem $0 $HWNDPARENT ${ID}
  ShowWindow $0 ${SW_HIDE}
!macroend

!macro PV_SECTION CHECKBOX SECTION
  ${NSD_GetState} ${CHECKBOX} $0
  ${If} $0 == ${BST_CHECKED}
    SectionSetFlags ${SECTION} ${SF_SELECTED}
  ${Else}
    SectionSetFlags ${SECTION} 0
  ${EndIf}
!macroend

!macro PV_LABEL VAR X Y W H TEXT FONT COLOR
  ${NSD_CreateLabel} ${X} ${Y} ${W} ${H} "${TEXT}"
  Pop ${VAR}
  SetCtlColors ${VAR} ${COLOR} ${PV_PAPER}
  SendMessage ${VAR} ${WM_SETFONT} ${FONT} 1
!macroend

!macro PV_CHECK VAR Y TEXT SECTION
  ${NSD_CreateCheckbox} 7% ${Y} 86% 8% "${TEXT}"
  Pop ${VAR}
  SetCtlColors ${VAR} ${PV_INK} ${PV_PAPER}
  SendMessage ${VAR} ${WM_SETFONT} $pvFontBody 1
  ${If} ${SectionIsSelected} ${SECTION}
    ${NSD_Check} ${VAR}
  ${EndIf}
!macroend

!macro PV_PAGE_FUNCTIONS

; ---------- window chrome ----------

Function pvLoadArt
  InitPluginsDir
  File /oname=$PLUGINSDIR\pvHero.bmp "${BUILD_RESOURCES_DIR}\installerHero.bmp"
  File /oname=$PLUGINSDIR\pvBtn.bmp "${BUILD_RESOURCES_DIR}\installerButton.bmp"
  File /oname=$PLUGINSDIR\pvBtnOff.bmp "${BUILD_RESOURCES_DIR}\installerButtonOff.bmp"
  File /oname=$PLUGINSDIR\pvOpen.bmp "${BUILD_RESOURCES_DIR}\installerOpen.bmp"
  ${If} $pvFontName == ""
    CreateFont $pvFontName "Segoe UI Semibold" 20 600
    CreateFont $pvFontBody "Segoe UI" 10 400
    CreateFont $pvFontLink "Segoe UI Semibold" 10 600
  ${EndIf}
FunctionEnd


; Hide Modern UI's header, lines, branding and buttons; returns the client size in $R8 x $R9.
Function pvTakeWindow
  !insertmacro PV_HIDE 1034
  !insertmacro PV_HIDE 1037
  !insertmacro PV_HIDE 1038
  !insertmacro PV_HIDE 1039
  !insertmacro PV_HIDE 1035
  !insertmacro PV_HIDE 1045
  !insertmacro PV_HIDE 1028
  !insertmacro PV_HIDE 1256
  !insertmacro PV_HIDE 1
  !insertmacro PV_HIDE 2
  !insertmacro PV_HIDE 3
  System::Call "*(i, i, i, i) p .r1"
  System::Call "user32::GetClientRect(p $HWNDPARENT, p r1)"
  System::Call "*$1(i, i, i .R8, i .R9)"
  System::Free $1
  SetCtlColors $HWNDPARENT "" ${PV_PAPER}
FunctionEnd

; Full-window placeholder, then nsDialogs builds the page in it.
Function pvFullPage
  Call pvTakeWindow
  !insertmacro PV_HIDE 1018
  GetDlgItem $0 $HWNDPARENT 1044
  System::Call "user32::SetWindowPos(p r0, p 0, i 0, i 0, i R8, i R9, i 0x14)"
  ShowWindow $0 ${SW_SHOW}
FunctionEnd

; NSIS's own "go to the next page" message (WM_NOTIFY_OUTER_NEXT); works with Next hidden.
Function pvPressNext
  SendMessage $HWNDPARENT 0x408 1 0
FunctionEnd

; ---------- install page ----------

Function pvShowOptions
  ${If} $pvOptionsOpen == 1
    ShowWindow $pvHero ${SW_HIDE}
    StrCpy $0 ${SW_SHOW}
    SendMessage $pvOptions ${WM_SETTEXT} 0 "STR:Hide options"
  ${Else}
    ShowWindow $pvHero ${SW_SHOW}
    StrCpy $0 ${SW_HIDE}
    SendMessage $pvOptions ${WM_SETTEXT} 0 "STR:Custom options"
  ${EndIf}
  ShowWindow $pvOptions ${SW_HIDE}
  ShowWindow $pvOptions ${SW_SHOW}
  ShowWindow $pvDirLabel $0
  ShowWindow $pvDir $0
  ShowWindow $pvBrowse $0
  ShowWindow $pvChkDesktop $0
  ShowWindow $pvChkStart $0
  ShowWindow $pvChkOcr $0
FunctionEnd

Function pvOnOptions
  Pop $0
  ${If} $pvOptionsOpen == 1
    StrCpy $pvOptionsOpen 0
  ${Else}
    StrCpy $pvOptionsOpen 1
  ${EndIf}
  Call pvShowOptions
FunctionEnd

Function pvOnLicense
  Pop $0
  ExecShell "open" "${PV_LICENSE_URL}"
FunctionEnd

Function pvOnAgree
  Pop $0
  ${NSD_FreeImage} $pvBtnBmp
  ${NSD_GetState} $pvAgree $0
  ${If} $0 == ${BST_CHECKED}
    ${NSD_SetStretchedImage} $pvBtn "$PLUGINSDIR\pvBtn.bmp" $pvBtnBmp
  ${Else}
    ${NSD_SetStretchedImage} $pvBtn "$PLUGINSDIR\pvBtnOff.bmp" $pvBtnBmp
  ${EndIf}
FunctionEnd

Function pvOnBrowse
  Pop $0
  ${NSD_GetText} $pvDir $1
  nsDialogs::SelectFolderDialog "Install Phevere in" $1
  Pop $1
  ${If} $1 != "error"
  ${AndIf} $1 != ""
    StrCpy $2 $1 "" -7
    ${If} $2 != "Phevere"
      StrCpy $1 "$1\Phevere"
    ${EndIf}
    ${NSD_SetText} $pvDir $1
  ${EndIf}
FunctionEnd


Function pvOnInstall
  Pop $0
  ${NSD_GetState} $pvAgree $0
  ${If} $0 != ${BST_CHECKED}
    Return
  ${EndIf}
  ${NSD_GetText} $pvDir $1
  ${If} $1 != ""
    StrCpy $INSTDIR $1
  ${EndIf}
  !insertmacro PV_SECTION $pvChkDesktop ${SecDesktop}
  !insertmacro PV_SECTION $pvChkStart ${SecStartMenu}
  !insertmacro PV_SECTION $pvChkOcr ${SecOcr}
  Call pvPressNext
FunctionEnd



Function pvInstallPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  Call pvLoadArt
  Call pvFullPage
  nsDialogs::Create 1044
  Pop $pvPage
  SetCtlColors $pvPage "" ${PV_PAPER}

  ${NSD_CreateBitmap} 0 0 100% 62% ""
  Pop $pvHero
  ${NSD_SetStretchedImage} $pvHero "$PLUGINSDIR\pvHero.bmp" $pvHeroBmp

  ; Custom options sit where the illustration is.
  !insertmacro PV_LABEL $pvDirLabel 7% 7% 60% 7% "Install location" $pvFontLink ${PV_INK}
  ${NSD_CreateText} 7% 16% 64% 9% "$INSTDIR"
  Pop $pvDir
  SendMessage $pvDir ${WM_SETFONT} $pvFontBody 1
  ${NSD_CreateButton} 73% 15.5% 20% 10% "Browse…"
  Pop $pvBrowse
  SendMessage $pvBrowse ${WM_SETFONT} $pvFontBody 1
  ${NSD_OnClick} $pvBrowse pvOnBrowse
  !insertmacro PV_CHECK $pvChkDesktop 31% "Create a desktop shortcut" ${SecDesktop}
  !insertmacro PV_CHECK $pvChkStart 40% "Add Phevere to the Start menu" ${SecStartMenu}
  !insertmacro PV_CHECK $pvChkOcr 49% "Include OCR models (15 MB), to look up words in images" ${SecOcr}

  !insertmacro PV_LABEL $pvName 7% 66% 50% 11% "Phevere" $pvFontName ${PV_INK}
  !insertmacro PV_LABEL $pvVersion 7% 77% 50% 6% "Version ${VERSION}" $pvFontBody ${PV_MUTED}

  ${NSD_CreateBitmap} 61% 66% 32% 13% ""
  Pop $pvBtn
  ${NSD_AddStyle} $pvBtn ${SS_NOTIFY}
  ${NSD_SetStretchedImage} $pvBtn "$PLUGINSDIR\pvBtn.bmp" $pvBtnBmp
  ${NSD_OnClick} $pvBtn pvOnInstall

  ${NSD_CreateCheckbox} 7% 88% 17% 7% "I agree to the"
  Pop $pvAgree
  SetCtlColors $pvAgree ${PV_MUTED} ${PV_PAPER}
  SendMessage $pvAgree ${WM_SETFONT} $pvFontBody 1
  ${NSD_Check} $pvAgree
  ${NSD_OnClick} $pvAgree pvOnAgree
  ${NSD_CreateLink} 24.4% 89.2% 14% 7% "license"
  Pop $pvLicense
  SetCtlColors $pvLicense ${PV_EMBER} ${PV_PAPER}
  SendMessage $pvLicense ${WM_SETFONT} $pvFontLink 1
  ${NSD_OnClick} $pvLicense pvOnLicense

  ${NSD_CreateLink} 70% 89.2% 23% 7% "Custom options"
  Pop $pvOptions
  ${NSD_AddStyle} $pvOptions ${SS_RIGHT}
  SetCtlColors $pvOptions ${PV_EMBER} ${PV_PAPER}
  SendMessage $pvOptions ${WM_SETFONT} $pvFontLink 1
  ${NSD_OnClick} $pvOptions pvOnOptions

  StrCpy $pvOptionsOpen 0
  Call pvShowOptions
  nsDialogs::Show
  ${NSD_FreeImage} $pvHeroBmp
  ${NSD_FreeImage} $pvBtnBmp
FunctionEnd

; ---------- installing ----------

Function pvInstFilesShow
  Call pvLoadArt
  Call pvTakeWindow
  FindWindow $2 "#32770" "" $HWNDPARENT
  System::Call "user32::SetWindowPos(p r2, p 0, i 0, i 0, i R8, i R9, i 0x14)"
  SetCtlColors $2 "" ${PV_PAPER}

  ; Illustration across the top, stretched to the window.
  IntOp $3 $R9 * 62
  IntOp $3 $3 / 100
  System::Call "user32::CreateWindowEx(i 0, t 'STATIC', t '', i 0x5000000E, i 0, i 0, i R8, i r3, p r2, p 0, p 0, p 0) p .r4"
  System::Call "user32::LoadImage(p 0, t '$PLUGINSDIR\pvHero.bmp', i 0, i R8, i r3, i 0x10) p .r5"
  SendMessage $4 0x172 0 $5

  ; Status line and one progress bar under it; no file list, no buttons.
  IntOp $6 $R8 * 7
  IntOp $6 $6 / 100
  IntOp $7 $R8 * 86
  IntOp $7 $7 / 100
  IntOp $8 $R9 * 70
  IntOp $8 $8 / 100
  IntOp $9 $R9 * 8
  IntOp $9 $9 / 100
  GetDlgItem $0 $2 1006
  System::Call "user32::SetWindowPos(p r0, p 0, i r6, i r8, i r7, i r9, i 0x14)"
  SetCtlColors $0 ${PV_MUTED} ${PV_PAPER}
  SendMessage $0 ${WM_SETFONT} $pvFontBody 1

  IntOp $8 $R9 * 80
  IntOp $8 $8 / 100
  IntOp $9 $R9 * 2
  IntOp $9 $9 / 100
  IntOp $9 $9 + 2
  GetDlgItem $0 $2 1004
  System::Call "user32::SetWindowPos(p r0, p 0, i r6, i r8, i r7, i r9, i 0x14)"
  ; Unthemed so the bar can take the ember colour (PBM_SETBARCOLOR, PBM_SETBKCOLOR; BGR).
  System::Call "uxtheme::SetWindowTheme(p r0, w '', w '')"
  SendMessage $0 0x409 0 0x003D9C
  SendMessage $0 0x2001 0 0x00D8DEE3

  GetDlgItem $0 $2 1016
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $2 1027
  ShowWindow $0 ${SW_HIDE}
FunctionEnd

; ---------- finish ----------

Function pvOnOpen
  Pop $0
  ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  Call pvPressNext
FunctionEnd

Function pvOnClose
  Pop $0
  Call pvPressNext
FunctionEnd

Function pvFinishPage
  Call pvLoadArt
  Call pvFullPage
  nsDialogs::Create 1044
  Pop $pvPage
  SetCtlColors $pvPage "" ${PV_PAPER}

  ${NSD_CreateBitmap} 0 0 100% 62% ""
  Pop $pvHero
  ${NSD_SetStretchedImage} $pvHero "$PLUGINSDIR\pvHero.bmp" $pvHeroBmp

  !insertmacro PV_LABEL $pvName 7% 66% 54% 11% "Phevere is installed" $pvFontName ${PV_INK}
  !insertmacro PV_LABEL $pvVersion 7% 77% 54% 6% "Select a word in any app to look it up." $pvFontBody ${PV_MUTED}

  ${NSD_CreateBitmap} 61% 66% 32% 13% ""
  Pop $pvBtn
  ${NSD_AddStyle} $pvBtn ${SS_NOTIFY}
  ${NSD_SetStretchedImage} $pvBtn "$PLUGINSDIR\pvOpen.bmp" $pvBtnBmp
  ${NSD_OnClick} $pvBtn pvOnOpen

  ${NSD_CreateLink} 70% 89.2% 23% 7% "Close"
  Pop $pvClose
  ${NSD_AddStyle} $pvClose ${SS_RIGHT}
  SetCtlColors $pvClose ${PV_EMBER} ${PV_PAPER}
  SendMessage $pvClose ${WM_SETFONT} $pvFontLink 1
  ${NSD_OnClick} $pvClose pvOnClose

  nsDialogs::Show
  ${NSD_FreeImage} $pvHeroBmp
  ${NSD_FreeImage} $pvBtnBmp
FunctionEnd

!macroend

!endif
