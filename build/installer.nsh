; Custom NSIS hooks for the Windows installer (picked up automatically by electron-builder
; from build/installer.nsh). See electron-builder.yml `nsis:`.

; Always install for the current user only: no "all users" choice, no UAC prompt.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The arm64-only installer carries no x64 app, and electron-builder's template has no
; architecture check for that case: on an Intel/AMD PC it would extract nothing. Say so
; instead. (customInit is skipped while electron-builder builds the uninstaller on the build
; machine, so an x64 machine can still build the arm64 installer.)
!macro customInit
  !ifdef APP_ARM64
    !ifndef APP_64
      ${IfNot} ${IsNativeARM64}
        MessageBox MB_OK|MB_ICONEXCLAMATION "This installer is for PCs with an Arm processor. This PC has an Intel or AMD processor: download the file ending in -win-x64-setup.exe instead." /SD IDOK
        SetErrorLevel 1
        Quit
      ${EndIf}
    !endif
  !endif
!macroend

; Finish page: "Run" checkbox (as electron-builder's default) plus an opt-in
; "Create a desktop shortcut" checkbox (createDesktopShortcut is false in the config).
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function CreateDesktopShortcut
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateDesktopShortcut"
  !insertmacro MUI_PAGE_FINISH
!macroend

; The built-in uninstaller only removes the desktop link when electron-builder created it.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${endIf}
!macroend
